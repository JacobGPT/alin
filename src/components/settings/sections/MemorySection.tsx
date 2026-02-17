/**
 * Memory Settings Section — User-friendly memory management
 * Hides internal mechanics (layers, salience, consolidation) behind simple controls.
 */

import { useState, useMemo } from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { useMemoryStore } from '@store/memoryStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';
import { TrashIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export function MemorySection() {
  const memory = useSettingsStore((state) => state.memory);
  const updateMemoryPreferences = useSettingsStore((state) => state.updateMemoryPreferences);
  const [showBrowser, setShowBrowser] = useState(false);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Memory"
        description="ALIN remembers your preferences, past conversations, and project context across sessions."
      />

      <SettingToggle
        label="Enable Memory"
        description="Let ALIN remember things about you and your projects between conversations"
        checked={memory.enabled}
        onChange={(checked) => updateMemoryPreferences({ enabled: checked })}
      />

      <SettingToggle
        label="Auto-organize memories"
        description="Automatically organize and prioritize stored memories over time"
        checked={memory.autoConsolidate}
        onChange={(checked) => updateMemoryPreferences({ autoConsolidate: checked })}
        disabled={!memory.enabled}
      />

      <SettingsCard title="How long to keep memories">
        <div className="space-y-2">
          <select
            value={memory.retentionPeriod === 0 ? 'forever' : String(memory.retentionPeriod)}
            onChange={(e) => updateMemoryPreferences({ retentionPeriod: e.target.value === 'forever' ? 0 : parseInt(e.target.value) })}
            disabled={!memory.enabled}
            className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">6 months</option>
            <option value="365">1 year</option>
            <option value="forever">Forever</option>
          </select>
          <p className="text-xs text-text-quaternary">
            Older memories will be automatically removed. Important memories (corrections, preferences) are kept longer.
          </p>
        </div>
      </SettingsCard>

      {/* Memory Stats + Manager */}
      <SettingsCard title="Stored memories">
        <div className="space-y-3">
          <MemoryStatsBar />
          <div className="flex gap-2">
            <button
              onClick={() => setShowBrowser(!showBrowser)}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-brand-primary/30 bg-brand-primary/10 px-4 py-2.5 text-sm font-medium text-brand-primary hover:bg-brand-primary/20 transition-colors"
            >
              <MagnifyingGlassIcon className="h-4 w-4" />
              {showBrowser ? 'Hide' : 'View & Manage'}
            </button>
            <button
              onClick={() => {
                if (confirm('Delete all memories? This cannot be undone.')) {
                  useMemoryStore.getState().clearAllMemories();
                }
              }}
              className="flex items-center gap-2 rounded-lg border border-semantic-error/30 bg-semantic-error/10 px-4 py-2.5 text-sm font-medium text-semantic-error hover:bg-semantic-error/20 transition-colors"
            >
              <TrashIcon className="h-4 w-4" />
              Clear All
            </button>
          </div>
        </div>
      </SettingsCard>

      {showBrowser && <MemoryBrowser />}
    </div>
  );
}

// ============================================================================
// MEMORY STATS BAR — friendly display
// ============================================================================

function MemoryStatsBar() {
  const memories = useMemoryStore((state) => state.memories);
  const totalCount = memories.size;

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    memories.forEach((mem) => {
      // Map internal layer names to friendly labels
      const friendly = FRIENDLY_LABELS[mem.layer] || mem.layer;
      counts[friendly] = (counts[friendly] || 0) + 1;
    });
    return counts;
  }, [memories]);

  if (totalCount === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        No memories yet. ALIN will start remembering as you chat.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <span className="rounded-full bg-brand-primary/15 px-3 py-1 text-xs font-medium text-brand-primary">
        {totalCount} total
      </span>
      {Object.entries(categoryCounts).map(([label, count]) => (
        <span key={label} className="rounded-full bg-background-tertiary px-3 py-1 text-xs text-text-secondary">
          {label}: {count}
        </span>
      ))}
    </div>
  );
}

