/**
 * BasePod - Abstract base class for all TBWO specialist pods
 *
 * Each pod wraps an AIService instance, manages its own task queue,
 * and communicates with other pods via the MessageBus. Subclasses
 * implement getSystemPrompt(), getSpecializedTools(), and
 * processTaskOutput() to specialize behavior for their role.
 */

import { nanoid } from 'nanoid';
import type {
  AgentPod,
  Task,
  Artifact,
  PodRole,
  PodStatus,
  PodHealth,
  PodOutput,
  PodModelConfig,
} from '../../../types/tbwo';
import { PodStatus as PodStatusEnum } from '../../../types/tbwo';
import { AIService } from '../aiService';
import { MessageBus, BusMessage } from '../messagebus';
import { tbwoUpdateService } from '../websocketService';

// ============================================================================
// CONFIG & RESULT TYPES
// ============================================================================

export interface PodConfig {
  id: string;
  role: PodRole;
  name: string;
  tbwoId: string;
  modelConfig?: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  toolWhitelist?: string[];
}

export interface TaskResult {
  success: boolean;
  output: string;
  artifacts: Artifact[];
  tokensUsed: number;
  duration: number;
  error?: string;
}

// ============================================================================
// TOOL CALL TYPES (used internally)
// ============================================================================

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AIResponse {
  text: string;
  toolCalls: ToolCall[];
  tokensUsed: number;
  stopReason: string;
}

// ============================================================================
// BASE POD
// ============================================================================

export abstract class BasePod {
  readonly id: string;
  readonly role: PodRole;
  readonly name: string;
  readonly tbwoId: string;

  protected aiService: AIService;
  protected messageBus: MessageBus | null = null;
  protected unsubscribe: (() => void) | null = null;

  // ---- State ----
  protected status: PodStatus = PodStatusEnum.INITIALIZING;
  protected health: PodHealth = {
    status: 'healthy',
    lastHeartbeat: Date.now(),
    errorCount: 0,
    consecutiveFailures: 0,
    warnings: [],
  };
  protected currentTask: Task | null = null;
  protected taskQueue: Task[] = [];
  protected completedTasks: Task[] = [];
  protected outputs: PodOutput[] = [];
  protected artifacts: Artifact[] = [];

  // ---- Metrics ----
  protected tokensUsed = 0;
  protected apiCalls = 0;
  protected executionTime = 0;
  protected tasksCompleted = 0;
  protected tasksFailed = 0;

  // ---- Tool whitelist (optional restriction) ----
  protected toolWhitelist: string[] | undefined;

  constructor(config: PodConfig) {
    this.id = config.id;
    this.role = config.role;
    this.name = config.name;
    this.tbwoId = config.tbwoId;
    this.toolWhitelist = config.toolWhitelist;

    // Build model configuration with defaults
    const modelConfig: PodModelConfig = {
      provider: config.modelConfig?.provider ?? 'claude',
      model: config.modelConfig?.model ?? 'claude-sonnet-4-5-20250929',
      temperature: config.modelConfig?.temperature ?? 0.3,
      maxTokens: config.modelConfig?.maxTokens ?? 8192,
      systemPrompt: this.getSystemPrompt(),
    };

    this.aiService = new AIService(modelConfig);
  }

  // ==========================================================================
  // ABSTRACT METHODS  (subclasses MUST implement)
  // ==========================================================================

  /** Returns the specialized system prompt for this pod type. */
  abstract getSystemPrompt(): string;

  /** Returns tool definitions this pod can use. */
  abstract getSpecializedTools(): Record<string, unknown>[];

  /**
   * Parse the AI response text into typed artifacts.
   * Each subclass decides how to interpret its own output.
   */
  protected abstract processTaskOutput(task: Task, response: string): Artifact[];

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Initialize the pod: connect to the message bus, set status to IDLE,
   * and begin sending heartbeats.
   */
  async initialize(messageBus: MessageBus): Promise<void> {
    this.messageBus = messageBus;

    // Subscribe to messages addressed to this pod
    this.unsubscribe = this.messageBus.subscribe(this.id, (message: BusMessage) => {
      this.handleMessage(message);
    });

    this.status = PodStatusEnum.IDLE;
    this.heartbeat();

    tbwoUpdateService.emit({
      tbwoId: this.tbwoId,
      type: 'pod_message',
      data: {
        podId: this.id,
        podName: this.name,
        role: this.role,
        event: 'initialized',
      },
    });
  }

