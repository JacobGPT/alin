import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

import type { TBWO } from '../../../types/tbwo';

export function MotionValidationTab({ tbwo }: { tbwo: TBWO }) {
  const mv = tbwo.metadata?.motionValidation as {
    passed: boolean;
    score: number;
    issues: Array<{ severity: 'error' | 'warning' | 'info'; rule: string; message: string; file?: string; fix?: string }>;
    summary: string;
    totalAnimatedElements: number;
    estimatedBundleSize: number;
    reducedMotionCompliant: boolean;
  } | null;

  if (!mv) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <SparklesIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Motion Validation</h3>
        <p className="text-sm text-text-tertiary">Motion validation results will appear here after execution completes</p>
      </div>
    );
  }

  const errors = mv.issues.filter(i => i.severity === 'error');
  const warnings = mv.issues.filter(i => i.severity === 'warning');
  const infos = mv.issues.filter(i => i.severity === 'info');
  const scoreColor = mv.score >= 80 ? 'text-green-400' : mv.score >= 60 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = mv.score >= 80 ? 'bg-green-400/10 border-green-400/30' : mv.score >= 60 ? 'bg-yellow-400/10 border-yellow-400/30' : 'bg-red-400/10 border-red-400/30';
  const bundleKB = (mv.estimatedBundleSize / 1024).toFixed(1);
  const budgetPct = Math.min(100, (mv.estimatedBundleSize / 15000) * 100);

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className={`rounded-xl border p-6 ${scoreBg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-background-secondary">
              <span className={`text-2xl font-bold ${scoreColor}`}>{mv.score}</span>
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${scoreColor}`}>
                {mv.passed ? 'Motion Validation Passed' : 'Motion Validation Failed'}
              </h3>
              <p className="text-sm text-text-tertiary">{mv.summary}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {mv.reducedMotionCompliant && (
              <div className="flex items-center gap-1.5 rounded-full bg-green-400/10 px-3 py-1.5 text-xs font-medium text-green-400">
                <CheckCircleIcon className="h-4 w-4" /> Reduced Motion Compliant
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border-primary bg-background-secondary p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{mv.totalAnimatedElements}</p>
          <p className="text-xs text-text-tertiary">Animated Elements</p>
          {mv.totalAnimatedElements > 30 && (
            <p className="mt-1 text-xs text-yellow-400">Above 30 recommended limit</p>
          )}
        </div>
        <div className="rounded-xl border border-border-primary bg-background-secondary p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{bundleKB}KB</p>
          <p className="text-xs text-text-tertiary">Motion Bundle Size</p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-background-tertiary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${budgetPct > 100 ? 'bg-red-400' : budgetPct > 66 ? 'bg-yellow-400' : 'bg-green-400'}`}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-text-quaternary">{bundleKB}KB / 15KB budget</p>
        </div>
        <div className="rounded-xl border border-border-primary bg-background-secondary p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{mv.issues.length}</p>
          <p className="text-xs text-text-tertiary">Total Issues</p>
          <div className="mt-1 flex items-center justify-center gap-2 text-xs">
            {errors.length > 0 && <span className="text-red-400">{errors.length} error{errors.length !== 1 ? 's' : ''}</span>}
            {warnings.length > 0 && <span className="text-yellow-400">{warnings.length} warn</span>}
            {infos.length > 0 && <span className="text-blue-400">{infos.length} info</span>}
          </div>
        </div>
      </div>

      {/* Issues List */}
      {mv.issues.length > 0 && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
          <h3 className="mb-4 font-semibold text-text-primary">Issues</h3>
          <div className="space-y-3">
            {/* Errors first, then warnings, then info */}
            {[...errors, ...warnings, ...infos].map((issue, i) => {
              const sevIcon = issue.severity === 'error'
                ? <ExclamationTriangleIcon className="h-4 w-4 text-red-400 flex-shrink-0" />
                : issue.severity === 'warning'
                ? <ExclamationTriangleIcon className="h-4 w-4 text-yellow-400 flex-shrink-0" />
                : <CheckCircleIcon className="h-4 w-4 text-blue-400 flex-shrink-0" />;
              const sevBg = issue.severity === 'error' ? 'border-red-400/20 bg-red-400/5'
                : issue.severity === 'warning' ? 'border-yellow-400/20 bg-yellow-400/5'
                : 'border-blue-400/20 bg-blue-400/5';
              return (
                <div key={i} className={`rounded-lg border p-3 ${sevBg}`}>
                  <div className="flex items-start gap-2">
                    {sevIcon}
                    <div className="flex-1">
                      <p className="text-sm text-text-primary">{issue.message}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs font-mono text-text-quaternary">{issue.rule}</span>
                        {issue.file && <span className="text-xs text-text-quaternary">in {issue.file}</span>}
                      </div>
                      {issue.fix && (
                        <p className="mt-1 text-xs text-text-tertiary">Fix: {issue.fix}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
