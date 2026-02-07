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
import { receiptGenerator } from '../services/receiptGenerator';
import { createWebsiteSprintPlan, createWebsiteSprintPods, DEFAULT_WEBSITE_SPRINT_CONFIG } from '../services/tbwo/templates/websiteSprint';

import {
  TBWOStatus,
  TBWOType,
  PodRole,
  PodStatus,
  AuthorityLevel,
} from '../types/tbwo';
import type {
  TBWO,
  QualityTarget,
  ExecutionPlan,
  AgentPod,
  CheckpointDecision,
  Artifact,
  TBWOReceipts,
  Task,
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
  resumeExecution: (tbwoId: string) => void;
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
      showDashboard: false,
      selectedPodId: null,
      expandedPhases: new Set(),
      statusFilter: 'all',
      typeFilter: 'all',
      lastUpdate: Date.now(),
      
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
          progress: 0,
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
      // PLANNING
      // ========================================================================
      
      generateExecutionPlan: async (tbwoId) => {
        const tbwo = get().tbwos.get(tbwoId);
        if (!tbwo) {
          console.warn('[TBWO] generateExecutionPlan: TBWO not found:', tbwoId);
          return;
        }

        console.log('[TBWO] generateExecutionPlan: starting for', tbwoId, 'type:', tbwo.type);

        // Mark as planning
        get().updateTBWO(tbwoId, { status: TBWOStatus.PLANNING });

        try {
          const totalTime = tbwo.timeBudget.total;

          // === Website Sprint: use domain-specific factory ===
          if (tbwo.type === TBWOType.WEBSITE_SPRINT) {
            console.log('[TBWO] Using website sprint factory for plan generation');
            const pods = createWebsiteSprintPods(tbwoId);
            const plan = createWebsiteSprintPlan(tbwoId, DEFAULT_WEBSITE_SPRINT_CONFIG, pods, tbwo.objective);

            // Scale plan durations to match the TBWO's time budget
            const scaleFactor = totalTime / plan.estimatedDuration;
            plan.estimatedDuration = totalTime;
            for (const phase of plan.phases) {
              phase.estimatedDuration = Math.round(phase.estimatedDuration * scaleFactor);
              for (const task of phase.tasks) {
                task.estimatedDuration = Math.round(task.estimatedDuration * scaleFactor);
              }
            }

            get().updateTBWO(tbwoId, {
              plan,
              pods,
              status: TBWOStatus.AWAITING_APPROVAL,
            });

            console.log('[TBWO] generateExecutionPlan: website sprint plan created with', pods.size, 'pods and', plan.phases.length, 'phases');
            return;
          }

          // === Generic plan for other TBWO types ===
          const plan: ExecutionPlan = {
            id: nanoid(),
            tbwoId,
            summary: `Execution plan for ${tbwo.type}: ${tbwo.objective}`,
            estimatedDuration: totalTime,
            confidence: 0.85,
            phases: [
              {
                id: nanoid(),
                name: 'Analysis & Planning',
                description: 'Analyze requirements, plan approach, identify dependencies',
                order: 1,
                estimatedDuration: totalTime * 0.15,
                dependsOn: [],
                tasks: [
                  { id: nanoid(), name: 'Analyze requirements', description: 'Break down objective into actionable tasks', status: 'pending', estimatedDuration: totalTime * 0.05 },
                  { id: nanoid(), name: 'Plan approach', description: 'Determine tools, patterns, and architecture', status: 'pending', estimatedDuration: totalTime * 0.05 },
                  { id: nanoid(), name: 'Identify dependencies', description: 'Map dependencies and potential risks', status: 'pending', estimatedDuration: totalTime * 0.05 },
                ],
                assignedPods: [PodRole.ORCHESTRATOR],
                status: 'pending',
                progress: 0,
              },
              {
                id: nanoid(),
                name: 'Core Implementation',
                description: 'Build the primary deliverables',
                order: 2,
                estimatedDuration: totalTime * 0.5,
                dependsOn: [],
                tasks: [
                  { id: nanoid(), name: 'Implement core structure', description: 'Build the foundational structure and layout', status: 'pending', estimatedDuration: totalTime * 0.2 },
                  { id: nanoid(), name: 'Add content and logic', description: 'Populate with content, business logic, and styling', status: 'pending', estimatedDuration: totalTime * 0.2 },
                  { id: nanoid(), name: 'Polish and refine', description: 'Refine details, add finishing touches', status: 'pending', estimatedDuration: totalTime * 0.1 },
                ],
                assignedPods: [PodRole.FRONTEND, PodRole.DESIGN],
                status: 'pending',
                progress: 0,
              },
              {
                id: nanoid(),
                name: 'Quality Assurance',
                description: 'Test, validate, and ensure quality standards',
                order: 3,
                estimatedDuration: totalTime * 0.2,
                dependsOn: [],
                tasks: [
                  { id: nanoid(), name: 'Run quality checks', description: 'Validate output against requirements', status: 'pending', estimatedDuration: totalTime * 0.1 },
                  { id: nanoid(), name: 'Fix issues', description: 'Address any issues found during QA', status: 'pending', estimatedDuration: totalTime * 0.1 },
                ],
                assignedPods: [PodRole.QA],
                status: 'pending',
                progress: 0,
              },
              {
                id: nanoid(),
                name: 'Delivery',
                description: 'Package output and generate receipts',
                order: 4,
                estimatedDuration: totalTime * 0.15,
                dependsOn: [],
                tasks: [
                  { id: nanoid(), name: 'Package artifacts', description: 'Organize and package all generated files', status: 'pending', estimatedDuration: totalTime * 0.1 },
                  { id: nanoid(), name: 'Generate receipt', description: 'Create execution receipt with summary', status: 'pending', estimatedDuration: totalTime * 0.05 },
                ],
                assignedPods: [PodRole.ORCHESTRATOR],
                status: 'pending',
                progress: 0,
              },
            ],
            podStrategy: {
              mode: 'parallel',
              maxConcurrent: 5,
              priorityOrder: [PodRole.ORCHESTRATOR, PodRole.DESIGN, PodRole.FRONTEND, PodRole.COPY, PodRole.QA],
              dependencies: new Map(),
            },
            risks: [
              { description: 'Time budget may be insufficient for requested quality', severity: 'medium', mitigation: 'Reduce scope or extend time budget' },
            ],
            assumptions: ['User has necessary permissions', 'APIs are available'],
            deliverables: [
              { name: 'Final Artifacts', description: 'All generated files and assets', type: 'artifact', required: true },
            ],
            requiresApproval: true,
          };

          console.log('[TBWO] generateExecutionPlan: plan created, updating store...');

          get().updateTBWO(tbwoId, {
            plan,
            status: TBWOStatus.AWAITING_APPROVAL,
          });

          console.log('[TBWO] generateExecutionPlan: done, status set to AWAITING_APPROVAL');
        } catch (error: any) {
          console.error('[TBWO] Plan generation failed:', error);
          try {
            get().updateTBWO(tbwoId, { status: TBWOStatus.DRAFT });
          } catch (e2) {
            console.error('[TBWO] Failed to reset status after error:', e2);
          }
        }
      },
      
      approvePlan: (tbwoId) => {
        const now = Date.now();
        
        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (tbwo?.plan) {
            tbwo.plan.approvedAt = now;
            tbwo.plan.approvedBy = 'current-user'; // TODO: Get from auth
            state.lastUpdate = now;
          }
        });
      },
      
      rejectPlan: (tbwoId, feedback) => {
        get().updateTBWO(tbwoId, {
          status: TBWOStatus.DRAFT,
          plan: undefined,
        });
        
        // Store feedback for plan regeneration
        console.log('Plan rejected:', feedback);
      },
      
      // ========================================================================
      // EXECUTION
      // ========================================================================
      
      startExecution: async (tbwoId) => {
        const now = Date.now();
        const tbwo = get().getTBWOById(tbwoId);

        // Pre-create chat conversation so execution engine can post to it
        if (tbwo && !tbwo.chatConversationId) {
          try {
            // Lazy import to avoid circular dependency
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
      },

      resumeExecution: (tbwoId) => {
        executionEngine.resume(tbwoId);
      },

      cancelExecution: (tbwoId) => {
        executionEngine.cancel(tbwoId);
      },
      
      // ========================================================================
      // PODS
      // ========================================================================
      
      spawnPod: (tbwoId, role) => {
        const podId = nanoid();
        const now = Date.now();

        // Count existing pods in this TBWO for sequential naming
        const tbwoForNaming = get().tbwos.get(tbwoId);
        const existingPodCount = tbwoForNaming ? tbwoForNaming.pods.size : 0;

        const pod: AgentPod = {
          id: podId,
          role,
          name: `Pod ${existingPodCount + 1}`,
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
          toolWhitelist: ['file_write', 'file_read', 'file_list', 'execute_code', 'run_command', 'scan_directory', 'code_search', 'edit_file', 'web_search', 'git', 'system_status'],
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
        
        // Transition to idle after initialization
        setTimeout(() => {
          get().updatePod(podId, { status: PodStatus.IDLE, startedAt: Date.now() });
        }, 1000);
        
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
        const artifactId = nanoid();
        const now = Date.now();
        
        const artifact: Artifact = {
          ...artifactData,
          id: artifactId,
          tbwoId,
          createdAt: now,
          version: 1,
          status: 'draft',
        };
        
        set((state) => {
          const tbwo = state.tbwos.get(tbwoId);
          if (tbwo) {
            tbwo.artifacts.push(artifact);
            state.lastUpdate = now;
          }
        });
        
        return artifactId;
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
      // RECEIPTS
      // ========================================================================
      
      generateReceipts: async (tbwoId) => {
        const tbwo = get().tbwos.get(tbwoId);
        if (!tbwo) throw new Error('TBWO not found');

        try {
          // Build execution context from the TBWO's pod data
          const podMetrics = new Map<string, {
            podId: string; role: string; tasksCompleted: number; tasksFailed: number;
            tokensUsed: number; executionTime: number; successRate: number;
            artifacts: string[]; warnings: string[];
          }>();

          tbwo.pods.forEach((pod) => {
            podMetrics.set(pod.id, {
              podId: pod.id,
              role: pod.role,
              tasksCompleted: pod.completedTasks.length,
              tasksFailed: 0,
              tokensUsed: pod.resourceUsage.tokensUsed,
              executionTime: pod.resourceUsage.executionTime,
              successRate: pod.completedTasks.length > 0 ? 1 : 0,
              artifacts: pod.outputs.map((o) => typeof o === 'string' ? o : String(o)),
              warnings: pod.health.warnings,
            });
          });

          const context = {
            startTime: tbwo.startedAt || tbwo.createdAt,
            totalPauseDuration: 0,
            sharedArtifacts: new Map(tbwo.artifacts.map((a) => [a.id, a])),
            podMetrics,
            decisionTrail: [],
            qualityScore: (() => {
              const completed = tbwo.plan?.phases.reduce((sum, p) => sum + p.tasks.filter(t => t.status === 'complete').length, 0) || 0;
              const total = tbwo.plan?.phases.reduce((sum, p) => sum + p.tasks.length, 0) || 1;
              return Math.round((completed / total) * 100);
            })(),
            qualityChecks: [],
          };

          const receipts = await receiptGenerator.generateReceipts(tbwo, context);
          get().updateTBWO(tbwoId, { receipts });
          return receipts;
        } catch (error: any) {
          console.error('[TBWO] Receipt generation failed, using fallback:', error);
          // Fallback: basic receipt without AI summary
          const now = Date.now();
          const receipts: TBWOReceipts = {
            tbwoId,
            executive: {
              summary: `Completed ${tbwo.type} in ${Math.round(tbwo.timeBudget.elapsed)} minutes`,
              accomplishments: tbwo.artifacts.map((a) => `Created: ${a.name}`).slice(0, 10),
              filesCreated: tbwo.artifacts.filter((a) => a.path).length,
              filesModified: 0,
              linesOfCode: tbwo.artifacts.reduce((sum, a) => sum + (typeof a.content === 'string' ? a.content.split('\n').length : 0), 0),
              simplifications: [],
              unfinishedItems: [],
              qualityScore: (() => {
                const completed = tbwo.plan?.phases.reduce((sum, p) => sum + p.tasks.filter(t => t.status === 'complete').length, 0) || 0;
                const total = tbwo.plan?.phases.reduce((sum, p) => sum + p.tasks.length, 0) || 1;
                return Math.round((completed / total) * 100);
              })(),
              qualityNotes: ['Execution completed'],
            },
            technical: {
              buildStatus: 'success',
              dependencies: [],
              performanceMetrics: {},
            },
            podReceipts: new Map(),
            rollback: {
              canRollback: true,
              rollbackInstructions: [],
              limitations: [],
            },
            generatedAt: now,
          };

          tbwo.pods.forEach((pod) => {
            receipts.podReceipts.set(pod.id, {
              podId: pod.id,
              role: pod.role,
              tasksCompleted: pod.completedTasks.length,
              tasksSkipped: 0,
              tasksFailed: 0,
              artifactsProduced: [],
              timeUsed: pod.resourceUsage.executionTime,
              timeAllocated: 0,
              confidenceNotes: [],
              warnings: pod.health.warnings,
            });
          });

          get().updateTBWO(tbwoId, { receipts });
          return receipts;
        }
      },
      
      // ========================================================================
      // UI
      // ========================================================================
      
      toggleDashboard: () => {
        set((state) => {
          state.showDashboard = !state.showDashboard;
        });
      },
      
      selectPod: (podId) => {
        set({ selectedPodId: podId });
      },
      
      togglePhase: (phaseId) => {
        set((state) => {
          if (state.expandedPhases.has(phaseId)) {
            state.expandedPhases.delete(phaseId);
          } else {
            state.expandedPhases.add(phaseId);
          }
        });
      },
      
      setStatusFilter: (status) => {
        set({ statusFilter: status });
      },
      
      setTypeFilter: (type) => {
        set({ typeFilter: type });
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
                      } : tbwo.receipts,
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
            localStorage.setItem(
              name,
              JSON.stringify({
                state: {
                  ...state,
                  tbwos: tbwoEntries.map(([id, tbwo]: [string, any]) => [
                    id,
                    {
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
                    },
                  ]),
                },
              })
            );
          } catch (e) {
            console.error('[TBWO] Failed to save to localStorage:', e);
          }
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);

