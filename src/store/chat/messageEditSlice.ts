/**
 * Chat Message Edit Slice — Edit, retry, branch management, rewind
 */

import { nanoid } from 'nanoid';
import type { Message } from '../../types/chat';

export function createMessageEditSlice(set: any, get: any) {
  return {
    // State
    editingMessageId: null as string | null,

    // Actions
    startEditMessage: (messageId: string) => {
      const state = get();
      const result = state.getMessageById(messageId);
      if (!result) return;

      // Extract text from message content blocks
      const text = result.message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => (b as any).text)
        .join('\n\n');

      set({ inputValue: text, editingMessageId: messageId });
    },

    cancelEditMessage: () => {
      set({ editingMessageId: null, inputValue: '' });
    },

    retryFromMessage: (conversationId: string, messageId: string): string | null => {
      const state = get();
      const conversation = state.conversations.get(conversationId);
      if (!conversation || !conversation.messages) return null;

      const msgIndex = conversation.messages.findIndex((m: Message) => m.id === messageId);
      if (msgIndex === -1) return null;

      // Get the text from this message
      const msg = conversation.messages[msgIndex]!;
      const text = msg.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => (b as any).text)
        .join('\n\n');

      // Remove this message and all subsequent
      set((draft: any) => {
        const conv = draft.conversations.get(conversationId);
        if (conv && conv.messages) {
          conv.messages = conv.messages.slice(0, msgIndex);
          conv.updatedAt = Date.now();
        }
      });

      return text;
    },

    // Branch management
    createBranch: (conversationId: string, parentMessageId: string, name?: string): string => {
      const branchId = nanoid();
      set((state: any) => {
        const conv = state.conversations.get(conversationId);
        if (!conv) return;

        if (!conv.branches) conv.branches = [];

        // Find messages up to and including the parent
        if (!conv.messages) conv.messages = [];
        const parentIdx = conv.messages.findIndex((m: Message) => m.id === parentMessageId);
        if (parentIdx === -1) return;

        const branchMessages = conv.messages.slice(0, parentIdx + 1).map((m: Message) => m.id);

        conv.branches.push({
          id: branchId,
          name: name || `Branch ${conv.branches.length + 1}`,
          parentMessageId,
          messages: branchMessages,
          createdAt: Date.now(),
        });
      });
      return branchId;
    },

    switchBranch: (conversationId: string, branchId: string) => {
      set((state: any) => {
        const conv = state.conversations.get(conversationId);
        if (!conv || !conv.branches) return;

        const branch = conv.branches.find((b: any) => b.id === branchId);
        if (!branch) return;

        conv.currentBranchId = branchId;
      });
    },

    deleteBranch: (conversationId: string, branchId: string) => {
      set((state: any) => {
        const conv = state.conversations.get(conversationId);
        if (!conv || !conv.branches) return;

        conv.branches = conv.branches.filter((b: any) => b.id !== branchId);
        if (conv.currentBranchId === branchId) {
          conv.currentBranchId = undefined;
        }
      });
    },

    editMessageAndBranch: (conversationId: string, messageId: string, newContent: string): string => {
      const currentState = get();
      const conv = currentState.conversations.get(conversationId);
      if (!conv) return '';

      if (!conv.messages) return '';
      const msgIdx = conv.messages.findIndex((m: Message) => m.id === messageId);
      if (msgIdx === -1) return '';

      // Save current conversation as a branch (before the edit)
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg) {
        currentState.createBranch(conversationId, lastMsg.id, 'Original');
      }

      // Create new branch from parent of edited message
      const newBranchId = nanoid();

      set((draft: any) => {
        const c = draft.conversations.get(conversationId);
        if (!c) return;
        if (!c.messages) c.messages = [];

        // Snapshot the original message before mutating
        const originalMsg = conv.messages![msgIdx]!;

        // Remove messages after the edited one
        c.messages = c.messages.slice(0, msgIdx);

        // Add edited message
        const editedMsg = {
          ...originalMsg,
          id: nanoid(),
          content: [{ type: 'text' as const, text: newContent }],
          timestamp: Date.now(),
          isEdited: true,
          editHistory: [
            ...(originalMsg.editHistory || []),
            {
              content: originalMsg.content,
              timestamp: Date.now(),
            },
          ],
        } as any as Message;
        c.messages.push(editedMsg);

        if (!c.branches) c.branches = [];
        const parentId = msgIdx > 0 ? conv.messages![msgIdx - 1]!.id : editedMsg.id;
        c.branches.push({
          id: newBranchId,
          name: 'Edited',
          parentMessageId: parentId,
          messages: c.messages.map((m: Message) => m.id),
          createdAt: Date.now(),
        });
        c.currentBranchId = newBranchId;
        c.updatedAt = Date.now();
      });

      return newBranchId;
    },

    rewindToMessage: (conversationId: string, messageId: string) => {
      const conv = get().conversations.get(conversationId);
      if (!conv || !conv.messages) return;

      const msgIdx = conv.messages.findIndex((m: Message) => m.id === messageId);
      if (msgIdx === -1) return;

      // Save current conversation state as a branch before rewinding
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg && conv.messages.length > msgIdx + 1) {
        get().createBranch(conversationId, lastMsg.id, `Before rewind (${new Date().toLocaleTimeString()})`);
      }

      // Truncate messages to the selected point
      set((state: any) => {
        const c = state.conversations.get(conversationId);
        if (!c || !c.messages) return;
        c.messages = c.messages.slice(0, msgIdx + 1);
        c.updatedAt = Date.now();
      });
    },
  };
}