  /**
   * Gracefully shut down the pod. Unsubscribes from the bus, marks
   * status as TERMINATED, and performs cleanup.
   */
  async shutdown(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.status = PodStatusEnum.TERMINATED;
    this.messageBus = null;
    this.currentTask = null;
    this.taskQueue = [];

    tbwoUpdateService.emit({
      tbwoId: this.tbwoId,
      type: 'pod_message',
      data: {
        podId: this.id,
        podName: this.name,
        role: this.role,
        event: 'shutdown',
      },
    });
  }

  // ==========================================================================
  // TASK EXECUTION
  // ==========================================================================

  /**
   * Execute a task end-to-end:
   *  1. Set currentTask, status = WORKING
   *  2. Build prompt from task description + context
   *  3. Send to aiService with getSpecializedTools()
   *  4. Handle tool calls in a loop (max 10 rounds)
   *  5. processTaskOutput() to extract artifacts
   *  6. Update metrics, move to completedTasks
   *  7. Set status = IDLE
   *  8. Return TaskResult
   */
  async executeTask(task: Task): Promise<TaskResult> {
    const startTime = Date.now();
    this.currentTask = task;
    this.status = PodStatusEnum.WORKING;
    task.status = 'in_progress';

    tbwoUpdateService.taskStarted(this.tbwoId, task.name, this.id);

    let totalTokens = 0;
    let fullResponse = '';

    try {
      // Build the initial prompt
      const prompt = this.buildTaskPrompt(task);
      const tools = this.getFilteredTools();

      // Conversation history for multi-turn tool use
      const messages: Array<{ role: string; content: unknown }> = [
        { role: 'user', content: prompt },
      ];

      // Tool-call loop: max 10 rounds
      const MAX_ROUNDS = 10;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const response: AIResponse = await (this.aiService as any).chat(messages, tools);
        totalTokens += response.tokensUsed;
        this.apiCalls += 1;

        // Accumulate text output
        if (response.text) {
          if (fullResponse.length > 0) {
            fullResponse += '\n\n';
          }
          fullResponse += response.text;
        }

        // If no tool calls, we're done
        if (!response.toolCalls || response.toolCalls.length === 0) {
          break;
        }

        // Execute each tool call and build tool results
        const toolResults: Array<{ toolCallId: string; result: string }> = [];
        for (const toolCall of response.toolCalls) {
          const result = await this.executeToolCall(toolCall.name, toolCall.input);
          toolResults.push({ toolCallId: toolCall.id, result });
        }

        // Append assistant message (with tool calls) and tool results to history
        messages.push({
          role: 'assistant',
          content: {
            text: response.text,
            toolCalls: response.toolCalls,
          },
        });
        messages.push({
          role: 'tool',
          content: toolResults,
        });
      }

      // Process output into artifacts
      const taskArtifacts = this.processTaskOutput(task, fullResponse);
      this.artifacts.push(...taskArtifacts);

      // Record output
      const output: PodOutput = {
        id: nanoid(),
        type: 'artifact',
        content: fullResponse,
        timestamp: Date.now(),
        confidence: 0.85,
      };
      this.outputs.push(output);

      // Update task status
      task.status = 'complete';
      task.actualDuration = (Date.now() - startTime) / 1000 / 60; // minutes
      task.output = fullResponse;

      // Update metrics
      const duration = Date.now() - startTime;
      this.tokensUsed += totalTokens;
      this.executionTime += duration;
      this.tasksCompleted += 1;
      this.health.consecutiveFailures = 0;

      // Move to completed
      this.currentTask = null;
      this.completedTasks.push(task);
      this.status = PodStatusEnum.IDLE;

      tbwoUpdateService.taskCompleted(this.tbwoId, task.name, {
        success: true,
        output: fullResponse.slice(0, 500),
      });

      // Emit artifact_created events
      for (const artifact of taskArtifacts) {
        tbwoUpdateService.artifactCreated(this.tbwoId, artifact.name, artifact.type);
      }

      return {
        success: true,
        output: fullResponse,
        artifacts: taskArtifacts,
        tokensUsed: totalTokens,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update health
      this.health.errorCount += 1;
      this.health.consecutiveFailures += 1;
      if (this.health.consecutiveFailures >= 3) {
        this.health.status = 'warning';
      }
      if (this.health.consecutiveFailures >= 5) {
        this.health.status = 'critical';
      }

      // Update task
      task.status = 'failed';
      task.actualDuration = duration / 1000 / 60;
      this.currentTask = null;
      this.tasksFailed += 1;
      this.executionTime += duration;
      this.tokensUsed += totalTokens;
      this.status = PodStatusEnum.IDLE;

      // Record error output
      const errorOutput: PodOutput = {
        id: nanoid(),
        type: 'error',
        content: errorMessage,
        timestamp: Date.now(),
      };
      this.outputs.push(errorOutput);

      tbwoUpdateService.taskFailed(this.tbwoId, task.name, errorMessage);

      return {
        success: false,
        output: fullResponse,
        artifacts: [],
        tokensUsed: totalTokens,
        duration,
        error: errorMessage,
      };
    }
  }

