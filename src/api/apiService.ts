/**
 * Unified API Service - Central API Integration Hub
 *
 * All AI streaming goes through the server proxy (/api/chat/stream, /api/chat/continue).
 * API keys never touch the browser. Tool execution remains client-side.
 *
 * Features:
 * - Server-proxied streaming (SSE)
 * - Tool execution loop (client-side, tools call backend endpoints)
 * - Provider abstraction (Claude / OpenAI — server decides)
 * - Intent detection (direct vs sprint mode)
 * - Context management (compression, memory, project context)
 * - Confidence scoring
 */

import { streamFromServer, type ServerStreamResult } from './serverStreamClient';
import { BraveSearchClient, createBraveSearchClient } from './braveSearch';
import { FileUploadHandler, createFileUploadHandler, type ProcessedFile } from './fileHandler';
import { WebSocketManager, initializeWebSocket } from './websocket';
import { prepareMessages, compressToolResultContent } from './contextManager';

import { ModelProvider, MessageRole } from '../types/chat';
import type { Message, ContentBlock } from '../types/chat';
import { ALIN_SYSTEM_PROMPT, ALIN_TOOLS, DIRECT_MODE_SYSTEM_PROMPT, executeAlinTool } from './alinSystemPrompt';
import { detectIntent, type TaskIntent } from './intentDetector';
import { useStatusStore, type ToolActivityType } from '../store/statusStore';
import { useSettingsStore } from '../store/settingsStore';
import { useModeStore } from '../store/modeStore';
import { getModeConfig } from '../config/modes';
import { useMemoryStore } from '../store/memoryStore';
import { getProjectContextForPrompt } from '../store/projectStore';
import { CLAUDE_PRICING } from './claudeClient';
import { getCapabilitiesSnapshot } from '../hooks/useCapabilities';
import { buildAddendum as buildSelfModelAddendum, onThinkingBlock, onToolCall as recordToolCall } from '../services/selfModelService';

// Claude specialized tool definitions (passed to server as tool configs)
const COMPUTER_USE_TOOL = {
  type: 'computer_20250124' as const,
  name: 'computer' as const,
  display_width_px: 1280,
  display_height_px: 800,
  display_number: 1,
};

const TEXT_EDITOR_TOOL = {
  type: 'text_editor_20250124' as const,
  name: 'str_replace_editor' as const,
};

// ============================================================================
// MEMORY CONTEXT INJECTION
// ============================================================================

function getMemoryContext(): string {
  try {
    const memStore = useMemoryStore.getState();
    const totalMemories = memStore.memories.size;
    if (totalMemories === 0) return '';

    const allMemories = Array.from(memStore.memories.values());
    const sorted = allMemories
      .sort((a: any, b: any) => (b.salience || 0) - (a.salience || 0))
      .slice(0, 10);

    if (sorted.length === 0) return '';

    const feedbackMemories = allMemories
      .filter((m: any) => m.tags?.includes('user-feedback'))
      .sort((a: any, b: any) => (b.salience || 0) - (a.salience || 0))
      .slice(0, 5);

    const generalMemories = sorted.filter(
      (m: any) => !m.tags?.includes('user-feedback')
    );

    const sections: string[] = [];
    sections.push(`\n\n## STORED MEMORIES (from previous conversations)\nYou have ${totalMemories} memories stored.`);

    if (feedbackMemories.length > 0) {
      sections.push(`\n### USER FEEDBACK — ADAPT YOUR BEHAVIOR\nThe user has rated your past responses. Learn from this:\n${feedbackMemories.map((m: any) => `- ${m.content}`).join('\n')}`);
    }

    if (generalMemories.length > 0) {
      sections.push(`\n### Key Memories\n${generalMemories.map((m: any) => {
        const tags = m.tags?.length ? ` [${m.tags.join(', ')}]` : '';
        return `- ${m.content}${tags}`;
      }).join('\n')}`);
    }

    sections.push('\nUse these to personalize your responses. Call memory_recall for more specific searches. Call memory_store to save new information from this conversation.');

    return sections.join('');
  } catch {
    return '';
  }
}

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

import type { ConfidenceSignals } from '../types/chat';

