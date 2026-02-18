/**
 * podPoolStore.ts — Persistent Pod Pool + Runtime Pod State
 *
 * TWO responsibilities:
 * 1. **Pool**: Reusable pods across TBWOs (accumulated experience, learned patterns)
 * 2. **Runtime**: Single source of truth for active pod execution state
 *    (status, health, currentTask, resourceUsage, completedTasks, messageLog)
 *
 * TBWO.pods = planned definitions only (roles, tool whitelists, model config).
 * podPoolStore = THE runtime instance store. PodVisualization reads from here.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';
import type { PodRole } from '../types/tbwo';

// ============================================================================
// TYPES
// ============================================================================

/** Runtime state set during execution, cleared when pod returns to pool. */
export interface PodRuntimeState {
  executionAttemptId: string;
  podStatus: string;  // PodStatus enum value
  health: {
    status: string;
    lastHeartbeat: number;
    errorCount: number;
    consecutiveFailures: number;
    warnings: string[];
  };
  currentTask?: { id: string; name: string; startedAt?: number };
  resourceUsage: {
    cpuPercent: number;
    memoryMB: number;
    tokensUsed: number;
    apiCalls: number;
    executionTime: number;
  };
  completedTasks: Array<{ id: string; name: string; completedAt?: number }>;
  messageLog: Array<{
    timestamp: number;
    from: string;
    to: string;
    type: string;
    content: string;
  }>;
  startedAt?: number;
  modelConfig: { provider: string; model: string; temperature?: number; maxTokens?: number };
  toolWhitelist: string[];
}

export interface PooledPod {
  id: string;
  role: PodRole;
  name: string;

  // Accumulated state (persists across TBWOs)
  conversationSummary: string;
  learnedPatterns: string[];
  totalTokensUsed: number;
  totalTasksCompleted: number;
  totalTBWOsServed: number;
  tbwoHistory: string[];

  // Current assignment
  activeTBWOId: string | null;
  status: 'available' | 'active' | 'warming' | 'retired';

  // Runtime execution state (only set while actively executing)
  runtime?: PodRuntimeState;

  // Metadata
  createdAt: number;
  lastActiveAt: number;
  specializations: string[];
}

interface PodPoolStore {
  // State
  pool: Map<string, PooledPod>;
  maxPoolSize: number;

  // Pod lifecycle
  getOrCreatePod: (role: PodRole, tbwoId: string, executionAttemptId?: string) => PooledPod;
  returnPodToPool: (podId: string, summary?: string, patterns?: string[]) => void;
  retirePod: (podId: string) => void;
  removePod: (podId: string) => void;

  // Runtime state management
  updatePodRuntime: (podId: string, updates: Partial<PodRuntimeState>) => void;
  appendPodLog: (podId: string, content: string) => void;

  // Queries
  getAvailablePod: (role: PodRole) => PooledPod | null;
  getActivePods: () => PooledPod[];
  getPooledPods: () => PooledPod[];
  getPodsByRole: (role: PodRole) => PooledPod[];
  getPodsForExecution: (tbwoId: string, executionAttemptId?: string) => PooledPod[];
  getPoolStats: () => PoolStats;

  // Management
  updatePodSpecializations: (podId: string, specializations: string[]) => void;
  addLearnedPattern: (podId: string, pattern: string) => void;
  clearForTBWO: (tbwoId: string) => void;
  clearPool: () => void;
  pruneStale: (maxAgeMs?: number) => void;
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
  animation: 'Animator',
  three_d: '3D Artist',
  qa: 'QA Engineer',
  research: 'Researcher',
  data: 'Data Analyst',
  deployment: 'DevOps',
  devops: 'DevOps',
};

// ============================================================================
// STORE
// ============================================================================

