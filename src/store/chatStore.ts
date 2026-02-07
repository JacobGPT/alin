/**
 * Chat Store - Zustand State Management for Chat System
 * 
 * Manages:
 * - Conversations
 * - Messages
 * - Streaming state
 * - Input state
 * - Selection
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';

import {
  MessageRole,
  ModelProvider,
} from '../types/chat';
import type {
  Conversation,
  Message,
  ContentBlock,
  StreamState,
  ConversationSummary,
  ModelConfig,
} from '../types/chat';
import * as dbService from '../api/dbService';

// ============================================================================
// STORE STATE TYPE
// ============================================================================

interface ChatState {
  // Conversations
  conversations: Map<string, Conversation>;
  currentConversationId: string | null;
  
  // UI State
  inputValue: string;
  attachedFiles: File[];
  isComposing: boolean;
  
  // Streaming
  streamState: StreamState;
  
  // Selection
  selectedMessages: Set<string>;
  
  // Filters
  searchQuery: string;
  filter: {
    showArchived: boolean;
    showFavorites: boolean;
    tags: string[];
    folder?: string;
  };
  
  // Editing state
  editingMessageId: string | null;

  // Loading states
  isLoading: boolean;
  isSendingMessage: boolean;
  isRegenerating: boolean;
  
  // Scroll state
  shouldAutoScroll: boolean;
  
  // Model configuration
  defaultModel: ModelConfig;
}

// ============================================================================
// STORE ACTIONS TYPE
// ============================================================================

interface ChatActions {
  // Conversation management
  createConversation: (config?: Partial<Conversation>) => string;
  deleteConversation: (id: string) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  setCurrentConversation: (id: string | null) => void;
  duplicateConversation: (id: string) => string;
  
  // Message management
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp' | 'conversationId'>) => string;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (messageId: string) => void;
  editMessage: (messageId: string, content: ContentBlock[]) => void;
  regenerateMessage: (messageId: string) => Promise<void>;
  
  // Streaming
  startStreaming: (messageId: string) => void;
  appendStreamContent: (blockId: string, content: string) => void;
  completeStreaming: () => void;
  cancelStreaming: () => void;
  
  // Input
  setInputValue: (value: string) => void;
  attachFile: (file: File) => void;
  removeFile: (index: number) => void;
  clearInput: () => void;
  
  // Selection
  toggleMessageSelection: (messageId: string) => void;
  clearSelection: () => void;
  selectAll: (conversationId: string) => void;
  
  // Search & Filter
  setSearchQuery: (query: string) => void;
  updateFilter: (updates: Partial<ChatState['filter']>) => void;
  
  // Utilities
  getCurrentConversation: () => Conversation | null;
  getConversationSummaries: () => ConversationSummary[];
  getConversationById: (id: string) => Conversation | undefined;
  getMessageById: (messageId: string) => { message: Message; conversation: Conversation } | null;
  
  // Bulk operations
  deleteMultipleMessages: (messageIds: string[]) => void;
  exportConversation: (id: string) => Promise<string>;
  importConversation: (data: string) => Promise<string>;
  
  // Edit & Retry
  startEditMessage: (messageId: string) => void;
  cancelEditMessage: () => void;
  retryFromMessage: (conversationId: string, messageId: string) => string | null;

  // Branch management
  createBranch: (conversationId: string, parentMessageId: string, name?: string) => string;
  switchBranch: (conversationId: string, branchId: string) => void;
  deleteBranch: (conversationId: string, branchId: string) => void;
  editMessageAndBranch: (conversationId: string, messageId: string, newContent: string) => string;
  rewindToMessage: (conversationId: string, messageId: string) => void;

  // Settings
  setDefaultModel: (model: ModelConfig) => void;
  setShouldAutoScroll: (value: boolean) => void;
}

// ============================================================================
// DEFAULT MODEL CONFIG
// ============================================================================

const DEFAULT_MODEL: ModelConfig = {
  provider: ModelProvider.ANTHROPIC,
  modelId: 'claude-sonnet-4-20250514',
  name: 'Claude Sonnet 4',
  maxContextTokens: 200000,
  supportsVision: true,
  supportsTools: true,
  supportsStreaming: true,
  costPer1kPromptTokens: 0.003,
  costPer1kCompletionTokens: 0.015,
};

// ============================================================================
// DEBOUNCED DB WRITERS
// ============================================================================

const _convUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
function _debouncedConvUpdate(id: string, updates: Partial<Conversation>) {
  const existing = _convUpdateTimers.get(id);
  if (existing) clearTimeout(existing);
  _convUpdateTimers.set(id, setTimeout(() => {
    _convUpdateTimers.delete(id);
    dbService.updateConversation(id, {
      title: updates.title,
      isFavorite: updates.isFavorite,
      isArchived: updates.isArchived,
    }).catch(e => console.warn('[chatStore] DB updateConversation failed:', e));
  }, 500));
}

const _msgUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
function _debouncedMsgUpdate(msgId: string, content: unknown, metadata?: Record<string, unknown>) {
  const existing = _msgUpdateTimers.get(msgId);
  if (existing) clearTimeout(existing);
  _msgUpdateTimers.set(msgId, setTimeout(() => {
    _msgUpdateTimers.delete(msgId);
    dbService.updateMessage(msgId, { content, metadata }).catch(e => console.warn('[chatStore] DB updateMessage failed:', e));
  }, 500));
}

// ============================================================================
// ZUSTAND STORE
// ============================================================================

export const useChatStore = create<ChatState & ChatActions>()(
  persist(
    immer((set, get) => ({
      // ========================================================================
      // INITIAL STATE
      // ========================================================================
      
      conversations: new Map(),
      currentConversationId: null,
      
      inputValue: '',
      attachedFiles: [],
      isComposing: false,
      
      streamState: {
        isStreaming: false,
        buffers: new Map(),
      },
      
      selectedMessages: new Set(),
      
      searchQuery: '',
      filter: {
        showArchived: false,
        showFavorites: false,
        tags: [],
      },
      
      editingMessageId: null,

      isLoading: false,
      isSendingMessage: false,
      isRegenerating: false,
      
      shouldAutoScroll: true,
      
      defaultModel: DEFAULT_MODEL,
      
      // ========================================================================
      // CONVERSATION MANAGEMENT
      // ========================================================================
      
      createConversation: (config) => {
        const id = nanoid();
        const now = Date.now();
        
        const newConversation: Conversation = {
          id,
          title: config?.title || 'New Chat',
          messages: [],
          createdAt: now,
          updatedAt: now,
          model: config?.model || get().defaultModel,
          systemPrompt: config?.systemPrompt,
          temperature: config?.temperature || 0.7,
          maxTokens: config?.maxTokens || 4096,
          tags: config?.tags || [],
          isFavorite: config?.isFavorite || false,
          isArchived: config?.isArchived || false,
          ...config,
        };
        
        set((state) => {
          state.conversations.set(id, newConversation);
          state.currentConversationId = id;
        });

        // Fire-and-forget DB write
        dbService.createConversation({
          id,
          title: newConversation.title,
          mode: (newConversation as any).mode || 'regular',
          model: newConversation.model?.modelId,
          provider: newConversation.model?.provider,
        }).catch(e => console.warn('[chatStore] DB createConversation failed:', e));

        return id;
      },
      
      deleteConversation: (id) => {
        set((state) => {
          state.conversations.delete(id);

          if (state.currentConversationId === id) {
            // Switch to most recent conversation or null
            const conversations = Array.from(state.conversations.values());
            const mostRecent = conversations.sort(
              (a, b) => b.updatedAt - a.updatedAt
            )[0];
            state.currentConversationId = mostRecent?.id || null;
          }
        });

        dbService.deleteConversation(id).catch(e => console.warn('[chatStore] DB deleteConversation failed:', e));
      },
      
      updateConversation: (id, updates) => {
        set((state) => {
          const conversation = state.conversations.get(id);
          if (conversation) {
            state.conversations.set(id, {
              ...conversation,
              ...updates,
              updatedAt: Date.now(),
            });
          }
        });

        _debouncedConvUpdate(id, updates);
      },
      
      setCurrentConversation: (id) => {
        set({ currentConversationId: id });
      },
      
      duplicateConversation: (id) => {
        const original = get().conversations.get(id);
        if (!original) return '';
        
        const newId = nanoid();
        const now = Date.now();
        
        const duplicate: Conversation = {
          ...original,
          id: newId,
          title: `${original.title} (Copy)`,
          createdAt: now,
          updatedAt: now,
          messages: (original.messages || []).map((msg) => ({
            ...msg,
            id: nanoid(),
            conversationId: newId,
          })),
        };
        
        set((state) => {
          state.conversations.set(newId, duplicate);
          state.currentConversationId = newId;
        });
        
        return newId;
      },
      
      // ========================================================================
      // MESSAGE MANAGEMENT
      // ========================================================================
      
      addMessage: (conversationId, messageData) => {
        const messageId = nanoid();
        const now = Date.now();
        
        const message: Message = {
          ...messageData,
          id: messageId,
          timestamp: now,
          conversationId,
        };
        
        set((state) => {
          const conversation = state.conversations.get(conversationId);
          if (conversation) {
            if (!conversation.messages) {
              conversation.messages = [];
            }
            conversation.messages.push(message);
            conversation.updatedAt = now;

            // Auto-generate title from first user message
            if (
              conversation.messages.length === 1 &&
              message.role === MessageRole.USER &&
              conversation.title === 'New Chat'
            ) {
              const firstBlock = message.content[0];
              if (firstBlock?.type === 'text') {
                const title = firstBlock.text.slice(0, 60);
                conversation.title = title + (firstBlock.text.length > 60 ? '...' : '');
              }
            }
          }
        });

        // Fire-and-forget DB write (only for user messages; assistant msgs written on completeStreaming)
        if (messageData.role === MessageRole.USER) {
          dbService.createMessage(conversationId, {
            id: messageId,
            role: message.role,
            content: message.content,
            model: (message as any).model,
            tokensInput: (message as any).tokens?.input,
            tokensOutput: (message as any).tokens?.output,
            cost: (message as any).cost,
            parentId: (message as any).parentId,
          }).catch(e => console.warn('[chatStore] DB createMessage failed:', e));
        }

        return messageId;
      },
      
      updateMessage: (messageId, updates) => {
        set((state) => {
          for (const conversation of state.conversations.values()) {
            if (!conversation.messages) {
              conversation.messages = [];
              continue;
            }
            const msgIndex = conversation.messages.findIndex((m) => m.id === messageId);
            if (msgIndex !== -1) {
              conversation.messages[msgIndex] = {
                ...conversation.messages[msgIndex],
                ...updates,
              };
              conversation.updatedAt = Date.now();
              break;
            }
          }
        });
      },
      
      deleteMessage: (messageId) => {
        set((state) => {
          for (const conversation of state.conversations.values()) {
            if (!conversation.messages) {
              conversation.messages = [];
              continue;
            }
            const msgIndex = conversation.messages.findIndex((m) => m.id === messageId);
            if (msgIndex !== -1) {
              conversation.messages.splice(msgIndex, 1);
              conversation.updatedAt = Date.now();

              // Remove from selection
              state.selectedMessages.delete(messageId);
              break;
            }
          }
        });

        dbService.deleteMessage(messageId).catch(e => console.warn('[chatStore] DB deleteMessage failed:', e));
      },
      
      editMessage: (messageId, content) => {
        set((state) => {
          for (const conversation of state.conversations.values()) {
            if (!conversation.messages) {
              conversation.messages = [];
              continue;
            }
            const message = conversation.messages.find((m) => m.id === messageId);
            if (message) {
              // Save edit history
              if (!message.editHistory) {
                message.editHistory = [];
              }

              message.editHistory.push({
                content: message.content,
                timestamp: Date.now(),
              });

              // Update content
              message.content = content;
              message.isEdited = true;

              conversation.updatedAt = Date.now();
              break;
            }
          }
        });

        _debouncedMsgUpdate(messageId, content);
      },
      
      regenerateMessage: async (messageId) => {
        // This would trigger an API call to regenerate
        // For now, just mark as regenerating
        set({ isRegenerating: true });
        get().updateMessage(messageId, { isRegenerating: true });
        
        try {
          // API call would go here
          await new Promise((resolve) => setTimeout(resolve, 1000));
          
          get().updateMessage(messageId, { isRegenerating: false });
        } finally {
          set({ isRegenerating: false });
        }
      },
      
      // ========================================================================
      // STREAMING
      // ========================================================================
      
      startStreaming: (messageId) => {
        set((state) => {
          state.streamState.isStreaming = true;
          state.streamState.currentMessageId = messageId;
          state.streamState.buffers.clear();
        });
        
        get().updateMessage(messageId, { isStreaming: true });
      },
      
      appendStreamContent: (blockId, content) => {
        set((state) => {
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
            }).catch(e => console.warn('[chatStore] DB write assistant msg failed:', e));
          }
        }

        set((state) => {
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
        
        set((state) => {
          state.streamState.isStreaming = false;
          state.streamState.currentMessageId = undefined;
          state.streamState.buffers.clear();
        });
      },
      
      // ========================================================================
      // INPUT
      // ========================================================================
      
      setInputValue: (value) => set({ inputValue: value }),
      
      attachFile: (file) => {
        set((state) => {
          state.attachedFiles.push(file);
        });
      },
      
      removeFile: (index) => {
        set((state) => {
          state.attachedFiles.splice(index, 1);
        });
      },
      
      clearInput: () => {
        set({
          inputValue: '',
          attachedFiles: [],
        });
      },
      
      // ========================================================================
      // SELECTION
      // ========================================================================
      
      toggleMessageSelection: (messageId) => {
        set((state) => {
          if (state.selectedMessages.has(messageId)) {
            state.selectedMessages.delete(messageId);
          } else {
            state.selectedMessages.add(messageId);
          }
        });
      },
      
      clearSelection: () => {
        set({ selectedMessages: new Set() });
      },
      
      selectAll: (conversationId) => {
        const conversation = get().conversations.get(conversationId);
        if (conversation && conversation.messages) {
          set({
            selectedMessages: new Set(conversation.messages.map((m) => m.id)),
          });
        }
      },
      
      // ========================================================================
      // SEARCH & FILTER
      // ========================================================================
      
      setSearchQuery: (query) => set({ searchQuery: query }),
      
      updateFilter: (updates) => {
        set((state) => {
          state.filter = { ...state.filter, ...updates };
        });
      },
      
      // ========================================================================
      // UTILITIES
      // ========================================================================
      
      getCurrentConversation: () => {
        const { currentConversationId, conversations } = get();
        return currentConversationId ? conversations.get(currentConversationId) || null : null;
      },
      
      getConversationSummaries: () => {
        const { conversations, filter, searchQuery } = get();

        let summaries: ConversationSummary[] = Array.from(conversations.values())
          .filter((conv) => {
            // Filter out invalid/corrupted conversations
            if (!conv || !conv.id || conv.id === 'undefined') return false;

            // Filter out TBWO-linked conversations (only accessible from TBWO dashboard)
            if (conv.title?.startsWith('TBWO:')) return false;

            // Apply filters
            if (!filter.showArchived && conv.isArchived) return false;
            if (filter.showFavorites && !conv.isFavorite) return false;
            if (filter.tags.length > 0 && !filter.tags.some((tag) => conv.tags?.includes(tag))) {
              return false;
            }
            if (filter.folder && conv.folder !== filter.folder) return false;
            
            // Apply search
            if (searchQuery) {
              const query = searchQuery.toLowerCase();
              if (!conv.title.toLowerCase().includes(query)) {
                const messages = conv.messages || [];
                const hasMatchingMessage = messages.some((msg) =>
                  msg.content?.some(
                    (block) =>
                      block.type === 'text' && block.text?.toLowerCase().includes(query)
                  )
                );
                if (!hasMatchingMessage) return false;
              }
            }
            
            return true;
          })
          .map((conv) => {
            const messages = conv.messages || [];
            const lastMessage = messages[messages.length - 1];
            const preview = lastMessage?.content
              ?.find((block) => block.type === 'text')
              ?.['text']?.slice(0, 100) || '';

            return {
              id: conv.id,
              title: conv.title,
              preview,
              updatedAt: conv.updatedAt,
              messageCount: messages.length,
              isFavorite: conv.isFavorite,
              tags: conv.tags,
            };
          });
        
        // Sort by updatedAt descending
        summaries.sort((a, b) => b.updatedAt - a.updatedAt);
        
        return summaries;
      },
      
      getConversationById: (id) => {
        return get().conversations.get(id);
      },
      
      getMessageById: (messageId) => {
        for (const conversation of get().conversations.values()) {
          if (!conversation.messages) continue;
          const message = conversation.messages.find((m) => m.id === messageId);
          if (message) {
            return { message, conversation };
          }
        }
        return null;
      },
      
      // ========================================================================
      // BULK OPERATIONS
      // ========================================================================
      
      deleteMultipleMessages: (messageIds) => {
        messageIds.forEach((id) => get().deleteMessage(id));
        get().clearSelection();
      },
      
      exportConversation: async (id) => {
        const conversation = get().conversations.get(id);
        if (!conversation) throw new Error('Conversation not found');
        
        return JSON.stringify(conversation, null, 2);
      },
      
      importConversation: async (data) => {
        const conversation = JSON.parse(data) as Conversation;

        // Generate new IDs
        const newId = nanoid();
        conversation.id = newId;
        if (!conversation.messages) {
          conversation.messages = [];
        }
        conversation.messages.forEach((msg) => {
          msg.id = nanoid();
          msg.conversationId = newId;
        });
        
        set((state) => {
          state.conversations.set(newId, conversation);
          state.currentConversationId = newId;
        });
        
        return newId;
      },
      
      // ========================================================================
      // SETTINGS
      // ========================================================================
      
      setDefaultModel: (model) => set({ defaultModel: model }),
      setShouldAutoScroll: (value) => set({ shouldAutoScroll: value }),

      // ========================================================================
      // EDIT & RETRY
      // ========================================================================

      startEditMessage: (messageId) => {
        const state = get();
        const result = state.getMessageById(messageId);
        if (!result) return;

        // Extract text from message content blocks
        const text = result.message.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as any).text)
          .join('\n\n');

        set({ inputValue: text, editingMessageId: messageId });
      },

      cancelEditMessage: () => {
        set({ editingMessageId: null, inputValue: '' });
      },

      retryFromMessage: (conversationId, messageId) => {
        const state = get();
        const conversation = state.conversations.get(conversationId);
        if (!conversation || !conversation.messages) return null;

        const msgIndex = conversation.messages.findIndex((m) => m.id === messageId);
        if (msgIndex === -1) return null;

        // Get the text from this message
        const msg = conversation.messages[msgIndex]!;
        const text = msg.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as any).text)
          .join('\n\n');

        // Remove this message and all subsequent
        set((draft) => {
          const conv = draft.conversations.get(conversationId);
          if (conv && conv.messages) {
            conv.messages = conv.messages.slice(0, msgIndex);
            conv.updatedAt = Date.now();
          }
        });

        return text;
      },

      // ========================================================================
      // BRANCH MANAGEMENT
      // ========================================================================

      createBranch: (conversationId, parentMessageId, name) => {
        const branchId = nanoid();
        set((state) => {
          const conv = state.conversations.get(conversationId);
          if (!conv) return;

          if (!conv.branches) conv.branches = [];

          // Find messages up to and including the parent
          if (!conv.messages) conv.messages = [];
          const parentIdx = conv.messages.findIndex(m => m.id === parentMessageId);
          if (parentIdx === -1) return;

          const branchMessages = conv.messages.slice(0, parentIdx + 1).map(m => m.id);

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

      switchBranch: (conversationId, branchId) => {
        set((state) => {
          const conv = state.conversations.get(conversationId);
          if (!conv || !conv.branches) return;

          const branch = conv.branches.find(b => b.id === branchId);
          if (!branch) return;

          conv.currentBranchId = branchId;
        });
      },

      deleteBranch: (conversationId, branchId) => {
        set((state) => {
          const conv = state.conversations.get(conversationId);
          if (!conv || !conv.branches) return;

          conv.branches = conv.branches.filter(b => b.id !== branchId);
          if (conv.currentBranchId === branchId) {
            conv.currentBranchId = undefined;
          }
        });
      },

      editMessageAndBranch: (conversationId, messageId, newContent) => {
        const currentState = get();
        const conv = currentState.conversations.get(conversationId);
        if (!conv) return '';

        if (!conv.messages) return '';
        const msgIdx = conv.messages.findIndex(m => m.id === messageId);
        if (msgIdx === -1) return '';

        // Save current conversation as a branch (before the edit)
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg) {
          currentState.createBranch(conversationId, lastMsg.id, 'Original');
        }

        // Create new branch from parent of edited message
        const newBranchId = nanoid();

        set((draft) => {
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
            messages: c.messages.map(m => m.id),
            createdAt: Date.now(),
          });
          c.currentBranchId = newBranchId;
          c.updatedAt = Date.now();
        });

        return newBranchId;
      },

      rewindToMessage: (conversationId, messageId) => {
        const conv = get().conversations.get(conversationId);
        if (!conv || !conv.messages) return;

        const msgIdx = conv.messages.findIndex(m => m.id === messageId);
        if (msgIdx === -1) return;

        // Save current conversation state as a branch before rewinding
        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg && conv.messages.length > msgIdx + 1) {
          get().createBranch(conversationId, lastMsg.id, `Before rewind (${new Date().toLocaleTimeString()})`);
        }

        // Truncate messages to the selected point
        set((state) => {
          const c = state.conversations.get(conversationId);
          if (!c || !c.messages) return;
          c.messages = c.messages.slice(0, msgIdx + 1);
          c.updatedAt = Date.now();
        });
      },
    })),
    {
      name: 'alin-chat-storage',
      // Only persist conversations and settings, not UI state
      partialize: (state) => ({
        conversations: Array.from(state.conversations.entries()),
        defaultModel: state.defaultModel,
      }),
      // Custom serialization for Map
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;

          console.log('[ChatStore] Loading from localStorage...');
          const { state } = JSON.parse(str);

          // Ensure all conversations have messages array and valid timestamps
          const conversations = new Map(state.conversations);
          const now = Date.now();

          for (const [id, rawConv] of conversations) {
            const conv = rawConv as any;
            console.log('[ChatStore] Conv', id, 'has', conv.messages?.length || 0, 'messages');
            if (!conv.messages) {
              conv.messages = [];
            }
            // Ensure valid timestamps
            if (!conv.createdAt || isNaN(conv.createdAt) || conv.createdAt <= 0) {
              conv.createdAt = now;
            }
            if (!conv.updatedAt || isNaN(conv.updatedAt) || conv.updatedAt <= 0) {
              conv.updatedAt = conv.createdAt || now;
            }
            // Ensure messages have valid timestamps
            conv.messages.forEach((msg: any) => {
              if (!msg.timestamp || isNaN(msg.timestamp) || msg.timestamp <= 0) {
                msg.timestamp = conv.createdAt || now;
              }
            });
          }
          return {
            state: {
              ...state,
              conversations,
            },
          };
        },
        setItem: (() => {
          // Debounce localStorage saves to prevent spam during streaming
          let saveTimeout: ReturnType<typeof setTimeout> | null = null;
          let pendingValue: any = null;

          const doSave = (name: string, value: any) => {
            const { state } = value;
            const conversationsArray = state.conversations instanceof Map
              ? Array.from(state.conversations.entries())
              : state.conversations;

            localStorage.setItem(
              name,
              JSON.stringify({
                state: {
                  ...state,
                  conversations: conversationsArray,
                },
              })
            );
          };

          return (name: string, value: any) => {
            pendingValue = value;

            // Clear existing timeout
            if (saveTimeout) {
              clearTimeout(saveTimeout);
            }

            // Debounce: save after 500ms of no changes, or immediately if it's been 2s
            saveTimeout = setTimeout(() => {
              if (pendingValue) {
                doSave(name, pendingValue);
                pendingValue = null;
              }
            }, 500);
          };
        })(),
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