const HEDGING_PATTERNS = /\b(i think|i believe|probably|possibly|might be|may be|not sure|uncertain|it seems|could be|i'm guessing|approximately|roughly|hard to say)\b/i;

function computeConfidence(
  responseText: string,
  stopReason: string,
  usedTools: boolean,
  hasCode: boolean,
): { score: number; signals: ConfidenceSignals } {
  const hasHedging = HEDGING_PATTERNS.test(responseText);
  const signals: ConfidenceSignals = {
    hasHedging,
    hasToolUse: usedTools,
    hasCodeOutput: hasCode,
    responseLength: responseText.length,
    stopReason,
  };

  let score = 0.75;
  if (usedTools) score += 0.10;
  if (hasCode) score += 0.05;
  if (hasHedging) score -= 0.15;
  if (responseText.length < 50 && !hasCode) score -= 0.10;
  if (stopReason === 'max_tokens') score -= 0.15;
  if (responseText.length > 500) score += 0.05;

  return { score: Math.max(0.1, Math.min(1.0, score)), signals };
}

// ============================================================================
// TYPES
// ============================================================================

export interface APIServiceConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  braveApiKey?: string;
  wsUrl?: string;
  defaultProvider?: ModelProvider;
}

// Response type returned by the server proxy, matching what downstream expects
export interface ServerResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: number;
  confidence?: number;
  confidenceSignals?: ConfidenceSignals;
  // Keep compatibility with OpenAIResponse shape
  finishReason?: string;
}

export interface StreamCallback {
  onStart?: () => void;
  onChunk?: (chunk: string) => void;
  onThinking?: (thinking: string) => void;
  onToolStart?: (activityId: string, toolName: string) => void;
  onImageGenerated?: (url: string, prompt: string, revisedPrompt?: string) => void;
  onFileGenerated?: (filename: string, content: string, language: string) => void;
  onComplete?: (response: ServerResponse) => void;
  onError?: (error: Error) => void;
}

export interface ToolCall {
  name: string;
  arguments: any;
}

// ============================================================================
// MESSAGE CONVERSION (for server proxy)
// ============================================================================

/**
 * Convert our internal Message[] format to the raw format the server expects.
 * The server passes messages directly to Claude/OpenAI APIs.
 */
function convertMessagesForServer(
  messages: Message[],
  toolResults?: Array<{ toolUseId: string; content: string; isError: boolean }>
): Array<{ role: string; content: any }> {
  const converted = messages.map((msg, index) => {
    const isLastMessage = index === messages.length - 1;
    const isAssistantWithToolUse = msg.role === MessageRole.ASSISTANT &&
      msg.content.some((block) => block.type === 'tool_use');

    const shouldKeepToolBlocks = toolResults && toolResults.length > 0 && isLastMessage && isAssistantWithToolUse;

    let contentToConvert = msg.content;
    if (!shouldKeepToolBlocks) {
      const filteredContent = msg.content.filter(
        (block) => block.type !== 'tool_use' && block.type !== 'tool_result' &&
          block.type !== 'thinking' && block.type !== 'redacted_thinking' &&
          block.type !== 'tool_activity' &&
          !(block.type === 'image' && msg.role !== MessageRole.USER)
      );
      contentToConvert = filteredContent.length > 0
        ? filteredContent
        : [{ type: 'text' as const, text: '[Previous response used tools]' }];
    }

    return {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: convertContentBlocks(contentToConvert),
    };
  });

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

function convertContentBlocks(blocks: ContentBlock[]): any[] {
  return blocks.map((block: any) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'image':
        if (block.url?.startsWith('data:')) {
          const match = block.url.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
          }
        }
        return { type: 'image', source: { type: 'url', url: block.url } };
      case 'tool_use':
        return { type: 'tool_use', id: block.toolUseId, name: block.toolName, input: block.toolInput };
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: block.toolUseId, content: block.result, is_error: block.isError || false };
      case 'thinking':
        return { type: 'thinking', thinking: block.content, ...(block.signature ? { signature: block.signature } : {}) };
      case 'redacted_thinking':
        return { type: 'redacted_thinking', data: block.data };
      case 'tool_activity':
        return null; // UI-only, not sent to API
      default:
        return { type: 'text', text: JSON.stringify(block) };
    }
  }).filter(Boolean);
}

