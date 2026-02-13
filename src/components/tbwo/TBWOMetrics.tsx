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
import { TBWOStatus, QUALITY_DISPLAY_NAMES, QualityTarget } from '../../types/tbwo';

// Stores
import { usePodPoolStore } from '../../store/podPoolStore';

// ============================================================================
// TBWO METRICS COMPONENT
// ============================================================================

interface TBWOMetricsProps {
  tbwo: TBWO;
}

export function TBWOMetrics({ tbwo }: TBWOMetricsProps) {
  // Read runtime pods from pool for active TBWOs
  const poolPods = usePodPoolStore((s) => s.pool);

  // Calculate aggregate metrics
  const metrics = useMemo(() => {
    const definitionPods = Array.from(tbwo.pods?.values() || []);
    const isActive = tbwo.status === TBWOStatus.EXECUTING || tbwo.status === TBWOStatus.COMPLETING;

    // Token usage — use runtime pool data when available for active TBWOs
    let totalTokens = 0;
    let totalApiCalls = 0;
    let totalCpu = 0;
    let totalMemory = 0;
    let runtimePodCount = 0;
    let runtimeWorkingCount = 0;

    if (isActive) {
      // Try to get metrics from runtime pool pods
      poolPods.forEach((poolPod: import('../../store/podPoolStore').PooledPod) => {
        if (poolPod.activeTBWOId === tbwo.id) {
          runtimePodCount++;
          if (poolPod.runtime?.podStatus === 'working' || poolPod.status === 'active') {
            runtimeWorkingCount++;
          }
          if (poolPod.runtime) {
            totalTokens += poolPod.runtime.resourceUsage?.tokensUsed || 0;
            totalApiCalls += poolPod.runtime.resourceUsage?.apiCalls || 0;
            totalCpu += poolPod.runtime.resourceUsage?.cpuPercent || 0;
            totalMemory += poolPod.runtime.resourceUsage?.memoryMB || 0;
          }
        }
      });
    }

    // Fall back to definition pods if no runtime data
    if (totalTokens === 0 && totalApiCalls === 0) {
      definitionPods.forEach((pod) => {
        totalTokens += pod.resourceUsage?.tokensUsed || 0;
        totalApiCalls += pod.resourceUsage?.apiCalls || 0;
        totalCpu += pod.resourceUsage?.cpuPercent || 0;
        totalMemory += pod.resourceUsage?.memoryMB || 0;
      });
    }

    const pods = definitionPods;

    // Task completion
    const totalTasks = tbwo.plan?.phases.reduce(
      (sum, phase) => sum + phase.tasks.length,
      0
    ) || 0;
    const completedTasks = tbwo.plan?.phases.reduce(
      (sum, phase) => sum + phase.tasks.filter((t) => t.status === 'complete').length,
      0
    ) || 0;

    // Time efficiency — task completion rate as percentage
    const timeUsedPercent = tbwo.timeBudget.total > 0
      ? (tbwo.timeBudget.elapsed / tbwo.timeBudget.total) * 100
      : 0;
    const progressEfficiency = totalTasks > 0
      ? (completedTasks / totalTasks) * 100
      : 0;

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
      progressEfficiency: Math.min(progressEfficiency, 100),
      estimatedCost,
      artifactsCount: tbwo.artifacts.length,
      podsCount: isActive ? runtimePodCount || pods.length : pods.length,
      activePodsCount: isActive ? runtimeWorkingCount || pods.filter((p) => p.status === 'working').length : pods.filter((p) => p.status === 'working').length,
      checkpointsTotal: tbwo.checkpoints.length,
      checkpointsPassed: tbwo.checkpoints.filter((c) => c.status === 'approved').length,
    };
  }, [tbwo, poolPods]);

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

      {/* Duration */}
      <MetricCard
        icon={<ClockIcon className="h-5 w-5" />}
        label="Duration"
        value={(() => {
          if (!tbwo.startedAt) return '\u2014';
          const endTime = tbwo.completedAt || (tbwo.status === 'completed' ? tbwo.updatedAt : Date.now());
          const mins = Math.round((endTime - tbwo.startedAt) / 60000);
          if (mins < 1) return '< 1m';
          if (mins < 60) return `${mins}m`;
          return `${Math.floor(mins / 60)}h ${mins % 60}m`;
        })()}
        subValue={tbwo.status === 'completed' ? 'Completed' : tbwo.startedAt ? 'In progress' : 'Not started'}
        color="text-brand-primary"
        bgColor="bg-brand-primary/10"
      />

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

      {/* Task Completion */}
      <MetricCard
        icon={<SparklesIcon className="h-5 w-5" />}
        label="Completion"
        value={`${Math.round(metrics.progressEfficiency)}%`}
        subValue={`${metrics.completedTasks} of ${metrics.totalTasks} tasks`}
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
        label="Quality"
        value={QUALITY_DISPLAY_NAMES[tbwo.qualityTarget as QualityTarget] || 'Standard'}
        subValue="Target level"
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
