/**
 * Contract Service - Validates actions against TBWO task contracts
 */

import { nanoid } from 'nanoid';
import type {
  TaskContract,
  ContractViolation,
  ContractValidationResult,
  ContractScope,
  StopCondition,
} from '../types/contracts';

class ContractService {
  private contracts: Map<string, TaskContract> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Create a new contract for a TBWO
   */
  createContract(config: {
    tbwoId: string;
    objective: string;
    timeBudgetMinutes: number;
    scope?: Partial<ContractScope>;
    minQualityScore?: number;
    maxCost?: number;
  }): TaskContract {
    const now = Date.now();
    const contract: TaskContract = {
      id: nanoid(),
      tbwoId: config.tbwoId,
      objective: config.objective,
      timeBudget: {
        total: config.timeBudgetMinutes,
        warning: config.timeBudgetMinutes * 0.8,
        hardStop: config.timeBudgetMinutes * 0.95,
        elapsed: 0,
        remaining: config.timeBudgetMinutes,
      },
      scope: {
        allowedFiles: config.scope?.allowedFiles || ['*'],
        forbiddenFiles: config.scope?.forbiddenFiles || [],
        allowedTools: config.scope?.allowedTools || ['*'],
        forbiddenTools: config.scope?.forbiddenTools || [],
        maxCost: config.maxCost || 10,
        currentCost: 0,
        maxTokens: 500000,
        currentTokens: 0,
        allowedOperations: config.scope?.allowedOperations || ['*'],
      },
      qualityRequirements: {
        minScore: config.minQualityScore || 70,
        requiredChecks: ['syntax', 'completeness'],
        completedChecks: [],
        passedChecks: [],
        failedChecks: [],
      },
      stopConditions: this.buildDefaultStopConditions(config.timeBudgetMinutes, config.maxCost || 10),
      violations: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };

    this.contracts.set(contract.id, contract);
    return contract;
  }

  /**
   * Activate a contract and start time tracking
   */
  activateContract(contractId: string): void {
    const contract = this.contracts.get(contractId);
    if (!contract) return;

    contract.status = 'active';
    contract.updatedAt = Date.now();

    // Start 10-second time budget check
    const timer = setInterval(() => {
      this.checkTimeBudget(contractId);
    }, 10000);
    this.timers.set(contractId, timer);
  }

  /**
   * Validate an action against the contract
   */
  validateAction(
    contractId: string,
    action: {
      toolName?: string;
      filePath?: string;
      operation?: string;
      estimatedCost?: number;
      estimatedTokens?: number;
    }
  ): ContractValidationResult {
    const contract = this.contracts.get(contractId);
    if (!contract || contract.status !== 'active') {
      return { allowed: true, violations: [], warnings: [] };
    }

    const violations: ContractViolation[] = [];
    const warnings: string[] = [];

    // Check tool allowance
    if (action.toolName) {
      const toolAllowed =
        contract.scope.allowedTools.includes('*') ||
        contract.scope.allowedTools.includes(action.toolName);
      const toolForbidden = contract.scope.forbiddenTools.includes(action.toolName);

      if (!toolAllowed || toolForbidden) {
        violations.push(this.createViolation(contract.id, 'tool', 'error',
          `Tool "${action.toolName}" is not allowed by contract`, { toolName: action.toolName }));
      }
    }

    // Check file path
    if (action.filePath) {
      const fileAllowed =
        contract.scope.allowedFiles.includes('*') ||
        contract.scope.allowedFiles.some(p => action.filePath!.startsWith(p));
      const fileForbidden = contract.scope.forbiddenFiles.some(p => action.filePath!.startsWith(p));

      if (!fileAllowed || fileForbidden) {
        violations.push(this.createViolation(contract.id, 'file', 'error',
          `File "${action.filePath}" is outside contract scope`, { filePath: action.filePath }));
      }
    }

    // Check cost
    if (action.estimatedCost) {
      const projectedCost = contract.scope.currentCost + action.estimatedCost;
      if (projectedCost > contract.scope.maxCost) {
        violations.push(this.createViolation(contract.id, 'cost', 'critical',
          `Action would exceed cost budget ($${projectedCost.toFixed(2)} > $${contract.scope.maxCost})`,
          { cost: projectedCost }));
      } else if (projectedCost > contract.scope.maxCost * 0.8) {
        warnings.push(`Cost nearing budget: $${projectedCost.toFixed(2)} / $${contract.scope.maxCost}`);
      }
    }

    // Check tokens
    if (action.estimatedTokens) {
      const projectedTokens = contract.scope.currentTokens + action.estimatedTokens;
      if (projectedTokens > contract.scope.maxTokens) {
        violations.push(this.createViolation(contract.id, 'scope', 'error',
          `Action would exceed token budget (${projectedTokens} > ${contract.scope.maxTokens})`,
          {}));
      }
    }

    // Check time budget
    if (contract.timeBudget.remaining <= 0) {
      violations.push(this.createViolation(contract.id, 'time', 'critical',
        'Time budget exhausted', { elapsed: contract.timeBudget.elapsed }));
    }

    // Record violations
    violations.forEach(v => {
      contract.violations.push(v);
    });

    const hasCritical = violations.some(v => v.severity === 'critical');
    return {
      allowed: violations.length === 0 || !hasCritical,
      violations,
      warnings,
    };
  }