// Friendly layer labels
const FRIENDLY_LABELS: Record<string, string> = {
  short_term: 'Recent',
  long_term: 'Long-term',
  semantic: 'Knowledge',
  relational: 'Connections',
  procedural: 'Skills',
  working: 'Active',
  episodic: 'Conversations',
  meta: 'Meta',
};

const FRIENDLY_COLORS: Record<string, string> = {
  short_term: 'bg-blue-500/15 text-blue-400',
  long_term: 'bg-purple-500/15 text-purple-400',
  semantic: 'bg-green-500/15 text-green-400',
  relational: 'bg-pink-500/15 text-pink-400',
  procedural: 'bg-orange-500/15 text-orange-400',
  working: 'bg-yellow-500/15 text-yellow-400',
  episodic: 'bg-cyan-500/15 text-cyan-400',
  meta: 'bg-gray-500/15 text-gray-400',
};

// ============================================================================
// MEMORY BROWSER — simplified
// ============================================================================

function MemoryBrowser() {
  const memories = useMemoryStore((state) => state.memories);
  const deleteMemory = useMemoryStore((state) => state.deleteMemory);
  const deleteMultipleMemories = useMemoryStore((state) => state.deleteMultipleMemories);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterLayer, setFilterLayer] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMemories = useMemo(() => {
    const all = Array.from(memories.values());
    return all
      .filter((mem) => {
        if (filterLayer !== 'all' && mem.layer !== filterLayer) return false;
        if (searchQuery && !mem.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [memories, filterLayer, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected memories? This cannot be undone.`)) return;
    deleteMultipleMemories(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const formatDate = (ts: number) => {
    if (!ts || isNaN(ts) || ts <= 0) return 'Unknown';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary overflow-hidden">
      {/* Search & filter */}
      <div className="flex flex-col gap-2 border-b border-border-primary bg-background-tertiary/50 p-3">
        <input
          type="text"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <select
              value={filterLayer}
              onChange={(e) => setFilterLayer(e.target.value)}
              className="rounded-lg border border-border-primary bg-background-tertiary px-2 py-1 text-xs text-text-primary focus:border-brand-primary focus:outline-none"
            >
              <option value="all">All types</option>
              {Object.entries(FRIENDLY_LABELS).map(([layer, label]) => (
                <option key={layer} value={layer}>{label}</option>
              ))}
            </select>
            <span className="text-xs text-text-tertiary">{filteredMemories.length} memories</span>
          </div>
          {selectedIds.size > 0 && (
            <button
              onClick={deleteSelected}
              className="flex items-center gap-1 rounded bg-semantic-error/10 px-2 py-1 text-xs font-medium text-semantic-error hover:bg-semantic-error/20 transition-colors"
            >
              <TrashIcon className="h-3 w-3" />
              Delete {selectedIds.size}
            </button>
          )}
        </div>
      </div>

      {/* Memory list */}
      <div className="max-h-[400px] overflow-y-auto divide-y divide-border-primary">
        {filteredMemories.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-tertiary">
            {memories.size === 0 ? 'No memories yet' : 'No memories match your search'}
          </div>
        ) : (
          filteredMemories.map((mem) => (
            <div
              key={mem.id}
              className={`flex items-start gap-3 px-3 py-2.5 hover:bg-background-tertiary/50 transition-colors ${
                selectedIds.has(mem.id) ? 'bg-brand-primary/5' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(mem.id)}
                onChange={() => toggleSelect(mem.id)}
                className="mt-1 h-3.5 w-3.5 rounded border-border-primary accent-brand-primary cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary line-clamp-2 leading-snug">{mem.content}</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${FRIENDLY_COLORS[mem.layer] || 'bg-gray-500/15 text-gray-400'}`}>
                    {FRIENDLY_LABELS[mem.layer] || mem.layer}
                  </span>
                  <span className="text-[10px] text-text-quaternary">{formatDate(mem.createdAt)}</span>
                </div>
              </div>
              <button
                onClick={() => {
                  deleteMemory(mem.id);
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(mem.id);
                    return next;
                  });
                }}
                className="mt-0.5 rounded p-1 text-text-quaternary hover:bg-semantic-error/10 hover:text-semantic-error transition-colors"
                title="Delete"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
