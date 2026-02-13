/**
 * Memory Settings Section (includes MemoryStatsBar + MemoryBrowser sub-components)
 */

import { useState, useMemo } from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { useMemoryStore } from '@store/memoryStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';
import { MemoryLayer } from '../../../types/memory';
import { TrashIcon } from '@heroicons/react/24/outline';

export function MemorySection() {
  const memory = useSettingsStore((state) => state.memory);
  const updateMemoryPreferences = useSettingsStore((state) => state.updateMemoryPreferences);
  const [showBrowser, setShowBrowser] = useState(false);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Memory Settings"
        description="Configure the 8-layer memory system"
      />

      <SettingToggle
        label="Enable Memory"
        description="Allow ALIN to form and recall memories"
        checked={memory.enabled}
        onChange={(checked) => updateMemoryPreferences({ enabled: checked })}
      />

      <SettingToggle
        label="Auto Consolidate"
        description="Automatically consolidate short-term memories"
        checked={memory.autoConsolidate}
        onChange={(checked) => updateMemoryPreferences({ autoConsolidate: checked })}
        disabled={!memory.enabled}
      />

      <SettingsCard title="Consolidation Interval (minutes)">
        <input
          type="number"
          value={memory.consolidationInterval}
          onChange={(e) => updateMemoryPreferences({ consolidationInterval: parseInt(e.target.value) })}
          min="5"
          max="120"
          disabled={!memory.enabled || !memory.autoConsolidate}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        />
      </SettingsCard>

      <SettingsCard title="Retention Period (days, 0 = forever)">
        <input
          type="number"
          value={memory.retentionPeriod}
          onChange={(e) => updateMemoryPreferences({ retentionPeriod: parseInt(e.target.value) })}
          min="0"
          disabled={!memory.enabled}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        />
      </SettingsCard>

      <SettingsCard title="Max Memories">
        <input
          type="number"
          value={memory.maxMemories}
          onChange={(e) => updateMemoryPreferences({ maxMemories: parseInt(e.target.value) })}
          min="100"
          max="100000"
          disabled={!memory.enabled}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        />
      </SettingsCard>

      {/* Memory Browser / Manager */}
      <SettingsCard title="Memory Manager">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setShowBrowser(!showBrowser)}
              className="flex-1 rounded-lg border border-brand-primary bg-brand-primary/10 px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-primary/20 transition-colors"
            >
              {showBrowser ? 'Hide Memory Browser' : 'Browse & Manage Memories'}
            </button>
            <button
              onClick={() => useMemoryStore.getState().clearAllMemories()}
              className="flex items-center gap-2 rounded-lg border border-semantic-error bg-semantic-error/10 px-4 py-2 text-sm font-medium text-semantic-error hover:bg-semantic-error/20 transition-colors"
            >
              <TrashIcon className="h-4 w-4" />
              Clear All
            </button>
          </div>
          <MemoryStatsBar />
        </div>
      </SettingsCard>

      {showBrowser && <MemoryBrowser />}
    </div>
  );
}

// ============================================================================
// MEMORY STATS BAR
// ============================================================================

function MemoryStatsBar() {
  const memories = useMemoryStore((state) => state.memories);
  const totalCount = memories.size;

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    memories.forEach((mem) => {
      counts[mem.layer] = (counts[mem.layer] || 0) + 1;
    });
    return counts;
  }, [memories]);

  return (
    <div className="flex flex-wrap gap-2 text-xs text-text-tertiary">
      <span className="rounded bg-background-tertiary px-2 py-1">
        Total: <span className="font-medium text-text-primary">{totalCount}</span>
      </span>
      {Object.entries(layerCounts).map(([layer, count]) => (
        <span key={layer} className="rounded bg-background-tertiary px-2 py-1">
          {layer.replace('_', ' ')}: <span className="font-medium text-text-secondary">{count}</span>
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// MEMORY BROWSER
// ============================================================================

function MemoryBrowser() {
  const memories = useMemoryStore((state) => state.memories);
  const deleteMemory = useMemoryStore((state) => state.deleteMemory);
  const deleteMultipleMemories = useMemoryStore((state) => state.deleteMultipleMemories);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterLayer, setFilterLayer] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter and sort memories
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

  const selectAll = () => {
    if (selectedIds.size === filteredMemories.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMemories.map((m) => m.id)));
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected memories? This cannot be undone.`)) return;
    deleteMultipleMemories(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const formatDate = (ts: number) => {
    if (!ts || isNaN(ts) || ts <= 0) return 'Unknown';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const layerColor: Record<string, string> = {
    short_term: 'bg-blue-500/20 text-blue-400',
    long_term: 'bg-purple-500/20 text-purple-400',
    semantic: 'bg-green-500/20 text-green-400',
    relational: 'bg-pink-500/20 text-pink-400',
    procedural: 'bg-orange-500/20 text-orange-400',
    working: 'bg-yellow-500/20 text-yellow-400',
    episodic: 'bg-cyan-500/20 text-cyan-400',
    meta: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-border-primary bg-background-tertiary/50 p-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
        />
        {/* Filter + actions row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <select
              value={filterLayer}
              onChange={(e) => setFilterLayer(e.target.value)}
              className="rounded-lg border border-border-primary bg-background-tertiary px-2 py-1 text-xs text-text-primary focus:border-brand-primary focus:outline-none"
            >
              <option value="all">All Layers</option>
              {Object.values(MemoryLayer).map((layer) => (
                <option key={layer} value={layer}>{layer.replace('_', ' ')}</option>
              ))}
            </select>
            <span className="text-xs text-text-tertiary">{filteredMemories.length} memories</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-colors"
            >
              {selectedIds.size === filteredMemories.length && filteredMemories.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
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
      </div>

      {/* Memory list */}
      <div className="max-h-[400px] overflow-y-auto divide-y divide-border-primary">
        {filteredMemories.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-tertiary">
            {memories.size === 0 ? 'No memories stored yet' : 'No memories match your filter'}
          </div>
        ) : (
          filteredMemories.map((mem) => (
            <div
              key={mem.id}
              className={`flex items-start gap-3 px-3 py-2.5 hover:bg-background-tertiary/50 transition-colors ${
                selectedIds.has(mem.id) ? 'bg-brand-primary/5' : ''
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selectedIds.has(mem.id)}
                onChange={() => toggleSelect(mem.id)}
                className="mt-1 h-3.5 w-3.5 rounded border-border-primary accent-brand-primary cursor-pointer"
              />
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary line-clamp-2 leading-snug">{mem.content}</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${layerColor[mem.layer] || 'bg-gray-500/20 text-gray-400'}`}>
                    {mem.layer.replace('_', ' ')}
                  </span>
                  <span className="text-[10px] text-text-quaternary">{formatDate(mem.createdAt)}</span>
                  {mem.salience > 0.7 && (
                    <span className="text-[10px] text-yellow-400">high salience</span>
                  )}
                  {mem.tags && mem.tags.length > 0 && (
                    <span className="text-[10px] text-text-quaternary">{mem.tags.slice(0, 3).join(', ')}</span>
                  )}
                </div>
              </div>
              {/* Delete individual */}
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
                title="Delete this memory"
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
