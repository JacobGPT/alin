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
// Removed: BraveSearchClient, FileUploadHandler, WebSocketManager (dead modules)
import { prepareMessages, compressToolResultContent } from './contextManager';

import { ModelProvider, MessageRole } from '../types/chat';
import type { Message, ContentBlock } from '../types/chat';
import { ALIN_TOOLS, executeAlinTool } from './alinSystemPrompt';
import { useStatusStore, type ToolActivityType } from '../store/statusStore';
import { useSettingsStore } from '../store/settingsStore';
import { useModeStore } from '../store/modeStore';
import { getModeConfig } from '../config/modes';
import { useMemoryStore } from '../store/memoryStore';
import { getProjectContextForPrompt } from '../store/projectStore';
import { CLAUDE_PRICING } from './claudeClient';
import { getCapabilitiesSnapshot } from '../hooks/useCapabilities';
import { buildAddendum as buildSelfModelAddendum, onThinkingBlock, onToolCall as recordToolCall } from '../services/selfModelService';
import { useChatStore } from '../store/chatStore';

// Auto-continuation instruction sent when response is truncated
const CONTINUATION_INSTRUCTION = `Your previous response was cut off due to length limits. Continue EXACTLY where you left off. Do not repeat any content. Do not add introductory text like "Continuing from where I left off..." — just continue the output seamlessly. If you were inside a code block, resume the code immediately.`;

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

    sections.push('\nUse these to personalize responses when relevant. Only call memory tools when the conversation warrants it — not for casual greetings.');

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
  onModeHint?: (hint: { suggestedMode: string; confidence: number; reason: string }) => void;
  onImageGenerated?: (url: string, prompt: string, revisedPrompt?: string) => void;
  onFileGenerated?: (filename: string, content: string, language: string) => void;
  onVideoEmbed?: (video: { url: string; embed_url: string; platform: string; title?: string; thumbnail?: string; timestamp?: number }) => void;
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
  const converted = blocks.map((block: any) => {
    switch (block.type) {
      case 'text':
        // Skip empty text blocks — Claude API rejects them
        if (!block.text) return null;
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
        return {
          type: 'tool_use', id: block.toolUseId, name: block.toolName, input: block.toolInput,
          ...(block.thought_signature ? { thought_signature: block.thought_signature } : {}),
        };
      case 'tool_result':
        return { type: 'tool_result', tool_use_id: block.toolUseId, content: block.result, is_error: block.isError || false };
      case 'thinking':
        return { type: 'thinking', thinking: block.content, ...(block.signature ? { signature: block.signature } : {}) };
      case 'redacted_thinking':
        return { type: 'redacted_thinking', data: block.data };
      case 'tool_activity':
        return null; // UI-only, not sent to API
      case 'video_embed':
        return null; // UI-only, not sent to API
      case 'file':
        return null; // UI-only, not sent to API
      default:
        return { type: 'text', text: JSON.stringify(block) };
    }
  }).filter(Boolean);
  // Ensure at least one content block per message
  if (converted.length === 0) {
    return [{ type: 'text', text: '[empty message]' }];
  }
  return converted;
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
  if (toolName === 'web_fetch') return 'web_fetch';
  if (toolName === 'web_search' || toolName === 'image_search') return 'web_search';
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
  // web_fetch must be checked BEFORE the generic includes('web') to avoid mislabeling
  if (toolName === 'web_fetch') {
    const url = input?.['url'] as string;
    if (url) {
      try {
        const hostname = new URL(url).hostname;
        const pathname = new URL(url).pathname;
        const shortPath = pathname.length > 20 ? pathname.slice(0, 20) + '...' : pathname;
        return `Fetching: ${hostname}${shortPath !== '/' ? shortPath : ''}`;
      } catch {
        return `Fetching: ${url.slice(0, 50)}${url.length > 50 ? '...' : ''}`;
      }
    }
    return 'Fetching URL';
  }
  if (toolName === 'web_search' || toolName === 'image_search') {
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
  if (toolName === 'gpu_compute') return 'Running GPU computation';
  if (toolName === 'webcam_capture') return 'Capturing webcam frame';
  if (toolName === 'blender_execute') return 'Executing Blender script';
  if (toolName === 'blender_render') return 'Rendering in Blender';
  return `Using ${toolName}`;
}

