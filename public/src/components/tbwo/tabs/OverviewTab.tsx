import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRightIcon,
  ChevronDownIcon,
  XCircleIcon,
  ArrowPathIcon,
  CpuChipIcon,
  ClockIcon,
  BeakerIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

import { usePodPoolStore } from '@store/podPoolStore';
import { TBWOMetrics } from '../TBWOMetrics';
import { countDownloadableArtifacts } from '../../../services/tbwo/zipService';
import { POD_ROLE_ICONS } from '../utils/tbwoDashboardConstants';
import type { TabId } from '../utils/tbwoDashboardHelpers';
import type { TBWO } from '../../../types/tbwo';
import { QualityTarget, QUALITY_DISPLAY_NAMES, getPodRoleDisplayName, isReportType } from '../../../types/tbwo';

// ── Report Quality Metrics (only for completed reports) ──
interface ReportResult {
  qualityScore?: number;
  analysisConfidence?: string;
  issuesFound?: number;
  issuesFixed?: number;
  costEstimate?: string;
  pods?: Array<{ phase: string; model: string; provider: string; durationMs: number; tokenEstimate?: number }>;
  scope?: { primaryQuestions?: string[] };
  sourceCount?: number;
}

const CONFIDENCE_BADGE: Record<string, string> = {
  high: 'bg-semantic-success/20 text-semantic-success',
  medium: 'bg-semantic-warning/20 text-semantic-warning',
  low: 'bg-semantic-error/20 text-semantic-error',
};

