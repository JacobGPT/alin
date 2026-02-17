/**
 * Claude API Client - Production-Grade Anthropic API Integration
 *
 * Features:
 * - Streaming responses with proper SSE handling
 * - Extended thinking support
 * - Tool use with automatic continuation
 * - Vision support (image analysis)
 * - Multi-turn conversations with branching
 * - Token counting and cost tracking
 * - Exponential backoff retry logic
 * - Rate limit handling
 * - Request cancellation
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageCreateParams,
  TextBlock as AnthropicTextBlock,
  ToolUseBlock as AnthropicToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';

import { MessageRole } from '../types/chat';
import type { Message as ChatMessage, ContentBlock, ModelConfig } from '../types/chat';

// ============================================================================
// TYPES
// ============================================================================

export interface ClaudeConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  enableThinking?: boolean;
  thinkingBudget?: number;
}

export interface ClaudeStreamChunk {
  type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' |
        'message_start' | 'message_delta' | 'message_stop' | 'error' | 'ping';
  index?: number;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
  content_block?: {
    type: string;
    id?: string;
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  message?: Partial<Message>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

export interface ClaudeResponse {
  id: string;
  content: ContentBlock[];
  thinkingContent?: string;
  model: string;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
  cost: number;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Claude-specific tool types (computer use, text editor)
export interface ComputerUseTool {
  type: 'computer_20250124';
  name: 'computer';
  display_width_px: number;
  display_height_px: number;
  display_number?: number;
}

export interface TextEditorTool {
  type: 'text_editor_20250728';
  name: 'str_replace_editor';
}

// Union type for all Claude tool definitions
export type ClaudeToolDefinition = ClaudeTool | ComputerUseTool | TextEditorTool;

export interface ToolResult {
  toolUseId: string;
  content: string | Array<{ type: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface StreamCallbacks {
  onThinking?: (thinking: string) => void;
  onText?: (text: string) => void;
  onToolUse?: (tool: { id: string; name: string; input: unknown }) => void;
  onUsage?: (usage: ClaudeResponse['usage']) => void;
  onError?: (error: Error) => void;
}

// ============================================================================
// PRICING (Updated Feb 2026)
// ============================================================================

// Pricing in $ per million tokens — used with formula: (tokens / 1M) * price
export const CLAUDE_PRICING: Record<string, { input: number; output: number; cacheWrite?: number; cacheRead?: number }> = {
  // Claude
  'claude-opus-4-6':            { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-20250514':     { input: 15.0,  output: 75.0,  cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-4-5-20250929': { input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  'claude-sonnet-4-20250514':   { input: 3.0,   output: 15.0,  cacheWrite: 3.75,  cacheRead: 0.3 },
  'claude-haiku-4-5-20251001':  { input: 0.8,   output: 4.0,   cacheWrite: 1.0,   cacheRead: 0.08 },
  // GPT
  'gpt-5.2':       { input: 2.0,  output: 10.0 },
  'gpt-5.1':       { input: 2.0,  output: 10.0 },
  'gpt-5':         { input: 2.0,  output: 8.0 },
  'gpt-5-mini':    { input: 0.4,  output: 1.6 },
  'gpt-5-nano':    { input: 0.1,  output: 0.4 },
  'gpt-4.1':       { input: 2.0,  output: 8.0 },
  'gpt-4.1-mini':  { input: 0.4,  output: 1.6 },
  'gpt-4.1-nano':  { input: 0.1,  output: 0.4 },
  'gpt-4o':        { input: 2.5,  output: 10.0 },
  'gpt-4o-mini':   { input: 0.15, output: 0.6 },
  'o3':            { input: 2.0,  output: 8.0 },
  'o4-mini':       { input: 1.1,  output: 4.4 },
  'o3-mini':       { input: 1.1,  output: 4.4 },
  // Gemini
  'gemini-3-pro-preview':  { input: 1.25, output: 10.0 },
  'gemini-3-flash-preview': { input: 0.15, output: 0.6 },
  'gemini-2.5-pro':        { input: 1.25, output: 10.0 },
  'gemini-2.5-flash':      { input: 0.15, output: 0.6 },
  'gemini-2.5-flash-lite': { input: 0.075, output: 0.3 },
  // DeepSeek
  'deepseek-chat':     { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

// ============================================================================
// RETRY CONFIGURATION
// ============================================================================

const RETRY_CONFIG = {
  maxRetries: 15,
  initialDelayMs: 2000,
  maxDelayMs: 120000,
  backoffMultiplier: 1.5,
  retryableStatuses: [429, 500, 502, 503, 529],
  rateLimitDelayMs: 15000, // Wait for 429s
};

// ============================================================================
// CLAUDE API CLIENT CLASS
// ============================================================================

export class ClaudeAPIClient {
  private client: Anthropic;
  private config: Required<ClaudeConfig>;
  private abortController: AbortController | null = null;

  constructor(config: ClaudeConfig) {
    this.config = {
      apiKey: config.apiKey,
      model: config.model || 'claude-sonnet-4-5-20250929',
      maxTokens: config.maxTokens || 16384,
      temperature: config.temperature ?? 1,
      topP: config.topP ?? 0.95,
      topK: config.topK ?? 40,
      enableThinking: config.enableThinking ?? true,
      thinkingBudget: config.thinkingBudget ?? 10000,
    };

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      dangerouslyAllowBrowser: true, // Required for browser usage
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
    tools?: ClaudeTool[],
    toolResults?: ToolResult[]
  ): Promise<ClaudeResponse> {
    return this.withRetry(async () => {
      const params = this.buildRequestParams(messages, systemPrompt, tools, toolResults, false);
      const response = await this.client.messages.create(params as MessageCreateParams) as Message;
      return this.parseResponse(response);
    });
  }

  /**
   * Send a streaming message with callbacks
   */
  async streamMessage(
    messages: ChatMessage[],
    callbacks: StreamCallbacks = {},
    systemPrompt?: string,
    tools?: ClaudeTool[],
    toolResults?: ToolResult[]
  ): Promise<ClaudeResponse> {
    this.abortController = new AbortController();

    // Retry wrapper for streaming — retries on rate limit if no content has been emitted yet
    const maxStreamRetries = 5;
    let lastStreamError: any = null;

    for (let streamAttempt = 0; streamAttempt <= maxStreamRetries; streamAttempt++) {
      // On retry, log and wait with backoff
      if (streamAttempt > 0) {
        const retryDelay = Math.min(
          RETRY_CONFIG.rateLimitDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, streamAttempt - 1),
          RETRY_CONFIG.maxDelayMs
        );
        const jitter = retryDelay * 0.1 * Math.random();
        console.warn(`[ClaudeClient] Stream retry ${streamAttempt}/${maxStreamRetries} after ${Math.round((retryDelay + jitter) / 1000)}s`);
        await this.sleep(retryDelay + jitter);
      }

    try {
      const params = this.buildRequestParams(messages, systemPrompt, tools, toolResults, true);

      // Build stream options with beta headers
      const betaFeatures: string[] = [];
      if (this.config.enableThinking) {
        betaFeatures.push('interleaved-thinking-2025-05-14');
      }
      // Check if computer use tool is in the tools list
      if (tools?.some((t: any) => t.type === 'computer_20250124')) {
        betaFeatures.push('computer-use-2025-01-24');
      }

      const streamOptions: any = {
        signal: this.abortController.signal,
      };
      if (betaFeatures.length > 0) {
        streamOptions.headers = {
          'anthropic-beta': betaFeatures.join(','),
        };
      }

      const stream = this.client.messages.stream(params as MessageCreateParams, streamOptions);

      const contentBlocks: ContentBlock[] = [];
      let allThinkingContent = ''; // Combined thinking for response object
      let currentBlockType = '';
      let currentBlockText = '';
      let currentThinkingText = ''; // Per-block thinking (for interleaved thinking)
      let currentSignature = ''; // Thinking block signature for API round-trips
      let currentToolUse: { id: string; name: string; input: string } | null = null;
      let usage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      let messageId = '';
      let stopReason = 'end_turn';

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            messageId = event.message.id;
            if (event.message.usage) {
              usage.inputTokens = event.message.usage.input_tokens;
            }
            break;

          case 'content_block_start':
            currentBlockText = '';
            currentThinkingText = '';
            currentSignature = '';

            if (event.content_block.type === 'thinking') {
              currentBlockType = 'thinking';
            } else if (event.content_block.type === 'redacted_thinking') {
              // Redacted thinking is a complete block - push immediately
              currentBlockType = 'redacted_thinking';
              contentBlocks.push({
                type: 'redacted_thinking',
                data: (event.content_block as any).data || '',
              });
            } else if (event.content_block.type === 'text') {
              currentBlockType = 'text';
            } else if (event.content_block.type === 'tool_use') {
              currentBlockType = 'tool_use';
              const toolBlock = event.content_block as AnthropicToolUseBlock;
              currentToolUse = {
                id: toolBlock.id,
                name: toolBlock.name,
                input: '',
              };
            }
            break;

          case 'content_block_delta':
            if (event.delta.type === 'thinking_delta') {
              const thinking = (event.delta as { thinking: string }).thinking || '';
              currentThinkingText += thinking;
              allThinkingContent += thinking;
              callbacks.onThinking?.(thinking);
            } else if (event.delta.type === 'signature_delta') {
              // Signature for thinking block - needed for API round-trips
              currentSignature += (event.delta as any).signature || '';
            } else if (event.delta.type === 'text_delta') {
              const text = (event.delta as { text: string }).text || '';
              currentBlockText += text;
              callbacks.onText?.(text);
            } else if (event.delta.type === 'input_json_delta') {
              const partialJson = (event.delta as { partial_json: string }).partial_json || '';
              if (currentToolUse) {
                currentToolUse.input += partialJson;
              }
            }
            break;

          case 'content_block_stop':
            if (currentBlockType === 'text' && currentBlockText) {
              contentBlocks.push({
                type: 'text',
                text: currentBlockText,
              });
            } else if (currentBlockType === 'thinking' && currentThinkingText) {
              contentBlocks.push({
                type: 'thinking',
                content: currentThinkingText,
                signature: currentSignature || undefined,
              });
            } else if (currentBlockType === 'tool_use' && currentToolUse) {
              let parsedInput: unknown;
              try {
                parsedInput = JSON.parse(currentToolUse.input || '{}');
              } catch {
                parsedInput = {};
              }

              contentBlocks.push({
                type: 'tool_use',
                toolUseId: currentToolUse.id,
                toolName: currentToolUse.name,
                toolInput: parsedInput as Record<string, unknown>,
              });

              callbacks.onToolUse?.({
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: parsedInput,
              });

              currentToolUse = null;
            }
            // redacted_thinking already pushed in content_block_start

            currentBlockType = '';
            currentBlockText = '';
            currentThinkingText = '';
            currentSignature = '';
            break;

          case 'message_delta':
            if (event.delta.stop_reason) {
              stopReason = event.delta.stop_reason;
            }
            if (event.usage) {
              usage.outputTokens = event.usage.output_tokens;
            }
            break;

          case 'message_stop':
            // Final event
            break;
        }
      }

      // Get final message for complete usage stats
      const finalMessage = await stream.finalMessage();
      if (finalMessage.usage) {
        usage.inputTokens = finalMessage.usage.input_tokens;
        usage.outputTokens = finalMessage.usage.output_tokens;
        usage.cacheCreationTokens = (finalMessage.usage as any).cache_creation_input_tokens || 0;
        usage.cacheReadTokens = (finalMessage.usage as any).cache_read_input_tokens || 0;
      }

      const response: ClaudeResponse = {
        id: messageId,
        content: contentBlocks,
        thinkingContent: allThinkingContent || undefined,
        model: this.config.model,
        stopReason,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.inputTokens + usage.outputTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens: usage.cacheReadTokens,
        },
        cost: this.calculateCost(usage),
      };

      callbacks.onUsage?.(response.usage);

      this.abortController = null;
      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request cancelled');
      }

      // Check if retryable (rate limit or server error) — retry the stream
      const status = error.status || error.statusCode;
      if (RETRY_CONFIG.retryableStatuses.includes(status) && streamAttempt < maxStreamRetries) {
        console.warn(`[ClaudeClient] Stream failed with status ${status}, will retry...`);
        lastStreamError = error;
        // Create fresh abort controller for retry
        this.abortController = new AbortController();
        continue; // goes to next iteration of the retry for-loop
      }

      callbacks.onError?.(error);
      this.abortController = null;
      throw this.handleError(error);
    }

    } // end retry for-loop

    // If we exhausted all retries
    this.abortController = null;
    if (lastStreamError) {
      callbacks.onError?.(lastStreamError);
      throw this.handleError(lastStreamError);
    }
    throw new Error('Stream failed after retries');
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
    tools?: ClaudeTool[]
  ): Promise<ClaudeResponse> {
    // Build the continuation messages
    const continuationMessages: ChatMessage[] = [
      ...messages,
      {
        id: `assistant_${Date.now()}`,
        role: MessageRole.ASSISTANT,
        content: assistantMessage,
        timestamp: Date.now(),
        conversationId: messages[0]?.conversationId || '',
      },
    ];

    return this.streamMessage(continuationMessages, callbacks, systemPrompt, tools, toolResults);
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
   * Analyze an image with optional prompt
   */
  async analyzeImage(
    imageData: string | { url: string } | { base64: string; mediaType: string },
    prompt: string,
    callbacks?: StreamCallbacks
  ): Promise<ClaudeResponse> {
    let imageBlock: ContentBlock;

    if (typeof imageData === 'string') {
      // Assume URL
      imageBlock = {
        type: 'image',
        url: imageData,
      };
    } else if ('url' in imageData) {
      imageBlock = {
        type: 'image',
        url: imageData.url,
      };
    } else {
      imageBlock = {
        type: 'image',
        url: `data:${imageData.mediaType};base64,${imageData.base64}`,
      };
    }

    const messages: ChatMessage[] = [
      {
        id: `msg_${Date.now()}`,
        role: MessageRole.USER,
        content: [imageBlock, { type: 'text', text: prompt }],
        timestamp: Date.now(),
        conversationId: '',
      },
    ];

    if (callbacks) {
      return this.streamMessage(messages, callbacks);
    }
    return this.sendMessage(messages);
  }

  // ==========================================================================
  // REQUEST BUILDING
  // ==========================================================================

  private buildRequestParams(
    messages: ChatMessage[],
    systemPrompt?: string,
    tools?: ClaudeTool[],
    toolResults?: ToolResult[],
    stream = false
  ): Partial<MessageCreateParams> {
    // Convert messages to Anthropic format
    const anthropicMessages = this.convertMessages(messages, toolResults);

    const params: Partial<MessageCreateParams> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: anthropicMessages as any,
    };

    // Only set temperature if not using extended thinking
    if (!this.config.enableThinking) {
      params.temperature = this.config.temperature;
    }

    // Add system prompt
    if (systemPrompt) {
      params.system = systemPrompt;
    }

    // Add tools
    if (tools && tools.length > 0) {
      params.tools = tools as any;
    }

    // Add extended thinking if enabled
    if (this.config.enableThinking) {
      (params as any).thinking = {
        type: 'enabled',
        budget_tokens: this.config.thinkingBudget,
      };
      // Ensure max_tokens > budget_tokens (API requirement)
      if (params.max_tokens && params.max_tokens <= this.config.thinkingBudget) {
        params.max_tokens = this.config.thinkingBudget + 8192;
      }
    }

    // Enable streaming
    if (stream) {
      params.stream = true;
    }

    return params;
  }

  private convertMessages(
    messages: ChatMessage[],
    toolResults?: ToolResult[]
  ): Array<{ role: string; content: unknown }> {
    const converted = messages.map((msg, index) => {
      const isLastMessage = index === messages.length - 1;
      const isAssistantWithToolUse = msg.role === MessageRole.ASSISTANT &&
        msg.content.some((block) => block.type === 'tool_use');

      // If we're continuing with tool results, keep tool_use in the last assistant message
      // Otherwise, filter out tool_use/tool_result from history to avoid API errors
      const shouldKeepToolBlocks = toolResults && toolResults.length > 0 && isLastMessage && isAssistantWithToolUse;

      let contentToConvert = msg.content;
      if (!shouldKeepToolBlocks) {
        // Filter out tool_use, tool_result, and thinking blocks from older history
        // Thinking blocks should only be in the immediately preceding assistant message for continuations
        const filteredContent = msg.content.filter(
          (block) => block.type !== 'tool_use' && block.type !== 'tool_result' &&
            block.type !== 'thinking' && block.type !== 'redacted_thinking' &&
            block.type !== 'tool_activity' &&
            !(block.type === 'image' && msg.role !== MessageRole.USER)
        );
        // If all content was filtered out, use a placeholder
        contentToConvert = filteredContent.length > 0
          ? filteredContent
          : [{ type: 'text', text: '[Previous response used tools]' }];
      }

      return {
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: this.convertContentBlocks(contentToConvert),
      };
    });

    // Add tool results as a user message if provided
    if (toolResults && toolResults.length > 0) {
      converted.push({
        role: 'user',
        content: toolResults.map((result) => ({
          type: 'tool_result',
          tool_use_id: result.toolUseId,
          content: result.content,
          is_error: result.isError || false,
        })),
      });
    }

    return converted;
  }

  private convertContentBlocks(blocks: ContentBlock[]): unknown[] {
    return blocks.map((block: any) => {
      switch (block.type) {
        case 'text':
          return {
            type: 'text',
            text: block.text,
          };

        case 'image':
          // Handle both URL and base64
          if (block.url?.startsWith('data:')) {
            const match = block.url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: match[1],
                  data: match[2],
                },
              };
            }
          }
          return {
            type: 'image',
            source: {
              type: 'url',
              url: block.url,
            },
          };

        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.toolUseId,
            name: block.toolName,
            input: block.toolInput,
          };

        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.result,
            is_error: block.isError || false,
          };

        case 'thinking':
          return {
            type: 'thinking',
            thinking: block.content,
            // Preserve signature for API round-trips (required by Claude API)
            ...(block.signature ? { signature: block.signature } : {}),
          };

        case 'redacted_thinking':
          return {
            type: 'redacted_thinking',
            data: block.data,
          };

        case 'tool_activity':
          // Skip tool_activity blocks - they're UI-only, not sent to the API
          return null;

        default:
          return {
            type: 'text',
            text: JSON.stringify(block),
          };
      }
    }).filter(Boolean); // Remove null entries (e.g., tool_activity blocks)
  }

  // ==========================================================================
  // RESPONSE PARSING
  // ==========================================================================

  private parseResponse(response: Message): ClaudeResponse {
    const content: ContentBlock[] = [];
    let thinkingContent = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        content.push({
          type: 'text',
          text: (block as AnthropicTextBlock).text,
        });
      } else if (block.type === 'tool_use') {
        const toolBlock = block as AnthropicToolUseBlock;
        content.push({
          type: 'tool_use',
          toolUseId: toolBlock.id,
          toolName: toolBlock.name,
          toolInput: toolBlock.input as Record<string, unknown>,
        });
      } else if ((block as any).type === 'thinking') {
        thinkingContent += (block as any).thinking;
        content.push({
          type: 'thinking',
          content: (block as any).thinking,
          signature: (block as any).signature,
        });
      } else if ((block as any).type === 'redacted_thinking') {
        content.push({
          type: 'redacted_thinking',
          data: (block as any).data,
        });
      }
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: (response.usage as any).cache_creation_input_tokens || 0,
      cacheReadTokens: (response.usage as any).cache_read_input_tokens || 0,
    };

    return {
      id: response.id,
      content,
      thinkingContent: thinkingContent || undefined,
      model: response.model,
      stopReason: response.stop_reason || 'end_turn',
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        cacheReadTokens: usage.cacheReadTokens,
      },
      cost: this.calculateCost(usage),
    };
  }

  // ==========================================================================
  // COST CALCULATION
  // ==========================================================================

  private calculateCost(usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  }): number {
    const defaultPricing = CLAUDE_PRICING['claude-sonnet-4-20250514']!;
    const pricing = CLAUDE_PRICING[this.config.model] ?? defaultPricing;

    let cost = 0;
    cost += (usage.inputTokens / 1_000_000) * pricing.input;
    cost += (usage.outputTokens / 1_000_000) * pricing.output;

    if (usage.cacheCreationTokens && pricing.cacheWrite) {
      cost += (usage.cacheCreationTokens / 1_000_000) * pricing.cacheWrite;
    }
    if (usage.cacheReadTokens && pricing.cacheRead) {
      cost += (usage.cacheReadTokens / 1_000_000) * pricing.cacheRead;
    }

    return cost;
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

        // Check if retryable
        const status = error.status || error.statusCode;
        if (!RETRY_CONFIG.retryableStatuses.includes(status)) {
          throw this.handleError(error);
        }

        // Don't retry on last attempt
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

        // Add jitter
        const jitter = delay * 0.1 * Math.random();

        console.warn(`Claude API retry attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries} after ${Math.round((delay + jitter) / 1000)}s (status: ${status})`);

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
      return new ClaudeAPIError('Bad request: ' + message, 'INVALID_REQUEST', false);
    } else if (status === 401) {
      return new ClaudeAPIError('Invalid API key', 'AUTHENTICATION_ERROR', false);
    } else if (status === 403) {
      return new ClaudeAPIError('Access forbidden', 'FORBIDDEN', false);
    } else if (status === 404) {
      return new ClaudeAPIError('Model not found', 'NOT_FOUND', false);
    } else if (status === 429) {
      return new ClaudeAPIError('Rate limit exceeded', 'RATE_LIMIT', true);
    } else if (status === 500) {
      return new ClaudeAPIError('Anthropic API internal error', 'API_ERROR', true);
    } else if (status === 529) {
      return new ClaudeAPIError('Anthropic API overloaded', 'OVERLOADED', true);
    }

    return new ClaudeAPIError(message, 'UNKNOWN_ERROR', false);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  /**
   * Estimate tokens in text (approximate)
   */
  estimateTokens(text: string): number {
    // Claude uses ~4 chars per token on average
    return Math.ceil(text.length / 4);
  }

  /**
   * Get model information
   */
  getModelConfig(): ModelConfig {
    const defaultPricing = CLAUDE_PRICING['claude-sonnet-4-20250514']!;
    const pricing = CLAUDE_PRICING[this.config.model] ?? defaultPricing;

    return {
      provider: 'anthropic' as any,
      modelId: this.config.model,
      name: this.getModelName(),
      maxContextTokens: 200000,
      supportsVision: true,
      supportsTools: true,
      supportsStreaming: true,
      costPer1kPromptTokens: pricing.input / 1000,
      costPer1kCompletionTokens: pricing.output / 1000,
    };
  }

  private getModelName(): string {
    const nameMap: Record<string, string> = {
      'claude-opus-4-6': 'Claude Opus 4.6',
      'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
      'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
      'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    };

    return nameMap[this.config.model] || this.config.model;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ClaudeConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * Enable/disable extended thinking
   */
  setThinking(enabled: boolean, budgetTokens?: number): void {
    this.config.enableThinking = enabled;
    if (budgetTokens !== undefined) {
      this.config.thinkingBudget = budgetTokens;
    }
  }
}

// ============================================================================
// ERROR CLASS
// ============================================================================

export class ClaudeAPIError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'ClaudeAPIError';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createClaudeClient(apiKey: string, options?: Partial<ClaudeConfig>): ClaudeAPIClient {
  return new ClaudeAPIClient({
    apiKey,
    ...options,
  });
}

// ============================================================================
// AVAILABLE MODELS
// ============================================================================

export const CLAUDE_MODELS = [
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    description: 'Most capable model for complex tasks',
    contextWindow: 200000,
    maxOutput: 32000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    description: 'Balanced performance and cost',
    contextWindow: 200000,
    maxOutput: 16000,
  },
  {
    id: 'claude-haiku-4-20251001',
    name: 'Claude Haiku 4',
    description: 'Fastest, most cost-effective',
    contextWindow: 200000,
    maxOutput: 8000,
  },
];
