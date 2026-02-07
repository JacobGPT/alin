/**
 * Memory Dashboard - 8-Layer Cognitive Memory System Interface
 *
 * A professional dashboard for viewing and managing ALIN's memory system.
 * Includes list view, graph visualization, and timeline display.
 */

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowPathIcon,
  TrashIcon,
  PencilIcon,
  EyeIcon,
  BookmarkIcon,
  ArchiveBoxIcon,
  SparklesIcon,
  ClockIcon,
  CpuChipIcon as BrainIcon,
  LightBulbIcon,
  UserGroupIcon,
  CogIcon,
  BeakerIcon,
  DocumentTextIcon,
  ChartBarIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ShareIcon,
  ChevronRightIcon,
  PlusIcon,
  XMarkIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkSolid } from '@heroicons/react/24/solid';

// Store
import { useMemoryStore } from '@store/memoryStore';

// Components
import { Button } from '@components/ui/Button';
import { MemoryGraph } from './MemoryGraph';
import { MemoryTimeline } from './MemoryTimeline';
import { MemoryDetail } from './MemoryDetail';
import { KnowledgeGraph3D } from './KnowledgeGraph3D';
import { knowledgeGraphService } from '../../services/knowledgeGraphService';

// Types
import { MemoryLayer, type MemoryEntry } from '../../types/memory';

// ============================================================================
// LAYER CONFIGURATION
// ============================================================================

const LAYER_CONFIG: Record<MemoryLayer, {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
}> = {
  [MemoryLayer.SHORT_TERM]: {
    icon: <ClockIcon className="h-5 w-5" />,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    label: 'Short-Term',
    description: 'Current conversation context',
  },
  [MemoryLayer.LONG_TERM]: {
    icon: <ArchiveBoxIcon className="h-5 w-5" />,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    label: 'Long-Term',
    description: 'Autobiographical memories',
  },
  [MemoryLayer.SEMANTIC]: {
    icon: <LightBulbIcon className="h-5 w-5" />,
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    label: 'Semantic',
    description: 'Facts and knowledge',
  },
  [MemoryLayer.RELATIONAL]: {
    icon: <UserGroupIcon className="h-5 w-5" />,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    label: 'Relational',
    description: 'People and relationships',
  },
  [MemoryLayer.PROCEDURAL]: {
    icon: <CogIcon className="h-5 w-5" />,
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/30',
    label: 'Procedural',
    description: 'Learned skills and patterns',
  },
  [MemoryLayer.WORKING]: {
    icon: <BeakerIcon className="h-5 w-5" />,
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500/30',
    label: 'Working',
    description: 'Active reasoning context',
  },
  [MemoryLayer.EPISODIC]: {
    icon: <DocumentTextIcon className="h-5 w-5" />,
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/10',
    borderColor: 'border-teal-500/30',
    label: 'Episodic',
    description: 'Specific event memories',
  },
  [MemoryLayer.META]: {
    icon: <SparklesIcon className="h-5 w-5" />,
    color: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    label: 'Meta',
    description: 'Self-awareness and learning patterns',
  },
};

// ============================================================================
// MEMORY DASHBOARD COMPONENT
// ============================================================================