  /** Add a task to the end of the queue. */
  addTask(task: Task): void {
    this.taskQueue.push(task);
  }

  /** Pop the next task from the front of the queue, or null if empty. */
  getNextTask(): Task | null {
    return this.taskQueue.shift() ?? null;
  }

  /** Whether there are queued tasks waiting to run. */
  hasQueuedTasks(): boolean {
    return this.taskQueue.length > 0;
  }

  // ==========================================================================
  // MESSAGE HANDLING
  // ==========================================================================

  /**
   * Route incoming bus messages by type.
   */
  protected handleMessage(message: BusMessage): void {
    switch (message.type) {
      case 'task_assignment': {
        const task = message.payload as Task;
        this.addTask(task);
        break;
      }
      case 'question': {
        const { from, question } = message.payload as { from: string; question: string };
        this.handleQuestion(from, question).catch((err) => {
          console.error(`[${this.name}] Error handling question:`, err);
        });
        break;
      }
      case 'status_update':
        // Informational; pods can override to react to peer status changes
        break;
      case 'result':
        // Another pod shared a result; subclasses may override to consume
        break;
      case 'error':
        // Peer error notification; log it
        console.warn(`[${this.name}] Received error from ${message.from}:`, message.payload);
        break;
      default:
        console.warn(`[${this.name}] Unknown message type: ${message.type}`);
    }
  }

  /**
   * Answer a question from another pod by prompting the AI and sending the
   * answer back via the message bus.
   */
  protected async handleQuestion(from: string, question: string): Promise<void> {
    if (!this.messageBus) return;

    try {
      const response = await (this.aiService as any).chat(
        [{ role: 'user', content: `A colleague (${from}) asks: ${question}\n\nAnswer concisely from your area of expertise.` }],
        [] // no tools for simple Q&A
      );

      this.messageBus.publish({
        from: this.id,
        to: from,
        type: 'result',
        payload: {
          question,
          answer: response.text,
        },
        priority: 'normal',
      });
    } catch (error) {
      console.error(`[${this.name}] Failed to answer question from ${from}:`, error);
    }
  }

  // ==========================================================================
  // TOOL EXECUTION
  // ==========================================================================

