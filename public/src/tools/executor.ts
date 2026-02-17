/**
 * Tool Executor - Central Execution Engine
 *
 * Handles the execution of tools with:
 * - Permission checking
 * - Risk assessment
 * - Approval flow
 * - Resource management
 * - Receipt generation
 * - Cancellation support
 */

import { nanoid } from 'nanoid';
import { toolRegistry } from './registry';
import type {
  Tool,
  ToolContext,
  ToolResult,
  ToolExecutionRequest,
  ToolExecutionResponse,
  ToolExecutor as IToolExecutor,
  ToolPermissions,
  ResourceLimits,
  ToolReceipt,
  RiskAssessment,
  ToolApprovalRequest,
} from './types';

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

const DEFAULT_PERMISSIONS: ToolPermissions = {
  allowFileRead: true,
  allowFileWrite: true,
  allowFileDelete: false,
  allowNetworkAccess: true,
  allowCodeExecution: false,
  allowSystemCommands: false,
  maxFileSize: 100 * 1024 * 1024, // 100MB
  maxExecutionTime: 60000, // 60 seconds
};

const DEFAULT_LIMITS: ResourceLimits = {
  maxMemoryMB: 512,
  maxCPUPercent: 80,
  maxDiskMB: 1024,
  maxNetworkMB: 100,
  timeoutMs: 60000,
};

// ============================================================================
// TOOL EXECUTOR IMPLEMENTATION
// ============================================================================

class ToolExecutorImpl implements IToolExecutor {
  private activeExecutions: Map<string, AbortController> = new Map();
  private receipts: ToolReceipt[] = [];
  private pendingApprovals: Map<string, ToolApprovalRequest> = new Map();

  // Callbacks
  private onApprovalRequired?: (request: ToolApprovalRequest) => Promise<boolean>;
  private onReceiptGenerated?: (receipt: ToolReceipt) => void;

  /**
   * Configure the executor
   */
  configure(options: {
    onApprovalRequired?: (request: ToolApprovalRequest) => Promise<boolean>;
    onReceiptGenerated?: (receipt: ToolReceipt) => void;
  }): void {
    this.onApprovalRequired = options.onApprovalRequired;
    this.onReceiptGenerated = options.onReceiptGenerated;
  }

  /**
   * Execute a single tool
   */
  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
    const requestId = nanoid();
    const startedAt = Date.now();

    // Get the tool
    const tool = toolRegistry.get(request.toolName);
    if (!tool) {
      return {
        requestId,
        toolName: request.toolName,
        result: {
          success: false,
          output: null,
          error: {
            code: 'TOOL_NOT_FOUND',
            message: `Tool "${request.toolName}" not found`,
            recoverable: false,
          },
        },
        startedAt,
        completedAt: Date.now(),
      };
    }

    // Build full context
    const context = this.buildContext(request.context, requestId);

    // Create abort controller
    const abortController = new AbortController();
    this.activeExecutions.set(requestId, abortController);
    context.signal = abortController.signal;

    try {
      // Check permissions
      const permissionError = this.checkPermissions(tool, context);
      if (permissionError) {
        return this.createErrorResponse(requestId, request.toolName, permissionError, startedAt);
      }

      // Assess risk
      const riskAssessment = this.assessRisk(tool, request.toolInput, context);

      // Check if approval is required
      if (riskAssessment.recommendation === 'require_approval' || tool.requiresApproval) {
        const approved = await this.requestApproval(requestId, tool, request.toolInput, context, riskAssessment);
        if (!approved) {
          return this.createErrorResponse(
            requestId,
            request.toolName,
            {
              code: 'APPROVAL_DENIED',
              message: 'Tool execution was not approved',
              recoverable: false,
            },
            startedAt
          );
        }
      } else if (riskAssessment.recommendation === 'deny') {
        return this.createErrorResponse(
          requestId,
          request.toolName,
          {
            code: 'RISK_TOO_HIGH',
            message: `Tool execution denied due to risk level: ${riskAssessment.level}`,
            details: riskAssessment.factors,
            recoverable: false,
          },
          startedAt
        );
      }

      // Execute with timeout
      const result = await this.executeWithTimeout(tool, request.toolInput, context);

      // Generate receipt
      const receipt = this.generateReceipt(requestId, tool, request.toolInput, result, context, startedAt);
      this.receipts.push(receipt);
      this.onReceiptGenerated?.(receipt);

      return {
        requestId,
        toolName: request.toolName,
        result,
        startedAt,
        completedAt: Date.now(),
      };
    } catch (error: any) {
      const result: ToolResult = {
        success: false,
        output: null,
        error: {
          code: error.name === 'AbortError' ? 'CANCELLED' : 'EXECUTION_ERROR',
          message: error.message || 'Unknown error',
          recoverable: error.name !== 'AbortError',
        },
      };

      return {
        requestId,
        toolName: request.toolName,
        result,
        startedAt,
        completedAt: Date.now(),
      };
    } finally {
      this.activeExecutions.delete(requestId);
    }
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeMany(requests: ToolExecutionRequest[]): Promise<ToolExecutionResponse[]> {
    return Promise.all(requests.map((request) => this.execute(request)));
  }

