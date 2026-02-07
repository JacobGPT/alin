/**
 * Memory Timeline - Chronological Memory View
 *
 * Displays memories in a timeline format grouped by time periods.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ClockIcon,
  CalendarIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

// Types
import { MemoryLayer, type MemoryEntry } from '../../types/memory';

// ============================================================================
// LAYER COLORS
// ============================================================================

const LAYER_COLORS: Record<MemoryLayer, { bg: string; text: string; border: string }> = {
  [MemoryLayer.SHORT_TERM]: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500' },
  [MemoryLayer.LONG_TERM]: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500' },
  [MemoryLayer.SEMANTIC]: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500' },
  [MemoryLayer.RELATIONAL]: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500' },
  [MemoryLayer.PROCEDURAL]: { bg: 'bg-pink-500/10', text: 'text-pink-400', border: 'border-pink-500' },
  [MemoryLayer.WORKING]: { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500' },
  [MemoryLayer.EPISODIC]: { bg: 'bg-teal-500/10', text: 'text-teal-400', border: 'border-teal-500' },
  [MemoryLayer.META]: { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500' },
};

// ============================================================================
// MEMORY TIMELINE COMPONENT
// ============================================================================

interface MemoryTimelineProps {
  memories: MemoryEntry[];
  onSelectMemory: (id: string) => void;
}

export function MemoryTimeline({ memories, onSelectMemory }: MemoryTimelineProps) {
  // Group memories by time period
  const groupedMemories = useMemo(() => {
    const now = Date.now();
    const groups: { label: string; memories: MemoryEntry[] }[] = [
      { label: 'Today', memories: [] },
      { label: 'Yesterday', memories: [] },
      { label: 'This Week', memories: [] },
      { label: 'This Month', memories: [] },
      { label: 'Older', memories: [] },
    ];

    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    const monthMs = 30 * dayMs;

    // Sort by creation time (newest first)
    const sorted = [...memories].sort((a, b) => b.createdAt - a.createdAt);

    sorted.forEach((memory) => {
      const age = now - memory.createdAt;

      if (age < dayMs) {
        groups[0].memories.push(memory);
      } else if (age < 2 * dayMs) {
        groups[1].memories.push(memory);
      } else if (age < weekMs) {
        groups[2].memories.push(memory);
      } else if (age < monthMs) {
        groups[3].memories.push(memory);
      } else {
        groups[4].memories.push(memory);
      }
    });

    return groups.filter((g) => g.memories.length > 0);
  }, [memories]);

  if (memories.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-background-tertiary">
          <CalendarIcon className="h-8 w-8 text-text-tertiary" />
        </div>
        <h3 className="mb-2 font-semibold text-text-primary">No Memories</h3>
        <p className="text-sm text-text-tertiary">
          Your memory timeline will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-text-primary">Memory Timeline</h2>
          <p className="text-text-tertiary">{memories.length} memories total</p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border-primary" />

          {groupedMemories.map((group, groupIndex) => (
            <div key={group.label} className="mb-8">
              {/* Group Header */}
              <div className="relative mb-4 flex items-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary text-white">
                  <CalendarIcon className="h-6 w-6" />
                </div>
                <h3 className="ml-4 text-lg font-semibold text-text-primary">{group.label}</h3>
                <span className="ml-2 rounded-full bg-background-tertiary px-2 py-0.5 text-sm text-text-tertiary">
                  {group.memories.length}
                </span>
              </div>

              {/* Group Memories */}
              <div className="ml-6 space-y-4 border-l border-border-primary pl-6">
                {group.memories.map((memory, index) => (
                  <TimelineItem
                    key={memory.id}
                    memory={memory}
                    onClick={() => onSelectMemory(memory.id)}
                    delay={index * 0.05}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TIMELINE ITEM
// ============================================================================

interface TimelineItemProps {
  memory: MemoryEntry;
  onClick: () => void;
  delay: number;
}

function TimelineItem({ memory, onClick, delay }: TimelineItemProps) {
  const colors = LAYER_COLORS[memory.layer];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className={`relative cursor-pointer rounded-xl border-l-4 ${colors.border} bg-background-secondary p-4 shadow-sm transition-all hover:bg-background-hover hover:shadow-md`}
      onClick={onClick}
    >
      {/* Timeline dot */}
      <div className={`absolute -left-[calc(1.5rem+2px)] top-5 h-3 w-3 rounded-full ${colors.border.replace('border-', 'bg-')}`} />

      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className={`${colors.bg} ${colors.text} rounded-full px-2 py-0.5 text-xs font-medium`}>
          {memory.layer.replace('_', ' ')}
        </span>
        <div className="flex items-center gap-1 text-xs text-text-tertiary">
          <ClockIcon className="h-3 w-3" />
          {formatTime(memory.createdAt)}
        </div>
      </div>

      {/* Content */}
      <p className="mb-2 text-sm text-text-primary line-clamp-3">{memory.content}</p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        {/* Tags */}
        {memory.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {memory.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded bg-background-tertiary px-1.5 py-0.5 text-xs text-text-tertiary"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Salience */}
        <div className="flex items-center gap-1 text-xs text-text-tertiary">
          <SparklesIcon className="h-3 w-3" />
          {Math.round(memory.salience * 100)}%
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default MemoryTimeline;
