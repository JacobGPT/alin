/**
 * ContractViewer - Displays contract status, time budget, scope, and violations
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';
import type { TaskContract, ContractViolation } from '../../types/contracts';

interface ContractViewerProps {
  contract: TaskContract;
  onAcknowledgeViolation?: (violationId: string) => void;
}

export const ContractViewer: React.FC<ContractViewerProps> = ({ contract, onAcknowledgeViolation }) => {
  const timePercent = useMemo(() => {
    if (contract.timeBudget.total <= 0) return 0;
    return Math.min(100, (contract.timeBudget.elapsed / contract.timeBudget.total) * 100);
  }, [contract.timeBudget]);

  const costPercent = useMemo(() => {
    if (contract.scope.maxCost <= 0) return 0;
    return Math.min(100, (contract.scope.currentCost / contract.scope.maxCost) * 100);
  }, [contract.scope]);

  const statusColor = {
    draft: 'text-gray-400',
    active: 'text-green-400',
    fulfilled: 'text-blue-400',
    breached: 'text-red-400',
    expired: 'text-yellow-400',
  }[contract.status];

  const statusIcon = {
    draft: ShieldCheckIcon,
    active: CheckCircleIcon,
    fulfilled: CheckCircleIcon,
    breached: XCircleIcon,
    expired: ClockIcon,
  }[contract.status];

  const StatusIcon = statusIcon;

  const unacknowledgedViolations = contract.violations.filter(v => !v.acknowledged);

  return (
    <div className="space-y-4">
      {/* Contract Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusIcon className={`w-5 h-5 ${statusColor}`} />
          <span className="font-medium text-text-primary">Contract</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            contract.status === 'active' ? 'bg-green-500/20 text-green-400' :
            contract.status === 'breached' ? 'bg-red-500/20 text-red-400' :
            contract.status === 'fulfilled' ? 'bg-blue-500/20 text-blue-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {contract.status.toUpperCase()}
          </span>
        </div>
        {unacknowledgedViolations.length > 0 && (
          <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
            {unacknowledgedViolations.length} violation{unacknowledgedViolations.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Objective */}
      <p className="text-sm text-text-secondary">{contract.objective}</p>

      {/* Time Budget Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-text-secondary">
            <ClockIcon className="w-3.5 h-3.5" />
            Time Budget
          </span>
          <span className="text-text-primary">
            {contract.timeBudget.elapsed.toFixed(1)} / {contract.timeBudget.total} min
          </span>
        </div>
        <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              timePercent >= 95 ? 'bg-red-500' :
              timePercent >= 80 ? 'bg-yellow-500' :
              'bg-green-500'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${timePercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Cost Bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-text-secondary">
            <CurrencyDollarIcon className="w-3.5 h-3.5" />
            Cost Budget
          </span>
          <span className="text-text-primary">
            ${contract.scope.currentCost.toFixed(2)} / ${contract.scope.maxCost.toFixed(2)}
          </span>
        </div>
        <div className="h-2 bg-background-tertiary rounded-full overflow-hidden">
          <motion.div
            className={`h-full rounded-full ${
              costPercent >= 95 ? 'bg-red-500' :
              costPercent >= 80 ? 'bg-yellow-500' :
              'bg-blue-500'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${costPercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {/* Scope Summary */}
      <div className="bg-background-tertiary rounded-lg p-3 space-y-2">
        <span className="text-xs font-medium text-text-primary">Scope</span>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <div>
            <span className="text-text-tertiary">Allowed Tools:</span>{' '}
            {contract.scope.allowedTools.includes('*') ? 'All' : contract.scope.allowedTools.length}
          </div>
          <div>
            <span className="text-text-tertiary">Forbidden:</span>{' '}
            {contract.scope.forbiddenTools.length || 'None'}
          </div>
          <div>
            <span className="text-text-tertiary">Tokens:</span>{' '}
            {(contract.scope.currentTokens / 1000).toFixed(0)}k / {(contract.scope.maxTokens / 1000).toFixed(0)}k
          </div>
          <div>
            <span className="text-text-tertiary">Quality Min:</span>{' '}
            {contract.qualityRequirements.minScore}%
          </div>
        </div>
      </div>

      {/* Violations Log */}
      {contract.violations.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-text-primary">Violations</span>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {contract.violations.slice(-10).reverse().map(violation => (
              <ViolationRow
                key={violation.id}
                violation={violation}
                onAcknowledge={onAcknowledgeViolation}
              />
            ))}
          </div>
        </div>
      )}

      {/* Quality Checks */}
      {contract.qualityRequirements.requiredChecks.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-text-primary">Quality Checks</span>
          <div className="flex flex-wrap gap-1">
            {contract.qualityRequirements.requiredChecks.map(check => {
              const passed = contract.qualityRequirements.passedChecks.includes(check);
              const failed = contract.qualityRequirements.failedChecks.includes(check);
              return (
                <span
                  key={check}
                  className={`text-xs px-2 py-0.5 rounded ${
                    passed ? 'bg-green-500/20 text-green-400' :
                    failed ? 'bg-red-500/20 text-red-400' :
                    'bg-gray-500/20 text-gray-400'
                  }`}
                >
                  {check}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const ViolationRow: React.FC<{
  violation: ContractViolation;
  onAcknowledge?: (id: string) => void;
}> = ({ violation, onAcknowledge }) => {
  const severityColor = {
    warning: 'text-yellow-400 bg-yellow-500/10',
    error: 'text-red-400 bg-red-500/10',
    critical: 'text-red-500 bg-red-500/20',
  }[violation.severity];

  return (
    <div className={`flex items-start gap-2 p-2 rounded text-xs ${severityColor}`}>
      <ExclamationTriangleIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="truncate">{violation.description}</p>
        <p className="text-text-tertiary mt-0.5">
          {new Date(violation.timestamp).toLocaleTimeString()}
        </p>
      </div>
      {!violation.acknowledged && onAcknowledge && (
        <button
          onClick={() => onAcknowledge(violation.id)}
          className="text-text-tertiary hover:text-text-primary flex-shrink-0"
        >
          ack
        </button>
      )}
    </div>
  );
};

export default ContractViewer;
