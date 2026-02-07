/**
 * OpenAI API Client - Production-Grade GPT Integration
 *
 * Features:
 * - Streaming responses with proper SSE handling
 * - Tool/function calling with parallel tool use
 * - Vision support (GPT-4o, GPT-4 Turbo)
 * - Structured outputs (JSON mode)
 * - Multi-turn conversations
 * - Token counting
 * - Cost calculation with caching
 * - Exponential backoff retry logic
 * - Rate limit handling
 * - Request cancellation
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionChunk,
  ChatCompletion,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions';

import { MessageRole } from '../types/chat';
import type { Message as ChatMessage, ContentBlock, ModelConfig } from '../types/chat';

// ============================================================================
// TYPES
// ============================================================================

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  responseFormat?: 'text' | 'json_object';
  seed?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

// Helper to detect o-series reasoning models
export function isReasoningModel(model: string): boolean {
  return model.startsWith('o1') || model.startsWith('o3');
}

export interface OpenAIStreamChunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    reasoningTokens?: number;
  };
  cost: number;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolResult {
  toolCallId: string;
  content: string;
}

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onToolCall?: (tool: { id: string; name: string; arguments: string }) => void;
  onToolCallComplete?: (tool: { id: string; name: string; arguments: unknown }) => void;
  onUsage?: (usage: OpenAIResponse['usage']) => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// PRICING (Updated Feb 2026)
// ============================================================================

const OPENAI_PRICING: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-4o': {
    input: 2.5 / 1_000_000,
    output: 10.0 / 1_000_000,
    cachedInput: 1.25 / 1_000_000,
  },
  'gpt-4o-mini': {
    input: 0.15 / 1_000_000,
    output: 0.6 / 1_000_000,
    cachedInput: 0.075 / 1_000_000,
  },
  'gpt-4-turbo': {
    input: 10.0 / 1_000_000,
    output: 30.0 / 1_000_000,
  },
  'gpt-4': {
    input: 30.0 / 1_000_000,
    output: 60.0 / 1_000_000,
  },
  'gpt-3.5-turbo': {
    input: 0.5 / 1_000_000,
    output: 1.5 / 1_000_000,
  },
  'o1': {
    input: 15.0 / 1_000_000,
    output: 60.0 / 1_000_000,
  },
  'o1-mini': {
    input: 3.0 / 1_000_000,
    output: 12.0 / 1_000_000,
  },
  'o3-mini': {
    input: 1.1 / 1_000_000,
    output: 4.4 / 1_000_000,
  },
};

// ============================================================================
// RETRY CONFIGURATION
// ============================================================================

const RETRY_CONFIG = {
  maxRetries: 15,
  initialDelayMs: 5000,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
  retryableStatuses: [429, 500, 502, 503, 504],
  rateLimitDelayMs: 30000, // Extra-long wait specifically for 429s
};

// ============================================================================
// OPENAI API CLIENT CLASS
// ============================================================================

export class OpenAIAPIClient {
  private client: OpenAI;
  private config: Required<OpenAIConfig>;
  private abortController: AbortController | null = null;

  constructor(config: OpenAIConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'gpt-4o',
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 1,
      topP: config.topP ?? 1,
      frequencyPenalty: config.frequencyPenalty ?? 0,
      presencePenalty: config.presencePenalty ?? 0,
      responseFormat: config.responseFormat || 'text',
      seed: config.seed ?? undefined as any,
      reasoningEffort: config.reasoningEffort || 'medium',
    };

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      dangerouslyAllowBrowser: true,
      maxRetries: 10, // SDK-level retry with Retry-After header support
      timeout: 300000, // 5 minute timeout for long tool chains
    });
  }

  // ==========================================================================
  // MAIN METHODS
  // ==========================================================================

  /**
   * Send a non-streaming message with automatic retry
   */
  async sendMessage(
    messages: ChatMessage[],
    systemPrompt?: string,
    tools?: OpenAITool[],
    toolChoice?: ChatCompletionToolChoiceOption
  ): Promise<OpenAIResponse> {
    return this.withRetry(async () => {
      const params = this.buildRequestParams(messages, systemPrompt, tools, toolChoice, false);
      const response = await this.client.chat.completions.create(params);
      return this.parseResponse(response as ChatCompletion);
    });
  }

  /**
   * Send a streaming message with callbacks
   */
  async streamMessage(
    messages: ChatMessage[],
    callbacks: StreamCallbacks = {},
    systemPrompt?: string,
    tools?: OpenAITool[],
    toolChoice?: ChatCompletionToolChoiceOption
  ): Promise<OpenAIResponse> {
    this.abortController = new AbortController();

    try {
      const params = this.buildRequestParams(messages, systemPrompt, tools, toolChoice, true);

      const stream = await this.client.chat.completions.create(params, {
        signal: this.abortController.signal,
      });

      let fullText = '';
      const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let finishReason = 'stop';
      let responseId = '';
      let usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

      for await (const chunk of stream as unknown as AsyncIterable<ChatCompletionChunk>) {
        responseId = chunk.id;

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta = choice.delta;

        // Handle text content
        if (delta.content) {
          fullText += delta.content;
          callbacks.onText?.(delta.content);
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;

            if (!toolCalls.has(index)) {
              toolCalls.set(index, {
                id: toolCall.id || '',
                name: toolCall.function?.name || '',
                arguments: '',
              });
            }

            const existing = toolCalls.get(index)!;

            if (toolCall.id) {
              existing.id = toolCall.id;
            }
            if (toolCall.function?.name) {
              existing.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              existing.arguments += toolCall.function.arguments;
              callbacks.onToolCall?.({
                id: existing.id,
                name: existing.name,
                arguments: existing.arguments,
              });
            }
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }

        // Handle usage in stream (if available)
        if (chunk.usage) {
          usage.promptTokens = chunk.usage.prompt_tokens;
          usage.completionTokens = chunk.usage.completion_tokens;
          // Extract reasoning tokens for o-series models
          const details = (chunk.usage as any).completion_tokens_details;
          if (details?.reasoning_tokens) {
            usage.reasoningTokens = details.reasoning_tokens;
          }
        }
      }

      // Build content blocks
      const content: ContentBlock[] = [];

      if (fullText) {
        content.push({
          type: 'text',
          text: fullText,
        });
      }

      // Add completed tool calls
      for (const [, toolCall] of toolCalls) {
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(toolCall.arguments || '{}');
        } catch {
          parsedArgs = {};
        }

        content.push({
          type: 'tool_use',
          toolUseId: toolCall.id,
          toolName: toolCall.name,
          toolInput: parsedArgs as Record<string, unknown>,
        });

        callbacks.onToolCallComplete?.({
          id: toolCall.id,
          name: toolCall.name,
          arguments: parsedArgs,
        });
      }

      // Estimate usage if not provided in stream
      if (usage.promptTokens === 0) {
        usage.promptTokens = this.estimateTokens(messages, systemPrompt);
        usage.completionTokens = this.countTokens(fullText);
      }

      const response: OpenAIResponse = {
        id: responseId,
        content,
        model: this.config.model,
        finishReason,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.promptTokens + usage.completionTokens,
          reasoningTokens: usage.reasoningTokens || undefined,
        },
        cost: this.calculateCost(usage.promptTokens, usage.completionTokens),
      };

      callbacks.onUsage?.(response.usage);

      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request cancelled');
      }
      callbacks.onError?.(error);
      throw this.handleError(error);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Continue a conversation after tool use
   */
  async continueWithToolResults(
    messages: ChatMessage[],
    assistantMessage: ContentBlock[],
    toolResults: ToolResult[],
    callbacks: StreamCallbacks = {},
    systemPrompt?: string,
    tools?: OpenAITool[]
  ): Promise<OpenAIResponse> {
    // Build continuation messages
    const continuationMessages: ChatMessage[] = [
      ...messages,
      {
        id: `assistant_${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: assistantMessage,
        timestamp: Date.now(),
        conversationId: messages[0]?.conversationId || '',
      },
      // Tool results need to be added as tool messages
      ...toolResults.map((result) => ({
        id: `tool_${result.toolCallId}`,
        role: 'tool' as any as MessageRole,
        content: [{ type: 'text' as const, text: result.content }],
        timestamp: Date.now(),
        conversationId: messages[0]?.conversationId || '',
        toolCallId: result.toolCallId,
      })),
    ];

    return this.streamMessage(continuationMessages, callbacks, systemPrompt, tools);
  }

  /**
   * Cancel an in-progress request
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Analyze an image with GPT-4o Vision
   */
  async analyzeImage(
    imageData: string | { url: string } | { base64: string; mediaType: string },
    prompt: string,
    detail: 'auto' | 'low' | 'high' = 'auto',
    callbacks?: StreamCallbacks
  ): Promise<OpenAIResponse> {
    let imageUrl: string;

    if (typeof imageData === 'string') {
      imageUrl = imageData;
    } else if ('url' in imageData) {
      imageUrl = imageData.url;
    } else {
      imageUrl = `data:${imageData.mediaType};base64,${imageData.base64}`;
    }

    const messages: ChatMessage[] = [
      {
        id: `msg_${Date.now()}`,
        role: MessageRole.USER,
        content: [
          { type: 'text', text: prompt },
          { type: 'image', url: imageUrl } as any,
        ],
        timestamp: Date.now(),
        conversationId: '',
      },
    ];

    if (callbacks) {
      return this.streamMessage(messages, callbacks);
    }
    return this.sendMessage(messages);
  }

  /**
   * Generate structured JSON output
   */
  async generateJSON<T>(
    prompt: string,
    schema?: { name: string; schema: Record<string, unknown> },
    systemPrompt?: string
  ): Promise<T> {
    const messages: ChatMessage[] = [
      {
        id: `msg_${Date.now()}`,
        role: MessageRole.USER,
        content: [{ type: 'text', text: prompt }],
        timestamp: Date.now(),
        conversationId: '',
      },
    ];

    // Temporarily enable JSON mode
    const originalFormat = this.config.responseFormat;
    this.config.responseFormat = 'json_object';

    try {
      const response = await this.sendMessage(messages, systemPrompt);
      const textContent = response.content.find((b) => b.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in response');
      }
      return JSON.parse(textContent.text) as T;
    } finally {
      this.config.responseFormat = originalFormat;
    }
  }

  // ==========================================================================
  // REQUEST BUILDING
  // ==========================================================================

  private buildRequestParams(
    messages: ChatMessage[],
    systemPrompt?: string,
    tools?: OpenAITool[],
    toolChoice?: ChatCompletionToolChoiceOption,
    stream = false
  ): any {
    const openaiMessages: ChatCompletionMessageParam[] = [];

    // Add system prompt
    if (systemPrompt) {
      openaiMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Convert messages
    for (const msg of messages) {
      if ((msg.role as string) === 'tool') {
        // Tool result message
        openaiMessages.push({
          role: 'tool',
          content: this.extractTextContent(msg.content),
          tool_call_id: (msg as any).toolCallId || '',
        });
      } else if (msg.role === MessageRole.ASSISTANT || (msg.role as string) === 'assistant') {
        const toolCalls = msg.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({
            id: (b as any).toolUseId,
            type: 'function' as const,
            function: {
              name: (b as any).toolName,
              arguments: JSON.stringify((b as any).toolInput || {}),
            },
          }));

        const textContent = this.extractTextContent(msg.content);

        openaiMessages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        } as any);
      } else {
        // User message
        openaiMessages.push({
          role: 'user',
          content: this.convertContentBlocks(msg.content),
        } as any);
      }
    }

    const isReasoning = isReasoningModel(this.config.model);

    const params: any = {
      model: this.config.model,
      messages: openaiMessages,
      stream,
    };

    if (isReasoning) {
      // O-series models: use max_completion_tokens, no temperature/penalties
      params.max_completion_tokens = this.config.maxTokens;
      params.reasoning_effort = this.config.reasoningEffort || 'medium';
    } else {
      // Standard models: full parameter set
      params.max_tokens = this.config.maxTokens;
      params.temperature = this.config.temperature;
      params.top_p = this.config.topP;
      params.frequency_penalty = this.config.frequencyPenalty;
      params.presence_penalty = this.config.presencePenalty;
    }

    // Add response format
    if (this.config.responseFormat === 'json_object') {
      params.response_format = { type: 'json_object' };
    }

    // Add seed for reproducibility
    if (this.config.seed !== undefined) {
      params.seed = this.config.seed;
    }

    // Add tools
    if (tools && tools.length > 0) {
      params.tools = tools as ChatCompletionTool[];
      if (toolChoice) {
        params.tool_choice = toolChoice;
      }
    }

    // Request usage in stream
    if (stream) {
      params.stream_options = { include_usage: true };
    }

    return params;
  }

  private convertContentBlocks(blocks: ContentBlock[]): any {
    const hasImages = blocks.some((b) => b.type === 'image');

    if (hasImages) {
      return blocks.map((block) => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        } else if (block.type === 'image') {
          return {
            type: 'image_url',
            image_url: {
              url: block.url,
              detail: (block as any).detail || 'auto',
            },
          };
        }
        return { type: 'text', text: JSON.stringify(block) };
      });
    }

    // Text only
    return blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text)
      .join('\n\n');
  }

  private extractTextContent(blocks: ContentBlock[]): string {
    return blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as any).text)
      .join('\n\n');
  }

  // ==========================================================================
  // RESPONSE PARSING
  // ==========================================================================

  private parseResponse(response: ChatCompletion): OpenAIResponse {
    const choice = response.choices[0];
    const message = choice.message;
    const content: ContentBlock[] = [];

    // Add text content
    if (message.content) {
      content.push({
        type: 'text',
        text: message.content,
      });
    }

    // Add tool calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const fn = (toolCall as any).function;
        let parsedArgs: unknown;
        try {
          parsedArgs = JSON.parse(fn?.arguments || '{}');
        } catch {
          parsedArgs = {};
        }

        content.push({
          type: 'tool_use',
          toolUseId: toolCall.id,
          toolName: fn?.name || '',
          toolInput: parsedArgs as Record<string, unknown>,
        });
      }
    }

    return {
      id: response.id,
      content,
      model: response.model,
      finishReason: choice.finish_reason || 'stop',
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      cost: this.calculateCost(
        response.usage?.prompt_tokens || 0,
        response.usage?.completion_tokens || 0
      ),
    };
  }

  // ==========================================================================
  // COST CALCULATION
  // ==========================================================================

  private calculateCost(promptTokens: number, completionTokens: number): number {
    const pricing = OPENAI_PRICING[this.config.model] || OPENAI_PRICING['gpt-4o'];

    const promptCost = promptTokens * pricing.input;
    const completionCost = completionTokens * pricing.output;

    return promptCost + completionCost;
  }

  // ==========================================================================
  // TOKEN COUNTING
  // ==========================================================================

  countTokens(text: string): number {
    // GPT uses ~4 chars per token on average
    return Math.ceil(text.length / 4);
  }

  private estimateTokens(messages: ChatMessage[], systemPrompt?: string): number {
    let total = 0;

    if (systemPrompt) {
      total += this.countTokens(systemPrompt);
    }

    for (const msg of messages) {
      // Add message overhead (~4 tokens per message)
      total += 4;

      for (const block of msg.content) {
        if (block.type === 'text') {
          total += this.countTokens(block.text);
        } else if (block.type === 'image') {
          // Images cost varying amounts based on detail level
          total += 85; // Low detail
          // High detail can be much more based on image size
        }
      }
    }

    return total;
  }

  // ==========================================================================
  // RETRY LOGIC
  // ==========================================================================

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        const status = error.status || error.statusCode;
        if (!RETRY_CONFIG.retryableStatuses.includes(status)) {
          throw this.handleError(error);
        }

        if (attempt === RETRY_CONFIG.maxRetries) {
          break;
        }

        // Check for Retry-After header (in seconds)
        const retryAfter = error.headers?.['retry-after'];
        let delay: number;

        if (retryAfter) {
          delay = (parseInt(retryAfter, 10) || 30) * 1000;
        } else if (status === 429) {
          // Rate limit without Retry-After: use aggressive backoff
          delay = Math.min(
            RETRY_CONFIG.rateLimitDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
            RETRY_CONFIG.maxDelayMs
          );
        } else {
          delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt),
            RETRY_CONFIG.maxDelayMs
          );
        }

        const jitter = delay * 0.1 * Math.random();

        console.warn(`OpenAI API retry attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries} after ${Math.round((delay + jitter) / 1000)}s (status: ${status})`);

        await this.sleep(delay + jitter);
      }
    }

    throw this.handleError(lastError!);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  private handleError(error: any): Error {
    const status = error.status || error.statusCode;
    const message = error.message || 'Unknown error';

    if (status === 400) {
      return new OpenAIAPIError('Bad request: ' + message, 'INVALID_REQUEST', false);
    } else if (status === 401) {
      return new OpenAIAPIError('Invalid API key', 'AUTHENTICATION_ERROR', false);
    } else if (status === 403) {
      return new OpenAIAPIError('Access forbidden', 'FORBIDDEN', false);
    } else if (status === 404) {
      return new OpenAIAPIError('Model not found', 'NOT_FOUND', false);
    } else if (status === 429) {
      return new OpenAIAPIError('Rate limit exceeded', 'RATE_LIMIT', true);
    } else if (status === 500) {
      return new OpenAIAPIError('OpenAI API internal error', 'API_ERROR', true);
    } else if (status === 503) {
      return new OpenAIAPIError('OpenAI API unavailable', 'UNAVAILABLE', true);
    }

    return new OpenAIAPIError(message, 'UNKNOWN_ERROR', false);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  getModelConfig(): ModelConfig {
    const pricing = OPENAI_PRICING[this.config.model] || OPENAI_PRICING['gpt-4o'];

    return {
      provider: 'openai' as any,
      modelId: this.config.model,
      name: this.getModelName(),
      maxContextTokens: this.getMaxContextTokens(),
      supportsVision: this.supportsVision(),
      supportsTools: true,
      supportsStreaming: true,
      costPer1kPromptTokens: pricing.input * 1000,
      costPer1kCompletionTokens: pricing.output * 1000,
    };
  }

  private getModelName(): string {
    const nameMap: Record<string, string> = {
      'gpt-4o': 'GPT-4o',
      'gpt-4o-mini': 'GPT-4o Mini',
      'gpt-4-turbo': 'GPT-4 Turbo',
      'gpt-4': 'GPT-4',
      'gpt-3.5-turbo': 'GPT-3.5 Turbo',
      'o1': 'o1',
      'o1-mini': 'o1 Mini',
    };

    return nameMap[this.config.model] || this.config.model;
  }

  private getMaxContextTokens(): number {
    const contextMap: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16385,
      'o1': 200000,
      'o1-mini': 128000,
      'o3-mini': 200000,
    };

    return contextMap[this.config.model] || 8192;
  }

  private supportsVision(): boolean {
    const visionModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'];
    return visionModels.some((m) => this.config.model.includes(m));
  }

  updateConfig(updates: Partial<OpenAIConfig>): void {
    Object.assign(this.config, updates);
  }
}

// ============================================================================
// ERROR CLASS
// ============================================================================

export class OpenAIAPIError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'OpenAIAPIError';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createOpenAIClient(apiKey: string, options?: Partial<OpenAIConfig>): OpenAIAPIClient {
  return new OpenAIAPIClient({
    apiKey,
    ...options,
  });
}

// ============================================================================
// AVAILABLE MODELS
// ============================================================================

export const OPENAI_MODELS = [
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    description: 'Most capable multimodal model',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    description: 'Fast and affordable',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
  },
  {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    description: 'High capability with vision',
    contextWindow: 128000,
    maxOutput: 4096,
    supportsVision: true,
  },
  {
    id: 'o1',
    name: 'o1',
    description: 'Advanced reasoning model',
    contextWindow: 200000,
    maxOutput: 100000,
    supportsVision: false,
  },
  {
    id: 'o1-mini',
    name: 'o1 Mini',
    description: 'Fast reasoning model',
    contextWindow: 128000,
    maxOutput: 65536,
    supportsVision: false,
  },
  {
    id: 'o3-mini',
    name: 'o3 Mini',
    description: 'Latest fast reasoning model',
    contextWindow: 200000,
    maxOutput: 100000,
    supportsVision: false,
  },
];
