/**
 * OrchestratorPod - Central coordinator for TBWO execution
 *
 * The conductor pod that manages the overall execution flow, delegates tasks
 * to specialist pods, monitors progress, and makes decisions about task
 * routing and priority. It maintains a registry of all active pods and
 * can broadcast status requests or delegate individual tasks.
 */

import { BasePod } from './BasePod';
import type { Task, Artifact } from '../../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../../types/tbwo';
import { nanoid } from 'nanoid';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../prompts/orchestrator';

// ============================================================================
// ORCHESTRATOR POD
// ============================================================================

export class OrchestratorPod extends BasePod {
  private podRegistry = new Map<string, { role: string; status: string }>();

  // ==========================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ==========================================================================

  getSystemPrompt(): string {
    return ORCHESTRATOR_SYSTEM_PROMPT;
  }

  getSpecializedTools(): any[] {
    return [
      {
        name: 'scan_directory',
        description: 'Scan project directory structure to understand the current state',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to scan' },
          },
          required: ['path'],
        },
      },
      {
        name: 'memory_store',
        description: 'Store important project context, decisions, or state for later recall',
        input_schema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key identifier' },
            value: { type: 'string', description: 'Value to store' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'memory_recall',
        description: 'Recall previously stored project context or decisions',
        input_schema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key to recall' },
          },
          required: ['key'],
        },
      },
    ];
  }

  protected processTaskOutput(task: Task, response: string): Artifact[] {
    // Orchestrator outputs are planning/coordination documents, not code files.
    // We extract any structured plans, decisions, or status reports.
    const artifacts: Artifact[] = [];

    // Check if response contains a structured plan
    if (
      response.includes('## Plan') ||
      response.includes('## Tasks') ||
      response.includes('## Phase') ||
      response.includes('## Delegation') ||
      response.includes('## Coordination')
    ) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `orchestrator-${task.name}-plan`,
        type: ArtifactTypeEnum.DOCUMENT,
        description: `Orchestrator plan for: ${task.name}`,
        content: response,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'approved',
      });
    }

    // Check for decision documents
    if (
      response.includes('## Decision') ||
      response.includes('## Resolution') ||
      response.includes('## Status Report')
    ) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `orchestrator-${task.name}-decision`,
        type: ArtifactTypeEnum.DOCUMENT,
        description: `Orchestrator decision for: ${task.name}`,
        content: response,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'approved',
      });
    }

    // If no specific document type was detected but we have a meaningful response,
    // still produce a general coordination artifact
    if (artifacts.length === 0 && response.length > 100) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `orchestrator-${task.name}-output`,
        type: ArtifactTypeEnum.DOCUMENT,
        description: `Orchestrator output for: ${task.name}`,
        content: response,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'approved',
      });
    }

    return artifacts;
  }

  // ==========================================================================
  // ORCHESTRATOR-SPECIFIC: TASK DELEGATION
  // ==========================================================================

  /**
   * Delegate a task to a specific pod via the message bus.
   * Sends a high-priority task_assignment message.
   */
  async delegateTask(task: Task, targetPodId: string): Promise<void> {
    if (!this.messageBus) return;

    this.messageBus.publish({
      from: this.id,
      to: targetPodId,
      type: 'task_assignment',
      payload: task,
      priority: 'high',
    });
  }

  /**
   * Delegate multiple tasks to multiple pods in one batch.
   * Each entry maps a pod ID to the task it should execute.
   */
  async delegateTaskBatch(assignments: Array<{ podId: string; task: Task }>): Promise<void> {
    for (const { podId, task } of assignments) {
      await this.delegateTask(task, podId);
    }
  }

  // ==========================================================================
  // ORCHESTRATOR-SPECIFIC: STATUS MONITORING
  // ==========================================================================

  /**
   * Broadcast a status request to all pods on the message bus.
   * Each pod's handleMessage will receive the question and respond.
   */
  async requestStatusFromAll(): Promise<void> {
    if (!this.messageBus) return;

    this.messageBus.broadcast(
      this.id,
      'question',
      { question: 'Report current status and progress' },
    );
  }

  /**
   * Request status from a specific pod via the message bus.
   */
  async requestStatusFromPod(podId: string): Promise<void> {
    if (!this.messageBus) return;

    this.messageBus.publish({
      from: this.id,
      to: podId,
      type: 'question',
      payload: { question: 'Report current status and progress' },
      priority: 'normal',
    });
  }

  /**
   * Broadcast a project-wide update to all pods (e.g. phase transition).
   */
  async broadcastUpdate(update: {
    type: string;
    message: string;
    data?: unknown;
  }): Promise<void> {
    if (!this.messageBus) return;

    this.messageBus.broadcast(this.id, 'status_update', update);
  }

  // ==========================================================================
  // ORCHESTRATOR-SPECIFIC: POD REGISTRY
  // ==========================================================================

  /**
   * Register a pod in the orchestrator's local registry.
   * The orchestrator uses this to track which pods are available for work.
   */
  registerPod(podId: string, role: string): void {
    this.podRegistry.set(podId, { role, status: 'active' });
  }

  /**
   * Remove a pod from the orchestrator's local registry.
   */
  unregisterPod(podId: string): void {
    this.podRegistry.delete(podId);
  }

  /**
   * Update the status of a registered pod.
   */
  updatePodStatus(podId: string, status: string): void {
    const entry = this.podRegistry.get(podId);
    if (entry) {
      entry.status = status;
    }
  }

  /**
   * Get a snapshot of all registered pods and their statuses.
   */
  getRegisteredPods(): Map<string, { role: string; status: string }> {
    return new Map(this.podRegistry);
  }

  /**
   * Find registered pods by role.
   */
  findPodsByRole(role: string): string[] {
    const results: string[] = [];
    for (const [podId, entry] of this.podRegistry) {
      if (entry.role === role && entry.status === 'active') {
        results.push(podId);
      }
    }
    return results;
  }

  /**
   * Get the count of active pods in the registry.
   */
  getActivePodCount(): number {
    let count = 0;
    for (const [, entry] of this.podRegistry) {
      if (entry.status === 'active') count++;
    }
    return count;
  }

  // ==========================================================================
  // CONTEXT BUILDING OVERRIDE
  // ==========================================================================

  /**
   * Override buildTaskPrompt to include pod registry and project coordination context.
   */
  protected override buildTaskPrompt(task: Task): string {
    let prompt = super.buildTaskPrompt(task);

    // Add pod registry context
    if (this.podRegistry.size > 0) {
      prompt += '\n\n### Active Pod Registry';
      for (const [podId, entry] of this.podRegistry) {
        prompt += `\n- **${entry.role}** (${podId}): ${entry.status}`;
      }
    }

    // Add completed task summaries for cross-pod context
    if (this.completedTasks.length > 0) {
      prompt += '\n\n### Previously Completed Tasks';
      for (const completed of this.completedTasks.slice(-5)) {
        const outputPreview = typeof completed.output === 'string'
          ? completed.output.slice(0, 200)
          : 'No output';
        prompt += `\n- **${completed.name}** (${completed.status}): ${outputPreview}...`;
      }
    }

    return prompt;
  }
}
