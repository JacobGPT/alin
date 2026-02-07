/**
 * Task Contract System Types
 * Defines contracts that constrain TBWO execution with time budgets, scope limits, and quality requirements
 */

export interface TaskContract {
  id: string;
  tbwoId: string;
  objective: string;
  timeBudget: TimeBudget;
  scope: ContractScope;
  qualityRequirements: QualityRequirements;
  stopConditions: StopCondition[];
  violations: ContractViolation[];
  status: ContractStatus;
  createdAt: number;
  updatedAt: number;
}

export type ContractStatus = 'draft' | 'active' | 'fulfilled' | 'breached' | 'expired';

export interface TimeBudget {
  total: number; // minutes
  warning: number; // minutes - trigger warning at this threshold
  hardStop: number; // minutes - force stop at this threshold
  elapsed: number;
  remaining: number;
}

export interface ContractScope {
  allowedFiles: string[];
  forbiddenFiles: string[];
  allowedTools: string[];
  forbiddenTools: string[];
  maxCost: number; // dollars
  currentCost: number;
  maxTokens: number;
  currentTokens: number;
  allowedOperations: string[];
}

export interface QualityRequirements {
  minScore: number; // 0-100
  requiredChecks: string[];
  completedChecks: string[];
  passedChecks: string[];
  failedChecks: string[];
}

export interface StopCondition {
  id: string;
  type: 'time_exceeded' | 'cost_exceeded' | 'token_exceeded' | 'quality_failed' | 'scope_violation' | 'error_threshold' | 'custom';
  description: string;
  threshold: number;
  currentValue: number;
  triggered: boolean;
  action: 'warn' | 'pause' | 'stop';
}

export interface ContractViolation {
  id: string;
  contractId: string;
  type: 'scope' | 'time' | 'cost' | 'quality' | 'tool' | 'file';
  severity: 'warning' | 'error' | 'critical';
  description: string;
  timestamp: number;
  context: {
    toolName?: string;
    filePath?: string;
    cost?: number;
    elapsed?: number;
  };
  acknowledged: boolean;
  resolution?: string;
}

export interface ContractValidationResult {
  allowed: boolean;
  violations: ContractViolation[];
  warnings: string[];
}
