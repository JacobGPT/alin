/**
 * Sidebar - Chat History and Navigation
 *
 * UPDATED: Header moved to AppShell (home button + collapse).
 * This component now focuses purely on chat list + actions.
 * All existing functionality preserved.
 */

import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ArchiveBoxIcon,
  ArrowUpTrayIcon,
  ChatBubbleLeftIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  ShieldCheckIcon,
  ArrowRightStartOnRectangleIcon,
} from '@heroicons/react/24/outline';

// Types
import type { ConversationSummary } from '../../types/chat';

// Store
import { useChatStore } from '@store/chatStore';
import { useUIStore } from '@store/uiStore';
import { useAuthStore } from '@store/authStore';

// Hooks
import { useCapabilities } from '../../hooks/useCapabilities';

// Components
import { ChatItem } from './ChatItem';
import { Input } from '@components/ui/Input';
import { PlanBadge } from '@components/auth/PlanBadge';

// ============================================================================
// SIDEBAR COMPONENT
// ============================================================================

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showSearch, setShowSearch] = useState(false);

  // Store state
  const conversations = useChatStore((state) => state.getConversationSummaries());
  const rawCurrentConversationId = useChatStore((state) => state.currentConversationId);
  // Don't highlight any chat when on a non-chat route (TBWO, Memory, etc.)
  const isOnChatRoute = location.pathname === '/' || location.pathname.startsWith('/chat');
  const currentConversationId = isOnChatRoute ? rawCurrentConversationId : null;
  const searchQuery = useChatStore((state) => state.searchQuery);
  const filter = useChatStore((state) => state.filter);

  // Store actions
  const createConversation = useChatStore((state) => state.createConversation);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const setSearchQuery = useChatStore((state) => state.setSearchQuery);
  const updateFilter = useChatStore((state) => state.updateFilter);
  const deleteConversation = useChatStore((state) => state.deleteConversation);
  const updateConversation = useChatStore((state) => state.updateConversation);
  const exportConversation = useChatStore((state) => state.exportConversation);

  const openModal = useUIStore((state) => state.openModal);
  const showSuccess = useUIStore((state) => state.showSuccess);

  // Auth
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const caps = useCapabilities();

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleNewChat = () => {
    const id = createConversation({ title: 'New Chat' });
    setCurrentConversation(id);
    navigate(`/chat/${id}`);
  };

  const handleSelectConversation = (id: string) => {
    setCurrentConversation(id);
    navigate(`/chat/${id}`);
  };

  const handleToggleFavorite = (id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      updateConversation(id, { isFavorite: !conv.isFavorite });
    }
  };

  const handleArchive = (id: string) => {
    updateConversation(id, { isArchived: true });
    showSuccess('Conversation archived');
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this conversation?')) {
      deleteConversation(id);
    }
  };

  const handleExport = async (id: string) => {
    try {
      const data = await exportConversation(id);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversation-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccess('Exported');
    } catch (error) {
      console.error('Export failed:', error);
    }
  };

  const handleImport = () => {
    openModal({ type: 'import-chat' });
  };

  // ========================================================================
  // FILTERED & GROUPED CONVERSATIONS
  // ========================================================================

  const filteredConversations = useMemo(() => {
    return conversations;
  }, [conversations]);

  const groupedConversations = useMemo(() => {
    const today = new Date().setHours(0, 0, 0, 0);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const lastWeek = today - 7 * 24 * 60 * 60 * 1000;
    const lastMonth = today - 30 * 24 * 60 * 60 * 1000;

    const groups = {
      today: [] as typeof filteredConversations,
      yesterday: [] as typeof filteredConversations,
      lastWeek: [] as typeof filteredConversations,
      lastMonth: [] as typeof filteredConversations,
      older: [] as typeof filteredConversations,
    };

    filteredConversations.forEach((conv) => {
      if (conv.updatedAt >= today) {
        groups.today.push(conv);
      } else if (conv.updatedAt >= yesterday) {
        groups.yesterday.push(conv);
      } else if (conv.updatedAt >= lastWeek) {
        groups.lastWeek.push(conv);
      } else if (conv.updatedAt >= lastMonth) {
        groups.lastMonth.push(conv);
      } else {
        groups.older.push(conv);
      }
    });

    return groups;
  }, [filteredConversations]);

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="flex h-full flex-col">
      {/* Action bar: new chat + search + filters */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-quaternary">
          Chats
        </span>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`rounded-md p-1.5 transition-colors ${
              showSearch ? 'bg-background-elevated text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-background-hover'
            }`}
            title="Search"
          >
            <MagnifyingGlassIcon className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={handleImport}
            className="rounded-md p-1.5 text-text-tertiary hover:text-text-secondary hover:bg-background-hover transition-colors"
            title="Import"
          >
            <ArrowUpTrayIcon className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => updateFilter({ showArchived: !filter.showArchived })}
            className={`rounded-md p-1.5 transition-colors ${
              filter.showArchived ? 'bg-background-elevated text-text-primary' : 'text-text-tertiary hover:text-text-secondary hover:bg-background-hover'
            }`}
            title={filter.showArchived ? 'Hide archived' : 'Show archived'}
          >
            <ArchiveBoxIcon className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={handleNewChat}
            className="rounded-md p-1.5 text-brand-primary hover:bg-brand-primary/10 transition-colors"
            title="New chat (⌘⇧N)"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2">
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                leftIcon={<MagnifyingGlassIcon className="h-3.5 w-3.5" />}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Divider */}
      <div className="mx-3 border-t border-border-primary/50" />

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto sidebar-scroll px-2 py-2">
        {filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <ChatBubbleLeftIcon className="h-7 w-7 text-text-quaternary mb-2" />
            <p className="text-xs text-text-tertiary">
              {searchQuery ? 'No results' : 'No conversations yet'}
            </p>
            {!searchQuery && (
              <button
                onClick={handleNewChat}
                className="mt-3 text-xs text-brand-primary hover:text-brand-primary-hover transition-colors"
              >
                Start a new chat
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {groupedConversations.today.length > 0 && (
              <ConversationGroup
                title="Today"
                conversations={groupedConversations.today}
                currentId={currentConversationId}
                onSelect={handleSelectConversation}
                onToggleFavorite={handleToggleFavorite}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onExport={handleExport}
              />
            )}

            {groupedConversations.yesterday.length > 0 && (
              <ConversationGroup
                title="Yesterday"
                conversations={groupedConversations.yesterday}
                currentId={currentConversationId}
                onSelect={handleSelectConversation}
                onToggleFavorite={handleToggleFavorite}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onExport={handleExport}
              />
            )}

            {groupedConversations.lastWeek.length > 0 && (
              <ConversationGroup
                title="Last 7 days"
                conversations={groupedConversations.lastWeek}
                currentId={currentConversationId}
                onSelect={handleSelectConversation}
                onToggleFavorite={handleToggleFavorite}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onExport={handleExport}
              />
            )}

            {groupedConversations.lastMonth.length > 0 && (
              <ConversationGroup
                title="Last 30 days"
                conversations={groupedConversations.lastMonth}
                currentId={currentConversationId}
                onSelect={handleSelectConversation}
                onToggleFavorite={handleToggleFavorite}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onExport={handleExport}
              />
            )}

            {groupedConversations.older.length > 0 && (
              <ConversationGroup
                title="Older"
                conversations={groupedConversations.older}
                currentId={currentConversationId}
                onSelect={handleSelectConversation}
                onToggleFavorite={handleToggleFavorite}
                onArchive={handleArchive}
                onDelete={handleDelete}
                onExport={handleExport}
              />
            )}
          </div>
        )}
      </div>

      {/* Bottom navigation links */}
      <div className="border-t border-border-primary/50 px-2 py-2 space-y-0.5">
        {caps.canTBWO && (
          <SidebarNavLink
            icon={CommandLineIcon}
            label="TBWO Command"
            href="/tbwo"
            active={location.pathname.startsWith('/tbwo')}
            onClick={() => navigate('/tbwo')}
          />
        )}
        <SidebarNavLink
          icon={CpuChipIcon}
          label="Memory"
          href="/memory"
          active={location.pathname === '/memory'}
          onClick={() => navigate('/memory')}
        />
        <SidebarNavLink
          icon={ShieldCheckIcon}
          label="Trust Center"
          href="/trust"
          active={location.pathname === '/trust'}
          onClick={() => navigate('/trust')}
        />
        <SidebarNavLink
          icon={Cog6ToothIcon}
          label="Settings"
          href="/settings"
          active={false}
          onClick={() => openModal({ type: 'settings' })}
        />
      </div>

      {/* User info & logout */}
      {user && (
        <div className="border-t border-border-primary/50 px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-primary/20 text-[10px] font-bold text-brand-primary">
                {(user.displayName || user.email)[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-text-secondary">
                  {user.displayName || user.email.split('@')[0]}
                </p>
                <PlanBadge plan={user.plan} />
              </div>
            </div>
            <button
              onClick={logout}
              className="rounded-md p-1.5 text-text-quaternary hover:text-text-secondary hover:bg-background-hover transition-colors"
              title="Sign out"
            >
              <ArrowRightStartOnRectangleIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SIDEBAR NAV LINK
// ============================================================================

interface SidebarNavLinkProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  active: boolean;
  onClick: () => void;
}

function SidebarNavLink({ icon: Icon, label, active, onClick }: SidebarNavLinkProps) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active
          ? 'bg-background-elevated text-text-primary'
          : 'text-text-tertiary hover:bg-background-hover hover:text-text-secondary'
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

// ============================================================================
// CONVERSATION GROUP COMPONENT
// ============================================================================

interface ConversationGroupProps {
  title: string;
  conversations: ConversationSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}

function ConversationGroup({
  title,
  conversations,
  currentId,
  onSelect,
  onToggleFavorite,
  onArchive,
  onDelete,
  onExport,
}: ConversationGroupProps) {
  return (
    <div>
      <h3 className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-quaternary">
        {title}
      </h3>
      <div className="space-y-px">
        {conversations.map((conv) => (
          <ChatItem
            key={conv.id}
            conversation={conv}
            isActive={conv.id === currentId}
            onClick={() => onSelect(conv.id)}
            onToggleFavorite={() => onToggleFavorite(conv.id)}
            onArchive={() => onArchive(conv.id)}
            onDelete={() => onDelete(conv.id)}
            onExport={() => onExport(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}
