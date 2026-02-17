/**
 * Contract Types — TBWO task contract enforcement
 */

export type ContractStatus = 'draft' | 'active' | 'fulfilled' | 'breached' | 'cancelled';

export interface ContractScope {
  allowedFiles: string[];
  forbiddenFiles: string[];
  allowedTools: string[];
  forbiddenTools: string[];
  maxCost: number;
  currentCost: number;
  maxTokens: number;
  currentTokens: number;
  allowedOperations: string[];
}

export interface QualityRequirements {
  minScore: number;
  requiredChecks: string[];
  completedChecks: string[];
  passedChecks: string[];
  failedChecks: string[];
}

export interface StopCondition {
  id: string;
  type: 'time_exceeded' | 'cost_exceeded' | 'token_exceeded' | 'error_threshold' | 'quality_failed';
  description: string;
  threshold: number;
  currentValue: number;
  triggered: boolean;
  action: 'stop' | 'pause' | 'warn';
}

export interface ContractViolation {
  id: string;
  contractId: string;
  type: 'time' | 'cost' | 'scope' | 'file' | 'tool' | 'quality';
  severity: 'warning' | 'error' | 'critical';
  description: string;
  timestamp: number;
  context: Record<string, any>;
  acknowledged: boolean;
}

export interface TaskContract {
  id: string;
  tbwoId: string;
  objective: string;
  timeBudget: {
    total: number;
    warning: number;
    hardStop: number;
    elapsed: number;
    remaining: number;
  };
  scope: ContractScope;
  qualityRequirements: QualityRequirements;
  stopConditions: StopCondition[];
  violations: ContractViolation[];
  status: ContractStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ContractValidationResult {
  allowed: boolean;
  violations: ContractViolation[];
  warnings: string[];
}
