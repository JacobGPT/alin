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
} from '../../types/tbwo';
import {
  TBWOStatus,
  PodStatus,
  PodRole,
  AuthorityLevel,
  ArtifactType,
  CheckpointTrigger,
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
import { getDomainPodPrompt } from './domainPrompts';
import { usePodPoolStore, getPooledPodContext } from '../../store/podPoolStore';
import { useAuthStore } from '../../store/authStore';

// ============================================================================
// CONSTANTS
// ============================================================================

const BACKEND_URL = '';
const MAX_TOOL_ITERATIONS = 10;
const TIME_TRACKING_INTERVAL_MS = 10_000;

// ============================================================================
// TYPES
// ============================================================================

interface ExecutionState {
  tbwoId: string;
  status:
    | 'initializing'
    | 'planning'
    | 'executing'
    | 'paused'
    | 'checkpoint'
    | 'completing'
    | 'completed'
    | 'failed'
    | 'cancelled';
  currentPhaseIndex: number;
  activePods: Map<string, { pod: AgentPod; aiService: AIService }>;
  messageBus: MessageBus;
  artifacts: Map<string, Artifact>;
  contractId: string | null;
  startTime: number;
  pausedAt: number | null;
  totalPauseDuration: number;
  errors: Array<{ phase: string; task: string; error: string; timestamp: number }>;
  completedTaskIds: Set<string>;
  totalTokensUsed: number;
  podPoolMapping?: Map<string, string>; // TBWO podId → pool podId
  podInboxes: Map<string, BusMessage[]>;
  pendingClarifications: Map<string, { taskId: string; podId: string; question: string; timestamp: number }>;
  workspaceMode: boolean;
  workspaceId: string | null;
  workspaceFiles: Array<{ relativePath: string; size: number; downloadUrl: string }>;
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
  async execute(tbwoId: string): Promise<void> {
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

    // Initialize execution state
    const state: ExecutionState = {
      tbwoId,
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
      workspaceMode: false,
      workspaceId: null,
      workspaceFiles: [],
    };
    this.states.set(tbwoId, state);

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
      // Create contract
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

      // Update TBWO with contract reference
      useTBWOStore.getState().updateTBWO(tbwoId, {
        contractId: contract.id,
        status: TBWOStatus.EXECUTING,
        startedAt: state.startTime,
      });

      // Spawn pods based on plan strategy
      state.status = 'executing';
      await this.spawnPods(state, tbwo);

      // Post execution start to TBWO chat
      const podNames = Array.from(state.activePods.values()).map((p) => p.pod.name).join(', ');
      this.postToChat(tbwoId, [
        { type: 'text' as const, text: `**Execution started** for: ${tbwo.objective}\n\n**Pods activated:** ${podNames}\n**Time budget:** ${tbwo.timeBudget.total} minutes\n**Phases:** ${tbwo.plan!.phases.length}` },
      ]);

      // Start time tracking
      this.startTimeTracking(tbwoId);

      // Execute phases in order
      const plan = tbwo.plan;
      const sortedPhases = [...plan.phases].sort((a, b) => a.order - b.order);

      for (let i = 0; i < sortedPhases.length; i++) {
        // Check if cancelled or failed
        const currentState = this.states.get(tbwoId);
        if (!currentState || currentState.status === 'cancelled' || currentState.status === 'failed') {
          break;
        }

        // Enforce time budget - stop if time has expired
        const currentTBWO = useTBWOStore.getState().getTBWOById(tbwoId);
        if (currentTBWO && currentTBWO.timeBudget.remaining <= 0) {
          console.warn(`[ExecutionEngine] Time budget expired for TBWO ${tbwoId}. Stopping execution.`);
          this.postToChat(tbwoId, [
            { type: 'text' as const, text: `**Time budget expired** (${currentTBWO.timeBudget.total} minutes). Wrapping up execution.` },
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

        // If the phase entirely failed (all tasks failed), decide whether to continue
        if (!phaseResult.success && phaseResult.tasksCompleted === 0) {
          console.error(`[ExecutionEngine] Phase "${phase.name}" completely failed`);
          state.errors.push({
            phase: phase.name,
            task: '*',
            error: `All tasks in phase "${phase.name}" failed`,
            timestamp: Date.now(),
          });
          // Continue to next phase - the completion step will evaluate overall success
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
    if (!state || state.status !== 'paused') return;

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

    // Clean up state
    this.states.delete(tbwoId);
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
      // Check for cancellation between groups
      if (state.status === 'cancelled' || state.status === 'failed') {
        break;
      }

      // Enforce time budget at task-group level too
      const tbwoCheck = useTBWOStore.getState().getTBWOById(state.tbwoId);
      if (tbwoCheck && tbwoCheck.timeBudget.remaining <= 0) {
        break;
      }

      // Wait while paused
      await this.waitWhilePaused(state.tbwoId);

      // Execute all tasks in this group in parallel
      const results = await Promise.allSettled(
        group.map((task) => this.executeTask(state, task))
      );

      // Process results
      for (let i = 0; i < results.length; i++) {
        const result = results[i]!;
        const task = group[i]!;

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

    const { pod, aiService } = podEntry;

    // Mark pod as working and log task start
    useTBWOStore.getState().updatePod(podId, { status: PodStatus.WORKING, currentTask: task });
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
    const podLabel = `${pod.name} (${pod.role})`;

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

      // Build the task prompt
      const taskPrompt = this.buildTaskPrompt(state, task, pod);

      // Build tool definitions based on the pod's whitelist
      const tools = this.buildToolDefinitions(pod.toolWhitelist);

      // Create a streaming message in the TBWO chat for live output
      const streamingMsgId = this.createStreamingMessage(state.tbwoId, podLabel);
      let streamedText = '';

      // Stream the initial AI response (live text + tool calls)
      let pendingToolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

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

      // Handle tool calls in a loop
      let iterations = 0;
      const filesWrittenInTask = new Set<string>(); // Track files written to prevent infinite rewrites

      while (pendingToolCalls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Check for pause/cancel inside tool loop (not just between phases)
        if (state.status === 'paused') {
          this.appendPodLog(podId, 'Execution paused — waiting...');
          await this.waitWhilePaused(state.tbwoId);
        }
        if (state.status === 'cancelled' || state.status === 'failed') {
          this.appendPodLog(podId, 'Execution cancelled — stopping tool loop');
          break;
        }

        // Check time budget inside tool loop
        const tbwoTimeCheck = useTBWOStore.getState().getTBWOById(state.tbwoId);
        if (tbwoTimeCheck && tbwoTimeCheck.timeBudget.remaining <= 0) {
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

          // Detect duplicate file_write calls — prevent infinite rewrite loops
          if (toolCall.name === 'file_write') {
            const filePath = String((toolCall.input as Record<string, unknown>)['path'] || '');
            if (filesWrittenInTask.has(filePath)) {
              this.appendPodLog(podId, `Skipping duplicate file_write for: ${filePath}`);
              toolResults.push({
                toolUseId: toolCall.id,
                result: `File "${filePath}" was already written in this task. Do NOT rewrite the same file. Move on to the next task or file.`,
              });
              continue;
            }
            filesWrittenInTask.add(filePath);
          }

          // Intercept request_clarification — handle via clarification system
          if (toolCall.name === 'request_clarification') {
            const result = await this.handleClarification(state, task, pod, toolCall.input);
            toolResults.push({ toolUseId: toolCall.id, result });
            continue;
          }

          // Update streaming message with tool activity
          if (streamingMsgId) {
            streamedText += `\n\n> **Tool:** \`${toolCall.name}\``;
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

          // Record tool reliability (fire-and-forget)
          import('../selfModelService').then(sm => {
            sm.onToolCall(toolCall.name, toolSuccess, toolCallDuration, toolSuccess ? undefined : toolResult).catch(() => {});
          }).catch(() => {});

          // Check if the tool created an artifact (e.g., file_write)
          if (toolCall.name === 'file_write' || toolCall.name === 'edit_file') {
            const artifactId = nanoid();
            const artifact: Artifact = {
              id: artifactId,
              tbwoId: state.tbwoId,
              name: String((toolCall.input as Record<string, unknown>)['path'] || toolCall.name),
              type: ArtifactType.FILE,
              description: `Created by ${pod.role} pod during task "${task.name}"`,
              content: (toolCall.input as Record<string, unknown>)['content'] || toolResult,
              path: String((toolCall.input as Record<string, unknown>)['path'] || ''),
              createdBy: podId,
              createdAt: Date.now(),
              version: 1,
              status: 'draft',
            };
            artifacts.push(artifact);
            state.artifacts.set(artifact.id, artifact);
            useTBWOStore.getState().addArtifact(state.tbwoId, artifact);
            tbwoUpdateService.artifactCreated(state.tbwoId, artifact.name, 'file');

            // Post artifact to TBWO chat as a separate message
            this.postArtifactToChat(state.tbwoId, artifact);

            // Broadcast artifact_ready to all pods via message bus
            state.messageBus.broadcast(podId, 'artifact_ready', {
              artifactId: artifact.id,
              name: artifact.name,
              path: artifact.path || '',
              type: artifact.type,
              createdBy: podId,
              preview: typeof artifact.content === 'string' ? artifact.content.slice(0, 500) : '',
            }, 'normal');
          }
        }

        // Stream the continuation response after tool results
        for (const tr of toolResults) {
          streamedText += '\n\n';
          await new Promise<void>((resolve) => {
            aiService.streamContinueWithToolResult(tr.toolUseId, tr.result, {
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
                resolve(); // Don't break the loop on continuation errors
              },
            }, tools).catch(() => resolve());
          });
        }
      }

      // Finalize the streaming message
      if (streamingMsgId) {
        this.finalizeStreamingMessage(streamingMsgId, `**${podLabel}** completed *${task.name}*:\n\n${streamedText}`);
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

      // Sync pod metrics and push completed task to pod
      const metrics = aiService.getMetrics();
      const podNow = useTBWOStore.getState().getPodById(podId);
      const completedTasks = podNow ? [...podNow.pod.completedTasks, task] : [task];
      useTBWOStore.getState().updatePod(podId, {
        status: PodStatus.IDLE,
        currentTask: undefined,
        completedTasks,
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
      useTBWOStore.getState().updatePod(podId, {
        status: PodStatus.IDLE,
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

    const strategy = plan.podStrategy;
    const rolesToSpawn = strategy.priorityOrder.length > 0
      ? strategy.priorityOrder
      : [PodRole.ORCHESTRATOR];

    // Limit concurrent pods
    const maxPods = Math.min(rolesToSpawn.length, strategy.maxConcurrent || 5);

    for (let i = 0; i < maxPods; i++) {
      const role = rolesToSpawn[i]!;

      // Check the pod pool for a reusable pod with this role
      const pooledPod = usePodPoolStore.getState().getOrCreatePod(role, state.tbwoId);
      const poolContext = getPooledPodContext(pooledPod);

      // Use the store to spawn the pod (it handles ID creation and state)
      const podId = useTBWOStore.getState().spawnPod(state.tbwoId, role);

      // Link pool pod to TBWO pod
      state.podPoolMapping = state.podPoolMapping || new Map();
      state.podPoolMapping.set(podId, pooledPod.id);

      // Wait a tick for the store to process the pod initialization
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // Fetch the freshly created pod from store
      const podInfo = useTBWOStore.getState().getPodById(podId);
      if (podInfo) {
        // Build system prompt with pool context injected
        let systemPrompt = this.buildPodSystemPrompt(podInfo.pod);
        if (poolContext) {
          systemPrompt += '\n' + poolContext;
        }

        // Create an AIService for this pod
        const aiService = new AIService({
          provider: podInfo.pod.modelConfig.provider || 'anthropic',
          model: podInfo.pod.modelConfig.model || 'claude-sonnet-4-5-20250929',
          temperature: podInfo.pod.modelConfig.temperature,
          maxTokens: podInfo.pod.modelConfig.maxTokens,
          systemPrompt,
        });

        state.activePods.set(podId, {
          pod: podInfo.pod,
          aiService,
        });

        // Subscribe pod to the message bus — queue messages into inbox for prompt injection
        state.messageBus.subscribe(podId, (message) => {
          if (message.from === podId) return; // Skip own messages
          const inbox = state.podInboxes.get(podId) || [];
          inbox.push(message);
          state.podInboxes.set(podId, inbox);
          console.log(`[Pod ${podId}] Queued ${message.type} from ${message.from} (inbox: ${inbox.length})`);
        });

        console.log(`[ExecutionEngine] Pod ${podId} (${role}) - Pool: ${pooledPod.id} (${pooledPod.totalTBWOsServed} TBWOs, ${pooledPod.totalTasksCompleted} tasks)`);
      }
    }
  }

  /**
   * Terminate all active pods, unsubscribe from bus, and clean up.
   */
  private async terminatePods(state: ExecutionState): Promise<void> {
    const podPool = usePodPoolStore.getState();

    // Final metrics sync: extract AIService metrics before termination
    for (const [podId, podEntry] of state.activePods) {
      try {
        const metrics = podEntry.aiService.getMetrics();
        if (metrics.totalTokens > 0 || metrics.totalCalls > 0) {
          useTBWOStore.getState().updatePod(podId, {
            resourceUsage: {
              cpuPercent: 0,
              memoryMB: 0,
              tokensUsed: metrics.totalTokens,
              apiCalls: metrics.totalCalls,
              executionTime: Date.now() - state.startTime,
            },
          });
        }

        // Return pod to pool with accumulated context
        const poolPodId = state.podPoolMapping?.get(podId);
        if (poolPodId) {
          const completedCount = podEntry.pod.completedTasks?.length || 0;
          const summary = completedCount > 0
            ? `Completed ${completedCount} tasks in TBWO ${state.tbwoId}. Used ${metrics.totalTokens} tokens across ${metrics.totalCalls} API calls.`
            : undefined;

          // Detect specializations from completed task types
          const patterns: string[] = [];
          if (podEntry.pod.completedTasks) {
            podEntry.pod.completedTasks.forEach(task => {
              if (task.description) {
                if (/react|component|jsx|tsx/i.test(task.description)) patterns.push('React/component development');
                if (/api|endpoint|rest/i.test(task.description)) patterns.push('API/endpoint development');
                if (/css|style|tailwind/i.test(task.description)) patterns.push('CSS/styling');
                if (/test|spec|qa/i.test(task.description)) patterns.push('Testing/QA');
                if (/database|sql|query/i.test(task.description)) patterns.push('Database operations');
              }
            });
          }

          podPool.returnPodToPool(poolPodId, summary, [...new Set(patterns)]);

          // Update pool pod token counts
          const poolPod = podPool.pool.get(poolPodId);
          if (poolPod) {
            usePodPoolStore.setState((s) => {
              const pp = s.pool.get(poolPodId);
              if (pp) {
                pp.totalTokensUsed += metrics.totalTokens;
                pp.totalTasksCompleted += completedCount;
              }
            });
          }
        }
      } catch (err) {
        console.error(`[ExecutionEngine] Error syncing pod ${podId} metrics:`, err);
      }
    }

    // Now terminate in TBWO store
    for (const [podId] of state.activePods) {
      try {
        useTBWOStore.getState().terminatePod(podId);
        state.podInboxes.delete(podId);
      } catch (err) {
        console.error(`[ExecutionEngine] Error terminating pod ${podId}:`, err);
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
    // If task has a specific pod assigned, use that
    if (task.assignedPod && state.activePods.has(task.assignedPod)) {
      return task.assignedPod;
    }

    // Find an idle pod
    for (const [podId] of state.activePods) {
      // Fetch fresh pod status from store
      const podInfo = useTBWOStore.getState().getPodById(podId);
      if (podInfo && podInfo.pod.status === PodStatus.IDLE) {
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

    // Generate receipts
    try {
      await useTBWOStore.getState().generateReceipts(state.tbwoId);
    } catch (err) {
      console.error('[ExecutionEngine] Failed to generate receipts:', err);
    }

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

      this.postToChat(state.tbwoId, [
        { type: 'text' as const, text: `**Download all files** (${state.workspaceFiles.length} files)` },
        {
          type: 'file' as const,
          fileId: `zip-${state.tbwoId}`,
          filename: `tbwo-${state.tbwoId.slice(0, 8)}.zip`,
          mimeType: 'application/zip',
          size: totalSize,
          url: zipUrl,
        } as ContentBlock,
      ]);
    }

    // Terminate pods
    await this.terminatePods(state);

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

    // Mark as completed
    state.status = 'completed';
    useTBWOStore.getState().updateTBWO(state.tbwoId, {
      status: TBWOStatus.COMPLETED,
      completedAt: Date.now(),
      progress: 100,
    });

    tbwoUpdateService.executionComplete(state.tbwoId, true);

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

    // Generate fallback receipt.json if Deployment Pod didn't create one
    try {
      const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
      if (tbwo) {
        const outputSlug = tbwo.objective
          ? tbwo.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
          : tbwo.id;
        const receiptPath = `output/tbwo/${outputSlug}/receipt.json`;

        // Check if receipt.json was already created by Deployment Pod
        const existingArtifact = Array.from(state.artifacts.values()).find(
          a => typeof a.path === 'string' && a.path.endsWith('receipt.json')
        );

        if (!existingArtifact) {
          // Build fallback receipt from execution state
          const totalTime = Math.round((Date.now() - state.startTime - state.totalPauseDuration) / 60000);
          const completedTasks = tbwo.plan?.phases.reduce(
            (sum, p) => sum + p.tasks.filter(t => t.status === 'complete').length, 0
          ) || 0;
          const totalTasks = tbwo.plan?.phases.reduce(
            (sum, p) => sum + p.tasks.length, 0
          ) || 1;
          const fileArtifacts = Array.from(state.artifacts.values()).filter(
            a => ['file', 'code', 'FILE', 'CODE'].includes(String(a.type))
          );

          const receiptData = {
            project: tbwo.type,
            objective: tbwo.objective,
            generatedAt: new Date().toISOString(),
            timeBudget: {
              allocated: tbwo.timeBudget.total,
              used: totalTime,
              remaining: Math.max(0, tbwo.timeBudget.total - totalTime),
            },
            quality: tbwo.qualityTarget,
            tasksCompleted: completedTasks,
            totalTasks,
            completionRate: Math.round((completedTasks / totalTasks) * 100),
            files: fileArtifacts.map(a => ({
              path: a.path || a.name,
              type: a.type,
              lines: typeof a.content === 'string' ? a.content.split('\n').length : 0,
            })),
            totalFiles: fileArtifacts.length,
            totalLines: fileArtifacts.reduce(
              (sum, a) => sum + (typeof a.content === 'string' ? a.content.split('\n').length : 0), 0
            ),
            tokensUsed: state.totalTokensUsed,
            decisions: [],
            checksRun: [],
            missing: tbwo.plan?.phases
              .flatMap(p => p.tasks.filter(t => t.status === 'failed'))
              .map(t => ({ item: t.name, reason: 'Task failed during execution' })) || [],
          };

          // Write receipt.json via backend
          try {
            await fetch(`${BACKEND_URL}/api/files/write`, {
              method: 'POST',
              headers: this.getAuthHeaders(),
              body: JSON.stringify({ path: receiptPath, content: JSON.stringify(receiptData, null, 2) }),
            });
            console.log('[ExecutionEngine] Fallback receipt.json created at', receiptPath);
          } catch {
            console.warn('[ExecutionEngine] Could not write fallback receipt.json');
          }
        }
      }
    } catch (err) {
      console.warn('[ExecutionEngine] Fallback receipt generation failed:', err);
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

    // Language map for syntax highlighting
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown',
      rs: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c', sh: 'bash',
      yaml: 'yaml', yml: 'yaml', toml: 'toml', sql: 'sql', xml: 'xml',
      svg: 'svg', scss: 'scss', less: 'less',
    };

    for (const artifact of fileArtifacts) {
      const filePath = artifact.path || artifact.name;
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const contentStr = artifact.content as string;

      // Compute file size for the FileBlock
      const sizeBytes = new Blob([contentStr]).size;

      // Determine MIME type
      const mimeMap: Record<string, string> = {
        html: 'text/html', css: 'text/css', js: 'application/javascript',
        ts: 'application/typescript', tsx: 'application/typescript',
        json: 'application/json', md: 'text/markdown', py: 'text/x-python',
        svg: 'image/svg+xml', xml: 'application/xml', yaml: 'text/yaml',
        yml: 'text/yaml', txt: 'text/plain',
      };
      const mimeType = mimeMap[ext] || 'text/plain';

      // Create a data URL so the file can be downloaded directly from chat
      const dataUrl = `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(contentStr)))}`;

      // Post a FileBlock — this is the actual downloadable attachment
      content.push({
        type: 'file' as const,
        fileId: artifact.id,
        filename: filePath,
        mimeType,
        size: sizeBytes,
        url: dataUrl,
      } as ContentBlock);

      // Post an inline code preview (truncated for large files)
      const language = langMap[ext] || ext || 'text';
      const previewLimit = 3000;
      const codePreview = contentStr.length > previewLimit
        ? contentStr.slice(0, previewLimit) + `\n\n/* ... ${contentStr.length} chars total — download full file above */`
        : contentStr;

      content.push({
        type: 'code' as const,
        language,
        code: codePreview,
        filename: filePath,
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
      if (state.status === 'paused' || state.status === 'checkpoint') {
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
            remaining: Math.max(0, tbwo.timeBudget.total - elapsedMinutes),
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
  // POD SYSTEM PROMPTS
  // ==========================================================================

  /**
   * Build a system prompt tailored to a pod's role using domain-specific prompts.
   * Uses getDomainPodPrompt() which combines:
   * - Base role identity
   * - Domain-specific instructions (per TBWO type × pod role)
   * - Dynamic objective-derived context (tech stack detection, domain hints)
   * - Quality-tier behavioral rules
   * - Execution context (pod ID, time budget, etc.)
   */
  private buildPodSystemPrompt(pod: AgentPod): string {
    // Fetch the TBWO for full context
    const tbwo = useTBWOStore.getState().getTBWOById(pod.tbwoId);
    if (!tbwo) {
      // Fallback if TBWO not found (shouldn't happen in normal flow)
      return [
        `You are an agent with the role: ${pod.role}.`,
        `Pod ID: ${pod.id}`,
        `TBWO ID: ${pod.tbwoId}`,
        'Complete your assigned tasks efficiently.',
        pod.modelConfig.systemPrompt || '',
      ].filter(Boolean).join('\n');
    }

    return getDomainPodPrompt(pod, tbwo);
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
            if (!resp.ok) throw new Error(`workspace file_read failed: ${resp.status}`);
            const data = await resp.json();
            return typeof data.content === 'string' ? data.content : JSON.stringify(data);
          }
          const resp = await fetch(`${BACKEND_URL}/api/files/read`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ path: input['path'] }),
          });
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

          // Fallback: enforce TBWO output folder for direct file I/O
          if (filePath && !filePath.startsWith('output/')) {
            const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
            const folderName = tbwo?.objective
              ? tbwo.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
              : state.tbwoId;
            filePath = `output/tbwo/${folderName}/${filePath}`;
            (input as Record<string, unknown>)['path'] = filePath;
          }
          const resp = await fetch(`${BACKEND_URL}/api/files/write`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ path: filePath, content: input['content'] }),
          });
          if (!resp.ok) throw new Error(`file_write failed: ${resp.status}`);
          const data = await resp.json();
          return data.message || `File written to ${filePath}`;
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
              pattern: input['pattern'],
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

            const oldStr = String(input['old_str'] || '');
            const newStr = String(input['new_str'] || '');
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
              old_str: input['old_str'],
              new_str: input['new_str'],
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

        case 'generate_image': {
          const resp = await fetch(`${BACKEND_URL}/api/images/generate`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              prompt: input['prompt'],
              size: input['size'] || '1024x1024',
              quality: input['quality'] || 'standard',
              style: input['style'] || 'natural',
            }),
          });
          if (!resp.ok) throw new Error(`generate_image failed: ${resp.status}`);
          const data = await resp.json();
          return data.url || data.image_url || JSON.stringify(data);
        }

        case 'memory_store': {
          const resp = await fetch(`${BACKEND_URL}/api/memory/store`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
              key: input['key'],
              value: input['value'],
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
          return `Unknown tool: ${name}. Available tools: file_read, file_write, file_list, scan_directory, code_search, execute_code, run_command, git, edit_file, web_search, generate_image, memory_store, memory_recall, system_status, gpu_compute, blender_execute, blender_render`;
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

    // Build a focused prompt for the clarification
    const artifactNames = Array.from(state.artifacts.values()).map(a => a.name).slice(0, 20);
    const prompt = [
      `You are making a decision for a TBWO execution.`,
      ``,
      `**TBWO Objective:** ${tbwo?.objective || 'Unknown'}`,
      `**Quality Target:** ${tbwo?.qualityTarget || 'standard'}`,
      `**Current Task:** ${task.name}${task.description ? ` — ${task.description}` : ''}`,
      `**Pod Role:** ${pod.role} (${pod.name})`,
      ``,
      `**Question:** ${question}`,
      context ? `**Context:** ${context}` : '',
      options.length > 0 ? `**Options:**\n${options.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}` : '',
      ``,
      artifactNames.length > 0 ? `**Existing artifacts:** ${artifactNames.join(', ')}` : '',
      ``,
      `Provide a clear, decisive answer. Pick the best option given the objective and quality target. Be concise (1-3 sentences). Do NOT ask follow-up questions.`,
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
  // TASK PROMPT BUILDING
  // ==========================================================================

  /**
   * Build a prompt for a task, including context about the TBWO, phase, and artifacts.
   */
  private buildTaskPrompt(state: ExecutionState, task: Task, pod: AgentPod): string {
    const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
    const phases = tbwo?.plan?.phases || [];
    const currentPhase = phases[state.currentPhaseIndex];

    const contextParts: string[] = [
      `## Task: ${task.name}`,
    ];

    if (task.description) {
      contextParts.push(`\n**Description:** ${task.description}`);
    }

    if (tbwo) {
      contextParts.push(`\n**TBWO Objective:** ${tbwo.objective}`);
      contextParts.push(`**Quality Target:** ${tbwo.qualityTarget}`);
      const remaining = Math.max(0, tbwo.timeBudget.total - (tbwo.timeBudget.elapsed || 0));
      contextParts.push(`**Time Budget:** ${tbwo.timeBudget.total} minutes total, ${remaining.toFixed(1)} minutes remaining`);
      contextParts.push(`**CRITICAL:** You MUST complete this task within ${Math.min(remaining, tbwo.timeBudget.total / (tbwo.plan?.phases.reduce((s, p) => s + p.tasks.length, 0) || 1)).toFixed(1)} minutes. Do NOT plan for more time than the budget allows. Work efficiently.`);
    }

    if (currentPhase) {
      contextParts.push(`\n**Current Phase:** ${currentPhase.name} - ${currentPhase.description}`);
    }

    // ========================================================================
    // ARTIFACT INJECTION — pass prior pod outputs so this pod can build on them
    // ========================================================================
    if (state.artifacts.size > 0) {
      const relevantArtifacts = this.selectRelevantArtifacts(
        state, phases, state.currentPhaseIndex, task, pod
      );

      if (relevantArtifacts.length > 0) {
        contextParts.push('\n## Artifacts from Prior Work');
        contextParts.push('These were produced by other pods. Use them as input for your task.\n');

        const ARTIFACT_CHAR_BUDGET = 50_000;
        let charsUsed = 0;

        for (const artifact of relevantArtifacts) {
          const contentStr = typeof artifact.content === 'string'
            ? artifact.content
            : JSON.stringify(artifact.content, null, 2);
          const header = `### ${artifact.name} (${artifact.type})${artifact.path ? ` — ${artifact.path}` : ''}`;

          if (charsUsed + header.length + contentStr.length + 10 > ARTIFACT_CHAR_BUDGET) {
            // Truncate this artifact's content to fit remaining budget
            const remaining = ARTIFACT_CHAR_BUDGET - charsUsed - header.length - 50;
            if (remaining > 200) {
              contextParts.push(header);
              contextParts.push('```\n' + contentStr.slice(0, remaining) + '\n... (truncated)\n```');
            } else {
              contextParts.push(`*(${relevantArtifacts.length - relevantArtifacts.indexOf(artifact)} more artifacts omitted for space)*`);
            }
            break;
          }

          contextParts.push(header);
          contextParts.push('```\n' + contentStr + '\n```');
          charsUsed += header.length + contentStr.length + 10;
        }
      } else {
        // Still list artifact names even if no content is injected
        contextParts.push('\n**Available Artifacts (no content injected):**');
        let count = 0;
        for (const [, artifact] of state.artifacts) {
          if (count >= 10) {
            contextParts.push(`  ... and ${state.artifacts.size - 10} more`);
            break;
          }
          contextParts.push(`  - ${artifact.name} (${artifact.type})${artifact.path ? ` at ${artifact.path}` : ''}`);
          count++;
        }
      }
    }

    // Include recent errors as warnings
    const recentErrors = state.errors.slice(-3);
    if (recentErrors.length > 0) {
      contextParts.push('\n**Recent Errors (for awareness):**');
      for (const err of recentErrors) {
        contextParts.push(`  - [${err.phase}/${err.task}]: ${err.error}`);
      }
    }

    // ========================================================================
    // INBOX INJECTION — show messages from other pods
    // ========================================================================
    const inbox = state.podInboxes.get(pod.id) || [];
    if (inbox.length > 0) {
      // Cap at 20 most recent messages
      const recentMessages = inbox.slice(-20);
      contextParts.push('\n## Messages from Other Pods');
      contextParts.push('These messages arrived from other pods while you were idle or working. Use this context to coordinate.\n');

      for (const msg of recentMessages) {
        const senderPod = state.activePods.get(msg.from);
        const senderName = senderPod ? `${senderPod.pod.name} (${senderPod.pod.role})` : msg.from;
        const payload = msg.payload as Record<string, unknown>;

        switch (msg.type) {
          case 'artifact_ready':
            contextParts.push(`- **${senderName}** created artifact: \`${payload['name'] || payload['path'] || 'unknown'}\` (${payload['type'] || 'file'})${payload['preview'] ? `\n  Preview: ${String(payload['preview']).slice(0, 200)}...` : ''}`);
            break;
          case 'question':
            contextParts.push(`- **${senderName}** asks: ${payload['question'] || JSON.stringify(payload)}`);
            break;
          case 'result':
            contextParts.push(`- **${senderName}** completed: ${payload['task'] || ''} — ${payload['outputPreview'] || payload['status'] || 'done'}`);
            break;
          case 'error':
            contextParts.push(`- **${senderName}** error: ${payload['task'] || ''} — ${payload['error'] || 'unknown error'}`);
            break;
          case 'status_update':
            contextParts.push(`- **${senderName}** status: ${payload['task'] || ''} ${payload['status'] || ''}`);
            break;
          case 'clarification_request':
            contextParts.push(`- **${senderName}** needs clarification: ${payload['question'] || JSON.stringify(payload)}`);
            break;
          default:
            contextParts.push(`- **${senderName}** [${msg.type}]: ${JSON.stringify(payload).slice(0, 200)}`);
        }
      }

      // Drain inbox after injection
      state.podInboxes.set(pod.id, []);
    }

    contextParts.push('\nPlease complete this task. Use the available tools to produce concrete outputs (files, code, etc). Be thorough but efficient.');

    return contextParts.join('\n');
  }

  /**
   * Select which artifacts to inject based on phase position and pod role.
   *
   * Rules:
   * - Same phase → all artifacts from completed tasks in this phase
   * - Later phase → final artifacts from the previous phase
   * - QA pod     → ALL artifacts (QA needs to see everything)
   *
   * Artifacts are sorted newest-first so the most recent context appears first.
   */
  private selectRelevantArtifacts(
    state: ExecutionState,
    phases: Phase[],
    currentPhaseIdx: number,
    _task: Task,
    pod: AgentPod,
  ): Artifact[] {
    const allArtifacts = Array.from(state.artifacts.values());
    if (allArtifacts.length === 0) return [];

    // QA pods see everything — they need full context to validate
    if (pod.role === PodRole.QA) {
      return allArtifacts.sort((a, b) => b.createdAt - a.createdAt);
    }

    // Build a set of pod IDs that belong to each phase
    const phasePodsMap = new Map<number, Set<string>>();
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i]!;
      const podIds = new Set<string>();
      for (const assignedId of phase.assignedPods || []) {
        podIds.add(assignedId);
      }
      // Also include pods that completed tasks in this phase
      for (const t of phase.tasks || []) {
        if (t.assignedPod) podIds.add(t.assignedPod);
      }
      phasePodsMap.set(i, podIds);
    }

    const selected: Artifact[] = [];
    const currentPhasePods = phasePodsMap.get(currentPhaseIdx) || new Set();
    const previousPhasePods = currentPhaseIdx > 0
      ? (phasePodsMap.get(currentPhaseIdx - 1) || new Set())
      : new Set();

    for (const artifact of allArtifacts) {
      const creatorId = artifact.createdBy;

      // Same phase: include artifacts from other pods in this phase
      if (currentPhasePods.has(creatorId) && creatorId !== pod.id) {
        selected.push(artifact);
        continue;
      }

      // Previous phase: include all artifacts from previous phase pods
      if (previousPhasePods.has(creatorId)) {
        selected.push(artifact);
        continue;
      }

      // For phase index > 1, also include Orchestrator artifacts from any phase
      // (orchestrator decisions are always relevant)
      const creatorPod = state.activePods.get(creatorId);
      if (creatorPod && creatorPod.pod.role === PodRole.ORCHESTRATOR) {
        selected.push(artifact);
      }
    }

    // Sort newest-first so most recent work appears at the top
    return selected.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ==========================================================================
  // POD LOGGING
  // ==========================================================================

  /**
   * Append a log entry to a pod's messageLog in the store.
   */
  private appendPodLog(podId: string, content: string): void {
    try {
      const podInfo = useTBWOStore.getState().getPodById(podId);
      if (podInfo) {
        const messageLog = [...(podInfo.pod.messageLog || []), {
          timestamp: Date.now(),
          from: podId,
          to: 'log',
          type: 'status_update' as const,
          content,
        }];
        useTBWOStore.getState().updatePod(podId, { messageLog });
      }
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
        model: model || 'ALIN Execution Engine',
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
        model: model || 'ALIN Execution Engine',
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
  // TOOL DEFINITION BUILDING
  // ==========================================================================

  /**
   * Build Claude-format tool definitions based on a pod's tool whitelist.
   * Returns only the tool definitions that the pod is allowed to use.
   */
  private buildToolDefinitions(whitelist: string[]): any[] {
    const allTools: Record<string, any> = {
      file_write: {
        name: 'file_write',
        description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to write to' },
            content: { type: 'string', description: 'Content to write to the file' },
          },
          required: ['path', 'content'],
        },
      },
      file_read: {
        name: 'file_read',
        description: 'Read the contents of a file.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
          },
          required: ['path'],
        },
      },
      file_list: {
        name: 'file_list',
        description: 'List files and directories at a given path.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' },
          },
          required: ['path'],
        },
      },
      scan_directory: {
        name: 'scan_directory',
        description: 'Recursively scan a directory tree and return its structure.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Root directory to scan' },
            max_depth: { type: 'number', description: 'Maximum depth to scan (default: 3)' },
          },
          required: ['path'],
        },
      },
      code_search: {
        name: 'code_search',
        description: 'Search for text/code patterns in files.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query or regex pattern' },
            path: { type: 'string', description: 'Directory to search in' },
          },
          required: ['query'],
        },
      },
      execute_code: {
        name: 'execute_code',
        description: 'Execute code in a sandboxed environment.',
        input_schema: {
          type: 'object',
          properties: {
            language: { type: 'string', description: 'Programming language (javascript, python, etc)' },
            code: { type: 'string', description: 'Code to execute' },
          },
          required: ['language', 'code'],
        },
      },
      edit_file: {
        name: 'edit_file',
        description: 'Edit a file by replacing old text with new text.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to edit' },
            old_text: { type: 'string', description: 'Text to find and replace' },
            new_text: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
      web_search: {
        name: 'web_search',
        description: 'Search the web for information.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            count: { type: 'number', description: 'Number of results (default: 5)' },
          },
          required: ['query'],
        },
      },
      memory_store: {
        name: 'memory_store',
        description: 'Store information in memory for later recall.',
        input_schema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Content to remember' },
            category: { type: 'string', description: 'Category for the memory' },
          },
          required: ['content'],
        },
      },
      memory_recall: {
        name: 'memory_recall',
        description: 'Recall stored information from memory.',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for in memory' },
          },
          required: ['query'],
        },
      },
      run_command: {
        name: 'run_command',
        description: 'Run a shell command.',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
          },
          required: ['command'],
        },
      },
      git: {
        name: 'git',
        description: 'Execute git operations.',
        input_schema: {
          type: 'object',
          properties: {
            operation: { type: 'string', description: 'Git operation (status, log, diff, etc)' },
            args: { type: 'string', description: 'Additional arguments' },
          },
          required: ['operation'],
        },
      },
      system_status: {
        name: 'system_status',
        description: 'Get current system/TBWO execution status.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      request_clarification: {
        name: 'request_clarification',
        description: 'Ask for clarification when facing genuine ambiguity that blocks your work. Use this ONLY when you cannot make a reasonable decision yourself — e.g., conflicting requirements, missing critical information, or multiple equally valid approaches. Do NOT use for trivial decisions.',
        input_schema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The specific question you need answered to proceed' },
            context: { type: 'string', description: 'Brief context explaining why this is blocking your work' },
            options: { type: 'array', items: { type: 'string' }, description: 'Optional list of choices you see (2-4 options)' },
          },
          required: ['question'],
        },
      },
    };

    // If whitelist is empty, return ALL tools (pods need tools to function)
    if (!whitelist || whitelist.length === 0) {
      return Object.values(allTools);
    }

    // Return only the tools in the pod's whitelist
    return whitelist
      .map((name) => allTools[name])
      .filter((tool): tool is NonNullable<typeof tool> => tool != null);
  }

  // ==========================================================================
  // PAUSE HELPER
  // ==========================================================================

  /**
   * Wait while the execution is paused. Returns when resumed or cancelled.
   */
  private async waitWhilePaused(tbwoId: string): Promise<void> {
    const pollInterval = 1000;
    const maxWait = 60 * 60 * 1000; // 1 hour max pause
    const startWait = Date.now();

    while (Date.now() - startWait < maxWait) {
      const state = this.states.get(tbwoId);
      if (!state) return;
      if (state.status !== 'paused' && state.status !== 'checkpoint') return;

      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
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
      state.status === 'completing'
    );
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const executionEngine = new ExecutionEngine();