// ============================================================================
// TOOL ACTIVITY HELPERS
// ============================================================================

function getToolActivityType(toolName: string): ToolActivityType {
  if (toolName === 'generate_image') return 'other';
  if (toolName === 'scan_directory') return 'directory_scan';
  if (toolName === 'code_search') return 'code_search';
  if (toolName === 'run_command') return 'terminal_command';
  if (toolName === 'git') return 'git_operation';
  if (toolName === 'edit_file') return 'file_edit';
  if (toolName.includes('search') || toolName.includes('web')) return 'web_search';
  if (toolName.includes('memory') && toolName.includes('recall')) return 'memory_recall';
  if (toolName.includes('memory') && toolName.includes('store')) return 'memory_store';
  if (toolName.includes('code') || toolName.includes('execute')) return 'code_execute';
  if (toolName.includes('read') || toolName.includes('file')) return 'file_read';
  if (toolName.includes('write')) return 'file_write';
  if (toolName === 'computer') return 'other';
  if (toolName === 'str_replace_editor') return 'file_write';
  return 'other';
}

function getToolLabel(toolName: string, input?: Record<string, unknown>): string {
  if (toolName.includes('search') || toolName.includes('web')) {
    const query = input?.['query'] as string;
    return query ? `Searching: "${query.slice(0, 50)}${query.length > 50 ? '...' : ''}"` : 'Searching the web';
  }
  if (toolName.includes('memory') && toolName.includes('recall')) {
    const query = input?.['query'] as string;
    return query ? `Searching memory: "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}"` : 'Searching memory';
  }
  if (toolName.includes('memory') && toolName.includes('store')) {
    const content = input?.['content'] as string;
    return content ? `Storing memory: "${content.slice(0, 40)}${content.length > 40 ? '...' : ''}"` : 'Storing to memory';
  }
  if (toolName.includes('code') || toolName.includes('execute')) {
    const lang = input?.['language'] as string;
    return lang ? `Executing ${lang} code` : 'Executing code';
  }
  if (toolName === 'file_list') {
    const path = input?.['path'] as string;
    const shortPath = path ? path.split(/[/\\]/).slice(-2).join('/') : '';
    return shortPath ? `Listing: ${shortPath}` : 'Listing directory';
  }
  if (toolName.includes('read') || toolName === 'file_read') {
    const path = input?.['path'] as string;
    const filename = path ? path.split(/[/\\]/).pop() : '';
    return filename ? `Reading: ${filename}` : 'Reading file';
  }
  if (toolName.includes('write') || toolName === 'file_write') {
    const path = input?.['path'] as string;
    const filename = path ? path.split(/[/\\]/).pop() : '';
    return filename ? `Writing: ${filename}` : 'Writing file';
  }
  if (toolName === 'computer') {
    const action = input?.['action'] as string;
    return action ? `Computer: ${action}` : 'Using computer';
  }
  if (toolName === 'str_replace_editor') {
    const command = input?.['command'] as string;
    const path = input?.['path'] as string;
    const filename = path ? path.split(/[/\\]/).pop() : '';
    return command ? `Editor: ${command}${filename ? ` ${filename}` : ''}` : 'Using text editor';
  }
  if (toolName === 'generate_image') {
    const prompt = input?.['prompt'] as string;
    return prompt ? `Generating image: "${prompt.slice(0, 40)}${prompt.length > 40 ? '...' : ''}"` : 'Generating image';
  }
  if (toolName === 'scan_directory') {
    const scanPath = input?.['path'] as string;
    const shortPath = scanPath ? scanPath.split(/[/\\]/).slice(-2).join('/') : '';
    return shortPath ? `Scanning: ${shortPath}` : 'Scanning directory';
  }
  if (toolName === 'code_search') {
    const query = input?.['query'] as string;
    return query ? `Searching code: "${query.slice(0, 40)}${query.length > 40 ? '...' : ''}"` : 'Searching code';
  }
  if (toolName === 'run_command') {
    const cmd = input?.['command'] as string;
    return cmd ? `Running: ${cmd.slice(0, 50)}${cmd.length > 50 ? '...' : ''}` : 'Running command';
  }
  if (toolName === 'git') {
    const op = input?.['operation'] as string;
    const args = input?.['args'] as string[];
    return op ? `Git: ${op}${args?.length ? ' ' + args.slice(0, 2).join(' ') : ''}` : 'Git operation';
  }
  if (toolName === 'edit_file') {
    const editPath = input?.['path'] as string;
    const filename = editPath ? editPath.split(/[/\\]/).pop() : '';
    return filename ? `Editing: ${filename}` : 'Editing file';
  }
  return `Using ${toolName}`;
}

