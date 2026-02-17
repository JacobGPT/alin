/**
 * ProactiveSuggestionPanel -- Shows AI-generated suggestions inline above the input area.
 * Renders active (non-dismissed, non-expired) suggestions from proactiveStore.
 *
 * Features:
 * - Colored left-border cards (blue=info, amber=action/tool, purple=tbwo, teal=memory)
 * - Auto-dismiss on conversation switch
 * - Full action handler support (save_and_new_chat, start_new_chat, switch_mode, open_memory, etc.)
 */

import React, { useEffect } from 'react';
import { useProactiveStore, type Suggestion } from '../../store/proactiveStore';
import { useModeStore } from '../../store/modeStore';
import { useChatStore } from '../../store/chatStore';
import { useUIStore } from '../../store/uiStore';
import { useMemoryStore } from '../../store/memoryStore';
import { RightPanelContent } from '../../types/ui';
import { MemoryLayer } from '../../types/memory';

/** Map suggestion type to a left-border color class */
const borderColorClass = (type: Suggestion['type']): string => {
  switch (type) {
    case 'tbwo':
      return 'border-l-purple-500';
    case 'action':
    case 'tool':
      return 'border-l-amber-500';
    case 'memory':
      return 'border-l-teal-400';
    case 'info':
    default:
      return 'border-l-blue-500';
  }
};

/** Subtle background tint per type */
const bgTintClass = (type: Suggestion['type']): string => {
  switch (type) {
    case 'tbwo':
      return 'bg-purple-500/5 hover:bg-purple-500/10';
    case 'action':
    case 'tool':
      return 'bg-amber-500/5 hover:bg-amber-500/10';
    case 'memory':
      return 'bg-teal-400/5 hover:bg-teal-400/10';
    case 'info':
    default:
      return 'bg-blue-500/5 hover:bg-blue-500/10';
  }
};

export const ProactiveSuggestionPanel: React.FC = () => {
  const suggestions = useProactiveStore(s => s.getActiveSuggestions());
  const dismissSuggestion = useProactiveStore(s => s.dismissSuggestion);
  const dismissAll = useProactiveStore(s => s.dismissAll);
  const setMode = useModeStore(s => s.setMode);

  // ---- Auto-dismiss on conversation switch ----
  const currentConvId = useChatStore(s => s.currentConversationId);
  useEffect(() => {
    dismissAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentConvId]);

  if (suggestions.length === 0) return null;

  // ---- Action handler ----
  const handleAction = (suggestion: Suggestion) => {
    if (!suggestion.action) {
      dismissSuggestion(suggestion.id);
      return;
    }

    const { handler, params } = suggestion.action;

    switch (handler) {
      // --- Mode switching ---
      case 'switch_mode':
      case 'switchMode':
        if (params?.mode) setMode(params.mode as any);
        break;

      // --- TBWO creation ---
      case 'create_tbwo':
        setMode('tbwo' as any);
        break;

      // --- Open memory panel in right sidebar ---
      case 'open_memory':
        useUIStore.getState().setRightPanel(RightPanelContent.MEMORY, true);
        break;

      // --- Start a fresh conversation ---
      case 'start_new_chat':
        useChatStore.getState().createConversation();
        break;

      // --- Save summary to memory, then start a new chat ---
      case 'save_and_new_chat': {
        const conversation = useChatStore.getState().getCurrentConversation();
        const title = conversation?.title || 'Conversation';
        const msgCount = conversation?.messages?.length || 0;

        useMemoryStore.getState().addMemory({
          layer: MemoryLayer.EPISODIC,
          content: `Conversation summary: "${title}" (${msgCount} messages). Key topics discussed in this session were saved for future reference.`,
          salience: 0.6,
          tags: ['conversation-summary', 'auto-saved'],
          metadata: {
            conversationId: conversation?.id,
            messageCount: msgCount,
            savedAt: Date.now(),
          },
        });

        useChatStore.getState().createConversation();
        break;
      }

      // --- Open a modal (e.g. new-tbwo) ---
      case 'openModal':
        if (params?.type) {
          useUIStore.getState().openModal({ type: params.type as any });
        }
        break;

      default:
        console.log('[ProactiveSuggestion] Unknown handler:', handler);
    }

    dismissSuggestion(suggestion.id);
  };

  return (
    <div className="mx-4 mb-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-text-tertiary font-medium tracking-wide uppercase">
          Suggestions
        </span>
        {suggestions.length > 1 && (
          <button
            onClick={dismissAll}
            className="text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Dismiss all
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {suggestions.map(s => (
          <div
            key={s.id}
            className={[
              'group flex items-center gap-2 pl-0 pr-2.5 py-1.5 rounded-md border-l-2',
              'border border-border-primary/60',
              'transition-all duration-150 cursor-pointer',
              'shadow-sm hover:shadow-md',
              borderColorClass(s.type),
              bgTintClass(s.type),
            ].join(' ')}
            onClick={() => handleAction(s)}
          >
            <div className="flex flex-col ml-2.5 min-w-0">
              <span className="text-xs font-medium text-text-primary leading-tight truncate">
                {s.title}
              </span>
              {s.description && (
                <span className="text-[10px] text-text-tertiary leading-tight line-clamp-1 mt-0.5">
                  {s.description}
                </span>
              )}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); dismissSuggestion(s.id); }}
              className="ml-auto flex-shrink-0 w-4 h-4 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
              aria-label="Dismiss"
            >
              &#x2715;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
