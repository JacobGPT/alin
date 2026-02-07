/**
 * MessageList - Virtualized List of Messages
 * 
 * Features:
 * - Virtual scrolling for performance
 * - Message grouping (same sender)
 * - Timestamps
 * - Animations
 * - Selection support
 */

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Types
import type { Message } from '../../types/chat';

// Components
import { MessageComponent } from './Message';

// ============================================================================
// MESSAGELIST COMPONENT
// ============================================================================

interface MessageListProps {
  messages: Message[];
  conversationId: string;
}

export const MessageList = memo(function MessageList({
  messages,
  conversationId,
}: MessageListProps) {
  // ========================================================================
  // MESSAGE GROUPING
  // ========================================================================
  
  // Group consecutive messages from the same role
  const groupedMessages = messages.reduce((groups, message, index) => {
    const prevMessage = messages[index - 1];
    const shouldGroup =
      prevMessage &&
      prevMessage.role === message.role &&
      message.timestamp - prevMessage.timestamp < 60000; // Within 1 minute
    
    if (shouldGroup) {
      // Add to previous group
      groups[groups.length - 1].push(message);
    } else {
      // Start new group
      groups.push([message]);
    }
    
    return groups;
  }, [] as Message[][]);
  
  // ========================================================================
  // RENDER
  // ========================================================================
  
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary mx-auto">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-text-primary">
            Start a conversation
          </h3>
          <p className="text-sm text-text-tertiary">
            Send a message to begin chatting with ALIN
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <AnimatePresence mode="popLayout" initial={false}>
        {groupedMessages.map((group, groupIndex) => (
          <motion.div
            key={group[0].id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2, delay: groupIndex * 0.05 }}
            className="mb-6"
          >
            {/* Message Group */}
            <div className="space-y-2">
              {group.map((message, indexInGroup) => (
                <MessageComponent
                  key={message.id}
                  message={message}
                  showAvatar={indexInGroup === 0}
                  showTimestamp={indexInGroup === group.length - 1}
                  conversationId={conversationId}
                />
              ))}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});