// ============================================================================
// UNIFIED API SERVICE CLASS
// ============================================================================

export class APIService {
  public braveClient?: BraveSearchClient;
  private fileHandler: FileUploadHandler;
  private wsManager?: WebSocketManager;

  constructor(config: APIServiceConfig) {
    console.log('[APIService] Constructing (server-side streaming mode)...');

    if (config.braveApiKey) {
      this.braveClient = createBraveSearchClient(config.braveApiKey);
    }

    this.fileHandler = createFileUploadHandler();

    if (config.wsUrl) {
      this.wsManager = initializeWebSocket({
        url: config.wsUrl,
        debug: import.meta.env.DEV,
      });
    }

    console.log('[APIService] Construction complete');
  }

  // ==========================================================================
  // MAIN MESSAGE SENDING (via server proxy)
  // ==========================================================================

  /**
   * Send a message with streaming — all AI calls route through the server.
   * Tool execution remains client-side; AI continuation goes through /api/chat/continue.
   */
  async sendMessageStream(
    messages: Message[],
    provider: ModelProvider = ModelProvider.ANTHROPIC,
    callbacks: StreamCallback = {}
  ): Promise<void> {
    try {
      callbacks.onStart?.();

      const settings = useSettingsStore.getState();
      const modeConfig = getModeConfig(useModeStore.getState().currentMode);

      // Build tools list, filtered by capabilities
      const caps = getCapabilitiesSnapshot();
      const allTools: any[] = [...ALIN_TOOLS];
      if (settings.enableComputerUse || modeConfig.features.autoEnableComputerUse) {
        allTools.push(COMPUTER_USE_TOOL);
      }
      if (settings.enableTextEditor || modeConfig.features.autoEnableTextEditor) {
        allTools.push(TEXT_EDITOR_TOOL);
      }

      // Filter tools based on capabilities — prevents Claude from trying unavailable tools
      const tools = allTools.filter(tool => {
        const name = tool.name;
        if (['file_read', 'file_write', 'file_list', 'scan_directory', 'edit_file'].includes(name)) return caps.canFileExplore;
        if (['execute_code', 'run_command'].includes(name)) return caps.canExecuteCode;
        if (name === 'git') return caps.canGitOps;
        if (['computer', 'str_replace_editor'].includes(name)) return caps.canComputerUse;
        if (name === 'generate_image') return caps.canImageGen;
        if (name === 'tbwo_create') return caps.canTBWO;
        return true; // web_search, memory_store, memory_recall, system_status
      });

      // Detect intent (direct mode vs sprint mode)
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      const lastUserText = lastUserMsg?.content
        ?.filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('') || '';
      const intent: TaskIntent = detectIntent(lastUserText, messages);

      // Build system prompt
      const memoryContext = getMemoryContext();
      const projectContext = getProjectContextForPrompt();
      let systemPrompt = (modeConfig.systemPromptAddition
        ? ALIN_SYSTEM_PROMPT + '\n' + modeConfig.systemPromptAddition
        : ALIN_SYSTEM_PROMPT) + projectContext + memoryContext;

      if (intent === 'direct') {
        systemPrompt += DIRECT_MODE_SYSTEM_PROMPT;
      }

      // Inject self-model dynamic addendum (non-blocking)
      try {
        const selfModelAddendum = await buildSelfModelAddendum();
        if (selfModelAddendum) {
          systemPrompt += '\n' + selfModelAddendum;
        }
      } catch {
        // Non-critical — proceed without addendum
      }

      // Determine provider string and model for the server
      const isAnthropic = provider === ModelProvider.ANTHROPIC;
      const providerStr = isAnthropic ? 'anthropic' : 'openai';
      const selectedVersions = settings.selectedModelVersions;
      const model = isAnthropic
        ? (selectedVersions.claude || 'claude-sonnet-4-5-20250929')
        : (selectedVersions.gpt || 'gpt-4o');
      const enableThinking = isAnthropic && settings.enableThinking;
      const thinkingBudget = settings.thinkingBudget || 10000;

      // Compress context
      const contextMessages = prepareMessages(messages);

      // Convert to server format
      const serverMessages = convertMessagesForServer(contextMessages);

      // Track tool uses and thinking content
      const pendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      const statusStore = useStatusStore.getState();
      let accumulatedThinking = '';

      // Stream from server
      let result = await streamFromServer({
        endpoint: '/api/chat/stream',
        body: {
          provider: providerStr,
          model,
          messages: serverMessages,
          system: systemPrompt,
          tools,
          thinking: enableThinking,
          thinkingBudget,
          maxTokens: settings.model?.maxTokens || 8192,
        },
        callbacks: {
          onText: (text) => callbacks.onChunk?.(text),
          onThinking: (thinking) => {
            accumulatedThinking += thinking;
            callbacks.onThinking?.(thinking);
          },
          onToolUse: (tool) => {
            console.log('[APIService] Tool use detected:', tool.name);
            pendingToolUses.push(tool);

            const activityId = statusStore.startToolActivity(
              getToolActivityType(tool.name),
              getToolLabel(tool.name, tool.input),
              tool.input
            );
            callbacks.onToolStart?.(activityId, tool.name);
          },
          onError: (error) => callbacks.onError?.(error),
        },
      });

      // If there were tool uses, execute them and continue
      if (pendingToolUses.length > 0) {
        const toolResults = await this.executeTools(pendingToolUses, callbacks, statusStore);

        statusStore.setPhase('analyzing', 'Processing tool results...');

        // Recursive continuation for multi-turn tool use
        const MAX_TOOL_DEPTH = 50;

        const handleContinuation = async (
          currentContentBlocks: ContentBlock[],
          currentToolResults: Array<{ toolUseId: string; content: string; isError: boolean }>,
          depth: number = 0
        ): Promise<ServerStreamResult> => {
          const newPendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          let isFirstTextInRound = true;

          // Build messages for continuation: original messages + assistant content + tool results
          const continuationMessages = convertMessagesForServer(
            contextMessages,
            // No toolResults here — we append them as separate user message below
          );

          // Add assistant message with tool_use content blocks
          continuationMessages.push({
            role: 'assistant',
            content: convertContentBlocks(currentContentBlocks),
          });

          // Add tool results as user message
          continuationMessages.push({
            role: 'user',
            content: currentToolResults.map(r => ({
              type: 'tool_result',
              tool_use_id: r.toolUseId,
              content: r.content,
              is_error: r.isError,
            })),
          });

          const continuationResult = await streamFromServer({
            endpoint: '/api/chat/continue',
            body: {
              provider: providerStr,
              model,
              messages: continuationMessages,
              system: systemPrompt,
              tools,
              thinking: enableThinking,
              thinkingBudget,
              maxTokens: settings.model?.maxTokens || 8192,
            },
            callbacks: {
              onText: (text) => {
                if (isFirstTextInRound && depth > 0) {
                  callbacks.onChunk?.('\n\n');
                  isFirstTextInRound = false;
                }
                callbacks.onChunk?.(text);
              },
              onThinking: (thinking) => callbacks.onThinking?.(thinking),
              onToolUse: (tool) => {
                if (depth < MAX_TOOL_DEPTH) {
                  console.log('[APIService] Continuation tool use:', tool.name, `(depth: ${depth + 1})`);
                  newPendingToolUses.push(tool);

                  const activityId = statusStore.startToolActivity(
                    getToolActivityType(tool.name),
                    getToolLabel(tool.name, tool.input),
                    tool.input
                  );
                  callbacks.onToolStart?.(activityId, tool.name);
                } else {
                  console.warn('[APIService] Max tool depth reached, ignoring tool:', tool.name);
                }
              },
              onError: (error) => callbacks.onError?.(error),
            },
          });

          if (newPendingToolUses.length > 0 && depth < MAX_TOOL_DEPTH) {
            const newToolResults = await this.executeTools(newPendingToolUses, callbacks, statusStore);

            statusStore.setPhase('analyzing', 'Processing additional tool results...');

            const delay = Math.min(2000 + depth * 500, 5000);
            await new Promise(resolve => setTimeout(resolve, delay));

            return handleContinuation(continuationResult.content, newToolResults, depth + 1);
          }

          return continuationResult;
        };

        result = await handleContinuation(result.content, toolResults, 0);
      }

      // Build response object for onComplete
      const responseText = result.content
        ?.filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('') || '';
      const usedTools = result.content?.some((b: any) => b.type === 'tool_use') || pendingToolUses.length > 0;
      const hasCode = /```[\s\S]{10,}```/.test(responseText);
      const { score: confidenceScore, signals: confidenceSignals } = computeConfidence(
        responseText, result.stopReason || 'end_turn', usedTools, hasCode
      );

      // Estimate cost from usage
      const pricing = CLAUDE_PRICING[model] || CLAUDE_PRICING['claude-sonnet-4-5-20250929'];
      const cost = pricing
        ? (result.usage.inputTokens / 1_000_000) * pricing.input + (result.usage.outputTokens / 1_000_000) * pricing.output
        : 0;

      const response: ServerResponse = {
        id: `msg_${Date.now()}`,
        content: result.content,
        model,
        stopReason: result.stopReason,
        finishReason: result.stopReason,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.inputTokens + result.usage.outputTokens,
        },
        cost,
        confidence: confidenceScore,
        confidenceSignals,
      };

      // Store thinking trace if we captured any thinking content
      if (accumulatedThinking.length > 0) {
        const convId = messages[0]?.conversationId || '';
        const msgId = response.id || '';
        onThinkingBlock(convId, msgId, accumulatedThinking).catch(() => {});
      }

      callbacks.onComplete?.(response);
    } catch (error: any) {
      console.error('[APIService] Stream error:', error);
      callbacks.onError?.(error);
    }
  }

  /**
   * Execute tools and return results formatted for continuation.
   */
  private async executeTools(
    toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>,
    callbacks: StreamCallback,
    statusStore: ReturnType<typeof useStatusStore.getState>,
  ): Promise<Array<{ toolUseId: string; content: string; isError: boolean }>> {
    return Promise.all(
      toolUses.map(async (tool) => {
        const toolStart = Date.now();
        const result = await executeAlinTool(tool.name, tool.input);
        console.log('[APIService] Tool result:', tool.name, result.success);

        // Record tool reliability (fire-and-forget)
        recordToolCall(tool.name, result.success, Date.now() - toolStart, result.success ? undefined : result.error).catch(() => {});

        // Detect generated images
        if (tool.name === 'generate_image' && result.success && result.result) {
          try {
            const parsed = JSON.parse(result.result);
            if (parsed.url) {
              callbacks.onImageGenerated?.(parsed.url, (tool.input as any)?.prompt || '', parsed.revised_prompt);
            }
          } catch { /* not JSON */ }
        }

        // Detect file writes
        if (tool.name === 'file_write' && result.success) {
          const path = (tool.input?.['path'] as string) || 'file';
          const content = (tool.input?.['content'] as string) || '';
          const ext = path.split('.').pop() || 'text';
          callbacks.onFileGenerated?.(path, content, ext);
        }

        // Update tool activity status
        const activityId = useStatusStore.getState().toolActivities.find(
          (a) => a.status === 'running' && a.label === getToolLabel(tool.name, tool.input)
        )?.id || useStatusStore.getState().toolActivities.find(
          (a) => a.status === 'running'
        )?.id;

        if (activityId) {
          if (result.success) {
            let parsedResults: any[] | undefined;
            if (result.result && typeof result.result === 'string') {
              const urlMatches = result.result.match(/https?:\/\/[^\s\)]+/g);
              if (urlMatches) {
                parsedResults = urlMatches.slice(0, 10).map((url) => ({
                  url,
                  title: url.split('/').pop() || url,
                }));
              }
            }
            statusStore.completeToolActivity(activityId, parsedResults, parsedResults?.length, result.result);
          } else {
            statusStore.failToolActivity(activityId, result.error || 'Unknown error');
          }
        }

        const rawContent = result.success ? result.result || 'Done' : `Error: ${result.error}`;
        return {
          toolUseId: tool.id,
          content: result.success ? compressToolResultContent(rawContent, tool.name) : rawContent,
          isError: !result.success,
        };
      })
    );
  }

  // ==========================================================================
  // FILE HANDLING
  // ==========================================================================

  async processFiles(files: File[]): Promise<ProcessedFile[]> {
    return this.fileHandler.processFiles(files);
  }

  async processFile(file: File): Promise<ProcessedFile> {
    return this.fileHandler.processFile(file);
  }

  // ==========================================================================
  // WEBSOCKET
  // ==========================================================================

  connectWebSocket(): void {
    this.wsManager?.connect();
  }

  disconnectWebSocket(): void {
    this.wsManager?.disconnect();
  }

  onWebSocketMessage(callback: (message: any) => void): void {
    this.wsManager?.on('message', callback);
  }

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  getAvailableProviders(): ModelProvider[] {
    // Both providers are available through the server proxy
    return [ModelProvider.ANTHROPIC, ModelProvider.OPENAI];
  }

  isProviderAvailable(_provider: ModelProvider): boolean {
    // Both providers are available through the server proxy
    return true;
  }
}