// ============================================================================
// UNIFIED API SERVICE CLASS
// ============================================================================

export class APIService {
  private currentAbort: AbortController | null = null;
  private cancelled = false;

  constructor(config: APIServiceConfig) {
    console.log('[APIService] Constructing (server-side streaming mode)...');
    console.log('[APIService] Construction complete');
  }

  /**
   * Cancel any in-progress streaming request
   */
  cancel(): void {
    this.cancelled = true;
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
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
      this.cancelled = false;
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
        if (name === 'gpu_compute') return caps.isApp; // GPU compute requires local hardware
        if (name === 'webcam_capture') return caps.canComputerUse;
        if (['blender_execute', 'blender_render'].includes(name)) return caps.canBlender;
        if (name === 'system_status') return caps.canHardwareMonitor; // Only on local — server metrics aren't user hardware
        return true; // web_search, web_fetch, memory_store, memory_recall, code_search
      });

      // Build additional context (local-only data server doesn't have)
      const experimental = useSettingsStore.getState().experimental;
      const memoryContext = experimental.enableMemory ? getMemoryContext() : '';
      const projectContext = getProjectContextForPrompt();
      let additionalContext = projectContext + memoryContext;

      // Inject self-model dynamic addendum (non-blocking)
      try {
        const selfModelAddendum = await buildSelfModelAddendum();
        if (selfModelAddendum) {
          additionalContext += '\n' + selfModelAddendum;
        }
      } catch {
        // Non-critical — proceed without addendum
      }

      const currentMode = useModeStore.getState().currentMode;

      // Determine provider string and model for the server
      const isAnthropic = provider === ModelProvider.ANTHROPIC;
      const isGemini = (provider as any) === 'gemini';
      const isDeepSeek = (provider as any) === 'deepseek';
      const providerStr = isGemini ? 'gemini' : isDeepSeek ? 'deepseek' : isAnthropic ? 'anthropic' : 'openai';
      const selectedVersions = settings.selectedModelVersions;
      const model = isGemini
        ? (selectedVersions.gemini || 'gemini-2.5-flash')
        : isDeepSeek
        ? (selectedVersions.deepseek || 'deepseek-chat')
        : isAnthropic
        ? (selectedVersions.claude || 'claude-sonnet-4-5-20250929')
        : (selectedVersions.gpt || 'gpt-4o');
      const enableThinking = (isAnthropic && settings.enableThinking) || (isDeepSeek && model === 'deepseek-reasoner');
      const thinkingBudget = settings.thinkingBudget || 10000;

      // Compress context
      const contextMessages = prepareMessages(messages);

      // Convert to server format
      const serverMessages = convertMessagesForServer(contextMessages);

      // Check for video context — route to Gemini video analysis endpoint
      const convId = useChatStore.getState().currentConversationId;
      const conversation = convId ? useChatStore.getState().conversations.get(convId) : null;
      const videoCtx = conversation?.videoContext;

      if (videoCtx?.fileUri) {
        // Route through /api/video/analyze — Gemini-only, handles any provider selection
        try {
          const lastUserMsg = messages.filter(m => m.role === 'user').pop();
          const userText = lastUserMsg?.content
            ? (Array.isArray(lastUserMsg.content)
              ? lastUserMsg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
              : String(lastUserMsg.content))
            : 'Analyze this video.';

          // Build conversation history for follow-up context
          const conversationHistory = messages.slice(0, -1)
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map(m => ({
              role: m.role,
              text: Array.isArray(m.content)
                ? m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
                : String(m.content || ''),
            }))
            .filter(m => m.text.trim())
            .slice(-10); // Keep last 10 exchanges for context

          this.currentAbort = new AbortController();
          const videoResult = await streamFromServer({
            endpoint: '/api/video/analyze',
            signal: this.currentAbort.signal,
            body: {
              fileUri: videoCtx.fileUri,
              mimeType: videoCtx.mimeType,
              prompt: userText,
              conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined,
              geminiFileName: videoCtx.geminiFileName,
            },
            callbacks: {
              onText: (text) => callbacks.onChunk?.(text),
              onThinking: (thinking) => callbacks.onThinking?.(thinking),
              onError: (error) => callbacks.onError?.(error),
            },
          });

          const inTok = videoResult.usage?.inputTokens || 0;
          const outTok = videoResult.usage?.outputTokens || 0;
          const response: ServerResponse = {
            id: `video-${Date.now()}`,
            content: videoResult.content || [],
            model: 'gemini-2.5-pro',
            stopReason: videoResult.stopReason || 'end_turn',
            usage: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok },
            cost: 0,
          };
          callbacks.onComplete?.(response);
          return;
        } catch (videoErr: any) {
          // Video analysis failed (file expired, deleted, or endpoint unavailable)
          // Clear stale video context so the conversation isn't permanently stuck
          console.warn('[APIService] Video analysis failed, clearing video context:', videoErr.message);
          if (convId) {
            useChatStore.getState().updateConversation(convId, { videoContext: undefined });
          }
          // Fall through to normal chat flow instead of failing
        }
      }

      // Track tool uses and thinking content
      const pendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
      const statusStore = useStatusStore.getState();
      let accumulatedThinking = '';

      // Stream from server — create abort controller for cancellation
      this.currentAbort = new AbortController();
      let result = await streamFromServer({
        endpoint: '/api/chat/stream',
        signal: this.currentAbort.signal,
        body: {
          provider: providerStr,
          model,
          messages: serverMessages,
          system: '[DEPRECATED]',
          mode: currentMode,
          additionalContext,
          tools,
          thinking: enableThinking,
          thinkingBudget,
          maxTokens: settings.model?.maxTokens || 16384,
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
          onModeHint: (hint) => callbacks.onModeHint?.(hint),
          onVideoEmbed: (video) => callbacks.onVideoEmbed?.(video),
          onError: (error) => callbacks.onError?.(error),
        },
      });

      // If no tool calls but hit max_tokens, auto-continue
      if (pendingToolUses.length === 0) {
        result = await this.handleMaxTokensContinuation(
          result, contextMessages, providerStr, model,
          currentMode, additionalContext,
          tools, enableThinking, thinkingBudget,
          settings.model?.maxTokens || 16384, callbacks,
        );
      }

      // If there were tool uses, execute them and continue
      if (pendingToolUses.length > 0) {
        const toolResults = await this.executeTools(pendingToolUses, callbacks, statusStore);

        statusStore.setPhase('analyzing', 'Processing tool results...');

        // Recursive continuation for multi-turn tool use
        const MAX_TOOL_DEPTH = 25;

        // Circuit breaker: track failed tool calls to prevent infinite loops
        // Seed with initial round failures
        const toolFailureMap = new Map<string, number>(); // "toolName:inputHash" → failure count
        let consecutiveFailures = 0;
        const MAX_CONSECUTIVE_FAILURES = 3;
        const MAX_SAME_TOOL_FAILURES = 2;

        const getToolKey = (name: string, input: Record<string, unknown>) => {
          const inputStr = JSON.stringify(input).slice(0, 200);
          return `${name}:${inputStr}`;
        };

        // Seed failure map from initial round
        for (let i = 0; i < pendingToolUses.length; i++) {
          if (toolResults[i]?.isError) {
            const key = getToolKey(pendingToolUses[i].name, pendingToolUses[i].input);
            toolFailureMap.set(key, (toolFailureMap.get(key) || 0) + 1);
          }
        }

        const handleContinuation = async (
          currentContentBlocks: ContentBlock[],
          currentToolResults: Array<{ toolUseId: string; content: string; isError: boolean }>,
          depth: number = 0
        ): Promise<ServerStreamResult> => {
          const newPendingToolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          let isFirstTextInRound = true;

          // Update circuit breaker state from previous round's results
          const roundErrors = currentToolResults.filter(r => r.isError);
          if (roundErrors.length === currentToolResults.length && currentToolResults.length > 0) {
            consecutiveFailures += currentToolResults.length;
          } else {
            consecutiveFailures = 0;
          }

          // Hard stop if too many consecutive failures
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.warn(`[APIService] Circuit breaker: ${consecutiveFailures} consecutive tool failures, stopping loop`);
            // Inject a stop hint into the tool results so Claude knows to stop
            const lastResult = currentToolResults[currentToolResults.length - 1];
            if (lastResult) {
              lastResult.content += '\n\n[SYSTEM: Multiple consecutive tool calls have failed. Stop retrying and respond to the user with what you have. Do not call more tools.]';
            }
          }

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

          // Check abort signal before starting continuation
          if (this.currentAbort?.signal.aborted) {
            return { content: currentContentBlocks, stopReason: 'cancelled' } as ServerStreamResult;
          }

          let continuationResult: ServerStreamResult;
          try {
            continuationResult = await streamFromServer({
              endpoint: '/api/chat/continue',
              signal: this.currentAbort?.signal,
              body: {
                provider: providerStr,
                model,
                messages: continuationMessages,
                system: '[DEPRECATED]',
                mode: currentMode,
                additionalContext,
                tools,
                thinking: enableThinking,
                thinkingBudget,
                maxTokens: settings.model?.maxTokens || 16384,
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
                  if (depth >= MAX_TOOL_DEPTH) {
                    console.warn('[APIService] Max tool depth reached, ignoring tool:', tool.name);
                    return;
                  }

                  // Circuit breaker: skip tools that have already failed with the same input
                  const toolKey = getToolKey(tool.name, tool.input);
                  const priorFailures = toolFailureMap.get(toolKey) || 0;
                  if (priorFailures >= MAX_SAME_TOOL_FAILURES) {
                    console.warn(`[APIService] Circuit breaker: ${tool.name} already failed ${priorFailures}x with same input, skipping`);
                    return;
                  }

                  console.log('[APIService] Continuation tool use:', tool.name, `(depth: ${depth + 1})`);
                  newPendingToolUses.push(tool);

                  const activityId = statusStore.startToolActivity(
                    getToolActivityType(tool.name),
                    getToolLabel(tool.name, tool.input),
                    tool.input
                  );
                  callbacks.onToolStart?.(activityId, tool.name);
                },
                onVideoEmbed: (video) => callbacks.onVideoEmbed?.(video),
                onError: (error) => callbacks.onError?.(error),
              },
            });
          } catch (contErr: any) {
            // If user cancelled (AbortError), don't dump raw tool results into chat
            if (this.cancelled || contErr.name === 'AbortError' || contErr.message?.includes('aborted')) {
              console.log('[APIService] Continuation aborted by user');
              return { content: currentContentBlocks, stopReason: 'cancelled', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] } as ServerStreamResult;
            }
            // Real network/server error — emit a short error note, NOT raw tool output
            console.warn('[APIService] Continuation failed:', contErr.message);
            callbacks.onChunk?.(`\n\n*Could not continue — ${contErr.message}*`);
            return { content: currentContentBlocks, stopReason: 'error', usage: { inputTokens: 0, outputTokens: 0 }, toolCalls: [] } as ServerStreamResult;
          }

          if (newPendingToolUses.length > 0 && depth < MAX_TOOL_DEPTH && !this.cancelled) {
            const newToolResults = await this.executeTools(newPendingToolUses, callbacks, statusStore);

            // Track failures for circuit breaker
            for (let i = 0; i < newPendingToolUses.length; i++) {
              if (newToolResults[i]?.isError) {
                const key = getToolKey(newPendingToolUses[i].name, newPendingToolUses[i].input);
                toolFailureMap.set(key, (toolFailureMap.get(key) || 0) + 1);
              }
            }

            // Check cancelled again after tool execution
            if (this.cancelled) {
              return continuationResult;
            }

            statusStore.setPhase('analyzing', 'Processing additional tool results...');

            const delay = Math.min(500 + depth * 200, 3000);
            await new Promise(resolve => setTimeout(resolve, delay));

            return handleContinuation(continuationResult.content, newToolResults, depth + 1);
          }

          return continuationResult;
        };

        result = await handleContinuation(result.content, toolResults, 0);

        // Auto-continue if the final tool-use response was also truncated
        result = await this.handleMaxTokensContinuation(
          result, contextMessages, providerStr, model,
          currentMode, additionalContext,
          tools, enableThinking, thinkingBudget,
          settings.model?.maxTokens || 16384, callbacks,
        );
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

      // Consequence Engine: extract predictions from assistant response (fire-and-forget)
      // This is a client-side fallback — server-side extraction also runs via streaming.js
      if (responseText.length > 50) {
        import('../services/consequenceService').then(({ extractAndRecordPredictions }) => {
          const convId = messages[0]?.conversationId || '';
          extractAndRecordPredictions(responseText, convId, response.id, model).catch(() => {});
        }).catch(() => {});
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
    const results: Array<{ toolUseId: string; content: string; isError: boolean }> = [];

    for (const tool of toolUses) {
      // Check cancelled between each tool execution
      if (this.cancelled) break;

      const toolStart = Date.now();
      const result = await executeAlinTool(tool.name, tool.input);
      console.log('[APIService] Tool result:', tool.name, result.success);

      // Record tool reliability (fire-and-forget)
      recordToolCall(tool.name, result.success, Date.now() - toolStart, result.success ? undefined : result.error).catch(() => {});

      // Consequence Engine: record tool outcome for pattern tracking (fire-and-forget)
      if (!result.success) {
        import('../services/consequenceService').then(({ recordOutcome }) => {
          recordOutcome('tool_result', 'wrong', {
            triggerSource: `${tool.name}: ${result.error?.slice(0, 150) || 'failed'}`,
            domain: 'tool_reliability',
            lessonLearned: `Tool ${tool.name} failed: ${result.error?.slice(0, 200) || 'unknown error'}`,
          }).catch(() => {});
        }).catch(() => {});
      }

      // Detect generated images
      if (tool.name === 'generate_image' && result.success && result.result) {
        try {
          const parsed = JSON.parse(result.result);
          if (parsed.url) {
            callbacks.onImageGenerated?.(parsed.url, (tool.input as any)?.prompt || '', parsed.revised_prompt);
            result.result = `Image generated successfully via ${parsed.provider || 'unknown'}. The image is displayed inline above.`;
          }
        } catch { /* not JSON */ }
      }

      // Detect image edits
      if (tool.name === 'edit_image' && result.success && result.result) {
        try {
          const parsed = JSON.parse(result.result);
          if (parsed.url) {
            callbacks.onImageGenerated?.(parsed.url, (tool.input as any)?.prompt || '', parsed.description);
            result.result = `Image edited successfully via ${parsed.provider || 'unknown'}. The edited image is displayed inline above.`;
          }
        } catch { /* not JSON */ }
      }

      // Detect generated videos
      if (tool.name === 'generate_video' && result.success && result.result) {
        try {
          const parsed = JSON.parse(result.result);
          if (parsed.url) {
            callbacks.onVideoEmbed?.({
              url: parsed.url,
              embed_url: parsed.url,
              platform: parsed.provider || 'veo',
              title: (tool.input as any)?.prompt?.slice(0, 60) || 'Generated video',
              thumbnail: '',
              timestamp: 0,
            });
            result.result = `Video generated successfully via ${parsed.provider || 'veo'}. Video URL: ${parsed.url} — The video is displayed inline above.`;

            // Set videoContext on conversation so follow-up "describe the video" routes to Gemini analysis
            const currentConvId = useChatStore.getState().currentConversationId;
            if (currentConvId && parsed.url) {
              useChatStore.getState().updateConversation(currentConvId, {
                videoContext: {
                  fileUri: parsed.url,
                  mimeType: 'video/mp4',
                  geminiFileName: '',
                  displayName: (tool.input as any)?.prompt?.slice(0, 60) || 'Generated video',
                },
              });
            }
          }
        } catch { /* not JSON */ }
      }

      // Detect video embeds — extract data for UI, simplify result for Claude
      if (tool.name === 'embed_video' && result.success && result.result) {
        try {
          const parsed = JSON.parse(result.result);
          if (parsed.url && parsed.embed_url) {
            callbacks.onVideoEmbed?.({
              url: parsed.url,
              embed_url: parsed.embed_url,
              platform: parsed.platform || 'unknown',
              title: parsed.title || '',
              thumbnail: parsed.thumbnail || '',
              timestamp: parsed.timestamp || 0,
            });
            result.result = `Video embedded successfully: ${parsed.title || parsed.url} (${parsed.platform})`;
          } else {
            result.result = parsed.message || 'Video embedded.';
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
            // Try to parse structured search results (format: **Title**\nURL: url\nDescription)
            if (tool.name === 'web_search') {
              const resultBlocks = result.result.split(/\n\n/).filter(Boolean);
              const structured = resultBlocks.map((block) => {
                const titleMatch = block.match(/\*\*(.+?)\*\*/);
                const urlMatch = block.match(/(?:URL: )?(https?:\/\/[^\s\)]+)/);
                if (urlMatch) {
                  return { url: urlMatch[1], title: titleMatch?.[1] || urlMatch[1] };
                }
                return null;
              }).filter(Boolean);
              if (structured.length > 0) {
                parsedResults = structured.slice(0, 10) as any[];
              }
            }
            // Fallback: extract raw URLs
            if (!parsedResults) {
              const urlMatches = result.result.match(/https?:\/\/[^\s\)]+/g);
              if (urlMatches) {
                parsedResults = urlMatches.slice(0, 10).map((url) => ({
                  url,
                  title: url.split('/').pop() || url,
                }));
              }
            }
          }
          // Also pass query to activity for display
          const query = (tool.input?.['query'] as string) || undefined;
          statusStore.completeToolActivity(activityId, parsedResults, parsedResults?.length, result.result, query);
        } else {
          statusStore.failToolActivity(activityId, result.error || 'Unknown error');
        }
      }

      const rawContent = result.success ? result.result || 'Done' : `Error: ${result.error}`;
      results.push({
        toolUseId: tool.id,
        content: result.success ? compressToolResultContent(rawContent, tool.name) : rawContent,
        isError: !result.success,
      });
    }

    return results;
  }

  // ==========================================================================
  // AUTO-CONTINUATION (when response hits max_tokens)
  // ==========================================================================

  /**
   * If the response was truncated (stopReason === 'max_tokens'), automatically
   * continue the generation by sending the partial response back with a
   * continuation instruction. Recurses up to maxContinuationRounds.
   */
  private async handleMaxTokensContinuation(
    result: ServerStreamResult,
    contextMessages: Message[],
    providerStr: string,
    model: string,
    mode: string,
    additionalContext: string,
    tools: any[],
    enableThinking: boolean,
    thinkingBudget: number,
    maxTokens: number,
    callbacks: StreamCallback,
    round: number = 0,
  ): Promise<ServerStreamResult> {
    const settings = useSettingsStore.getState();
    const maxRounds = settings.maxContinuationRounds || 3;

    if (result.stopReason !== 'max_tokens' || !settings.enableAutoContinuation || round >= maxRounds) {
      return result;
    }

    console.log(`[APIService] Auto-continuation round ${round + 1}/${maxRounds}`);

    // Build continuation messages: original conversation + partial assistant response + continuation instruction
    const serverMessages = convertMessagesForServer(contextMessages);

    // Add the partial assistant response
    serverMessages.push({
      role: 'assistant',
      content: convertContentBlocks(result.content),
    });

    // Add continuation instruction as user message
    serverMessages.push({
      role: 'user',
      content: [{ type: 'text', text: CONTINUATION_INSTRUCTION }],
    });

    const continuationResult = await streamFromServer({
      endpoint: '/api/chat/continue',
      body: {
        provider: providerStr,
        model,
        messages: serverMessages,
        system: '[DEPRECATED]',
        mode,
        additionalContext,
        tools,
        thinking: enableThinking,
        thinkingBudget,
        maxTokens,
      },
      callbacks: {
        onText: (text) => callbacks.onChunk?.(text),
        onThinking: (thinking) => callbacks.onThinking?.(thinking),
        onToolUse: () => {}, // Don't handle tool calls during continuation
        onError: (error) => callbacks.onError?.(error),
      },
    });

    // Merge content: append continuation content to result
    const merged: ServerStreamResult = {
      stopReason: continuationResult.stopReason,
      usage: {
        inputTokens: result.usage.inputTokens + continuationResult.usage.inputTokens,
        outputTokens: result.usage.outputTokens + continuationResult.usage.outputTokens,
      },
      content: [...result.content, ...continuationResult.content],
      toolCalls: result.toolCalls,
    };

    // Recurse if still truncated
    return this.handleMaxTokensContinuation(
      merged, contextMessages, providerStr, model,
      mode, additionalContext,
      tools, enableThinking, thinkingBudget, maxTokens, callbacks, round + 1,
    );
  }

  // ==========================================================================
  // CODING MODE — Server-Side Tool Loop
  // ==========================================================================

  /**
   * Send a message through the server-side coding tool loop.
   * The server executes tools autonomously and streams events back.
   * SSE protocol: text_delta, tool_start, tool_result, done, error.
   */
  async sendCodingStream(
    messages: Message[],
    workspaceId: string,
    callbacks: StreamCallback = {}
  ): Promise<void> {
    try {
      callbacks.onStart?.();

      const settings = useSettingsStore.getState();
      const modeConfig = getModeConfig(useModeStore.getState().currentMode);

      // Build additional context (local-only data server doesn't have)
      const codingExperimental = useSettingsStore.getState().experimental;
      const memoryContext = codingExperimental.enableMemory ? getMemoryContext() : '';
      const projectContext = getProjectContextForPrompt();
      let codingAdditionalContext = projectContext + memoryContext;

      // Inject self-model addendum
      try {
        const selfModelAddendum = await buildSelfModelAddendum();
        if (selfModelAddendum) codingAdditionalContext += '\n' + selfModelAddendum;
      } catch {}

      // Model selection
      const selectedVersions = settings.selectedModelVersions;
      const model = selectedVersions.claude || 'claude-sonnet-4-5-20250929';

      // Compress context
      const contextMessages = prepareMessages(messages);
      const serverMessages = convertMessagesForServer(contextMessages);

      const statusStore = useStatusStore.getState();
      let fullText = '';

      // SSE streaming from /api/coding/stream
      const { useAuthStore } = await import('../store/authStore');

      const response = await fetch('/api/coding/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...useAuthStore.getState().getAuthHeader(),
        },
        body: JSON.stringify({
          messages: serverMessages,
          workspaceId,
          model,
          system: '[DEPRECATED]',
          mode: 'coding',
          additionalContext: codingAdditionalContext,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        let errorMsg = `Server error ${response.status}`;
        try { errorMsg = JSON.parse(errorText).error || errorMsg; } catch {}
        throw new Error(errorMsg);
      }

      if (!response.body) throw new Error('No response body for streaming');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let stopReason = 'end_turn';
      let inputTokens = 0;
      let outputTokens = 0;
      let usedTools = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const ev = JSON.parse(raw);

            switch (ev.type) {
              case 'text_delta':
                if (ev.text) {
                  fullText += ev.text;
                  callbacks.onChunk?.(ev.text);
                }
                break;

              case 'tool_start':
                usedTools = true;
                statusStore.startToolActivity(
                  getToolActivityType(ev.toolName),
                  getToolLabel(ev.toolName, ev.toolInput),
                  ev.toolInput
                );
                callbacks.onToolStart?.(ev.activityId, ev.toolName);
                break;

              case 'tool_result': {
                // Find and update the running activity
                const activity = useStatusStore.getState().toolActivities.find(
                  (a) => a.status === 'running'
                );
                if (activity) {
                  if (ev.success) {
                    statusStore.completeToolActivity(activity.id);
                  } else {
                    statusStore.failToolActivity(activity.id, ev.result || 'Error');
                  }
                }

                // Detect file writes for callback
                if (ev.toolName === 'file_write' && ev.success) {
                  const toolPath = ev.toolInput?.path || 'file';
                  const ext = toolPath.split('.').pop() || 'text';
                  callbacks.onFileGenerated?.(toolPath, '', ext);
                }
                break;
              }

              case 'done':
                stopReason = ev.stopReason || 'end_turn';
                inputTokens = ev.inputTokens || 0;
                outputTokens = ev.outputTokens || 0;
                break;

              case 'error':
                callbacks.onError?.(new Error(ev.error || 'Unknown server error'));
                break;
            }
          } catch {}
        }
      }

      // Build response for onComplete
      const hasCode = /```[\s\S]{10,}```/.test(fullText);
      const { score: confidenceScore, signals: confidenceSignals } = computeConfidence(
        fullText, stopReason, usedTools, hasCode
      );

      const pricing = CLAUDE_PRICING[model] || CLAUDE_PRICING['claude-sonnet-4-5-20250929'];
      const cost = pricing
        ? (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
        : 0;

      const serverResponse: ServerResponse = {
        id: `msg_${Date.now()}`,
        content: [{ type: 'text', text: fullText }],
        model,
        stopReason,
        finishReason: stopReason,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        cost,
        confidence: confidenceScore,
        confidenceSignals,
      };

      callbacks.onComplete?.(serverResponse);
    } catch (error: any) {
      console.error('[APIService] Coding stream error:', error);
      callbacks.onError?.(error);
    }
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
