/**
 * Chat Streaming Slice — Streaming state, start/append/complete/cancel
 */

import type { StreamState } from '../../types/chat';
import * as dbService from '../../api/dbService';

export function createStreamingSlice(set: any, get: any) {
  return {
    // State
    streamState: {
      isStreaming: false,
      buffers: new Map(),
    } as StreamState,

    // Actions
    startStreaming: (messageId: string) => {
      set((state: any) => {
        state.streamState.isStreaming = true;
        state.streamState.currentMessageId = messageId;
        state.streamState.buffers.clear();
      });

      get().updateMessage(messageId, { isStreaming: true });
    },

    appendStreamContent: (blockId: string, content: string) => {
      set((state: any) => {
        const current = state.streamState.buffers.get(blockId) || '';
        state.streamState.buffers.set(blockId, current + content);
      });
    },

    completeStreaming: () => {
      const { streamState } = get();
      const completedMsgId = streamState.currentMessageId;
      if (completedMsgId) {
        get().updateMessage(completedMsgId, { isStreaming: false });

        // Write final assistant message to DB
        const msgResult = get().getMessageById(completedMsgId);
        if (msgResult) {
          dbService.createMessage(msgResult.conversation.id, {
            id: completedMsgId,
            role: msgResult.message.role,
            content: msgResult.message.content,
            model: (msgResult.message as any).model,
            tokensInput: (msgResult.message as any).tokens?.input,
            tokensOutput: (msgResult.message as any).tokens?.output,
            cost: (msgResult.message as any).cost,
            parentId: (msgResult.message as any).parentId,
          }).catch((e: any) => console.warn('[chatStore] DB write assistant msg failed:', e));
        }
      }

      set((state: any) => {
        state.streamState.isStreaming = false;
        state.streamState.currentMessageId = undefined;
        state.streamState.buffers.clear();
      });
    },

    cancelStreaming: () => {
      const { streamState } = get();
      if (streamState.currentMessageId) {
        // Optionally delete the incomplete message
        get().deleteMessage(streamState.currentMessageId);
      }

      set((state: any) => {
        state.streamState.isStreaming = false;
        state.streamState.currentMessageId = undefined;
        state.streamState.buffers.clear();
      });
    },
  };
}
