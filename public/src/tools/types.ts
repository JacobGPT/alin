/**
 * Tool System Types
 *
 * Defines the structure for ALIN's tool execution system.
 * Tools are the core capabilities that ALIN uses to interact with the world.
 */

// ============================================================================
// CORE TOOL TYPES
// ============================================================================

export interface Tool {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: ToolInputSchema;
  outputSchema?: ToolOutputSchema;
  requiresApproval?: boolean;
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  execute: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}

export type ToolCategory =
  | 'code_execution'
  | 'file_operations'
  | 'web_search'
  | 'image_generation'
  | 'data_analysis'
  | 'communication'
  | 'system'
  | 'memory'
  | 'deployment';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: ToolPropertySchema;
  default?: unknown;
}

export interface ToolOutputSchema {
  type: 'string' | 'object' | 'array';
  description: string;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

export interface ToolContext {
  // Execution identity
  executionId: string;
  tbwoId?: string;
  podId?: string;
  conversationId?: string;
  userId: string;

  // Permissions
  permissions: ToolPermissions;

  // Resource limits
  limits: ResourceLimits;

  // State
  workingDirectory: string;
  environment: Record<string, string>;

  // Callbacks
  onProgress?: (progress: number, message: string) => void;
  onLog?: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
  onArtifact?: (artifact: ToolArtifact) => void;

  // Cancellation
  signal?: AbortSignal;
}

export interface ToolPermissions {
  allowFileRead: boolean;
  allowFileWrite: boolean;
  allowFileDelete: boolean;
  allowNetworkAccess: boolean;
  allowCodeExecution: boolean;
  allowSystemCommands: boolean;
  allowedDomains?: string[];
  allowedPaths?: string[];
  forbiddenPaths?: string[];
  maxFileSize: number;
  maxExecutionTime: number;
}

export interface ResourceLimits {
  maxMemoryMB: number;
  maxCPUPercent: number;
  maxDiskMB: number;
  maxNetworkMB: number;
  timeoutMs: number;
}

// ============================================================================
// TOOL RESULTS
// ============================================================================

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: ToolError;
  artifacts?: ToolArtifact[];
  usage?: ToolUsage;
  metadata?: Record<string, unknown>;
}

export interface ToolError {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
  suggestedAction?: string;
}

export interface ToolArtifact {
  id: string;
  type: 'file' | 'image' | 'code' | 'data' | 'url';
  name: string;
  mimeType: string;
  size: number;
  content?: string | ArrayBuffer;
  url?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}

export interface ToolUsage {
  executionTimeMs: number;
  memoryUsedMB: number;
  tokensUsed?: number;
  apiCallsMade?: number;
  costUSD?: number;
}

// ============================================================================
// TOOL REGISTRATION
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolRegistry {
  tools: Map<string, Tool>;
  register(tool: Tool): void;
  unregister(name: string): void;
  get(name: string): Tool | undefined;
  getByCategory(category: ToolCategory): Tool[];
  getDefinitions(): ToolDefinition[];
  getClaudeTools(): Array<{
    name: string;
    description: string;
    input_schema: ToolInputSchema;
  }>;
  getOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: ToolInputSchema;
    };
  }>;
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

export interface ToolExecutionRequest {
  toolName: string;
  toolInput: unknown;
  context: Partial<ToolContext>;
}

export interface ToolExecutionResponse {
  requestId: string;
  toolName: string;
  result: ToolResult;
  startedAt: number;
  completedAt: number;
}

export interface ToolExecutor {
  execute(request: ToolExecutionRequest): Promise<ToolExecutionResponse>;
  executeMany(requests: ToolExecutionRequest[]): Promise<ToolExecutionResponse[]>;
  cancel(requestId: string): void;
  cancelAll(): void;
}

// ============================================================================
// APPROVAL SYSTEM
// ============================================================================

export interface ToolApprovalRequest {
  id: string;
  toolName: string;
  toolInput: unknown;
  context: ToolContext;
  riskAssessment: RiskAssessment;
  createdAt: number;
  expiresAt: number;
}

export interface ToolApprovalResponse {
  requestId: string;
  approved: boolean;
  modifiedInput?: unknown;
  reason?: string;
  approvedBy: string;
  approvedAt: number;
}

export interface RiskAssessment {
  level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  factors: string[];
  mitigations: string[];
  recommendation: 'auto_approve' | 'require_approval' | 'deny';
}

// ============================================================================
// RECEIPTS
// ============================================================================

export interface ToolReceipt {
  executionId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  success: boolean;
  error?: ToolError;
  artifacts: ToolArtifact[];
  usage: ToolUsage;
  context: {
    tbwoId?: string;
    podId?: string;
    conversationId?: string;
    userId: string;
  };
  timestamps: {
    requested: number;
    approved?: number;
    started: number;
    completed: number;
  };
  approval?: {
    required: boolean;
    approved: boolean;
    approvedBy?: string;
  };
}