  /**
   * Execute a tool call by dispatching to the backend API.
   * Returns the result as a string for inclusion in the AI conversation.
   */
  protected async executeToolCall(
    name: string,
    input: Record<string, unknown>
  ): Promise<string> {
    const BASE_URL = 'http://localhost:3002';

    try {
      let url: string;
      let body: Record<string, unknown>;

      switch (name) {
        case 'file_read':
          url = `${BASE_URL}/api/files/read`;
          body = { path: input['path'] };
          break;

        case 'file_write':
          url = `${BASE_URL}/api/files/write`;
          body = { path: input['path'], content: input['content'] };
          break;

        case 'file_list':
          url = `${BASE_URL}/api/files/list`;
          body = { path: input['path'] };
          break;

        case 'execute_code':
          url = `${BASE_URL}/api/code/execute`;
          body = { language: input['language'], code: input['code'] };
          break;

        case 'run_command':
          url = `${BASE_URL}/api/command/execute`;
          body = { command: input['command'] };
          break;

        case 'scan_directory':
          url = `${BASE_URL}/api/files/scan`;
          body = { path: input['path'] };
          break;

        case 'code_search':
          url = `${BASE_URL}/api/files/search`;
          body = { query: input['query'], path: input['path'] };
          break;

        case 'edit_file':
          url = `${BASE_URL}/api/editor/execute`;
          body = {
            command: 'str_replace',
            path: input['path'],
            old_str: input['old_text'],
            new_str: input['new_text'],
          };
          break;

        default:
          return JSON.stringify({ error: `Unknown tool: ${name}` });
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return JSON.stringify({
          error: `Tool ${name} failed with status ${response.status}`,
          details: errorText,
        });
      }

      const result = await response.json();
      return JSON.stringify(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ error: `Tool ${name} execution failed`, details: message });
    }
  }

  // ==========================================================================
  // HEALTH
  // ==========================================================================

  /** Update the heartbeat timestamp. */
  heartbeat(): void {
    this.health.lastHeartbeat = Date.now();
  }

  /** Get current health snapshot. */
  getHealth(): PodHealth {
    return { ...this.health };
  }

  /** Whether the pod is considered healthy. */
  isHealthy(): boolean {
    return this.health.status === 'healthy' || this.health.status === 'warning';
  }

  // ==========================================================================
  // STATE ACCESSORS
  // ==========================================================================

  /** Get the current pod status. */
  getStatus(): PodStatus {
    return this.status;
  }

  /**
   * Build and return a full AgentPod object from the current internal state.
   * This is the serializable representation used by the TBWO store and UI.
   */
  getAgentPod(): AgentPod {
    return {
      id: this.id,
      role: this.role,
      name: this.name,
      status: this.status,
      health: { ...this.health },
      modelConfig: {
        provider: this.aiService.getConfig().provider,
        model: this.aiService.getConfig().model,
        temperature: this.aiService.getConfig().temperature,
        maxTokens: this.aiService.getConfig().maxTokens,
        systemPrompt: this.getSystemPrompt(),
      },
      toolWhitelist: this.toolWhitelist ?? [],
      memoryScope: [this.tbwoId, this.role],
      currentTask: this.currentTask ?? undefined,
      taskQueue: [...this.taskQueue],
      completedTasks: [...this.completedTasks],
      outputs: [...this.outputs],
      resourceUsage: {
        cpuPercent: 0,
        memoryMB: 0,
        tokensUsed: this.tokensUsed,
        apiCalls: this.apiCalls,
        executionTime: this.executionTime / 1000, // convert ms to seconds
      },
      messageLog: [],
      createdAt: Date.now(),
      tbwoId: this.tbwoId,
    };
  }

  /**
   * Get aggregated metrics for this pod.
   */
  getMetrics(): {
    tasksCompleted: number;
    tasksFailed: number;
    tokensUsed: number;
    apiCalls: number;
    executionTime: number;
    successRate: number;
  } {
    const total = this.tasksCompleted + this.tasksFailed;
    return {
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      tokensUsed: this.tokensUsed,
      apiCalls: this.apiCalls,
      executionTime: this.executionTime,
      successRate: total > 0 ? this.tasksCompleted / total : 1,
    };
  }

  // ==========================================================================
  // CONTEXT BUILDING
  // ==========================================================================

  /**
   * Build the full prompt string that will be sent to the AI for a given task.
   * Includes task metadata, description, available context from artifacts,
   * and instructions for structured output.
   */
  protected buildTaskPrompt(task: Task): string {
    const parts: string[] = [];

    parts.push(`## Task: ${task.name}`);
    parts.push('');

    if (task.description) {
      parts.push(`### Description`);
      parts.push(task.description);
      parts.push('');
    }

    // Include relevant artifacts from this TBWO as context
    if (this.artifacts.length > 0) {
      parts.push('### Available Context (artifacts from previous tasks)');
      for (const artifact of this.artifacts.slice(-10)) {
        parts.push(`- **${artifact.name}** (${artifact.type}): ${artifact.description ?? 'No description'}`);
        if (typeof artifact.content === 'string' && artifact.content.length < 2000) {
          parts.push('```');
          parts.push(artifact.content);
          parts.push('```');
        }
      }
      parts.push('');
    }

    // List available tools
    const tools = this.getFilteredTools();
    if (tools.length > 0) {
      parts.push('### Available Tools');
      for (const tool of tools) {
        const t = tool as { name?: string; description?: string };
        parts.push(`- **${t.name ?? 'unknown'}**: ${t.description ?? ''}`);
      }
      parts.push('');
    }

    parts.push('### Instructions');
    parts.push('- Complete the task fully. Do not leave placeholders or TODOs.');
    parts.push('- Use the available tools when you need to read, write, or execute files.');
    parts.push('- Provide your output in a clear, structured format.');
    parts.push('- If you create files, use the file_write tool.');

    return parts.join('\n');
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Return the specialized tools filtered by the whitelist (if one is set).
   */
  private getFilteredTools(): Record<string, unknown>[] {
    const allTools = this.getSpecializedTools();
    if (!this.toolWhitelist || this.toolWhitelist.length === 0) {
      return allTools;
    }
    return allTools.filter((tool) => {
      const name = (tool as { name?: string }).name;
      return name && this.toolWhitelist!.includes(name);
    });
  }
}
