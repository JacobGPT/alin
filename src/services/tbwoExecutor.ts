/**
 * TBWO Executor - Advanced Time-Budgeted Work Order Execution Engine
 *
 * A sophisticated execution engine for ALIN's TBWO system featuring:
 * - True parallel pod execution with Promise.allSettled
 * - Inter-pod communication through message bus and shared artifacts
 * - Dynamic task graph with DAG-based scheduling and critical path analysis
 * - Resource pooling and load balancing across pods
 * - Pod intelligence with learning and adaptive behavior
 * - Quality gates with automated testing and review
 * - Comprehensive receipt generation with decision trails
 * - Real-time progress streaming and visualization support
 * - Checkpoint system with approval flows and rollback
 * - Pod health monitoring with auto-recovery
 */

import { nanoid } from 'nanoid';
import { MessageRole } from '../types/chat';
import { useTBWOStore } from '@store/tbwoStore';
import {
  TBWOStatus,
  TBWOType,
  QualityTarget,
  PodRole,
  PodStatus,
  CheckpointTrigger,
  Operation,
} from '../types/tbwo';
import type {
  TBWO,
  ExecutionPlan,
  Phase,
  Task,
  AgentPod,
  Checkpoint,
  Artifact,
  TBWOReceipts,
  WebsiteSprintConfig,
} from '../types/tbwo';
import { toolExecutor, getClaudeTools } from '../tools/index';
import { createClaudeClient, ClaudeAPIClient } from '@api/claudeClient';
import { memoryService } from './memoryService';
import { contractService } from './contractService';
// receiptGenerator (./receiptGenerator) available for richer receipt generation once ExecutionContext is fully wired

// ============================================================================
// TYPES
// ============================================================================

interface PodExecutionContext {
  pod: AgentPod;
  tbwo: TBWO;
  client: ClaudeAPIClient;
  systemPrompt: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  workingMemoryId: string;
  messageQueue: PodMessage[];
  artifacts: Map<string, Artifact>;
  metrics: PodMetrics;
}

interface PodMessage {
  id: string;
  fromPodId: string;
  toPodId: string | 'broadcast';
  type: 'request' | 'response' | 'update' | 'artifact' | 'status' | 'error';
  payload: unknown;
  timestamp: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
  acknowledged: boolean;
}

interface PodMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageTaskTime: number;
  totalTokensUsed: number;
  totalExecutionTime: number;
  successRate: number;
  lastActivity: number;
  qualityScore: number;
  learningProgress: number;
}

interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  output: unknown;
  artifacts: Artifact[];
  executionTime: number;
  tokensUsed: number;
  podId: string;
  confidence: number;
  qualityScore: number;
  warnings: string[];
  dependencies: {
    required: string[];
    satisfied: string[];
    missing: string[];
  };
}

interface PhaseResult {
  phaseId: string;
  phase: Phase;
  success: boolean;
  tasksCompleted: number;
  tasksFailed: number;
  tasksSkipped: number;
  artifacts: Artifact[];
  duration: number;
  qualityScore: number;
  checkpointTriggered: boolean;
}

interface TaskGraphNode {
  taskId: string;
  task: Task;
  dependencies: string[];
  dependents: string[];
  status: 'pending' | 'ready' | 'running' | 'complete' | 'failed' | 'skipped';
  assignedPod: string | null;
  startTime: number | null;
  endTime: number | null;
  priority: number;
  criticalPath: boolean;
}

interface ExecutionSchedule {
  phases: Array<{
    phaseId: string;
    parallelGroups: string[][];
    estimatedDuration: number;
    criticalPath: string[];
  }>;
  totalEstimatedDuration: number;
  resourceRequirements: Map<PodRole, number>;
}

interface QualityGateResult {
  passed: boolean;
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    score: number;
    details: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
  }>;
  recommendations: string[];
  blockers: string[];
}

interface DecisionPoint {
  id: string;
  timestamp: number;
  context: string;
  options: Array<{ label: string; rationale: string }>;
  chosen: number;
  confidence: number;
  outcome?: 'success' | 'failure' | 'pending';
}

interface ExecutionState {
  status: 'initializing' | 'planning' | 'executing' | 'paused' | 'checkpoint' | 'completing' | 'completed' | 'failed' | 'cancelled';
  currentPhaseIndex: number;
  taskGraph: Map<string, TaskGraphNode>;
  schedule: ExecutionSchedule;
  activePods: Map<string, PodExecutionContext>;
  messageBus: MessageBus;
  sharedArtifacts: Map<string, Artifact>;
  decisionTrail: DecisionPoint[];
  qualityMetrics: Map<string, number>;
  startTime: number;
  pausedAt: number | null;
  totalPauseDuration: number;
}

// ============================================================================
// MESSAGE BUS - Inter-Pod Communication
// ============================================================================

class MessageBus {
  private subscribers: Map<string, Set<(message: PodMessage) => void>> = new Map();
  private messageHistory: PodMessage[] = [];
  private pendingMessages: Map<string, PodMessage[]> = new Map();
  private maxHistorySize: number = 1000;

  /**
   * Subscribe a pod to receive messages
   */
  subscribe(podId: string, handler: (message: PodMessage) => void): () => void {
    if (!this.subscribers.has(podId)) {
      this.subscribers.set(podId, new Set());
    }
    this.subscribers.get(podId)!.add(handler);

    // Deliver pending messages
    const pending = this.pendingMessages.get(podId) || [];
    pending.forEach(handler);
    this.pendingMessages.delete(podId);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(podId)?.delete(handler);
    };
  }

  /**
   * Publish a message
   */
  publish(message: Omit<PodMessage, 'id' | 'timestamp' | 'acknowledged'>): string {
    const fullMessage: PodMessage = {
      ...message,
      id: nanoid(),
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.messageHistory.push(fullMessage);
    if (this.messageHistory.length > this.maxHistorySize) {
      this.messageHistory.shift();
    }

    if (message.toPodId === 'broadcast') {
      // Broadcast to all subscribers
      this.subscribers.forEach((handlers) => {
        handlers.forEach((handler) => handler(fullMessage));
      });
    } else {
      // Send to specific pod
      const handlers = this.subscribers.get(message.toPodId);
      if (handlers && handlers.size > 0) {
        handlers.forEach((handler) => handler(fullMessage));
      } else {
        // Queue for later delivery
        if (!this.pendingMessages.has(message.toPodId)) {
          this.pendingMessages.set(message.toPodId, []);
        }
        this.pendingMessages.get(message.toPodId)!.push(fullMessage);
      }
    }

    return fullMessage.id;
  }

  /**
   * Acknowledge a message
   */
  acknowledge(messageId: string): void {
    const message = this.messageHistory.find((m) => m.id === messageId);
    if (message) {
      message.acknowledged = true;
    }
  }

  /**
   * Get messages for a pod
   */
  getMessagesForPod(podId: string, since?: number): PodMessage[] {
    return this.messageHistory.filter(
      (m) =>
        (m.toPodId === podId || m.toPodId === 'broadcast') &&
        (!since || m.timestamp > since)
    );
  }

  /**
   * Get unacknowledged messages
   */
  getUnacknowledged(podId: string): PodMessage[] {
    return this.messageHistory.filter(
      (m) =>
        (m.toPodId === podId || m.toPodId === 'broadcast') &&
        !m.acknowledged
    );
  }

  /**
   * Request-response pattern
   */
  async request(
    fromPodId: string,
    toPodId: string,
    payload: unknown,
    timeout: number = 30000
  ): Promise<PodMessage | null> {
    const requestId = this.publish({
      fromPodId,
      toPodId,
      type: 'request',
      payload,
      priority: 'normal',
    });

    return new Promise((resolve) => {
      const checkTimeout = setTimeout(() => {
        resolve(null);
      }, timeout);

      const checkForResponse = setInterval(() => {
        const response = this.messageHistory.find(
          (m) =>
            m.type === 'response' &&
            m.fromPodId === toPodId &&
            m.toPodId === fromPodId &&
            (m.payload as { requestId?: string })?.requestId === requestId
        );

        if (response) {
          clearInterval(checkForResponse);
          clearTimeout(checkTimeout);
          resolve(response);
        }
      }, 100);
    });
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messageHistory = [];
    this.pendingMessages.clear();
  }

  /**
   * Get message statistics
   */
  getStats(): {
    totalMessages: number;
    unacknowledged: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    this.messageHistory.forEach((m) => {
      byType[m.type] = (byType[m.type] || 0) + 1;
      byPriority[m.priority] = (byPriority[m.priority] || 0) + 1;
    });

    return {
      totalMessages: this.messageHistory.length,
      unacknowledged: this.messageHistory.filter((m) => !m.acknowledged).length,
      byType,
      byPriority,
    };
  }
}

// ============================================================================
// TASK GRAPH - DAG-based Scheduling
// ============================================================================

class TaskGraph {
  private nodes: Map<string, TaskGraphNode> = new Map();

  /**
   * Build graph from execution plan
   */
  buildFromPlan(plan: ExecutionPlan): void {
    this.nodes.clear();

    // Create nodes for all tasks
    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        this.nodes.set(task.id, {
          taskId: task.id,
          task,
          dependencies: task.dependsOn || [],
          dependents: [],
          status: 'pending',
          assignedPod: task.assignedPod || null,
          startTime: null,
          endTime: null,
          priority: 0,
          criticalPath: false,
        });
      }
    }

    // Build reverse dependencies (dependents)
    this.nodes.forEach((node) => {
      node.dependencies.forEach((depId) => {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          depNode.dependents.push(node.taskId);
        }
      });
    });

    // Calculate priorities
    this.calculatePriorities();

    // Find critical path
    this.findCriticalPath();
  }

  /**
   * Calculate task priorities based on dependencies and estimated duration
   */
  private calculatePriorities(): void {
    // Use reverse topological order to calculate priority
    // Tasks with more dependents have higher priority
    const calculateNodePriority = (nodeId: string, visited: Set<string>): number => {
      if (visited.has(nodeId)) return 0;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return 0;

      let maxDependentPriority = 0;
      for (const depId of node.dependents) {
        maxDependentPriority = Math.max(
          maxDependentPriority,
          calculateNodePriority(depId, visited)
        );
      }

      node.priority = maxDependentPriority + (node.task.estimatedDuration || 1);
      return node.priority;
    };

    const visited = new Set<string>();
    this.nodes.forEach((_, nodeId) => {
      calculateNodePriority(nodeId, visited);
    });
  }

  /**
   * Find critical path through the graph
   */
  private findCriticalPath(): void {
    // Reset critical path flags
    this.nodes.forEach((node) => {
      node.criticalPath = false;
    });

    // Find nodes with no dependents (end nodes)
    const endNodes = Array.from(this.nodes.values()).filter(
      (n) => n.dependents.length === 0
    );

    // Trace back from end nodes along highest priority path
    const traceCriticalPath = (nodeId: string): void => {
      const node = this.nodes.get(nodeId);
      if (!node) return;

      node.criticalPath = true;

      // Find dependency with highest priority
      let maxPriority = -1;
      let criticalDep: string | null = null;

      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode && depNode.priority > maxPriority) {
          maxPriority = depNode.priority;
          criticalDep = depId;
        }
      }

      if (criticalDep) {
        traceCriticalPath(criticalDep);
      }
    };

    endNodes.forEach((node) => {
      traceCriticalPath(node.taskId);
    });
  }

  /**
   * Get ready tasks (dependencies satisfied)
   */
  getReadyTasks(): TaskGraphNode[] {
    return Array.from(this.nodes.values()).filter((node) => {
      if (node.status !== 'pending') return false;

      // Check all dependencies are complete
      return node.dependencies.every((depId) => {
        const dep = this.nodes.get(depId);
        return dep && dep.status === 'complete';
      });
    });
  }

  /**
   * Get parallel groups (tasks that can run together)
   */
  getParallelGroups(): string[][] {
    const groups: string[][] = [];
    const remaining = new Set(this.nodes.keys());
    const completed = new Set<string>();

    while (remaining.size > 0) {
      const group: string[] = [];

      remaining.forEach((taskId) => {
        const node = this.nodes.get(taskId)!;

        // Check if all dependencies are completed
        const depsComplete = node.dependencies.every((depId) =>
          completed.has(depId)
        );

        if (depsComplete) {
          group.push(taskId);
        }
      });

      if (group.length === 0) {
        // Cycle detected or invalid graph
        console.warn('[TaskGraph] Possible cycle detected in task dependencies');
        break;
      }

      groups.push(group);
      group.forEach((taskId) => {
        remaining.delete(taskId);
        completed.add(taskId);
      });
    }

    return groups;
  }

  /**
   * Update task status
   */
  updateStatus(taskId: string, status: TaskGraphNode['status']): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.status = status;
      if (status === 'running') {
        node.startTime = Date.now();
      } else if (status === 'complete' || status === 'failed' || status === 'skipped') {
        node.endTime = Date.now();
      }
    }
  }

  /**
   * Assign pod to task
   */
  assignPod(taskId: string, podId: string): void {
    const node = this.nodes.get(taskId);
    if (node) {
      node.assignedPod = podId;
    }
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    total: number;
    pending: number;
    ready: number;
    running: number;
    complete: number;
    failed: number;
    skipped: number;
    criticalPathLength: number;
    maxParallelism: number;
  } {
    const stats = {
      total: this.nodes.size,
      pending: 0,
      ready: 0,
      running: 0,
      complete: 0,
      failed: 0,
      skipped: 0,
      criticalPathLength: 0,
      maxParallelism: 0,
    };

    this.nodes.forEach((node) => {
      stats[node.status]++;
      if (node.criticalPath) stats.criticalPathLength++;
    });

    const groups = this.getParallelGroups();
    stats.maxParallelism = Math.max(...groups.map((g) => g.length), 0);

    return stats;
  }

  /**
   * Get node by ID
   */
  getNode(taskId: string): TaskGraphNode | undefined {
    return this.nodes.get(taskId);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): TaskGraphNode[] {
    return Array.from(this.nodes.values());
  }
}

// ============================================================================
// RESOURCE POOL - Load Balancing
// ============================================================================

class ResourcePool {
  private pods: Map<string, PodExecutionContext> = new Map();
  private taskQueue: Array<{ task: Task; priority: number; addedAt: number }> = [];
  private activeTasks: Map<string, { taskId: string; podId: string; startTime: number }> = new Map();
  private maxConcurrentPerPod: number = 2;