export const usePodPoolStore = create<PodPoolStore>()(
  persist(
    immer((set, get) => ({
      pool: new Map(),
      maxPoolSize: 30,

      getOrCreatePod: (role, tbwoId, executionAttemptId) => {
        // Enforce uniqueness: if there's already an active pool pod for this
        // exact (role, tbwoId) pair, return it instead of creating another.
        const activeMatch = [...get().pool.values()]
          .find(p => p.role === role && p.activeTBWOId === tbwoId && p.status === 'active');
        if (activeMatch) {
          console.log(`[PodPool] REUSE existing active pod: role=${role}, tbwoId=${tbwoId}, poolPodId=${activeMatch.id}`);
          return activeMatch;
        }

        // Try to find an available pod with the same role (from a prior TBWO)
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
              pod.runtime = undefined; // Clear stale runtime
            }
          });
          console.log(`[PodPool] REUSE available pod: role=${role}, tbwoId=${tbwoId}, poolPodId=${existing.id}`);
          return get().pool.get(existing.id)!;
        }

        // Create new pooled pod
        const id = nanoid();
        const newPod: PooledPod = {
          id,
          role,
          name: ROLE_NAMES[role] || role,
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
          runtime: executionAttemptId ? {
            executionAttemptId,
            podStatus: 'initializing',
            health: { status: 'healthy', lastHeartbeat: Date.now(), errorCount: 0, consecutiveFailures: 0, warnings: [] },
            resourceUsage: { cpuPercent: 0, memoryMB: 0, tokensUsed: 0, apiCalls: 0, executionTime: 0 },
            completedTasks: [],
            messageLog: [],
            modelConfig: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
            toolWhitelist: [],
          } : undefined,
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

        console.log(`[PodPool] CREATE new pod: role=${role}, tbwoId=${tbwoId}, poolPodId=${id}`);
        return newPod;
      },

      // ── Runtime state management ────────────────────────────────────────

      updatePodRuntime: (podId, updates) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (pod && pod.runtime) {
            Object.assign(pod.runtime, updates);
          }
        });
      },

      appendPodLog: (podId, content) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (pod?.runtime) {
            pod.runtime.messageLog.push({
              timestamp: Date.now(),
              from: podId,
              to: 'log',
              type: 'status_update',
              content,
            });
          }
        });
      },

      // ── Pod lifecycle ───────────────────────────────────────────────────

      returnPodToPool: (podId, summary, patterns) => {
        set((state) => {
          const pod = state.pool.get(podId);
          if (!pod) return;

          pod.status = 'available';
          pod.activeTBWOId = null;
          pod.runtime = undefined; // Clear runtime state
          pod.lastActiveAt = Date.now();

          if (summary) {
            const combined = pod.conversationSummary
              ? `${pod.conversationSummary}\n---\n${summary}`
              : summary;
            pod.conversationSummary = combined.length > 2000
              ? combined.slice(-2000)
              : combined;
          }

          if (patterns && patterns.length > 0) {
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
            pod.runtime = undefined;
          }
        });
      },

      removePod: (podId) => {
        set((state) => {
          state.pool.delete(podId);
        });
      },

      // ── Queries ─────────────────────────────────────────────────────────

      getAvailablePod: (role) => {
        const pods = [...get().pool.values()]
          .filter(p => p.role === role && p.status === 'available')
          .sort((a, b) => b.totalTasksCompleted - a.totalTasksCompleted);
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

      /** Get runtime pods for a specific TBWO execution. */
      getPodsForExecution: (tbwoId, executionAttemptId) => {
        return [...get().pool.values()].filter(p => {
          if (p.activeTBWOId !== tbwoId) return false;
          if (executionAttemptId && p.runtime?.executionAttemptId !== executionAttemptId) return false;
          return p.status === 'active' && !!p.runtime;
        });
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

      // ── Management ──────────────────────────────────────────────────────

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

      /** Release all pool pods assigned to a TBWO (for clean restarts). */
      clearForTBWO: (tbwoId) => {
        set((state) => {
          for (const pod of state.pool.values()) {
            if (pod.activeTBWOId === tbwoId) {
              pod.status = 'available';
              pod.activeTBWOId = null;
              pod.runtime = undefined;
            }
          }
        });
        console.log(`[PodPool] clearForTBWO: released all pods for ${tbwoId}`);
      },

      /** Prune stale pods that haven't been used within maxAgeMs (default 2 hours). */
      pruneStale: (maxAgeMs = 2 * 60 * 60 * 1000) => {
        set((state) => {
          const now = Date.now();
          const toDelete: string[] = [];
          for (const [id, pod] of state.pool) {
            const lastUsed = pod.runtime?.currentTask ? now : pod.lastActiveAt;
            if (now - lastUsed > maxAgeMs && pod.status !== 'active') {
              toDelete.push(id);
            }
          }
          for (const id of toDelete) {
            state.pool.delete(id);
          }
          if (toDelete.length > 0) {
            console.log(`[PodPool] pruneStale: removed ${toDelete.length} stale pods`);
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
        pool: (Array.from(state.pool.entries()) as Array<[string, PooledPod]>).map(([id, pod]) => {
          // Don't persist runtime state — it's transient
          const { runtime: _runtime, ...rest } = pod;
          return [id, rest];
        }),
        maxPoolSize: state.maxPoolSize,
      }),
      merge: (persisted: any, current: any) => {
        const pool = new Map(persisted?.pool || []);
        // Fix zombie pods: after refresh, pods marked 'active' have no runtime
        // (runtime is not persisted). Reset them to 'available'.
        for (const [, pod] of pool) {
          const p = pod as PooledPod;
          if (p.status === 'active' && !p.runtime) {
            p.status = 'available';
            p.activeTBWOId = null;
          }
        }
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
