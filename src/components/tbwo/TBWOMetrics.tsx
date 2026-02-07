/**
 * TBWO Metrics - Key Performance Indicators
 *
 * Displays important metrics for a TBWO including time usage,
 * resource consumption, quality scores, and progress stats.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ClockIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ChartBarIcon,
  BoltIcon,
  SparklesIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

// Types
import type { TBWO } from '../../types/tbwo';

// ============================================================================
// TBWO METRICS COMPONENT
// ============================================================================

interface TBWOMetricsProps {
  tbwo: TBWO;
}

export function TBWOMetrics({ tbwo }: TBWOMetricsProps) {
  // Calculate aggregate metrics
  const metrics = useMemo(() => {
    const pods = Array.from(tbwo.pods?.values() || []);

    // Token usage
    let totalTokens = 0;
    let totalApiCalls = 0;
    let totalCpu = 0;
    let totalMemory = 0;

    pods.forEach((pod) => {
      totalTokens += pod.resourceUsage?.tokensUsed || 0;
      totalApiCalls += pod.resourceUsage?.apiCalls || 0;
      totalCpu += pod.resourceUsage?.cpuPercent || 0;
      totalMemory += pod.resourceUsage?.memoryMB || 0;
    });

    // Task completion
    const totalTasks = tbwo.plan?.phases.reduce(
      (sum, phase) => sum + phase.tasks.length,
      0
    ) || 0;
    const completedTasks = tbwo.plan?.phases.reduce(
      (sum, phase) => sum + phase.tasks.filter((t) => t.status === 'complete').length,
      0
    ) || 0;

    // Time efficiency
    const timeUsedPercent = tbwo.timeBudget.total > 0
      ? (tbwo.timeBudget.elapsed / tbwo.timeBudget.total) * 100
      : 0;
    const progressEfficiency = (tbwo.progress > 0 && timeUsedPercent > 0)
      ? (tbwo.progress / timeUsedPercent) * 100
      : (tbwo.progress > 0 ? 100 : 0);

    // Cost estimation (rough estimate based on tokens)
    const estimatedCost = (totalTokens / 1000) * 0.003; // Rough Claude pricing

    return {
      totalTokens,
      totalApiCalls,
      avgCpu: pods.length > 0 ? totalCpu / pods.length : 0,
      totalMemory,
      totalTasks,
      completedTasks,
      taskCompletionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
      timeUsedPercent,
      progressEfficiency: Math.min(progressEfficiency, 200),
      estimatedCost,
      artifactsCount: tbwo.artifacts.length,
      podsCount: pods.length,
      activePodsCount: pods.filter((p) => p.status === 'working').length,
      checkpointsTotal: tbwo.checkpoints.length,
      checkpointsPassed: tbwo.checkpoints.filter((c) => c.status === 'approved').length,
    };
  }, [tbwo]);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* Progress */}
      <MetricCard
        icon={<ChartBarIcon className="h-5 w-5" />}
        label="Progress"
        value={`${Math.round(tbwo.progress)}%`}
        subValue={`${metrics.completedTasks}/${metrics.totalTasks} tasks`}
        color="text-brand-primary"
        bgColor="bg-brand-primary/10"
      >
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-tertiary">
          <motion.div
            className="h-full rounded-full bg-brand-primary"
            initial={{ width: 0 }}
            animate={{ width: `${tbwo.progress}%` }}
            transition={{ duration: 0.8 }}
          />
        </div>
      </MetricCard>

      {/* Time Budget */}
      <MetricCard
        icon={<ClockIcon className="h-5 w-5" />}
        label="Time Budget"
        value={`${Math.round(tbwo.timeBudget.remaining)}m`}
        subValue={`${Math.round(tbwo.timeBudget.elapsed)}m used of ${tbwo.timeBudget.total}m`}
        color={
          tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.1
            ? 'text-semantic-error'
            : tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.25
            ? 'text-semantic-warning'
            : 'text-semantic-success'
        }
        bgColor={
          tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.1
            ? 'bg-semantic-error/10'
            : tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.25
            ? 'bg-semantic-warning/10'
            : 'bg-semantic-success/10'
        }
      >
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background-tertiary">
          <motion.div
            className={`h-full rounded-full ${
              tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.1
                ? 'bg-semantic-error'
                : tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.25
                ? 'bg-semantic-warning'
                : 'bg-semantic-success'
            }`}
            initial={{ width: 0 }}
            animate={{ width: `${metrics.timeUsedPercent}%` }}
            transition={{ duration: 0.8 }}
          />
        </div>
      </MetricCard>

      {/* Token Usage */}
      <MetricCard
        icon={<BoltIcon className="h-5 w-5" />}
        label="Token Usage"
        value={formatNumber(metrics.totalTokens)}
        subValue={`~$${metrics.estimatedCost.toFixed(3)} est.`}
        color="text-brand-secondary"
        bgColor="bg-brand-secondary/10"
      />

      {/* Active Pods */}
      <MetricCard
        icon={<CpuChipIcon className="h-5 w-5" />}
        label="Active Pods"
        value={`${metrics.activePodsCount}/${metrics.podsCount}`}
        subValue={`${metrics.totalApiCalls} API calls`}
        color="text-purple-400"
        bgColor="bg-purple-500/10"
      />

      {/* Efficiency Score */}
      <MetricCard
        icon={<SparklesIcon className="h-5 w-5" />}
        label="Efficiency"
        value={`${Math.round(metrics.progressEfficiency)}%`}
        subValue="Progress vs time used"
        color={
          metrics.progressEfficiency >= 100
            ? 'text-semantic-success'
            : metrics.progressEfficiency >= 75
            ? 'text-semantic-warning'
            : 'text-semantic-error'
        }
        bgColor={
          metrics.progressEfficiency >= 100
            ? 'bg-semantic-success/10'
            : metrics.progressEfficiency >= 75
            ? 'bg-semantic-warning/10'
            : 'bg-semantic-error/10'
        }
      />

      {/* Artifacts */}
      <MetricCard
        icon={<DocumentTextIcon className="h-5 w-5" />}
        label="Artifacts"
        value={`${metrics.artifactsCount}`}
        subValue="Files generated"
        color="text-blue-400"
        bgColor="bg-blue-500/10"
      />

      {/* Checkpoints */}
      <MetricCard
        icon={<CheckCircleIcon className="h-5 w-5" />}
        label="Checkpoints"
        value={`${metrics.checkpointsPassed}/${metrics.checkpointsTotal}`}
        subValue="Passed"
        color="text-semantic-success"
        bgColor="bg-semantic-success/10"
      />

      {/* Quality Target */}
      <MetricCard
        icon={<SparklesIcon className="h-5 w-5" />}
        label="Quality Target"
        value={tbwo.qualityTarget.replace('_', ' ')}
        subValue="Requested level"
        color="text-brand-accent"
        bgColor="bg-brand-accent/10"
      />
    </div>
  );
}

// ============================================================================
// METRIC CARD
// ============================================================================

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  color: string;
  bgColor: string;
  children?: React.ReactNode;
}

function MetricCard({
  icon,
  label,
  value,
  subValue,
  color,
  bgColor,
  children,
}: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border-primary bg-background-secondary p-4"
    >
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bgColor} ${color}`}>
          {icon}
        </div>
      </div>

      <div className="mt-3">
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-text-tertiary">{label}</p>
        {subValue && <p className="mt-0.5 text-xs text-text-quaternary">{subValue}</p>}
      </div>

      {children}
    </motion.div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

export default TBWOMetrics;