  /**
   * Add pod to pool
   */
  addPod(context: PodExecutionContext): void {
    this.pods.set(context.pod.id, context);
  }

  /**
   * Remove pod from pool
   */
  removePod(podId: string): void {
    this.pods.delete(podId);
  }

  /**
   * Get available pod for a task
   */
  getAvailablePod(task: Task, preferredRole?: PodRole): PodExecutionContext | null {
    // Find pods with capacity
    const availablePods: Array<{ context: PodExecutionContext; score: number }> = [];

    this.pods.forEach((context) => {
      // Count active tasks for this pod
      let activeCount = 0;
      this.activeTasks.forEach((active) => {
        if (active.podId === context.pod.id) activeCount++;
      });

      if (activeCount >= this.maxConcurrentPerPod) return;

      // Calculate suitability score
      let score = 1.0;

      // Prefer pods matching task role
      if (preferredRole && context.pod.role === preferredRole) {
        score += 2.0;
      }

      // Prefer pods with higher success rate
      score += context.metrics.successRate;

      // Prefer pods with lower load
      score += (this.maxConcurrentPerPod - activeCount) * 0.5;

      // Prefer pods that have worked on related tasks
      if (context.pod.completedTasks.some((t) =>
        t.name.toLowerCase().includes(task.name.split(' ')[0].toLowerCase())
      )) {
        score += 0.5;
      }

      availablePods.push({ context, score });
    });

    if (availablePods.length === 0) return null;

    // Sort by score and return best match
    availablePods.sort((a, b) => b.score - a.score);
    return availablePods[0].context;
  }

  /**
   * Mark task as started
   */
  startTask(taskId: string, podId: string): void {
    this.activeTasks.set(taskId, {
      taskId,
      podId,
      startTime: Date.now(),
    });
  }

  /**
   * Mark task as completed
   */
  completeTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  /**
   * Queue task for later execution
   */
  queueTask(task: Task, priority: number = 0): void {
    this.taskQueue.push({ task, priority, addedAt: Date.now() });
    this.taskQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get next queued task
   */
  dequeueTask(): Task | null {
    const item = this.taskQueue.shift();
    return item?.task || null;
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalPods: number;
    activeTasks: number;
    queuedTasks: number;
    podUtilization: Map<string, number>;
  } {
    const podUtilization = new Map<string, number>();

    this.pods.forEach((_, podId) => {
      let count = 0;
      this.activeTasks.forEach((active) => {
        if (active.podId === podId) count++;
      });
      podUtilization.set(podId, count / this.maxConcurrentPerPod);
    });

    return {
      totalPods: this.pods.size,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      podUtilization,
    };
  }

  /**
   * Get all pods
   */
  getAllPods(): PodExecutionContext[] {
    return Array.from(this.pods.values());
  }
}

// ============================================================================
// QUALITY GATE - Automated Testing & Review
// ============================================================================

class QualityGate {
  /**
   * Run quality checks on artifacts
   */
  async runChecks(
    artifacts: Artifact[],
    qualityTarget: QualityTarget,
    tbwoType: TBWOType
  ): Promise<QualityGateResult> {
    const checks: QualityGateResult['checks'] = [];
    let totalScore = 0;
    let checkCount = 0;

    // Check 1: Artifact completeness
    const completenessCheck = this.checkCompleteness(artifacts, tbwoType);
    checks.push(completenessCheck);
    totalScore += completenessCheck.score;
    checkCount++;

    // Check 2: Code quality (if applicable)
    const codeArtifacts = artifacts.filter((a) => a.type === 'code');
    if (codeArtifacts.length > 0) {
      const codeQualityCheck = await this.checkCodeQuality(codeArtifacts);
      checks.push(codeQualityCheck);
      totalScore += codeQualityCheck.score;
      checkCount++;
    }

    // Check 3: Design consistency (for Website Sprint)
    if (tbwoType === TBWOType.WEBSITE_SPRINT) {
      const designCheck = this.checkDesignConsistency(artifacts);
      checks.push(designCheck);
      totalScore += designCheck.score;
      checkCount++;
    }

    // Check 4: Documentation coverage
    const docCheck = this.checkDocumentation(artifacts);
    checks.push(docCheck);
    totalScore += docCheck.score;
    checkCount++;

    // Check 5: Size and complexity
    const complexityCheck = this.checkComplexity(artifacts);
    checks.push(complexityCheck);
    totalScore += complexityCheck.score;
    checkCount++;

    const avgScore = checkCount > 0 ? totalScore / checkCount : 0;

    // Determine pass/fail based on quality target
    const thresholds: Record<QualityTarget, number> = {
      [QualityTarget.DRAFT]: 0.5,
      [QualityTarget.STANDARD]: 0.7,
      [QualityTarget.PREMIUM]: 0.85,
      [QualityTarget.APPLE_LEVEL]: 0.95,
    };

    const threshold = thresholds[qualityTarget];
    const passed = avgScore >= threshold;

    // Generate recommendations and blockers
    const recommendations: string[] = [];
    const blockers: string[] = [];

    checks.forEach((check) => {
      if (!check.passed) {
        if (check.severity === 'critical' || check.severity === 'error') {
          blockers.push(`${check.name}: ${check.details}`);
        } else {
          recommendations.push(`${check.name}: ${check.details}`);
        }
      }
    });

    return {
      passed,
      score: avgScore,
      checks,
      recommendations,
      blockers,
    };
  }

  private checkCompleteness(artifacts: Artifact[], tbwoType: TBWOType): QualityGateResult['checks'][0] {
    const requiredTypes: Record<TBWOType, string[]> = {
      [TBWOType.WEBSITE_SPRINT]: ['design', 'code', 'content'],
      [TBWOType.CODE_PROJECT]: ['code', 'documentation'],
      [TBWOType.RESEARCH_REPORT]: ['report', 'summary'],
      [TBWOType.DATA_ANALYSIS]: ['code', 'data'],
      [TBWOType.CONTENT_CREATION]: ['content'],
      [TBWOType.DESIGN_SYSTEM]: ['design', 'code'],
      [TBWOType.API_INTEGRATION]: ['code', 'documentation'],
      [TBWOType.CUSTOM]: [],
    };

    const required = requiredTypes[tbwoType] || [];
    const present = new Set(artifacts.map((a) => a.type as string));
    const missing = required.filter((r) => !present.has(r));

    const score = required.length > 0 ? (required.length - missing.length) / required.length : 1;

    return {
      name: 'Artifact Completeness',
      passed: missing.length === 0,
      score,
      details: missing.length > 0 ? `Missing: ${missing.join(', ')}` : 'All required artifacts present',
      severity: missing.length > 0 ? 'error' : 'info',
    };
  }

  private async checkCodeQuality(codeArtifacts: Artifact[]): Promise<QualityGateResult['checks'][0]> {
    let issues = 0;
    const details: string[] = [];

    for (const artifact of codeArtifacts) {
      const content = typeof artifact.content === 'string' ? artifact.content : '';

      // Check for common issues
      if (content.includes('console.log')) {
        issues++;
        details.push('Contains console.log statements');
      }
      if (content.includes('TODO') || content.includes('FIXME')) {
        issues++;
        details.push('Contains TODO/FIXME comments');
      }
      if (content.includes('any') && artifact.name.endsWith('.ts')) {
        issues++;
        details.push('Uses TypeScript any type');
      }
      if (content.length > 500 && !content.includes('/**') && !content.includes('//')) {
        issues++;
        details.push('Lacks documentation comments');
      }

      // Check for empty blocks
      if (/\{\s*\}/.test(content)) {
        issues++;
        details.push('Contains empty code blocks');
      }
    }

    const maxIssues = codeArtifacts.length * 3;
    const score = Math.max(0, 1 - issues / maxIssues);

    return {
      name: 'Code Quality',
      passed: issues < codeArtifacts.length,
      score,
      details: issues > 0 ? details.slice(0, 3).join('; ') : 'Code passes quality checks',
      severity: issues > codeArtifacts.length * 2 ? 'error' : issues > 0 ? 'warning' : 'info',
    };
  }

  private checkDesignConsistency(artifacts: Artifact[]): QualityGateResult['checks'][0] {
    const designArtifacts = artifacts.filter((a) => a.type === 'design' || a.name.includes('.css'));
    const codeArtifacts = artifacts.filter((a) => a.type === 'code');

    // Check for consistent color usage
    const colors = new Set<string>();
    const colorRegex = /#[0-9a-fA-F]{3,6}|rgb\([^)]+\)|hsl\([^)]+\)/g;

    [...designArtifacts, ...codeArtifacts].forEach((artifact) => {
      const content = typeof artifact.content === 'string' ? artifact.content : '';
      const matches = content.match(colorRegex) || [];
      matches.forEach((color) => colors.add(color.toLowerCase()));
    });

    // Too many unique colors suggests inconsistency
    const colorScore = Math.max(0, 1 - (colors.size - 10) / 20);

    // Check for Tailwind class consistency
    let tailwindScore = 1;
    codeArtifacts.forEach((artifact) => {
      const content = typeof artifact.content === 'string' ? artifact.content : '';
      // Check for inline styles alongside Tailwind
      if (content.includes('className=') && content.includes('style={{')) {
        tailwindScore -= 0.2;
      }
    });

    const score = (colorScore + tailwindScore) / 2;

    return {
      name: 'Design Consistency',
      passed: score >= 0.7,
      score,
      details: score >= 0.7 ? 'Design elements are consistent' : `${colors.size} unique colors detected`,
      severity: score < 0.5 ? 'warning' : 'info',
    };
  }

  private checkDocumentation(artifacts: Artifact[]): QualityGateResult['checks'][0] {
    const docArtifacts = artifacts.filter(
      (a) => (a.type as string) === 'documentation' || a.name.endsWith('.md')
    );
    const codeArtifacts = artifacts.filter((a) => (a.type as string) === 'code');

    // Check ratio of docs to code
    const ratio = codeArtifacts.length > 0 ? docArtifacts.length / codeArtifacts.length : 1;

    // Check for inline documentation in code
    let inlineDocScore = 0;
    let totalCodeLength = 0;

    codeArtifacts.forEach((artifact) => {
      const content = typeof artifact.content === 'string' ? artifact.content : '';
      totalCodeLength += content.length;
      const commentLines = (content.match(/\/\*\*[\s\S]*?\*\/|\/\/.*/g) || []).length;
      const totalLines = content.split('\n').length;
      inlineDocScore += totalLines > 0 ? commentLines / totalLines : 0;
    });

    if (codeArtifacts.length > 0) {
      inlineDocScore /= codeArtifacts.length;
    }

    const score = (Math.min(ratio, 1) * 0.5 + inlineDocScore * 0.5);

    return {
      name: 'Documentation Coverage',
      passed: score >= 0.3,
      score,
      details: score >= 0.5 ? 'Adequate documentation' : 'Consider adding more documentation',
      severity: score < 0.2 ? 'warning' : 'info',
    };
  }

