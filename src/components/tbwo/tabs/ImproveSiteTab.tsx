import { useState } from 'react';
import {
  SparklesIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

import { useTBWOStore } from '@store/tbwoStore';
import { Button } from '@components/ui/Button';

import type { TBWO, SiteImprovementReport } from '../../../types/tbwo';

export function ImproveSiteTab({ tbwo }: { tbwo: TBWO }) {
  const [report, setReport] = useState<SiteImprovementReport | null>(
    (tbwo.metadata?.improvementReport as SiteImprovementReport) || null,
  );
  const [isRunning, setIsRunning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const applyImprovements = useTBWOStore((state) => state.applyImprovements);

  const handleRunAudit = async () => {
    setIsRunning(true);
    try {
      const { runFullSiteAudit } = await import('../../../products/sites/siteOptimizer');

      // Collect artifacts
      const htmlArtifacts = new Map<string, string>();
      let pageSpec = null;
      for (const art of tbwo.artifacts || []) {
        if (art.path && typeof art.content === 'string') {
          htmlArtifacts.set(art.path, art.content);
        }
        if (art.path?.endsWith('pageSpec.json') || art.name === 'pageSpec.json') {
          try { pageSpec = typeof art.content === 'string' ? JSON.parse(art.content as string) : art.content; } catch { /* ignore */ }
        }
      }

      const result = runFullSiteAudit(htmlArtifacts, pageSpec, tbwo.id);
      setReport(result);

      // Store in metadata
      useTBWOStore.getState().updateTBWO(tbwo.id, {
        metadata: { ...tbwo.metadata, improvementReport: result },
      });
    } catch (err) {
      console.error('[ImproveSite] Audit failed:', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleApplyAll = async () => {
    if (!report) return;
    const enabledIds = report.improvements.filter(i => i.enabled && !i.applied).map(i => i.id);
    if (enabledIds.length === 0) {
      setLastError('No improvements selected. Check the boxes next to improvements you want to apply.');
      return;
    }
    setIsApplying(true);
    setLastError(null);
    try {
      const result = await applyImprovements(tbwo.id, enabledIds);
      setAppliedCount(prev => prev + result.applied);
      if (result.failed > 0 && result.applied === 0) {
        setLastError(`All ${result.failed} improvement(s) failed to apply. The AI regeneration service may be unavailable.`);
      } else if (result.failed > 0) {
        setLastError(`Applied ${result.applied}, but ${result.failed} failed. Try re-running those individually.`);
      }
      // Refresh report from store
      const updated = useTBWOStore.getState().getTBWOById(tbwo.id);
      if (updated?.metadata?.improvementReport) {
        setReport(updated.metadata.improvementReport as SiteImprovementReport);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setLastError(`Apply failed: ${msg}`);
      console.error('[ImproveSite] Apply failed:', err);
    } finally {
      setIsApplying(false);
    }
  };

  const toggleImprovement = (id: string) => {
    if (!report) return;
    setReport({
      ...report,
      improvements: report.improvements.map(i =>
        i.id === id ? { ...i, enabled: !i.enabled } : i,
      ),
    });
  };

  const scoreColor = (s: number) => s >= 70 ? 'text-green-400' : s >= 40 ? 'text-yellow-400' : 'text-red-400';
  const barColor = (s: number) => s >= 70 ? 'bg-green-500' : s >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <SparklesIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">Site Improvement Report</h3>
        <p className="mb-4 text-sm text-text-tertiary">
          Run a comprehensive 6-audit analysis covering SEO, clarity, trust, CTAs, messaging, and conversion.
        </p>
        <Button variant="primary" onClick={handleRunAudit} disabled={isRunning}
          leftIcon={isRunning ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}>
          {isRunning ? 'Running Audits...' : 'Run Full Audit'}
        </Button>
      </div>
    );
  }

  const enabledCount = report.improvements.filter(i => i.enabled && !i.applied).length;

  const auditCategories: Array<{ key: string; label: string; score: number }> = [
    { key: 'conversion', label: 'Conversion', score: report.audits.conversion.overallScore },
    { key: 'seo', label: 'SEO', score: report.audits.seo.score },
    { key: 'clarity', label: 'Clarity', score: report.audits.clarity.score },
    { key: 'trust', label: 'Trust', score: report.audits.trust.score },
    { key: 'cta', label: 'CTA', score: report.audits.cta.score },
    { key: 'messaging', label: 'Messaging', score: report.audits.messaging.score },
  ];

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6 text-center">
        <p className={`text-5xl font-bold ${scoreColor(report.overallScore)}`}>{report.overallScore}</p>
        <p className="mt-1 text-sm text-text-tertiary">Overall Site Score</p>
        <p className="mt-2 text-xs text-text-quaternary">
          {report.improvements.length} improvements found | {report.appliedCount} applied
        </p>
      </div>

      {/* Audit Category Scores */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 font-semibold text-text-primary">Audit Scores</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {auditCategories.map(({ key, label, score }) => (
            <div key={key} className="rounded-lg bg-background-tertiary p-3 text-center">
              <p className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</p>
              <p className="text-xs text-text-tertiary">{label}</p>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background-elevated">
                <div className={`h-full rounded-full ${barColor(score)}`} style={{ width: `${score}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Improvement List */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Improvements ({report.improvements.length})</h3>
          {enabledCount > 0 && (
            <Button variant="primary" size="sm" onClick={handleApplyAll} disabled={isApplying}
              leftIcon={isApplying ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}>
              {isApplying ? 'Applying...' : `Apply ${enabledCount} Improvement${enabledCount !== 1 ? 's' : ''}`}
            </Button>
          )}
        </div>

        {lastError && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400">
            {lastError}
          </div>
        )}
        <div className="space-y-2">
          {report.improvements.map((imp) => (
            <div key={imp.id} className={`rounded-lg border p-3 ${imp.applied ? 'border-green-500/30 bg-green-500/5' : 'border-border-primary'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={imp.enabled} onChange={() => toggleImprovement(imp.id)} disabled={imp.applied}
                  className="mt-1 h-4 w-4 rounded border-border-primary text-brand-primary focus:ring-brand-primary" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      imp.priority === 'high' ? 'bg-red-500/10 text-red-400' :
                      imp.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-400' :
                      'bg-blue-500/10 text-blue-400'
                    }`}>{imp.priority}</span>
                    <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-text-tertiary capitalize">{imp.auditSource}</span>
                    <span className="text-xs text-text-quaternary">{imp.page}</span>
                    {imp.applied && <CheckCircleSolid className="h-4 w-4 text-green-400" />}
                  </div>
                  <p className="text-sm text-text-primary">{imp.currentIssue}</p>
                  <p className="mt-0.5 text-xs text-text-tertiary">{imp.proposedFix}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Re-run Audit */}
      <div className="text-center">
        <button onClick={handleRunAudit} disabled={isRunning} className="text-xs text-brand-primary hover:underline disabled:opacity-50">
          {isRunning ? 'Re-running...' : 'Re-run Full Audit'}
        </button>
      </div>
    </div>
  );
}
