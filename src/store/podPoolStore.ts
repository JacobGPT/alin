/**
 * podPoolStore.ts — Persistent Pod Pool
 *
 * Maintains a reusable pool of specialized agent pods across TBWOs.
 * Pods retain their conversation history, learned patterns, and accumulated
 * expertise. When a new TBWO needs a pod role, it checks the pool first
 * before spawning a fresh one.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';
import type { PodRole } from '../types/tbwo';

// ============================================================================
// TYPES
// ============================================================================

export interface PooledPod {
  id: string;
  role: PodRole;
  name: string;

  // Accumulated state
  conversationSummary: string;       // Compressed conversation context
  learnedPatterns: string[];         // Patterns/expertise gained across TBWOs
  totalTokensUsed: number;
  totalTasksCompleted: number;
  totalTBWOsServed: number;
  tbwoHistory: string[];             // IDs of TBWOs this pod has worked on

  // Current assignment
  activeTBWOId: string | null;
  status: 'available' | 'active' | 'warming' | 'retired';

  // Metadata
  createdAt: number;
  lastActiveAt: number;
  specializations: string[];         // e.g., ['react', 'typescript', 'api-design']
}

interface PodPoolStore {
  // State
  pool: Map<string, PooledPod>;
  maxPoolSize: number;

  // Pod lifecycle
  getOrCreatePod: (role: PodRole, tbwoId: string) => PooledPod;
  returnPodToPool: (podId: string, summary?: string, patterns?: string[]) => void;
  retirePod: (podId: string) => void;
  removePod: (podId: string) => void;

  // Queries
  getAvailablePod: (role: PodRole) => PooledPod | null;
  getActivePods: () => PooledPod[];
  getPooledPods: () => PooledPod[];
  getPodsByRole: (role: PodRole) => PooledPod[];
  getPoolStats: () => PoolStats;

  // Management
  updatePodSpecializations: (podId: string, specializations: string[]) => void;
  addLearnedPattern: (podId: string, pattern: string) => void;
  clearPool: () => void;
}

export interface PoolStats {
  totalPods: number;
  availablePods: number;
  activePods: number;
  totalTokensUsed: number;
  totalTasksCompleted: number;
  roleDistribution: Record<string, number>;
}

// ============================================================================
// ROLE NAMES
// ============================================================================

const ROLE_NAMES: Record<string, string> = {
  orchestrator: 'Orchestrator',
  design: 'Designer',
  frontend: 'Frontend Dev',
  backend: 'Backend Dev',
  copy: 'Copywriter',
  motion: 'Motion Designer',
  qa: 'QA Engineer',
  research: 'Researcher',
  data: 'Data Analyst',
  deployment: 'DevOps',
};

// ============================================================================
// STORE
// ============================================================================

export const usePodPoolStore = create<PodPoolStore>()(
  persist(
    immer((set, get) => ({
      pool: new Map(),
      maxPoolSize: 30,

      getOrCreatePod: (role, tbwoId) => {
        // Try to find an available pod with the same role
        const existing = get().getAvailablePod(role);
        if (existing) {
          set((state) => {
            const pod = state.pool.get(existing.id);
            if (pod) {
              pod.status = 'active';
              pod.activeTBWOId = tbwoId;
              pod.lastActiveAt = Date.now();
              pod.totalTBWOsServed += 1;
              pod.tbwoHistory.push(tbwoId);
            }
          });
          return get().pool.get(existing.id)!;
        }

        // Create new pooled pod
        const id = nanoid();
        const newPod: PooledPod = {
          id,
          role,
          name: `${ROLE_NAMES[role] || role}-${id.slice(0, 4)}`,
          conversationSummary: '',
          learnedPatterns: [],
          totalTokensUsed: 0,
          totalTasksCompleted: 0,
          totalTBWOsServed: 1,
          tbwoHistory: [tbwoId],
          activeTBWOId: tbwoId,
          status: 'active',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          specializations: [],
        };

        set((state) => {
          state.pool.set(id, newPod);

          // Evict oldest retired pods if pool is full
          if (state.pool.size > state.maxPoolSize) {
            const retired = [...state.pool.values()]
              .filter(p => p.status === 'retired')
              .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
            for (const r of retired) {
              if (state.pool.size <= state.maxPoolSize) break;
              state.pool.delete(r.id);
            }
          }
        });

        return newPod;
      },

      returnPodToPool: (podId, summary, patterns) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (!pod) return;

          pod.status = 'available';
          pod.activeTBWOId = null;
          pod.lastActiveAt = Date.now();

          if (summary) {
            // Append new summary, keep under 2000 chars
            const combined = pod.conversationSummary
              ? `${pod.conversationSummary}\n---\n${summary}`
              : summary;
            pod.conversationSummary = combined.length > 2000
              ? combined.slice(-2000)
              : combined;
          }

          if (patterns && patterns.length > 0) {
            // Add new patterns, deduplicate, keep last 20
            const allPatterns = [...new Set([...pod.learnedPatterns, ...patterns])];
            pod.learnedPatterns = allPatterns.slice(-20);
          }
        });
      },

      retirePod: (podId) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (pod) {
            pod.status = 'retired';
            pod.activeTBWOId = null;
          }
        });
      },

      removePod: (podId) => {
        set((state) => {
          state.pool.delete(podId);
        });
      },

      getAvailablePod: (role) => {
        const pods = [...get().pool.values()]
          .filter(p => p.role === role && p.status === 'available')
          .sort((a, b) => b.totalTasksCompleted - a.totalTasksCompleted); // Prefer experienced
        return pods[0] || null;
      },

      getActivePods: () => {
        return [...get().pool.values()].filter(p => p.status === 'active');
      },

      getPooledPods: () => {
        return [...get().pool.values()].filter(p => p.status === 'available');
      },

      getPodsByRole: (role) => {
        return [...get().pool.values()].filter(p => p.role === role);
      },

      getPoolStats: () => {
        const pods = [...get().pool.values()];
        const roleDistribution: Record<string, number> = {};
        pods.forEach(p => {
          roleDistribution[p.role] = (roleDistribution[p.role] || 0) + 1;
        });

        return {
          totalPods: pods.length,
          availablePods: pods.filter(p => p.status === 'available').length,
          activePods: pods.filter(p => p.status === 'active').length,
          totalTokensUsed: pods.reduce((sum, p) => sum + p.totalTokensUsed, 0),
          totalTasksCompleted: pods.reduce((sum, p) => sum + p.totalTasksCompleted, 0),
          roleDistribution,
        };
      },

      updatePodSpecializations: (podId, specializations) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (pod) {
            pod.specializations = [...new Set([...pod.specializations, ...specializations])].slice(0, 10);
          }
        });
      },

      addLearnedPattern: (podId, pattern) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (pod) {
            if (!pod.learnedPatterns.includes(pattern)) {
              pod.learnedPatterns.push(pattern);
              if (pod.learnedPatterns.length > 20) {
                pod.learnedPatterns = pod.learnedPatterns.slice(-20);
              }
            }
          }
        });
      },

      clearPool: () => {
        set((state) => {
          state.pool.clear();
        });
      },
    })),
    {
      name: 'alin-pod-pool-storage',
      partialize: (state) => ({
        pool: Array.from(state.pool.entries()),
        maxPoolSize: state.maxPoolSize,
      }),
      merge: (persisted: any, current: any) => {
        const pool = new Map(persisted?.pool || []);
        return { ...current, pool, maxPoolSize: persisted?.maxPoolSize || 30 } as any;
      },
    }
  )
);

/**
 * Get a warm-start system prompt addition for a pooled pod.
 * Injects the pod's accumulated context from prior TBWOs.
 */
export function getPooledPodContext(pooledPod: PooledPod): string {
  const lines: string[] = [];

  if (pooledPod.totalTBWOsServed > 1) {
    lines.push(`\n## ACCUMULATED EXPERIENCE`);
    lines.push(`You have worked on ${pooledPod.totalTBWOsServed} projects, completing ${pooledPod.totalTasksCompleted} tasks total.`);
  }

  if (pooledPod.specializations.length > 0) {
    lines.push(`**Your specializations:** ${pooledPod.specializations.join(', ')}`);
  }

  if (pooledPod.learnedPatterns.length > 0) {
    lines.push(`\n**Patterns you've learned from past work:**`);
    pooledPod.learnedPatterns.forEach(p => lines.push(`- ${p}`));
  }

  if (pooledPod.conversationSummary) {
    lines.push(`\n**Context from previous work:**`);
    lines.push(pooledPod.conversationSummary);
  }

  return lines.join('\n');
}
