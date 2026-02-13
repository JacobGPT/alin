import { useState } from 'react';
import {
  SparklesIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

import type { TBWO, ConversionAuditResult } from '../../../types/tbwo';
import { Button } from '@components/ui/Button';
import { useTBWOStore } from '@store/tbwoStore';

export function ConversionAuditTab({ tbwo }: { tbwo: TBWO }) {
  const audit = tbwo.metadata?.conversionAudit as ConversionAuditResult | undefined;
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  const [applyingRec, setApplyingRec] = useState<string | null>(null);
  const regenerateSection = useTBWOStore((state) => state.regenerateSection);

  if (!audit) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <SparklesIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Conversion Audit Yet</h3>
        <p className="text-sm text-text-tertiary">The conversion audit runs automatically when a website sprint completes.</p>
      </div>
    );
  }

  const scoreColor = (s: number) => s >= 70 ? 'text-green-400' : s >= 40 ? 'text-yellow-400' : 'text-red-400';
  const barColor = (s: number) => s >= 70 ? 'bg-green-500' : s >= 40 ? 'bg-yellow-500' : 'bg-red-500';

  const handleApplyRec = async (rec: ConversionAuditResult['recommendations'][0]) => {
    if (!rec.autoFixable || !rec.fixAction) return;
    setApplyingRec(rec.id);
    try {
      // Find the HTML artifact for this page
      const htmlArt = (tbwo.artifacts || []).find(a => (a.path || '').includes(rec.page.replace('.html', '')));
      if (!htmlArt) return;
      await regenerateSection(tbwo.id, {
        tbwoId: tbwo.id,
        artifactPath: htmlArt.path || '',
        sectionSelector: rec.fixAction.sectionSelector,
        sectionHtml: typeof htmlArt.content === 'string' ? htmlArt.content.slice(0, 5000) : '',
        action: 'custom',
        customInstruction: rec.fixAction.instruction,
      });
    } catch (err) {
      console.error('[ConversionAudit] Apply failed:', err);
    } finally {
      setApplyingRec(null);
    }
  };

  const categories: Array<{ key: keyof typeof audit.scores; label: string }> = [
    { key: 'clarity', label: 'Clarity' },
    { key: 'persuasion', label: 'Persuasion' },
    { key: 'friction', label: 'Low Friction' },
    { key: 'trustSignals', label: 'Trust Signals' },
    { key: 'visualHierarchy', label: 'Visual Hierarchy' },
    { key: 'pricingPsychology', label: 'Pricing Psychology' },
  ];

  return (
    <div className="space-y-6">
      {/* Overall Score */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6 text-center">
        <p className={`text-5xl font-bold ${scoreColor(audit.overallScore)}`}>{audit.overallScore}</p>
        <p className="mt-1 text-sm text-text-tertiary">Conversion Score</p>
      </div>

      {/* Category Scores */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 font-semibold text-text-primary">Category Breakdown</h3>
        <div className="space-y-3">
          {categories.map(({ key, label }) => {
            const score = audit.scores[key];
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-36 text-sm text-text-secondary">{label}</span>
                <div className="flex-1 h-3 bg-background-tertiary rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor(score)}`} style={{ width: `${score}%` }} />
                </div>
                <span className={`w-10 text-right text-sm font-semibold ${scoreColor(score)}`}>{score}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-Page Audits */}
      {audit.pageAudits.length > 0 && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
          <h3 className="mb-4 font-semibold text-text-primary">Page-Level Audit</h3>
          <div className="space-y-2">
            {audit.pageAudits.map((pa) => (
              <div key={pa.page} className="rounded-lg border border-border-primary">
                <button onClick={() => {
                  const next = new Set(expandedPages);
                  next.has(pa.page) ? next.delete(pa.page) : next.add(pa.page);
                  setExpandedPages(next);
                }} className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-background-hover">
                  {expandedPages.has(pa.page) ? <ChevronDownIcon className="h-4 w-4 text-text-tertiary" /> : <ChevronRightIcon className="h-4 w-4 text-text-tertiary" />}
                  <span className="font-medium text-text-primary">{pa.page}</span>
                  <span className="text-xs text-text-tertiary">{pa.route}</span>
                </button>
                {expandedPages.has(pa.page) && (
                  <div className="border-t border-border-primary px-4 py-3 space-y-2">
                    {pa.sections.map((s, i) => (
                      <div key={i} className="text-sm">
                        <span className="font-medium text-text-secondary capitalize">{s.sectionType}</span>
                        {s.issues.length > 0 && (
                          <ul className="ml-4 mt-1 text-xs text-text-tertiary list-disc">
                            {s.issues.map((issue, j) => <li key={j}>{issue}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {audit.recommendations.length > 0 && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
          <h3 className="mb-4 font-semibold text-text-primary">Recommendations ({audit.recommendations.length})</h3>
          <div className="space-y-3">
            {audit.recommendations.map((rec) => (
              <div key={rec.id} className="rounded-lg border border-border-primary p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        rec.priority === 'high' ? 'bg-red-500/10 text-red-400' :
                        rec.priority === 'medium' ? 'bg-yellow-500/10 text-yellow-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>{rec.priority}</span>
                      <span className="rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-text-tertiary capitalize">{rec.category}</span>
                    </div>
                    <p className="text-sm text-text-primary">{rec.currentIssue}</p>
                    <p className="mt-1 text-xs text-text-tertiary">{rec.recommendation}</p>
                    <p className="mt-0.5 text-xs text-brand-primary">{rec.estimatedImpact}</p>
                  </div>
                  {rec.autoFixable && (
                    <Button variant="secondary" size="sm" disabled={applyingRec === rec.id}
                      onClick={() => handleApplyRec(rec)}
                      leftIcon={applyingRec === rec.id ? <ArrowPathIcon className="h-3 w-3 animate-spin" /> : <SparklesIcon className="h-3 w-3" />}>
                      {applyingRec === rec.id ? 'Applying...' : 'Apply Fix'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
