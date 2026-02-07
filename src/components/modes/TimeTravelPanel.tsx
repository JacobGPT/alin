/**
 * TimeTravelPanel - Conversation timeline with snapshot & rewind
 *
 * Shows a visual timeline of all messages in the conversation.
 * Users can click any point to rewind (preserving history as a branch).
 */

import { useState } from 'react';
import {
  ClockIcon,
  ArrowUturnLeftIcon,
  ChatBubbleLeftIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  ArrowsPointingOutIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import { useChatStore } from '../../store/chatStore';
import { MessageRole } from '../../types/chat';

export function TimeTravelPanel() {
  const conversation = useChatStore((s) => s.getCurrentConversation());
  const rewindToMessage = useChatStore((s) => s.rewindToMessage);
  const branches = conversation?.branches || [];
  const switchBranch = useChatStore((s) => s.switchBranch);

  const [confirmRewind, setConfirmRewind] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());

  if (!conversation) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No active conversation
      </div>
    );
  }

  const messages = conversation.messages || [];

  const handleRewind = (messageId: string) => {
    if (confirmRewind === messageId) {
      rewindToMessage(conversation.id, messageId);
      setConfirmRewind(null);
    } else {
      setConfirmRewind(messageId);
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirmRewind(null), 3000);
    }
  };

  const formatTime = (ts: number) => {
    if (!ts || isNaN(ts) || ts <= 0) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getMessageText = (msg: any): string => {
    if (!msg.content || !Array.isArray(msg.content)) return '';
    const textBlocks = msg.content.filter((b: any) => b.type === 'text');
    return textBlocks.map((b: any) => b.text).join(' ');
  };

  const getMessagePreview = (msg: any): string => {
    const text = getMessageText(msg);
    return text.length > 150 ? text.slice(0, 150) + '...' : text;
  };

  const toggleExpanded = (msgId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const getToolCount = (msg: any): number => {
    if (!msg.content || !Array.isArray(msg.content)) return 0;
    return msg.content.filter((b: any) =>
      b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'tool_activity'
    ).length;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border-primary">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary flex items-center gap-1.5">
          <ClockIcon className="h-3.5 w-3.5" />
          Timeline
        </h3>
        <p className="text-xs text-text-quaternary mt-0.5">
          {messages.length} message{messages.length !== 1 ? 's' : ''}
          {branches.length > 0 && ` · ${branches.length} branch${branches.length !== 1 ? 'es' : ''}`}
        </p>
      </div>

      {/* Branches (if any) */}
      {branches.length > 0 && (
        <div className="p-2 border-b border-border-primary">
          <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-1.5">
            <ArrowsPointingOutIcon className="h-3 w-3" />
            <span>Saved Branches</span>
          </div>
          <div className="space-y-1">
            {branches.map((branch) => (
              <button
                key={branch.id}
                onClick={() => switchBranch(conversation.id, branch.id)}
                className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                  branch.id === conversation.currentBranchId
                    ? 'bg-accent-primary/15 text-accent-primary'
                    : 'text-text-secondary hover:bg-background-tertiary'
                }`}
              >
                <span className="truncate flex-1">{branch.name}</span>
                <span className="text-text-quaternary">{branch.messages.length} msgs</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.length > 0 ? (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-3 top-0 bottom-0 w-px bg-border-primary" />

            {messages.map((msg, idx) => {
              const isUser = msg.role === MessageRole.USER;
              const isLast = idx === messages.length - 1;
              const toolCount = getToolCount(msg);
              const preview = getMessagePreview(msg);
              const isRewindTarget = confirmRewind === msg.id;

              return (
                <div key={msg.id} className="relative pl-8 pb-3 group">
                  {/* Timeline dot */}
                  <div
                    className={`absolute left-1.5 top-1 w-3 h-3 rounded-full border-2 ${
                      isUser
                        ? 'border-blue-400 bg-blue-400/20'
                        : 'border-purple-400 bg-purple-400/20'
                    }`}
                  />

                  {/* Message card */}
                  <div className={`rounded-lg p-2 text-xs transition-colors ${
                    isLast ? 'bg-background-tertiary' : 'hover:bg-background-tertiary/50'
                  }`}>
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {isUser ? (
                          <ChatBubbleLeftIcon className="h-3 w-3 text-blue-400" />
                        ) : (
                          <CpuChipIcon className="h-3 w-3 text-purple-400" />
                        )}
                        <span className={`font-medium ${isUser ? 'text-blue-400' : 'text-purple-400'}`}>
                          {isUser ? 'You' : 'ALIN'}
                        </span>
                        <span className="text-text-quaternary">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>

                      {/* Rewind button (not on last message) */}
                      {!isLast && (
                        <button
                          onClick={() => handleRewind(msg.id)}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                            isRewindTarget
                              ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                              : 'opacity-0 group-hover:opacity-100 text-text-quaternary hover:text-orange-400 hover:bg-orange-500/10'
                          }`}
                          title={isRewindTarget ? 'Click again to confirm rewind' : 'Rewind to this point'}
                        >
                          <ArrowUturnLeftIcon className="h-3 w-3" />
                          <span>{isRewindTarget ? 'Confirm' : 'Rewind'}</span>
                        </button>
                      )}
                    </div>

                    {/* Preview / Full content */}
                    {(() => {
                      const fullText = getMessageText(msg);
                      const isLongMessage = fullText.length > 150;
                      const isExpanded = expandedMessages.has(msg.id);

                      if (!fullText) return null;

                      return (
                        <div>
                          <button
                            onClick={() => isLongMessage && toggleExpanded(msg.id)}
                            className={`text-left w-full ${isLongMessage ? 'cursor-pointer hover:text-text-primary' : 'cursor-default'}`}
                          >
                            <p className={`text-text-secondary ${isExpanded ? '' : 'line-clamp-2'}`}>
                              {isExpanded ? fullText : preview}
                            </p>
                          </button>
                          {isLongMessage && (
                            <button
                              onClick={() => toggleExpanded(msg.id)}
                              className="flex items-center gap-0.5 mt-0.5 text-[10px] text-text-quaternary hover:text-text-secondary"
                            >
                              <ChevronDownIcon className={`h-2.5 w-2.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-1">
                      {toolCount > 0 && (
                        <span className="flex items-center gap-0.5 text-text-quaternary">
                          <WrenchScrewdriverIcon className="h-3 w-3" />
                          {toolCount}
                        </span>
                      )}
                      {msg.tokens?.total && msg.tokens.total > 0 && (
                        <span className="text-text-quaternary">
                          {msg.tokens.total.toLocaleString()} tok
                        </span>
                      )}
                      {msg.confidence != null && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          msg.confidence >= 0.8 ? 'bg-green-500/10 text-green-400' :
                          msg.confidence >= 0.5 ? 'bg-yellow-500/10 text-yellow-400' :
                          'bg-red-500/10 text-red-400'
                        }`}>
                          {Math.round(msg.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ClockIcon className="h-10 w-10 text-text-quaternary mb-2" />
            <p className="text-xs text-text-quaternary">No messages yet.</p>
            <p className="text-xs text-text-quaternary mt-1">
              Send a message to start the timeline.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
