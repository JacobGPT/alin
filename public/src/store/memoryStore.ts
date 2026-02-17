/**
 * Memory Store - 8-Layer Memory System State Management
 * 
 * Manages ALIN's complete memory architecture:
 * - 8 memory layers (short-term, long-term, semantic, etc.)
 * - Memory operations (retrieval, consolidation, search)
 * - Memory graph and relationships
 * - Privacy and user control
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import * as dbService from '../api/dbService';

import {
  MemoryLayer,
} from '../types/memory';
import type {
  MemoryEntry,
  ShortTermMemory,
  LongTermMemory,
  SemanticMemory,
  RelationalMemory,
  ProceduralMemory,
  WorkingMemory,
  EpisodicMemory,
  MetaMemory,
  MemoryQuery,
  MemorySearchResult,
  MemoryConsolidation,
  MemoryGraph,
  MemoryManagerState,
  MemoryPrivacySettings,
} from '../types/memory';

// ============================================================================
// STORE STATE TYPE
// ============================================================================

interface MemoryState {
  // Memory storage (organized by layer)
  memories: Map<string, MemoryEntry>;
  
  // Indices for fast lookup
  byLayer: Map<MemoryLayer, Set<string>>;
  byTag: Map<string, Set<string>>;
  
  // Graph
  graph: MemoryGraph | null;
  
  // Active operations
  activeConsolidations: MemoryConsolidation[];
  
  // Manager state
  managerState: MemoryManagerState;
  
  // Privacy settings
  privacySettings: MemoryPrivacySettings;
  
  // UI state
  selectedMemoryId: string | null;
  viewMode: 'list' | 'graph' | 'timeline' | 'knowledge';
  filterLayer: MemoryLayer | 'all';
  searchQuery: string;
  
  // Stats
  stats: {
    totalMemories: number;
    byLayer: Map<MemoryLayer, number>;
    totalSize: number;
    lastConsolidation: number;
  };
}

interface MemoryActions {
  // Memory CRUD
  addMemory: (memory: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'accessCount'> | Record<string, any>) => string;
  updateMemory: (id: string, updates: Partial<MemoryEntry> & Record<string, any>) => void;
  deleteMemory: (id: string) => void;
  getMemory: (id: string) => MemoryEntry | undefined;
  
  // Memory operations
  retrieveMemories: (context: Partial<MemoryQuery>) => MemorySearchResult[];
  searchMemories: (query: string) => MemorySearchResult[];
  consolidateMemories: () => Promise<void>;
  promoteMemory: (id: string, toLayer: MemoryLayer) => void;
  archiveMemory: (id: string) => void;
  
  // Salience and decay
  updateSalience: (id: string, delta: number) => void;
  applySalienceDecay: () => void;
  
  // Graph operations
  buildGraph: () => Promise<void>;
  findRelated: (memoryId: string, maxResults?: number) => MemoryEntry[];
  
  // Bulk operations
  deleteMultipleMemories: (ids: string[]) => void;
  exportMemories: (format: 'json' | 'csv' | 'markdown') => Promise<string>;
  importMemories: (data: string, format: 'json') => Promise<number>;
  
  // Privacy
  updatePrivacySettings: (settings: Partial<MemoryPrivacySettings>) => void;
  clearAllMemories: () => void;
  
  // UI
  selectMemory: (id: string | null) => void;
  setViewMode: (mode: 'list' | 'graph' | 'timeline' | 'knowledge') => void;
  setFilterLayer: (layer: MemoryLayer | 'all') => void;
  setSearchQuery: (query: string) => void;
  
  // Stats
  refreshStats: () => void;
  getMemoryStats: () => MemoryState['stats'];
}

// ============================================================================
// DEFAULT PRIVACY SETTINGS
// ============================================================================

const DEFAULT_PRIVACY: MemoryPrivacySettings = {
  allowMemoryStorage: true,
  allowMemoryConsolidation: true,
  allowMemorySharing: false,
  retentionPeriod: 0, // Forever
  autoArchiveAfter: 90, // 90 days
  deletionPolicy: 'soft_delete' as any,
  redactPII: true,
  sensitiveTopics: [],
};

// ============================================================================
// DEFAULT MANAGER STATE
// ============================================================================

const DEFAULT_MANAGER_STATE: MemoryManagerState = {
  totalMemories: 0,
  totalSize: 0,
  layerCounts: new Map(),
  fragmentationLevel: 0,
  consolidationBacklog: 0,
  averageRetrievalTime: 0,
  maxMemories: 10000,
  maxSize: 100 * 1024 * 1024, // 100MB
  storageUsed: 0,
  activeConsolidations: 0,
  pendingArchival: 0,
};

// ============================================================================
// DEBOUNCED DB WRITERS
// ============================================================================

const _memUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
function _debouncedMemUpdate(id: string, updates: Record<string, unknown>) {
  const existing = _memUpdateTimers.get(id);
  if (existing) clearTimeout(existing);
  _memUpdateTimers.set(id, setTimeout(() => {
    _memUpdateTimers.delete(id);
    dbService.updateMemory(id, updates).catch(e => console.warn('[memoryStore] DB updateMemory failed:', e));
  }, 1000));
}

// ============================================================================
// ZUSTAND STORE
// ============================================================================

export const useMemoryStore = create<MemoryState & MemoryActions>()(
  persist(
    immer((set, get) => ({
      // ========================================================================
      // INITIAL STATE
      // ========================================================================
      
      memories: new Map(),
      byLayer: new Map(),
      byTag: new Map(),
      graph: null,
      activeConsolidations: [],
      managerState: DEFAULT_MANAGER_STATE,
      privacySettings: DEFAULT_PRIVACY,
      selectedMemoryId: null,
      viewMode: 'list',
      filterLayer: 'all',
      searchQuery: '',
      stats: {
        totalMemories: 0,
        byLayer: new Map(),
        totalSize: 0,
        lastConsolidation: 0,
      },
      
      // ========================================================================
      // MEMORY CRUD
      // ========================================================================
      
      addMemory: (memoryData) => {
        const id = nanoid();
        const now = Date.now();
        
        const memory = {
          ...memoryData,
          id,
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          isConsolidated: false,
          isArchived: false,
          isPinned: false,
          userModified: false,
          relatedMemories: (memoryData as any).relatedMemories || [],
          tags: (memoryData as any).tags || [],
        } as MemoryEntry;
        
        set((state) => {
          // Add to main storage
          state.memories.set(id, memory);
          
          // Add to layer index
          if (!state.byLayer.has(memory.layer)) {
            state.byLayer.set(memory.layer, new Set());
          }
          state.byLayer.get(memory.layer)?.add(id);
          
          // Add to tag indices
          memory.tags.forEach((tag) => {
            if (!state.byTag.has(tag)) {
              state.byTag.set(tag, new Set());
            }
            state.byTag.get(tag)?.add(id);
          });
        });
        
        get().refreshStats();

        // Fire-and-forget DB write
        dbService.createMemory({
          id,
          layer: memory.layer,
          content: typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content),
          salience: (memory as any).salience ?? 0.5,
          decayRate: (memory as any).decayRate ?? 0.1,
          accessCount: 0,
          isConsolidated: false,
          isArchived: false,
          isPinned: false,
          userModified: false,
          tags: memory.tags || [],
          relatedMemories: memory.relatedMemories || [],
          editHistory: [],
          metadata: (memory as any).metadata || {},
          lastAccessedAt: now,
          createdAt: now,
          updatedAt: now,
        }).catch(e => console.warn('[memoryStore] DB createMemory failed:', e));

        return id;
      },

      updateMemory: (id, updates) => {
        set((state) => {
          const memory = state.memories.get(id);
          if (memory) {
            // Store edit history if content changed
            if (updates.content && updates.content !== memory.content) {
              if (!memory.editHistory) {
                memory.editHistory = [];
              }
              memory.editHistory.push({
                timestamp: Date.now(),
                previousContent: memory.content,
                newContent: updates.content,
                reason: 'User edit',
              });
            }
            
            Object.assign(memory, updates);
            memory.updatedAt = Date.now();
            
            // If pinned status changed, update index
            if ('tags' in updates && updates.tags) {
              // Rebuild tag indices for this memory
              state.byTag.forEach((ids) => ids.delete(id));
              updates.tags.forEach((tag) => {
                if (!state.byTag.has(tag)) {
                  state.byTag.set(tag, new Set());
                }
                state.byTag.get(tag)?.add(id);
              });
            }
          }
        });

        get().refreshStats();

        // Debounced DB write
        _debouncedMemUpdate(id, updates as Record<string, unknown>);
      },

      deleteMemory: (id) => {
        set((state) => {
          const memory = state.memories.get(id);
          if (memory) {
            // Remove from main storage
            state.memories.delete(id);
            
            // Remove from layer index
            state.byLayer.get(memory.layer)?.delete(id);
            
            // Remove from tag indices
            memory.tags.forEach((tag) => {
              state.byTag.get(tag)?.delete(id);
            });
            
            // Remove from related memories
            state.memories.forEach((m) => {
              const index = m.relatedMemories.indexOf(id);
              if (index !== -1) {
                m.relatedMemories.splice(index, 1);
              }
            });
          }
        });

        get().refreshStats();
        dbService.deleteMemory(id).catch(e => console.warn('[memoryStore] DB deleteMemory failed:', e));
      },

      getMemory: (id) => {
        const memory = get().memories.get(id);
        
        if (memory) {
          // Update access stats
          get().updateMemory(id, {
            lastAccessedAt: Date.now(),
            accessCount: memory.accessCount + 1,
          });
        }
        
        return memory;
      },
      
      // ========================================================================
      // MEMORY OPERATIONS
      // ========================================================================
      
      retrieveMemories: (context) => {
        const { memories, byLayer, byTag } = get();
        let candidates = Array.from(memories.values());
        
        // Filter by layer
        if (context.layers && context.layers.length > 0) {
          const layerIds = new Set<string>();
          context.layers.forEach((layer) => {
            byLayer.get(layer)?.forEach((id) => layerIds.add(id));
          });
          candidates = candidates.filter((m) => layerIds.has(m.id));
        }
        
        // Filter by tags
        if (context.tags && context.tags.length > 0) {
          const tagIds = new Set<string>();
          context.tags.forEach((tag) => {
            byTag.get(tag)?.forEach((id) => tagIds.add(id));
          });
          candidates = candidates.filter((m) => tagIds.has(m.id));
        }
        
        // Filter by salience
        if (context.minSalience) {
          candidates = candidates.filter((m) => m.salience >= context.minSalience!);
        }
        
        // Filter by date range
        if (context.dateRange) {
          candidates = candidates.filter(
            (m) =>
              m.createdAt >= context.dateRange!.start &&
              m.createdAt <= context.dateRange!.end
          );
        }
        
        // Filter archived
        if (!context.includeArchived) {
          candidates = candidates.filter((m) => !m.isArchived);
        }
        
        // Search query
        if (context.query) {
          const query = context.query.toLowerCase();
          candidates = candidates.filter((m) =>
            m.content.toLowerCase().includes(query)
          );
        }
        
        // Sort
        const sortBy = context.sortBy || 'salience';
        const sortOrder = context.sortOrder || 'desc';
        
        candidates.sort((a, b) => {
          let comparison = 0;
          
          switch (sortBy) {
            case 'salience':
              comparison = b.salience - a.salience;
              break;
            case 'recency':
              comparison = b.createdAt - a.createdAt;
              break;
            case 'access_count':
              comparison = b.accessCount - a.accessCount;
              break;
            case 'relevance':
              // TODO: Implement semantic similarity
              comparison = b.salience - a.salience;
              break;
          }
          
          return sortOrder === 'desc' ? comparison : -comparison;
        });
        
        // Limit
        const limit = context.limit || 10;
        const offset = context.offset || 0;
        candidates = candidates.slice(offset, offset + limit);
        
        // Convert to search results
        return candidates.map((memory) => ({
          memory,
          score: memory.salience,
          highlights: [],
        }));
      },
      
      searchMemories: (query) => {
        return get().retrieveMemories({ query, sortBy: 'relevance' });
      },
      
      consolidateMemories: async () => {
        const { memories, byLayer } = get();
        const shortTermIds = byLayer.get(MemoryLayer.SHORT_TERM) || new Set();
        const shortTermMemories = Array.from(shortTermIds)
          .map((id) => memories.get(id))
          .filter((m): m is ShortTermMemory => !!m);
        
        // Identify memories to consolidate (high salience, old enough)
        const now = Date.now();
        const consolidationThreshold = 30 * 60 * 1000; // 30 minutes
        
        const toConsolidate = shortTermMemories.filter(
          (m) =>
            m.salience > 0.5 &&
            now - m.createdAt > consolidationThreshold &&
            !m.isConsolidated
        );
        
        if (toConsolidate.length === 0) return;
        
        // Create consolidation record
        const consolidationId = nanoid();
        const consolidation: MemoryConsolidation = {
          id: consolidationId,
          startedAt: now,
          sourceMemories: toConsolidate.map((m) => m.id),
          consolidatedMemories: [],
          method: 'promote' as any,
          compressionRatio: 1,
          informationRetained: 1,
          changeLog: [],
        };
        
        set((state) => {
          state.activeConsolidations.push(consolidation);
        });
        
        // Simulate consolidation (in production, this would use AI)
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        // Promote to long-term
        toConsolidate.forEach((shortTerm) => {
          // Create long-term memory
          const longTermId = get().addMemory({
            layer: MemoryLayer.LONG_TERM,
            content: shortTerm.content,
            salience: shortTerm.salience,
            decayRate: 0.01,
            tags: shortTerm.tags,
            relatedMemories: shortTerm.relatedMemories,
            eventType: 'conversation' as const,
            significance: 'moderate' as const,
            consolidatedFrom: [shortTerm.id],
          } as any);
          
          consolidation.consolidatedMemories.push(longTermId);
          consolidation.changeLog.push({
            type: 'promoted',
            memoryIds: [shortTerm.id, longTermId],
            reason: 'High salience, consolidated to long-term',
          });
          
          // Mark short-term as consolidated
          get().updateMemory(shortTerm.id, {
            isConsolidated: true,
            promotedTo: longTermId,
          } as any);
        });
        
        consolidation.completedAt = Date.now();
        
        get().refreshStats();
      },
      
      promoteMemory: (id, toLayer) => {
        const memory = get().memories.get(id);
        if (!memory) return;
        
        // Create new memory in target layer
        const newId = get().addMemory({
          ...memory,
          layer: toLayer,
        });
        
        // Mark original as consolidated
        get().updateMemory(id, {
          isConsolidated: true,
          promotedTo: newId,
        } as any);
      },
      
      archiveMemory: (id) => {
        get().updateMemory(id, { isArchived: true });
      },
      
      // ========================================================================
      // SALIENCE AND DECAY
      // ========================================================================
      
      updateSalience: (id, delta) => {
        const memory = get().memories.get(id);
        if (memory) {
          const newSalience = Math.max(0, Math.min(1, memory.salience + delta));
          get().updateMemory(id, { salience: newSalience });
        }
      },
      
      applySalienceDecay: () => {
        const now = Date.now();
        const daysSinceEpoch = now / (1000 * 60 * 60 * 24);
        
        get().memories.forEach((memory) => {
          if (!memory.isPinned && !memory.isArchived) {
            const daysSinceAccess =
              (now - memory.lastAccessedAt) / (1000 * 60 * 60 * 24);
            const decay = memory.decayRate * daysSinceAccess;
            const newSalience = Math.max(0, memory.salience - decay);
            
            if (newSalience !== memory.salience) {
              get().updateMemory(memory.id, { salience: newSalience });
            }
          }
        });
      },
      
      // ========================================================================
      // GRAPH OPERATIONS
      // ========================================================================
      
      buildGraph: async () => {
        const { memories } = get();
        
        // Build nodes
        const nodes = Array.from(memories.values()).map((memory) => ({
          id: memory.id,
          memoryId: memory.id,
          label: memory.content.slice(0, 50),
          layer: memory.layer,
          size: memory.salience * 10,
          color: getLayerColor(memory.layer),
          degree: memory.relatedMemories.length,
          centrality: memory.salience,
        }));
        
        // Build edges
        const edges: MemoryGraph['edges'] = [];
        memories.forEach((memory) => {
          memory.relatedMemories.forEach((relatedId) => {
            if (memories.has(relatedId)) {
              edges.push({
                source: memory.id,
                target: relatedId,
                weight: 1,
                type: 'reference' as any,
              });
            }
          });
        });
        
        const graph: MemoryGraph = {
          nodes,
          edges,
          totalNodes: nodes.length,
          totalEdges: edges.length,
          density: edges.length / (nodes.length * (nodes.length - 1) || 1),
          clusters: [],
        };
        
        set({ graph });
      },
      
      findRelated: (memoryId, maxResults = 10) => {
        const memory = get().memories.get(memoryId);
        if (!memory) return [];
        
        const related = memory.relatedMemories
          .map((id) => get().memories.get(id))
          .filter((m): m is MemoryEntry => !!m)
          .sort((a, b) => b.salience - a.salience)
          .slice(0, maxResults);
        
        return related;
      },
      
      // ========================================================================
      // BULK OPERATIONS
      // ========================================================================
      
      deleteMultipleMemories: (ids) => {
        ids.forEach((id) => get().deleteMemory(id));
      },
      
      exportMemories: async (format) => {
        const { memories } = get();
        const data = Array.from(memories.values());
        
        if (format === 'json') {
          return JSON.stringify(data, null, 2);
        } else if (format === 'csv') {
          // Simple CSV export
          const headers = ['id', 'layer', 'content', 'salience', 'createdAt'];
          const rows = data.map((m) => [
            m.id,
            m.layer,
            m.content.replace(/"/g, '""'),
            m.salience,
            new Date(m.createdAt).toISOString(),
          ]);
          return [headers, ...rows].map((row) => row.join(',')).join('\n');
        } else {
          // Markdown
          return data
            .map(
              (m) =>
                `## ${m.layer}\n\n**Created:** ${new Date(m.createdAt).toLocaleString()}\n**Salience:** ${m.salience}\n\n${m.content}\n\n---\n`
            )
            .join('\n');
        }
      },
      
      importMemories: async (data, format) => {
        if (format === 'json') {
          const memories = JSON.parse(data) as MemoryEntry[];
          let imported = 0;
          
          memories.forEach((memory) => {
            get().addMemory(memory);
            imported++;
          });
          
          return imported;
        }
        
        return 0;
      },
      
      // ========================================================================
      // PRIVACY
      // ========================================================================
      
      updatePrivacySettings: (settings) => {
        set((state) => {
          state.privacySettings = { ...state.privacySettings, ...settings };
        });
      },
      
      clearAllMemories: () => {
        if (
          confirm(
            'This will permanently delete all memories. This action cannot be undone. Continue?'
          )
        ) {
          set({
            memories: new Map(),
            byLayer: new Map(),
            byTag: new Map(),
            graph: null,
          });
          get().refreshStats();
        }
      },
      
      // ========================================================================
      // UI
      // ========================================================================
      
      selectMemory: (id) => set({ selectedMemoryId: id }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setFilterLayer: (layer) => set({ filterLayer: layer }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      
      // ========================================================================
      // STATS
      // ========================================================================
      
      refreshStats: () => {
        const { memories } = get();
        
        const byLayer = new Map<MemoryLayer, number>();
        let totalSize = 0;
        
        memories.forEach((memory) => {
          // Count by layer
          byLayer.set(memory.layer, (byLayer.get(memory.layer) || 0) + 1);
          
          // Estimate size
          totalSize += memory.content.length;
        });
        
        set({
          stats: {
            totalMemories: memories.size,
            byLayer,
            totalSize,
            lastConsolidation: Date.now(),
          },
        });
      },
      
      getMemoryStats: () => get().stats,
    })),
    {
      name: 'alin-memory-storage',
      partialize: (state) => ({
        memories: Array.from(state.memories.entries()),
        privacySettings: state.privacySettings,
      }),
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);
          return {
            state: {
              ...state,
              memories: new Map(state.memories),
            },
          };
        },
        setItem: (name, value) => {
          const { state } = value;
          localStorage.setItem(
            name,
            JSON.stringify({
              state: {
                ...state,
                memories: Array.from(state.memories.entries()),
              },
            })
          );
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getLayerColor(layer: MemoryLayer): string {
  const colors = {
    [MemoryLayer.SHORT_TERM]: '#3b82f6',
    [MemoryLayer.LONG_TERM]: '#8b5cf6',
    [MemoryLayer.SEMANTIC]: '#10b981',
    [MemoryLayer.RELATIONAL]: '#f59e0b',
    [MemoryLayer.PROCEDURAL]: '#ec4899',
    [MemoryLayer.WORKING]: '#6366f1',
    [MemoryLayer.EPISODIC]: '#14b8a6',
    [MemoryLayer.META]: '#a855f7',
  };
  
  return colors[layer];
}

// ============================================================================
// BACKGROUND TASKS
// ============================================================================

// Auto-consolidate every 30 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    const state = useMemoryStore.getState();
    if (state.privacySettings.allowMemoryConsolidation) {
      state.consolidateMemories();
    }
  }, 30 * 60 * 1000);
  
  // Apply salience decay every hour
  setInterval(() => {
    useMemoryStore.getState().applySalienceDecay();
  }, 60 * 60 * 1000);
}