  private checkComplexity(artifacts: Artifact[]): QualityGateResult['checks'][0] {
    let totalComplexity = 0;
    let artifactCount = 0;

    artifacts.forEach((artifact) => {
      const content = typeof artifact.content === 'string' ? artifact.content : '';

      // Rough cyclomatic complexity estimation
      const conditionals = (content.match(/if\s*\(|else\s*\{|switch\s*\(|\?\s*:/g) || []).length;
      const loops = (content.match(/for\s*\(|while\s*\(|\.forEach|\.map|\.reduce/g) || []).length;
      const functions = (content.match(/function\s+\w+|=>\s*\{|async\s+\w+/g) || []).length;

      if (functions > 0) {
        const avgComplexity = (conditionals + loops) / functions;
        totalComplexity += avgComplexity;
        artifactCount++;
      }
    });

    const avgComplexity = artifactCount > 0 ? totalComplexity / artifactCount : 0;
    // Optimal complexity is 5-10, too high or too low is concerning
    const score = Math.max(0, 1 - Math.abs(avgComplexity - 7.5) / 15);

    return {
      name: 'Code Complexity',
      passed: avgComplexity < 15,
      score,
      details: avgComplexity < 5 ? 'Consider more modular design' :
               avgComplexity > 15 ? 'High complexity, consider refactoring' :
               'Acceptable complexity level',
      severity: avgComplexity > 20 ? 'warning' : 'info',
    };
  }
}

// ============================================================================
// POD SYSTEM PROMPTS
// ============================================================================

const POD_SYSTEM_PROMPTS: Record<PodRole, string> = {
  [PodRole.ORCHESTRATOR]: `You are the Lead Orchestrator Pod for this TBWO execution.

## Your Responsibilities
- Coordinate all other pods and ensure smooth execution
- Break down complex objectives into concrete, actionable tasks
- Assign tasks to appropriate specialist pods
- Monitor progress and handle blockers proactively
- Make decisions about task priority and ordering
- Ensure quality standards are met across all deliverables
- Stay within the time budget with appropriate buffer

## Communication Protocol
- Send clear, actionable requests to pods via the message bus
- Aggregate artifacts and ensure consistency
- Escalate to user only when authority gates require it
- Log all decisions with rationale for the receipt

## Decision Making
- Favor speed over perfection for draft quality targets
- Favor completeness for premium/Apple-level quality
- When in doubt, ask clarifying questions
- Document assumptions explicitly

Think step-by-step and be explicit about your reasoning.`,

  [PodRole.DESIGN]: `You are the Design Pod, responsible for all visual and UX decisions.

## Your Responsibilities
- Create visual designs that align with the objective
- Define cohesive color schemes (prefer variables/tokens)
- Establish typography hierarchy and scale
- Design component layouts with accessibility in mind
- Ensure responsive behavior across breakpoints
- Maintain design consistency throughout

## Output Format
- Provide designs as structured specifications
- Use clear naming conventions for components
- Include spacing, sizing, and color values
- Note any animation/interaction requirements
- Mark required vs optional elements

## Collaboration
- Coordinate with Frontend Pod on implementation feasibility
- Work with Copy Pod on content placement
- Support Motion Pod with animation direction

Always consider accessibility (WCAG guidelines).`,

  [PodRole.FRONTEND]: `You are the Frontend Pod, responsible for implementing user interfaces.

## Your Responsibilities
- Write clean, maintainable React/TypeScript code
- Implement designs from the Design Pod accurately
- Ensure responsive behavior across all breakpoints
- Optimize for performance (lazy loading, code splitting)
- Write semantic HTML with proper accessibility
- Use Tailwind CSS for styling (prefer utility classes)

## Code Standards
- TypeScript strict mode, no implicit any
- Functional components with hooks
- Extract reusable components appropriately
- Handle loading and error states
- Include prop types and basic documentation

## Output Format
- Complete, working code (not snippets)
- Clear file organization
- Import statements included
- Tailwind classes used correctly

Test your mental model of the code before outputting.`,

  [PodRole.BACKEND]: `You are the Backend Pod, responsible for server-side implementation.

## Your Responsibilities
- Design and implement REST/GraphQL APIs
- Handle data persistence and database operations
- Implement business logic with proper validation
- Ensure security best practices (input validation, auth)
- Optimize for performance and scalability
- Write clean, documented code

## Code Standards
- Clear separation of concerns
- Proper error handling and logging
- Input validation at boundaries
- Rate limiting awareness
- Database query optimization

## Output Format
- Complete endpoint implementations
- Schema definitions included
- Error responses documented
- Security considerations noted

Prefer simple, proven solutions over complex ones.`,

  [PodRole.COPY]: `You are the Copy Pod, responsible for all written content.

## Your Responsibilities
- Write clear, engaging copy that fits the context
- Create compelling headlines and CTAs
- Write product descriptions that convert
- Ensure consistent voice and tone throughout
- Optimize for readability (short paragraphs, clear language)
- SEO-optimize content where appropriate

## Content Guidelines
- Match the brand voice (formal/casual/technical)
- Target audience awareness
- Action-oriented language for CTAs
- Benefit-focused over feature-focused
- Proofread for grammar and spelling

## Output Format
- Content in markdown format
- Placeholder markers for dynamic content
- Alternative versions where applicable
- Meta descriptions for SEO

Consider the emotional journey of the reader.`,

  [PodRole.MOTION]: `You are the Motion Pod, responsible for animations and interactions.

## Your Responsibilities
- Design meaningful animations that enhance UX
- Create micro-interactions for feedback
- Ensure smooth transitions between states
- Optimize animation performance (60fps)
- Use Framer Motion patterns appropriately
- Balance delight with usability

## Animation Principles
- Purpose over decoration
- Quick for feedback (<200ms)
- Smooth for transitions (200-500ms)
- Respect reduced motion preferences
- Hardware-accelerated properties only

## Output Format
- Framer Motion component code
- Animation variants defined clearly
- Spring/tween configuration included
- Gesture handlers where needed

Animations should guide attention and provide context.`,

  [PodRole.QA]: `You are the QA Pod, responsible for quality assurance.

## Your Responsibilities
- Review all code for bugs and potential issues
- Verify designs match implementation
- Test functionality across scenarios
- Check accessibility compliance (WCAG 2.1 AA)
- Verify responsive behavior at all breakpoints
- Document any issues found clearly

## Testing Checklist
- [ ] Core functionality works
- [ ] Edge cases handled
- [ ] Error states display correctly
- [ ] Loading states present
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] Mobile responsive
- [ ] No console errors

## Output Format
- Issue severity (critical/high/medium/low)
- Steps to reproduce
- Expected vs actual behavior
- Suggested fix if obvious

Be thorough but constructive in feedback.`,

  [PodRole.RESEARCH]: `You are the Research Pod, responsible for gathering information.

## Your Responsibilities
- Search for relevant information efficiently
- Analyze competitor solutions and best practices
- Find patterns and proven approaches
- Summarize findings clearly and concisely
- Cite sources appropriately
- Provide actionable insights, not just data

## Research Process
1. Define the research question clearly
2. Identify credible sources
3. Cross-reference claims
4. Synthesize findings
5. Present recommendations

## Output Format
- Executive summary first
- Key findings with sources
- Pros/cons where applicable
- Recommended approach
- Confidence level noted

Focus on practical, relevant information that aids decision-making.`,

  [PodRole.DATA]: `You are the Data Pod, responsible for data processing and analysis.

## Your Responsibilities
- Process and transform data efficiently
- Generate analytics and actionable insights
- Create clear visualizations
- Optimize data structures for performance
- Ensure data accuracy and integrity
- Document data flows and transformations

## Data Standards
- Validate input data quality
- Handle missing/null values explicitly
- Use appropriate data types
- Index for query patterns
- Consider privacy implications

## Output Format
- Schema definitions
- Transformation logic
- Sample outputs
- Performance notes

Make data accessible and actionable.`,

  [PodRole.DEPLOYMENT]: `You are the Deployment Pod, responsible for deployment and operations.

## Your Responsibilities
- Configure deployment settings correctly
- Set up CI/CD pipeline configurations
- Handle environment configuration
- Monitor deployment health
- Optimize for production performance
- Document deployment procedures

## Deployment Checklist
- [ ] Environment variables configured
- [ ] Build process verified
- [ ] Static assets optimized
- [ ] Security headers set
- [ ] Error tracking configured
- [ ] Monitoring in place

## Output Format
- Configuration files
- Deployment commands
- Environment requirements
- Rollback procedures

Prioritize reliability and reproducibility.`,
};

// ============================================================================
// TBWO EXECUTOR CLASS
// ============================================================================

class TBWOExecutor {
  private executionStates: Map<string, ExecutionState> = new Map();
  private taskGraph: TaskGraph = new TaskGraph();
  private resourcePool: ResourcePool = new ResourcePool();
  private qualityGate: QualityGate = new QualityGate();
  private executionIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Execute a TBWO from start to finish
   */
  async execute(tbwoId: string): Promise<void> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId);

    if (!tbwo) {
      throw new Error(`TBWO ${tbwoId} not found`);
    }

    if (!tbwo.plan) {
      throw new Error('TBWO has no execution plan');
    }

    console.log(`[TBWO] Starting execution of ${tbwo.type}: ${tbwo.objective}`);

    // Initialize execution state
    const state: ExecutionState = {
      status: 'initializing',
      currentPhaseIndex: 0,
      taskGraph: new Map(),
      schedule: await this.createSchedule(tbwo.plan),
      activePods: new Map(),
      messageBus: new MessageBus(),
      sharedArtifacts: new Map(),
      decisionTrail: [],
      qualityMetrics: new Map(),
      startTime: Date.now(),
      pausedAt: null,
      totalPauseDuration: 0,
    };

    this.executionStates.set(tbwoId, state);

    // Update TBWO status
    store.updateTBWO(tbwoId, {
      status: TBWOStatus.EXECUTING,
      startedAt: Date.now(),
    });

    try {
      // Build task graph
      state.status = 'planning';
      this.taskGraph.buildFromPlan(tbwo.plan);

      // Create working memory for the execution
      const workingMemoryId = memoryService.createWorkingMemory(
        tbwoId,
        tbwo.type,
        { objective: tbwo.objective, qualityTarget: tbwo.qualityTarget }
      );

      // Start time tracking
      this.startTimeTracking(tbwoId);

      // Spawn initial pods
      await this.spawnInitialPods(tbwoId, tbwo);

      // Execute phases
      state.status = 'executing';

      for (let phaseIndex = 0; phaseIndex < tbwo.plan.phases.length; phaseIndex++) {
        state.currentPhaseIndex = phaseIndex;
        const phase = tbwo.plan.phases[phaseIndex];

        // Check if paused or cancelled
        if ((state.status as string) === 'paused' || (state.status as string) === 'cancelled') {
          break;
        }

        const result = await this.executePhase(tbwoId, phase, state);

        if (!result.success) {
          // Phase failed - check if we should continue
          const shouldContinue = await this.handlePhaseFailure(tbwoId, phase, result, state);
          if (!shouldContinue) {
            break;
          }
        }

        // Run quality gate after each phase
        const qualityResult = await this.runQualityGate(tbwoId, phase, state);
        state.qualityMetrics.set(phase.id, qualityResult.score);

        // Check for checkpoints
        if (result.checkpointTriggered) {
          state.status = 'checkpoint';
          await this.handleCheckpoint(tbwoId, phase, state);
          state.status = 'executing';
        }

        // Update overall progress
        const completedPhases = phaseIndex + 1;
        const progress = (completedPhases / tbwo.plan.phases.length) * 100;
        store.updateProgress(tbwoId, progress);
      }

      // Complete execution
      if ((state.status as string) !== 'cancelled' && (state.status as string) !== 'failed') {
        await this.completeExecution(tbwoId, state);
      }
    } catch (error: any) {
      console.error(`[TBWO] Execution failed:`, error);
      state.status = 'failed';

      // Record decision point
      this.recordDecision(state, 'execution_failure', [
        { label: 'Error', rationale: error.message },
      ], 0, 0);

      store.updateTBWO(tbwoId, {
        status: TBWOStatus.FAILED,
        completedAt: Date.now(),
      });
    } finally {
      // Cleanup
      this.stopTimeTracking(tbwoId);
      this.cleanupPods(tbwoId);
      this.executionStates.delete(tbwoId);
    }
  }

  /**
   * Create execution schedule from plan
   */
  private async createSchedule(plan: ExecutionPlan): Promise<ExecutionSchedule> {
    const taskGraph = new TaskGraph();
    taskGraph.buildFromPlan(plan);

    const phases: ExecutionSchedule['phases'] = [];
    const resourceRequirements = new Map<PodRole, number>();

    for (const phase of plan.phases) {
      // Get parallel groups for this phase's tasks
      const phaseTaskIds = phase.tasks.map((t) => t.id);
      const allGroups = taskGraph.getParallelGroups();
      const phaseGroups = allGroups.map((group) =>
        group.filter((taskId) => phaseTaskIds.includes(taskId))
      ).filter((group) => group.length > 0);

      // Find critical path within phase
      const criticalPath = taskGraph.getAllNodes()
        .filter((n) => phaseTaskIds.includes(n.taskId) && n.criticalPath)
        .map((n) => n.taskId);

      phases.push({
        phaseId: phase.id,
        parallelGroups: phaseGroups,
        estimatedDuration: phase.estimatedDuration,
        criticalPath,
      });

      // Calculate resource requirements
      phase.tasks.forEach((task) => {
        const role = this.inferRoleFromTask(task);
        resourceRequirements.set(role, (resourceRequirements.get(role) || 0) + 1);
      });
    }

    return {
      phases,
      totalEstimatedDuration: plan.estimatedDuration,
      resourceRequirements,
    };
  }

  /**
   * Infer pod role from task
   */
  private inferRoleFromTask(task: Task): PodRole {
    const name = task.name.toLowerCase();
    const desc = (task.description || '').toLowerCase();

    if (name.includes('design') || desc.includes('layout') || desc.includes('visual')) {
      return PodRole.DESIGN;
    }
    if (name.includes('implement') || name.includes('build') || desc.includes('code')) {
      return PodRole.FRONTEND;
    }
    if (name.includes('api') || name.includes('backend') || desc.includes('server')) {
      return PodRole.BACKEND;
    }
    if (name.includes('copy') || name.includes('write') || desc.includes('content')) {
      return PodRole.COPY;
    }
    if (name.includes('animate') || name.includes('motion') || desc.includes('animation')) {
      return PodRole.MOTION;
    }
    if (name.includes('test') || name.includes('qa') || desc.includes('review')) {
      return PodRole.QA;
    }
    if (name.includes('research') || desc.includes('analyze')) {
      return PodRole.RESEARCH;
    }
    if (name.includes('data') || desc.includes('database')) {
      return PodRole.DATA;
    }
    if (name.includes('deploy') || desc.includes('production')) {
      return PodRole.DEPLOYMENT;
    }

    return PodRole.ORCHESTRATOR;
  }

  /**
   * Spawn initial pods for execution
   */
  private async spawnInitialPods(tbwoId: string, tbwo: TBWO): Promise<void> {
    const store = useTBWOStore.getState();
    const state = this.executionStates.get(tbwoId)!;

    // Determine which roles are needed
    const neededRoles = new Set<PodRole>([PodRole.ORCHESTRATOR]);

    for (const phase of tbwo.plan!.phases) {
      for (const task of phase.tasks) {
        neededRoles.add(this.inferRoleFromTask(task));
      }
    }

    // Server proxy handles API keys — we just need a placeholder client for pod context
    // Actual AI calls route through serverStreamClient.ts → /api/chat/stream
    const apiKey = 'server-proxy'; // Not used for actual calls

    // Spawn pods
    for (const role of neededRoles) {
      const podId = store.spawnPod(tbwoId, role);
      const podInfo = store.getPodById(podId);

      if (podInfo?.pod) {
        const workingMemoryId = memoryService.createWorkingMemory(
          `${tbwoId}-${podId}`,
          `${role}_pod`,
          { tbwoId, role }
        );

        const context: PodExecutionContext = {
          pod: podInfo.pod,
          tbwo,
          client: createClaudeClient(apiKey, {
            model: 'claude-sonnet-4-20250514',
            maxTokens: 4096,
          }),
          systemPrompt: POD_SYSTEM_PROMPTS[role],
          conversationHistory: [],
          workingMemoryId,
          messageQueue: [],
          artifacts: new Map(),
          metrics: {
            tasksCompleted: 0,
            tasksFailed: 0,
            averageTaskTime: 0,
            totalTokensUsed: 0,
            totalExecutionTime: 0,
            successRate: 1,
            lastActivity: Date.now(),
            qualityScore: 1,
            learningProgress: 0,
          },
        };

        state.activePods.set(podId, context);
        this.resourcePool.addPod(context);

        // Subscribe pod to message bus
        state.messageBus.subscribe(podId, (message) => {
          context.messageQueue.push(message);
        });

        console.log(`[TBWO] Spawned ${role} pod: ${podId}`);
      }
    }
  }

  /**
   * Execute a single phase with parallel task execution
   */
  private async executePhase(
    tbwoId: string,
    phase: Phase,
    state: ExecutionState
  ): Promise<PhaseResult> {
    const store = useTBWOStore.getState();
    const startTime = Date.now();

    console.log(`[TBWO] Executing phase: ${phase.name}`);

    // Update phase status
    store.updatePhaseProgress(phase.id, 0);
    phase.status = 'in_progress';
    phase.startedAt = Date.now();

    const artifacts: Artifact[] = [];
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let tasksSkipped = 0;
    let checkpointTriggered = false;

    // Get parallel groups for this phase
    const phaseSchedule = state.schedule.phases.find((p) => p.phaseId === phase.id);
    const parallelGroups = phaseSchedule?.parallelGroups || [phase.tasks.map((t) => t.id)];

    // Execute groups in sequence, tasks within groups in parallel
    for (const group of parallelGroups) {
      // Get tasks in this group
      const groupTasks = phase.tasks.filter((t) => group.includes(t.id));

      // Check for skipped tasks (dependencies failed)
      const tasksToExecute: Task[] = [];
      for (const task of groupTasks) {
        const deps = task.dependsOn || [];
        const depsFailed = deps.some((depId) => {
          const depNode = this.taskGraph.getNode(depId);
          return depNode && depNode.status === 'failed';
        });

        if (depsFailed) {
          (task as any).status = 'skipped';
          this.taskGraph.updateStatus(task.id, 'skipped' as any);
          tasksSkipped++;
        } else {
          tasksToExecute.push(task);
        }
      }

      // Execute tasks in parallel
      const taskPromises = tasksToExecute.map((task) =>
        this.executeTask(tbwoId, task, state)
      );

      const results = await Promise.allSettled(taskPromises);

      // Process results
      results.forEach((result, index) => {
        const task = tasksToExecute[index];

        if (result.status === 'fulfilled') {
          const taskResult = result.value;

          if (taskResult.success) {
            tasksCompleted++;
            artifacts.push(...taskResult.artifacts);
            task.status = 'complete';
            task.output = taskResult.output;
            this.taskGraph.updateStatus(task.id, 'complete');

            // Add artifacts to shared pool
            taskResult.artifacts.forEach((artifact) => {
              state.sharedArtifacts.set(artifact.id, artifact);
            });

            // Record successful completion
            this.recordDecision(
              state,
              `task_complete_${task.id}`,
              [{ label: 'Success', rationale: `Completed with ${taskResult.confidence * 100}% confidence` }],
              0,
              taskResult.confidence
            );
          } else {
            tasksFailed++;
            task.status = 'failed';
            this.taskGraph.updateStatus(task.id, 'failed');

            // Record failure
            this.recordDecision(
              state,
              `task_failed_${task.id}`,
              [{ label: 'Failed', rationale: taskResult.warnings.join('; ') }],
              0,
              0
            );
          }
        } else {
          tasksFailed++;
          task.status = 'failed';
          this.taskGraph.updateStatus(task.id, 'failed');
          console.error(`[TBWO] Task ${task.name} threw:`, result.reason);
        }
      });

      // Update phase progress
      const completed = phase.tasks.filter((t) =>
        ['complete', 'failed', 'skipped'].includes(t.status)
      ).length;
      const progress = (completed / phase.tasks.length) * 100;
      store.updatePhaseProgress(phase.id, progress);

      // Broadcast progress update
      state.messageBus.publish({
        fromPodId: 'system',
        toPodId: 'broadcast',
        type: 'update',
        payload: { phaseId: phase.id, progress, completed, total: phase.tasks.length },
        priority: 'normal',
      });
    }

    // Finalize phase
    phase.completedAt = Date.now();
    phase.status = tasksFailed === 0 ? 'complete' : 'failed';

    // Check if checkpoint should trigger
    const tbwo = store.getTBWOById(tbwoId);
    if (tbwo?.authorityLevel === 'guided') {
      checkpointTriggered =
        phase.name.toLowerCase().includes('design') ||
        phase.name.toLowerCase().includes('complete') ||
        (phase.order % 2 === 0);
    }

    // Calculate quality score
    const qualityScore = tasksCompleted > 0 ? tasksCompleted / (tasksCompleted + tasksFailed) : 0;

    return {
      phaseId: phase.id,
      phase,
      success: tasksFailed === 0,
      tasksCompleted,
      tasksFailed,
      tasksSkipped,
      artifacts,
      duration: Date.now() - startTime,
      qualityScore,
      checkpointTriggered,
    };
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    tbwoId: string,
    task: Task,
    state: ExecutionState
  ): Promise<TaskExecutionResult> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId);
    const startTime = Date.now();

    console.log(`[TBWO] Executing task: ${task.name}`);

    // Mark task as running
    this.taskGraph.updateStatus(task.id, 'running');
    task.status = 'in_progress';

    // Select pod for task
    const preferredRole = this.inferRoleFromTask(task);
    const context = this.resourcePool.getAvailablePod(task, preferredRole);

    if (!context) {
      return {
        taskId: task.id,
        success: false,
        output: { error: 'No available pod for task execution' },
        artifacts: [],
        executionTime: Date.now() - startTime,
        tokensUsed: 0,
        podId: '',
        confidence: 0,
        qualityScore: 0,
        warnings: ['No pod available'],
        dependencies: { required: task.dependsOn || [], satisfied: [], missing: task.dependsOn || [] },
      };
    }

    // Assign task to pod
    this.taskGraph.assignPod(task.id, context.pod.id);
    this.resourcePool.startTask(task.id, context.pod.id);

    // Update pod status
    store.updatePod(context.pod.id, {
      status: PodStatus.WORKING,
      currentTask: task,
    });

    try {
      // Gather context from shared artifacts
      const relevantArtifacts = this.getRelevantArtifacts(task, state.sharedArtifacts);

      // Check for pending messages
      const pendingMessages = context.messageQueue.filter((m) => !m.acknowledged);
      const messageContext = pendingMessages.length > 0
        ? `\n\n## Messages from Other Pods:\n${pendingMessages.map((m) => `- [${m.type}] From ${m.fromPodId}: ${JSON.stringify(m.payload)}`).join('\n')}`
        : '';

      // Build task prompt with full context
      const taskPrompt = this.buildTaskPrompt(task, context, relevantArtifacts, messageContext);

      // Get tools for this pod
      const tools = this.getToolsForPod(context.pod.role);

      // Execute with AI
      let fullResponse = '';
      const artifacts: Artifact[] = [];
      let tokensUsed = 0;

      const response = await context.client.streamMessage(
        [
          {
            id: nanoid(),
            role: MessageRole.USER,
            content: [{ type: 'text', text: taskPrompt }],
            timestamp: Date.now(),
            conversationId: tbwoId,
          },
        ],
        {
          onText: (text) => {
            fullResponse += text;
          },
          onToolUse: async (tool) => {
            // Contract validation before tool execution
            if (tbwo?.contractId) {
              const validation = contractService.validateAction(tbwo.contractId, {
                toolName: tool.name,
                operation: typeof tool.input === 'object' && tool.input !== null
                  ? (tool.input as Record<string, unknown>)['operation'] as string | undefined
                  : undefined,
              });
              if (!validation.allowed) {
                console.warn(`[TBWO] Contract violation: ${validation.violations.map(v => v.description).join(', ')}`);
                return;
              }
            }

            // Execute tool
            const result = await toolExecutor.execute({
              toolName: tool.name,
              toolInput: tool.input,
              context: {
                tbwoId,
                podId: context.pod.id,
                userId: 'system',
                permissions: {
                  allowFileRead: true,
                  allowFileWrite: true,
                  allowFileDelete: false,
                  allowNetworkAccess: true,
                  allowCodeExecution:
                    context.pod.role === PodRole.FRONTEND ||
                    context.pod.role === PodRole.BACKEND,
                  allowSystemCommands: false,
                  maxFileSize: 10 * 1024 * 1024,
                  maxExecutionTime: 30000,
                },
                limits: {
                  maxMemoryMB: 256,
                  maxCPUPercent: 50,
                  maxDiskMB: 100,
                  maxNetworkMB: 10,
                  timeoutMs: 30000,
                },
                workingDirectory: `/workspace/tbwo/${tbwoId}`,
                environment: {},
              },
            });

            if (result.result.artifacts) {
              artifacts.push(
                ...result.result.artifacts.map((a: any) => ({
                  ...a,
                  tbwoId,
                  createdBy: context.pod.id,
                  createdAt: Date.now(),
                  version: 1,
                  status: 'draft' as const,
                }))
              );
            }
          },
          onUsage: (usage) => {
            tokensUsed = usage.totalTokens;
          },
        },
        context.systemPrompt,
        tools.length > 0 ? tools : undefined
      );

      // Extract artifacts from response
      const extractedArtifacts = this.extractArtifactsFromResponse(
        fullResponse,
        tbwoId,
        context.pod.id
      );
      artifacts.push(...extractedArtifacts);

      // Acknowledge messages
      pendingMessages.forEach((m) => {
        state.messageBus.acknowledge(m.id);
      });

      // Add to conversation history
      context.conversationHistory.push(
        { role: 'user', content: taskPrompt },
        { role: 'assistant', content: fullResponse }
      );

      // Update pod metrics
      const executionTime = Date.now() - startTime;
      context.metrics.tasksCompleted++;
      context.metrics.totalTokensUsed += tokensUsed;
      context.metrics.totalExecutionTime += executionTime;
      context.metrics.averageTaskTime =
        context.metrics.totalExecutionTime / context.metrics.tasksCompleted;
      context.metrics.successRate =
        context.metrics.tasksCompleted /
        (context.metrics.tasksCompleted + context.metrics.tasksFailed);
      context.metrics.lastActivity = Date.now();

      // Update memory
      memoryService.addReasoningStep(context.workingMemoryId, {
        thought: `Completed task: ${task.name}`,
        action: 'Task execution',
        observation: `Generated ${artifacts.length} artifacts`,
        conclusion: 'Task successful',
      });

      // Update pod in store
      store.updatePod(context.pod.id, {
        status: PodStatus.IDLE,
        currentTask: undefined,
        completedTasks: [...context.pod.completedTasks, task],
        resourceUsage: {
          ...context.pod.resourceUsage,
          tokensUsed: context.pod.resourceUsage.tokensUsed + tokensUsed,
          executionTime: context.pod.resourceUsage.executionTime + executionTime / 1000,
        },
      });

      // Complete task in resource pool
      this.resourcePool.completeTask(task.id);

      // Broadcast completion
      state.messageBus.publish({
        fromPodId: context.pod.id,
        toPodId: 'broadcast',
        type: 'update',
        payload: {
          taskId: task.id,
          taskName: task.name,
          status: 'complete',
          artifactCount: artifacts.length,
        },
        priority: 'normal',
      });

      // Share artifacts via message bus
      artifacts.forEach((artifact) => {
        state.messageBus.publish({
          fromPodId: context.pod.id,
          toPodId: 'broadcast',
          type: 'artifact',
          payload: { artifactId: artifact.id, name: artifact.name, type: artifact.type },
          priority: 'low',
        });
      });

      return {
        taskId: task.id,
        success: true,
        output: { response: fullResponse },
        artifacts,
        executionTime,
        tokensUsed,
        podId: context.pod.id,
        confidence: 0.85,
        qualityScore: 0.9,
        warnings: [],
        dependencies: {
          required: task.dependsOn || [],
          satisfied: task.dependsOn || [],
          missing: [],
        },
      };
    } catch (error: any) {
      console.error(`[TBWO] Task ${task.name} failed:`, error);

      // Update metrics
      context.metrics.tasksFailed++;
      context.metrics.successRate =
        context.metrics.tasksCompleted /
        (context.metrics.tasksCompleted + context.metrics.tasksFailed);

      // Update pod in store
      store.updatePod(context.pod.id, {
        status: PodStatus.IDLE,
        currentTask: undefined,
        health: {
          ...context.pod.health,
          errorCount: context.pod.health.errorCount + 1,
          warnings: [...context.pod.health.warnings, error.message],
        },
      });

      this.resourcePool.completeTask(task.id);

      return {
        taskId: task.id,
        success: false,
        output: { error: error.message },
        artifacts: [],
        executionTime: Date.now() - startTime,
        tokensUsed: 0,
        podId: context.pod.id,
        confidence: 0,
        qualityScore: 0,
        warnings: [error.message],
        dependencies: {
          required: task.dependsOn || [],
          satisfied: [],
          missing: task.dependsOn || [],
        },
      };
    }
  }

  /**
   * Get relevant artifacts for a task
   */
  private getRelevantArtifacts(
    task: Task,
    sharedArtifacts: Map<string, Artifact>
  ): Artifact[] {
    const relevant: Artifact[] = [];
    const taskLower = task.name.toLowerCase();

    sharedArtifacts.forEach((artifact) => {
      // Include artifacts from dependencies
      const deps = task.dependsOn || [];
      if (deps.some((depId) => artifact.tbwoId?.includes(depId))) {
        relevant.push(artifact);
        return;
      }

      // Include artifacts by type based on task
      if (taskLower.includes('implement') && artifact.type === 'design') {
        relevant.push(artifact);
      }
      if (taskLower.includes('test') && artifact.type === 'code') {
        relevant.push(artifact);
      }
      if (taskLower.includes('style') && artifact.type === 'design') {
        relevant.push(artifact);
      }
    });

    return relevant.slice(0, 5); // Limit to prevent context overflow
  }

  /**
   * Build comprehensive task prompt
   */
  private buildTaskPrompt(
    task: Task,
    context: PodExecutionContext,
    relevantArtifacts: Artifact[],
    messageContext: string
  ): string {
    let prompt = `# Task: ${task.name}

## Description
${task.description || 'Complete the task as specified.'}

## Context
- TBWO Type: ${context.tbwo.type}
- Objective: ${context.tbwo.objective}
- Quality Target: ${context.tbwo.qualityTarget}
- Time Budget: ${context.tbwo.timeBudget.remaining} minutes remaining

## Your Role: ${context.pod.role}
${POD_SYSTEM_PROMPTS[context.pod.role]}`;

    if (relevantArtifacts.length > 0) {
      prompt += '\n\n## Relevant Artifacts from Other Pods\n';
      relevantArtifacts.forEach((artifact) => {
        prompt += `\n### ${artifact.name} (${artifact.type})\n`;
        if (typeof artifact.content === 'string') {
          prompt += `\`\`\`\n${artifact.content.slice(0, 2000)}\n\`\`\`\n`;
        }
      });
    }

    if (messageContext) {
      prompt += messageContext;
    }

    prompt += `

## Instructions
Complete this task to the best of your ability. Available tools:
- write_file: Create or update files
- read_file: Read file contents
- web_search: Search the web for information
- execute_code: Run code in a sandbox

Think step-by-step. Output complete, working solutions, not snippets.
Coordinate with other pods via the message system if needed.`;

    return prompt;
  }

  /**
   * Get tools for pod role
   */
  private getToolsForPod(role: PodRole): ReturnType<typeof getClaudeTools> {
    const allTools = getClaudeTools();

    const roleTools: Record<PodRole, string[]> = {
      [PodRole.ORCHESTRATOR]: ['web_search', 'read_file', 'write_file'],
      [PodRole.DESIGN]: ['web_search', 'write_file', 'read_file'],
      [PodRole.FRONTEND]: ['write_file', 'read_file', 'execute_code', 'list_files'],
      [PodRole.BACKEND]: ['write_file', 'read_file', 'execute_code', 'list_files'],
      [PodRole.COPY]: ['web_search', 'write_file', 'read_file'],
      [PodRole.MOTION]: ['write_file', 'read_file'],
      [PodRole.QA]: ['read_file', 'execute_code', 'list_files'],
      [PodRole.RESEARCH]: ['web_search', 'news_search', 'read_file'],
      [PodRole.DATA]: ['read_file', 'write_file', 'execute_code'],
      [PodRole.DEPLOYMENT]: ['read_file', 'write_file', 'list_files'],
    };

    const allowed = roleTools[role] || [];
    return allTools.filter((t: any) => allowed.includes(t.name));
  }

  /**
   * Extract artifacts from AI response
   */
  private extractArtifactsFromResponse(
    response: string,
    tbwoId: string,
    podId: string
  ): Artifact[] {
    const artifacts: Artifact[] = [];

    // Extract code blocks
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      const language = match[1] || 'text';
      const code = match[2].trim();

      if (code.length < 10) continue; // Skip trivial blocks

      const extMap: Record<string, string> = {
        javascript: 'js',
        typescript: 'ts',
        jsx: 'jsx',
        tsx: 'tsx',
        python: 'py',
        html: 'html',
        css: 'css',
        json: 'json',
        markdown: 'md',
        yaml: 'yaml',
        shell: 'sh',
        bash: 'sh',
      };

      const ext = extMap[language.toLowerCase()] || 'txt';

      // Try to extract filename from code or preceding text
      let filename = `code_${Date.now()}.${ext}`;
      const filenameMatch = response.slice(Math.max(0, match.index - 100), match.index)
        .match(/(?:file|filename|create|write):\s*[`"]?([^\s`"<>]+\.\w+)/i);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }

      artifacts.push({
        id: nanoid(),
        tbwoId,
        name: filename,
        type: 'code' as any,
        description: `Generated ${language} code`,
        content: code,
        createdBy: podId,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    return artifacts;
  }

  /**
   * Run quality gate for phase
   */
  private async runQualityGate(
    tbwoId: string,
    phase: Phase,
    state: ExecutionState
  ): Promise<QualityGateResult> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId)!;

    // Collect artifacts from this phase
    const phaseArtifacts: Artifact[] = [];
    phase.tasks.forEach((task) => {
      if (task.output && typeof task.output === 'object') {
        // Check for artifacts in task output
      }
    });

    // Also include shared artifacts
    state.sharedArtifacts.forEach((artifact) => {
      phaseArtifacts.push(artifact);
    });

    return this.qualityGate.runChecks(
      phaseArtifacts,
      tbwo.qualityTarget,
      tbwo.type
    );
  }

  /**
   * Handle phase failure
   */
  private async handlePhaseFailure(
    tbwoId: string,
    phase: Phase,
    result: PhaseResult,
    state: ExecutionState
  ): Promise<boolean> {
    const store = useTBWOStore.getState();

    // Record decision
    this.recordDecision(
      state,
      `phase_failed_${phase.id}`,
      [
        { label: 'Retry', rationale: 'Attempt to re-execute failed tasks' },
        { label: 'Skip', rationale: 'Continue with remaining phases' },
        { label: 'Abort', rationale: 'Stop execution entirely' },
      ],
      1, // Default to skip
      0.6
    );

    // Create checkpoint
    const checkpoint: Checkpoint = {
      id: nanoid(),
      tbwoId,
      name: `Phase "${phase.name}" Failed`,
      order: phase.order,
      triggerCondition: CheckpointTrigger.ERROR_THRESHOLD,
      status: 'reached',
      reachedAt: Date.now(),
      summary: `Phase failed: ${result.tasksFailed} task(s) failed, ${result.tasksCompleted} completed`,
      achievements: phase.tasks
        .filter((t) => t.status === 'complete')
        .map((t) => t.name),
      nextSteps: ['Review failures', 'Retry or skip'],
      artifacts: result.artifacts.map((a) => a.id),
    };

    store.updateTBWO(tbwoId, {
      checkpoints: [...(store.getTBWOById(tbwoId)?.checkpoints || []), checkpoint],
    });

    // For now, continue execution
    // In production, this would wait for user decision if authority requires it
    return true;
  }

  /**
   * Handle checkpoint
   */
  private async handleCheckpoint(
    tbwoId: string,
    phase: Phase,
    state: ExecutionState
  ): Promise<void> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId);

    if (!tbwo) return;

    // Create checkpoint
    const checkpoint: Checkpoint = {
      id: nanoid(),
      tbwoId,
      name: `Phase ${phase.order} Complete: ${phase.name}`,
      order: phase.order,
      triggerCondition: CheckpointTrigger.PHASE_COMPLETE,
      status: 'reached',
      reachedAt: Date.now(),
      summary: `Completed phase "${phase.name}"`,
      achievements: phase.tasks
        .filter((t) => t.status === 'complete')
        .map((t) => t.name),
      nextSteps: tbwo.plan?.phases
        .filter((p) => p.order > phase.order)
        .slice(0, 2)
        .map((p) => p.name) || [],
      artifacts: Array.from(state.sharedArtifacts.keys()),
    };

    store.updateTBWO(tbwoId, {
      status: TBWOStatus.CHECKPOINT,
      checkpoints: [...tbwo.checkpoints, checkpoint],
    });

    // Record decision
    this.recordDecision(
      state,
      `checkpoint_${checkpoint.id}`,
      [
        { label: 'Continue', rationale: 'Proceed to next phase' },
        { label: 'Pause', rationale: 'Wait for user review' },
        { label: 'Modify', rationale: 'Adjust approach before continuing' },
      ],
      0, // Default to continue
      0.8
    );

    // Auto-continue for non-guided modes
    if (tbwo.authorityLevel !== 'guided') {
      store.respondToCheckpoint(checkpoint.id, {
        action: 'continue',
        decidedBy: 'auto',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Record a decision point
   */
  private recordDecision(
    state: ExecutionState,
    context: string,
    options: Array<{ label: string; rationale: string }>,
    chosen: number,
    confidence: number
  ): void {
    state.decisionTrail.push({
      id: nanoid(),
      timestamp: Date.now(),
      context,
      options,
      chosen,
      confidence,
    });
  }

  /**
   * Complete execution
   */
  private async completeExecution(tbwoId: string, state: ExecutionState): Promise<void> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId);

    if (!tbwo) return;

    console.log(`[TBWO] Completing execution for ${tbwoId}`);

    state.status = 'completing';
    store.updateTBWO(tbwoId, {
      status: TBWOStatus.COMPLETING,
      progress: 100,
    });

    // Final quality gate
    const allArtifacts = Array.from(state.sharedArtifacts.values());
    const finalQuality = await this.qualityGate.runChecks(
      allArtifacts,
      tbwo.qualityTarget,
      tbwo.type
    );

    // Generate comprehensive receipts
    // NOTE: receiptGenerator.generateReceipts() is available for richer receipt generation,
    // but it requires a fully-built ExecutionContext that the executor doesn't yet construct.
    // Using the inline generateReceipts() method as fallback until ExecutionContext is wired up.
    const receipts = await this.generateReceipts(tbwoId, state, finalQuality);

    // Store final artifacts
    store.updateTBWO(tbwoId, {
      status: TBWOStatus.COMPLETED,
      completedAt: Date.now(),
      receipts,
      artifacts: allArtifacts,
    });

    // Record in memory
    memoryService.addReasoningStep(
      state.activePods.values().next().value?.workingMemoryId || '',
      {
        thought: `TBWO completed successfully`,
        observation: `Generated ${allArtifacts.length} artifacts with quality score ${finalQuality.score}`,
        conclusion: finalQuality.passed ? 'Quality gate passed' : 'Quality gate failed but completed',
      }
    );

    state.status = 'completed';
    console.log(`[TBWO] Execution completed successfully`);
  }

  /**
   * Generate comprehensive receipts
   */
  private async generateReceipts(
    tbwoId: string,
    state: ExecutionState,
    qualityResult: QualityGateResult
  ): Promise<TBWOReceipts> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId)!;

    const podReceipts = new Map();

    state.activePods.forEach((context, podId) => {
      podReceipts.set(podId, {
        podId,
        role: context.pod.role,
        tasksCompleted: context.metrics.tasksCompleted,
        tasksSkipped: 0,
        tasksFailed: context.metrics.tasksFailed,
        artifactsProduced: Array.from(context.artifacts.keys()),
        timeUsed: context.metrics.totalExecutionTime / 1000 / 60, // minutes
        timeAllocated: tbwo.timeBudget.total / state.activePods.size,
        confidenceNotes: [`Success rate: ${(context.metrics.successRate * 100).toFixed(1)}%`],
        warnings: context.pod.health.warnings,
      });
    });

    // Calculate lines of code
    let linesOfCode = 0;
    state.sharedArtifacts.forEach((artifact) => {
      if (artifact.type === 'code' && typeof artifact.content === 'string') {
        linesOfCode += artifact.content.split('\n').length;
      }
    });

    return {
      tbwoId,
      executive: {
        summary: `Completed ${tbwo.type}: ${tbwo.objective}`,
        accomplishments: tbwo.plan?.phases
          .filter((p) => p.status === 'complete')
          .map((p) => `Completed phase: ${p.name}`) || [],
        filesCreated: Array.from(state.sharedArtifacts.values())
          .filter((a) => a.type === 'file' || a.type === 'code').length,
        filesModified: 0,
        linesOfCode,
        simplifications: qualityResult.recommendations,
        unfinishedItems: tbwo.plan?.phases
          .filter((p) => p.status !== 'complete')
          .map((p) => p.name) || [],
        qualityScore: qualityResult.score * 100,
        qualityNotes: [
          `Target: ${tbwo.qualityTarget}`,
          `Achieved: ${qualityResult.passed ? 'Passed' : 'Not passed'}`,
          ...qualityResult.checks.map((c) => `${c.name}: ${c.passed ? '✓' : '✗'}`),
        ],
      },
      technical: {
        buildStatus: qualityResult.passed ? 'success' : 'partial' as any,
        dependencies: [],
        performanceMetrics: {
          totalExecutionTime: (Date.now() - state.startTime - state.totalPauseDuration) / 1000 / 60,
          totalTokensUsed: Array.from(state.activePods.values())
            .reduce((sum, ctx) => sum + ctx.metrics.totalTokensUsed, 0),
          averageTaskTime: Array.from(state.activePods.values())
            .reduce((sum, ctx) => sum + ctx.metrics.averageTaskTime, 0) / state.activePods.size / 1000,
          parallelEfficiency: this.taskGraph.getStats().maxParallelism / state.activePods.size,
        } as any,
      },
      podReceipts,
      rollback: {
        canRollback: true,
        rollbackInstructions: state.sharedArtifacts.size > 0
          ? [{ step: 1, action: 'Delete generated files', target: 'output' }, { step: 2, action: 'Restore from checkpoint', target: 'state' }]
          : [],
        limitations: ['Some external state changes cannot be rolled back'],
      },
      decisionTrail: state.decisionTrail,
      generatedAt: Date.now(),
    } as any;
  }

  /**
   * Start time tracking
   */
  private startTimeTracking(tbwoId: string): void {
    const interval = setInterval(() => {
      const store = useTBWOStore.getState();
      const tbwo = store.getTBWOById(tbwoId);
      const state = this.executionStates.get(tbwoId);

      if (!tbwo || !state || state.status !== 'executing') {
        clearInterval(interval);
        this.executionIntervals.delete(tbwoId);
        return;
      }

      // Calculate elapsed time (excluding pauses)
      const now = Date.now();
      const elapsed = (now - state.startTime - state.totalPauseDuration) / 60000;
      const remaining = Math.max(0, tbwo.timeBudget.total - elapsed);

      store.updateTBWO(tbwoId, {
        timeBudget: {
          ...tbwo.timeBudget,
          elapsed,
          remaining,
        },
      });

      // Check for timeout
      if (remaining <= 0) {
        console.warn(`[TBWO] Time budget exceeded for ${tbwoId}`);
        state.status = 'failed';
        store.updateTBWO(tbwoId, {
          status: TBWOStatus.TIMEOUT,
          completedAt: Date.now(),
        });
        clearInterval(interval);
        this.executionIntervals.delete(tbwoId);
      }
    }, 10000); // Update every 10 seconds

    this.executionIntervals.set(tbwoId, interval);
  }

  /**
   * Stop time tracking
   */
  private stopTimeTracking(tbwoId: string): void {
    const interval = this.executionIntervals.get(tbwoId);
    if (interval) {
      clearInterval(interval);
      this.executionIntervals.delete(tbwoId);
    }
  }

  /**
   * Cleanup pods
   */
  private cleanupPods(tbwoId: string): void {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId);
    const state = this.executionStates.get(tbwoId);

    if (state) {
      state.activePods.forEach((_, podId) => {
        store.terminatePod(podId);
        this.resourcePool.removePod(podId);
      });
      state.activePods.clear();
      state.messageBus.clear();
    }

    if (tbwo) {
      tbwo.activePods.forEach((podId) => {
        store.terminatePod(podId);
      });
    }
  }

  /**
   * Pause execution
   */
  pause(tbwoId: string): void {
    const state = this.executionStates.get(tbwoId);
    if (state && state.status === 'executing') {
      state.status = 'paused';
      state.pausedAt = Date.now();

      const store = useTBWOStore.getState();
      store.updateTBWO(tbwoId, { status: TBWOStatus.PAUSED });
    }
  }

  /**
   * Resume execution
   */
  resume(tbwoId: string): void {
    const state = this.executionStates.get(tbwoId);
    if (state && state.status === 'paused' && state.pausedAt) {
      state.totalPauseDuration += Date.now() - state.pausedAt;
      state.pausedAt = null;
      state.status = 'executing';

      const store = useTBWOStore.getState();
      store.updateTBWO(tbwoId, { status: TBWOStatus.EXECUTING });
    }
  }

  /**
   * Cancel execution
   */
  cancel(tbwoId: string): void {
    const state = this.executionStates.get(tbwoId);
    if (state) {
      state.status = 'cancelled';
    }

    this.stopTimeTracking(tbwoId);
    this.cleanupPods(tbwoId);

    const store = useTBWOStore.getState();
    store.cancelExecution(tbwoId);

    this.executionStates.delete(tbwoId);
  }

  /**
   * Get execution state
   */
  getState(tbwoId: string): ExecutionState | undefined {
    return this.executionStates.get(tbwoId);
  }

  /**
   * Get task graph statistics
   */
  getTaskGraphStats(tbwoId: string): ReturnType<typeof TaskGraph.prototype.getStats> | null {
    const state = this.executionStates.get(tbwoId);
    if (!state) return null;
    return this.taskGraph.getStats();
  }

  /**
   * Get resource pool statistics
   */
  getResourcePoolStats(): ReturnType<typeof ResourcePool.prototype.getStats> {
    return this.resourcePool.getStats();
  }

  /**
   * Get message bus statistics
   */
  getMessageBusStats(tbwoId: string): ReturnType<typeof MessageBus.prototype.getStats> | null {
    const state = this.executionStates.get(tbwoId);
    if (!state) return null;
    return state.messageBus.getStats();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TBWOExecutor {
    return tbwoExecutor;
  }

  /**
   * Create a workflow (TBWO) from a simple config and generate its plan
   */
  async createWorkflow(config: {
    name: string;
    description: string;
    tasks?: Array<{ name: string; description: string }>;
    timeBudgetMinutes?: number;
    qualityTarget?: QualityTarget;
    type?: TBWOType;
  }): Promise<{ id: string; name: string; tasks: Array<{ name: string; description: string }> }> {
    const store = useTBWOStore.getState();

    const tbwoId = store.createTBWO({
      type: config.type || TBWOType.CUSTOM,
      objective: config.description,
      timeBudgetMinutes: config.timeBudgetMinutes || 60,
      qualityTarget: config.qualityTarget || QualityTarget.STANDARD,
    });

    // Generate AI-driven plan
    await this.generatePlan(tbwoId, config.tasks);

    return {
      id: tbwoId,
      name: config.name,
      tasks: config.tasks || [],
    };
  }

  /**
   * Universal Plan Generator — domain-aware planning that switches on TBWO type
   * and builds domain-specific prompts with appropriate phases, pods, and complexity scaling.
   */
  async generatePlan(
    tbwoId: string,
    userTasks?: Array<{ name: string; description: string }>
  ): Promise<void> {
    const store = useTBWOStore.getState();
    const tbwo = store.getTBWOById(tbwoId);
    if (!tbwo) throw new Error(`TBWO ${tbwoId} not found`);

    store.updateTBWO(tbwoId, { status: TBWOStatus.PLANNING });

    try {
      const apiKey = 'server-proxy'; // Actual API key is server-side only
      const client = createClaudeClient(apiKey);
      const totalTime = tbwo.timeBudget.total;

      // Get domain-specific planning context
      const domainCtx = getDomainPlanContext(tbwo.type, totalTime, tbwo.qualityTarget);

      const planPrompt = `You are an expert ${domainCtx.expertRole} planning AI. Create a detailed execution plan that SCALES with the time budget.

## Objective
${tbwo.objective}

## Domain
${domainCtx.domainName} (${tbwo.type})

## Time Budget
${totalTime} minutes total

## Quality Target
${tbwo.qualityTarget}

## CRITICAL: Time Budget = Complexity
The time budget determines how much work you plan, NOT how fast you work. More time means MORE phases, MORE tasks, MORE polish iterations, and HIGHER quality output.

### Complexity Tiers:
- **5-10 min** → "Quick": ${domainCtx.complexityQuick}
- **10-20 min** → "Standard": ${domainCtx.complexityStandard}
- **20-35 min** → "Premium": ${domainCtx.complexityPremium}
- **35-60+ min** → "Comprehensive": ${domainCtx.complexityComprehensive}

This project has ${totalTime} minutes, so plan accordingly. DO NOT create a 35-minute plan for a 15-minute budget. DO NOT create a 10-minute plan for a 40-minute budget.

## Domain Phase Template
${domainCtx.phaseTemplate}

## Domain-Specific Guidelines
${domainCtx.guidelines}

## Available Roles
${domainCtx.availableRoles.join(', ')}

${userTasks && userTasks.length > 0 ? `## User-Specified Tasks\nIncorporate these into the plan:\n${userTasks.map((t: { name: string; description: string }, i: number) => (i + 1) + '. ' + t.name + ': ' + t.description).join('\n')}` : ''}

## Instructions
Return a JSON object with this exact structure (no markdown, just JSON):
{
  "summary": "Brief plan summary including complexity tier and domain approach",
  "confidence": 0.85,
  "phases": [
    {
      "name": "Phase name",
      "description": "Phase description",
      "order": 1,
      "estimatedDuration": 10,
      "tasks": [
        {
          "name": "Task name",
          "description": "Detailed task description with specific deliverables",
          "estimatedDuration": 5,
          "assignedRole": "FRONTEND"
        }
      ]
    }
  ],
  "risks": [
    { "description": "Risk description", "severity": "medium", "mitigation": "How to mitigate" }
  ],
  "deliverables": [
    { "name": "Deliverable name", "description": "Description", "type": "artifact", "required": true }
  ]
}

Assign roles ONLY from: ${domainCtx.availableRoles.join(', ')}.
Task durations MUST sum to approximately ${totalTime} minutes (within 10%).
Every task description must be specific enough that an AI agent can execute it without asking questions.
${domainCtx.deliverableHints}`;

      const response = await client.sendMessage(
        [{
          id: nanoid(),
          role: MessageRole.USER,
          content: [{ type: 'text' as const, text: planPrompt }],
          timestamp: Date.now(),
          conversationId: tbwoId,
        }],
        `You are a ${domainCtx.expertRole} planning assistant. Return only valid JSON.`,
      );

      // Parse the AI response
      let planData: any;
      const responseText = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

      // Try to extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        planData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI did not return valid JSON plan');
      }

      // Build ExecutionPlan from AI response
      const phases: Phase[] = (planData.phases || []).map((p: any, idx: number) => ({
        id: nanoid(),
        name: p.name,
        description: p.description,
        order: p.order || idx + 1,
        estimatedDuration: p.estimatedDuration || totalTime / (planData.phases?.length || 4),
        dependsOn: idx > 0 ? [] : [],
        tasks: (p.tasks || []).map((t: any) => ({
          id: nanoid(),
          name: t.name,
          description: t.description,
          status: 'pending' as const,
          estimatedDuration: t.estimatedDuration || 5,
          assignedPod: undefined,
          dependsOn: [],
        })),
        assignedPods: [],
        status: 'pending' as const,
        progress: 0,
      }));

      const plan: ExecutionPlan = {
        id: nanoid(),
        tbwoId,
        summary: planData.summary || `AI-generated ${domainCtx.domainName} plan`,
        estimatedDuration: totalTime,
        confidence: planData.confidence || 0.8,
        phases,
        podStrategy: {
          mode: phases.length > 2 ? 'parallel' : 'sequential',
          maxConcurrent: domainCtx.maxConcurrentPods,
          priorityOrder: domainCtx.podPriority,
          dependencies: new Map(),
        },
        risks: (planData.risks || []).map((r: any) => ({
          description: r.description,
          severity: r.severity || 'medium',
          mitigation: r.mitigation || 'Monitor and adjust',
        })),
        assumptions: ['API keys are configured', 'User has necessary permissions', ...domainCtx.assumptions],
        deliverables: (planData.deliverables || []).map((d: any) => ({
          name: d.name,
          description: d.description,
          type: d.type || 'artifact',
          required: d.required !== false,
        })),
        requiresApproval: true,
      };

      store.updateTBWO(tbwoId, {
        plan,
        status: TBWOStatus.AWAITING_APPROVAL,
      });
    } catch (error: any) {
      console.error('[TBWO] AI plan generation failed, falling back to template:', error);
      // Fallback to store's built-in plan generation
      await useTBWOStore.getState().generateExecutionPlan(tbwoId);
    }
  }
}

// ============================================================================
// DOMAIN PLAN CONTEXTS
// ============================================================================

interface DomainPlanContext {
  domainName: string;
  expertRole: string;
  phaseTemplate: string;
  guidelines: string;
  availableRoles: string[];
  podPriority: PodRole[];
  maxConcurrentPods: number;
  assumptions: string[];
  deliverableHints: string;
  complexityQuick: string;
  complexityStandard: string;
  complexityPremium: string;
  complexityComprehensive: string;
}

function getDomainPlanContext(
  tbwoType: TBWOType,
  totalTime: number,
  quality: QualityTarget,
): DomainPlanContext {
  switch (tbwoType) {

    // -----------------------------------------------------------------------
    // WEBSITE SPRINT
    // -----------------------------------------------------------------------
    case TBWOType.WEBSITE_SPRINT:
      return {
        domainName: 'Website Sprint',
        expertRole: 'web design and development',
        phaseTemplate: `Follow this phase flow (adapt count to time budget):
1. **Design** — Design tokens (colors, typography, spacing), layout wireframes, component inventory
2. **Content** — Headlines, body copy, CTAs, microcopy, meta descriptions
3. **Build** — HTML/CSS/JS implementation, responsive breakpoints, component assembly
4. **Animate** — Scroll animations, hover states, page transitions, loading states
5. **QA** — Cross-browser testing, performance audit, accessibility check, responsive verification`,
        guidelines: `- Every page needs a clear visual hierarchy and consistent design tokens
- Mobile-first responsive design is mandatory
- Use semantic HTML and accessible markup (WCAG 2.1 AA minimum)
- Animations should enhance UX, not distract — respect prefers-reduced-motion
- Performance budget: < 3s first contentful paint on 3G
- Content must be real (no lorem ipsum) unless user explicitly says placeholder is fine
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Pixel-perfect, micro-interactions on every element, custom illustrations' : quality === QualityTarget.PREMIUM ? 'Polished design system, smooth animations, thorough QA' : quality === QualityTarget.DRAFT ? 'Functional wireframe-quality, skip polish' : 'Production-ready, clean responsive design'}`,
        availableRoles: ['ORCHESTRATOR', 'DESIGN', 'FRONTEND', 'COPY', 'MOTION', 'QA'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.DESIGN, PodRole.FRONTEND, PodRole.COPY, PodRole.MOTION, PodRole.QA],
        maxConcurrentPods: 5,
        assumptions: ['Modern browser targets (Chrome, Firefox, Safari, Edge latest 2 versions)'],
        deliverableHints: 'Deliverable types: "design" (design tokens/wireframes), "code" (HTML/CSS/JS files), "content" (copy deck), "documentation" (style guide).',
        complexityQuick: '2-3 phases, 4-6 tasks. Single page, basic design, no animations.',
        complexityStandard: '3-4 phases, 8-12 tasks. Design tokens + content + multi-page build + basic QA.',
        complexityPremium: '5 phases, 15-25 tasks. Full design system + content + build + animations + QA + fix pass.',
        complexityComprehensive: '5 phases, 25-40 tasks. Research + full design + multi-page build + animations + 2 QA passes + performance audit.',
      };

    // -----------------------------------------------------------------------
    // CODE PROJECT / APP DEVELOPMENT
    // -----------------------------------------------------------------------
    case TBWOType.CODE_PROJECT:
    case TBWOType.API_INTEGRATION:
      return {
        domainName: tbwoType === TBWOType.API_INTEGRATION ? 'API Integration' : 'Code Project',
        expertRole: 'software architecture and engineering',
        phaseTemplate: `Follow this phase flow (adapt count to time budget):
1. **Architecture** — Tech stack decision, folder structure, data models, API contract, dependency list
2. **Implement** — Core modules, business logic, data layer, API routes, state management
3. **Test** — Unit tests, integration tests, edge cases, error handling verification
4. **Docs** — README, API docs, inline comments for complex logic, setup instructions`,
        guidelines: `- Start with a clear architecture document before writing code
- Follow SOLID principles and the project's existing conventions
- Write tests alongside implementation, not as an afterthought
- Error handling must be explicit — no swallowed errors
- API endpoints should follow REST conventions with proper status codes
- Database queries should be parameterized (no SQL injection)
- Use TypeScript types/interfaces for all data structures
- ${tbwoType === TBWOType.API_INTEGRATION ? 'Implement retry logic and rate limiting for external API calls. Handle auth token refresh. Log all external API responses.' : 'Keep dependencies minimal — prefer stdlib over third-party when reasonable.'}
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Full test coverage, comprehensive error handling, performance optimized, documented API' : quality === QualityTarget.PREMIUM ? 'Good test coverage, clean architecture, error handling' : quality === QualityTarget.DRAFT ? 'Working prototype, minimal tests, basic error handling' : 'Production-ready code with reasonable test coverage'}`,
        availableRoles: ['ORCHESTRATOR', 'FRONTEND', 'BACKEND', 'QA', 'DEPLOYMENT'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.BACKEND, PodRole.FRONTEND, PodRole.QA, PodRole.DEPLOYMENT],
        maxConcurrentPods: 4,
        assumptions: ['Node.js runtime available', 'npm/yarn for package management'],
        deliverableHints: 'Deliverable types: "code" (source files), "documentation" (README/API docs), "test" (test suites), "config" (configuration files).',
        complexityQuick: '2-3 phases, 4-6 tasks. Single module, basic implementation, no tests.',
        complexityStandard: '3-4 phases, 8-12 tasks. Architecture + implement + basic tests + README.',
        complexityPremium: '4 phases, 15-25 tasks. Full architecture + multi-module implement + test suite + docs.',
        complexityComprehensive: '4-5 phases, 25-40 tasks. Research + architecture + implement + comprehensive tests + docs + deployment config.',
      };

    // -----------------------------------------------------------------------
    // RESEARCH REPORT
    // -----------------------------------------------------------------------
    case TBWOType.RESEARCH_REPORT:
      return {
        domainName: 'Research Report',
        expertRole: 'research analysis and academic writing',
        phaseTemplate: `Follow this phase flow (adapt count to time budget):
1. **Gather** — Source identification, web search, data collection, literature scan
2. **Analyze** — Pattern identification, data interpretation, comparative analysis, gap assessment
3. **Synthesize** — Outline structure, write sections, integrate findings, form conclusions
4. **Cite** — Source attribution, fact-checking, bibliography, cross-reference verification`,
        guidelines: `- Every claim must be backed by a source or clearly marked as analysis/opinion
- Use web_search tool extensively during Gather phase — at least 5-10 searches
- Organize findings by theme, not by source
- Include counter-arguments and limitations for balance
- Executive summary at the top, detailed findings below
- Use data tables and bullet points for quantitative findings
- All sources must be cited with title, author/org, date, and URL where available
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Peer-review quality, exhaustive sources, data visualizations, 20+ citations' : quality === QualityTarget.PREMIUM ? 'Comprehensive analysis, 10+ sources, structured with sections' : quality === QualityTarget.DRAFT ? 'Quick overview, 3-5 sources, key findings only' : 'Solid report with 5-10 sources, clear structure and citations'}`,
        availableRoles: ['ORCHESTRATOR', 'RESEARCH', 'DATA', 'COPY', 'QA'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.RESEARCH, PodRole.DATA, PodRole.COPY, PodRole.QA],
        maxConcurrentPods: 4,
        assumptions: ['Web search API available', 'User may provide specific source preferences'],
        deliverableHints: 'Deliverable types: "report" (main document), "summary" (executive brief), "data" (raw findings/tables), "bibliography" (source list).',
        complexityQuick: '2-3 phases, 4-6 tasks. Quick gather + summarize. 3-5 sources.',
        complexityStandard: '3-4 phases, 8-12 tasks. Gather + analyze + synthesize + basic citations.',
        complexityPremium: '4 phases, 15-25 tasks. Deep gather + multi-angle analysis + polished report + full citations.',
        complexityComprehensive: '4-5 phases, 25-40 tasks. Exhaustive research + data analysis + comprehensive report + fact-check pass + bibliography.',
      };

    // -----------------------------------------------------------------------
    // BLENDER / 3D (DESIGN_SYSTEM used for Blender Sprint template)
    // -----------------------------------------------------------------------
    case TBWOType.DESIGN_SYSTEM:
      return {
        domainName: '3D / Design System',
        expertRole: '3D modeling, materials, and design systems',
        phaseTemplate: `Follow this phase flow (adapt count to time budget):
1. **Reference** — Gather visual references, define art direction, choose style (realistic/stylized/low-poly)
2. **Model** — Create 3D geometry, topology cleanup, UV unwrapping, scene layout
3. **Material** — Shader setup, texture creation, material library, PBR parameters
4. **Rig & Animate** — Armature creation, weight painting, keyframe animation, motion curves
5. **Render** — Camera setup, lighting, render settings, output format, compositing`,
        guidelines: `- Use Blender Python scripting (bpy) for procedural operations
- Topology should be clean and quad-based where possible
- Materials should use Principled BSDF for PBR workflows
- UV maps should minimize stretching and maximize texture space
- Animations should follow the 12 principles of animation
- Render settings should match the quality target (Eevee for draft, Cycles for premium)
- Export in standard formats (glTF, FBX, OBJ) as appropriate
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Production-quality render, micro-detail, custom shaders, cinematic lighting' : quality === QualityTarget.PREMIUM ? 'Clean topology, PBR materials, smooth animation' : quality === QualityTarget.DRAFT ? 'Basic geometry, simple materials, preview render' : 'Good topology, textured materials, proper lighting'}`,
        availableRoles: ['ORCHESTRATOR', 'DESIGN', 'FRONTEND', 'BACKEND', 'MOTION'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.DESIGN, PodRole.FRONTEND, PodRole.MOTION, PodRole.BACKEND],
        maxConcurrentPods: 4,
        assumptions: ['Blender Python API (bpy) available', 'Output directory writable'],
        deliverableHints: 'Deliverable types: "code" (Blender Python scripts), "design" (reference boards), "asset" (3D model files), "render" (output images/video).',
        complexityQuick: '2-3 phases, 4-6 tasks. Basic model + simple material. No animation.',
        complexityStandard: '3-4 phases, 8-12 tasks. Reference + model + materials + basic render.',
        complexityPremium: '4-5 phases, 15-25 tasks. Full reference + detailed model + PBR materials + animation + render.',
        complexityComprehensive: '5 phases, 25-40 tasks. Research + detailed modeling + custom shaders + rigging + animation + multi-angle render + compositing.',
      };

    // -----------------------------------------------------------------------
    // CONTENT CREATION
    // -----------------------------------------------------------------------
    case TBWOType.CONTENT_CREATION:
      return {
        domainName: 'Content Creation',
        expertRole: 'content strategy and creative writing',
        phaseTemplate: `Follow this phase flow (adapt count to time budget):
1. **Outline** — Define audience, tone, structure, key messages, content format
2. **Research** — Gather facts, quotes, data points, competitor analysis, SEO keywords
3. **Draft** — Write initial content, section by section, following the outline
4. **Revise** — Edit for clarity, flow, tone consistency, fact-check, trim bloat
5. **Format** — Final layout, headings, images/diagrams, metadata, publishing format`,
        guidelines: `- Define the target audience and tone of voice before writing
- Use the inverted pyramid: most important information first
- Every section should have a clear purpose and transition
- Vary sentence length for readability (mix short and long)
- Use active voice, concrete examples, and specific numbers
- Include a compelling hook/opening and clear CTA/conclusion
- SEO: include target keywords naturally, use proper heading hierarchy
- For video scripts: include visual directions and timing notes
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Magazine-quality prose, original research, custom visuals, multiple revision passes' : quality === QualityTarget.PREMIUM ? 'Well-researched, polished writing, proper formatting' : quality === QualityTarget.DRAFT ? 'Quick first draft, basic structure, minimal editing' : 'Clean, well-structured content ready for publication'}`,
        availableRoles: ['ORCHESTRATOR', 'RESEARCH', 'COPY', 'DESIGN', 'QA'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.COPY, PodRole.RESEARCH, PodRole.DESIGN, PodRole.QA],
        maxConcurrentPods: 4,
        assumptions: ['Web search available for research', 'Output in Markdown or HTML format'],
        deliverableHints: 'Deliverable types: "content" (main text), "outline" (structure document), "metadata" (SEO/publishing info), "media" (image descriptions/diagrams).',
        complexityQuick: '2-3 phases, 4-6 tasks. Quick outline + draft. Single piece.',
        complexityStandard: '3-4 phases, 8-12 tasks. Outline + research + draft + basic revision.',
        complexityPremium: '4-5 phases, 15-25 tasks. Full outline + research + draft + revision + formatting + SEO.',
        complexityComprehensive: '5 phases, 25-40 tasks. Strategy + deep research + multi-section draft + 2 revision passes + formatting + media + SEO audit.',
      };

    // -----------------------------------------------------------------------
    // DATA ANALYSIS
    // -----------------------------------------------------------------------
    case TBWOType.DATA_ANALYSIS:
      return {
        domainName: 'Data Analysis',
        expertRole: 'data science and analytical reporting',
        phaseTemplate: `Follow this phase flow (adapt count to time budget):
1. **Load** — Identify data sources, ingest data, validate formats, initial profiling
2. **Clean** — Handle missing values, remove duplicates, normalize formats, outlier detection
3. **Analyze** — Statistical analysis, pattern detection, correlation analysis, hypothesis testing
4. **Visualize** — Charts, graphs, dashboards, interactive plots, annotation
5. **Report** — Executive summary, methodology, findings, recommendations, limitations`,
        guidelines: `- Always profile the data first: shape, types, missing values, distributions
- Document every transformation applied to the data
- Use appropriate statistical methods — don't overfit or cherry-pick results
- Visualizations should be self-explanatory with proper labels, legends, and titles
- Include confidence intervals and p-values where applicable
- Clearly separate correlation from causation in findings
- Use Python (pandas, matplotlib, seaborn) or JavaScript (D3, Chart.js) for processing
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Publication-quality charts, rigorous statistical methods, interactive dashboards' : quality === QualityTarget.PREMIUM ? 'Clean visualizations, proper statistics, detailed methodology' : quality === QualityTarget.DRAFT ? 'Quick summary statistics, basic charts, key findings' : 'Solid analysis with clean charts and clear findings'}`,
        availableRoles: ['ORCHESTRATOR', 'DATA', 'RESEARCH', 'DESIGN', 'QA'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.DATA, PodRole.RESEARCH, PodRole.DESIGN, PodRole.QA],
        maxConcurrentPods: 3,
        assumptions: ['Python or JavaScript runtime for data processing', 'Data provided by user or fetchable via API'],
        deliverableHints: 'Deliverable types: "code" (analysis scripts), "data" (processed datasets), "visualization" (charts/dashboards), "report" (findings document).',
        complexityQuick: '2-3 phases, 4-6 tasks. Load + quick analysis + basic chart.',
        complexityStandard: '3-4 phases, 8-12 tasks. Load + clean + analyze + visualize.',
        complexityPremium: '4-5 phases, 15-25 tasks. Full pipeline + statistical analysis + multiple visualizations + report.',
        complexityComprehensive: '5 phases, 25-40 tasks. Multi-source load + thorough cleaning + advanced analysis + interactive dashboards + detailed report.',
      };

    // -----------------------------------------------------------------------
    // CUSTOM — AI plans freely, time tiers still apply
    // -----------------------------------------------------------------------
    case TBWOType.CUSTOM:
    default:
      return {
        domainName: 'Custom Workflow',
        expertRole: 'project management and workflow design',
        phaseTemplate: `Design the phase structure based on the objective. Common patterns:
- For creative work: Ideate → Create → Refine → Deliver
- For technical work: Plan → Build → Test → Deploy
- For research work: Gather → Analyze → Synthesize → Present
- For mixed work: Discover → Design → Implement → Verify

Choose the pattern that best fits the objective, or create a custom flow.`,
        guidelines: `- Analyze the objective carefully to determine the best workflow
- Choose pods that match the actual work required — don't use all roles
- Each phase should have a clear entry/exit criteria
- Tasks should be independent within a phase where possible (enables parallelism)
- Include at least one verification/QA step unless time is < 10 minutes
- Quality target "${quality}": ${quality === QualityTarget.APPLE_LEVEL ? 'Exceptional quality, multiple review passes, attention to every detail' : quality === QualityTarget.PREMIUM ? 'Professional quality, polished output, thorough review' : quality === QualityTarget.DRAFT ? 'Quick and functional, skip polish' : 'Production-ready quality, clean and complete'}`,
        availableRoles: ['ORCHESTRATOR', 'DESIGN', 'FRONTEND', 'BACKEND', 'COPY', 'MOTION', 'QA', 'RESEARCH', 'DATA', 'DEPLOYMENT'],
        podPriority: [PodRole.ORCHESTRATOR, PodRole.FRONTEND, PodRole.BACKEND, PodRole.QA],
        maxConcurrentPods: 5,
        assumptions: [],
        deliverableHints: 'Choose deliverable types appropriate to the objective: "code", "design", "content", "report", "data", "documentation", "artifact".',
        complexityQuick: '2-3 phases, 4-6 tasks. Single output, one pass, no QA.',
        complexityStandard: '3-4 phases, 8-12 tasks. Plan + execute + basic verify.',
        complexityPremium: '5-7 phases, 15-25 tasks. Full plan + multi-stage execution + QA + fix pass.',
        complexityComprehensive: '7-10 phases, 25-40 tasks. Research + plan + multi-stage execution + 2 QA passes + fix passes + documentation.',
      };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

const tbwoExecutorInstance = new TBWOExecutor();
export const tbwoExecutor = tbwoExecutorInstance;
export { TBWOExecutor };

// ============================================================================
// WEBSITE SPRINT HELPERS
// ============================================================================

/**
 * Create a Website Sprint TBWO
 */
export function createWebsiteSprint(config: {
  objective: string;
  timeBudgetMinutes: number;
  qualityTarget: QualityTarget;
  websiteConfig: Partial<WebsiteSprintConfig>;
}): string {
  const store = useTBWOStore.getState();

  return store.createTBWO({
    type: TBWOType.WEBSITE_SPRINT,
    objective: config.objective,
    timeBudgetMinutes: config.timeBudgetMinutes,
    qualityTarget: config.qualityTarget,
  });
}

/**
 * Generate Website Sprint execution plan
 */
export async function generateWebsiteSprintPlan(
  tbwoId: string,
  config: Partial<WebsiteSprintConfig>
): Promise<ExecutionPlan> {
  const store = useTBWOStore.getState();
  const tbwo = store.getTBWOById(tbwoId);

  if (!tbwo) {
    throw new Error('TBWO not found');
  }

  const totalTime = tbwo.timeBudget.total;

  // ========================================================================
  // DETERMINE COMPLEXITY TIER FROM TIME BUDGET
  // ========================================================================
  
  type ComplexityTier = 'quick' | 'standard' | 'premium' | 'comprehensive';
  
  let tier: ComplexityTier;
  if (totalTime <= 10) tier = 'quick';
  else if (totalTime <= 20) tier = 'standard';
  else if (totalTime <= 35) tier = 'premium';
  else tier = 'comprehensive';

  console.log(`[TBWO] Website Sprint: ${totalTime}min budget → "${tier}" complexity tier`);

  // ========================================================================
  // BUILD PHASES BASED ON TIER
  // ========================================================================
  
  const phases: Phase[] = [];

  // ---------- PHASE: Research & Discovery ----------
  // quick: skip entirely | standard: minimal | premium+: full
  if (tier !== 'quick') {
    const researchTasks: any[] = [
      {
        id: nanoid(),
        name: 'Analyze objective and requirements',
        description: `Break down "${tbwo.objective}" into concrete requirements: target audience, key pages, must-have features, tone/voice.`,
        status: 'pending',
        estimatedDuration: tier === 'standard' ? 2 : 5,
      },
    ];

    if (tier === 'premium' || tier === 'comprehensive') {
      researchTasks.push({
        id: nanoid(),
        name: 'Research reference sites and competitors',
        description: 'Identify 3-5 reference sites for design inspiration and competitive positioning. Note specific patterns to adopt or avoid.',
        status: 'pending',
        estimatedDuration: 5,
      });
    }

    if (tier === 'comprehensive') {
      researchTasks.push({
        id: nanoid(),
        name: 'Define information architecture',
        description: 'Create sitemap, define page hierarchy, plan navigation structure, identify content relationships.',
        status: 'pending',
        estimatedDuration: 5,
      });
    }

    phases.push({
      id: nanoid(),
      name: 'Research & Discovery',
      description: 'Understand requirements and plan approach',
      order: phases.length + 1,
      estimatedDuration: researchTasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: researchTasks,
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: Design System ----------
  // quick: inline with dev | standard: basic tokens | premium+: full system
  if (tier !== 'quick') {
    const designTasks: any[] = [
      {
        id: nanoid(),
        name: 'Create design tokens',
        description: 'Define color palette (background, surface, text, brand, accent, semantic), typography scale (using clamp()), spacing system (8px grid), border radii, shadows. Output as CSS custom properties.',
        status: 'pending',
        estimatedDuration: tier === 'standard' ? 3 : 8,
      },
    ];

    if (tier === 'premium' || tier === 'comprehensive') {
      designTasks.push({
        id: nanoid(),
        name: 'Design page layouts',
        description: 'Create detailed layout specifications for each page section: grid structure, component placement, responsive breakpoints (375px, 768px, 1024px, 1440px). Use CSS Grid/Flexbox terms.',
        status: 'pending',
        estimatedDuration: 10,
      });
      designTasks.push({
        id: nanoid(),
        name: 'Define component specifications',
        description: 'Specify all UI components with states (default, hover, focus, active, disabled). Include: buttons, cards, navigation, forms, badges, tooltips.',
        status: 'pending',
        estimatedDuration: 8,
      });
    }

    if (tier === 'comprehensive') {
      designTasks.push({
        id: nanoid(),
        name: 'Create dark/light theme variants',
        description: 'Define both color schemes with proper contrast ratios. Ensure WCAG AA compliance for both themes.',
        status: 'pending',
        estimatedDuration: 5,
      });
    }

    phases.push({
      id: nanoid(),
      name: 'Design System',
      description: 'Create visual design language and component specifications',
      order: phases.length + 1,
      estimatedDuration: designTasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: designTasks,
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: Content Creation ----------
  // quick: inline with dev | standard: basic copy | premium+: full content
  if (tier !== 'quick') {
    const copyTasks: any[] = [
      {
        id: nanoid(),
        name: 'Write all page copy',
        description: 'Write real, compelling copy for every section. Headlines (3-8 words), subheadlines (10-20 words), body copy, CTAs. No placeholder text, no lorem ipsum. Write like Stripe/Linear.',
        status: 'pending',
        estimatedDuration: tier === 'standard' ? 5 : 10,
      },
    ];

    if (tier === 'premium' || tier === 'comprehensive') {
      copyTasks.push({
        id: nanoid(),
        name: 'Write microcopy and UI text',
        description: 'Button labels, form labels, error messages, empty states, tooltips, navigation labels. Every UI string should feel intentional.',
        status: 'pending',
        estimatedDuration: 5,
      });
    }

    if (tier === 'comprehensive') {
      copyTasks.push({
        id: nanoid(),
        name: 'Create SEO and meta content',
        description: 'Page titles, meta descriptions, Open Graph tags, structured data markup, alt text guidelines.',
        status: 'pending',
        estimatedDuration: 5,
      });
    }

    phases.push({
      id: nanoid(),
      name: 'Content Creation',
      description: 'Write all copy and content',
      order: phases.length + 1,
      estimatedDuration: copyTasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: copyTasks,
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: Development (always present) ----------
  const devTasks: any[] = [];

  if (tier === 'quick') {
    // Quick: single task, build everything in one pass
    devTasks.push({
      id: nanoid(),
      name: 'Build complete page',
      description: `Build a single-page website for: "${tbwo.objective}". Include HTML structure, CSS styles (using custom properties for theming), and JavaScript for interactivity. Dark theme, modern design, responsive. Write real copy, not placeholder text. All in index.html + styles.css + script.js.`,
      status: 'pending',
      estimatedDuration: totalTime * 0.8,
    });
  } else {
    // Standard+: structured development
    devTasks.push({
      id: nanoid(),
      name: 'Implement design system as CSS',
      description: 'Convert design tokens into a variables.css file with all custom properties. Set up @layer base, components, utilities. Include reset styles and base typography.',
      status: 'pending',
      estimatedDuration: tier === 'standard' ? 3 : 5,
    });

    devTasks.push({
      id: nanoid(),
      name: 'Build HTML structure',
      description: 'Create semantic HTML for all pages/sections. Use proper landmarks (header, nav, main, section, article, footer). Include all content from the Copy phase. No placeholder text.',
      status: 'pending',
      estimatedDuration: tier === 'standard' ? 5 : 10,
    });

    devTasks.push({
      id: nanoid(),
      name: 'Implement component styles',
      description: 'Write CSS for all components: navigation, hero, feature cards, testimonials, pricing tables, forms, footer. Mobile-first with min-width breakpoints.',
      status: 'pending',
      estimatedDuration: tier === 'standard' ? 8 : 15,
    });

    devTasks.push({
      id: nanoid(),
      name: 'Add interactivity',
      description: 'Implement JavaScript: mobile navigation toggle, smooth scrolling, form validation, scroll-triggered animations (IntersectionObserver), any interactive features specific to the site.',
      status: 'pending',
      estimatedDuration: tier === 'standard' ? 5 : 10,
    });

    if (tier === 'premium' || tier === 'comprehensive') {
      devTasks.push({
        id: nanoid(),
        name: 'Responsive polish',
        description: 'Test and fix layouts at 375px, 390px, 768px, 1024px, 1440px. Ensure touch targets are 44px+, text is readable, no horizontal overflow. Fix any spacing issues.',
        status: 'pending',
        estimatedDuration: 8,
      });
    }

    if (tier === 'comprehensive') {
      devTasks.push({
        id: nanoid(),
        name: 'Build additional pages',
        description: 'Create secondary pages (About, Contact, individual case studies, etc.) with proper navigation between them. Consistent header/footer across all pages.',
        status: 'pending',
        estimatedDuration: 15,
      });
    }
  }

  phases.push({
    id: nanoid(),
    name: 'Development',
    description: 'Build the website',
    order: phases.length + 1,
    estimatedDuration: devTasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
    dependsOn: [],
    tasks: devTasks,
    assignedPods: [],
    status: 'pending',
    progress: 0,
  });

  // ---------- PHASE: Animation & Polish ----------
  // quick: skip | standard: basic | premium+: full
  if (tier === 'premium' || tier === 'comprehensive') {
    const motionTasks: any[] = [
      {
        id: nanoid(),
        name: 'Add entrance animations',
        description: 'Implement scroll-triggered fade-in and slide-up animations for sections and cards. Use IntersectionObserver. Stagger child elements with 60ms delays. Respect prefers-reduced-motion.',
        status: 'pending',
        estimatedDuration: 8,
      },
      {
        id: nanoid(),
        name: 'Polish hover and focus states',
        description: 'Add transform: translateY(-2px) + shadow elevation on card hover. Button press effects. Focus-visible outlines. All transitions 150-300ms with ease-out.',
        status: 'pending',
        estimatedDuration: 5,
      },
    ];

    if (tier === 'comprehensive') {
      motionTasks.push({
        id: nanoid(),
        name: 'Add advanced motion',
        description: 'Implement parallax-lite on hero, smooth counter animations, gradient shifts on scroll, magnetic hover effects on CTA buttons. Keep it performant - transform and opacity only.',
        status: 'pending',
        estimatedDuration: 8,
      });
    }

    phases.push({
      id: nanoid(),
      name: 'Animation & Polish',
      description: 'Add motion design and visual refinement',
      order: phases.length + 1,
      estimatedDuration: motionTasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: motionTasks,
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: QA Pass 1 ----------
  // quick: skip | standard: basic review | premium+: full QA
  if (tier !== 'quick') {
    const qaTasks: any[] = [
      {
        id: nanoid(),
        name: 'Review and fix issues',
        description: tier === 'standard'
          ? 'Quick review: check all links work, no console errors, responsive at 375px and 1024px. Fix any issues found.'
          : 'Full QA review: Functionality (links, forms, interactive elements), Responsiveness (375px, 768px, 1024px, 1440px), Accessibility (contrast, alt text, keyboard nav, landmarks), Code quality (no inline styles, semantic HTML, valid CSS). Score each category and fix all FAIL items.',
        status: 'pending',
        estimatedDuration: tier === 'standard' ? 5 : 12,
      },
    ];

    phases.push({
      id: nanoid(),
      name: tier === 'standard' ? 'QA & Delivery' : 'QA Pass 1',
      description: 'Test and fix issues',
      order: phases.length + 1,
      estimatedDuration: qaTasks.reduce((sum, t) => sum + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: qaTasks,
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: Fix Pass (apply QA fixes) ----------
  if (tier === 'premium' || tier === 'comprehensive') {
    phases.push({
      id: nanoid(),
      name: 'Fix Pass',
      description: 'Apply all fixes identified in QA Pass 1',
      order: phases.length + 1,
      estimatedDuration: 8,
      dependsOn: [],
      tasks: [
        {
          id: nanoid(),
          name: 'Apply QA fixes',
          description: 'Read the QA report from the previous phase. Apply every code fix that was identified. Prioritize: broken functionality > accessibility > responsiveness > polish.',
          status: 'pending',
          estimatedDuration: 8,
        },
      ],
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: QA Pass 2 (comprehensive only) ----------
  if (tier === 'comprehensive') {
    phases.push({
      id: nanoid(),
      name: 'QA Pass 2 - Final Review',
      description: 'Final quality verification',
      order: phases.length + 1,
      estimatedDuration: 8,
      dependsOn: [],
      tasks: [
        {
          id: nanoid(),
          name: 'Final accessibility audit',
          description: 'Full WCAG 2.1 AA audit: contrast ratios, focus management, screen reader testing, prefers-reduced-motion, prefers-color-scheme. Tab through entire site.',
          status: 'pending',
          estimatedDuration: 5,
        },
        {
          id: nanoid(),
          name: 'Performance review',
          description: 'Check: CSS file size < 50KB, JS < 100KB, no render-blocking resources, images lazy-loaded, fonts preloaded. Minimize DOM depth.',
          status: 'pending',
          estimatedDuration: 3,
        },
      ],
      assignedPods: [],
      status: 'pending',
      progress: 0,
    });
  }

  // ---------- PHASE: Delivery (always present) ----------
  phases.push({
    id: nanoid(),
    name: 'Delivery',
    description: 'Package and deliver final files',
    order: phases.length + 1,
    estimatedDuration: 2,
    dependsOn: [],
    tasks: [
      {
        id: nanoid(),
        name: 'Package deliverables',
        description: 'Ensure all files are complete and saved. List all created files with descriptions. Verify the site works by reading back the index.html file.',
        status: 'pending',
        estimatedDuration: 2,
      },
    ],
    assignedPods: [],
    status: 'pending',
    progress: 0,
  });

  // ========================================================================
  // SET UP TASK DEPENDENCIES
  // ========================================================================
  
  // Each phase depends on the last task of the previous phase
  for (let i = 1; i < phases.length; i++) {
    const prevPhase = phases[i - 1];
    const prevLastTask = prevPhase.tasks[prevPhase.tasks.length - 1];
    if (prevLastTask && phases[i].tasks.length > 0) {
      phases[i].tasks[0].dependsOn = [prevLastTask.id];
    }
  }

  // ========================================================================
  // BUILD EXECUTION PLAN
  // ========================================================================
  
  // Determine which pod roles are needed based on tier
  const podRoles = [PodRole.ORCHESTRATOR, PodRole.FRONTEND];
  if (tier !== 'quick') {
    podRoles.push(PodRole.DESIGN, PodRole.COPY);
  }
  if (tier === 'premium' || tier === 'comprehensive') {
    podRoles.push(PodRole.MOTION, PodRole.QA);
  }
  if (tier === 'comprehensive') {
    podRoles.push(PodRole.RESEARCH);
  }

  const plan: ExecutionPlan = {
    id: nanoid(),
    tbwoId,
    summary: `Website Sprint [${tier}]: ${tbwo.objective} (${totalTime}min, ${phases.length} phases, ${phases.reduce((s, p) => s + p.tasks.length, 0)} tasks)`,
    estimatedDuration: totalTime,
    confidence: tier === 'quick' ? 0.9 : tier === 'standard' ? 0.85 : 0.8,
    phases,
    podStrategy: {
      mode: tier === 'quick' ? 'sequential' : 'parallel',
      maxConcurrent: Math.min(podRoles.length, 5),
      priorityOrder: podRoles,
      dependencies: new Map(),
    },
    risks: [
      {
        description: tier === 'quick' 
          ? 'Limited time may result in basic output' 
          : 'Ambitious scope may require prioritization',
        severity: 'medium',
        mitigation: tier === 'quick'
          ? 'Focus on core functionality and clean code'
          : 'Complete core features first, polish if time allows',
      },
    ],
    assumptions: [
      'Design assets will be AI-generated or SVG/CSS-based',
      'Content will be created by AI based on objective',
      `Complexity tier: ${tier} (${totalTime} minutes)`,
    ],
    deliverables: [
      {
        name: 'Website Files',
        description: tier === 'quick' 
          ? 'index.html + styles.css + script.js'
          : 'Complete website with HTML, CSS, JavaScript, and design tokens',
        type: 'file',
        required: true,
      },
    ],
    requiresApproval: true,
  };

  // Update TBWO with plan
  store.updateTBWO(tbwoId, {
    plan,
    status: TBWOStatus.AWAITING_APPROVAL,
  });

  return plan;
}

// ============================================================================
// RESEARCH DEEP DIVE HELPERS
// ============================================================================

/**
 * Create a Research Deep Dive TBWO
 */
export function createResearchDeepDive(config: {
  topic: string;
  depth: 'quick' | 'standard' | 'deep' | 'exhaustive';
  timeBudgetMinutes: number;
}): string {
  const store = useTBWOStore.getState();

  const qualityMap: Record<string, QualityTarget> = {
    quick: QualityTarget.DRAFT,
    standard: QualityTarget.STANDARD,
    deep: QualityTarget.PREMIUM,
    exhaustive: QualityTarget.APPLE_LEVEL,
  };

  return store.createTBWO({
    type: TBWOType.RESEARCH_REPORT,
    objective: `Research: ${config.topic}`,
    timeBudgetMinutes: config.timeBudgetMinutes,
    qualityTarget: qualityMap[config.depth],
  });
}
