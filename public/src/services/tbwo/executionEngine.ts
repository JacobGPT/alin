/**
 * TBWO Execution Engine - Modular orchestrator for Time-Budgeted Work Orders
 *
 * This is the clean, modular replacement for the monolithic execute() flow
 * in tbwoExecutor.ts. It coordinates pods, manages phase execution, handles
 * checkpoints, and drives the full TBWO lifecycle.
 *
 * Key responsibilities:
 * - Initialize execution state and validate plans
 * - Create contracts via contractService
 * - Spawn and manage agent pods
 * - Execute phases in order, tasks in parallel groups by dependency
 * - Handle tool calls within pod execution
 * - Run quality gates and checkpoints between phases
 * - Track time budget and update the store
 * - Generate receipts and clean up on completion
 *
 * Design principles:
 * - All Zustand store reads use useTBWOStore.getState() fresh each time (never cached)
 * - Tool execution makes fetch() calls to the backend via relative URLs
 * - Error handling: individual task failures do not kill the phase unless ALL tasks fail
 * - Contract validation happens before each tool call
 */

import { nanoid } from 'nanoid';
import type {
  TBWO,
  Phase,
  Task,
  AgentPod,
  Artifact,
  Checkpoint,
  CheckpointDecision,
  PauseRequest,
} from '../../types/tbwo';
import {
  TBWOStatus,
  TBWOType,
  PodStatus,
  PodRole,
  AuthorityLevel,
  ArtifactType,
  CheckpointTrigger,
  PauseReason,
  ContentTag,
} from '../../types/tbwo';
import { useTBWOStore } from '../../store/tbwoStore';
import { useChatStore } from '../../store/chatStore';
import { MessageRole } from '../../types/chat';
import type { ContentBlock } from '../../types/chat';
import { MessageBus } from './messagebus';
import type { BusMessage } from './messagebus';
import { AIService } from './aiService';
import { contractService } from '../contractService';
import { tbwoUpdateService } from './websocketService';
// getDomainPodPrompt moved to promptBuilder.ts
import { usePodPoolStore, getPooledPodContext } from '../../store/podPoolStore';
import { useAuthStore } from '../../store/authStore';
// assertTokenBudget, compactBrief, estimateTokens moved to promptBuilder.ts
import { resolveModelForPod, adaptiveResolveModelForPod, getModelDisplayName, FALLBACK_RETRYABLE_STATUSES } from './modelRouter';
import { validateArtifact } from './artifactSchemas';
import { getExpectedFiles } from './templates/websiteSprint';
import { scanFileForViolations } from '../../products/sites/truthGuard';
import {
  buildPodSystemPrompt,
  buildProjectReadme,
  buildTaskPrompt,
  buildToolDefinitions,
} from './promptBuilder';

// ============================================================================
// CONSTANTS
// ============================================================================

const BACKEND_URL = '';
const MAX_TOOL_ITERATIONS = 10;
const TIME_TRACKING_INTERVAL_MS = 10_000;

// Tool result caching — avoids redundant API calls for idempotent reads
const CACHEABLE_TOOLS = new Set(['file_read', 'file_list', 'scan_directory', 'code_search', 'web_search', 'web_fetch']);
const FILE_MUTATING_TOOLS = new Set(['file_write', 'edit_file']);
const TOOL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Per-task automatic retry configuration
const TASK_RETRY_CONFIG = { maxRetries: 3, initialDelayMs: 1000, backoffMultiplier: 2 };
const NON_RETRYABLE_TASK_ERRORS = [
  'Contract violation', 'No available pod', 'Authentication required',
  'Invalid or expired token', 'not available on your plan',
];

// ============================================================================
// TYPES
// ============================================================================

interface ExecutionState {
  tbwoId: string;
  executionAttemptId: string;
  status:
    | 'initializing'
    | 'planning'
    | 'executing'
    | 'paused'
    | 'paused_waiting_for_user'
    | 'checkpoint'
    | 'completing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  currentPhaseIndex: number;
  // Keys are POOL pod IDs (podPoolStore is the single source of truth)
  activePods: Map<string, { role: string; name: string; aiService: AIService }>;
  messageBus: MessageBus;
  artifacts: Map<string, Artifact>;
  contractId: string | null;
  startTime: number;
  pausedAt: number | null;
  totalPauseDuration: number;
  errors: Array<{ phase: string; task: string; error: string; timestamp: number }>;
  completedTaskIds: Set<string>;
  totalTokensUsed: number;
  podInboxes: Map<string, BusMessage[]>;
  pendingClarifications: Map<string, { taskId: string; podId: string; question: string; timestamp: number }>;
  pendingPauseRequest: PauseRequest | null;
  workspaceMode: boolean;
  workspaceId: string | null;
  workspaceFiles: Array<{ relativePath: string; size: number; downloadUrl: string }>;
  filesWrittenInExecution: Map<string, string>; // path → podId that wrote it (cross-task dedup)
  // Mapping from DEFINITION pod IDs (tbwo.pods) → POOL pod IDs (podPoolStore)
  // so that task.assignedPod (definition ID) can resolve to the correct active pod
  definitionToPoolPodId: Map<string, string>;
  // Tool result cache — avoids redundant API calls for idempotent reads
  toolCache: Map<string, { result: string; cachedAt: number }>;
}

/** Serializable snapshot of execution state for resumable execution (Feature 10). */
interface ExecutionStateSnapshot {
  executionAttemptId: string;
  status: ExecutionState['status'];
  currentPhaseIndex: number;
  contractId: string | null;
  startTime: number;
  pausedAt: number | null;
  totalPauseDuration: number;
  errors: ExecutionState['errors'];
  completedTaskIds: string[];
  totalTokensUsed: number;
  workspaceMode: boolean;
  workspaceId: string | null;
  filesWrittenInExecution: [string, string][];
  definitionToPoolPodId: [string, string][];
  savedAt: number;
}

interface PhaseResult {
  phaseId: string;
  success: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  artifacts: Artifact[];
  duration: number;
  errors: string[];
}

interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
  artifacts: Artifact[];
  tokensUsed: number;
  duration: number;
  error?: string;
}

// ============================================================================
// EXECUTION ENGINE
// ============================================================================

export class ExecutionEngine {
  /** Active execution states keyed by tbwoId */
  private states = new Map<string, ExecutionState>();

  /** Time tracking intervals keyed by tbwoId */
  private timeTrackers = new Map<string, ReturnType<typeof setInterval>>();

  /**
   * Compute fresh time remaining (in minutes) from the clock, not from the stored value
   * which can be up to 10s stale from the setInterval tracker.
   */
  private isTimeBudgetExpired(tbwoId: string): boolean {
    const state = this.states.get(tbwoId);
    const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
    if (!state || !tbwo) return false;
    const elapsedMs = Date.now() - state.startTime - state.totalPauseDuration;
    const elapsedMinutes = elapsedMs / 60_000;
    const totalBudget = tbwo.timeBudget.total ?? 60;
    return elapsedMinutes >= totalBudget;
  }

