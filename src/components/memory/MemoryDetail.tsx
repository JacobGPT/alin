/**
 * Memory Detail - Full Memory View Component
 *
 * Displays complete details of a selected memory including
 * content, metadata, relationships, and edit history.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  XMarkIcon,
  PencilIcon,
  TrashIcon,
  BookmarkIcon,
  ClockIcon,
  EyeIcon,
  LinkIcon,
  TagIcon,
  SparklesIcon,
  ChevronRightIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolid } from '@heroicons/react/24/solid';

// Store
import { useMemoryStore } from '@store/memoryStore';

// Components
import { Button } from '@components/ui/Button';

// Types
import { MemoryLayer, type MemoryEntry } from '../../types/memory';

// ============================================================================
// LAYER CONFIGURATION
// ============================================================================

const LAYER_CONFIG: Record<MemoryLayer, { color: string; bgColor: string; label: string }> = {
  [MemoryLayer.SHORT_TERM]: { color: 'text-blue-400', bgColor: 'bg-blue-500/10', label: 'Short-Term' },
  [MemoryLayer.LONG_TERM]: { color: 'text-purple-400', bgColor: 'bg-purple-500/10', label: 'Long-Term' },
  [MemoryLayer.SEMANTIC]: { color: 'text-green-400', bgColor: 'bg-green-500/10', label: 'Semantic' },
  [MemoryLayer.RELATIONAL]: { color: 'text-amber-400', bgColor: 'bg-amber-500/10', label: 'Relational' },
  [MemoryLayer.PROCEDURAL]: { color: 'text-pink-400', bgColor: 'bg-pink-500/10', label: 'Procedural' },
  [MemoryLayer.WORKING]: { color: 'text-indigo-400', bgColor: 'bg-indigo-500/10', label: 'Working' },
  [MemoryLayer.EPISODIC]: { color: 'text-teal-400', bgColor: 'bg-teal-500/10', label: 'Episodic' },
  [MemoryLayer.META]: { color: 'text-violet-400', bgColor: 'bg-violet-500/10', label: 'Meta' },
};

const DEFAULT_LAYER_CONFIG = { color: 'text-gray-400', bgColor: 'bg-gray-500/10', label: 'Unknown' };

// ============================================================================
// MEMORY DETAIL COMPONENT
// ============================================================================

interface MemoryDetailProps {
  memory: MemoryEntry;
  onClose: () => void;
}

export function MemoryDetail({ memory, onClose }: MemoryDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memory.content);
  const [editTags, setEditTags] = useState(memory.tags.join(', '));

  // Store actions
  const updateMemory = useMemoryStore((state) => state.updateMemory);
  const deleteMemory = useMemoryStore((state) => state.deleteMemory);
  const findRelated = useMemoryStore((state) => state.findRelated);
  const getMemory = useMemoryStore((state) => state.getMemory);

  const layerConfig = LAYER_CONFIG[memory.layer] || DEFAULT_LAYER_CONFIG;
  const relatedMemories = findRelated(memory.id, 5);

  // Handle save
  const handleSave = () => {
    updateMemory(memory.id, {
      content: editContent,
      tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
      userModified: true,
    });
    setIsEditing(false);
  };

  // Handle delete
  const handleDelete = () => {
    if (confirm('Delete this memory? This action cannot be undone.')) {
      deleteMemory(memory.id);
      onClose();
    }
  };

  // Handle pin toggle
  const handleTogglePin = () => {
    updateMemory(memory.id, { isPinned: !memory.isPinned });
  };

  return (
    <div className="flex h-full flex-col bg-background-primary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-primary bg-background-secondary px-6 py-4">
        <div className="flex items-center gap-3">
          <span className={`${layerConfig.bgColor} ${layerConfig.color} rounded-full px-3 py-1 text-sm font-medium`}>
            {layerConfig.label}
          </span>
          {memory.isPinned && (
            <BookmarkSolid className="h-5 w-5 text-brand-primary" />
          )}
          {memory.isArchived && (
            <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-text-tertiary">
              Archived
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleTogglePin}
            leftIcon={memory.isPinned ? <BookmarkSolid className="h-4 w-4" /> : <BookmarkIcon className="h-4 w-4" />}
          >
            {memory.isPinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
            leftIcon={<PencilIcon className="h-4 w-4" />}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            leftIcon={<TrashIcon className="h-4 w-4" />}
          >
            Delete
          </Button>
          <button
            onClick={onClose}
            className="ml-2 rounded-lg p-2 text-text-tertiary hover:bg-background-tertiary hover:text-text-primary"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Main Content */}
          <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
            <h3 className="mb-4 font-semibold text-text-primary">Content</h3>
            {isEditing ? (
              <div className="space-y-4">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="h-48 w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-3 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <Button variant="primary" size="sm" onClick={handleSave} leftIcon={<CheckIcon className="h-4 w-4" />}>
                    Save
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-text-secondary">{memory.content}</p>
            )}
          </div>

          {/* Tags */}
          <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
            <div className="mb-4 flex items-center gap-2">
              <TagIcon className="h-5 w-5 text-text-tertiary" />
              <h3 className="font-semibold text-text-primary">Tags</h3>
            </div>
            {isEditing ? (
              <input
                type="text"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="Enter tags separated by commas"
                className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
              />
            ) : memory.tags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {memory.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-background-tertiary px-3 py-1 text-sm text-text-secondary"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-tertiary">No tags</p>
            )}
          </div>

          {/* Metadata */}
          <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
            <h3 className="mb-4 font-semibold text-text-primary">Metadata</h3>
            <div className="grid grid-cols-2 gap-4">
              <MetadataItem
                icon={<SparklesIcon className="h-4 w-4" />}
                label="Salience"
                value={`${Math.round(memory.salience * 100)}%`}
              />
              <MetadataItem
                icon={<ClockIcon className="h-4 w-4" />}
                label="Created"
                value={formatDateTime(memory.createdAt)}
              />
              <MetadataItem
                icon={<ClockIcon className="h-4 w-4" />}
                label="Last Accessed"
                value={formatDateTime(memory.lastAccessedAt)}
              />
              <MetadataItem
                icon={<EyeIcon className="h-4 w-4" />}
                label="Access Count"
                value={memory.accessCount.toString()}
              />
              <MetadataItem
                icon={<LinkIcon className="h-4 w-4" />}
                label="Related Memories"
                value={memory.relatedMemories.length.toString()}
              />
              <MetadataItem
                icon={<SparklesIcon className="h-4 w-4" />}
                label="Decay Rate"
                value={`${memory.decayRate * 100}%/day`}
              />
            </div>
          </div>

          {/* Related Memories */}
          {relatedMemories.length > 0 && (
            <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
              <div className="mb-4 flex items-center gap-2">
                <LinkIcon className="h-5 w-5 text-text-tertiary" />
                <h3 className="font-semibold text-text-primary">Related Memories</h3>
              </div>
              <div className="space-y-2">
                {relatedMemories.map((related) => {
                  const relatedConfig = LAYER_CONFIG[related.layer] || DEFAULT_LAYER_CONFIG;
                  return (
                    <button
                      key={related.id}
                      className="flex w-full items-center gap-3 rounded-lg bg-background-tertiary p-3 text-left transition-colors hover:bg-background-hover"
                    >
                      <span className={`${relatedConfig.bgColor} ${relatedConfig.color} rounded-full px-2 py-0.5 text-xs font-medium`}>
                        {relatedConfig.label}
                      </span>
                      <span className="flex-1 truncate text-sm text-text-primary">
                        {related.content.slice(0, 100)}...
                      </span>
                      <ChevronRightIcon className="h-4 w-4 text-text-tertiary" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Edit History */}
          {memory.editHistory && memory.editHistory.length > 0 && (
            <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
              <h3 className="mb-4 font-semibold text-text-primary">Edit History</h3>
              <div className="space-y-3">
                {memory.editHistory.map((edit, index) => (
                  <div
                    key={index}
                    className="rounded-lg bg-background-tertiary p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-text-tertiary">
                        {formatDateTime(edit.timestamp)}
                      </span>
                      {edit.reason && (
                        <span className="text-xs text-text-secondary">{edit.reason}</span>
                      )}
                    </div>
                    <div className="text-sm">
                      <p className="line-through text-text-tertiary">{edit.previousContent.slice(0, 100)}...</p>
                      <p className="text-text-primary">{edit.newContent.slice(0, 100)}...</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function MetadataItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-background-tertiary p-3">
      <div className="text-text-tertiary">{icon}</div>
      <div>
        <p className="text-xs text-text-tertiary">{label}</p>
        <p className="text-sm font-medium text-text-primary">{value}</p>
      </div>
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default MemoryDetail;
