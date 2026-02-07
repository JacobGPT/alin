/**
 * TBWO AI Service - Pod-Level AI Communication Wrapper
 *
 * Wraps server-proxied streaming for use by individual agent pods within
 * the TBWO execution system. Each pod gets its own AIService instance with
 * independent conversation history, token tracking, and configuration.
 *
 * All AI calls route through the server proxy (/api/chat/stream, /api/chat/continue).
 * API keys never touch the browser.
 *
 * Features:
 * - Unified interface over Claude and OpenAI providers (via server)
 * - Per-pod conversation history management
 * - Token usage and cost tracking
 * - Streaming with callback adapters
 * - Tool use with continuation support
 * - History trimming to manage context window
 * - Factory methods for pod-specific configuration
 * - Graceful error handling (returns error responses, does not throw)
 */

import { streamFromServer } from '../../api/serverStreamClient';
import type { AgentPod, PodRole } from '../../types/tbwo';
import { useSettingsStore } from '../../store/settingsStore';

// ============================================================================
// TYPES
// ============================================================================

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AIServiceConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (tool: { id: string; name: string; input: unknown }) => void;
  onError?: (error: Error) => void;
  onComplete?: (response: AIResponse) => void;
}

// ============================================================================
// ROLE-SPECIFIC SYSTEM PROMPTS
// ============================================================================

const ROLE_SYSTEM_PROMPTS: Record<string, string> = {
  orchestrator: `You are the Orchestrator pod in ALIN's TBWO system. Your job is to:
- Coordinate work across specialized pods
- Break down complex tasks into subtasks
- Monitor progress and resolve conflicts
- Make architectural decisions
- Ensure quality and consistency across all outputs
Be concise, decisive, and focused on coordination.`,

  design: `You are the Design pod in ALIN's TBWO system. Your job is to:
- Create UI/UX designs and layouts
- Define color schemes, typography, and spacing
- Ensure accessibility and responsive design
- Create design tokens and component specifications
Output clean, well-structured design specifications.`,

  frontend: `You are the Frontend Development pod in ALIN's TBWO system. Your job is to:
- Write clean, production-ready frontend code
- Implement UI components from design specifications
- Handle state management and data flow
- Ensure responsive layouts and cross-browser compatibility
- Write semantic HTML, efficient CSS, and clean JavaScript/TypeScript
Output working code with clear comments.`,

  backend: `You are the Backend Development pod in ALIN's TBWO system. Your job is to:
- Design and implement APIs and server-side logic
- Set up database schemas and queries
- Handle authentication, authorization, and security
- Create efficient data processing pipelines
- Write robust error handling and validation
Output production-ready server code.`,

  copy: `You are the Copywriting pod in ALIN's TBWO system. Your job is to:
- Write compelling, clear, and engaging content
- Match the brand voice and tone
- Create headlines, body copy, CTAs, and microcopy
- Ensure consistency across all written content
- Optimize for readability and SEO when appropriate
Output polished, publication-ready text.`,

  motion: `You are the Motion/Animation pod in ALIN's TBWO system. Your job is to:
- Design smooth, purposeful animations and transitions
- Create CSS animations and keyframes
- Define motion design tokens (durations, easings, delays)
- Ensure animations enhance UX without causing distraction
- Consider reduced-motion accessibility preferences
Output animation code and timing specifications.`,

  qa: `You are the Quality Assurance pod in ALIN's TBWO system. Your job is to:
- Review code for bugs, edge cases, and issues
- Verify implementations match specifications
- Check for accessibility, performance, and security issues
- Validate cross-browser and responsive behavior
- Write test cases and test plans
Output detailed, actionable feedback and test results.`,

  research: `You are the Research pod in ALIN's TBWO system. Your job is to:
- Gather and synthesize information on topics
- Analyze data and identify patterns
- Evaluate options and make recommendations
- Provide well-sourced, factual information
- Create structured research reports
Output clear, well-organized research findings.`,

  data: `You are the Data Processing pod in ALIN's TBWO system. Your job is to:
- Process, transform, and analyze datasets
- Create data pipelines and ETL processes
- Generate visualizations and statistical summaries
- Clean and validate data quality
- Design efficient data storage schemas
Output structured data and analysis results.`,

  deployment: `You are the Deployment pod in ALIN's TBWO system. Your job is to:
- Configure build and deployment pipelines
- Set up hosting, CDN, and infrastructure
- Handle environment variables and secrets
- Create deployment scripts and configurations
- Monitor deployment health and rollback if needed
Output deployment configurations and instructions.`,
};

