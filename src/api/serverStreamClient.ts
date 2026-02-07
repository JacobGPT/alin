/**
 * Server Stream Client - SSE streaming through backend proxy
 *
 * All AI API calls go through the server. API keys never touch the browser.
 * Returns collected tool calls + content blocks for the tool execution loop.
 */

import { useAuthStore } from '../store/authStore';
import type { ContentBlock } from '../types/chat';

// ============================================================================
// TYPES
// ============================================================================

export interface ServerStreamCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolUse?: (tool: { id: string; name: string; input: Record<string, unknown> }) => void;
  onError?: (error: Error) => void;
}

export interface ServerStreamParams {
  endpoint: '/api/chat/stream' | '/api/chat/continue';
  body: {
    provider: string;
    model: string;
    messages: any[];
    system?: string;
    tools?: any[];
    thinking?: boolean;
    thinkingBudget?: number;
    maxTokens?: number;
  };
  callbacks: ServerStreamCallbacks;
  signal?: AbortSignal;
}

export interface ServerStreamResult {
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
  content: ContentBlock[];
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}

// ============================================================================
// STREAMING FUNCTION
// ============================================================================

export async function streamFromServer(params: ServerStreamParams): Promise<ServerStreamResult> {
  const { endpoint, body, callbacks, signal } = params;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...useAuthStore.getState().getAuthHeader(),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    let errorMsg = `Server error ${res.status}`;
    try {
      const parsed = JSON.parse(errorText);
      errorMsg = parsed.error || errorMsg;
    } catch {}
    throw new Error(errorMsg);
  }

  if (!res.body) {
    throw new Error('No response body for streaming');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = 'end_turn';
  let usage = { inputTokens: 0, outputTokens: 0 };

  // Collect content blocks and tool calls for the tool execution loop
  const contentBlocks: ContentBlock[] = [];
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
  let currentText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          // Event type line — processed with corresponding data line
          continue;
        }
        if (!line.startsWith('data: ')) continue;

        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;

        try {
          const data = JSON.parse(raw);

          if (data.type === 'text_delta' || data.type === 'text' || (data.text !== undefined && data.type !== 'done' && data.type !== 'thinking_delta')) {
            if (data.text) {
              currentText += data.text;
              callbacks.onText?.(data.text);
            }
          } else if (data.type === 'thinking_delta' || data.type === 'thinking' || data.thinking !== undefined) {
            if (data.thinking) callbacks.onThinking?.(data.thinking);
          } else if (data.type === 'tool_use') {
            const toolCall = {
              id: data.id || '',
              name: data.name || '',
              input: (data.input || {}) as Record<string, unknown>,
            };
            toolCalls.push(toolCall);

            // Add text block before tool use if we have accumulated text
            if (currentText) {
              contentBlocks.push({ type: 'text', text: currentText });
              currentText = '';
            }

            // Add tool_use content block
            contentBlocks.push({
              type: 'tool_use',
              toolUseId: toolCall.id,
              toolName: toolCall.name,
              toolInput: toolCall.input,
            });

            callbacks.onToolUse?.(toolCall);
          } else if (data.type === 'usage') {
            usage = {
              inputTokens: data.inputTokens || 0,
              outputTokens: data.outputTokens || 0,
            };
          } else if (data.type === 'done') {
            stopReason = data.stopReason || 'end_turn';
            if (data.inputTokens) usage.inputTokens = data.inputTokens;
            if (data.outputTokens) usage.outputTokens = data.outputTokens;
          } else if (data.type === 'error') {
            throw new Error(data.error || 'Stream error');
          }
        } catch (parseErr: any) {
          if (parseErr.message && !parseErr.message.includes('JSON')) {
            throw parseErr; // Re-throw non-parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Flush any remaining text
  if (currentText) {
    contentBlocks.push({ type: 'text', text: currentText });
  }

  return { stopReason, usage, content: contentBlocks, toolCalls };
}
