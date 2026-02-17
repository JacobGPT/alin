/**
 * TBWO Store - Time-Budgeted Work Order State Management
 * 
 * Manages the complete lifecycle of TBWOs:
 * - Creation and configuration
 * - Execution planning
 * - Pod orchestration
 * - Progress tracking
 * - Checkpoint handling
 * - Receipt generation
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import * as dbService from '../api/dbService';

import { executionEngine } from '../services/tbwo/executionEngine';

import { createTBWOUISlice } from './tbwo/uiSlice';
import { createPlanningSlice } from './tbwo/planningSlice';
import { createOptimizationSlice } from './tbwo/optimizationSlice';
import { createReceiptsSlice } from './tbwo/receiptsSlice';

import {
  TBWOStatus,
  TBWOType,
  PodRole,
  PodStatus,
  AuthorityLevel,
  ContentTag,
} from '../types/tbwo';
import type {
  TBWO,
  QualityTarget,
  AgentPod,
  CheckpointDecision,
  Artifact,
  TBWOReceipts,
  Task,
  PauseRequest,
  SectionRegenerationRequest,
  SectionRegenerationResult,
} from '../types/tbwo';

// ============================================================================
// STORE STATE TYPE
// ============================================================================

interface TBWOState {
  // TBWOs
  tbwos: Map<string, TBWO>;
  activeTBWOId: string | null;
  
  // UI State
  showDashboard: boolean;
  selectedPodId: string | null;
  expandedPhases: Set<string>;
  
  // Filters
  statusFilter: TBWOStatus | 'all';
  typeFilter: TBWOType | 'all';
  
  // Real-time updates
  lastUpdate: number;
}

interface TBWOActions {
  // TBWO Lifecycle
  createTBWO: (config: {
    type: TBWOType;
    objective: string;
    timeBudgetMinutes: number;
    qualityTarget: QualityTarget;
  }) => string;
  updateTBWO: (id: string, updates: Partial<TBWO>) => void;
  deleteTBWO: (id: string) => void;
  setActiveTBWO: (id: string | null) => void;
  
  // Planning
  generateExecutionPlan: (tbwoId: string) => Promise<void>;
  approvePlan: (tbwoId: string) => void;
  rejectPlan: (tbwoId: string, feedback: string) => void;
  
  // Execution
  startExecution: (tbwoId: string) => Promise<void>;
  pauseExecution: (tbwoId: string) => void;
  resumeExecution: (tbwoId: string) => Promise<void>;
  cancelExecution: (tbwoId: string) => void;
  
  // Pods
  spawnPod: (tbwoId: string, role: PodRole) => string;
  updatePod: (podId: string, updates: Partial<AgentPod>) => void;
  terminatePod: (podId: string) => void;
  assignTaskToPod: (podId: string, task: Task) => void;
  
  // Checkpoints
  reachCheckpoint: (checkpointId: string) => void;
  respondToCheckpoint: (checkpointId: string, decision: CheckpointDecision) => void;
  
  // Artifacts
  addArtifact: (tbwoId: string, artifact: Omit<Artifact, 'id' | 'createdAt'>) => string;
  updateArtifact: (artifactId: string, updates: Partial<Artifact>) => void;
  
  // Progress
  updateProgress: (tbwoId: string, progress: number) => void;
  updatePhaseProgress: (phaseId: string, progress: number) => void;
  completeTask: (taskId: string) => void;
  
  // Receipts
  generateReceipts: (tbwoId: string) => Promise<TBWOReceipts>;
  
  // UI
  toggleDashboard: () => void;
  selectPod: (podId: string | null) => void;
  togglePhase: (phaseId: string) => void;
  setStatusFilter: (status: TBWOStatus | 'all') => void;
  setTypeFilter: (type: TBWOType | 'all') => void;
  
  // Pause-and-Ask
  addPauseRequest: (tbwoId: string, pauseRequest: PauseRequest) => void;
  resolvePauseRequest: (tbwoId: string, pauseId: string, resolution: {
    userResponse?: string;
    inferredValues?: Record<string, unknown>;
    contentTag: ContentTag;
    status: 'answered' | 'inferred' | 'skipped';
  }) => void;
  submitPauseResponse: (tbwoId: string, pauseId: string, response: string) => void;
  getPendingPause: (tbwoId: string) => PauseRequest | null;

  // Site Optimization
  regenerateSection: (tbwoId: string, request: SectionRegenerationRequest) => Promise<SectionRegenerationResult>;
  applyImprovements: (tbwoId: string, improvementIds: string[]) => Promise<{ applied: number; failed: number }>;

  // Utilities
  getTBWOById: (id: string) => TBWO | undefined;
  getActiveTBWO: () => TBWO | null;
  getPodById: (podId: string) => { pod: AgentPod; tbwo: TBWO } | null;
  getActiveTBWOs: () => TBWO[];
  getCompletedTBWOs: () => TBWO[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createTimeBudget(totalMinutes: number) {
  return {
    total: totalMinutes,
    elapsed: 0,
    remaining: totalMinutes,
    phases: new Map(),
    warningThreshold: 80,
    criticalThreshold: 95,
  };
}

function createDefaultScope() {
  return {
    allowedOperations: [],
    workingDirectory: '/workspace',
    allowedPaths: ['/workspace'],
    forbiddenPaths: ['/system', '/etc'],
    allowNetworkAccess: true,
    allowedTools: [],
    forbiddenTools: [],
    maxFileSize: 100 * 1024 * 1024, // 100MB
    maxTotalStorage: 1024 * 1024 * 1024, // 1GB
    maxConcurrentPods: 5,
    allowedAPIs: [],
    canDeploy: false,
    canModifyDatabase: false,
  };
}

// ============================================================================
// DB SERIALIZATION & DEBOUNCE HELPERS
// ============================================================================

function _serializeTBWOForDb(tbwo: any): Record<string, unknown> {
  return {
    id: tbwo.id,
    type: tbwo.type,
    status: tbwo.status,
    objective: tbwo.objective,
    timeBudgetTotal: tbwo.timeBudget?.total || 60,
    qualityTarget: tbwo.qualityTarget,
    scope: tbwo.scope,
    plan: tbwo.plan ? {
      ...tbwo.plan,
      podStrategy: tbwo.plan.podStrategy ? {
        ...tbwo.plan.podStrategy,
        dependencies: tbwo.plan.podStrategy.dependencies instanceof Map
          ? Array.from(tbwo.plan.podStrategy.dependencies.entries())
          : (tbwo.plan.podStrategy.dependencies || []),
      } : tbwo.plan.podStrategy,
    } : null,
    pods: tbwo.pods instanceof Map ? Array.from(tbwo.pods.entries()) : (tbwo.pods || []),
    activePods: tbwo.activePods instanceof Set ? Array.from(tbwo.activePods) : (tbwo.activePods || []),
    artifacts: tbwo.artifacts || [],
    checkpoints: tbwo.checkpoints || [],
    authorityLevel: tbwo.authorityLevel,
    progress: tbwo.progress,
    receipts: tbwo.receipts ? {
      ...tbwo.receipts,
      podReceipts: tbwo.receipts.podReceipts instanceof Map
        ? Array.from(tbwo.receipts.podReceipts.entries())
        : (tbwo.receipts.podReceipts || []),
    } : null,
    chatConversationId: tbwo.chatConversationId,
    startedAt: tbwo.startedAt,
    completedAt: tbwo.completedAt,
    metadata: tbwo.metadata || {},
    createdAt: tbwo.createdAt,
    updatedAt: tbwo.updatedAt,
  };
}

const _tbwoUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
function _debouncedTBWOUpdate(id: string, get: () => any) {
  const existing = _tbwoUpdateTimers.get(id);
  if (existing) clearTimeout(existing);
  _tbwoUpdateTimers.set(id, setTimeout(() => {
    _tbwoUpdateTimers.delete(id);
    const tbwo = get().tbwos.get(id);
    if (tbwo) {
      dbService.updateTBWO(id, _serializeTBWOForDb(tbwo))
        .catch(e => console.warn('[tbwoStore] DB updateTBWO failed:', e));
    }
  }, 1000));
}

// ============================================================================
// ZUSTAND STORE
// ============================================================================

export const useTBWOStore = create<TBWOState & TBWOActions>()(
  persist(
    immer((set, get) => ({
      // ========================================================================
      // INITIAL STATE
      // ========================================================================

      tbwos: new Map(),
      activeTBWOId: null,
      lastUpdate: Date.now(),

      // Spread slices
      ...createTBWOUISlice(set, get),
      ...createPlanningSlice(set, get),
      ...createOptimizationSlice(set, get),
      ...createReceiptsSlice(set, get),

      // ========================================================================
      // TBWO LIFECYCLE
      // ========================================================================
      
      createTBWO: (config) => {
        const id = nanoid();
        const now = Date.now();
        
        const newTBWO: TBWO = {
          id,
          type: config.type,
          status: TBWOStatus.DRAFT,
          objective: config.objective,
          timeBudget: createTimeBudget(config.timeBudgetMinutes),
          qualityTarget: config.qualityTarget,
          scope: createDefaultScope(),
          pods: new Map(),
          activePods: new Set(),
          artifacts: [],
          checkpoints: [],
          authorityLevel: AuthorityLevel.GUIDED,
          permissionGates: [],
          pauseRequests: [],
          progress: 0,
          metadata: {},
          createdAt: now,
          updatedAt: now,
          userId: 'current-user', // TODO: Get from auth
        };
        
        set((state) => {
          state.tbwos.set(id, newTBWO);
          state.activeTBWOId = id;
          state.lastUpdate = now;
        });

        // Fire-and-forget DB write
        dbService.createTBWO(_serializeTBWOForDb(newTBWO))
          .catch(e => console.warn('[tbwoStore] DB createTBWO failed:', e));

        return id;
      },
      
      updateTBWO: (id, updates) => {
        set((state) => {
          const tbwo = state.tbwos.get(id);
          if (tbwo) {
            Object.assign(tbwo, updates);
            tbwo.updatedAt = Date.now();
            state.lastUpdate = Date.now();
          }
        });

        // Debounced DB write
        _debouncedTBWOUpdate(id, get);
      },
      
      deleteTBWO: (id) => {
        set((state) => {
          state.tbwos.delete(id);

          if (state.activeTBWOId === id) {
            // Switch to most recent TBWO or null
            const tbwos = Array.from(state.tbwos.values());
            const mostRecent = tbwos.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            state.activeTBWOId = mostRecent?.id || null;
          }

          state.lastUpdate = Date.now();
        });

        dbService.deleteTBWO(id).catch(e => console.warn('[tbwoStore] DB deleteTBWO failed:', e));
      },
      
      setActiveTBWO: (id) => {
        set({ activeTBWOId: id });
      },
      
      // ========================================================================
      // EXECUTION
      // ========================================================================
      
      startExecution: async (tbwoId) => {
        const now = Date.now();
        const tbwo = get().getTBWOById(tbwoId);
        if (!tbwo) return;

        // Idempotency guard: refuse to start if GENUINELY executing
        // After a browser refresh, status may be EXECUTING but the engine has no state
        if (tbwo.status === TBWOStatus.EXECUTING && tbwo.executionAttemptId) {
          if (executionEngine.isExecuting(tbwoId)) {
            console.warn(`[TBWO] startExecution: already executing (attempt=${tbwo.executionAttemptId}), ignoring duplicate call`);
            return;
          }
          // Stale status after refresh — allow re-execution
          console.log(`[TBWO] startExecution: stale EXECUTING status detected, allowing fresh start`);
        }

        // Generate a unique execution attempt ID
        const executionAttemptId = nanoid();
        console.log(`[TBWO] startExecution: tbwoId=${tbwoId}, executionAttemptId=${executionAttemptId}`);

        // Pre-create chat conversation so execution engine can post to it
        if (!tbwo.chatConversationId) {
          try {
            const { useChatStore } = await import('./chatStore');
            const convId = useChatStore.getState().createConversation({
              title: `TBWO: ${tbwo.objective.slice(0, 50)}`,
            });
            get().updateTBWO(tbwoId, { chatConversationId: convId });
          } catch (e) {
            console.warn('[TBWO] Failed to pre-create chat conversation:', e);
          }
        }

        get().updateTBWO(tbwoId, {
          status: TBWOStatus.EXECUTING,
          startedAt: now,
          executionAttemptId,
        });

        // Execute with modular execution engine
        // (engine handles pod spawning, phase execution, contracts, receipts)
        try {
          await executionEngine.execute(tbwoId);
        } catch (error: any) {
          console.error('[TBWO] Execution failed:', error);
          get().updateTBWO(tbwoId, {
            status: TBWOStatus.FAILED,
          });
        }
      },
      
      pauseExecution: (tbwoId) => {
        executionEngine.pause(tbwoId);
        // Fallback: if engine has no state (e.g. after refresh), directly update store
        if (!executionEngine.isRunning(tbwoId)) {
          get().updateTBWO(tbwoId, { status: TBWOStatus.PAUSED });
        }
      },

      cancelExecution: (tbwoId) => {
        executionEngine.cancel(tbwoId);
        // Fallback: if engine has no state (e.g. after refresh), directly update store
        if (!executionEngine.isRunning(tbwoId)) {
          get().updateTBWO(tbwoId, {
            status: TBWOStatus.CANCELLED,
            completedAt: Date.now(),
          });
          // Clear stale active pods
          set((state) => {
            const tbwo = state.tbwos.get(tbwoId);
            if (tbwo) {
              tbwo.activePods = new Set();
            }
          });
        }
      },

      resumeExecution: async (tbwoId: string) => {
        const tbwo = get().getTBWOById(tbwoId);
        if (!tbwo) return;

        // Only resume TBWOs that were executing or paused
        if (tbwo.status !== TBWOStatus.EXECUTING && tbwo.status !== TBWOStatus.PAUSED && tbwo.status !== TBWOStatus.PAUSED_WAITING_FOR_USER) {
          console.warn(`[TBWO] resumeExecution: TBWO ${tbwoId} is in status ${tbwo.status}, not resumable`);
          return;
        }

        // Don't re-resume if already running
        if (executionEngine.isRunning(tbwoId)) {
          console.warn(`[TBWO] resumeExecution: TBWO ${tbwoId} is already running in engine`);
          return;
        }

        // If paused in the engine (engine has state), just resume
        const engineStatus = executionEngine.getState(tbwoId)?.status;
        if (engineStatus === 'paused' || engineStatus === 'paused_waiting_for_user') {
          executionEngine.resume(tbwoId);
          return;
        }

        // Pre-create chat conversation if it doesn't exist
        if (!tbwo.chatConversationId) {
          try {
            const { useChatStore } = await import('./chatStore');
            const convId = useChatStore.getState().createConversation({
              title: `TBWO: ${tbwo.objective.slice(0, 50)}`,
            });
            get().updateTBWO(tbwoId, { chatConversationId: convId });
          } catch (e) {
            console.warn('[TBWO] Failed to pre-create chat conversation for resume:', e);
          }
        }

        // Resume execution via engine (skips completed tasks)
        console.log(`[TBWO] resumeExecution: resuming TBWO ${tbwoId}`);
        try {
          await executionEngine.execute(tbwoId, { resume: true });
        } catch (error: any) {
          console.error('[TBWO] Resume execution failed:', error);
          get().updateTBWO(tbwoId, {
            status: TBWOStatus.FAILED,
          });
        }
      },
      
      // ========================================================================
      // PODS
      // ========================================================================
      
      spawnPod: (tbwoId, role) => {
        const now = Date.now();

        // Enforce uniqueness: if a pod with this role already exists in the
        // TBWO (e.g. created during plan generation), reactivate it instead
        // of creating a duplicate.
        const existingTbwo = get().tbwos.get(tbwoId);
        if (existingTbwo) {
          const existingPod = Array.from(existingTbwo.pods.values()).find(p => p.role === role);
          if (existingPod) {
            set((state) => {
              const tbwo = state.tbwos.get(tbwoId);
              if (tbwo) {
                const pod = tbwo.pods.get(existingPod.id);
                if (pod) {
                  pod.status = PodStatus.INITIALIZING;
                  pod.health = { status: 'healthy', lastHeartbeat: now, errorCount: 0, consecutiveFailures: 0, warnings: [] };
                  pod.resourceUsage = { cpuPercent: 0, memoryMB: 0, tokensUsed: 0, apiCalls: 0, executionTime: 0 };
                  pod.taskQueue = [];
                  pod.completedTasks = [];
                  pod.outputs = [];
                  pod.messageLog = [];
                }
                tbwo.activePods.add(existingPod.id);
                state.lastUpdate = now;
              }
            });

            // Set pod to IDLE immediately (no delay)
            get().updatePod(existingPod.id, { status: PodStatus.IDLE, startedAt: Date.now() });

            return existingPod.id;
          }
        }

        // No existing pod for this role — create a new one
        const podId = nanoid();
        const existingPodCount = existingTbwo ? existingTbwo.pods.size : 0;

        const ROLE_DISPLAY_NAMES: Record<string, string> = {
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

        const pod: AgentPod = {
          id: podId,
          role,
          name: ROLE_DISPLAY_NAMES[role] || `Pod ${existingPodCount + 1}`,
          status: PodStatus.INITIALIZING,
          health: {
            status: 'healthy',
            lastHeartbeat: now,
            errorCount: 0,
            consecutiveFailures: 0,
            warnings: [],
          },
          modelConfig: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
          },
          toolWhitelist: ['file_write', 'file_read', 'file_list', 'execute_code', 'run_command', 'scan_directory', 'code_search', 'edit_file', 'web_search', 'git', 'system_status', 'web_fetch', 'search_images', 'generate_image', 'site_validate', 'conversion_audit', 'site_improve', 'motion_validate', 'scene_validate', 'output_guard'],
          memoryScope: [],
          taskQueue: [],
          completedTasks: [],
          outputs: [],
          resourceUsage: {
            cpuPercent: 0,
            memoryMB: 0,
            tokensUsed: 0,
            apiCalls: 0,
            executionTime: 0,
          },
          messageLog: [],
          createdAt: now,
          tbwoId,
        };

        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (tbwo) {
            tbwo.pods.set(podId, pod);
            tbwo.activePods.add(podId);
            state.lastUpdate = now;
          }
        });

        // Set pod to IDLE immediately (no delay)
        get().updatePod(podId, { status: PodStatus.IDLE, startedAt: Date.now() });

        return podId;
      },
      
      updatePod: (podId, updates) => {
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            const pod = tbwo.pods.get(podId);
            if (pod) {
              Object.assign(pod, updates);
              state.lastUpdate = Date.now();
              break;
            }
          }
        });
      },
      
      terminatePod: (podId) => {
        const now = Date.now();
        
        get().updatePod(podId, {
          status: PodStatus.TERMINATED,
          stoppedAt: now,
        });
        
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            if (tbwo.activePods.has(podId)) {
              tbwo.activePods.delete(podId);
              state.lastUpdate = now;
              break;
            }
          }
        });
      },
      
      assignTaskToPod: (podId, task) => {
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            const pod = tbwo.pods.get(podId);
            if (pod) {
              pod.taskQueue.push(task);
              pod.currentTask = task;
              pod.status = PodStatus.WORKING;
              state.lastUpdate = Date.now();
              break;
            }
          }
        });
      },
      
      // ========================================================================
      // CHECKPOINTS
      // ========================================================================
      
      reachCheckpoint: (checkpointId) => {
        const now = Date.now();
        
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            const checkpoint = tbwo.checkpoints.find((c) => c.id === checkpointId);
            if (checkpoint) {
              checkpoint.status = 'reached';
              checkpoint.reachedAt = now;
              tbwo.status = TBWOStatus.CHECKPOINT;
              state.lastUpdate = now;
              break;
            }
          }
        });
      },
      
      respondToCheckpoint: (checkpointId, decision) => {
        const now = Date.now();
        
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            const checkpoint = tbwo.checkpoints.find((c) => c.id === checkpointId);
            if (checkpoint) {
              checkpoint.decision = decision;
              checkpoint.decidedAt = now;
              checkpoint.status = decision.action === 'continue' ? 'approved' : 'rejected';
              
              // Update TBWO status based on decision
              if (decision.action === 'continue') {
                tbwo.status = TBWOStatus.EXECUTING;
              } else if (decision.action === 'cancel') {
                tbwo.status = TBWOStatus.CANCELLED;
              } else if (decision.action === 'pause') {
                tbwo.status = TBWOStatus.PAUSED;
              }
              
              state.lastUpdate = now;
              break;
            }
          }
        });
      },
      
      // ========================================================================
      // ARTIFACTS
      // ========================================================================
      
      addArtifact: (tbwoId, artifactData) => {
        const now = Date.now();
        let resultId = '';

        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (tbwo) {
            // Dedup: if artifact with same path already exists, update it instead
            const artPath = (artifactData as any).path as string | undefined;
            const existingIdx = artPath ? tbwo.artifacts.findIndex(a =>
              a.path &&
              a.path.replace(/\\/g, '/').toLowerCase() === artPath.replace(/\\/g, '/').toLowerCase()
            ) : -1;

            if (existingIdx >= 0) {
              // Update existing artifact in-place
              tbwo.artifacts[existingIdx] = {
                ...tbwo.artifacts[existingIdx],
                ...artifactData,
                id: tbwo.artifacts[existingIdx].id, // keep original ID
                version: (tbwo.artifacts[existingIdx].version || 1) + 1,
              };
              resultId = tbwo.artifacts[existingIdx].id;
            } else {
              const artifactId = nanoid();
              const artifact: Artifact = {
                ...artifactData,
                id: artifactId,
                tbwoId,
                createdAt: now,
                version: 1,
                status: 'draft',
              };
              tbwo.artifacts.push(artifact);
              resultId = artifactId;
            }
            state.lastUpdate = now;
          }
        });

        return resultId || nanoid();
      },
      
      updateArtifact: (artifactId, updates) => {
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            const artifact = tbwo.artifacts.find((a) => a.id === artifactId);
            if (artifact) {
              Object.assign(artifact, updates);
              state.lastUpdate = Date.now();
              break;
            }
          }
        });
      },
      
      // ========================================================================
      // PROGRESS
      // ========================================================================
      
      updateProgress: (tbwoId, progress) => {
        get().updateTBWO(tbwoId, { progress: Math.min(100, Math.max(0, progress)) });
      },
      
      updatePhaseProgress: (phaseId, progress) => {
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            const phase = tbwo.plan?.phases.find((p) => p.id === phaseId);
            if (phase) {
              phase.progress = Math.min(100, Math.max(0, progress));
              
              if (progress >= 100) {
                phase.status = 'complete';
                phase.completedAt = Date.now();
              }
              
              state.lastUpdate = Date.now();
              break;
            }
          }
        });
      },
      
      completeTask: (taskId) => {
        set((state) => {
          for (const tbwo of state.tbwos.values()) {
            for (const phase of tbwo.plan?.phases || []) {
              const task = phase.tasks.find((t) => t.id === taskId);
              if (task) {
                task.status = 'complete';
                task.actualDuration = Date.now() - (task.actualDuration || 0);
                state.lastUpdate = Date.now();
                break;
              }
            }
          }
        });
      },
      
      // ========================================================================
      // PAUSE-AND-ASK
      // ========================================================================

      addPauseRequest: (tbwoId, pauseRequest) => {
        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (!tbwo) return;
          if (!tbwo.pauseRequests) tbwo.pauseRequests = [];
          tbwo.pauseRequests.push(pauseRequest);
          tbwo.activePauseId = pauseRequest.id;
          tbwo.updatedAt = Date.now();
        });
      },

      resolvePauseRequest: (tbwoId, pauseId, resolution) => {
        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (!tbwo || !tbwo.pauseRequests) return;
          const pause = tbwo.pauseRequests.find(pr => pr.id === pauseId);
          if (!pause) return;
          pause.status = resolution.status;
          pause.userResponse = resolution.userResponse;
          pause.inferredValues = resolution.inferredValues;
          pause.contentTag = resolution.contentTag;
          pause.resolvedAt = Date.now();
          // Clear active pause if this was the current one
          if (tbwo.activePauseId === pauseId) {
            tbwo.activePauseId = undefined;
          }
          tbwo.updatedAt = Date.now();
        });
      },

      submitPauseResponse: (tbwoId, pauseId, response) => {
        // Called by the UI when user types a response to a pause question
        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (!tbwo || !tbwo.pauseRequests) return;
          const pause = tbwo.pauseRequests.find(pr => pr.id === pauseId);
          if (!pause || pause.status !== 'pending') return;
          pause.status = 'answered';
          pause.userResponse = response;
          pause.contentTag = ContentTag.USER_PROVIDED;
          pause.resolvedAt = Date.now();
          if (tbwo.activePauseId === pauseId) {
            tbwo.activePauseId = undefined;
          }
          tbwo.updatedAt = Date.now();
        });
        // The execution engine's waitForPauseResolution() polls the store
        // and will detect the status change automatically
      },

      getPendingPause: (tbwoId) => {
        const tbwo = get().tbwos.get(tbwoId);
        if (!tbwo || !tbwo.pauseRequests || !tbwo.activePauseId) return null;
        return tbwo.pauseRequests.find(pr => pr.id === tbwo.activePauseId && pr.status === 'pending') || null;
      },

      // ========================================================================
      // UTILITIES
      // ========================================================================

      getTBWOById: (id) => {
        return get().tbwos.get(id);
      },
      
      getActiveTBWO: () => {
        const { activeTBWOId, tbwos } = get();
        return activeTBWOId ? tbwos.get(activeTBWOId) || null : null;
      },
      
      getPodById: (podId) => {
        for (const tbwo of get().tbwos.values()) {
          const pod = tbwo.pods.get(podId);
          if (pod) {
            return { pod, tbwo };
          }
        }
        return null;
      },
      
      getActiveTBWOs: () => {
        return Array.from(get().tbwos.values()).filter(
          (tbwo) =>
            tbwo.status === TBWOStatus.EXECUTING ||
            tbwo.status === TBWOStatus.PLANNING ||
            tbwo.status === TBWOStatus.CHECKPOINT
        );
      },
      
      getCompletedTBWOs: () => {
        return Array.from(get().tbwos.values()).filter(
          (tbwo) => tbwo.status === TBWOStatus.COMPLETED
        );
      },

    })),
    {
      name: 'alin-tbwo-storage',
      partialize: (state) => ({
        tbwos: Array.from(state.tbwos.entries()),
      }),
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            if (!str) return null;
            const { state } = JSON.parse(str);
            if (!state?.tbwos || !Array.isArray(state.tbwos)) return null;
            return {
              state: {
                ...state,
                tbwos: new Map(
                  state.tbwos.map(([id, tbwo]: [string, any]) => [
                    id,
                    {
                      ...tbwo,
                      pods: new Map(Array.isArray(tbwo.pods) ? tbwo.pods : []),
                      activePods: new Set(Array.isArray(tbwo.activePods) ? tbwo.activePods : []),
                      timeBudget: tbwo.timeBudget ? {
                        ...tbwo.timeBudget,
                        phases: new Map(Array.isArray(tbwo.timeBudget.phases) ? tbwo.timeBudget.phases : []),
                      } : { total: 60, elapsed: 0, remaining: 60, phases: new Map(), warningThreshold: 80, criticalThreshold: 95 },
                      // Reconstitute Map in podStrategy.dependencies if plan exists
                      plan: tbwo.plan ? {
                        ...tbwo.plan,
                        podStrategy: tbwo.plan.podStrategy ? {
                          ...tbwo.plan.podStrategy,
                          dependencies: new Map(Array.isArray(tbwo.plan.podStrategy.dependencies) ? tbwo.plan.podStrategy.dependencies : []),
                        } : tbwo.plan.podStrategy,
                      } : tbwo.plan,
                      // Reconstitute Map in receipts.podReceipts if exists
                      receipts: tbwo.receipts ? {
                        ...tbwo.receipts,
                        podReceipts: new Map(Array.isArray(tbwo.receipts.podReceipts) ? tbwo.receipts.podReceipts : []),
                        pauseEvents: tbwo.receipts.pauseEvents || [],
                      } : tbwo.receipts,
                      // Ensure pauseRequests always initialized (backward compat)
                      pauseRequests: Array.isArray(tbwo.pauseRequests) ? tbwo.pauseRequests : [],
                    },
                  ])
                ),
              },
            };
          } catch (e) {
            console.error('[TBWO] Failed to load from localStorage:', e);
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            const { state } = value;
            // partialize already converts tbwos Map to an array of [id, tbwo] tuples
            const tbwoEntries = Array.isArray(state.tbwos) ? state.tbwos : Array.from(state.tbwos.entries());

            const serializeTbwo = (tbwo: any) => ({
              ...tbwo,
              pods: tbwo.pods instanceof Map ? Array.from(tbwo.pods.entries()) : (Array.isArray(tbwo.pods) ? tbwo.pods : []),
              activePods: tbwo.activePods instanceof Set ? Array.from(tbwo.activePods) : (Array.isArray(tbwo.activePods) ? tbwo.activePods : []),
              timeBudget: tbwo.timeBudget ? {
                ...tbwo.timeBudget,
                phases: tbwo.timeBudget.phases instanceof Map ? Array.from(tbwo.timeBudget.phases.entries()) : (Array.isArray(tbwo.timeBudget.phases) ? tbwo.timeBudget.phases : []),
              } : tbwo.timeBudget,
              plan: tbwo.plan ? {
                ...tbwo.plan,
                podStrategy: tbwo.plan.podStrategy ? {
                  ...tbwo.plan.podStrategy,
                  dependencies: tbwo.plan.podStrategy.dependencies instanceof Map ? Array.from(tbwo.plan.podStrategy.dependencies.entries()) : (Array.isArray(tbwo.plan.podStrategy.dependencies) ? tbwo.plan.podStrategy.dependencies : []),
                } : tbwo.plan.podStrategy,
              } : tbwo.plan,
              receipts: tbwo.receipts ? {
                ...tbwo.receipts,
                podReceipts: tbwo.receipts.podReceipts instanceof Map ? Array.from(tbwo.receipts.podReceipts.entries()) : (Array.isArray(tbwo.receipts.podReceipts) ? tbwo.receipts.podReceipts : []),
              } : tbwo.receipts,
              // Strip large chat/artifact data to reduce localStorage size
              chatConversationId: tbwo.chatConversationId,
              artifacts: undefined,
            });

            const serialized = tbwoEntries.map(([id, tbwo]: [string, any]) => [id, serializeTbwo(tbwo)]);
            const json = JSON.stringify({ state: { ...state, tbwos: serialized } });

            // Only persist if under 2MB to avoid quota errors
            if (json.length > 2_000_000) {
              // Keep only the 5 most recent TBWOs
              const trimmed = serialized
                .sort(([, a]: any, [, b]: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
                .slice(0, 5);
              const trimmedJson = JSON.stringify({ state: { ...state, tbwos: trimmed } });
              if (trimmedJson.length < 4_500_000) {
                localStorage.setItem(name, trimmedJson);
              }
              // If still too large, just skip — DB is the durable store
              return;
            }

            localStorage.setItem(name, json);
          } catch (e: any) {
            if (e?.name === 'QuotaExceededError') {
              // Quota exceeded — remove TBWO from localStorage, rely on DB
              try { localStorage.removeItem(name); } catch {}
            } else {
              console.warn('[TBWO] Failed to save to localStorage:', e);
            }
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