  /**
   * Record cost/token usage against the contract
   */
  recordUsage(contractId: string, cost: number, tokens: number): void {
    const contract = this.contracts.get(contractId);
    if (!contract) return;

    contract.scope.currentCost += cost;
    contract.scope.currentTokens += tokens;
    contract.updatedAt = Date.now();

    // Check stop conditions
    this.evaluateStopConditions(contract);
  }

  /**
   * Check time budget
   */
  checkTimeBudget(contractId: string): { exceeded: boolean; warning: boolean; remaining: number } {
    const contract = this.contracts.get(contractId);
    if (!contract) return { exceeded: false, warning: false, remaining: Infinity };

    const elapsed = (Date.now() - contract.createdAt) / 60000;
    contract.timeBudget.elapsed = elapsed;
    contract.timeBudget.remaining = contract.timeBudget.total - elapsed;

    const warning = elapsed >= contract.timeBudget.warning;
    const exceeded = elapsed >= contract.timeBudget.hardStop;

    if (exceeded && contract.status === 'active') {
      contract.status = 'breached';
      this.createViolation(contract.id, 'time', 'critical',
        `Time budget hard stop reached (${elapsed.toFixed(1)} min / ${contract.timeBudget.total} min)`,
        { elapsed });
      this.stopTimer(contractId);
    }

    return { exceeded, warning, remaining: contract.timeBudget.remaining };
  }

  /**
   * Record a violation
   */
  recordViolation(
    contractId: string,
    type: ContractViolation['type'],
    severity: ContractViolation['severity'],
    description: string,
    context: ContractViolation['context'] = {}
  ): ContractViolation {
    const violation = this.createViolation(contractId, type, severity, description, context);
    const contract = this.contracts.get(contractId);
    if (contract) {
      contract.violations.push(violation);
    }
    return violation;
  }

  /**
   * Fulfill a contract
   */
  fulfillContract(contractId: string): void {
    const contract = this.contracts.get(contractId);
    if (!contract) return;

    contract.status = 'fulfilled';
    contract.updatedAt = Date.now();
    this.stopTimer(contractId);
  }

  /**
   * Get contract by ID
   */
  getContract(contractId: string): TaskContract | undefined {
    return this.contracts.get(contractId);
  }

  /**
   * Get contract by TBWO ID
   */
  getContractByTBWO(tbwoId: string): TaskContract | undefined {
    for (const contract of this.contracts.values()) {
      if (contract.tbwoId === tbwoId) return contract;
    }
    return undefined;
  }

  /**
   * Get all violations for a contract
   */
  getViolations(contractId: string): ContractViolation[] {
    return this.contracts.get(contractId)?.violations || [];
  }

  private createViolation(
    contractId: string,
    type: ContractViolation['type'],
    severity: ContractViolation['severity'],
    description: string,
    context: ContractViolation['context']
  ): ContractViolation {
    return {
      id: nanoid(),
      contractId,
      type,
      severity,
      description,
      timestamp: Date.now(),
      context,
      acknowledged: false,
    };
  }

  private buildDefaultStopConditions(timeBudget: number, maxCost: number): StopCondition[] {
    return [
      {
        id: nanoid(),
        type: 'time_exceeded',
        description: 'Time budget exceeded',
        threshold: timeBudget,
        currentValue: 0,
        triggered: false,
        action: 'stop',
      },
      {
        id: nanoid(),
        type: 'cost_exceeded',
        description: 'Cost budget exceeded',
        threshold: maxCost,
        currentValue: 0,
        triggered: false,
        action: 'stop',
      },
      {
        id: nanoid(),
        type: 'error_threshold',
        description: 'Too many errors',
        threshold: 10,
        currentValue: 0,
        triggered: false,
        action: 'pause',
      },
    ];
  }

  private evaluateStopConditions(contract: TaskContract): void {
    for (const condition of contract.stopConditions) {
      switch (condition.type) {
        case 'cost_exceeded':
          condition.currentValue = contract.scope.currentCost;
          break;
        case 'token_exceeded':
          condition.currentValue = contract.scope.currentTokens;
          break;
        case 'time_exceeded':
          condition.currentValue = contract.timeBudget.elapsed;
          break;
      }

      if (condition.currentValue >= condition.threshold && !condition.triggered) {
        condition.triggered = true;
        this.recordViolation(contract.id, 'scope',
          condition.action === 'stop' ? 'critical' : 'warning',
          `Stop condition triggered: ${condition.description}`);
      }
    }
  }

  private stopTimer(contractId: string): void {
    const timer = this.timers.get(contractId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(contractId);
    }
  }
}

export const contractService = new ContractService();
