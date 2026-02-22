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
import { createStreamingSlice } from './chat/streamingSlice';
import { createMessageEditSlice } from './chat/messageEditSlice';

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
  modelId: 'claude-sonnet-4-5-20250929',
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

      selectedMessages: new Set(),

      searchQuery: '',
      filter: {
        showArchived: false,
        showFavorites: false,
        tags: [],
      },

      isLoading: false,
      isSendingMessage: false,
      isRegenerating: false,

      shouldAutoScroll: true,

      defaultModel: DEFAULT_MODEL,

      // Spread slices
      ...createStreamingSlice(set, get),
      ...createMessageEditSlice(set, get),

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
        // Protect TBWO-linked conversations from accidental deletion
        const conv = get().conversations.get(id);
        if (conv?.title?.startsWith('TBWO:')) {
          console.warn('[chatStore] Refusing to delete TBWO-linked conversation:', id);
          return;
        }

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

        dbService.deleteConversation(id).catch(e => {
          console.warn('[chatStore] DB deleteConversation failed, queuing for retry:', e);
          // Queue failed deletes so dbInit can replay them on next page load
          try {
            const raw = localStorage.getItem('alin-pending-deletes');
            const pending: string[] = raw ? JSON.parse(raw) : [];
            if (!pending.includes(id)) {
              pending.push(id);
              localStorage.setItem('alin-pending-deletes', JSON.stringify(pending));
            }
          } catch {}
        });
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
          let quotaFailedAt = 0;
          let compactMode = false; // Once quota exceeded, always save compacted

          // Strip base64, tool_activity, video_embed; cap messages per conversation
          const compactConvo = (entry: any, maxMsgs: number) => {
            const [id, convo] = entry;
            if (!convo?.messages) return entry;
            const msgs = convo.messages.slice(-maxMsgs).map((m: any) => {
              if (!Array.isArray(m.content)) return m;
              return {
                ...m,
                content: m.content
                  .filter((b: any) => b.type !== 'tool_activity')
                  .map((b: any) => {
                    if (b.type === 'image' && b.url?.startsWith('data:')) {
                      return { ...b, url: '[base64-stripped]' };
                    }
                    if (b.type === 'text' && b.text && b.text.length > 4000) {
                      return { ...b, text: b.text.slice(0, 4000) + '...[trimmed]' };
                    }
                    return b;
                  }),
              };
            });
            return [id, { ...convo, messages: msgs }];
          };

          const sortByRecent = (arr: any[]) =>
            [...arr].sort((a: any, b: any) => {
              const aTime = (a[1]?.updatedAt || a[1]?.createdAt || 0);
              const bTime = (b[1]?.updatedAt || b[1]?.createdAt || 0);
              return bTime - aTime;
            });

          const doSave = (name: string, value: any) => {
            // Skip if in hard cooldown (localStorage truly full)
            if (quotaFailedAt && Date.now() - quotaFailedAt < 60_000) return;

            const { state } = value;
            const conversationsArray = state.conversations instanceof Map
              ? Array.from(state.conversations.entries())
              : state.conversations;

            // If we've hit quota before, proactively compact every save (no spam)
            if (compactMode) {
              try {
                const sorted = sortByRecent(conversationsArray);
                const trimmed = sorted.slice(0, 5).map((e: any) => compactConvo(e, 10));
                localStorage.setItem(name, JSON.stringify({ state: { ...state, conversations: trimmed } }));
              } catch {
                // Even compact mode failed — hard cooldown
                quotaFailedAt = Date.now();
              }
              return;
            }

            try {
              localStorage.setItem(
                name,
                JSON.stringify({
                  state: { ...state, conversations: conversationsArray },
                })
              );
            } catch (e: any) {
              if (e?.name === 'QuotaExceededError') {
                // Switch to permanent compact mode — one-time warning only
                compactMode = true;
                console.warn('[ChatStore] localStorage quota exceeded — switching to compact mode (SQLite is primary)');
                // Immediately retry in compact mode
                doSave(name, value);
              }
            }
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

// Startup: prune localStorage if it's oversized (>2MB)
try {
  const stored = localStorage.getItem('alin-chat-storage');
  if (stored && stored.length > 2_000_000) {
    console.warn(`[ChatStore] localStorage is ${(stored.length / 1_000_000).toFixed(1)}MB — pruning on startup`);
    localStorage.removeItem('alin-chat-storage');
  }
} catch { /* ignore */ }
