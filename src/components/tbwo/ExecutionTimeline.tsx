/**
 * Execution Timeline - TBWO Progress Visualization
 *
 * Displays the execution phases and tasks in a timeline view.
 * Shows progress, time estimates, and allows expanding phases for details.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDownIcon,
  CheckCircleIcon,
  ClockIcon,
  PlayCircleIcon,
  PauseCircleIcon,
  ExclamationTriangleIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

// Types
import type { TBWO, Phase, Task } from '../../types/tbwo';

// ============================================================================
// EXECUTION TIMELINE COMPONENT
// ============================================================================

interface ExecutionTimelineProps {
  tbwo: TBWO;
}

export function ExecutionTimeline({ tbwo }: ExecutionTimelineProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  const phases = useMemo(() => tbwo.plan?.phases || [], [tbwo.plan]);

  // Calculate overall progress
  const overallProgress = useMemo(() => {
    if (phases.length === 0) return 0;
    const total = phases.reduce((sum, p) => sum + (p.progress || 0), 0);
    return total / phases.length;
  }, [phases]);

  // Calculate estimated completion
  const estimatedCompletion = useMemo(() => {
    if (!tbwo.startedAt || tbwo.status === 'completed') return null;

    const elapsed = Date.now() - tbwo.startedAt;
    const progress = tbwo.progress || 1;
    const estimated = (elapsed / progress) * 100;
    const remaining = estimated - elapsed;

    return new Date(Date.now() + remaining);
  }, [tbwo.startedAt, tbwo.progress, tbwo.status]);

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  if (phases.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-border-primary bg-background-secondary py-16 text-center">
        <ClockIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Execution Plan</h3>
        <p className="text-sm text-text-tertiary">
          The execution plan hasn't been generated yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-text-primary">Overall Progress</h3>
            <p className="text-sm text-text-tertiary">
              {phases.filter((p) => p.status === 'complete').length} of {phases.length} phases complete
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-text-primary">{Math.round(overallProgress)}%</p>
            {estimatedCompletion && (
              <p className="text-xs text-text-tertiary">
                Est. completion: {estimatedCompletion.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="h-4 overflow-hidden rounded-full bg-background-tertiary">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-accent"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>

        {/* Phase Progress Indicators */}
        <div className="mt-4 flex items-center justify-between">
          {phases.map((phase, index) => (
            <div key={phase.id} className="flex flex-1 items-center">
              {/* Phase Node */}
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${
                  phase.status === 'complete'
                    ? 'bg-semantic-success text-white'
                    : phase.status === 'in_progress'
                    ? 'bg-brand-primary text-white'
                    : 'bg-background-tertiary text-text-tertiary'
                }`}
              >
                {phase.status === 'complete' ? (
                  <CheckCircleSolid className="h-5 w-5" />
                ) : (
                  index + 1
                )}
              </div>

              {/* Connector */}
              {index < phases.length - 1 && (
                <div className="mx-2 h-0.5 flex-1">
                  <div
                    className={`h-full transition-colors ${
                      phase.status === 'complete'
                        ? 'bg-semantic-success'
                        : 'bg-background-tertiary'
                    }`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical Line */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border-primary" />

        {/* Phases */}
        <div className="space-y-4">
          {phases.map((phase, index) => (
            <PhaseItem
              key={phase.id}
              phase={phase}
              index={index}
              isExpanded={expandedPhases.has(phase.id)}
              onToggle={() => togglePhase(phase.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PHASE ITEM
// ============================================================================

interface PhaseItemProps {
  phase: Phase;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function PhaseItem({ phase, index, isExpanded, onToggle }: PhaseItemProps) {
  const statusConfig = getPhaseStatusConfig(phase.status);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1 }}
      className="relative ml-12"
    >
      {/* Status Node */}
      <div
        className={`absolute -left-12 flex h-12 w-12 items-center justify-center rounded-full border-4 border-background-primary ${statusConfig.bgColor}`}
      >
        {statusConfig.icon}
      </div>

      {/* Phase Card */}
      <div
        className={`rounded-xl border transition-colors ${
          phase.status === 'in_progress'
            ? 'border-brand-primary bg-brand-primary/5'
            : 'border-border-primary bg-background-secondary'
        }`}
      >
        {/* Header */}
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-text-primary">{phase.name}</h3>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.badgeBg} ${statusConfig.badgeColor}`}>
                {statusConfig.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-text-tertiary">{phase.description}</p>
          </div>

          <div className="ml-4 flex items-center gap-4">
            {/* Progress */}
            <div className="text-right">
              <p className="text-lg font-bold text-text-primary">{Math.round(phase.progress || 0)}%</p>
              <p className="text-xs text-text-tertiary">{phase.estimatedDuration}m</p>
            </div>

            {/* Expand Icon */}
            {phase.tasks.length > 0 && (
              <ChevronDownIcon
                className={`h-5 w-5 text-text-tertiary transition-transform ${
                  isExpanded ? 'rotate-180' : ''
                }`}
              />
            )}
          </div>
        </button>

        {/* Progress Bar */}
        <div className="mx-4 mb-4 h-1.5 overflow-hidden rounded-full bg-background-tertiary">
          <motion.div
            className={`h-full rounded-full ${
              phase.status === 'complete'
                ? 'bg-semantic-success'
                : 'bg-brand-primary'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${phase.progress || 0}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Tasks */}
        <AnimatePresence>
          {isExpanded && phase.tasks.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-border-primary"
            >
              <div className="p-4 space-y-2">
                {phase.tasks.map((task) => (
                  <TaskItem key={task.id} task={task} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Assigned Pods */}
        {phase.assignedPods.length > 0 && (
          <div className="border-t border-border-primary px-4 py-3">
            <p className="text-xs text-text-tertiary">
              Assigned to: {phase.assignedPods.join(', ')}
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// TASK ITEM
// ============================================================================

interface TaskItemProps {
  task: Task;
}

function TaskItem({ task }: TaskItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusConfig = getTaskStatusConfig(task.status);
  const hasDetails = task.description || task.assignedPod || task.output || task.actualDuration;

  return (
    <div
      className={`rounded-lg ${
        task.status === 'in_progress'
          ? 'bg-brand-primary/10'
          : 'bg-background-tertiary'
      }`}
    >
      <button
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        className={`flex items-center gap-3 p-3 w-full text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
      >
        {/* Status Icon */}
        <div className={`flex h-6 w-6 items-center justify-center flex-shrink-0 ${statusConfig.color}`}>
          {statusConfig.icon}
        </div>

        {/* Task Info */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${
            task.status === 'complete' ? 'text-text-tertiary line-through' : 'text-text-primary'
          }`}>
            {task.name}
          </p>
          {!isExpanded && task.description && (
            <p className="text-xs text-text-tertiary truncate">{task.description}</p>
          )}
        </div>

        {/* Duration + Expand */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <p className="text-xs text-text-tertiary">
            {task.actualDuration
              ? `${Math.round(task.actualDuration / 1000)}s`
              : `~${task.estimatedDuration}m`}
          </p>
          {hasDetails && (
            <ChevronDownIcon className={`h-3.5 w-3.5 text-text-quaternary transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0 space-y-2 ml-9">
              {/* Full description */}
              {task.description && (
                <p className="text-xs text-text-secondary">{task.description}</p>
              )}

              {/* Assigned pod */}
              {(task as any).assignedPod && (
                <div className="flex items-center gap-1.5 text-xs text-text-tertiary">
                  <UserCircleIcon className="h-3 w-3" />
                  <span>Pod: {(task as any).assignedPod}</span>
                </div>
              )}

              {/* Duration comparison */}
              {task.actualDuration != null && task.estimatedDuration != null && (
                <div className="flex items-center gap-1.5 text-xs">
                  <ClockIcon className="h-3 w-3 text-text-quaternary" />
                  <span className="text-text-tertiary">
                    Actual: {Math.round(task.actualDuration / 1000)}s
                    {' / '}
                    Est: {task.estimatedDuration}m
                    {task.actualDuration / 1000 / 60 > task.estimatedDuration && (
                      <span className="text-semantic-warning ml-1">(over estimate)</span>
                    )}
                  </span>
                </div>
              )}

              {/* Task output/result */}
              {(task as any).output && (
                <div className="rounded border border-border-primary bg-background-elevated p-2">
                  <p className="text-[10px] text-text-quaternary mb-1">Output:</p>
                  <p className="text-xs text-text-secondary whitespace-pre-wrap line-clamp-6">
                    {(task as any).output}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// STATUS CONFIGS
// ============================================================================

function getPhaseStatusConfig(status: string) {
  switch (status) {
    case 'complete':
      return {
        icon: <CheckCircleSolid className="h-6 w-6 text-white" />,
        bgColor: 'bg-semantic-success',
        badgeBg: 'bg-semantic-success/10',
        badgeColor: 'text-semantic-success',
        label: 'Complete',
      };
    case 'in_progress':
      return {
        icon: <PlayCircleIcon className="h-6 w-6 text-white" />,
        bgColor: 'bg-brand-primary',
        badgeBg: 'bg-brand-primary/10',
        badgeColor: 'text-brand-primary',
        label: 'In Progress',
      };
    case 'failed':
      return {
        icon: <ExclamationTriangleIcon className="h-6 w-6 text-white" />,
        bgColor: 'bg-semantic-error',
        badgeBg: 'bg-semantic-error/10',
        badgeColor: 'text-semantic-error',
        label: 'Failed',
      };
    default:
      return {
        icon: <ClockIcon className="h-6 w-6 text-text-tertiary" />,
        bgColor: 'bg-background-tertiary',
        badgeBg: 'bg-background-tertiary',
        badgeColor: 'text-text-tertiary',
        label: 'Pending',
      };
  }
}

function getTaskStatusConfig(status: string) {
  switch (status) {
    case 'complete':
      return {
        icon: <CheckCircleSolid className="h-5 w-5" />,
        color: 'text-semantic-success',
      };
    case 'in_progress':
      return {
        icon: <PlayCircleIcon className="h-5 w-5" />,
        color: 'text-brand-primary',
      };
    case 'failed':
      return {
        icon: <ExclamationTriangleIcon className="h-5 w-5" />,
        color: 'text-semantic-error',
      };
    default:
      return {
        icon: <ClockIcon className="h-5 w-5" />,
        color: 'text-text-tertiary',
      };
  }
}

export default ExecutionTimeline;
