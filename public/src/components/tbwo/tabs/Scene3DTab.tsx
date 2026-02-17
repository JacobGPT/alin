import {
  CheckCircleIcon,
  CpuChipIcon,
  DevicePhoneMobileIcon,
} from '@heroicons/react/24/outline';

import type { TBWO } from '../../../types/tbwo';

export function Scene3DTab({ tbwo }: { tbwo: TBWO }) {
  const sv = tbwo.metadata?.sceneValidation as {
    passed: boolean;
    score: number;
    issues: Array<{ severity: 'error' | 'warning' | 'info'; rule: string; message: string; file?: string; fix?: string }>;
    summary: string;
    totalPolycount: number;
    estimatedBundleSize: number;
    reducedMotionCompliant: boolean;
    mobileFallbackPresent: boolean;
  } | null;

  if (!sv) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <CpuChipIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No 3D Scene Validation</h3>
        <p className="text-sm text-text-tertiary">Scene validation results will appear here after execution completes</p>
      </div>
    );
  }

  const errors = sv.issues.filter(i => i.severity === 'error');
  const warnings = sv.issues.filter(i => i.severity === 'warning');
  const infos = sv.issues.filter(i => i.severity === 'info');
  const scoreColor = sv.score >= 80 ? 'text-green-400' : sv.score >= 60 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = sv.score >= 80 ? 'bg-green-400/10 border-green-400/30' : sv.score >= 60 ? 'bg-yellow-400/10 border-yellow-400/30' : 'bg-red-400/10 border-red-400/30';
  const bundleKB = (sv.estimatedBundleSize / 1024).toFixed(1);
  const budgetPct = Math.min(100, (sv.estimatedBundleSize / 25000) * 100);

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className={`rounded-xl border p-6 ${scoreBg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-background-secondary">
              <span className={`text-2xl font-bold ${scoreColor}`}>{sv.score}</span>
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${scoreColor}`}>
                {sv.passed ? '3D Scene Validation Passed' : '3D Scene Validation Failed'}
              </h3>
              <p className="text-sm text-text-tertiary">{sv.summary}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {sv.reducedMotionCompliant && (
              <div className="flex items-center gap-1.5 rounded-full bg-green-400/10 px-3 py-1.5 text-xs font-medium text-green-400">
                <CheckCircleIcon className="h-4 w-4" /> Reduced Motion
              </div>
            )}
            {sv.mobileFallbackPresent && (
              <div className="flex items-center gap-1.5 rounded-full bg-blue-400/10 px-3 py-1.5 text-xs font-medium text-blue-400">
                <DevicePhoneMobileIcon className="h-4 w-4" /> Mobile Fallback
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border-primary bg-background-secondary p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{sv.totalPolycount.toLocaleString()}</p>
          <p className="text-xs text-text-tertiary">Total Polycount</p>
        </div>
        <div className="rounded-xl border border-border-primary bg-background-secondary p-4 text-center">
          <p className="text-2xl font-bold text-text-primary">{bundleKB}KB</p>
          <p className="text-xs text-text-tertiary">Scene Bundle Size</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-background-tertiary">
            <div
              className={`h-full rounded-full transition-all ${budgetPct > 100 ? 'bg-red-400' : budgetPct > 66 ? 'bg-yellow-400' : 'bg-green-400'}`}
              style={{ width: `${Math.min(100, budgetPct)}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border-primary bg-background-secondary p-4 text-center">
          <p className={`text-2xl font-bold ${sv.passed ? 'text-green-400' : 'text-red-400'}`}>
            {sv.passed ? 'PASS' : 'FAIL'}
          </p>
          <p className="text-xs text-text-tertiary">Overall Result</p>
        </div>
      </div>

      {/* Issues */}
      {sv.issues.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-text-primary">
            Issues ({errors.length} errors, {warnings.length} warnings, {infos.length} info)
          </h4>
          <div className="space-y-2">
            {sv.issues.map((issue, idx) => {
              const severityColor = issue.severity === 'error' ? 'border-red-400/30 bg-red-400/5' : issue.severity === 'warning' ? 'border-yellow-400/30 bg-yellow-400/5' : 'border-blue-400/30 bg-blue-400/5';
              const textColor = issue.severity === 'error' ? 'text-red-400' : issue.severity === 'warning' ? 'text-yellow-400' : 'text-blue-400';
              return (
                <div key={idx} className={`rounded-lg border p-3 ${severityColor}`}>
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 text-xs font-bold uppercase ${textColor}`}>{issue.severity}</span>
                    <div>
                      <p className="text-sm font-medium text-text-primary">[{issue.rule}] {issue.message}</p>
                      {issue.file && <p className="mt-0.5 text-xs text-text-tertiary">File: {issue.file}</p>}
                      {issue.fix && <p className="mt-0.5 text-xs text-text-secondary">Fix: {issue.fix}</p>}
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