// ============================================================================
// AI SERVICE CLASS
// ============================================================================

export class AIService {
  private config: AIServiceConfig;
  private conversationHistory: AIMessage[] = [];
  private totalTokensUsed = 0;
  private totalApiCalls = 0;

  constructor(config: AIServiceConfig) {
    this.config = {
      provider: config.provider || 'anthropic',
      model: config.model || 'claude-sonnet-4-5-20250929',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 8192,
      systemPrompt: config.systemPrompt || '',
    };
  }

  // ==========================================================================
  // CORE METHODS
  // ==========================================================================

  /**
   * Get the provider string for the server proxy.
   */
  private getProviderStr(): string {
    if (this.config.provider === 'anthropic' || this.config.provider === 'claude') return 'anthropic';
    if (this.config.provider === 'openai' || this.config.provider === 'gpt') return 'openai';
    return 'anthropic';
  }

  /**
   * Build the messages array for the server from conversation history.
   */
  private buildServerMessages(): Array<{ role: string; content: string }> {
    return this.conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  /**
   * Send a message and get a response (non-streaming).
   * Routes through the server proxy.
   */
  async sendMessage(message: string, tools?: any[]): Promise<AIResponse> {
    try {
      this.addToHistory('user', message);
      const messages = this.buildServerMessages();

      let fullText = '';
      const toolCalls: ToolCall[] = [];

      const result = await streamFromServer({
        endpoint: '/api/chat/stream',
        body: {
          provider: this.getProviderStr(),
          model: this.config.model,
          messages,
          system: this.config.systemPrompt || undefined,
          tools,
          maxTokens: this.config.maxTokens,
        },
        callbacks: {
          onText: (text) => { fullText += text; },
          onToolUse: (tool) => {
            toolCalls.push({
              id: tool.id,
              name: tool.name,
              input: tool.input,
            });
          },
        },
      });

      const usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      };
      this.totalTokensUsed += usage.inputTokens + usage.outputTokens;
      this.totalApiCalls += 1;

      if (fullText) {
        this.addToHistory('assistant', fullText);
      }

      return { text: fullText, toolCalls, usage, stopReason: result.stopReason };
    } catch (error: any) {
      console.error('[AIService] sendMessage error:', error);
      return this.createErrorResponse(error.message || 'Unknown error during message send');
    }
  }

