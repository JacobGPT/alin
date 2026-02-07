/**
 * ChatContainer - Main Chat Interface
 * 
 * Features:
 * - Message list with virtualization
 * - Real-time streaming
 * - Auto-scroll with user control
 * - Input area with file upload
 * - Thinking panel
 * - Export/import
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowDownIcon,
  Cog6ToothIcon,
  DocumentArrowDownIcon,
  ChartBarIcon,
  Bars3Icon,
  ArrowsRightLeftIcon,
  CameraIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

// Store
import { useChatStore } from '@store/chatStore';
import { useUIStore } from '@store/uiStore';
import { RightPanelContent } from '../../types/ui';

// Components
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { ModelSelector } from './ModelSelector';
import { ModeSelector } from './ModeSelector';
import { Button } from '@components/ui/Button';
import { BackgroundJobIndicator } from './BackgroundJobIndicator';

// ============================================================================
// CHATCONTAINER COMPONENT
// ============================================================================

export default function ChatContainer() {
  const { conversationId } = useParams();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  
  // Store state
  const currentConversation = useChatStore((state) => state.getCurrentConversation());
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const shouldAutoScroll = useChatStore((state) => state.shouldAutoScroll);
  const setShouldAutoScroll = useChatStore((state) => state.setShouldAutoScroll);

  const openModal = useUIStore((state) => state.openModal);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const sidebarCollapsed = useUIStore((state) => state.layout.sidebarCollapsed);
  
  // ========================================================================
  // EFFECTS
  // ========================================================================
  
  // Set conversation from URL
  useEffect(() => {
    if (conversationId && conversationId !== currentConversation?.id) {
      setCurrentConversation(conversationId);
    }
  }, [conversationId, currentConversation?.id, setCurrentConversation]);
  
  // Auto-scroll on new messages
  useEffect(() => {
    if (shouldAutoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentConversation?.messages, shouldAutoScroll]);
  
  // Handle scroll to detect user scrolling
  const handleScroll = () => {
    if (!scrollRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    setShowScrollButton(!isAtBottom);
    setShouldAutoScroll(isAtBottom);
  };
  
  // ========================================================================
  // HANDLERS
  // ========================================================================
  
  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
      setShouldAutoScroll(true);
    }
  };
  
  const handleExport = () => {
    if (currentConversation) {
      openModal({
        type: 'export-chat',
        props: { conversationId: currentConversation.id },
      });
    }
  };
  
  const handleSettings = () => {
    openModal({ type: 'settings' });
  };

  const handleAudit = () => {
    openModal({ type: 'audit-dashboard' });
  };

  const handleVision = () => {
    useUIStore.getState().setRightPanel(RightPanelContent.VISION, true);
  };

  const handleTimeline = () => {
    useUIStore.getState().setRightPanel(RightPanelContent.TIME_TRAVEL, true);
  };
  
  // ========================================================================
  // RENDER
  // ========================================================================
  
  if (!currentConversation) {
    return (
      <div className="flex h-full items-center justify-center bg-background-primary">
        <div className="text-center">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-background-elevated mx-auto">
            <svg
              className="h-10 w-10 text-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">
            No conversation selected
          </h2>
          <p className="text-sm text-text-tertiary">
            Select a conversation from the sidebar or create a new one
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex h-full flex-col bg-background-primary">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border-primary bg-background-secondary px-4 py-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* Sidebar Toggle */}
          <button
            onClick={toggleSidebar}
            className="rounded p-1.5 text-text-tertiary hover:bg-background-hover hover:text-text-primary transition-colors flex-shrink-0"
            title={sidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
          >
            <Bars3Icon className="h-5 w-5" />
          </button>

          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-text-primary truncate">
              {currentConversation.title}
            </h1>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Mode Selector */}
          <ModeSelector />

          {/* Model Selector */}
          <ModelSelector />

          {/* Vision / Screenshot */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleVision}
            leftIcon={<CameraIcon className="h-4 w-4" />}
          >
            Vision
          </Button>

          {/* Timeline / Time Travel */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTimeline}
            leftIcon={<ClockIcon className="h-4 w-4" />}
          >
            Timeline
          </Button>

          {/* Export */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            leftIcon={<DocumentArrowDownIcon className="h-4 w-4" />}
          >
            Export
          </Button>

          {/* Usage & Receipts */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAudit}
            leftIcon={<ChartBarIcon className="h-4 w-4" />}
          >
            Usage
          </Button>

          {/* Background Jobs */}
          <BackgroundJobIndicator />

          {/* Settings */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSettings}
          >
            <Cog6ToothIcon className="h-5 w-5" />
          </Button>
        </div>
      </header>
      
      {/* Branch Indicator */}
      {currentConversation.branches && currentConversation.branches.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border-primary bg-background-tertiary/50">
          <ArrowsRightLeftIcon className="h-3.5 w-3.5 text-text-tertiary" />
          <span className="text-xs text-text-secondary">
            {currentConversation.branches.length} branch{currentConversation.branches.length !== 1 ? 'es' : ''}
          </span>
          {currentConversation.currentBranchId && (
            <span className="text-xs text-brand-primary">
              Active: {currentConversation.branches.find(b => b.id === currentConversation.currentBranchId)?.name || 'Main'}
            </span>
          )}
          <div className="flex-1" />
          {currentConversation.branches.map(branch => (
            <button
              key={branch.id}
              onClick={() => useChatStore.getState().switchBranch(currentConversation.id, branch.id)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                branch.id === currentConversation.currentBranchId
                  ? 'bg-brand-primary/20 text-brand-primary'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-background-hover'
              }`}
            >
              {branch.name}
            </button>
          ))}
        </div>
      )}

      {/* Messages Container */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto"
      >
        {/* Message List */}
        <MessageList
          messages={currentConversation.messages}
          conversationId={currentConversation.id}
        />
        
        {/* Scroll to Bottom Button */}
        <AnimatePresence>
          {showScrollButton && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2"
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={scrollToBottom}
                className="shadow-lg"
                leftIcon={<ArrowDownIcon className="h-4 w-4" />}
              >
                Scroll to bottom
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Input Area */}
      <InputArea conversationId={currentConversation.id} />
    </div>
  );
}