export function MemoryDashboard() {
  // Store state
  const memories = useMemoryStore((state) => state.memories);
  const stats = useMemoryStore((state) => state.stats);
  const viewMode = useMemoryStore((state) => state.viewMode);
  const filterLayer = useMemoryStore((state) => state.filterLayer);
  const searchQuery = useMemoryStore((state) => state.searchQuery);
  const selectedMemoryId = useMemoryStore((state) => state.selectedMemoryId);
  const setViewMode = useMemoryStore((state) => state.setViewMode);
  const setFilterLayer = useMemoryStore((state) => state.setFilterLayer);
  const setSearchQuery = useMemoryStore((state) => state.setSearchQuery);
  const selectMemory = useMemoryStore((state) => state.selectMemory);
  const deleteMemory = useMemoryStore((state) => state.deleteMemory);
  const updateMemory = useMemoryStore((state) => state.updateMemory);
  const consolidateMemories = useMemoryStore((state) => state.consolidateMemories);
  const buildGraph = useMemoryStore((state) => state.buildGraph);

  // Local state
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Build graph on mount and when memories change
  useEffect(() => {
    buildGraph();
  }, [memories.size, buildGraph]);

  // Filter and sort memories
  const filteredMemories = useMemo(() => {
    let list = Array.from(memories.values());

    // Filter by layer
    if (filterLayer !== 'all') {
      list = list.filter((m) => m.layer === filterLayer);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.content.toLowerCase().includes(query) ||
          m.tags.some((t) => t.toLowerCase().includes(query))
      );
    }

    // Sort by salience and recency
    return list.sort((a, b) => {
      // Pinned first
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      // Then by salience
      return b.salience - a.salience;
    });
  }, [memories, filterLayer, searchQuery]);

  // Selected memory
  const selectedMemory = selectedMemoryId ? memories.get(selectedMemoryId) : null;

  // Handle consolidation
  const handleConsolidate = async () => {
    setIsConsolidating(true);
    await consolidateMemories();
    setIsConsolidating(false);
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="flex h-full bg-background-primary">
      {/* Left Panel - Memory Browser */}
      <div className="flex w-96 flex-shrink-0 flex-col border-r border-border-primary bg-background-secondary">
        {/* Header */}
        <div className="border-b border-border-primary p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text-primary">Memory System</h1>
              <p className="text-sm text-text-tertiary">
                {stats.totalMemories} memories across 8 layers
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleConsolidate}
              loading={isConsolidating}
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            >
              Consolidate
            </Button>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border-primary bg-background-tertiary py-2 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
            />
          </div>

          {/* View Toggle */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-background-tertiary p-1">
              {(['list', 'graph', 'timeline', 'knowledge'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-background-primary text-text-primary shadow-sm'
                      : 'text-text-tertiary hover:text-text-primary'
                  }`}
                >
                  {mode === 'list' && <ListBulletIcon className="h-4 w-4" />}
                  {mode === 'graph' && <ShareIcon className="h-4 w-4" />}
                  {mode === 'timeline' && <ChartBarIcon className="h-4 w-4" />}
                  {mode === 'knowledge' && <SparklesIcon className="h-4 w-4" />}
                </button>
              ))}
            </div>

            {/* Layer Filter */}
            <select
              value={filterLayer}
              onChange={(e) => setFilterLayer(e.target.value as MemoryLayer | 'all')}
              className="flex-1 rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
            >
              <option value="all">All Layers</option>
              {Object.entries(LAYER_CONFIG).map(([layer, config]) => (
                <option key={layer} value={layer}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Layer Stats */}
        <div className="border-b border-border-primary p-4">
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(LAYER_CONFIG).map(([layer, config]) => {
              const count = stats.byLayer.get(layer as MemoryLayer) || 0;
              return (
                <button
                  key={layer}
                  onClick={() => setFilterLayer(layer as MemoryLayer)}
                  className={`rounded-lg p-2 text-center transition-colors ${
                    filterLayer === layer
                      ? `${config.bgColor} ${config.borderColor} border`
                      : 'hover:bg-background-tertiary'
                  }`}
                >
                  <div className={`mb-1 ${config.color}`}>{config.icon}</div>
                  <p className="text-lg font-bold text-text-primary">{count}</p>
                  <p className="text-xs text-text-tertiary">{config.label}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Memory List */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredMemories.length === 0 ? (
            <EmptyState onCreateNew={() => setShowCreateModal(true)} />
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {filteredMemories.map((memory) => (
                  <MemoryCard
                    key={memory.id}
                    memory={memory}
                    isSelected={memory.id === selectedMemoryId}
                    onSelect={() => selectMemory(memory.id)}
                    onPin={() =>
                      updateMemory(memory.id, { isPinned: !memory.isPinned })
                    }
                    onDelete={() => deleteMemory(memory.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Footer Stats */}
        <div className="border-t border-border-primary p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-tertiary">
              Storage: {formatBytes(stats.totalSize)}
            </span>
            <span className="text-text-tertiary">
              Last consolidation: {formatTimeAgo(stats.lastConsolidation)}
            </span>
          </div>
        </div>
      </div>

      {/* Right Panel - View Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'list' ? (
          selectedMemory ? (
            <MemoryDetail
              memory={selectedMemory}
              onClose={() => selectMemory(null)}
            />
          ) : (
            <EmptyDetailView />
          )
        ) : viewMode === 'graph' ? (
          <MemoryGraph onSelectMemory={selectMemory} />
        ) : viewMode === 'knowledge' ? (
          <div className="h-full p-4 overflow-auto">
            <KnowledgeGraph3D
              graph={knowledgeGraphService.buildKnowledgeGraph(
                filteredMemories.map(m => ({
                  id: m.id,
                  content: m.content,
                  tags: m.tags || [],
                  layer: m.layer,
                  salience: m.salience,
                }))
              )}
              onNodeClick={(node) => {
                // Select the first related memory
                if (node.memoryIds.length > 0) {
                  selectMemory(node.memoryIds[0]);
                }
              }}
            />
          </div>
        ) : (
          <MemoryTimeline memories={filteredMemories} onSelectMemory={selectMemory} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MEMORY CARD
// ============================================================================

interface MemoryCardProps {
  memory: MemoryEntry;
  isSelected: boolean;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
}

function MemoryCard({ memory, isSelected, onSelect, onPin, onDelete }: MemoryCardProps) {
  const layerConfig = LAYER_CONFIG[memory.layer];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`group cursor-pointer rounded-xl border-2 p-3 transition-all ${
        isSelected
          ? `${layerConfig.borderColor} ${layerConfig.bgColor}`
          : 'border-transparent bg-background-primary hover:border-border-primary hover:bg-background-hover'
      }`}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={`${layerConfig.bgColor} ${layerConfig.color} rounded-full p-1`}>
            {layerConfig.icon}
          </span>
          <span className="text-xs font-medium text-text-tertiary">{layerConfig.label}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPin();
            }}
            className={`rounded p-1 transition-colors ${
              memory.isPinned
                ? 'text-brand-primary'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            {memory.isPinned ? (
              <BookmarkSolid className="h-4 w-4" />
            ) : (
              <BookmarkIcon className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-text-tertiary hover:text-semantic-error"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <p className="mb-2 line-clamp-2 text-sm text-text-primary">{memory.content}</p>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-text-tertiary">
        <div className="flex items-center gap-2">
          {/* Salience indicator */}
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-background-tertiary">
              <div
                className={`h-full rounded-full ${layerConfig.color.replace('text-', 'bg-')}`}
                style={{ width: `${memory.salience * 100}%` }}
              />
            </div>
            <span>{Math.round(memory.salience * 100)}%</span>
          </div>
        </div>
        <span>{formatTimeAgo(memory.createdAt)}</span>
      </div>

      {/* Tags */}
      {memory.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {memory.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-text-secondary"
            >
              {tag}
            </span>
          ))}
          {memory.tags.length > 3 && (
            <span className="text-xs text-text-tertiary">+{memory.tags.length - 3}</span>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ============================================================================
// EMPTY STATES
// ============================================================================

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary">
        <SparklesIcon className="h-8 w-8 text-white" />
      </div>
      <h3 className="mb-2 font-semibold text-text-primary">No Memories Yet</h3>
      <p className="mb-4 text-sm text-text-tertiary">
        Memories are created automatically from conversations
      </p>
    </div>
  );
}

function EmptyDetailView() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500"
      >
        <SparklesIcon className="h-12 w-12 text-white" />
      </motion.div>
      <h2 className="mb-2 text-2xl font-bold text-text-primary">Select a Memory</h2>
      <p className="max-w-md text-text-tertiary">
        Click on a memory from the list to view its details, relationships, and history.
      </p>
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default MemoryDashboard;