  /**
   * Execute multiple tools in sequence
   */
  async executeSequence(requests: ToolExecutionRequest[]): Promise<ToolExecutionResponse[]> {
    const results: ToolExecutionResponse[] = [];
    for (const request of requests) {
      const result = await this.execute(request);
      results.push(result);
      if (!result.result.success) {
        break; // Stop on first failure
      }
    }
    return results;
  }

  /**
   * Cancel a specific execution
   */
  cancel(requestId: string): void {
    const controller = this.activeExecutions.get(requestId);
    if (controller) {
      controller.abort();
      this.activeExecutions.delete(requestId);
    }
  }

  /**
   * Cancel all active executions
   */
  cancelAll(): void {
    for (const [requestId, controller] of this.activeExecutions) {
      controller.abort();
      this.activeExecutions.delete(requestId);
    }
  }

  /**
   * Get execution receipts
   */
  getReceipts(options?: {
    toolName?: string;
    tbwoId?: string;
    since?: number;
    limit?: number;
  }): ToolReceipt[] {
    let filtered = [...this.receipts];

    if (options?.toolName) {
      filtered = filtered.filter((r) => r.toolName === options.toolName);
    }
    if (options?.tbwoId) {
      filtered = filtered.filter((r) => r.context.tbwoId === options.tbwoId);
    }
    if (options?.since) {
      filtered = filtered.filter((r) => r.timestamps.completed >= options.since!);
    }

    // Sort by completion time descending
    filtered.sort((a, b) => b.timestamps.completed - a.timestamps.completed);

    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Clear old receipts
   */
  clearReceipts(before?: number): void {
    if (before) {
      this.receipts = this.receipts.filter((r) => r.timestamps.completed >= before);
    } else {
      this.receipts = [];
    }
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private buildContext(partial: Partial<ToolContext>, executionId: string): ToolContext {
    return {
      executionId,
      userId: partial.userId || 'anonymous',
      tbwoId: partial.tbwoId,
      podId: partial.podId,
      conversationId: partial.conversationId,
      permissions: { ...DEFAULT_PERMISSIONS, ...partial.permissions },
      limits: { ...DEFAULT_LIMITS, ...partial.limits },
      workingDirectory: partial.workingDirectory || '/workspace',
      environment: partial.environment || {},
      onProgress: partial.onProgress,
      onLog: partial.onLog,
      onArtifact: partial.onArtifact,
    };
  }

  private checkPermissions(tool: Tool, context: ToolContext): ToolResult['error'] | null {
    const { permissions } = context;

    // Check category-based permissions
    if (tool.category === 'code_execution' && !permissions.allowCodeExecution) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'Code execution is not permitted',
        recoverable: false,
      };
    }

    if (tool.category === 'file_operations') {
      // Additional file permission checks would go here
    }

    if (tool.category === 'system' && !permissions.allowSystemCommands) {
      return {
        code: 'PERMISSION_DENIED',
        message: 'System commands are not permitted',
        recoverable: false,
      };
    }

    return null;
  }

