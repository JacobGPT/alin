import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDownIcon,
  ArrowPathIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

import { executionEngine } from '../../../services/tbwo/executionEngine';
import type { TBWO } from '../../../types/tbwo';

export function PlanTab({ tbwo }: { tbwo: TBWO }) {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [retryingPhase, setRetryingPhase] = useState<string | null>(null);

  const handleRetryPhase = async (phaseId: string) => {
    setRetryingPhase(phaseId);
    try {
      await executionEngine.retryPhase(tbwo.id, phaseId);
    } catch (e) {
      console.error('[PlanTab] retryPhase failed:', e);
    } finally {
      setRetryingPhase(null);
    }
  };

  if (!tbwo.plan) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <SparklesIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Plan Yet</h3>
        <p className="text-sm text-text-tertiary">
          Generate an execution plan to see phases and tasks
        </p>
      </div>
    );
  }

  const { phases } = tbwo.plan;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-2 font-semibold text-text-primary">Execution Plan</h3>
        <p className="mb-4 text-sm text-text-tertiary">{tbwo.plan.summary}</p>
        <div className="flex items-center gap-4 text-xs text-text-tertiary">
          <span>{phases.length} phases</span>
          <span>{phases.reduce((s, p) => s + p.tasks.length, 0)} tasks</span>
          <span>~{tbwo.plan.estimatedDuration} min estimated</span>
        </div>
      </div>

      {phases.map((phase, index) => {
        const isExpanded = expandedPhase === phase.id;
        const completedTasks = phase.tasks.filter(t => t.status === 'complete').length;
        const totalTasks = phase.tasks.length;

        return (
          <div key={phase.id} className="rounded-xl border border-border-primary bg-background-secondary overflow-hidden">
            <button
              onClick={() => setExpandedPhase(isExpanded ? null : phase.id)}
              className="flex w-full items-center gap-4 p-4 text-left hover:bg-background-hover transition-colors"
            >
              <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                phase.status === 'complete'
                  ? 'bg-semantic-success text-white'
                  : phase.status === 'in_progress'
                  ? 'bg-brand-primary text-white'
                  : phase.status === 'failed'
                  ? 'bg-semantic-error text-white'
                  : 'bg-background-elevated text-text-tertiary'
              }`}>
                {phase.status === 'complete' ? <CheckCircleSolid className="h-5 w-5" /> : index + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text-primary">{phase.name}</p>
                <p className="text-sm text-text-tertiary truncate">{phase.description}</p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  phase.status === 'complete' ? 'bg-semantic-success/10 text-semantic-success' :
                  phase.status === 'in_progress' ? 'bg-brand-primary/10 text-brand-primary' :
                  phase.status === 'failed' ? 'bg-semantic-error/10 text-semantic-error' :
                  'bg-background-tertiary text-text-quaternary'
                }`}>
                  {completedTasks}/{totalTasks} tasks
                </span>
                <span className="text-text-tertiary">{phase.estimatedDuration}m</span>
                <ChevronDownIcon className={`h-4 w-4 text-text-quaternary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </div>
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-t border-border-primary"
                >
                  <div className="p-4 space-y-2">
                    {phase.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 rounded-lg bg-background-tertiary p-3"
                      >
                        <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          task.status === 'complete' ? 'bg-semantic-success' :
                          task.status === 'in_progress' ? 'bg-brand-primary animate-pulse' :
                          task.status === 'failed' ? 'bg-semantic-error' :
                          'bg-text-quaternary'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-primary">{task.name}</p>
                          {task.description && (
                            <p className="text-xs text-text-tertiary line-clamp-1">{task.description.split('\n')[0]}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-text-quaternary">
                          {task.assignedPod && (
                            <span className="rounded bg-background-elevated px-1.5 py-0.5">
                              {(() => {
                                const pod = tbwo.pods?.get(task.assignedPod);
                                return pod ? pod.name : 'Unassigned';
                              })()}
                            </span>
                          )}
                          <span>{task.estimatedDuration}m</span>
                        </div>
                      </div>
                    ))}
                    {phase.dependsOn && phase.dependsOn.length > 0 && (
                      <p className="text-xs text-text-quaternary mt-2">
                        Depends on: {phase.dependsOn.map(depId => {
                          const dep = phases.find(p => p.id === depId);
                          return dep?.name || depId;
                        }).join(', ')}
                      </p>
                    )}

                    {/* Retry button for failed/skipped phases */}
                    {(phase.status === 'failed' || phase.status === 'skipped') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRetryPhase(phase.id); }}
                        disabled={retryingPhase === phase.id}
                        className="mt-3 flex items-center gap-2 rounded-lg bg-semantic-error/10 hover:bg-semantic-error/20 text-semantic-error px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {retryingPhase === phase.id ? (
                          <>
                            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-semantic-error border-t-transparent" />
                            <span>Retrying...</span>
                          </>
                        ) : (
                          <>
                            <ArrowPathIcon className="h-3.5 w-3.5" />
                            <span>Retry Phase</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