// ============================================================================
// SINGLETON INSTANCE (preserved across hot reloads)
// ============================================================================

declare global {
  interface Window {
    __ALIN_API_SERVICE__?: APIService | null;
  }
}

let apiService: APIService | null = typeof window !== 'undefined' ? window.__ALIN_API_SERVICE__ || null : null;

export function getAPIService(): APIService {
  console.log('[APIService] getAPIService called, service exists:', !!apiService);
  if (!apiService) {
    throw new Error('API Service not initialized. Call initializeAPIService first.');
  }
  return apiService;
}

export function initializeAPIService(config: APIServiceConfig): APIService {
  console.log('[APIService] initializeAPIService called');

  if (apiService) {
    console.log('[APIService] Service already initialized, returning existing instance');
    return apiService;
  }

  apiService = new APIService(config);

  if (typeof window !== 'undefined') {
    window.__ALIN_API_SERVICE__ = apiService;
  }

  console.log('[APIService] initializeAPIService complete, service exists:', !!apiService);
  return apiService;
}

export function isAPIServiceInitialized(): boolean {
  return !!apiService;
}

/**
 * Generate a short summarizing title for a conversation.
 * Routes through the server proxy — no API keys in browser.
 */
export async function generateChatTitle(userMessage: string): Promise<string> {
  try {
    if (!apiService) return userMessage.slice(0, 50);

    const settings = useSettingsStore.getState();
    const isGPT = settings.modelMode === 'gpt';

    const model = isGPT ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001';
    const provider = isGPT ? 'openai' : 'anthropic';

    const titleMessages = [
      {
        role: 'user',
        content: isGPT
          ? userMessage.slice(0, 500)
          : `Generate a concise 3-6 word title summarizing this message. Reply with only the title:\n\n${userMessage.slice(0, 500)}`,
      },
    ];

    const systemPrompt = isGPT
      ? 'Generate a concise 3-6 word title summarizing the user message. Reply with only the title, no quotes or punctuation.'
      : undefined;

    let title = '';

    await streamFromServer({
      endpoint: '/api/chat/stream',
      body: {
        provider,
        model,
        messages: titleMessages,
        system: systemPrompt,
        maxTokens: 20,
      },
      callbacks: {
        onText: (text) => { title += text; },
      },
    });

    return title.trim() || userMessage.slice(0, 50);
  } catch (err) {
    console.error('[ALIN] Title generation failed:', err);
    return userMessage.slice(0, 50);
  }
}