function ReportQualityDashboard({ result }: { result: ReportResult }) {
  const [showPods, setShowPods] = useState(false);

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-5">
      <div className="flex items-center gap-2 mb-4">
        <BeakerIcon className="h-5 w-5 text-text-tertiary" />
        <h3 className="font-semibold text-text-primary">Report Quality</h3>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-4">
        {result.qualityScore != null && (
          <div className="rounded-lg bg-background-tertiary p-3 text-center">
            <p className="text-2xl font-bold text-brand-primary">{result.qualityScore}<span className="text-sm text-text-tertiary">/10</span></p>
            <p className="text-xs text-text-tertiary">Quality Score</p>
          </div>
        )}
        {result.analysisConfidence && (
          <div className="rounded-lg bg-background-tertiary p-3 text-center">
            <span className={`inline-block rounded-full px-2.5 py-1 text-sm font-semibold capitalize ${CONFIDENCE_BADGE[result.analysisConfidence] || CONFIDENCE_BADGE.medium}`}>
              {result.analysisConfidence}
            </span>
            <p className="text-xs text-text-tertiary mt-1">Confidence</p>
          </div>
        )}
        {(result.issuesFound != null || result.issuesFixed != null) && (
          <div className="rounded-lg bg-background-tertiary p-3 text-center">
            <p className="text-xl font-bold text-text-primary">
              {result.issuesFound ?? 0}
              {result.issuesFixed != null && <span className="text-sm text-semantic-success"> / {result.issuesFixed} fixed</span>}
            </p>
            <p className="text-xs text-text-tertiary">Issues</p>
          </div>
        )}
        {result.costEstimate && (
          <div className="rounded-lg bg-background-tertiary p-3 text-center">
            <p className="text-xl font-bold text-text-primary">{result.costEstimate}</p>
            <p className="text-xs text-text-tertiary">Est. Cost</p>
          </div>
        )}
      </div>

      {/* Research Questions */}
      {result.scope?.primaryQuestions && result.scope.primaryQuestions.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">Research Questions</h4>
          <ul className="space-y-1">
            {result.scope.primaryQuestions.map((q, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-brand-primary flex-shrink-0" />
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Pod Breakdown Table */}
      {result.pods && result.pods.length > 0 && (
        <div>
          <button
            onClick={() => setShowPods(!showPods)}
            className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
          >
            {showPods ? <ChevronDownIcon className="h-3.5 w-3.5" /> : <ChevronRightIcon className="h-3.5 w-3.5" />}
            Phase Breakdown ({result.pods.length} phases)
          </button>
          {showPods && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-primary text-text-tertiary">
                    <th className="py-2 pr-4 text-left font-medium">Phase</th>
                    <th className="py-2 pr-4 text-left font-medium">Model</th>
                    <th className="py-2 pr-4 text-left font-medium">Provider</th>
                    <th className="py-2 pr-4 text-right font-medium">Duration</th>
                    <th className="py-2 text-right font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pods.map((pod, i) => (
                    <tr key={i} className="border-b border-border-primary/50">
                      <td className="py-1.5 pr-4 text-text-primary capitalize">{pod.phase}</td>
                      <td className="py-1.5 pr-4 text-text-secondary font-mono">{pod.model}</td>
                      <td className="py-1.5 pr-4 text-text-secondary capitalize">{pod.provider}</td>
                      <td className="py-1.5 pr-4 text-right text-text-secondary">{pod.durationMs ? `${(pod.durationMs / 1000).toFixed(1)}s` : '\u2014'}</td>
                      <td className="py-1.5 text-right text-text-secondary">{pod.tokenEstimate ? `~${(pod.tokenEstimate / 1000).toFixed(1)}k` : '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function OverviewTab({ tbwo, onNavigate }: { tbwo: TBWO; onNavigate?: (tab: TabId) => void }) {
  // Use runtime pods from pool during execution, fall back to definition pods
  const poolPods = usePodPoolStore(state =>
    [...state.pool.values()].filter(p => p.activeTBWOId === tbwo.id)
  );
  const definitionPods = Array.from(tbwo.pods?.values() || []);
  const podsArray = poolPods.length > 0
    ? poolPods.map(p => ({
        id: p.id,
        role: p.role || 'frontend',
        name: p.name,
        status: p.runtime?.podStatus || p.status || 'idle',
        resourceUsage: p.runtime?.resourceUsage,
        modelConfig: (p as any).modelConfig || {},
      } as any))
    : definitionPods;
  const artifactCount = tbwo.artifacts?.length || 0;
  const fileCount = countDownloadableArtifacts(tbwo);
  const totalTasks = tbwo.plan?.phases.reduce((s, p) => s + p.tasks.length, 0) || 0;
  const completedTasks = tbwo.plan?.phases.reduce((s, p) => s + p.tasks.filter(t => t.status === 'complete').length, 0) || 0;
  const qualityLabel = QUALITY_DISPLAY_NAMES[tbwo.qualityTarget as QualityTarget] || 'Standard';

  // Milestone steps
  const milestones = useMemo(() => {
    if (!tbwo.plan) return [];
    const phases = tbwo.plan.phases;
    const steps = phases.map((p) => ({
      label: p.name,
      status: p.status === 'complete' ? 'done' as const
        : p.status === 'in_progress' ? 'active' as const
        : p.status === 'failed' ? 'failed' as const
        : 'not_started' as const,
    }));
    if (tbwo.type === 'website_sprint') {
      steps.push({
        label: 'Preview',
        status: ['completed', 'completing'].includes(tbwo.status) ? 'done' : 'not_started',
      });
      steps.push({
        label: 'Deploy',
        status: 'not_started',
      });
    } else if (isReportType(tbwo.type as any)) {
      steps.push({
        label: 'Download',
        status: ['completed', 'completing'].includes(tbwo.status) ? 'done' : 'not_started',
      });
    }
    return steps;
  }, [tbwo.plan, tbwo.status, tbwo.type]);

  const isExecuting = ['executing', 'completing'].includes(tbwo.status);
  const isCompleted = tbwo.status === 'completed';

  // Calculate actual duration
  const actualDuration = useMemo(() => {
    if (!tbwo.startedAt) return null;
    const endTime = tbwo.completedAt || (isCompleted ? tbwo.updatedAt : Date.now());
    const durationMs = endTime - tbwo.startedAt;
    const totalMinutes = Math.round(durationMs / 60000);
    if (totalMinutes < 1) return '< 1 min';
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }, [tbwo.startedAt, tbwo.completedAt, tbwo.updatedAt, isCompleted]);

  return (
    <div className="space-y-6">
      {/* Progress Pipeline */}
      {milestones.length > 0 && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-5">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                  m.status === 'done' ? 'bg-semantic-success/10 text-semantic-success' :
                  m.status === 'active' ? 'bg-brand-primary/10 text-brand-primary' :
                  m.status === 'failed' ? 'bg-semantic-error/10 text-semantic-error' :
                  'bg-background-tertiary text-text-quaternary'
                }`}>
                  {m.status === 'done' ? <CheckCircleSolid className="h-3.5 w-3.5" /> :
                   m.status === 'active' ? <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" /> :
                   m.status === 'failed' ? <XCircleIcon className="h-3.5 w-3.5" /> :
                   <span className="h-3.5 w-3.5 text-center text-[10px] leading-[14px]">{i + 1}</span>}
                  {m.label}
                </div>
                {i < milestones.length - 1 && (
                  <ChevronRightIcon className="h-3.5 w-3.5 flex-shrink-0 text-text-quaternary" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <TBWOMetrics tbwo={tbwo} />

      {/* Build/Report Summary — always visible once execution has started */}
      {(artifactCount > 0 || fileCount > 0 || completedTasks > 0) && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-text-primary">
              {isReportType(tbwo.type as any) ? 'Report Summary' : 'Build Summary'}
            </h3>
            <span className="rounded-full bg-brand-primary/10 px-2.5 py-1 text-xs font-medium text-brand-primary">
              {qualityLabel} Quality
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-background-tertiary p-3 text-center">
              <p className="text-xl font-bold text-text-primary">{fileCount || artifactCount}</p>
              <p className="text-xs text-text-tertiary">{isReportType(tbwo.type as any) ? 'Documents' : 'Files Created'}</p>
            </div>
            <div className="rounded-lg bg-background-tertiary p-3 text-center">
              <p className="text-xl font-bold text-text-primary">{completedTasks}/{totalTasks}</p>
              <p className="text-xs text-text-tertiary">Tasks Done</p>
            </div>
            <div className="rounded-lg bg-background-tertiary p-3 text-center">
              <p className="text-xl font-bold text-text-primary">
                {tbwo?.status === 'completed' || tbwo?.status === 'failed'
                  ? podsArray.length
                  : podsArray.filter(p => p.status === 'working').length}/{podsArray.length}
              </p>
              <p className="text-xs text-text-tertiary">
                {tbwo?.status === 'completed' || tbwo?.status === 'failed' ? 'Pods Used' : 'Active Pods'}
              </p>
            </div>
            <div className="rounded-lg bg-background-tertiary p-3 text-center">
              <p className="text-xl font-bold text-text-primary">{tbwo.plan?.phases.length || 0}</p>
              <p className="text-xs text-text-tertiary">Phases</p>
            </div>
          </div>

          {/* Quick action links */}
          {onNavigate && fileCount > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => onNavigate('artifacts')} className="rounded-lg border border-border-primary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-background-tertiary transition-colors">
                {isReportType(tbwo.type as any) ? 'View Documents' : 'View Build'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Report Quality Metrics — only for completed report types */}
      {isReportType(tbwo.type as any) && isCompleted && (tbwo.metadata as any)?.result && (
        <ReportQualityDashboard result={(tbwo.metadata as any).result as ReportResult} />
      )}

      {/* Duration — shows how long the TBWO took or is taking */}
      {(tbwo.startedAt || isCompleted) && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-5">
          <div className="flex items-center gap-2 mb-3">
            <ClockIcon className="h-5 w-5 text-text-tertiary" />
            <h3 className="font-semibold text-text-primary">
              {isCompleted ? 'Total Duration' : 'Running Time'}
            </h3>
          </div>
          <p className="text-3xl font-bold text-brand-primary">
            {actualDuration || '\u2014'}
          </p>
          <p className="text-sm text-text-tertiary mt-1">
            {isCompleted
              ? `Completed ${new Date(tbwo.completedAt || tbwo.updatedAt).toLocaleString()}`
              : isExecuting
              ? 'In progress...'
              : `Started ${new Date(tbwo.startedAt!).toLocaleString()}`}
          </p>
        </div>
      )}

      {/* Active Agents */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Agents</h3>
          {isExecuting && (
            <span className="flex items-center gap-1.5 text-xs text-semantic-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-semantic-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-semantic-success" />
              </span>
              Running
            </span>
          )}
        </div>

        {podsArray.length === 0 ? (
          <p className="text-sm text-text-tertiary">No agents spawned yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {podsArray.slice(0, 8).map((pod) => (
              <div
                key={pod.id}
                className="flex items-center gap-3 rounded-lg bg-background-tertiary p-3"
              >
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg text-base ${
                  pod.status === 'working'
                    ? 'bg-brand-primary/20 text-brand-primary'
                    : pod.status === 'idle' || pod.status === 'complete'
                    ? 'bg-semantic-success/20 text-semantic-success'
                    : 'bg-background-elevated text-text-tertiary'
                }`}>
                  {POD_ROLE_ICONS[pod.role as string] || <CpuChipIcon className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{pod.name || getPodRoleDisplayName(pod.role as string)}</p>
                  <p className="text-xs text-text-tertiary">{getPodRoleDisplayName(pod.role as string)}</p>
                </div>
                {pod.status === 'working' && (
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-primary" />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