  private assessRisk(tool: Tool, input: unknown, context: ToolContext): RiskAssessment {
    const factors: string[] = [];
    const mitigations: string[] = [];

    // Base risk from tool definition
    let level = tool.riskLevel;

    // Assess input-specific risks
    if (tool.category === 'code_execution') {
      factors.push('Executes arbitrary code');
      mitigations.push('Sandboxed execution environment');
    }

    if (tool.category === 'file_operations') {
      const inputObj = input as Record<string, unknown>;
      if (inputObj.path && typeof inputObj.path === 'string') {
        if (inputObj.path.includes('..')) {
          factors.push('Path contains directory traversal');
          level = 'high';
        }
        if (inputObj.path.startsWith('/etc') || inputObj.path.startsWith('/system')) {
          factors.push('Attempts to access system directories');
          level = 'critical';
        }
      }
    }

    if (tool.category === 'web_search' || tool.category === 'communication') {
      factors.push('Network access required');
      mitigations.push('Domain allowlist enforced');
    }

    // Determine recommendation
    let recommendation: RiskAssessment['recommendation'];
    switch (level) {
      case 'safe':
      case 'low':
        recommendation = 'auto_approve';
        break;
      case 'medium':
        recommendation = tool.requiresApproval ? 'require_approval' : 'auto_approve';
        break;
      case 'high':
        recommendation = 'require_approval';
        break;
      case 'critical':
        recommendation = 'deny';
        break;
      default:
        recommendation = 'require_approval';
    }

    return { level, factors, mitigations, recommendation };
  }

  private async requestApproval(
    requestId: string,
    tool: Tool,
    input: unknown,
    context: ToolContext,
    riskAssessment: RiskAssessment
  ): Promise<boolean> {
    if (!this.onApprovalRequired) {
      // No approval handler, auto-approve low/medium risk
      return riskAssessment.level !== 'critical';
    }

    const approvalRequest: ToolApprovalRequest = {
      id: requestId,
      toolName: tool.name,
      toolInput: input,
      context,
      riskAssessment,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000, // 5 minutes
    };

    this.pendingApprovals.set(requestId, approvalRequest);

    try {
      return await this.onApprovalRequired(approvalRequest);
    } finally {
      this.pendingApprovals.delete(requestId);
    }
  }

  private async executeWithTimeout(
    tool: Tool,
    input: unknown,
    context: ToolContext
  ): Promise<ToolResult> {
    const timeoutMs = Math.min(context.limits.timeoutMs, context.permissions.maxExecutionTime);

    return Promise.race([
      tool.execute(input, context),
      new Promise<ToolResult>((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        // Clean up timeout if aborted
        context.signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
    ]);
  }

  private createErrorResponse(
    requestId: string,
    toolName: string,
    error: NonNullable<ToolResult['error']>,
    startedAt: number
  ): ToolExecutionResponse {
    return {
      requestId,
      toolName,
      result: {
        success: false,
        output: null,
        error,
      },
      startedAt,
      completedAt: Date.now(),
    };
  }

  private generateReceipt(
    executionId: string,
    tool: Tool,
    input: unknown,
    result: ToolResult,
    context: ToolContext,
    startedAt: number
  ): ToolReceipt {
    return {
      executionId,
      toolName: tool.name,
      input,
      output: result.output,
      success: result.success,
      error: result.error,
      artifacts: result.artifacts || [],
      usage: result.usage || {
        executionTimeMs: Date.now() - startedAt,
        memoryUsedMB: 0,
      },
      context: {
        tbwoId: context.tbwoId,
        podId: context.podId,
        conversationId: context.conversationId,
        userId: context.userId,
      },
      timestamps: {
        requested: startedAt,
        started: startedAt,
        completed: Date.now(),
      },
      approval: {
        required: tool.requiresApproval || false,
        approved: result.success,
      },
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const toolExecutor = new ToolExecutorImpl();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Execute a tool by name
 */
export async function executeTool(
  toolName: string,
  input: unknown,
  context?: Partial<ToolContext>
): Promise<ToolExecutionResponse> {
  return toolExecutor.execute({
    toolName,
    toolInput: input,
    context: context || {},
  });
}

/**
 * Execute multiple tools in parallel
 */
export async function executeToolsParallel(
  requests: Array<{ name: string; input: unknown; context?: Partial<ToolContext> }>
): Promise<ToolExecutionResponse[]> {
  return toolExecutor.executeMany(
    requests.map((r) => ({
      toolName: r.name,
      toolInput: r.input,
      context: r.context || {},
    }))
  );
}
