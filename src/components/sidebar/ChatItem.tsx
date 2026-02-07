/**
 * ChatItem - Individual Conversation Entry
 *
 * Clean, compact chat list item with:
 * - Title + relative time
 * - Favorite star
 * - Hover actions dropdown
 * - Active indicator
 */

import { useState } from 'react';
import {
  StarIcon,
  EllipsisHorizontalIcon,
  ArchiveBoxIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid, ChatBubbleLeftIcon } from '@heroicons/react/24/solid';

// Types
import type { ConversationSummary } from '../../types/chat';

// Components
import { Dropdown } from '@components/ui/Dropdown';

// ============================================================================
// CHATITEM COMPONENT
// ============================================================================

interface ChatItemProps {
  conversation: ConversationSummary;
  isActive: boolean;
  onClick: () => void;
  onToggleFavorite: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onExport: () => void;
}

export function ChatItem({
  conversation,
  isActive,
  onClick,
  onToggleFavorite,
  onArchive,
  onDelete,
  onExport,
}: ChatItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(conversation.title);

  const handleEditTitle = () => {
    setIsEditing(true);
  };

  const handleSaveTitle = () => {
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      setEditedTitle(conversation.title);
      setIsEditing(false);
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group relative flex items-center gap-2 rounded-lg px-2 py-2 cursor-pointer transition-colors ${
        isActive
          ? 'bg-background-elevated'
          : 'hover:bg-background-hover'
      }`}
    >
      {/* Active Indicator */}
      {isActive && (
        <div className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand-primary" />
      )}

      {/* Icon */}
      <ChatBubbleLeftIcon className={`h-3.5 w-3.5 flex-shrink-0 ${
        isActive ? 'text-brand-primary' : 'text-text-quaternary'
      }`} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={handleKeyDown}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-brand-primary bg-background-primary px-1.5 py-0.5 text-xs font-medium text-text-primary focus:outline-none"
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="flex-1 truncate text-xs font-medium text-text-primary">
              {conversation.title}
            </span>
            {conversation.isFavorite && (
              <StarIconSolid className="h-3 w-3 flex-shrink-0 text-brand-accent" />
            )}
          </div>
        )}
        <span className="text-[10px] text-text-quaternary">
          {formatRelativeTime(conversation.updatedAt)}
        </span>
      </div>

      {/* Actions - stop propagation so dropdown doesn't trigger navigation */}
      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onToggleFavorite}
          className="rounded p-1 transition-colors hover:bg-background-elevated"
        >
          {conversation.isFavorite ? (
            <StarIconSolid className="h-3.5 w-3.5 text-brand-accent" />
          ) : (
            <StarIcon className="h-3.5 w-3.5 text-text-quaternary" />
          )}
        </button>

        <Dropdown
          trigger={
            <button className="rounded p-1 transition-colors hover:bg-background-elevated">
              <EllipsisHorizontalIcon className="h-3.5 w-3.5 text-text-quaternary" />
            </button>
          }
          items={[
            {
              id: 'edit',
              label: 'Rename',
              icon: <PencilIcon className="h-4 w-4" />,
              onClick: () => handleEditTitle(),
            },
            {
              id: 'export',
              label: 'Export',
              icon: <ArrowDownTrayIcon className="h-4 w-4" />,
              onClick: () => onExport(),
            },
            {
              id: 'archive',
              label: 'Archive',
              icon: <ArchiveBoxIcon className="h-4 w-4" />,
              onClick: () => onArchive(),
            },
            {
              id: 'divider-1',
              label: '',
              onClick: () => {},
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <TrashIcon className="h-4 w-4" />,
              dangerous: true,
              onClick: () => onDelete(),
            },
          ]}
        />
      </div>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  if (!timestamp || isNaN(timestamp) || timestamp <= 0) {
    return 'Unknown';
  }

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 0 || diff > 10 * 365 * 24 * 60 * 60 * 1000) {
    return 'Unknown';
  }

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return 'Just now';
  } else if (minutes < 60) {
    return `${minutes}m ago`;
  } else if (hours < 24) {
    return `${hours}h ago`;
  } else if (days < 7) {
    return `${days}d ago`;
  } else {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Unknown';
    }
    return date.toLocaleDateString();
  }
}