  /**
   * Feature 10: Save execution state checkpoint to backend for resumable execution.
   * Fire-and-forget — does not block execution.
   */
  private saveCheckpoint(state: ExecutionState): void {
    const snapshot: ExecutionStateSnapshot = {
      executionAttemptId: state.executionAttemptId,
      status: state.status,
      currentPhaseIndex: state.currentPhaseIndex,
      contractId: state.contractId,
      startTime: state.startTime,
      pausedAt: state.pausedAt,
      totalPauseDuration: state.totalPauseDuration,
      errors: state.errors,
      completedTaskIds: [...state.completedTaskIds],
      totalTokensUsed: state.totalTokensUsed,
      workspaceMode: state.workspaceMode,
      workspaceId: state.workspaceId,
      filesWrittenInExecution: [...state.filesWrittenInExecution.entries()],
      definitionToPoolPodId: [...state.definitionToPoolPodId.entries()],
      savedAt: Date.now(),
    };
    fetch(`${BACKEND_URL}/api/tbwo/${state.tbwoId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ execution_state: JSON.stringify(snapshot) }),
    }).catch(() => {});
  }

  // ==========================================================================
  // MAIN EXECUTION FLOW
  // ==========================================================================

  /**
   * Execute a TBWO from start to finish.
   *
   * 1. Initialize state, validate TBWO has an approved plan
   * 2. Create contract via contractService
   * 3. Spawn pods based on plan's podStrategy
   * 4. For each phase in order: executePhase()
   * 5. After all phases: completeExecution()
   * 6. On error: handleFailure()
   */
  async execute(tbwoId: string, options?: { resume?: boolean }): Promise<void> {
    const isResume = options?.resume === true;

    // Fetch fresh TBWO from store
    const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
    if (!tbwo) {
      throw new Error(`TBWO ${tbwoId} not found`);
    }

    // Validate that a plan exists and is approved
    if (!tbwo.plan) {
      throw new Error(`TBWO ${tbwoId} has no execution plan`);
    }
    if (tbwo.plan.requiresApproval && !tbwo.plan.approvedAt) {
      throw new Error(`TBWO ${tbwoId} plan has not been approved`);
    }

    // Idempotency guard: refuse to start if already executing
    const existingState = this.states.get(tbwoId);
    if (existingState && existingState.status === 'executing') {
      console.warn(`[ExecutionEngine] Already executing tbwoId=${tbwoId}, attempt=${existingState.executionAttemptId}`);
      return;
    }

    const executionAttemptId = tbwo.executionAttemptId || nanoid();
    console.log(`[ExecutionEngine] ${isResume ? 'RESUME' : 'execute'}: tbwoId=${tbwoId}, executionAttemptId=${executionAttemptId}`);

    // Initialize execution state
    const state: ExecutionState = {
      tbwoId,
      executionAttemptId,
      status: 'initializing',
      currentPhaseIndex: 0,
      activePods: new Map(),
      messageBus: new MessageBus(),
      artifacts: new Map(),
      contractId: null,
      startTime: Date.now(),
      pausedAt: null,
      totalPauseDuration: 0,
      errors: [],
      completedTaskIds: new Set(),
      totalTokensUsed: 0,
      podInboxes: new Map(),
      pendingClarifications: new Map(),
      pendingPauseRequest: null,
      workspaceMode: false,
      workspaceId: null,
      workspaceFiles: [],
      filesWrittenInExecution: new Map(),
      definitionToPoolPodId: new Map(),
      toolCache: new Map(),
    };
    this.states.set(tbwoId, state);

    // On resume: pre-populate completedTaskIds from persisted task statuses
    let startPhaseIndex = 0;
    if (isResume && tbwo.plan) {
      const sortedPhases = [...tbwo.plan.phases].sort((a, b) => a.order - b.order);
      for (const phase of sortedPhases) {
        for (const task of phase.tasks) {
          if (task.status === 'complete') {
            state.completedTaskIds.add(task.id);
          }
        }
      }
      // Skip phases where ALL tasks are already complete
      for (let i = 0; i < sortedPhases.length; i++) {
        const phase = sortedPhases[i]!;
        const allComplete = phase.tasks.length > 0 && phase.tasks.every(t => t.status === 'complete');
        if (allComplete) {
          startPhaseIndex = i + 1;
        } else {
          break;
        }
      }
      // Reuse existing contract if available
      if (tbwo.contractId) {
        state.contractId = tbwo.contractId;
      }
      console.log(`[ExecutionEngine] Resume: ${state.completedTaskIds.size} tasks already complete, starting from phase ${startPhaseIndex}`);

      // Feature 10: Enhanced restore from persisted execution state checkpoint
      try {
        const checkpointResp = await fetch(`${BACKEND_URL}/api/tbwo/${tbwoId}`, {
          headers: this.getAuthHeaders(),
        });
        if (checkpointResp.ok) {
          const checkpointData = await checkpointResp.json();
          const rawSnapshot = checkpointData?.tbwo?.execution_state || checkpointData?.execution_state;
          if (rawSnapshot) {
            const snapshot: ExecutionStateSnapshot = typeof rawSnapshot === 'string' ? JSON.parse(rawSnapshot) : rawSnapshot;
            if (snapshot && snapshot.executionAttemptId) {
              state.executionAttemptId = snapshot.executionAttemptId;
              state.currentPhaseIndex = snapshot.currentPhaseIndex;
              state.contractId = snapshot.contractId || state.contractId;
              state.startTime = snapshot.startTime;
              state.totalPauseDuration = snapshot.totalPauseDuration;
              state.errors = snapshot.errors || [];
              // Merge completedTaskIds (task-status-based + snapshot)
              for (const id of snapshot.completedTaskIds) state.completedTaskIds.add(id);
              state.totalTokensUsed = snapshot.totalTokensUsed;
              state.workspaceMode = snapshot.workspaceMode;
              state.workspaceId = snapshot.workspaceId;
              state.filesWrittenInExecution = new Map(snapshot.filesWrittenInExecution);
              state.definitionToPoolPodId = new Map(snapshot.definitionToPoolPodId);
              startPhaseIndex = snapshot.currentPhaseIndex;
              console.log(`[ExecutionEngine] Restored execution state from checkpoint (saved ${new Date(snapshot.savedAt).toISOString()})`);
            }
          }
        }
      } catch (e) {
        console.warn('[ExecutionEngine] Failed to restore execution state snapshot:', e);
      }
    }

    // Initialize server-side workspace for isolated file I/O
    try {
      const initResp = await fetch(`${BACKEND_URL}/api/tbwo/${tbwoId}/workspace/init`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
      });
      if (initResp.ok) {
        const initData = await initResp.json();
        state.workspaceMode = true;
        state.workspaceId = initData.workspaceId;
        console.log(`[ExecutionEngine] Workspace initialized: ${initData.workspaceId}`);
      } else {
        console.warn('[ExecutionEngine] Workspace init failed, falling back to direct file I/O');
      }
    } catch {
      console.warn('[ExecutionEngine] Workspace init unavailable, using direct file I/O');
    }

    try {
      // Create contract (skip on resume if we already have one)
      if (!state.contractId) {
        const contract = contractService.createContract({
          tbwoId,
          objective: tbwo.objective,
          timeBudgetMinutes: tbwo.timeBudget.total,
          scope: {
            allowedTools: tbwo.scope.allowedTools.length > 0 ? tbwo.scope.allowedTools : ['*'],
            forbiddenTools: tbwo.scope.forbiddenTools,
            allowedFiles: tbwo.scope.allowedPaths.length > 0 ? tbwo.scope.allowedPaths : ['*'],
            forbiddenFiles: tbwo.scope.forbiddenPaths,
          },
        });
        contractService.activateContract(contract.id);
        state.contractId = contract.id;
      }

      // ================================================================
      // PRE-EXECUTION CLARIFICATION — ask user about required unknowns
      // before spawning any pods
      // ================================================================
      if (!isResume) {
        await this.runPreExecutionClarification(state, tbwo);
      }

      // Update TBWO status
      useTBWOStore.getState().updateTBWO(tbwoId, {
        contractId: state.contractId,
        status: TBWOStatus.EXECUTING,
        startedAt: isResume ? (tbwo.startedAt || state.startTime) : state.startTime,
      });

      // Create background job for notification tracking
      import('../../store/backgroundStore').then(({ useBackgroundStore }) => {
        const store = useBackgroundStore.getState();
        const jobId = store.createJob(
          'tbwo',
          `TBWO: ${tbwo.objective.slice(0, 50)}`,
          `Executing ${tbwo.type} with ${tbwo.plan!.phases.length} phases`,
          { tbwoId }
        );
        // Store in TBWO metadata for later completion
        useTBWOStore.getState().updateTBWO(tbwoId, {
          metadata: { ...(useTBWOStore.getState().getTBWOById(tbwoId)?.metadata || {}), backgroundJobId: jobId },
        });
      }).catch(() => {});

      // Spawn pods based on plan strategy
      state.status = 'executing';
      await this.spawnPods(state, tbwo);

      // Post execution start/resume to TBWO chat
      const podNames = Array.from(state.activePods.values()).map((p) => p.name).join(', ');
      if (isResume) {
        this.postToChat(tbwoId, [
          { type: 'text' as const, text: `**Execution resumed** for: ${tbwo.objective}\n\n**Pods activated:** ${podNames}\n**Completed tasks:** ${state.completedTaskIds.size}\n**Starting from phase:** ${startPhaseIndex + 1}/${tbwo.plan!.phases.length}` },
        ]);
      } else {
        this.postToChat(tbwoId, [
          { type: 'text' as const, text: `**Execution started** for: ${tbwo.objective}\n\n**Pods activated:** ${podNames}\n**Time budget:** ${tbwo.timeBudget.total} minutes\n**Phases:** ${tbwo.plan!.phases.length}` },
        ]);
      }

      // Start time tracking
      this.startTimeTracking(tbwoId);

      // Generate README.md as the first artifact (north star document for all pods)
      if (!isResume && tbwo.type === 'website_sprint') {
        try {
          const readmeContent = buildProjectReadme(state, tbwo);
          // Write README to workspace via API
          if (state.workspaceId) {
            await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/write`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: 'README.md', content: readmeContent }),
            }).catch(() => {});
          }
          const artifactId = nanoid();
          const readmeArtifact = {
            id: artifactId,
            path: 'README.md',
            content: readmeContent,
            type: 'markdown' as const,
            createdAt: Date.now(),
            createdBy: 'system',
          };
          state.artifacts.set(artifactId, readmeArtifact as any);
          useTBWOStore.getState().addArtifact(tbwoId, readmeArtifact as any);
          this.postToChat(tbwoId, [
            { type: 'text' as const, text: '**README.md generated** — project specification, file manifest, and design system. All pods can `file_read README.md` for reference.' },
          ]);
        } catch (e) {
          console.warn('[ExecutionEngine] Failed to generate README.md:', e);
        }
      }

      // Generate motion-tokens-reference.css artifact for website sprints with animations
      if (!isResume && tbwo.type === 'website_sprint') {
        try {
          const sprintConfig = tbwo.metadata?.sprintConfig as Record<string, unknown> | undefined;
          if (sprintConfig?.includeAnimations) {
            const intensity = (sprintConfig.motionIntensity as string) || 'standard';
            const { generateMotionTokens } = await import('../../products/sites/motion/motionTokens');
            const tokensCss = generateMotionTokens(intensity as any);
            if (tokensCss) {
              const artifactId = nanoid();
              const tokensArtifact = {
                id: artifactId,
                path: 'motion-tokens-reference.css',
                content: tokensCss,
                type: 'css' as const,
                createdAt: Date.now(),
                createdBy: 'system',
              };
              state.artifacts.set(artifactId, tokensArtifact as any);
              useTBWOStore.getState().addArtifact(tbwoId, tokensArtifact as any);
              this.postToChat(tbwoId, [
                { type: 'text' as const, text: `**motion-tokens-reference.css generated** — CSS motion tokens for "${intensity}" intensity. Pods can reference these design tokens.` },
              ]);
            }
          }
        } catch (e) {
          console.warn('[ExecutionEngine] Failed to generate motion tokens reference:', e);
        }
      }

      // Execute phases in order (start from startPhaseIndex on resume)
      const plan = tbwo.plan;
      const sortedPhases = [...plan.phases].sort((a, b) => a.order - b.order);

      for (let i = startPhaseIndex; i < sortedPhases.length; i++) {
        // Check if cancelled or failed
        const currentState = this.states.get(tbwoId);
        if (!currentState || currentState.status === 'cancelled' || currentState.status === 'failed') {
          break;
        }

        // Enforce time budget - compute fresh from clock (not stale store value)
        if (this.isTimeBudgetExpired(tbwoId)) {
          const currentTBWO = useTBWOStore.getState().getTBWOById(tbwoId);
          console.warn(`[ExecutionEngine] Time budget expired for TBWO ${tbwoId}. Stopping execution.`);
          this.postToChat(tbwoId, [
            { type: 'text' as const, text: `**Time budget expired** (${currentTBWO?.timeBudget.total ?? 60} minutes). Wrapping up execution.` },
          ]);
          break;
        }

        // Wait while paused
        await this.waitWhilePaused(tbwoId);

        state.currentPhaseIndex = i;
        const phase = sortedPhases[i]!;

        // Update store with current phase
        useTBWOStore.getState().updateTBWO(tbwoId, {
          currentPhase: phase.name,
        });

        tbwoUpdateService.phaseStarted(tbwoId, phase.name, i);
        this.postToChat(tbwoId, [
          { type: 'text' as const, text: `**Phase ${i + 1}/${sortedPhases.length}: ${phase.name}**\n${phase.description || ''}\nTasks: ${phase.tasks.length}` },
        ]);

        const phaseResult = await this.executePhase(state, phase);

        tbwoUpdateService.phaseCompleted(tbwoId, phase.name, {
          success: phaseResult.success,
          duration: phaseResult.duration,
        });

        // Post phase completion to chat
        this.postToChat(tbwoId, [
          { type: 'text' as const, text: `Phase "${phase.name}" ${phaseResult.success ? 'completed' : 'finished with errors'}. Tasks: ${phaseResult.tasksCompleted} completed, ${phaseResult.tasksFailed} failed. Artifacts: ${phaseResult.artifacts.length}` },
        ]);

        // If the phase entirely failed (all tasks failed), circuit-break dependent phases
        if (!phaseResult.success && phaseResult.tasksCompleted === 0) {
          console.error(`[ExecutionEngine] Phase "${phase.name}" completely failed — circuit breaker triggered`);
          state.errors.push({
            phase: phase.name,
            task: '*',
            error: `All tasks in phase "${phase.name}" failed`,
            timestamp: Date.now(),
          });

          // Check if any remaining phases depend on this failed phase
          const remainingPhases = sortedPhases.slice(i + 1);
          const failedPhaseId = phase.id;
          const dependentPhases = remainingPhases.filter(
            p => p.dependsOn?.includes(failedPhaseId) || p.order > phase.order
          );

          if (dependentPhases.length > 0) {
            const skippedNames = dependentPhases.map(p => p.name).join(', ');
            const errorDetails = phaseResult.errors.slice(0, 3).join('; ') || 'Unknown error';
            this.postToChat(tbwoId, [
              { type: 'text' as const, text: `**Circuit breaker triggered:** Phase "${phase.name}" completely failed.\n\n**Error:** ${errorDetails}\n\n**Skipping dependent phases:** ${skippedNames}\n\nUse the **Retry Phase** button to re-run the failed phase.` },
            ]);

            // Mark skipped phases
            for (const dep of dependentPhases) {
              useTBWOStore.getState().updateTBWO(tbwoId, {
                plan: {
                  ...useTBWOStore.getState().getTBWOById(tbwoId)!.plan!,
                  phases: useTBWOStore.getState().getTBWOById(tbwoId)!.plan!.phases.map(p =>
                    p.id === dep.id ? { ...p, status: 'skipped' as const } : p
                  ),
                },
              });
            }
            break; // Stop executing further phases
          }
        }

        // Calculate overall progress
        const progressPercent = Math.round(((i + 1) / sortedPhases.length) * 100);
        useTBWOStore.getState().updateProgress(tbwoId, progressPercent);
        tbwoUpdateService.progressUpdate(
          tbwoId,
          progressPercent,
          `Completed phase ${i + 1}/${sortedPhases.length}: ${phase.name}`
        );
      }

      // Complete execution
      const finalState = this.states.get(tbwoId);
      if (finalState && finalState.status !== 'cancelled' && finalState.status !== 'failed') {
        await this.completeExecution(finalState);
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ExecutionEngine] Execution failed for TBWO ${tbwoId}:`, errMsg);
      tbwoUpdateService.executionError(tbwoId, errMsg);
      await this.handleFailure(state, errMsg);
    }
  }

  // ==========================================================================
  // PAUSE / RESUME / CANCEL
  // ==========================================================================

  /**
   * Pause execution. Records the pause timestamp.
   */
  async pause(tbwoId: string): Promise<void> {
    const state = this.states.get(tbwoId);
    if (!state || state.status !== 'executing') return;

    state.status = 'paused';
    state.pausedAt = Date.now();

    useTBWOStore.getState().updateTBWO(tbwoId, {
      status: TBWOStatus.PAUSED,
    });
  }

  /**
   * Resume execution. Calculates cumulative pause duration and continues.
   */
  async resume(tbwoId: string): Promise<void> {
    const state = this.states.get(tbwoId);
    if (!state || (state.status !== 'paused' && state.status !== 'paused_waiting_for_user')) return;

    if (state.pausedAt) {
      state.totalPauseDuration += Date.now() - state.pausedAt;
      state.pausedAt = null;
    }

    state.status = 'executing';

    useTBWOStore.getState().updateTBWO(tbwoId, {
      status: TBWOStatus.EXECUTING,
    });
  }

  /**
   * Cancel execution. Terminates all pods and cleans up.
   */
  async cancel(tbwoId: string): Promise<void> {
    const state = this.states.get(tbwoId);
    if (!state) return;

    state.status = 'cancelled';

    // Stop time tracking
    this.stopTimeTracking(tbwoId);

    // Terminate all pods
    await this.terminatePods(state);

    // Fulfill contract as cancelled
    if (state.contractId) {
      contractService.fulfillContract(state.contractId);
    }

    useTBWOStore.getState().updateTBWO(tbwoId, {
      status: TBWOStatus.CANCELLED,
      completedAt: Date.now(),
    });

    tbwoUpdateService.executionComplete(tbwoId, false);

    // Immediate workspace cleanup on cancel (user-initiated, no delay needed)
    if (state.workspaceMode && state.workspaceId) {
      fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace`, {
        method: 'DELETE',
        headers: this.getAuthHeaders(),
      }).catch(() => {});
    }

    // Bonus: Prune stale pods from pool on cancel
    usePodPoolStore.getState().pruneStale();

    // Clean up state
    this.states.delete(tbwoId);
  }

  /**
   * Retry a failed phase. Re-runs all failed/pending tasks with fresh pod AIService instances.
   */
  async retryPhase(tbwoId: string, phaseId: string): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
    if (!tbwo || !tbwo.plan) return;

    const phase = tbwo.plan.phases.find(p => p.id === phaseId);
    if (!phase) return;

    // Re-initialize state if not present
    let state = this.states.get(tbwoId);
    if (!state) {
      state = {
        tbwoId,
        executionAttemptId: nanoid(),
        status: 'executing',
        currentPhaseIndex: 0,
        activePods: new Map(),
        messageBus: new MessageBus(),
        artifacts: new Map(),
        contractId: tbwo.contractId || null,
        startTime: Date.now(),
        pausedAt: null,
        totalPauseDuration: 0,
        errors: [],
        completedTaskIds: new Set(),
        totalTokensUsed: 0,
        podInboxes: new Map(),
        pendingClarifications: new Map(),
        pendingPauseRequest: null,
        workspaceMode: false,
        workspaceId: null,
        workspaceFiles: [],
        filesWrittenInExecution: new Map(),
        definitionToPoolPodId: new Map(),
        toolCache: new Map(),
      };
      this.states.set(tbwoId, state);

      // Re-populate artifacts from tbwo
      for (const art of tbwo.artifacts || []) {
        state.artifacts.set(art.id, art);
      }
    }

    // Spawn pods if needed
    if (state.activePods.size === 0) {
      await this.spawnPods(state, tbwo);
    }

    useTBWOStore.getState().updateTBWO(tbwoId, { status: TBWOStatus.EXECUTING });
    state.status = 'executing';

    this.postToChat(tbwoId, [
      { type: 'text' as const, text: `**Retrying phase:** ${phase.name}\nResetting failed tasks and re-executing...` },
    ]);

    // Reset failed/skipped tasks to pending
    const updatedPhase = {
      ...phase,
      status: 'in_progress' as const,
      tasks: phase.tasks.map(t =>
        t.status === 'failed' || t.status === 'pending'
          ? { ...t, status: 'pending' as const }
          : t
      ),
    };

    const phaseResult = await this.executePhase(state, updatedPhase);

    this.postToChat(tbwoId, [
      { type: 'text' as const, text: `Phase retry "${phase.name}" ${phaseResult.success ? 'succeeded' : 'failed'}. Tasks: ${phaseResult.tasksCompleted} completed, ${phaseResult.tasksFailed} failed.` },
    ]);

    // If retry succeeded, unblock skipped phases and continue
    if (phaseResult.success) {
      const plan = tbwo.plan;
      const sortedPhases = [...plan.phases].sort((a, b) => a.order - b.order);
      const phaseIndex = sortedPhases.findIndex(p => p.id === phaseId);
      const skippedPhases = sortedPhases.slice(phaseIndex + 1).filter(p => p.status === 'skipped');

      for (const skipped of skippedPhases) {
        const skipResult = await this.executePhase(state, { ...skipped, status: 'pending' });
        this.postToChat(tbwoId, [
          { type: 'text' as const, text: `Phase "${skipped.name}" ${skipResult.success ? 'completed' : 'failed'}. Tasks: ${skipResult.tasksCompleted} completed, ${skipResult.tasksFailed} failed.` },
        ]);
        if (!skipResult.success && skipResult.tasksCompleted === 0) break;
      }

      await this.completeExecution(state);
    }
  }

  // ==========================================================================
  // PHASE EXECUTION
  // ==========================================================================

  /**
   * Execute a single phase:
   * 1. Update store with current phase status
   * 2. Build task dependency graph for this phase
   * 3. Execute tasks in dependency order (parallel where possible)
   * 4. Run quality gate after phase
   * 5. Handle checkpoint if configured
   * 6. Return PhaseResult
   */
  private async executePhase(state: ExecutionState, phase: Phase): Promise<PhaseResult> {
    const phaseStart = Date.now();
    const phaseErrors: string[] = [];
    const phaseArtifacts: Artifact[] = [];
    let tasksCompleted = 0;
    let tasksFailed = 0;

    // Mark phase as in progress
    useTBWOStore.getState().updatePhaseProgress(phase.id, 0);

    // If the phase has no tasks, mark it complete immediately
    if (!phase.tasks || phase.tasks.length === 0) {
      useTBWOStore.getState().updatePhaseProgress(phase.id, 100);
      return {
        phaseId: phase.id,
        success: true,
        tasksCompleted: 0,
        tasksFailed: 0,
        artifacts: [],
        duration: Date.now() - phaseStart,
        errors: [],
      };
    }

    // Build dependency groups: tasks with no unresolved deps can run in parallel
    const taskGroups = this.buildTaskGroups(phase.tasks, state.completedTaskIds);

    // Execute each group sequentially; within a group, tasks run in parallel
    for (const group of taskGroups) {
      // Check for cancellation/pause between groups
      if (state.status === 'cancelled' || state.status === 'failed') {
        break;
      }
      // Hard-stop: if any pod triggered pause_waiting_for_user, ALL pods must wait
      if (state.status === 'paused_waiting_for_user' || state.status === 'paused') {
        await this.waitWhilePaused(state.tbwoId);
        // state.status is mutated by waitWhilePaused; re-check after resume
        if ((state.status as string) === 'cancelled' || (state.status as string) === 'failed') break;
      }

      // Enforce time budget at task-group level too (fresh from clock)
      if (this.isTimeBudgetExpired(state.tbwoId)) {
        break;
      }

      // Wait while paused
      await this.waitWhilePaused(state.tbwoId);

      // Pre-assign tasks to pods round-robin to avoid race conditions.
      // Each pod runs its assigned tasks sequentially; all pods run in parallel.
      const podIds = Array.from(state.activePods.keys());
      const podTaskMap = new Map<string, Task[]>();

      // Initialize empty task lists for all pods
      for (const pid of podIds) {
        podTaskMap.set(pid, []);
      }

      // First pass: tasks with explicit assignedPod
      const unassigned: Task[] = [];
      for (const task of group) {
        if (task.assignedPod && state.activePods.has(task.assignedPod)) {
          podTaskMap.get(task.assignedPod)!.push(task);
        } else {
          unassigned.push(task);
        }
      }

      // Second pass: score-based role matching before round-robin fallback
      const ROLE_KEYWORDS: Record<string, string[]> = {
        frontend: ['html', 'css', 'layout', 'page', 'component', 'responsive', 'ui', 'header', 'footer', 'nav', 'hero', 'section', 'grid', 'flex'],
        design: ['design', 'style', 'color', 'typography', 'brand', 'visual', 'theme', 'palette', 'token', 'aesthetic'],
        copy: ['copy', 'text', 'content', 'headline', 'write', 'blog', 'seo', 'meta', 'description', 'tagline'],
        qa: ['test', 'qa', 'quality', 'review', 'validate', 'check', 'accessibility', 'audit', 'verify', 'lint'],
        motion: ['animation', '3d', 'three', 'scene', 'motion', 'transition', 'render', 'canvas', 'webgl', 'particle'],
        delivery: ['deploy', 'build', 'bundle', 'optimize', 'performance', 'package', 'minify', 'compress'],
      };

      // Build pod-role lookup
      const podRoleMap = new Map<string, string>();
      for (const pid of podIds) {
        const p = state.activePods.get(pid);
        if (p) podRoleMap.set(pid, p.role.toLowerCase());
      }

      let rrIndex = 0;
      for (const task of unassigned) {
        const taskText = `${task.name} ${task.description || ''}`.toLowerCase();
        let bestPodId: string | null = null;
        let bestScore = 0;

        for (const pid of podIds) {
          const role = podRoleMap.get(pid) || '';
          const keywords = ROLE_KEYWORDS[role];
          if (!keywords) continue;
          const score = keywords.reduce((s, kw) => s + (taskText.includes(kw) ? 1 : 0), 0);
          if (score > bestScore) {
            bestScore = score;
            bestPodId = pid;
          }
        }

        if (bestPodId && bestScore > 0) {
          podTaskMap.get(bestPodId)!.push(task);
        } else {
          // Fallback: round-robin
          const targetPodId = podIds[rrIndex % podIds.length]!;
          podTaskMap.get(targetPodId)!.push(task);
          rrIndex++;
        }
      }

      // Execute: each pod runs its tasks sequentially, all pods in parallel
      const podGroupPromises: Promise<TaskResult[]>[] = [];
      for (const [, tasks] of podTaskMap) {
        if (tasks.length === 0) continue;
        podGroupPromises.push(
          (async () => {
            const results: TaskResult[] = [];
            for (const t of tasks) {
              // Check cancel/pause between sequential tasks — includes paused_waiting_for_user
              if (state.status === 'cancelled' || state.status === 'failed') break;
              if (state.status === 'paused' || state.status === 'paused_waiting_for_user') {
                await this.waitWhilePaused(state.tbwoId);
                // state.status is mutated by waitWhilePaused; re-check after resume
                if ((state.status as string) === 'cancelled' || (state.status as string) === 'failed') break;
              }
              results.push(await this.executeTaskWithRetry(state, t));
              // Feature 10: Save checkpoint after each task for resumable execution
              this.saveCheckpoint(state);
            }
            return results;
          })()
        );
      }

      const podGroupResults = await Promise.allSettled(podGroupPromises);

      // Flatten results while preserving task order
      const flatResults: Array<{ task: Task; result: PromiseSettledResult<TaskResult> }> = [];
      let taskIdx = 0;
      for (const pgr of podGroupResults) {
        if (pgr.status === 'fulfilled') {
          for (const tr of pgr.value) {
            const matchedTask = group.find(t => t.id === tr.taskId) || group[taskIdx];
            flatResults.push({ task: matchedTask!, result: { status: 'fulfilled', value: tr } });
          }
        } else {
          // Entire pod group failed
          flatResults.push({ task: group[taskIdx] || group[0]!, result: { status: 'rejected', reason: pgr.reason } });
        }
        taskIdx++;
      }

      const results = flatResults;

      // Process results
      for (let i = 0; i < results.length; i++) {
        const { task, result } = results[i]!;

        if (result.status === 'fulfilled' && result.value.success) {
          tasksCompleted++;
          state.completedTaskIds.add(task.id);
          phaseArtifacts.push(...result.value.artifacts);
          state.totalTokensUsed = (state.totalTokensUsed || 0) + result.value.tokensUsed;

          // Record artifacts in state
          for (const artifact of result.value.artifacts) {
            state.artifacts.set(artifact.id, artifact);
          }
        } else {
          tasksFailed++;
          const errorMsg =
            result.status === 'rejected'
              ? String(result.reason)
              : (result.value as TaskResult).error || 'Unknown task failure';

          phaseErrors.push(`Task "${task.name}": ${errorMsg}`);
          state.errors.push({
            phase: phase.name,
            task: task.name,
            error: errorMsg,
            timestamp: Date.now(),
          });
        }
      }

      // Update phase progress
      const totalTasks = phase.tasks.length;
      const completedInPhase = tasksCompleted + tasksFailed;
      const phaseProgress = Math.round((completedInPhase / totalTasks) * 100);
      useTBWOStore.getState().updatePhaseProgress(phase.id, phaseProgress);
    }

    // Run quality gate (basic check: did more than half the tasks succeed?)
    const qualityPassed = tasksCompleted > tasksFailed;

    // Handle checkpoint if the phase has one configured
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    const phaseCheckpoint = tbwo?.checkpoints.find(
      (cp) =>
        cp.triggerCondition === CheckpointTrigger.PHASE_COMPLETE &&
        cp.status === 'pending'
    );

    if (phaseCheckpoint) {
      const decision = await this.handleCheckpoint(state, phase, phaseCheckpoint);
      if (decision && decision.action === 'cancel') {
        state.status = 'cancelled';
      } else if (decision && decision.action === 'pause') {
        state.status = 'paused';
        state.pausedAt = Date.now();
      }
    }

    const phaseDuration = Date.now() - phaseStart;

    return {
      phaseId: phase.id,
      success: qualityPassed,
      tasksCompleted,
      tasksFailed,
      artifacts: phaseArtifacts,
      duration: phaseDuration,
      errors: phaseErrors,
    };
  }

  // ==========================================================================
  // TOOL RESULT CACHING
  // ==========================================================================

  private getToolCacheKey(toolName: string, input: Record<string, unknown>): string {
    const sortedInput = JSON.stringify(input, Object.keys(input).sort());
    return `${toolName}:${sortedInput}`;
  }

  private getCachedToolResult(state: ExecutionState, toolName: string, input: Record<string, unknown>): string | undefined {
    if (!CACHEABLE_TOOLS.has(toolName)) return undefined;
    const key = this.getToolCacheKey(toolName, input);
    const entry = state.toolCache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > TOOL_CACHE_TTL_MS) {
      state.toolCache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  private cacheToolResult(state: ExecutionState, toolName: string, input: Record<string, unknown>, result: string): void {
    if (!CACHEABLE_TOOLS.has(toolName)) return;
    if (result.startsWith('Error')) return; // Don't cache errors
    const key = this.getToolCacheKey(toolName, input);
    state.toolCache.set(key, { result, cachedAt: Date.now() });
  }

  private invalidateFileCache(state: ExecutionState, filePath: string): void {
    const normPath = filePath.replace(/\\/g, '/').toLowerCase();
    for (const [key] of state.toolCache) {
      // Invalidate any cached file_read/file_list/scan_directory that references this path
      if (key.includes(normPath) || key.includes(filePath)) {
        state.toolCache.delete(key);
      }
    }
  }

  // ==========================================================================
  // PER-TASK AUTOMATIC RETRY
  // ==========================================================================

  private isRetryableTaskError(error: string): boolean {
    for (const pattern of NON_RETRYABLE_TASK_ERRORS) {
      if (error.includes(pattern)) return false;
    }
    const retryablePatterns = ['Server error 5', 'fetch failed', 'timeout', 'ECONNREFUSED', 'overloaded'];
    return retryablePatterns.some(p => error.toLowerCase().includes(p.toLowerCase()));
  }

  private async executeTaskWithRetry(state: ExecutionState, task: Task): Promise<TaskResult> {
    let lastResult: TaskResult | null = null;
    for (let attempt = 0; attempt <= TASK_RETRY_CONFIG.maxRetries; attempt++) {
      const result = await this.executeTask(state, task);
      if (result.success) return result;
      lastResult = result;
      if (!result.error || !this.isRetryableTaskError(result.error)) return result;
      if (attempt === TASK_RETRY_CONFIG.maxRetries) break;
      if (state.status === 'cancelled' || state.status === 'failed') return result;
      if (this.isTimeBudgetExpired(state.tbwoId)) return result;
      const delay = TASK_RETRY_CONFIG.initialDelayMs * Math.pow(TASK_RETRY_CONFIG.backoffMultiplier, attempt);
      const podId = this.getBestPodForTask(state, task);
      if (podId) this.appendPodLog(podId, `Task "${task.name}" failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${result.error}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return lastResult!;
  }

  // ==========================================================================
  // MODEL FALLBACK HELPER
  // ==========================================================================

  private isRetryableModelError(error: Error): boolean {
    const msg = error.message || '';
    const statusMatch = msg.match(/(?:Server error|status)\s*(\d{3})/i);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]!, 10);
      return FALLBACK_RETRYABLE_STATUSES.has(status);
    }
    // Also retry on generic network/overload errors
    return /overloaded|rate.?limit|timeout|fetch failed|ECONNREFUSED/i.test(msg);
  }

  // ==========================================================================
  // TASK EXECUTION
  // ==========================================================================

  /**
   * Execute a single task:
   * 1. Find assigned pod (or pick best available)
   * 2. Validate action against contract
   * 3. Build task prompt with context
   * 4. Send to pod's AIService
   * 5. Handle tool calls in loop (max MAX_TOOL_ITERATIONS iterations)
   * 6. Extract artifacts from response
   * 7. Update store with task completion
   * 8. Return TaskResult
   */
  private async executeTask(state: ExecutionState, task: Task): Promise<TaskResult> {
    const taskStart = Date.now();
    let tokensUsed = 0;
    const artifacts: Artifact[] = [];

    // Find the best pod for this task
    const podId = this.getBestPodForTask(state, task);
    if (!podId) {
      return {
        taskId: task.id,
        success: false,
        output: '',
        artifacts: [],
        tokensUsed: 0,
        duration: Date.now() - taskStart,
        error: 'No available pod for task',
      };
    }

    const podEntry = state.activePods.get(podId);
    if (!podEntry) {
      return {
        taskId: task.id,
        success: false,
        output: '',
        artifacts: [],
        tokensUsed: 0,
        duration: Date.now() - taskStart,
        error: `Pod ${podId} not found in active pods`,
      };
    }

    const { role, name: podName, aiService } = podEntry;

    // Construct a lightweight AgentPod view for methods that expect that type.
    // Data comes from pool runtime (single source of truth) + plan definitions.
    const poolPodSnapshot = usePodPoolStore.getState().pool.get(podId);
    const runtime = poolPodSnapshot?.runtime;
    const pod: AgentPod = {
      id: podId,
      role: role as any,
      name: podName,
      status: (runtime?.podStatus || PodStatus.WORKING) as any,
      health: runtime?.health as any || { status: 'healthy', lastHeartbeat: Date.now(), errorCount: 0, consecutiveFailures: 0, warnings: [] },
      modelConfig: runtime?.modelConfig || { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      toolWhitelist: runtime?.toolWhitelist || [],
      memoryScope: [],
      taskQueue: [],
      completedTasks: (runtime?.completedTasks || []) as any[],
      outputs: [],
      resourceUsage: runtime?.resourceUsage || { cpuPercent: 0, memoryMB: 0, tokensUsed: 0, apiCalls: 0, executionTime: 0 },
      messageLog: (runtime?.messageLog || []) as any[],
      createdAt: poolPodSnapshot?.createdAt || Date.now(),
      tbwoId: state.tbwoId,
    };

    // Mark pod as working and log task start (runtime state in podPoolStore)
    usePodPoolStore.getState().updatePodRuntime(podId, {
      podStatus: PodStatus.WORKING,
      currentTask: { id: task.id, name: task.name, startedAt: Date.now() },
    });
    this.appendPodLog(podId, `Starting task: ${task.name}`);

    // Notify other pods via message bus
    state.messageBus.publish({
      from: podId,
      to: '*',
      type: 'status_update',
      payload: { task: task.name, status: 'started' },
      priority: 'normal',
    });

    tbwoUpdateService.taskStarted(state.tbwoId, task.name, podId);

    // Pod label for streaming messages
    const podLabel = podName;

    try {
      // Validate against contract before executing
      if (state.contractId) {
        const validation = contractService.validateAction(state.contractId, {
          operation: 'execute_code',
        });
        if (!validation.allowed) {
          const violationMsg = validation.violations.map((v) => v.description).join('; ');
          throw new Error(`Contract violation: ${violationMsg}`);
        }
      }

      // CRITICAL: Clear pod history before each task to prevent token overflow.
      // Each task gets full context via buildTaskPrompt() — carrying over prior
      // tool calls would push prompts past the 200K token limit.
      aiService.clearHistory();

      // Build the task prompt (async for dynamic prompt enrichment)
      const taskPrompt = await buildTaskPrompt(state, task, pod);

      // Build tool definitions based on the pod's whitelist
      const tools = buildToolDefinitions(pod.toolWhitelist);

      // Create a streaming message in the TBWO chat for live output
      const streamingMsgId = this.createStreamingMessage(state.tbwoId, podLabel);
      let streamedText = '';

      // Stream the initial AI response (live text + tool calls) with model fallback
      let pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      const route = await adaptiveResolveModelForPod(pod.role as PodRole, task.name);
      const modelsToTry = [
        { provider: route.provider, model: route.model },
        ...(route.fallbackChain || []),
      ];

      let modelUsed = route.model; // Track which model actually succeeded
      let lastStreamError: Error | null = null;
      for (const mc of modelsToTry) {
        aiService.updateConfig({ provider: mc.provider, model: mc.model });
        try {
          await new Promise<void>((resolve, reject) => {
            aiService.streamMessage(taskPrompt, {
              onText: (chunk: string) => {
                streamedText += chunk;
                if (streamingMsgId) {
                  this.updateStreamingMessage(streamingMsgId, `**${podLabel}** working on *${task.name}*:\n\n${streamedText}`);
                }
              },
              onToolUse: (tool: { id: string; name: string; input: unknown }) => {
                pendingToolCalls.push({ id: tool.id, name: tool.name, input: tool.input as Record<string, unknown> });
              },
              onComplete: (response) => {
                tokensUsed += (response.usage?.inputTokens || 0) + (response.usage?.outputTokens || 0);
                this.appendPodLog(podId, `AI responded (${(response.usage?.inputTokens || 0) + (response.usage?.outputTokens || 0)} tokens)`);
                resolve();
              },
              onError: (error: Error) => {
                reject(error);
              },
            }, tools).catch(reject);
          });
          lastStreamError = null;
          modelUsed = mc.model;
          break; // Success — exit fallback loop
        } catch (err: unknown) {
          lastStreamError = err instanceof Error ? err : new Error(String(err));
          if (!this.isRetryableModelError(lastStreamError)) break;
          this.appendPodLog(podId, `Model ${mc.model} failed, trying fallback...`);
          aiService.clearHistory();
          // Re-clear streamed text for retry with fresh model
          streamedText = '';
          pendingToolCalls = [];
        }
      }
      if (lastStreamError) throw lastStreamError;

      // Track tool activities for structured rendering in chat
      const toolActivities: Array<{ name: string; status: string; duration?: number; details?: string }> = [];

      // Handle tool calls in a loop
      let iterations = 0;
      const filesWrittenInTask = new Set<string>(); // Track files written to prevent infinite rewrites

      while (pendingToolCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Check for pause/cancel inside tool loop (not just between phases)
        if (state.status === 'paused' || state.status === 'paused_waiting_for_user') {
          this.appendPodLog(podId, 'Execution paused — waiting...');
          await this.waitWhilePaused(state.tbwoId);
        }
        if (state.status === 'cancelled' || state.status === 'failed') {
          this.appendPodLog(podId, 'Execution cancelled — stopping tool loop');
          break;
        }

        // Check time budget inside tool loop (fresh from clock)
        if (this.isTimeBudgetExpired(state.tbwoId)) {
          this.appendPodLog(podId, 'Time budget expired — stopping tool loop');
          break;
        }

        // Execute each tool call
        const currentToolCalls = [...pendingToolCalls];
        pendingToolCalls = [];
        const toolResults: Array<{ toolUseId: string; result: string }> = [];

        for (const toolCall of currentToolCalls) {
          this.appendPodLog(podId, `Tool call: ${toolCall.name}(${JSON.stringify(toolCall.input).substring(0, 100)})`);

          // Validate tool call against contract
          if (state.contractId) {
            const toolValidation = contractService.validateAction(state.contractId, {
              toolName: toolCall.name,
              filePath: (toolCall.input as Record<string, unknown>)['path'] as string | undefined,
            });
            if (!toolValidation.allowed) {
              toolResults.push({
                toolUseId: toolCall.id,
                result: `Contract violation: ${toolValidation.violations.map((v) => v.description).join('; ')}`,
              });
              continue;
            }
          }

          // Detect duplicate file_write calls — prevent rewrites within task AND across pods
          if (toolCall.name === 'file_write') {
            const filePath = String((toolCall.input as Record<string, unknown>)['path'] || '');
            // Normalize path for consistent dedup (forward slashes, strip leading ./ and trailing /)
            const normPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();

            // Cross-task dedup: another pod already wrote this file in this execution
            const priorPod = state.filesWrittenInExecution.get(normPath);
            if (priorPod && priorPod !== podId) {
              this.appendPodLog(podId, `Skipping file_write for "${normPath}" — already created by pod ${priorPod}`);
              toolResults.push({
                toolUseId: toolCall.id,
                result: `File "${filePath}" was already created by another pod in this execution. Use edit_file if you need to modify it, or move on to a different file.`,
              });
              continue;
            }

            // Within-task dedup: same pod already wrote this file in the current task
            if (filesWrittenInTask.has(normPath)) {
              this.appendPodLog(podId, `Skipping duplicate file_write for: ${normPath}`);
              toolResults.push({
                toolUseId: toolCall.id,
                result: `File "${filePath}" was already written in this task. Do NOT rewrite the same file. Move on to the next task or file.`,
              });
              continue;
            }
            filesWrittenInTask.add(normPath);
            state.filesWrittenInExecution.set(normPath, podId);
          }

          // Intercept request_clarification — handle via clarification system
          if (toolCall.name === 'request_clarification') {
            const result = await this.handleClarification(state, task, pod, toolCall.input);
            toolResults.push({ toolUseId: toolCall.id, result });
            continue;
          }

          // Intercept request_context_snippet — on-demand artifact retrieval
          if (toolCall.name === 'request_context_snippet') {
            const snippetInput = toolCall.input as Record<string, unknown>;
            const artifactName = String(snippetInput['artifact_name'] || '');
            const query = String(snippetInput['query'] || '');
            const maxChars = Math.min(Number(snippetInput['max_chars']) || 5000, 10_000);

            let found = '';
            for (const [, artifact] of state.artifacts) {
              const name = (artifact.path || artifact.name || '').toLowerCase();
              if (name === artifactName.toLowerCase() || name.endsWith(artifactName.toLowerCase())) {
                const content = typeof artifact.content === 'string'
                  ? artifact.content
                  : JSON.stringify(artifact.content, null, 2);
                if (query) {
                  const idx = content.toLowerCase().indexOf(query.toLowerCase());
                  if (idx >= 0) {
                    const start = Math.max(0, idx - 200);
                    found = content.slice(start, start + maxChars);
                  } else {
                    found = `No match for "${query}" in ${artifactName}. First ${maxChars} chars:\n${content.slice(0, maxChars)}`;
                  }
                } else {
                  found = content.slice(0, maxChars);
                }
                break;
              }
            }

            if (!found) {
              const available = Array.from(state.artifacts.values())
                .map(a => a.path || a.name || 'unnamed')
                .slice(0, 20)
                .join(', ');
              found = `Artifact "${artifactName}" not found. Available: ${available}`;
            }

            toolResults.push({ toolUseId: toolCall.id, result: found });
            continue;
          }

          // Intercept request_pause_and_ask — HARD PAUSE entire TBWO
          if (toolCall.name === 'request_pause_and_ask') {
            const result = await this.handlePauseAndAsk(state, task, pod, toolCall.input);
            toolResults.push({ toolUseId: toolCall.id, result });
            continue;
          }

          // Invariant: reject deploy/overwrite operations while paused_waiting_for_user
          if (state.status === 'paused_waiting_for_user') {
            toolResults.push({
              toolUseId: toolCall.id,
              result: `Execution is paused waiting for user input. Tool "${toolCall.name}" is blocked until the pause is resolved.`,
            });
            continue;
          }

          // Check cache for idempotent tool reads (file_read, scan_directory, etc.)
          const toolInput = toolCall.input as Record<string, unknown>;
          const cachedResult = this.getCachedToolResult(state, toolCall.name, toolInput);
          if (cachedResult !== undefined) {
            toolResults.push({ toolUseId: toolCall.id, result: cachedResult });
            toolActivities.push({
              name: toolCall.name,
              status: 'completed',
              duration: 0,
              details: toolCall.name.replace(/_/g, ' ') + ' (cached)',
            });
            continue;
          }

          // Update streaming message with clean tool indicator (replaced on finalization)
          if (streamingMsgId) {
            streamedText += `\n\n_Using ${toolCall.name.replace(/_/g, ' ')}..._`;
            this.updateStreamingMessage(streamingMsgId, `**${podLabel}** working on *${task.name}*:\n\n${streamedText}`);
          }

          const toolCallStart = Date.now();
          const toolResult = await this.handleToolCall(toolCall, state);
          const toolCallDuration = Date.now() - toolCallStart;
          const toolSuccess = !toolResult.startsWith('Error');
          toolResults.push({
            toolUseId: toolCall.id,
            result: toolResult,
          });

          // Cache the result for idempotent tools
          this.cacheToolResult(state, toolCall.name, toolInput, toolResult);

          // Invalidate cached file reads when a file is mutated
          if (FILE_MUTATING_TOOLS.has(toolCall.name)) {
            const mutatedPath = String((toolCall.input as Record<string, unknown>)['path'] || '');
            if (mutatedPath) this.invalidateFileCache(state, mutatedPath);
          }

          // Track tool activity for structured rendering
          const toolDetailsMap: Record<string, string> = {
            file_write: `Wrote ${toolInput['path'] || 'file'}`,
            edit_file: `Edited ${toolInput['path'] || 'file'}`,
            file_read: `Read ${toolInput['path'] || 'file'}`,
            file_list: `Listed ${toolInput['path'] || 'directory'}`,
            scan_directory: `Scanned ${toolInput['path'] || 'directory'}`,
            code_search: `Searched for "${String(toolInput['query'] || toolInput['pattern'] || '').slice(0, 40)}"`,
            run_command: `Ran ${String(toolInput['command'] || '').slice(0, 50)}`,
            web_search: `Searched "${String(toolInput['query'] || '').slice(0, 40)}"`,
            git: `Git ${toolInput['command'] || toolInput['action'] || 'operation'}`,
            execute_code: 'Executed code',
            generate_image: `Generated image: ${String(toolInput['prompt'] || '').slice(0, 40)}`,
            web_fetch: `Fetching "${String(toolInput['url'] || '').slice(0, 50)}"`,
            search_images: `Searching images: "${String(toolInput['query'] || '').slice(0, 40)}"`,
            site_validate: 'Running site validation...',
            conversion_audit: 'Running conversion audit...',
            site_improve: 'Analyzing site for improvements...',
            motion_validate: 'Running motion validation...',
            scene_validate: 'Running 3D scene validation...',
            output_guard: 'Scanning for generic content...',
          };
          toolActivities.push({
            name: toolCall.name,
            status: toolSuccess ? 'completed' : 'failed',
            duration: toolCallDuration,
            details: toolDetailsMap[toolCall.name] || toolCall.name.replace(/_/g, ' '),
          });

          // Record tool reliability (fire-and-forget) — includes model for adaptive routing
          import('../selfModelService').then(sm => {
            sm.onToolCall(toolCall.name, toolSuccess, toolCallDuration, toolSuccess ? undefined : toolResult, modelUsed).catch(() => {});
          }).catch(() => {});

          // Check if the tool created an artifact (e.g., file_write)
          if (toolCall.name === 'file_write' || toolCall.name === 'edit_file') {
            const artifactId = nanoid();
            // Normalize path: strip output/tbwo/<slug>/ and output/ prefixes to match workspace paths
            let artifactPath = String((toolCall.input as Record<string, unknown>)['path'] || '');
            artifactPath = artifactPath.replace(/^output\/tbwo\/[^/]+\//, '').replace(/^output\//, '');

            // Resolve artifact content:
            // - file_write: use input['content'] (the actual file content sent to the tool)
            // - edit_file: input has old_str/new_str but no 'content', so read from workspace or fallback
            let artifactContent: string;
            if (toolCall.name === 'file_write') {
              artifactContent = String((toolCall.input as Record<string, unknown>)['content'] || '');
            } else if (toolCall.name === 'edit_file' && state.workspaceMode && state.workspaceId) {
              // For edit_file in workspace mode, read the updated file to get real content
              try {
                const readResp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/read`, {
                  method: 'POST',
                  headers: this.getAuthHeaders(),
                  body: JSON.stringify({ path: artifactPath }),
                });
                if (readResp.ok) {
                  const readData = await readResp.json();
                  artifactContent = typeof readData.content === 'string' ? readData.content : toolResult;
                } else {
                  artifactContent = toolResult;
                }
              } catch {
                artifactContent = toolResult;
              }
            } else {
              // Non-workspace edit_file: fallback to tool result message
              artifactContent = toolResult;
            }

            // For edit_file or file_write, update existing artifact instead of creating a duplicate
            let existingArtifact: Artifact | undefined;
            if ((toolCall.name === 'edit_file' || toolCall.name === 'file_write') && artifactPath) {
              const normalizedArtifactPath = artifactPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
              for (const [, a] of state.artifacts) {
                const aPath = (a.path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
                const aName = (a.name || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
                if (aPath === normalizedArtifactPath || aName === normalizedArtifactPath) {
                  existingArtifact = a;
                  break;
                }
              }
            }

            // Feature 9: Validate artifact content before storing
            const artifactValidation = validateArtifact({
              name: existingArtifact?.name || artifactPath || toolCall.name,
              path: artifactPath,
              content: artifactContent,
              type: 'file',
            });
            if (!artifactValidation.valid) {
              this.appendPodLog(podId, `Artifact validation warning for "${artifactPath}": ${(artifactValidation as { errors: string[] }).errors.join('; ')}`);
            }

            if (existingArtifact) {
              // Update existing artifact in-place with new content
              existingArtifact.content = artifactContent;
              existingArtifact.version = (existingArtifact.version || 1) + 1;
              existingArtifact.description = `Edited by ${pod.role} pod during task "${task.name}"`;
              useTBWOStore.getState().addArtifact(state.tbwoId, existingArtifact);
            } else {
              const artifact: Artifact = {
                id: artifactId,
                tbwoId: state.tbwoId,
                name: artifactPath || toolCall.name,
                type: ArtifactType.FILE,
                description: `Created by ${pod.role} pod during task "${task.name}"`,
                content: artifactContent,
                path: artifactPath,
                createdBy: podId,
                createdAt: Date.now(),
                version: 1,
                status: !artifactValidation.valid ? 'rejected' : 'draft',
              };
              artifacts.push(artifact);
              state.artifacts.set(artifact.id, artifact);
              useTBWOStore.getState().addArtifact(state.tbwoId, artifact);
              tbwoUpdateService.artifactCreated(state.tbwoId, artifact.name, 'file');
            }

            // Artifact is already visible via tool_activity blocks in the finalized message.
            // No separate postArtifactToChat() — avoids duplicate "File created" messages.

            // Broadcast artifact_ready to all pods via message bus
            const broadcastArtifact = existingArtifact || artifacts[artifacts.length - 1];
            if (broadcastArtifact) {
              state.messageBus.broadcast(podId, 'artifact_ready', {
                artifactId: broadcastArtifact.id,
                name: broadcastArtifact.name,
                path: broadcastArtifact.path || '',
                type: broadcastArtifact.type,
                createdBy: podId,
                preview: typeof broadcastArtifact.content === 'string' ? broadcastArtifact.content.slice(0, 500) : '',
              }, 'normal');
            }
          }
        }

        // Send ALL tool results in a single batched continuation call
        if (toolResults.length > 0) {
          streamedText += '\n\n';
          // CRITICAL: Truncate tool results to prevent token overflow (850K > 200K).
          // scan_directory and file_read can return megabytes of data.
          const MAX_TOOL_RESULT_CHARS = 4000;
          const batchedResults = toolResults.map(tr => ({
            toolUseId: tr.toolUseId,
            toolName: currentToolCalls.find(tc => tc.id === tr.toolUseId)?.name || 'unknown',
            result: tr.result.length > MAX_TOOL_RESULT_CHARS
              ? tr.result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...(truncated from ' + tr.result.length + ' chars)'
              : tr.result,
          }));

          await new Promise<void>((resolve) => {
            aiService.streamContinueWithBatchedToolResults(batchedResults, {
              onText: (chunk: string) => {
                streamedText += chunk;
                if (streamingMsgId) {
                  this.updateStreamingMessage(streamingMsgId, `**${podLabel}** working on *${task.name}*:\n\n${streamedText}`);
                }
              },
              onToolUse: (tool: { id: string; name: string; input: unknown }) => {
                pendingToolCalls.push({ id: tool.id, name: tool.name, input: tool.input as Record<string, unknown> });
              },
              onComplete: (response) => {
                tokensUsed += (response.usage?.inputTokens || 0) + (response.usage?.outputTokens || 0);
                resolve();
              },
              onError: (error: Error) => {
                this.appendPodLog(podId, `Continuation error: ${error.message}`);
                resolve();
              },
            }, tools).catch(() => resolve());
          });
        }
      }

      // Finalize the streaming message — include tool activities as structured data
      if (streamingMsgId) {
        this.finalizeStreamingMessageWithActivities(
          streamingMsgId,
          `**${podLabel}** completed *${task.name}*:\n\n${streamedText}`,
          toolActivities
        );
      }

      // Extract final output
      const finalOutput = streamedText || '';

      // Record usage against contract
      if (state.contractId) {
        const estimatedCost = (tokensUsed / 1_000_000) * 3; // rough estimate
        contractService.recordUsage(state.contractId, estimatedCost, tokensUsed);
      }

      // Update store: mark task as complete
      useTBWOStore.getState().completeTask(task.id);

      // Sync pod metrics and push completed task to runtime store
      const metrics = aiService.getMetrics();
      const poolPod = usePodPoolStore.getState().pool.get(podId);
      const existingCompleted = poolPod?.runtime?.completedTasks || [];
      usePodPoolStore.getState().updatePodRuntime(podId, {
        podStatus: PodStatus.IDLE,
        currentTask: undefined,
        completedTasks: [...existingCompleted, { id: task.id, name: task.name, completedAt: Date.now() }],
        resourceUsage: {
          cpuPercent: 0,
          memoryMB: 0,
          tokensUsed: metrics.totalTokens,
          apiCalls: metrics.totalCalls,
          executionTime: Date.now() - taskStart,
        },
      });
      this.appendPodLog(podId, `Task completed: ${task.name} (${tokensUsed} tokens, ${artifacts.length} artifacts)`);

      // Task output is already streamed live into the chat via streaming message

      // Broadcast completion via message bus
      state.messageBus.publish({
        from: podId,
        to: '*',
        type: 'result',
        payload: { task: task.name, status: 'completed', outputPreview: finalOutput.substring(0, 200) },
        priority: 'normal',
      });

      tbwoUpdateService.taskCompleted(state.tbwoId, task.name, {
        success: true,
        output: finalOutput.substring(0, 500),
      });

      return {
        taskId: task.id,
        success: true,
        output: finalOutput,
        artifacts,
        tokensUsed,
        duration: Date.now() - taskStart,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.appendPodLog(podId, `Task failed: ${task.name} — ${errMsg}`);

      // Sync pod metrics even on failure, then mark idle
      const failMetrics = aiService.getMetrics();
      usePodPoolStore.getState().updatePodRuntime(podId, {
        podStatus: PodStatus.IDLE,
        currentTask: undefined,
        resourceUsage: {
          cpuPercent: 0,
          memoryMB: 0,
          tokensUsed: failMetrics.totalTokens,
          apiCalls: failMetrics.totalCalls,
          executionTime: Date.now() - taskStart,
        },
      });

      // Broadcast failure via message bus
      state.messageBus.publish({
        from: podId,
        to: '*',
        type: 'error',
        payload: { task: task.name, error: errMsg },
        priority: 'high',
      });

      tbwoUpdateService.taskFailed(state.tbwoId, task.name, errMsg);

      // Post failure to TBWO chat
      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `**${pod.name}** failed on *${task.name}*: ${errMsg}` },
      ], pod.name);

      return {
        taskId: task.id,
        success: false,
        output: '',
        artifacts,
        tokensUsed,
        duration: Date.now() - taskStart,
        error: errMsg,
      };
    }
  }

  // ==========================================================================
  // POD MANAGEMENT
  // ==========================================================================

  /**
   * Spawn pods based on the TBWO's plan pod strategy.
   * Creates an AIService instance for each pod and subscribes them to the MessageBus.
   */
  private async spawnPods(state: ExecutionState, tbwo: TBWO): Promise<void> {
    const plan = tbwo.plan;
    if (!plan) return;

    // Release any stale pool assignments for this TBWO (handles restarts cleanly)
    usePodPoolStore.getState().clearForTBWO(state.tbwoId);

    const strategy = plan.podStrategy;
    const rolesToSpawn = strategy.priorityOrder.length > 0
      ? strategy.priorityOrder
      : [PodRole.ORCHESTRATOR];

    // Spawn all roles defined by the plan (no artificial cap)
    const maxPods = rolesToSpawn.length;

    // Read pod definitions from tbwo.pods (plan-time config: tool whitelists, model configs)
    const definitionsByRole = new Map<string, AgentPod>();
    if (tbwo.pods) {
      for (const pod of tbwo.pods.values()) {
        definitionsByRole.set(pod.role, pod);
      }
    }

    for (let i = 0; i < maxPods; i++) {
      const role = rolesToSpawn[i]!;

      // Get or create a pool pod — this is the SOLE runtime instance
      const pooledPod = usePodPoolStore.getState().getOrCreatePod(role, state.tbwoId, state.executionAttemptId);
      const poolPodId = pooledPod.id;
      const poolContext = getPooledPodContext(pooledPod);

      // Read definition from plan (tool whitelist, model config) if available
      const definition = definitionsByRole.get(role);

      // Use intelligent model routing if enabled, otherwise fall back to definition/defaults
      const routedModel = resolveModelForPod(role);
      const modelConfig = {
        provider: routedModel.provider || definition?.modelConfig?.provider || 'anthropic',
        model: routedModel.model || definition?.modelConfig?.model || 'claude-sonnet-4-6',
        temperature: definition?.modelConfig?.temperature,
        maxTokens: definition?.modelConfig?.maxTokens,
      };
      console.log(`[ExecutionEngine] Pod ${role}: model=${getModelDisplayName(modelConfig.model)} (${routedModel.reason})`);
      const toolWhitelist = definition?.toolWhitelist || [
        'file_write', 'file_read', 'file_list', 'execute_code',
        'run_command', 'scan_directory', 'code_search', 'edit_file',
        'web_search', 'git', 'system_status',
        'request_pause_and_ask', 'request_context_snippet',
        'search_images', 'memory_store', 'memory_recall',
      ];

      // Initialize runtime state on the pool pod
      usePodPoolStore.getState().updatePodRuntime(poolPodId, {
        executionAttemptId: state.executionAttemptId,
        podStatus: PodStatus.INITIALIZING,
        health: { status: 'healthy', lastHeartbeat: Date.now(), errorCount: 0, consecutiveFailures: 0, warnings: [] },
        resourceUsage: { cpuPercent: 0, memoryMB: 0, tokensUsed: 0, apiCalls: 0, executionTime: 0 },
        completedTasks: [],
        messageLog: [],
        startedAt: Date.now(),
        modelConfig,
        toolWhitelist,
      });

      // If runtime wasn't set by getOrCreatePod (reusing existing pod), set it now
      const freshPod = usePodPoolStore.getState().pool.get(poolPodId);
      if (freshPod && !freshPod.runtime) {
        usePodPoolStore.setState((s) => {
          const pp = s.pool.get(poolPodId);
          if (pp) {
            pp.runtime = {
              executionAttemptId: state.executionAttemptId,
              podStatus: PodStatus.INITIALIZING,
              health: { status: 'healthy', lastHeartbeat: Date.now(), errorCount: 0, consecutiveFailures: 0, warnings: [] },
              resourceUsage: { cpuPercent: 0, memoryMB: 0, tokensUsed: 0, apiCalls: 0, executionTime: 0 },
              completedTasks: [],
              messageLog: [],
              startedAt: Date.now(),
              modelConfig,
              toolWhitelist,
            };
          }
        });
      }

      // Build system prompt from role definition + pool context
      const podForPrompt: AgentPod = definition || {
        id: poolPodId,
        role,
        name: pooledPod.name,
        status: PodStatus.INITIALIZING,
        health: { status: 'healthy', lastHeartbeat: Date.now(), errorCount: 0, consecutiveFailures: 0, warnings: [] },
        modelConfig,
        toolWhitelist,
        memoryScope: [],
        taskQueue: [],
        completedTasks: [],
        outputs: [],
        resourceUsage: { cpuPercent: 0, memoryMB: 0, tokensUsed: 0, apiCalls: 0, executionTime: 0 },
        messageLog: [],
        createdAt: Date.now(),
        tbwoId: state.tbwoId,
      };
      let systemPrompt = buildPodSystemPrompt(podForPrompt);
      if (poolContext) {
        systemPrompt += '\n' + poolContext;
      }

      // Create an AIService for this pod
      const aiService = new AIService({
        provider: modelConfig.provider || 'anthropic',
        model: modelConfig.model || 'claude-sonnet-4-6',
        temperature: modelConfig.temperature,
        maxTokens: modelConfig.maxTokens,
        systemPrompt,
      });

      // Register in execution state — keyed by POOL pod ID
      state.activePods.set(poolPodId, {
        role,
        name: pooledPod.name,
        aiService,
      });

      // Map DEFINITION pod ID → POOL pod ID so task.assignedPod resolves correctly
      if (definition) {
        state.definitionToPoolPodId.set(definition.id, poolPodId);
      }
      // Also map by role for tasks that were assigned via podsByRole.get(role)
      // (the definition ID is what podsByRole returns)
      state.definitionToPoolPodId.set(`role:${role}`, poolPodId);

      // Subscribe pod to the message bus
      state.messageBus.subscribe(poolPodId, (message) => {
        if (message.from === poolPodId) return;
        const inbox = state.podInboxes.get(poolPodId) || [];
        inbox.push(message);
        state.podInboxes.set(poolPodId, inbox);
      });

      // Set pod to IDLE immediately (no delay — tasks need pods ready now)
      usePodPoolStore.getState().updatePodRuntime(poolPodId, { podStatus: PodStatus.IDLE });

      console.log(`[ExecutionEngine] SPAWN pod: role=${role}, poolPodId=${poolPodId}, attempt=${state.executionAttemptId}, experience=${pooledPod.totalTBWOsServed} TBWOs`);
    }
  }

  /**
   * Terminate all active pods, unsubscribe from bus, and clean up.
   */
  private async terminatePods(state: ExecutionState): Promise<void> {
    // Final metrics sync + return pods to pool
    for (const [podId, podEntry] of state.activePods) {
      try {
        const metrics = podEntry.aiService.getMetrics();

        // Update final runtime metrics
        if (metrics.totalTokens > 0 || metrics.totalCalls > 0) {
          usePodPoolStore.getState().updatePodRuntime(podId, {
            podStatus: 'terminated',
            resourceUsage: {
              cpuPercent: 0,
              memoryMB: 0,
              tokensUsed: metrics.totalTokens,
              apiCalls: metrics.totalCalls,
              executionTime: Date.now() - state.startTime,
            },
          });
        }

        // Read completed tasks from runtime state for pool summary
        const poolPod = usePodPoolStore.getState().pool.get(podId);
        const completedCount = poolPod?.runtime?.completedTasks?.length || 0;
        const summary = completedCount > 0
          ? `Completed ${completedCount} tasks in TBWO ${state.tbwoId}. Used ${metrics.totalTokens} tokens across ${metrics.totalCalls} API calls.`
          : undefined;

        // Detect specializations from completed task names
        const patterns: string[] = [];
        if (poolPod?.runtime?.completedTasks) {
          poolPod.runtime.completedTasks.forEach(task => {
            if (task.name) {
              if (/react|component|jsx|tsx/i.test(task.name)) patterns.push('React/component development');
              if (/api|endpoint|rest/i.test(task.name)) patterns.push('API/endpoint development');
              if (/css|style|tailwind/i.test(task.name)) patterns.push('CSS/styling');
              if (/test|spec|qa/i.test(task.name)) patterns.push('Testing/QA');
              if (/database|sql|query/i.test(task.name)) patterns.push('Database operations');
            }
          });
        }

        // Sync final metrics to the TBWO's definition pod (persists after pool return)
        const defPodId = [...state.definitionToPoolPodId.entries()]
          .find(([, poolId]) => poolId === podId)?.[0];
        if (defPodId && !defPodId.startsWith('role:')) {
          const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
          const defPod = tbwo?.pods?.get(defPodId);
          if (defPod) {
            const updatedPod: AgentPod = {
                ...defPod,
                status: PodStatus.COMPLETE,
                resourceUsage: {
                  cpuPercent: 0,
                  memoryMB: 0,
                  tokensUsed: metrics.totalTokens,
                  apiCalls: metrics.totalCalls,
                  executionTime: Date.now() - state.startTime,
                },
                completedTasks: (poolPod?.runtime?.completedTasks as any) || defPod.completedTasks,
                modelConfig: poolPod?.runtime?.modelConfig || defPod.modelConfig,
              };
            useTBWOStore.getState().updateTBWO(state.tbwoId, {
              pods: new Map([...tbwo!.pods, [defPodId, updatedPod]]),
            });
          }
        }

        // Return pod to pool (clears runtime, sets status=available)
        usePodPoolStore.getState().returnPodToPool(podId, summary, [...new Set(patterns)]);

        // Update pool pod lifetime counts
        usePodPoolStore.setState((s) => {
          const pp = s.pool.get(podId);
          if (pp) {
            pp.totalTokensUsed += metrics.totalTokens;
            pp.totalTasksCompleted += completedCount;
          }
        });

        state.podInboxes.delete(podId);
      } catch (err) {
        console.error(`[ExecutionEngine] Error syncing pod ${podId} metrics:`, err);
      }
    }
    state.activePods.clear();

    // Clear the message bus and remaining inboxes
    state.messageBus.clear();
    state.podInboxes.clear();
    state.pendingClarifications.clear();
  }

  // ==========================================================================
  // TASK SCHEDULING
  // ==========================================================================

  /**
   * Build groups of tasks that can run in parallel.
   * Tasks within a group have no interdependencies.
   * Groups are ordered so that dependencies are satisfied before dependents.
   *
   * Since the Task type in tbwo.ts does not have a `dependsOn` field,
   * we treat all tasks in a phase as independent (one group) unless
   * the task has been extended with a `dependsOn` array at runtime.
   */
  private buildTaskGroups(tasks: Task[], completedTaskIds: Set<string>): Task[][] {
    if (tasks.length === 0) return [];

    // Check if any task has a runtime `dependsOn` property
    type TaskWithDeps = Task & { dependsOn?: string[] };
    const hasDependencies = tasks.some(
      (t) => Array.isArray((t as TaskWithDeps).dependsOn) && (t as TaskWithDeps).dependsOn!.length > 0
    );

    if (!hasDependencies) {
      // All tasks are independent - run them all in one parallel group
      return [tasks.filter((t) => t.status !== 'complete')];
    }

    // Topological sort into groups
    const groups: Task[][] = [];
    const remaining = new Set(tasks.filter((t) => t.status !== 'complete').map((t) => t.id));
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const resolved = new Set(completedTaskIds);

    let safetyCounter = 0;
    const maxIterations = tasks.length + 1;

    while (remaining.size > 0 && safetyCounter < maxIterations) {
      safetyCounter++;
      const group: Task[] = [];

      for (const taskId of remaining) {
        const task = taskMap.get(taskId)!;
        const deps = (task as TaskWithDeps).dependsOn || [];
        const allDepsResolved = deps.every((dep: string) => resolved.has(dep));

        if (allDepsResolved) {
          group.push(task);
        }
      }

      if (group.length === 0) {
        // Circular dependency or unresolvable - push remaining as a single group
        const fallback: Task[] = [];
        for (const taskId of remaining) {
          const task = taskMap.get(taskId);
          if (task) fallback.push(task);
        }
        groups.push(fallback);
        break;
      }

      // Add this group and mark tasks as resolved
      groups.push(group);
      for (const task of group) {
        remaining.delete(task.id);
        resolved.add(task.id);
      }
    }

    return groups;
  }

  /**
   * Find the best available pod for a task.
   * Matches by role (if task has assignedPod), otherwise picks an idle pod.
   */
  private getBestPodForTask(state: ExecutionState, task: Task): string | null {
    // If task has a specific pod assigned, resolve it
    if (task.assignedPod) {
      // Direct match (already a pool pod ID)
      if (state.activePods.has(task.assignedPod)) {
        return task.assignedPod;
      }
      // Resolve definition pod ID → pool pod ID via mapping
      const resolvedPoolId = state.definitionToPoolPodId.get(task.assignedPod);
      if (resolvedPoolId && state.activePods.has(resolvedPoolId)) {
        return resolvedPoolId;
      }
    }

    // No specific assignment or unresolved — find a pod by role match
    // Look for an idle pod whose role matches the task's expected role
    for (const [podId, podEntry] of state.activePods) {
      const poolPod = usePodPoolStore.getState().pool.get(podId);
      if (poolPod?.runtime?.podStatus === PodStatus.IDLE) {
        return podId;
      }
    }

    // If no idle pod, pick the first active pod (it may be busy but will queue)
    const firstPodId = state.activePods.keys().next().value;
    return firstPodId ?? null;
  }

  // ==========================================================================
  // CHECKPOINT HANDLING
  // ==========================================================================

  /**
   * Handle a checkpoint:
   * 1. Mark the checkpoint as reached in the store
   * 2. If autonomous authority: auto-continue
   * 3. Otherwise: pause and wait for user decision
   * 4. Return the decision
   */
  private async handleCheckpoint(
    state: ExecutionState,
    phase: Phase,
    checkpoint: Checkpoint
  ): Promise<CheckpointDecision | null> {
    // Mark checkpoint as reached
    useTBWOStore.getState().reachCheckpoint(checkpoint.id);
    tbwoUpdateService.checkpointReached(state.tbwoId, checkpoint.name);

    // Check authority level
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo) return null;

    if (tbwo.authorityLevel === AuthorityLevel.AUTONOMOUS) {
      // Auto-continue: create a decision and respond
      const decision: CheckpointDecision = {
        action: 'continue',
        feedback: `Auto-approved: autonomous authority for phase "${phase.name}"`,
        decidedBy: 'system-autonomous',
        timestamp: Date.now(),
      };
      useTBWOStore.getState().respondToCheckpoint(checkpoint.id, decision);
      return decision;
    }

    // For non-autonomous: pause execution and wait for user
    state.status = 'checkpoint';
    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.CHECKPOINT,
    });

    // Poll for user decision (check every 2 seconds, timeout after 30 minutes)
    const maxWait = 30 * 60 * 1000;
    const pollInterval = 2000;
    const startWait = Date.now();

    while (Date.now() - startWait < maxWait) {
      // Check if execution was cancelled while waiting
      const currentState = this.states.get(state.tbwoId);
      if (!currentState || currentState.status === 'cancelled') {
        return { action: 'cancel', decidedBy: 'system', timestamp: Date.now() };
      }

      // Check if checkpoint has a decision
      const freshTBWO = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const freshCheckpoint = freshTBWO?.checkpoints.find((cp) => cp.id === checkpoint.id);

      if (freshCheckpoint?.decision) {
        // User made a decision
        if (freshCheckpoint.decision.action === 'continue' || freshCheckpoint.decision.action === 'continue_with_changes') {
          state.status = 'executing';
        }
        return freshCheckpoint.decision;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout - auto-continue with a note
    const timeoutDecision: CheckpointDecision = {
      action: 'continue',
      feedback: 'Checkpoint timed out after 30 minutes - auto-continuing',
      decidedBy: 'system-timeout',
      timestamp: Date.now(),
    };
    useTBWOStore.getState().respondToCheckpoint(checkpoint.id, timeoutDecision);
    state.status = 'executing';
    return timeoutDecision;
  }

  // ==========================================================================
  // COMPLETION & FAILURE
  // ==========================================================================

  /**
   * Complete the execution:
   * 1. Generate receipts via the store
   * 2. Update TBWO status to completed
   * 3. Stop time tracking
   * 4. Fulfill contract
   * 5. Deliver files as chat attachments
   * 6. Cleanup pods
   */
  private async completeExecution(state: ExecutionState): Promise<void> {
    state.status = 'completing';

    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.COMPLETING,
    });

    // Run automatic site validation for Website Sprint TBWOs
    await this.runPostCompletionSiteValidation(state);

    // Run automatic conversion audit for Website Sprint TBWOs
    await this.runPostCompletionConversionAudit(state);

    // Run automatic motion validation for Website Sprint TBWOs
    await this.runPostCompletionMotionValidation(state);

    // Run 3D scene validation for Website Sprint TBWOs
    await this.runPostCompletionSceneValidation(state);

    // Generate receipts
    try {
      await useTBWOStore.getState().generateReceipts(state.tbwoId);
    } catch (err) {
      console.error('[ExecutionEngine] Failed to generate receipts:', err);
    }

    // Run Truth Guard on Website Sprint TBWOs before generating manifest
    await this.runPostCompletionTruthGuard(state);

    // Check Truth Guard results - warn and adjust status if failed
    const tgTbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    const truthGuardResult = tgTbwo?.metadata?.truthGuardResult as { passed?: boolean; violations?: any[] } | undefined;
    if (truthGuardResult && !truthGuardResult.passed) {
      const violationCount = truthGuardResult.violations?.length || 0;
      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `**Truth Guard Warning:** ${violationCount} unresolved violations detected. Quality score has been adjusted. Review the violations in the Receipts tab.` },
      ]);
    }

    // Run Output Guard (cognitive subsystem) for generic content detection
    await this.runPostCompletionOutputGuard(state);

    // Run sandbox pipeline (validate → repair → package) for workspace-mode TBWOs
    if (state.workspaceMode && state.workspaceId) {
      try {
        const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
        const siteBrief = tbwo?.metadata?.siteBrief as Record<string, unknown> | undefined;
        const navPages = (siteBrief?.navPages as string[]) || (siteBrief?.pages as string[]) || [];
        const approvedClaims: string[] = [];

        // Collect user-provided claims from provenance
        const provenance = tbwo?.metadata?.provenance as Record<string, string> | undefined;
        if (provenance && siteBrief) {
          for (const [field, tag] of Object.entries(provenance)) {
            if (tag === 'USER_PROVIDED') {
              const val = siteBrief[field];
              if (typeof val === 'string' && val.length > 0) approvedClaims.push(val);
            }
          }
        }

        const token = useAuthStore.getState().token || '';
        const resp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/sandbox/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            throughStage: 'package',
            brief: siteBrief,
            expectedPages: navPages,
            approvedClaims,
          }),
        });

        if (resp.ok) {
          console.log(`[ExecutionEngine] Sandbox pipeline started for ${state.tbwoId}`);

          // Store pipeline reference in TBWO metadata
          useTBWOStore.getState().updateTBWO(state.tbwoId, {
            metadata: {
              ...(tbwo?.metadata || {}),
              sandboxPipeline: { started: true, stage: 'init' },
            },
          });
        } else {
          console.warn(`[ExecutionEngine] Sandbox pipeline failed to start: ${resp.status}`);
        }
      } catch (err) {
        console.error('[ExecutionEngine] Sandbox pipeline error:', err);
      }
    }

    // Generate SiteModel manifest (alin.site.json) for Website Sprint TBWOs
    await this.generateSiteManifest(state);

    // Stop time tracking
    this.stopTimeTracking(state.tbwoId);

    // Fulfill contract
    if (state.contractId) {
      contractService.fulfillContract(state.contractId);
    }

    // Deliver file artifacts as chat attachments
    const deliveredCount = this.deliverFilesToChat(state);

    // If workspace mode, deliver zip download pill
    if (state.workspaceMode && state.workspaceId && state.workspaceFiles.length > 0) {
      const token = useAuthStore.getState().token || '';
      const zipUrl = `${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/zip?token=${encodeURIComponent(token)}`;
      const totalSize = state.workspaceFiles.reduce((sum, f) => sum + f.size, 0);

      // Use product name from brief for cleaner ZIP filename
      const completionTbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const briefProductName = (completionTbwo?.metadata?.siteBrief as Record<string, unknown> | undefined)?.productName as string | undefined;
      const zipSlug = (briefProductName || completionTbwo?.objective || 'project')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `**Download all files** (${state.workspaceFiles.length} files)` },
        {
          type: 'file' as const,
          fileId: `zip-${state.tbwoId}`,
          filename: `${zipSlug}-website.zip`,
          mimeType: 'application/zip',
          size: totalSize,
          url: zipUrl,
        } as ContentBlock,
      ]);
    }

    // Snapshot pod metrics from pool back to TBWO pod definitions
    // This preserves runtime metrics for historical viewing after pods return to pool
    try {
      const tbwoForMetrics = useTBWOStore.getState().getTBWOById(state.tbwoId);
      if (tbwoForMetrics) {
        const podPoolState = usePodPoolStore.getState();
        const updatedPods = new Map(tbwoForMetrics.pods);
        for (const [poolPodId, podInfo] of state.activePods) {
          const poolPod = podPoolState.pool.get(poolPodId);
          if (poolPod) {
            for (const [defPodId, defPod] of updatedPods) {
              if (defPod.role === podInfo.role || defPod.name === podInfo.name) {
                updatedPods.set(defPodId, {
                  ...defPod,
                  resourceUsage: {
                    ...defPod.resourceUsage,
                    tokensUsed: poolPod.runtime?.resourceUsage?.tokensUsed || defPod.resourceUsage.tokensUsed,
                    apiCalls: poolPod.runtime?.resourceUsage?.apiCalls || defPod.resourceUsage.apiCalls,
                    executionTime: poolPod.runtime?.resourceUsage?.executionTime || defPod.resourceUsage.executionTime,
                  },
                });
                break;
              }
            }
          }
        }
        useTBWOStore.getState().updateTBWO(state.tbwoId, { pods: updatedPods });
      }
    } catch (err) {
      console.warn('[ExecutionEngine] Failed to snapshot pod metrics:', err);
    }

    // Terminate pods
    await this.terminatePods(state);

    // Feature 10: Clear execution state checkpoint on completion
    fetch(`${BACKEND_URL}/api/tbwo/${state.tbwoId}`, {
      method: 'PATCH',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ execution_state: null }),
    }).catch(() => {});

    // Bonus: Prune stale pods from pool on TBWO completion
    usePodPoolStore.getState().pruneStale();

    // Record execution outcome in self-model (fire-and-forget)
    const completionTBWO = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (completionTBWO) {
      const totalPhases = completionTBWO.plan?.phases.length || 0;
      const failedPhases = state.errors.filter(e => e.task === '*').length;
      import('../selfModelService').then(sm => {
        sm.onTBWOComplete(
          state.tbwoId,
          completionTBWO.objective,
          completionTBWO.type,
          completionTBWO.timeBudget.total,
          totalPhases - failedPhases,
          failedPhases,
          state.artifacts.size,
          totalPhases > 0 ? Math.round(((totalPhases - failedPhases) / totalPhases) * 10) : 5,
        ).catch(() => {});
      }).catch(() => {});
    }

    // Store expected file count in metadata for quality scoring
    const preTBWOForExpected = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (preTBWOForExpected?.type === 'website_sprint' && preTBWOForExpected.metadata?.sprintConfig) {
      try {
        const expectedFiles = getExpectedFiles(preTBWOForExpected.metadata.sprintConfig as any);
        useTBWOStore.getState().updateTBWO(state.tbwoId, {
          metadata: {
            ...(preTBWOForExpected.metadata || {}),
            expectedFileCount: expectedFiles.length,
          },
        });
      } catch {}
    }

    // ========================================================================
    // REMEDIATION PASS — check for missing files and create them before completing
    // ========================================================================
    const preTBWO = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (preTBWO?.type === 'website_sprint' && preTBWO.metadata?.sprintConfig) {
      try {
        const expectedFiles = getExpectedFiles(preTBWO.metadata.sprintConfig as any);
        const actualFiles = Array.from(state.artifacts.values()).map(a => {
          const p = (a as any).path || '';
          return p.split('/').pop() || p;
        });
        const missing = expectedFiles.filter(ef => !actualFiles.some(af => af === ef.path));

        if (missing.length > 0 && !this.isTimeBudgetExpired(state.tbwoId)) {
          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `**Remediation pass:** ${missing.length} expected files missing (${missing.map(m => m.path).join(', ')}). Creating them now...` },
          ]);

          // Build a remediation phase with one task per missing file
          const remediationPhase: Phase = {
            id: `remediation-${Date.now()}`,
            name: 'Remediation — Missing Files',
            description: `Create ${missing.length} files that were expected but not produced in earlier phases.`,
            order: 999,
            estimatedDuration: missing.length * 2,
            dependsOn: [],
            tasks: missing.map((m, idx) => ({
              id: `remediation-task-${idx}`,
              name: `Create ${m.path}`,
              description: `Create the file ${m.path} (${m.description}). Match the style, design tokens, and conventions of the existing files already created. This file was expected but not produced in earlier phases.`,
              status: 'pending' as const,
              estimatedDuration: 2,
            })),
            assignedPods: Array.from(state.activePods.keys()),
            status: 'pending',
            progress: 0,
          };

          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `**Phase (Remediation): ${remediationPhase.name}**\n${remediationPhase.description}\nTasks: ${remediationPhase.tasks.length}` },
          ]);

          const remResult = await this.executePhase(state, remediationPhase);

          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `Remediation ${remResult.success ? 'completed' : 'finished with errors'}. Tasks: ${remResult.tasksCompleted} completed, ${remResult.tasksFailed} failed. New artifacts: ${remResult.artifacts.length}` },
          ]);

          // Re-deliver any new files
          this.deliverFilesToChat(state);
        }
      } catch (remErr) {
        console.warn('[ExecutionEngine] Remediation pass failed:', remErr);
      }
    }

    // Complete background job
    try {
      const completionTBWOForJob = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const bgJobId = completionTBWOForJob?.metadata?.backgroundJobId as string;
      if (bgJobId) {
        const { useBackgroundStore } = await import('../../store/backgroundStore');
        useBackgroundStore.getState().completeJob(bgJobId, `Completed: ${state.artifacts.size} files created`);
      }
    } catch {}

    // Mark as completed
    state.status = 'completed';
    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.COMPLETED,
      completedAt: Date.now(),
      progress: 100,
    });

    tbwoUpdateService.executionComplete(state.tbwoId, true);

    // Consequence Engine: resolve all pending predictions for this TBWO's conversation (fire-and-forget)
    try {
      const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const chatConvId = tbwo?.chatConversationId;
      if (chatConvId) {
        import('../consequenceService').then(({ resolveRecentPrediction, recordOutcome }) => {
          // Estimate quality: artifact count > 0 and completed = likely correct
          const qualityResult = state.artifacts.size > 0 ? 'correct' : 'partial';
          resolveRecentPrediction(chatConvId, qualityResult, 'tbwo_completion', `TBWO ${state.tbwoId} completed`).catch(() => {});

          // Also record a standalone outcome for the TBWO domain
          recordOutcome('tbwo_completion', qualityResult, {
            triggerSource: `TBWO ${state.tbwoId}: ${state.artifacts.size} artifacts`,
            domain: 'execution_strategy',
            lessonLearned: `TBWO completed with ${state.artifacts.size} artifacts in ${Math.round((Date.now() - state.startTime) / 60000)} minutes`,
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch {}

    // Post completion summary to TBWO chat
    const totalTime = Math.round((Date.now() - state.startTime - state.totalPauseDuration) / 60000);
    const artifactCount = state.artifacts.size;

    let completionMsg = `**Execution complete.**\n\n`;
    completionMsg += `Time: ${totalTime} minutes\n`;
    completionMsg += `Artifacts: ${artifactCount} files created\n`;
    completionMsg += `Tokens: ${state.totalTokensUsed.toLocaleString()}\n`;

    if (deliveredCount > 0) {
      completionMsg += `\n${deliveredCount} file${deliveredCount > 1 ? 's' : ''} delivered above.`;
    }

    completionMsg += '\n\nYou can iterate on the results, request changes, or ask questions about what was built.';

    this.postToChat(state.tbwoId, [
      { type: 'text' as const, text: completionMsg },
    ]);

    // Final file manifest report (post-remediation)
    const completionTBWOForManifest = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (completionTBWOForManifest?.type === 'website_sprint' && completionTBWOForManifest.metadata?.sprintConfig) {
      try {
        const expectedFiles = getExpectedFiles(completionTBWOForManifest.metadata.sprintConfig as any);
        const actualFiles = Array.from(state.artifacts.values()).map(a => {
          const p = (a as any).path || '';
          return p.split('/').pop() || p;
        });
        const missing = expectedFiles.filter(ef => !actualFiles.some(af => af === ef.path));
        const extra = actualFiles.filter(af => !expectedFiles.some(ef => ef.path === af) && af !== 'README.md');

        if (missing.length > 0 || extra.length > 0) {
          let manifestMsg = '**File Manifest Check:**\n';
          if (missing.length > 0) {
            manifestMsg += `\nStill missing (${missing.length}):\n`;
            for (const m of missing) {
              manifestMsg += `- ${m.path} — ${m.description}\n`;
            }
          }
          if (extra.length > 0) {
            manifestMsg += `\nExtra files (${extra.length}): ${extra.join(', ')}\n`;
          }
          manifestMsg += `\nExpected: ${expectedFiles.length} | Created: ${actualFiles.length}`;
          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: manifestMsg },
          ]);
        }
      } catch {
        // Manifest validation is non-critical
      }
    }

    // Persist receipts to server
    try {
      const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
      if (tbwo?.receipts) {
        await fetch(`${BACKEND_URL}/api/tbwo/${state.tbwoId}/receipts`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ type: 'full', data: tbwo.receipts }),
        });
      }
    } catch {
      // Non-critical
    }

    // Schedule workspace cleanup (delay to allow zip downloads)
    if (state.workspaceMode && state.workspaceId) {
      const wsId = state.workspaceId;
      setTimeout(async () => {
        try {
          await fetch(`${BACKEND_URL}/api/tbwo/${wsId}/workspace`, {
            method: 'DELETE',
            headers: this.getAuthHeaders(),
          });
        } catch {}
      }, 30 * 60 * 1000); // 30 minutes delay
    }

    // Clean up internal state
    this.states.delete(state.tbwoId);
  }

  /**
   * Handle a failure during execution.
   */
  private async handleFailure(state: ExecutionState, errorMessage: string): Promise<void> {
    state.status = 'failed';

    // Stop time tracking
    this.stopTimeTracking(state.tbwoId);

    // Terminate pods
    await this.terminatePods(state);

    // Fail background job
    try {
      const failedTBWO = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const bgJobId = failedTBWO?.metadata?.backgroundJobId as string;
      if (bgJobId) {
        const { useBackgroundStore } = await import('../../store/backgroundStore');
        useBackgroundStore.getState().failJob(bgJobId, errorMessage);
      }
    } catch {}

    // Fulfill contract (even on failure, so timers stop)
    if (state.contractId) {
      contractService.fulfillContract(state.contractId);
    }

    // Deliver any partial artifacts that were created before the failure
    const deliveredCount = this.deliverFilesToChat(state);

    // Update store
    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.FAILED,
      completedAt: Date.now(),
    });

    tbwoUpdateService.executionError(state.tbwoId, errorMessage);
    tbwoUpdateService.executionComplete(state.tbwoId, false);

    // Consequence Engine: record TBWO failure as negative outcome (fire-and-forget)
    try {
      const failedTBWOForConsequence = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const failedChatConvId = failedTBWOForConsequence?.chatConversationId;
      if (failedChatConvId) {
        import('../consequenceService').then(({ resolveRecentPrediction, recordOutcome }) => {
          resolveRecentPrediction(failedChatConvId, 'wrong', 'tbwo_completion', `TBWO ${state.tbwoId} failed: ${errorMessage.slice(0, 100)}`).catch(() => {});
          recordOutcome('tbwo_completion', 'wrong', {
            triggerSource: `TBWO ${state.tbwoId} failed`,
            domain: 'execution_strategy',
            severity: 'high',
            lessonLearned: `TBWO failed: ${errorMessage.slice(0, 200)}`,
            correctiveAction: `Review error: ${state.errors.slice(-1).map(e => e.error).join('; ').slice(0, 200)}`,
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch {}

    // Post failure to chat with partial deliverables
    let failMsg = `**Execution failed.**\n\n**Error:** ${errorMessage}`;
    if (deliveredCount > 0) {
      failMsg += `\n\n${deliveredCount} partial file${deliveredCount > 1 ? 's were' : ' was'} created before the failure and delivered above.`;
    }
    if (state.errors.length > 0) {
      failMsg += '\n\n**Error log:**';
      for (const err of state.errors.slice(-5)) {
        failMsg += `\n• [${err.phase}/${err.task}]: ${err.error}`;
      }
    }
    failMsg += '\n\nYou can review what was produced and retry or adjust the objective.';

    this.postToChat(state.tbwoId, [
      { type: 'text' as const, text: failMsg },
    ]);

    // Schedule workspace cleanup (shorter delay for failed runs)
    if (state.workspaceMode && state.workspaceId) {
      const wsId = state.workspaceId;
      setTimeout(async () => {
        try {
          await fetch(`${BACKEND_URL}/api/tbwo/${wsId}/workspace`, {
            method: 'DELETE',
            headers: this.getAuthHeaders(),
          });
        } catch {}
      }, 5 * 60 * 1000); // 5 minutes delay for failed runs
    }

    // Clean up internal state
    this.states.delete(state.tbwoId);
  }

  // ==========================================================================
  // FILE DELIVERY — In-Chat Attachments
  // ==========================================================================

  /**
   * Deliver all file artifacts as chat attachments.
   *
   * Posts a single message to the TBWO chat containing every file artifact
   * as a FileBlock (downloadable attachment) plus a code preview for text files.
   * This keeps deliverables inside ALIN — the user can preview, inspect, and
   * save them wherever they choose. No forced Desktop writes.
   *
   * Returns the number of files delivered.
   */
  private deliverFilesToChat(state: ExecutionState): number {
    // In workspace mode, files were already delivered as individual pills during execution
    if (state.workspaceMode) {
      return state.workspaceFiles.length;
    }

    // Collect file artifacts with real content
    const fileArtifacts: Artifact[] = [];
    for (const [, artifact] of state.artifacts) {
      if (typeof artifact.content === 'string' && artifact.content.length > 0) {
        fileArtifacts.push(artifact);
      }
    }

    if (fileArtifacts.length === 0) return 0;

    // Build a single delivery message with all files
    const content: ContentBlock[] = [];

    content.push({
      type: 'text' as const,
      text: `**Sprint deliverables — ${fileArtifacts.length} file${fileArtifacts.length > 1 ? 's' : ''}**`,
    });

    // MIME type map for file blocks
    const mimeMap: Record<string, string> = {
      html: 'text/html', css: 'text/css', js: 'application/javascript',
      ts: 'application/typescript', tsx: 'application/typescript',
      json: 'application/json', md: 'text/markdown', py: 'text/x-python',
      svg: 'image/svg+xml', xml: 'application/xml', yaml: 'text/yaml',
      yml: 'text/yaml', txt: 'text/plain',
    };

    for (const artifact of fileArtifacts) {
      const filePath = artifact.path || artifact.name;
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const contentStr = artifact.content as string;

      // Compute file size for the FileBlock
      const sizeBytes = new Blob([contentStr]).size;
      const mimeType = mimeMap[ext] || 'text/plain';

      // Create a data URL so the file can be downloaded directly from chat
      const dataUrl = `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(contentStr)))}`;

      // Post a FileBlock — the downloadable attachment. No inline code preview
      // to avoid clutter; users can view code in the Artifacts tab.
      content.push({
        type: 'file' as const,
        fileId: artifact.id,
        filename: filePath,
        mimeType,
        size: sizeBytes,
        url: dataUrl,
      } as ContentBlock);
    }

    this.postToChat(state.tbwoId, content, 'ALIN Sprint Delivery');
    return fileArtifacts.length;
  }

  // ==========================================================================
  // TIME TRACKING
  // ==========================================================================

  /**
   * Start a 10-second interval that updates the TBWO's elapsed time.
   */
  private startTimeTracking(tbwoId: string): void {
    // Clear any existing tracker
    this.stopTimeTracking(tbwoId);

    const tracker = setInterval(() => {
      const state = this.states.get(tbwoId);
      if (!state) {
        this.stopTimeTracking(tbwoId);
        return;
      }

      // Don't count time while paused
      if (state.status === 'paused' || state.status === 'checkpoint' || state.status === 'paused_waiting_for_user') {
        return;
      }

      const elapsedMs = Date.now() - state.startTime - state.totalPauseDuration;
      const elapsedMinutes = elapsedMs / 60_000;

      // Update the TBWO's time budget in the store
      const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
      if (tbwo) {
        useTBWOStore.getState().updateTBWO(tbwoId, {
          timeBudget: {
            ...tbwo.timeBudget,
            elapsed: elapsedMinutes,
            remaining: Math.max(0, (tbwo.timeBudget.total ?? 60) - elapsedMinutes),
          },
        });
      }
    }, TIME_TRACKING_INTERVAL_MS);

    this.timeTrackers.set(tbwoId, tracker);
  }

  /**
   * Stop the time tracking interval for a TBWO.
   */
  private stopTimeTracking(tbwoId: string): void {
    const tracker = this.timeTrackers.get(tbwoId);
    if (tracker) {
      clearInterval(tracker);
      this.timeTrackers.delete(tbwoId);
    }
  }

  // ==========================================================================
  // AUTH & UTILITY HELPERS
  // ==========================================================================

  /**
   * Build auth headers for all backend fetch calls.
   * Fixes the pre-existing bug where tool calls fail with 401 on authenticated servers.
   */
  private getAuthHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...useAuthStore.getState().getAuthHeader(),
    };
  }

  /**
   * Simple MIME type lookup by file extension.
   */
  private getMimeType(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      html: 'text/html', css: 'text/css', js: 'application/javascript',
      ts: 'application/typescript', tsx: 'application/typescript',
      json: 'application/json', md: 'text/markdown', py: 'text/x-python',
      svg: 'image/svg+xml', xml: 'application/xml', yaml: 'text/yaml',
      yml: 'text/yaml', txt: 'text/plain',
    };
    return mimeMap[ext] || 'text/plain';
  }

  /**
   * Post a FileBlock pill to the TBWO chat conversation for an individual file.
   */
  private postFileBlockToChat(tbwoId: string, file: {
    fileId: string;
    filename: string;
    mimeType: string;
    size: number;
    url: string;
  }): void {
    const token = useAuthStore.getState().token || '';
    const authedUrl = `${file.url}${file.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;

    this.postToChat(tbwoId, [
      { type: 'text' as const, text: `**File created:** \`${file.filename}\`` },
      {
        type: 'file' as const,
        fileId: file.fileId,
        filename: file.filename,
        mimeType: file.mimeType,
        size: file.size,
        url: authedUrl,
      } as ContentBlock,
    ]);
  }

  // ==========================================================================
  // TOOL EXECUTION
  // ==========================================================================

  /**
   * Execute a tool call by dispatching to the appropriate backend API endpoint.
   */
  private async handleToolCall(
    toolCall: { name: string; input: Record<string, unknown> },
    state: ExecutionState
  ): Promise<string> {
    const { name, input } = toolCall;

    try {
      switch (name) {
        case 'file_read': {
          if (state.workspaceMode && state.workspaceId) {
            let filePath = String(input['path'] || '');
            filePath = filePath.replace(/^output\/tbwo\/[^/]+\//, '');
            const resp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/read`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: filePath }),
            });
            if (resp.status === 404) {
              // List available files to help the pod find what it needs
              const availableFiles = Array.from(state.artifacts.values())
                .map(a => a.path || a.name || '')
                .filter(Boolean)
                .slice(0, 20);
              return `File not found: "${filePath}". This file has not been created yet. Available files: ${availableFiles.length > 0 ? availableFiles.join(', ') : 'none yet'}. Create the file with file_write first, or check the README.md for the project file manifest.`;
            }
            if (!resp.ok) throw new Error(`workspace file_read failed: ${resp.status}`);
            const data = await resp.json();
            return typeof data.content === 'string' ? data.content : JSON.stringify(data);
          }
          const resp = await fetch(`${BACKEND_URL}/api/files/read`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ path: input['path'] }),
          });
          if (resp.status === 404) {
            return `File not found: "${input['path']}". Create it with file_write first.`;
          }
          if (!resp.ok) throw new Error(`file_read failed: ${resp.status}`);
          const data = await resp.json();
          return typeof data.content === 'string' ? data.content : JSON.stringify(data);
        }

        case 'file_write': {
          let filePath = String(input['path'] || '');

          // Workspace mode: write to isolated temp dir, post FileBlock pill
          if (state.workspaceMode && state.workspaceId) {
            // Strip output/tbwo/<slug>/ prefix — workspace IS the output dir
            filePath = filePath.replace(/^output\/tbwo\/[^/]+\//, '');
            // Also strip bare output/ prefix
            filePath = filePath.replace(/^output\//, '');

            // ── Truth Guard pre-write scan (workspace mode) ──
            const wsContent = String(input['content'] || '');
            const wsExt = filePath.split('.').pop()?.toLowerCase() || '';
            if (['html', 'htm', 'md', 'txt'].includes(wsExt) && wsContent.length > 0) {
              const tbwo = useTBWOStore.getState().tbwos.get(state.tbwoId);
              const brief = (tbwo?.metadata?.siteBrief || tbwo?.metadata?.brief || null) as import('../../api/dbService').SiteBrief | null;
              const violations = scanFileForViolations(wsContent, filePath, brief, {});
              const critical = violations.filter(v => v.critical);
              if (critical.length > 0) {
                const listing = critical.slice(0, 8).map(v =>
                  `- [${v.type}] "${v.matchedText}" → ${v.suggestion}`
                ).join('\n');
                return `TRUTH GUARD VIOLATION — file "${filePath}" contains ${critical.length} fabricated claim(s):\n${listing}\n\nDO NOT include unverified statistics, dollar amounts, user counts, security certifications, testimonials, or trust signals unless the user explicitly provided them. Rewrite the content WITHOUT these claims and call file_write again.`;
              }
            }

            const resp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/write`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: filePath, content: input['content'] }),
            });
            if (!resp.ok) throw new Error(`workspace file_write failed: ${resp.status}`);
            const wsData = await resp.json();

            // Track file for zip delivery
            state.workspaceFiles.push({
              relativePath: wsData.path,
              size: wsData.size,
              downloadUrl: wsData.downloadUrl,
            });

            // Post FileBlock pill to chat immediately
            this.postFileBlockToChat(state.tbwoId, {
              fileId: nanoid(),
              filename: wsData.path,
              mimeType: this.getMimeType(wsData.path),
              size: wsData.size,
              url: wsData.downloadUrl,
            });

            return wsData.message || `File written to ${wsData.path}`;
          }

          // Strip any output/tbwo/ prefix if the pod included one — keep just the relative filename
          filePath = filePath.replace(/^output\/tbwo\/[^/]*\//, '').replace(/^output\//, '');
          (input as Record<string, unknown>)['path'] = filePath;

          // ── Truth Guard pre-write scan ──
          // Scan HTML/text content for fabricated claims BEFORE creating the artifact.
          // If critical violations found, return a warning instead of confirming the write.
          const fileContent = String(input['content'] || '');
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          if (['html', 'htm', 'md', 'txt'].includes(ext) && fileContent.length > 0) {
            const tbwo = useTBWOStore.getState().tbwos.get(state.tbwoId);
            const brief = (tbwo?.metadata?.siteBrief || tbwo?.metadata?.brief || null) as import('../../api/dbService').SiteBrief | null;
            const violations = scanFileForViolations(fileContent, filePath, brief, {});
            const critical = violations.filter(v => v.critical);
            if (critical.length > 0) {
              const listing = critical.slice(0, 8).map(v =>
                `- [${v.type}] "${v.matchedText}" → ${v.suggestion}`
              ).join('\n');
              return `TRUTH GUARD VIOLATION — file "${filePath}" contains ${critical.length} fabricated claim(s):\n${listing}\n\nDO NOT include unverified statistics, dollar amounts, user counts, security certifications, testimonials, or trust signals unless the user explicitly provided them. Rewrite the content WITHOUT these claims and call file_write again.`;
            }
          }

          // No filesystem write — content is stored in tbwo.artifacts[] (handled after tool loop)
          // and offered to the user as a ZIP download.
          return `Created artifact "${filePath}" — available in the project download.`;
        }

        case 'file_list': {
          if (state.workspaceMode && state.workspaceId) {
            const resp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/list`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: input['path'] || '.' }),
            });
            if (!resp.ok) throw new Error(`workspace file_list failed: ${resp.status}`);
            const data = await resp.json();
            return JSON.stringify(data.files || data, null, 2);
          }
          const resp = await fetch(`${BACKEND_URL}/api/files/list`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ path: input['path'] || '.' }),
          });
          if (!resp.ok) throw new Error(`file_list failed: ${resp.status}`);
          const data = await resp.json();
          return JSON.stringify(data.files || data, null, 2);
        }

        case 'scan_directory': {
          const resp = await fetch(`${BACKEND_URL}/api/files/scan`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ path: input['path'] || '.', depth: input['depth'] || 3 }),
          });
          if (!resp.ok) throw new Error(`scan_directory failed: ${resp.status}`);
          const data = await resp.json();
          return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        }

        case 'code_search': {
          const resp = await fetch(`${BACKEND_URL}/api/files/search`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              pattern: input['query'] || input['pattern'],
              path: input['path'] || '.',
              fileType: input['file_type'],
            }),
          });
          if (!resp.ok) throw new Error(`code_search failed: ${resp.status}`);
          const data = await resp.json();
          return JSON.stringify(data.results || data, null, 2);
        }

        case 'execute_code': {
          const resp = await fetch(`${BACKEND_URL}/api/code/execute`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              language: input['language'] || 'javascript',
              code: input['code'],
            }),
          });
          if (!resp.ok) throw new Error(`execute_code failed: ${resp.status}`);
          const data = await resp.json();
          return data.output || data.result || JSON.stringify(data);
        }

        case 'run_command': {
          const resp = await fetch(`${BACKEND_URL}/api/command/execute`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              command: input['command'],
              cwd: input['cwd'] || input['working_directory'],
            }),
          });
          if (!resp.ok) throw new Error(`run_command failed: ${resp.status}`);
          const data = await resp.json();
          return data.output || data.stdout || JSON.stringify(data);
        }

        case 'git': {
          const resp = await fetch(`${BACKEND_URL}/api/git/execute`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              command: input['command'],
              args: input['args'],
              cwd: input['cwd'],
            }),
          });
          if (!resp.ok) throw new Error(`git failed: ${resp.status}`);
          const data = await resp.json();
          return data.output || JSON.stringify(data);
        }

        case 'edit_file': {
          if (state.workspaceMode && state.workspaceId) {
            // Read → apply str_replace in-memory → write back
            let filePath = String(input['path'] || '');
            filePath = filePath.replace(/^output\/tbwo\/[^/]+\//, '').replace(/^output\//, '');

            const readResp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/read`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: filePath }),
            });
            if (!readResp.ok) throw new Error(`workspace edit_file read failed: ${readResp.status}`);
            const readData = await readResp.json();
            let content = readData.content as string;

            const oldStr = String(input['old_text'] || input['old_str'] || '');
            const newStr = String(input['new_text'] || input['new_str'] || '');
            if (!content.includes(oldStr)) {
              return `Error: old_str not found in ${filePath}`;
            }
            content = content.replace(oldStr, newStr);

            const writeResp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/write`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: filePath, content }),
            });
            if (!writeResp.ok) throw new Error(`workspace edit_file write failed: ${writeResp.status}`);
            return `File edited: ${filePath}`;
          }
          const resp = await fetch(`${BACKEND_URL}/api/editor/execute`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              command: 'str_replace',
              path: input['path'],
              old_str: input['old_text'] || input['old_str'],
              new_str: input['new_text'] || input['new_str'],
            }),
          });
          if (!resp.ok) throw new Error(`edit_file failed: ${resp.status}`);
          const data = await resp.json();
          return data.message || `File edited: ${input['path']}`;
        }

        case 'web_search': {
          const resp = await fetch(`${BACKEND_URL}/api/search`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ query: input['query'] }),
          });
          if (!resp.ok) throw new Error(`web_search failed: ${resp.status}`);
          const data = await resp.json();
          return JSON.stringify(data.results || data, null, 2);
        }

        case 'web_fetch': {
          const fetchUrl = input['url'] as string;
          try {
            const resp = await fetch(`${BACKEND_URL}/api/web/fetch`, {
              method: 'POST',
              headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: fetchUrl }),
            });
            const data = await resp.json();
            return data.success ? (data.content as string).slice(0, 15_000) : `Error: ${data.error}`;
          } catch (e: any) {
            return `Error fetching URL: ${e.message}`;
          }
        }

        case 'search_images': {
          const query = input['query'] as string;
          const count = (input['count'] as number) || 5;
          const orientation = input['orientation'] as string;
          try {
            const resp = await fetch(`${BACKEND_URL}/api/images/search`, {
              method: 'POST',
              headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ query, count, orientation }),
            });
            const data = await resp.json();
            return JSON.stringify(data.images || [], null, 2);
          } catch (e: any) {
            return `Error searching images: ${e.message}`;
          }
        }

        case 'site_validate': {
          // Run PageSpec-aware site validation
          try {
            const { validateAgainstPageSpec } = await import('../../products/sites/sitesValidation');
            // Collect HTML artifacts
            const htmlArtifacts = new Map<string, string>();
            for (const [_id, art] of state.artifacts) {
              if (art.path && typeof art.content === 'string') {
                htmlArtifacts.set(art.path, art.content);
              }
            }
            // Try to find pageSpec.json
            let pageSpec = null;
            for (const [_id, art] of state.artifacts) {
              if (art.path?.endsWith('pageSpec.json') || art.name === 'pageSpec.json') {
                try {
                  pageSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content;
                } catch { /* ignore parse errors */ }
              }
            }
            if (pageSpec) {
              const report = validateAgainstPageSpec(htmlArtifacts, pageSpec);
              // Store as artifact
              const reportArt: Artifact = {
                id: nanoid(),
                tbwoId: state.tbwoId,
                name: 'validationReport.json',
                type: ArtifactType.DATA,
                content: JSON.stringify(report, null, 2),
                path: 'validationReport.json',
                createdBy: 'system',
                createdAt: Date.now(),
                version: 1,
                status: 'final',
              };
              state.artifacts.set(reportArt.id, reportArt);
              useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
              return JSON.stringify(report, null, 2);
            } else {
              // Fallback: basic validation without PageSpec
              const { scanForPlaceholders } = await import('../../products/sites/sitesValidation');
              const scan = scanForPlaceholders(htmlArtifacts);
              return JSON.stringify({
                passed: !scan.found,
                score: scan.found ? 50 : 100,
                issues: scan.locations.map(l => ({
                  severity: 'error',
                  file: l.file,
                  rule: 'PLACEHOLDER_TEXT',
                  message: `Found "${l.marker}" in ${l.context}`,
                })),
                summary: scan.found
                  ? `Found ${scan.locations.length} placeholder(s) in critical sections`
                  : 'No placeholders found. Basic validation passed.',
              }, null, 2);
            }
          } catch (e: any) {
            return `Error running site validation: ${e.message}`;
          }
        }

        case 'conversion_audit': {
          try {
            const { runConversionAudit } = await import('../../products/sites/conversionAudit');
            const htmlArtifacts = new Map<string, string>();
            let pageSpec = null;
            for (const [_id, art] of state.artifacts) {
              if (art.path && typeof art.content === 'string') {
                htmlArtifacts.set(art.path, art.content);
              }
              if (art.path?.endsWith('pageSpec.json') || art.name === 'pageSpec.json') {
                try { pageSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content; } catch { /* ignore */ }
              }
            }
            const result = runConversionAudit(htmlArtifacts, pageSpec);
            const reportArt: Artifact = {
              id: nanoid(), tbwoId: state.tbwoId, name: 'conversionAudit.json',
              type: ArtifactType.DATA, content: JSON.stringify(result, null, 2),
              path: 'conversionAudit.json', createdBy: 'system', createdAt: Date.now(),
              version: 1, status: 'final',
            };
            state.artifacts.set(reportArt.id, reportArt);
            useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
            return JSON.stringify(result, null, 2);
          } catch (e: any) {
            return `Error running conversion audit: ${e.message}`;
          }
        }

        case 'site_improve': {
          try {
            const { runFullSiteAudit } = await import('../../products/sites/siteOptimizer');
            const htmlArtifacts = new Map<string, string>();
            let pageSpec = null;
            for (const [_id, art] of state.artifacts) {
              if (art.path && typeof art.content === 'string') {
                htmlArtifacts.set(art.path, art.content);
              }
              if (art.path?.endsWith('pageSpec.json') || art.name === 'pageSpec.json') {
                try { pageSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content; } catch { /* ignore */ }
              }
            }
            const report = runFullSiteAudit(htmlArtifacts, pageSpec, state.tbwoId);
            const reportArt: Artifact = {
              id: nanoid(), tbwoId: state.tbwoId, name: 'siteImprovementReport.json',
              type: ArtifactType.DATA, content: JSON.stringify(report, null, 2),
              path: 'siteImprovementReport.json', createdBy: 'system', createdAt: Date.now(),
              version: 1, status: 'final',
            };
            state.artifacts.set(reportArt.id, reportArt);
            useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
            return JSON.stringify(report, null, 2);
          } catch (e: any) {
            return `Error running site improvement audit: ${e.message}`;
          }
        }

        case 'motion_validate': {
          try {
            const { validateMotion } = await import('../../products/sites/motion/motionValidation');
            const motionArtifacts = new Map<string, string>();
            let motionSpec = null;
            for (const [_id, art] of state.artifacts) {
              if (art.path && typeof art.content === 'string') {
                motionArtifacts.set(art.path, art.content);
              }
              if (art.path === 'motionSpec.json' || art.name === 'motionSpec.json') {
                try { motionSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content; } catch { /* ignore */ }
              }
            }
            const result = validateMotion(motionArtifacts, motionSpec);
            const reportArt: Artifact = {
              id: nanoid(), tbwoId: state.tbwoId, name: 'motionValidation.json',
              type: ArtifactType.DATA, content: JSON.stringify(result, null, 2),
              path: 'motionValidation.json', createdBy: 'system', createdAt: Date.now(),
              version: 1, status: 'final',
            };
            state.artifacts.set(reportArt.id, reportArt);
            useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
            return JSON.stringify(result, null, 2);
          } catch (e: any) {
            return `Error running motion validation: ${e.message}`;
          }
        }

        case 'scene_validate': {
          try {
            const { validateScene } = await import('../../products/sites/3d/sceneValidation');
            const sceneArtifacts = new Map<string, string>();
            let sceneSpec = null;
            for (const [_id, art] of state.artifacts) {
              if (art.path && typeof art.content === 'string') {
                sceneArtifacts.set(art.path, art.content);
              }
              if (art.path === 'sceneSpec.json' || art.name === 'sceneSpec.json') {
                try { sceneSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content; } catch { /* ignore */ }
              }
            }
            const result = validateScene(sceneArtifacts, sceneSpec);
            const reportArt: Artifact = {
              id: nanoid(), tbwoId: state.tbwoId, name: 'sceneValidation.json',
              type: ArtifactType.DATA, content: JSON.stringify(result, null, 2),
              path: 'sceneValidation.json', createdBy: 'system', createdAt: Date.now(),
              version: 1, status: 'final',
            };
            state.artifacts.set(reportArt.id, reportArt);
            useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
            return JSON.stringify(result, null, 2);
          } catch (e: any) {
            return `Error running scene validation: ${e.message}`;
          }
        }

        case 'output_guard': {
          try {
            const { scanForGenericContent } = await import('../../products/sites/cognitive/outputGuard');
            const htmlArtifacts = new Map<string, string>();
            for (const [_id, art] of state.artifacts) {
              if (art.path && typeof art.content === 'string') {
                htmlArtifacts.set(art.path, art.content);
              }
            }
            // Get SiteBrief from TBWO metadata
            const tbwoData = useTBWOStore.getState().getTBWOById(state.tbwoId);
            const brief = tbwoData?.metadata?.siteBrief as any || { productName: '' };
            const violations = scanForGenericContent(htmlArtifacts, brief);
            const report = {
              violations,
              total: violations.length,
              passed: violations.length === 0,
              summary: violations.length === 0
                ? 'Output guard passed. No generic content found.'
                : `Output guard: ${violations.length} generic content violation(s) found.`,
            };
            const reportArt: Artifact = {
              id: nanoid(), tbwoId: state.tbwoId, name: 'outputGuardReport.json',
              type: ArtifactType.DATA, content: JSON.stringify(report, null, 2),
              path: 'outputGuardReport.json', createdBy: 'system', createdAt: Date.now(),
              version: 1, status: 'final',
            };
            state.artifacts.set(reportArt.id, reportArt);
            useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
            return JSON.stringify(report, null, 2);
          } catch (e: any) {
            return `Error running output guard: ${e.message}`;
          }
        }

        case 'generate_image': {
          const prompt = input['prompt'] as string;
          try {
            const resp = await fetch(`${BACKEND_URL}/api/images/generate`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({
                prompt,
                size: input['size'] || '1024x1024',
                quality: input['quality'] || 'standard',
                style: input['style'] || 'natural',
              }),
            });
            const data = await resp.json();
            return data.success
              ? JSON.stringify({ url: data.url, revised_prompt: data.revised_prompt })
              : `Error: ${data.error}`;
          } catch (e: any) {
            return `Error generating image: ${e.message}`;
          }
        }

        case 'memory_store': {
          const resp = await fetch(`${BACKEND_URL}/api/memory/store`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              key: input['key'],
              content: input['content'],
              category: input['category'],
            }),
          });
          if (!resp.ok) throw new Error(`memory_store failed: ${resp.status}`);
          const data = await resp.json();
          return data.message || 'Memory stored';
        }

        case 'memory_recall': {
          const resp = await fetch(`${BACKEND_URL}/api/memory/recall`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              query: input['query'],
              category: input['category'],
            }),
          });
          if (!resp.ok) throw new Error(`memory_recall failed: ${resp.status}`);
          const data = await resp.json();
          return JSON.stringify(data.memories || data, null, 2);
        }

        case 'system_status': {
          return JSON.stringify({
            tbwoId: state.tbwoId,
            activePods: state.activePods.size,
            artifacts: state.artifacts.size,
            errors: state.errors.length,
            status: state.status,
          }, null, 2);
        }

        case 'gpu_compute': {
          const resp = await fetch(`${BACKEND_URL}/api/hardware/gpu-compute`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              script: input['script'],
              framework: input['framework'] || 'python',
              timeout: input['timeout'] || 120000,
            }),
          });
          if (!resp.ok) throw new Error(`gpu_compute failed: ${resp.status}`);
          const data = await resp.json();
          return data.stdout || data.error || 'GPU compute completed';
        }

        case 'blender_execute': {
          const resp = await fetch(`${BACKEND_URL}/api/blender/execute`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              script: input['script'],
              // Optional: start from an existing .blend
              blendFile: input['blendFile'],
              // Optional: where to save outputs (base path, no extension required)
              outputPath: input['outputPath'],
              // Optional: output image format (PNG/JPEG/OPEN_EXR/etc)
              outputFormat: input['outputFormat'] || input['format'] || 'PNG',
              // Optional: if true, server will attempt a still render if the script didn't
              autoRender: input['autoRender'] || false,
              // Optional: render engine
              engine: input['engine'] || 'CYCLES',
              // Optional: frame number (mostly for animations, still uses 1)
              frame: input['frame'] || 1,
              timeout: input['timeout'] || 120000,
            }),
          });
          if (!resp.ok) throw new Error(`blender_execute failed: ${resp.status}`);
          const data = await resp.json();

          // Normalize + return a structured payload (UI can choose to render image)
          const payload = {
            success: !!data.success,
            duration: data.duration,
            info: data.info,
            renderFormat: data.renderFormat,
            renderImage: data.renderImage, // base64 if present
            outputPath: data.outputPath,
            output: data.output ?? data.stdout ?? null,
            error: data.error ?? null,
          };

          return JSON.stringify(payload, null, 2);
        }

        case 'blender_render': {
          const resp = await fetch(`${BACKEND_URL}/api/blender/render`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              blendFile: input['blendFile'],
              frame: input['frame'] || 1,
              engine: input['engine'] || 'CYCLES',
              // accept both naming conventions; server will normalize
              outputFormat: input['outputFormat'] || input['format'] || 'PNG',
              // Optional: where to save render output base path
              outputPath: input['outputPath'],
            }),
          });
          if (!resp.ok) throw new Error(`blender_render failed: ${resp.status}`);
          const data = await resp.json();

          const payload = {
            success: !!data.success,
            duration: data.duration,
            renderFormat: data.renderFormat,
            renderImage: data.renderImage,
            outputPath: data.outputPath,
            output: data.output ?? null,
            error: data.error ?? null,
          };

          return JSON.stringify(payload, null, 2);
        }


        default: {
          return `Unknown tool: ${name}. Available tools: file_read, file_write, file_list, scan_directory, code_search, execute_code, run_command, git, edit_file, web_search, generate_image, memory_store, memory_recall, system_status, gpu_compute, blender_execute, blender_render, web_fetch, search_images, site_validate`;
        }
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ExecutionEngine] Tool "${name}" failed:`, errMsg);
      return `Error executing ${name}: ${errMsg}`;
    }
  }

  // ==========================================================================
  // CLARIFICATION HANDLING
  // ==========================================================================

  /**
   * Handle a clarification request from a pod.
   * Routes to auto-answer (AUTONOMOUS/SUPERVISED) or user answer (GUIDED/NO_AUTONOMY).
   */
  private async handleClarification(
    state: ExecutionState,
    task: Task,
    pod: AgentPod,
    input: Record<string, unknown>
  ): Promise<string> {
    const question = String(input['question'] || 'No question provided');
    const context = String(input['context'] || '');
    const options = Array.isArray(input['options']) ? (input['options'] as string[]) : [];

    const clarificationId = nanoid();
    state.pendingClarifications.set(clarificationId, {
      taskId: task.id,
      podId: pod.id,
      question,
      timestamp: Date.now(),
    });

    // Broadcast clarification request to other pods for awareness
    state.messageBus.broadcast(pod.id, 'clarification_request', {
      clarificationId,
      question,
      context,
      options,
      taskName: task.name,
    }, 'high');

    this.appendPodLog(pod.id, `Clarification requested: ${question}`);

    // Route based on authority level
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    const authority = tbwo?.authorityLevel || AuthorityLevel.SUPERVISED;
    let answer: string;

    if (authority === AuthorityLevel.AUTONOMOUS || authority === AuthorityLevel.SUPERVISED) {
      answer = await this.autoAnswerClarification(state, task, pod, question, context, options);
    } else {
      // GUIDED or NO_AUTONOMY — ask the user
      answer = await this.waitForUserClarification(state, task, pod, question, context, options);
    }

    // Clean up
    state.pendingClarifications.delete(clarificationId);
    this.appendPodLog(pod.id, `Clarification resolved: ${answer.slice(0, 100)}`);

    return answer;
  }

  /**
   * Auto-answer a clarification using a separate AI call.
   * Used when authority is AUTONOMOUS or SUPERVISED.
   */
  /**
   * Lazy-created lightweight AIService for clarification auto-answers.
   * Uses Haiku (fast, cheap) instead of the pod's main model.
   */
  private clarificationAIService: AIService | null = null;

  private getClarificationAIService(): AIService {
    if (!this.clarificationAIService) {
      this.clarificationAIService = new AIService({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001', // Fast model for quick decisions
        temperature: 0.3, // Lower temperature for decisive answers
        maxTokens: 1024,
        systemPrompt: 'You are a fast decision-making assistant. Give clear, concise answers. Never ask follow-up questions. Pick the best option and explain briefly.',
      });
    }
    return this.clarificationAIService;
  }

  private async autoAnswerClarification(
    state: ExecutionState,
    task: Task,
    pod: AgentPod,
    question: string,
    context: string,
    options: string[]
  ): Promise<string> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);

    // Build a focused prompt for the clarification — include brief context so Haiku can make informed decisions
    const artifactNames = Array.from(state.artifacts.values()).map(a => a.name).slice(0, 20);
    const siteBrief = tbwo?.metadata?.siteBrief as Record<string, unknown> | undefined;
    const sprintConfig = tbwo?.metadata?.sprintConfig as Record<string, unknown> | undefined;
    const briefContext = siteBrief ? [
      siteBrief.productName ? `Product: ${siteBrief.productName}` : '',
      siteBrief.tagline ? `Tagline: ${siteBrief.tagline}` : '',
      siteBrief.targetAudience ? `Audience: ${siteBrief.targetAudience}` : '',
      siteBrief.toneStyle ? `Tone: ${siteBrief.toneStyle}` : '',
      sprintConfig?.colorScheme ? `Colors: ${JSON.stringify(sprintConfig.colorScheme)}` : '',
    ].filter(Boolean).join(', ') : '';

    const prompt = [
      `You are making a quick design/implementation decision for an AI-powered website builder. Act like a senior designer/developer who makes confident choices.`,
      ``,
      `**Objective:** ${tbwo?.objective || 'Unknown'}`,
      briefContext ? `**Brief:** ${briefContext}` : '',
      `**Task:** ${task.name}${task.description ? ` — ${task.description}` : ''}`,
      `**Pod:** ${pod.role}`,
      ``,
      `**Question:** ${question}`,
      context ? `**Context:** ${context}` : '',
      options.length > 0 ? `**Options:**\n${options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}` : '',
      ``,
      `Make a decisive choice. Use the brief context to inform your answer. Be concise (1-2 sentences). Never ask follow-up questions — just decide.`,
    ].filter(Boolean).join('\n');

    try {
      // Use lightweight Haiku model for fast, cheap clarification answers
      const fastAI = this.getClarificationAIService();
      const response = await fastAI.sendMessage(prompt);
      const answer = response.text || 'No answer generated. Proceed with your best judgment.';

      // Post the auto-decision to chat for transparency
      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `**${pod.name}** needed clarification and auto-resolved (via Haiku):\n\n> **Q:** ${question}\n${options.length > 0 ? `> Options: ${options.join(', ')}\n` : ''}> **Decision:** ${answer.slice(0, 500)}` },
      ], pod.name);

      // Record decision in self-model (fire-and-forget)
      import('../selfModelService').then(sm => {
        sm.onAutoDecision(
          state.tbwoId,
          'clarification',
          options,
          answer.slice(0, 200),
          `Pod ${pod.name} asked: ${question}`,
          0.7,
        ).catch(() => {});
      }).catch(() => {});

      console.log(`[ExecutionEngine] Auto-answered clarification for ${pod.name} via Haiku: ${answer.slice(0, 100)}`);
      return answer;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ExecutionEngine] Auto-answer failed:`, errMsg);
      return `Auto-answer failed (${errMsg}). Proceed with the most conservative approach.`;
    }
  }

  /**
   * Wait for user to answer a clarification via the TBWO chat.
   * Used when authority is GUIDED or NO_AUTONOMY.
   * Other pods continue executing while this one waits.
   */
  private async waitForUserClarification(
    state: ExecutionState,
    task: Task,
    pod: AgentPod,
    question: string,
    context: string,
    options: string[]
  ): Promise<string> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);

    // Post the question to the TBWO chat for the user to see
    let questionMsg = `**${pod.name}** needs your input to continue:\n\n`;
    questionMsg += `**Task:** ${task.name}\n`;
    questionMsg += `**Question:** ${question}\n`;
    if (context) questionMsg += `**Context:** ${context}\n`;
    if (options.length > 0) {
      questionMsg += `\n**Options:**\n`;
      options.forEach((o, i) => { questionMsg += `${i + 1}. ${o}\n`; });
    }
    questionMsg += `\n*Other pods continue working while waiting for your response. Reply in this chat to answer.*`;

    this.postToChat(state.tbwoId, [
      { type: 'text' as const, text: questionMsg },
    ], pod.name);

    // Record timestamp to find user reply
    const questionTimestamp = Date.now();

    // Poll for user response in the TBWO chat conversation
    const pollInterval = 2000;
    const maxWait = 30 * 60 * 1000; // 30 minutes
    const startWait = Date.now();

    while (Date.now() - startWait < maxWait) {
      // Check for cancellation
      if (state.status === 'cancelled' || state.status === 'failed') {
        return 'Execution was cancelled. Stopping.';
      }

      const convId = tbwo?.chatConversationId;
      if (convId) {
        const conversation = useChatStore.getState().getConversationById(convId);
        if (conversation?.messages) {
          // Find user messages posted after our question
          const userReplies = conversation.messages.filter(
            m => m.role === MessageRole.USER && m.timestamp && m.timestamp > questionTimestamp
          );

          if (userReplies.length > 0) {
            const reply = userReplies[0]!;
            const replyText = reply.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n') || 'No text in reply';

            // Post acknowledgment
            this.postToChat(state.tbwoId, [
              { type: 'text' as const, text: `**${pod.name}** received your answer and is continuing work.` },
            ], pod.name);

            return replyText;
          }
        }
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout — fall back to auto-answer
    console.warn(`[ExecutionEngine] Clarification timeout for ${pod.name}. Falling back to auto-answer.`);
    this.postToChat(state.tbwoId, [
      { type: 'text' as const, text: `**${pod.name}** timed out waiting for your response (30 min). Auto-resolving the question.` },
    ], pod.name);

    return this.autoAnswerClarification(state, task, pod, question, context, options);
  }

  // ==========================================================================
  // PAUSE-AND-ASK HANDLING
  // ==========================================================================

  /**
   * Handle a request_pause_and_ask tool call.
   * This is a HARD PAUSE — stops ALL pods until the user responds.
   *
   * Flow:
   * 1. Create a PauseRequest and store it on the TBWO
   * 2. Set execution state to paused_waiting_for_user
   * 3. Post the question to the TBWO chat
   * 4. Wait for user response (poll the store)
   * 5. Optionally infer structured values from vague answers
   * 6. Resume execution with the resolved answer
   */
  private async handlePauseAndAsk(
    state: ExecutionState,
    task: Task,
    pod: AgentPod,
    input: Record<string, unknown>
  ): Promise<string> {
    const pauseId = nanoid();
    const reason = (input['reason'] as string) || 'MISSING_CRITICAL_FACT';
    const question = String(input['question'] || 'No question provided');
    const contextPath = String(input['context_path'] || '');
    const requiredFields = Array.isArray(input['required_fields']) ? (input['required_fields'] as string[]) : undefined;
    const canInfer = input['can_infer_from_vague_answer'] === true;

    // Build the PauseRequest
    const pauseRequest: PauseRequest = {
      id: pauseId,
      tbwoId: state.tbwoId,
      podId: pod.id,
      phase: state.currentPhaseIndex.toString(),
      contextPath,
      reason: reason as PauseReason,
      question,
      requiredFields,
      canInferFromVagueAnswer: canInfer,
      resumeCheckpointId: `checkpoint-${pauseId}`,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Store the pause request on the TBWO
    state.pendingPauseRequest = pauseRequest;
    useTBWOStore.getState().addPauseRequest(state.tbwoId, pauseRequest);

    // HARD PAUSE — update both engine state and store status
    state.status = 'paused_waiting_for_user';
    state.pausedAt = Date.now();

    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.PAUSED_WAITING_FOR_USER,
      activePauseId: pauseId,
    });

    this.appendPodLog(pod.id, `PAUSE: ${reason} — "${question}"`);
    tbwoUpdateService.progressUpdate(state.tbwoId, -1, `Paused: waiting for user input`);

    // Post the question to the TBWO chat
    let pauseMsg = `**Execution paused — your input is needed**\n\n`;
    pauseMsg += `**Pod:** ${pod.name} (${pod.role})\n`;
    pauseMsg += `**Task:** ${task.name}\n`;
    pauseMsg += `**Reason:** ${this.formatPauseReason(reason)}\n`;
    pauseMsg += `**Context:** ${contextPath}\n\n`;
    pauseMsg += `**Question:** ${question}\n`;
    if (requiredFields && requiredFields.length > 0) {
      pauseMsg += `\n**Information needed:** ${requiredFields.join(', ')}\n`;
    }
    pauseMsg += `\n*All pods are stopped. Reply in this chat to continue execution.*`;

    this.postToChat(state.tbwoId, [
      { type: 'text' as const, text: pauseMsg },
    ], pod.name);

    // Wait for the user to respond
    const resolution = await this.waitForPauseResolution(state, pauseRequest);

    // Resume execution
    if (state.pausedAt) {
      state.totalPauseDuration += Date.now() - state.pausedAt;
      state.pausedAt = null;
    }
    state.status = 'executing';
    state.pendingPauseRequest = null;

    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.EXECUTING,
      activePauseId: undefined,
    });

    this.appendPodLog(pod.id, `RESUME: pause resolved — "${resolution.slice(0, 100)}"`);

    return resolution;
  }

  /**
   * Wait for the user to respond to a pause request.
   * Polls the TBWO chat for user messages or checks the store for submitted responses.
   * If canInferFromVagueAnswer is true, uses AI to derive structured values from vague text.
   */
  private async waitForPauseResolution(
    state: ExecutionState,
    pauseRequest: PauseRequest
  ): Promise<string> {
    const pollInterval = 2000;
    const maxWait = 60 * 60 * 1000; // 1 hour
    const startWait = Date.now();
    const questionTimestamp = pauseRequest.createdAt;

    while (Date.now() - startWait < maxWait) {
      // Check for cancellation
      if (state.status === 'cancelled' || state.status === 'failed') {
        return 'Execution was cancelled.';
      }

      // Check if the pause was resolved via the store (submitPauseResponse action)
      const freshTBWO = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const freshPause = freshTBWO?.pauseRequests?.find(pr => pr.id === pauseRequest.id);
      if (freshPause && freshPause.status !== 'pending') {
        // Pause was resolved (answered, inferred, or skipped)
        let result = freshPause.userResponse || '';

        if (freshPause.status === 'inferred' && freshPause.inferredValues) {
          result += `\n\n[Inferred values: ${JSON.stringify(freshPause.inferredValues)}]`;
        }

        // Post acknowledgment
        this.postToChat(state.tbwoId, [
          { type: 'text' as const, text: `**Execution resuming** — answer received.\n${freshPause.contentTag ? `Content tagged as: \`${freshPause.contentTag}\`` : ''}` },
        ]);

        return result || 'User skipped this question. Use your best judgment.';
      }

      // Also check for user messages in the TBWO chat (direct reply)
      const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
      const convId = tbwo?.chatConversationId;
      if (convId) {
        const conversation = useChatStore.getState().getConversationById(convId);
        if (conversation?.messages) {
          const userReplies = conversation.messages.filter(
            m => m.role === MessageRole.USER && m.timestamp && m.timestamp > questionTimestamp
          );

          if (userReplies.length > 0) {
            const reply = userReplies[0]!;
            const replyText = reply.content
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map(b => b.text)
              .join('\n') || '';

            if (replyText.trim()) {
              // User replied via chat — process the response
              let contentTag = ContentTag.USER_PROVIDED;
              let inferredValues: Record<string, unknown> | undefined;

              // If canInferFromVagueAnswer, try to extract structured values
              if (pauseRequest.canInferFromVagueAnswer && pauseRequest.requiredFields && pauseRequest.requiredFields.length > 0) {
                try {
                  const inferred = await this.inferFromVagueAnswer(
                    replyText,
                    pauseRequest.question,
                    pauseRequest.requiredFields,
                    pauseRequest.contextPath
                  );
                  if (inferred) {
                    inferredValues = inferred;
                    contentTag = ContentTag.INFERRED;
                  }
                } catch {
                  // Inference failed — use raw response
                }
              }

              // Update the pause request in the store
              useTBWOStore.getState().resolvePauseRequest(state.tbwoId, pauseRequest.id, {
                userResponse: replyText,
                inferredValues,
                contentTag,
                status: inferredValues ? 'inferred' : 'answered',
              });

              // Post acknowledgment
              this.postToChat(state.tbwoId, [
                { type: 'text' as const, text: `**Execution resuming** — answer received.\nContent tagged as: \`${contentTag}\`${inferredValues ? `\nInferred: ${JSON.stringify(inferredValues)}` : ''}` },
              ]);

              let result = replyText;
              if (inferredValues) {
                result += `\n\n[Inferred structured values: ${JSON.stringify(inferredValues)}]`;
              }
              return result;
            }
          }
        }
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    // Timeout — mark as placeholder and resume
    useTBWOStore.getState().resolvePauseRequest(state.tbwoId, pauseRequest.id, {
      userResponse: undefined,
      contentTag: ContentTag.PLACEHOLDER,
      status: 'skipped',
    });

    this.postToChat(state.tbwoId, [
      { type: 'text' as const, text: `**Pause timed out** (1 hour). Content for "${pauseRequest.contextPath}" will be tagged as \`PLACEHOLDER\`. You can update it later.` },
    ]);

    return `No response received (timed out). Use PLACEHOLDER content for "${pauseRequest.contextPath}". Tag this content as PLACEHOLDER — it must be resolved before deployment.`;
  }

  /**
   * Use AI to infer structured values from a vague user response.
   * E.g., user says "keep it simple, around 10 bucks" → { price: 10, currency: "USD", interval: "month" }
   */
  private async inferFromVagueAnswer(
    userResponse: string,
    originalQuestion: string,
    requiredFields: string[],
    contextPath: string
  ): Promise<Record<string, unknown> | null> {
    const fastAI = this.getClarificationAIService();

    const prompt = [
      `Extract structured data from a user's vague answer.`,
      ``,
      `**Original question:** ${originalQuestion}`,
      `**Context:** ${contextPath}`,
      `**Required fields:** ${requiredFields.join(', ')}`,
      `**User's response:** "${userResponse}"`,
      ``,
      `Return ONLY a valid JSON object with the required fields extracted from the user's response.`,
      `If a field cannot be inferred, set it to null.`,
      `Do NOT include any explanation — just the JSON object.`,
      ``,
      `Example: {"price": 10, "currency": "USD", "interval": "month"}`,
    ].join('\n');

    try {
      const response = await fastAI.sendMessage(prompt);
      const text = response.text || '';

      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed;
        }
      }
    } catch {
      // Inference failed
    }

    return null;
  }

  /**
   * Format a PauseReason enum value into a human-readable string.
   */
  private formatPauseReason(reason: string): string {
    switch (reason) {
      case 'MISSING_CRITICAL_FACT': return 'Missing critical information';
      case 'UNCERTAIN_CONTENT': return 'Low confidence in generated content';
      case 'REQUIRES_USER_PREFERENCE': return 'User preference needed';
      case 'EXTERNAL_DEPENDENCY': return 'External dependency required';
      default: return reason;
    }
  }

  // ==========================================================================
  // POD LOGGING
  // ==========================================================================

  /**
   * Append a log entry to a pod's messageLog in the store.
   */
  private appendPodLog(podId: string, content: string): void {
    try {
      // Append to podPoolStore runtime log (single source of truth)
      usePodPoolStore.getState().appendPodLog(podId, content);
    } catch {
      // Non-critical: don't let logging failures break execution
    }
  }

  // ==========================================================================
  // TBWO CHAT POSTING
  // ==========================================================================

  /**
   * Create a streaming assistant message in the TBWO chat and return its ID.
   * The message starts empty and is updated via updateStreamingMessage().
   */
  private createStreamingMessage(tbwoId: string, model?: string): string | null {
    try {
      const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
      if (!tbwo) return null;

      let convId = tbwo.chatConversationId;
      if (!convId) {
        convId = useChatStore.getState().createConversation({
          title: `TBWO: ${tbwo.objective.slice(0, 50)}`,
        });
        useTBWOStore.getState().updateTBWO(tbwoId, { chatConversationId: convId });
      }

      const msgId = useChatStore.getState().addMessage(convId, {
        role: MessageRole.ASSISTANT,
        content: [{ type: 'text' as const, text: '' }],
        model: model || 'ALIN',
        isStreaming: true,
      });

      return msgId;
    } catch {
      return null;
    }
  }

  /**
   * Update a streaming message's content with accumulated text.
   */
  private updateStreamingMessage(msgId: string, text: string, extraBlocks?: ContentBlock[]): void {
    try {
      const blocks: ContentBlock[] = [];
      if (text) {
        blocks.push({ type: 'text' as const, text });
      }
      if (extraBlocks) {
        blocks.push(...extraBlocks);
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text' as const, text: '' });
      }
      useChatStore.getState().updateMessage(msgId, {
        content: blocks,
        isStreaming: true,
      });
    } catch {
      // Non-critical
    }
  }

  /**
   * Finalize a streaming message (mark as no longer streaming).
   */
  private finalizeStreamingMessage(msgId: string, text: string, extraBlocks?: ContentBlock[]): void {
    try {
      const blocks: ContentBlock[] = [];
      if (text) {
        blocks.push({ type: 'text' as const, text });
      }
      if (extraBlocks) {
        blocks.push(...extraBlocks);
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text' as const, text: '*(no output)*' });
      }
      useChatStore.getState().updateMessage(msgId, {
        content: blocks,
        isStreaming: false,
      });
    } catch {
      // Non-critical
    }
  }

  /**
   * Finalize a streaming message AND append tool activity blocks for structured rendering.
   */
  private finalizeStreamingMessageWithActivities(
    msgId: string,
    text: string,
    toolActivities: Array<{ name: string; status: string; duration?: number; details?: string }>
  ): void {
    try {
      // Map tool name → ToolActivitySummary type
      const TOOL_TYPE_MAP: Record<string, string> = {
        file_write: 'file_write',
        file_read: 'file_read',
        file_list: 'directory_scan',
        execute_code: 'code_execute',
        web_search: 'web_search',
        memory_store: 'memory_store',
        memory_recall: 'memory_recall',
        scan_directory: 'directory_scan',
        code_search: 'code_search',
        run_command: 'terminal_command',
        git: 'git_operation',
        edit_file: 'file_edit',
        generate_image: 'image_generate',
        web_fetch: 'web_fetch',
        search_images: 'image_search',
        site_validate: 'site_validate',
        conversion_audit: 'conversion_audit',
        site_improve: 'site_improve',
        motion_validate: 'motion_validate',
        scene_validate: 'scene_validate',
        output_guard: 'output_guard',
      };

      const blocks: ContentBlock[] = [];
      if (text) {
        blocks.push({ type: 'text' as const, text });
      }
      if (toolActivities.length > 0) {
        // Convert raw activities to ToolActivitySummary shape
        const summaries = toolActivities.map((a, i) => ({
          id: `ta-${msgId}-${i}`,
          type: TOOL_TYPE_MAP[a.name] || 'other',
          label: a.details || a.name.replace(/_/g, ' '),
          status: a.status === 'failed' ? 'error' : a.status,
          ...(a.duration != null ? { startTime: 0, endTime: a.duration } : {}),
        }));
        blocks.push({
          type: 'tool_activity' as const,
          activities: summaries,
        } as any);
      }
      if (blocks.length === 0) {
        blocks.push({ type: 'text' as const, text: '*(no output)*' });
      }
      useChatStore.getState().updateMessage(msgId, {
        content: blocks,
        isStreaming: false,
      });
    } catch {
      // Non-critical — fall back to simple finalize
      this.finalizeStreamingMessage(msgId, text);
    }
  }

  /**
   * Post a message to the TBWO's linked chat conversation.
   * Creates the conversation if it doesn't exist yet.
   */
  private postToChat(tbwoId: string, content: ContentBlock[], model?: string): void {
    try {
      const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
      if (!tbwo) return;

      let convId = tbwo.chatConversationId;
      if (!convId) {
        // Create the chat conversation
        convId = useChatStore.getState().createConversation({
          title: `TBWO: ${tbwo.objective.slice(0, 50)}`,
        });
        useTBWOStore.getState().updateTBWO(tbwoId, { chatConversationId: convId });
      }

      useChatStore.getState().addMessage(convId, {
        role: MessageRole.ASSISTANT,
        content,
        model: model || 'ALIN',
      });
    } catch {
      // Non-critical
    }
  }

  /**
   * Post a file artifact to the TBWO chat as a code block message.
   */
  private postArtifactToChat(tbwoId: string, artifact: Artifact): void {
    const content: ContentBlock[] = [];

    // Add description text
    content.push({
      type: 'text' as const,
      text: `**File created:** \`${artifact.path || artifact.name}\``,
    });

    // Add code block if content is a string
    if (typeof artifact.content === 'string' && artifact.content.length > 0) {
      const ext = (artifact.path || artifact.name).split('.').pop() || '';
      const langMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown',
        rs: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c', sh: 'bash',
        yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql', xml: 'xml',
        svg: 'svg', scss: 'scss', less: 'less',
      };
      content.push({
        type: 'code' as const,
        language: langMap[ext] || ext || 'text',
        code: artifact.content.length > 5000
          ? artifact.content.slice(0, 5000) + `\n\n... (${artifact.content.length} chars total)`
          : artifact.content,
        filename: artifact.path || artifact.name,
      });
    }

    this.postToChat(tbwoId, content);
  }

  // ==========================================================================
  // PAUSE HELPER
  // ==========================================================================

  /**
   * Wait while the execution is paused. Returns when resumed or cancelled.
   * Handles regular pause, checkpoint pause, AND pause_waiting_for_user.
   */
  private async waitWhilePaused(tbwoId: string): Promise<void> {
    const pollInterval = 1000;
    const maxWait = 60 * 60 * 1000; // 1 hour max pause
    const startWait = Date.now();

    while (Date.now() - startWait < maxWait) {
      const state = this.states.get(tbwoId);
      if (!state) return;
      if (state.status !== 'paused' && state.status !== 'checkpoint' && state.status !== 'paused_waiting_for_user') return;

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }
  }

  // ==========================================================================
  // SITE MANIFEST GENERATION
  // ==========================================================================

  /**
   * Generate alin.site.json for Website Sprint TBWOs.
   * Uses dynamic import to avoid coupling the engine to product code.
   * Writes the manifest to the workspace (if workspace mode) or logs it.
   */

  // ==========================================================================
  // PRE-EXECUTION CLARIFICATION — ask about required unknowns BEFORE pods
  // ==========================================================================

  /**
   * Check the site brief for required unknowns without answers.
   * If any exist, pause execution and wait for user input BEFORE spawning pods.
   * This ensures pods have complete context from the start.
   */
  private async runPreExecutionClarification(state: ExecutionState, tbwo: TBWO): Promise<void> {
    // Pre-exec questions are now created at TBWO creation time (in the wizard)
    // and answered in the Pause & Ask tab BEFORE the user clicks "Approve & Start".
    // Here we just collect any answered pre-exec pause requests and inject them into the brief.
    const freshTBWO = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!freshTBWO) return;

    const preExecPauses = freshTBWO.pauseRequests?.filter(
      p => p.phase === 'pre-execution' && p.status !== 'pending'
    ) || [];

    if (preExecPauses.length === 0) return;

    // Collect answers
    const answers: Record<string, string> = {};
    for (const pr of preExecPauses) {
      if (pr.userResponse) {
        const field = pr.requiredFields?.[0] || pr.contextPath;
        answers[field] = pr.userResponse;
      }
    }

    if (Object.keys(answers).length === 0) return;

    // Update siteBrief with answers
    const siteBrief = { ...(freshTBWO.metadata?.siteBrief as Record<string, unknown> || {}) };
    for (const [field, value] of Object.entries(answers)) {
      siteBrief[field] = value;
    }

    // Store pre-execution answers for injection into pod task prompts
    const preExecAnswers = Object.entries(answers).map(
      ([field, value]) => `**${field}:** ${value}`
    ).join('\n');

    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      metadata: {
        ...(freshTBWO.metadata || {}),
        siteBrief,
        preExecutionAnswers: preExecAnswers,
      },
    });

    console.log(`[ExecutionEngine] Pre-exec answers injected: ${Object.keys(answers).length} fields`);
  }

  // ==========================================================================
  // TRUTH GUARD — post-completion scan for fabricated claims
  // ==========================================================================

  /**
   * Run Truth Guard on all HTML artifacts after execution completes.
   * Only runs for Website Sprint TBWOs. Results are stored in metadata
   * and posted to the TBWO chat.
   */
  /**
   * Run automatic site validation after all phases complete.
   * Checks for missing pages, broken links, placeholder content.
   */
  private async runPostCompletionSiteValidation(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo || tbwo.type !== TBWOType.WEBSITE_SPRINT) return;

    try {
      const { validateAgainstPageSpec, scanForPlaceholders } = await import('../../products/sites/sitesValidation');

      // Collect artifacts
      const htmlArtifacts = new Map<string, string>();
      let pageSpec = null;
      for (const [_id, art] of state.artifacts) {
        if (art.path && typeof art.content === 'string') {
          htmlArtifacts.set(art.path, art.content);
        }
        if (art.path?.endsWith('pageSpec.json') || art.name === 'pageSpec.json') {
          try {
            pageSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content;
          } catch { /* ignore */ }
        }
      }

      if (pageSpec) {
        const report = validateAgainstPageSpec(htmlArtifacts, pageSpec);
        if (!report.passed) {
          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `**Site Validation: ${report.issues.filter(i => i.severity === 'error').length} error(s) found**\n\n${report.issues.filter(i => i.severity === 'error').slice(0, 5).map(i => `- **${i.rule}** in ${i.file}: ${i.message}`).join('\n')}\n\nScore: ${report.score}/100` },
          ]);

          // Store validation report as artifact
          const reportArt: Artifact = {
            id: nanoid(),
            tbwoId: state.tbwoId,
            name: 'validationReport.json',
            type: ArtifactType.DATA,
            content: JSON.stringify(report, null, 2),
            path: 'validationReport.json',
            createdBy: 'system',
            createdAt: Date.now(),
            version: 1,
            status: 'final',
          };
          state.artifacts.set(reportArt.id, reportArt);
          useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);
        } else {
          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `**Site Validation passed** (score: ${report.score}/100). All pages present, no placeholders found.` },
          ]);
        }
      } else {
        // Fallback: just scan for placeholders
        const scan = scanForPlaceholders(htmlArtifacts);
        if (scan.found) {
          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `**Warning:** Found ${scan.locations.length} placeholder(s) in generated content:\n${scan.locations.slice(0, 5).map(l => `- "${l.marker}" in ${l.file} (${l.context})`).join('\n')}` },
          ]);
        }
      }
    } catch (err) {
      console.error('[ExecutionEngine] Site validation error:', err);
    }
  }

  private async runPostCompletionConversionAudit(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo || tbwo.type !== TBWOType.WEBSITE_SPRINT) return;

    try {
      const { runConversionAudit } = await import('../../products/sites/conversionAudit');

      const htmlArtifacts = new Map<string, string>();
      let pageSpec = null;
      for (const [_id, art] of state.artifacts) {
        if (art.path && typeof art.content === 'string') {
          htmlArtifacts.set(art.path, art.content);
        }
        if (art.path?.endsWith('pageSpec.json') || art.name === 'pageSpec.json') {
          try { pageSpec = typeof art.content === 'string' ? JSON.parse(art.content) : art.content; } catch { /* ignore */ }
        }
      }

      const result = runConversionAudit(htmlArtifacts, pageSpec);

      // Store as artifact
      const reportArt: Artifact = {
        id: nanoid(),
        tbwoId: state.tbwoId,
        name: 'conversionAudit.json',
        type: ArtifactType.DATA,
        content: JSON.stringify(result, null, 2),
        path: 'conversionAudit.json',
        createdBy: 'system',
        createdAt: Date.now(),
        version: 1,
        status: 'final',
      };
      state.artifacts.set(reportArt.id, reportArt);
      useTBWOStore.getState().addArtifact(state.tbwoId, reportArt);

      // Store in metadata for easy tab access
      useTBWOStore.getState().updateTBWO(state.tbwoId, {
        metadata: { ...tbwo.metadata, conversionAudit: result },
      });

      // Post summary to chat
      const highPriority = result.recommendations.filter(r => r.priority === 'high').length;
      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `**Conversion Audit Complete** (score: ${result.overallScore}/100)\n\nClarity: ${result.scores.clarity} | Persuasion: ${result.scores.persuasion} | Trust: ${result.scores.trustSignals} | Visual: ${result.scores.visualHierarchy}\n\n${highPriority > 0 ? `${highPriority} high-priority recommendation(s) found. Check the Conversion tab for details.` : 'No critical issues found.'}` },
      ]);
    } catch (err) {
      console.error('[ExecutionEngine] Conversion audit error:', err);
    }
  }

  private async runPostCompletionMotionValidation(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo || tbwo.type !== TBWOType.WEBSITE_SPRINT) return;

    try {
      const { validateMotion } = await import('../../products/sites/motion/motionValidation');

      const files = new Map<string, string>();
      let motionSpec = null;
      for (const [, artifact] of state.artifacts) {
        const name = artifact.path || artifact.name || '';
        const content = typeof artifact.content === 'string'
          ? artifact.content
          : JSON.stringify(artifact.content, null, 2);
        if (name && content) {
          files.set(name, content);
        }
        if (name === 'motionSpec.json') {
          try { motionSpec = typeof content === 'string' ? JSON.parse(content) : content; } catch { /* ignore */ }
        }
      }

      if (files.size === 0) return;

      const result = validateMotion(files, motionSpec);

      // Store result in TBWO metadata
      useTBWOStore.getState().updateTBWO(state.tbwoId, {
        metadata: {
          ...tbwo.metadata,
          motionValidation: result,
        },
      });

      // Post summary to TBWO chat
      const icon = result.passed ? '\u2705' : '\u26A0\uFE0F';
      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `${icon} **Motion Validation** (score: ${result.score}/100)\n\n${result.summary}\n\nAnimated elements: ${result.totalAnimatedElements} | Bundle size: ${(result.estimatedBundleSize / 1024).toFixed(1)}KB | Reduced motion: ${result.reducedMotionCompliant ? 'compliant' : 'non-compliant'}${result.issues.filter(i => i.severity === 'error').length > 0 ? '\n\nCheck the Motion tab for details.' : ''}` },
      ]);
    } catch (err) {
      console.error('[ExecutionEngine] Motion validation error:', err);
    }
  }

  private async runPostCompletionTruthGuard(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo || tbwo.type !== TBWOType.WEBSITE_SPRINT) return;

    try {
      const { runTruthGuard } = await import('../../products/sites/truthGuard');

      // Collect all artifacts into a filename → content Map
      const files = new Map<string, string>();
      for (const [, artifact] of state.artifacts) {
        const name = artifact.path || artifact.name || '';
        const content = typeof artifact.content === 'string'
          ? artifact.content
          : JSON.stringify(artifact.content, null, 2);
        if (name && content) {
          files.set(name, content);
        }
      }

      if (files.size === 0) return;

      const brief = (tbwo.metadata?.siteBrief as import('../../api/dbService').SiteBrief) || null;
      const provenance = (tbwo.metadata?.provenance as Record<string, string>) || {};

      const result = runTruthGuard(files, brief, provenance);

      // Store result in TBWO metadata for the deploy gate
      useTBWOStore.getState().updateTBWO(state.tbwoId, {
        metadata: {
          ...tbwo.metadata,
          truthGuardResult: {
            passed: result.passed,
            violationCount: result.violations.length,
            criticalCount: result.violations.filter(v => v.critical && !v.resolved).length,
            summary: result.summary,
            violations: result.violations.slice(0, 50), // Cap stored violations
            ranAt: Date.now(),
          },
        },
      });

      // Post summary to TBWO chat
      if (result.violations.length > 0) {
        const icon = result.passed ? '\u2705' : '\u26A0\uFE0F';
        const lines = [`${icon} **Truth Guard Report**\n`, result.summary, ''];

        if (!result.passed) {
          lines.push('**Unresolved critical violations:**');
          for (const v of result.violations.filter(v => v.critical && !v.resolved).slice(0, 10)) {
            lines.push(`- \`${v.file}\` line ${v.lineNumber || '?'}: [${v.type}] "${v.matchedText}" — ${v.suggestion}`);
          }
          lines.push('\nThese must be resolved before deployment.');
        }

        this.postToChat(state.tbwoId, [{ type: 'text' as const, text: lines.join('\n') }], 'ALIN Truth Guard');
      } else {
        this.postToChat(state.tbwoId, [{ type: 'text' as const, text: '\u2705 **Truth Guard Report**: All clear \u2014 no fabricated claims detected.' }], 'ALIN Truth Guard');
      }
    } catch (err) {
      // Truth Guard is best-effort — don't block completion
      console.warn('[ExecutionEngine] Truth Guard scan failed:', err);
    }
  }

  private async runPostCompletionSceneValidation(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo || tbwo.type !== TBWOType.WEBSITE_SPRINT) return;

    // Only run for enhanced/immersive renderMode or scene3DEnabled
    const sprintConfig = tbwo.metadata?.sprintConfig as Record<string, unknown> | undefined;
    const renderMode = sprintConfig?.renderMode as string | undefined;
    const scene3DEnabled = sprintConfig?.scene3DEnabled as boolean | undefined;
    if (!scene3DEnabled && renderMode !== 'enhanced' && renderMode !== 'immersive') return;

    try {
      const { validateScene } = await import('../../products/sites/3d/sceneValidation');

      const files = new Map<string, string>();
      let sceneSpec = null;
      for (const [, artifact] of state.artifacts) {
        const name = artifact.path || artifact.name || '';
        const content = typeof artifact.content === 'string'
          ? artifact.content
          : JSON.stringify(artifact.content, null, 2);
        if (name && content) {
          files.set(name, content);
        }
        if (name === 'sceneSpec.json' || name === 'scene-config.json') {
          try { sceneSpec = typeof content === 'string' ? JSON.parse(content) : content; } catch { /* ignore */ }
        }
      }

      if (files.size === 0) return;

      const result = validateScene(files, sceneSpec);

      // Store result in TBWO metadata
      useTBWOStore.getState().updateTBWO(state.tbwoId, {
        metadata: {
          ...tbwo.metadata,
          sceneValidation: result,
        },
      });

      // Post summary to TBWO chat
      const icon = result.passed ? '\u2705' : '\u26A0\uFE0F';
      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `${icon} **3D Scene Validation** (score: ${result.score}/100)\n\n${result.summary}\n\nPolycount: ${result.totalPolycount} | Bundle: ${(result.estimatedBundleSize / 1024).toFixed(1)}KB | Reduced motion: ${result.reducedMotionCompliant ? 'compliant' : 'non-compliant'} | Mobile fallback: ${result.mobileFallbackPresent ? 'present' : 'missing'}${result.issues.filter((i: any) => i.severity === 'error').length > 0 ? '\n\nCheck the 3D tab for details.' : ''}` },
      ]);
    } catch (err) {
      console.error('[ExecutionEngine] Scene validation error:', err);
    }
  }

  private async runPostCompletionOutputGuard(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo || tbwo.type !== TBWOType.WEBSITE_SPRINT) return;

    try {
      const { scanForGenericContent } = await import('../../products/sites/cognitive/outputGuard');

      // Collect all artifacts into a filename → content Map
      const files = new Map<string, string>();
      for (const [, artifact] of state.artifacts) {
        const name = artifact.path || artifact.name || '';
        const content = typeof artifact.content === 'string'
          ? artifact.content
          : JSON.stringify(artifact.content, null, 2);
        if (name && content) {
          files.set(name, content);
        }
      }

      if (files.size === 0) return;

      const brief = (tbwo.metadata?.siteBrief as import('../../api/dbService').SiteBrief) || null;
      if (!brief) return;

      const violations = scanForGenericContent(files, brief);

      // Store result in TBWO metadata
      useTBWOStore.getState().updateTBWO(state.tbwoId, {
        metadata: {
          ...tbwo.metadata,
          outputGuardResult: {
            violationCount: violations.length,
            violations: violations.slice(0, 50),
            ranAt: Date.now(),
          },
        },
      });

      // Post summary to TBWO chat
      if (violations.length > 0) {
        const lines = [
          `\u26A0\uFE0F **Output Guard** — ${violations.length} generic content violation${violations.length === 1 ? '' : 's'} detected\n`,
        ];
        for (const v of violations.slice(0, 10)) {
          lines.push(`- \`${v.file}\` line ${v.line}: "${v.phrase}" \u2192 ${v.suggestion}`);
        }
        if (violations.length > 10) {
          lines.push(`\n... and ${violations.length - 10} more violations`);
        }
        this.postToChat(state.tbwoId, [{ type: 'text' as const, text: lines.join('\n') }], 'ALIN Output Guard');
      } else {
        this.postToChat(state.tbwoId, [{ type: 'text' as const, text: '\u2705 **Output Guard**: All clear \u2014 no generic or placeholder content detected.' }], 'ALIN Output Guard');
      }
    } catch (err) {
      // Output Guard is best-effort — don't block completion
      console.warn('[ExecutionEngine] Output Guard scan failed:', err);
    }
  }

  private async generateSiteManifest(state: ExecutionState): Promise<void> {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    if (!tbwo) return;
    if (tbwo.type !== 'website_sprint') return;

    try {
      const { generateSiteModelFromTBWO } = await import('../../products/sites/model/manifestGenerator');
      const { serializeSiteModel } = await import('../../products/sites/model/serializer');
      const { validateSiteModel } = await import('../../products/sites/model/validate');

      const siteModel = generateSiteModelFromTBWO(tbwo);
      const validation = validateSiteModel(siteModel);

      if (validation.warnings.length > 0) {
        console.warn(`[SiteManifest] ${validation.warnings.length} warnings:`, validation.warnings.slice(0, 5));
      }

      const manifestJson = serializeSiteModel(siteModel);

      if (state.workspaceMode && state.workspaceId) {
        // Write to workspace via API
        const resp = await fetch(`${BACKEND_URL}/api/tbwo/${state.workspaceId}/workspace/write`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ path: 'alin.site.json', content: manifestJson }),
        });

        if (resp.ok) {
          const data = await resp.json();
          state.workspaceFiles.push({
            relativePath: data.path || 'alin.site.json',
            size: data.size || manifestJson.length,
            downloadUrl: data.downloadUrl || '',
          });
          this.postToChat(state.tbwoId, [
            { type: 'text' as const, text: `**Site manifest generated** \`alin.site.json\` — ${siteModel.pages.length} pages, ${validation.valid ? 'valid' : validation.errors.length + ' errors'}` },
          ]);
        }
      } else {
        // Non-workspace mode: store as artifact
        const artifact: Artifact = {
          id: nanoid(),
          tbwoId: state.tbwoId,
          name: 'alin.site.json',
          type: ArtifactType.FILE,
          description: 'SiteModel v1 manifest — structured representation of the generated site',
          content: manifestJson,
          path: 'alin.site.json',
          createdBy: 'system',
          createdAt: Date.now(),
          version: 1,
          status: 'draft',
        };
        state.artifacts.set(artifact.id, artifact);
        useTBWOStore.getState().addArtifact(state.tbwoId, artifact);
      }
    } catch (err) {
      console.error('[ExecutionEngine] Failed to generate site manifest:', err);
      // Non-fatal — site still works without manifest
    }
  }

  // ==========================================================================
  // STATE ACCESS
  // ==========================================================================

  /**
   * Get the internal execution state for a TBWO.
   * Returns undefined if the TBWO is not currently executing.
   */
  getState(tbwoId: string): ExecutionState | undefined {
    return this.states.get(tbwoId);
  }

  /**
   * Check if a TBWO has an active execution state in this engine.
   * Used by tbwoStore to distinguish stale "executing" status after refresh
   * from genuine in-progress execution.
   */
  isExecuting(tbwoId: string): boolean {
    const state = this.states.get(tbwoId);
    return !!state && state.status === 'executing';
  }

  /**
   * Check if a TBWO is currently being executed by this engine.
   */
  isRunning(tbwoId: string): boolean {
    const state = this.states.get(tbwoId);
    if (!state) return false;
    return (
      state.status === 'initializing' ||
      state.status === 'planning' ||
      state.status === 'executing' ||
      state.status === 'checkpoint' ||
      state.status === 'completing' ||
      state.status === 'paused_waiting_for_user'
    );
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const executionEngine = new ExecutionEngine();