  /**
   * Send a message with streaming response.
   */
  async streamMessage(message: string, callbacks: StreamCallbacks, tools?: any[]): Promise<void> {
    try {
      this.addToHistory('user', message);
      const messages = this.buildServerMessages();

      let fullText = '';
      const toolCalls: ToolCall[] = [];

      const result = await streamFromServer({
        endpoint: '/api/chat/stream',
        body: {
          provider: this.getProviderStr(),
          model: this.config.model,
          messages,
          system: this.config.systemPrompt || undefined,
          tools,
          maxTokens: this.config.maxTokens,
        },
        callbacks: {
          onText: (text) => {
            fullText += text;
            callbacks.onText?.(text);
          },
          onThinking: (thinking) => {
            callbacks.onThinking?.(thinking);
          },
          onToolUse: (tool) => {
            toolCalls.push({
              id: tool.id,
              name: tool.name,
              input: tool.input,
            });
            callbacks.onToolUse?.(tool);
          },
          onError: (error) => {
            callbacks.onError?.(error);
          },
        },
      });

      const usage = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      };
      this.totalTokensUsed += usage.inputTokens + usage.outputTokens;
      this.totalApiCalls += 1;

      if (fullText) {
        this.addToHistory('assistant', fullText);
      }

      callbacks.onComplete?.({
        text: fullText,
        toolCalls,
        usage,
        stopReason: result.stopReason,
      });
    } catch (error: any) {
      console.error('[AIService] streamMessage error:', error);
      callbacks.onError?.(error instanceof Error ? error : new Error(error.message || 'Stream error'));
    }
  }

  // ==========================================================================
  // TOOL CONTINUATION
  // ==========================================================================

  /**
   * Continue conversation after a tool execution. Adds the tool result as context
   * and calls the API again via the server proxy.
   */
  async continueWithToolResult(
    toolUseId: string,
    result: string,
    tools?: any[],
  ): Promise<AIResponse> {
    try {
      // Build proper messages array for the server
      const serverMessages: any[] = this.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add assistant message with tool_use
      serverMessages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: 'tool_result_continuation', input: {} }],
      });

      // Add user message with tool_result
      serverMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: result, is_error: false }],
      });

      let fullText = '';
      const newToolCalls: ToolCall[] = [];

      const streamResult = await streamFromServer({
        endpoint: '/api/chat/continue',
        body: {
          provider: this.getProviderStr(),
          model: this.config.model,
          messages: serverMessages,
          system: this.config.systemPrompt || undefined,
          tools,
          maxTokens: this.config.maxTokens,
        },
        callbacks: {
          onText: (text) => { fullText += text; },
          onToolUse: (tool) => {
            newToolCalls.push({
              id: tool.id,
              name: tool.name,
              input: tool.input,
            });
          },
        },
      });

      const usage = {
        inputTokens: streamResult.usage.inputTokens,
        outputTokens: streamResult.usage.outputTokens,
      };
      this.totalTokensUsed += usage.inputTokens + usage.outputTokens;
      this.totalApiCalls += 1;

      if (fullText) {
        this.addToHistory('assistant', fullText);
      }

      return { text: fullText, toolCalls: newToolCalls, usage, stopReason: streamResult.stopReason };
    } catch (error: any) {
      console.error('[AIService] continueWithToolResult error:', error);
      return this.createErrorResponse(error.message || 'Error continuing with tool result');
    }
  }

  /**
   * Streaming version of continueWithToolResult.
   */
  async streamContinueWithToolResult(
    toolUseId: string,
    result: string,
    callbacks: StreamCallbacks,
    tools?: any[],
  ): Promise<void> {
    try {
      // Build proper messages for the server
      const serverMessages: any[] = this.conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add assistant message with tool_use
      serverMessages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: 'tool_result_continuation', input: {} }],
      });

      // Add user message with tool_result
      serverMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: result, is_error: false }],
      });

      let fullText = '';
      const toolCalls: ToolCall[] = [];

      const streamResult = await streamFromServer({
        endpoint: '/api/chat/continue',
        body: {
          provider: this.getProviderStr(),
          model: this.config.model,
          messages: serverMessages,
          system: this.config.systemPrompt || undefined,
          tools,
          maxTokens: this.config.maxTokens,
        },
        callbacks: {
          onText: (text) => {
            fullText += text;
            callbacks.onText?.(text);
          },
          onThinking: (thinking) => {
            callbacks.onThinking?.(thinking);
          },
          onToolUse: (tool) => {
            toolCalls.push({ id: tool.id, name: tool.name, input: tool.input });
            callbacks.onToolUse?.(tool);
          },
          onError: (error) => {
            callbacks.onError?.(error);
          },
        },
      });

      const usage = {
        inputTokens: streamResult.usage.inputTokens,
        outputTokens: streamResult.usage.outputTokens,
      };
      this.totalTokensUsed += usage.inputTokens + usage.outputTokens;
      this.totalApiCalls += 1;

      if (fullText) {
        this.addToHistory('assistant', fullText);
      }

      callbacks.onComplete?.({ text: fullText, toolCalls, usage, stopReason: streamResult.stopReason });
    } catch (error: any) {
      callbacks.onError?.(error instanceof Error ? error : new Error(error.message || 'Stream continuation error'));
    }
  }

  // ==========================================================================
  // HISTORY MANAGEMENT
  // ==========================================================================

  addToHistory(role: 'user' | 'assistant', content: string): void {
    this.conversationHistory.push({ role, content });
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): AIMessage[] {
    return [...this.conversationHistory];
  }

  trimHistory(maxMessages: number): void {
    if (this.conversationHistory.length <= maxMessages) {
      return;
    }

    if (this.conversationHistory.length > maxMessages + 2) {
      const firstTwo = this.conversationHistory.slice(0, 2);
      const recent = this.conversationHistory.slice(-(maxMessages - 2));
      this.conversationHistory = [...firstTwo, ...recent];
    } else {
      this.conversationHistory = this.conversationHistory.slice(-maxMessages);
    }
  }

  getHistoryLength(): number {
    return this.conversationHistory.length;
  }

  // ==========================================================================
  // METRICS
  // ==========================================================================

  getMetrics(): {
    totalTokens: number;
    totalCalls: number;
    avgTokensPerCall: number;
  } {
    return {
      totalTokens: this.totalTokensUsed,
      totalCalls: this.totalApiCalls,
      avgTokensPerCall: this.totalApiCalls > 0
        ? Math.round(this.totalTokensUsed / this.totalApiCalls)
        : 0,
    };
  }

  resetMetrics(): void {
    this.totalTokensUsed = 0;
    this.totalApiCalls = 0;
  }

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  getConfig(): AIServiceConfig {
    return { ...this.config };
  }

  setSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
  }

  updateConfig(updates: Partial<AIServiceConfig>): void {
    Object.assign(this.config, updates);
  }

  // ==========================================================================
  // STATIC FACTORY METHODS
  // ==========================================================================

  static createForPod(pod: AgentPod): AIService {
    const rolePrompt = ROLE_SYSTEM_PROMPTS[pod.role] || '';

    const systemPrompt = [
      rolePrompt,
      pod.modelConfig.systemPrompt || '',
      `\nPod ID: ${pod.id}`,
      `Pod Name: ${pod.name}`,
      `TBWO ID: ${pod.tbwoId}`,
      `\nYou are working as part of a multi-pod team. Stay focused on your role and communicate results clearly.`,
    ].filter(Boolean).join('\n\n');

    return new AIService({
      provider: pod.modelConfig.provider || 'anthropic',
      model: pod.modelConfig.model || AIService.getDefaultModel(),
      temperature: pod.modelConfig.temperature ?? 0.7,
      maxTokens: pod.modelConfig.maxTokens ?? 8192,
      systemPrompt,
    });
  }

  static createForRole(role: PodRole, overrides?: Partial<AIServiceConfig>): AIService {
    const rolePrompt = ROLE_SYSTEM_PROMPTS[role] || '';

    return new AIService({
      provider: overrides?.provider || 'anthropic',
      model: overrides?.model || AIService.getDefaultModel(),
      temperature: overrides?.temperature ?? 0.7,
      maxTokens: overrides?.maxTokens ?? 8192,
      systemPrompt: rolePrompt + (overrides?.systemPrompt ? '\n\n' + overrides.systemPrompt : ''),
    });
  }

  static getDefaultModel(): string {
    try {
      const selectedVersions = useSettingsStore.getState().selectedModelVersions;
      return selectedVersions.claude || 'claude-sonnet-4-5-20250929';
    } catch {
      return 'claude-sonnet-4-5-20250929';
    }
  }

  static getDefaultProvider(): string {
    try {
      const modelMode = useSettingsStore.getState().modelMode;
      if (modelMode === 'gpt') return 'openai';
      return 'anthropic';
    } catch {
      return 'anthropic';
    }
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  private createErrorResponse(errorMessage: string): AIResponse {
    return {
      text: `[Error] ${errorMessage}`,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      stopReason: 'error',
    };
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export function createDefaultAIService(systemPrompt?: string): AIService {
  return new AIService({
    provider: AIService.getDefaultProvider(),
    model: AIService.getDefaultModel(),
    systemPrompt: systemPrompt || '',
  });
}

export async function quickQuery(
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const service = createDefaultAIService(systemPrompt);
  const response = await service.sendMessage(prompt);
  return response.text;
}
