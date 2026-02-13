import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

import { QualityScoreCard } from '../QualityScoreCard';

import type { TBWO } from '../../../types/tbwo';

export function CognitiveTab({ tbwo }: { tbwo: TBWO }) {
  const cb = tbwo.metadata?.cognitiveBrief as {
    confidence?: { overall: number; breakdown: Record<string, number>; blockingGaps: string[]; warnings: string[] };
    contradictions?: Array<{ claimA: string; claimB: string; severity: string; resolved: boolean; resolution?: string }>;
    riskyClaims?: Array<{ text: string; type: string; verified: boolean; suggestion: string }>;
    sourceMap?: Array<{ field: string; origin: string; confidence: number }>;
    clarifications?: Array<{ question: string; answered: boolean; answer?: string; impact: string }>;
  } | null;

  if (!cb) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <SparklesIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Cognitive Analysis</h3>
        <p className="text-sm text-text-tertiary">Cognitive analysis results will appear here when available</p>
      </div>
    );
  }

  const confidence = cb.confidence;
  const contradictions = cb.contradictions || [];
  const riskyClaims = cb.riskyClaims || [];
  const sourceMap = cb.sourceMap || [];
  const clarifications = cb.clarifications || [];

  const originColors: Record<string, string> = {
    user_explicit: 'bg-green-400/20 text-green-400',
    user_implied: 'bg-blue-400/20 text-blue-400',
    ai_inferred: 'bg-yellow-400/20 text-yellow-400',
    default: 'bg-gray-400/20 text-gray-400',
    user_answered: 'bg-purple-400/20 text-purple-400',
  };

  return (
    <div className="space-y-6">
      {/* Confidence Score */}
      {confidence && (
        <QualityScoreCard confidence={confidence as any} />
      )}

      {/* Contradictions */}
      {contradictions.length > 0 && (
        <div className="bg-background-secondary rounded-xl border border-border-primary p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">
            Contradictions ({contradictions.length})
          </h3>
          <div className="space-y-2">
            {contradictions.map((c, i) => (
              <div key={i} className={`rounded-lg border p-3 ${c.resolved ? 'border-green-400/30 bg-green-400/5' : c.severity === 'blocking' ? 'border-red-400/30 bg-red-400/5' : 'border-yellow-400/30 bg-yellow-400/5'}`}>
                <div className="flex items-start gap-2">
                  {c.resolved ? (
                    <CheckCircleIcon className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <ExclamationTriangleIcon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${c.severity === 'blocking' ? 'text-red-400' : 'text-yellow-400'}`} />
                  )}
                  <div className="flex-1 text-xs">
                    <p className="text-text-secondary">"{c.claimA}" <span className="text-text-quaternary">vs</span> "{c.claimB}"</p>
                    {c.resolution && (
                      <p className="mt-1 text-green-400">Resolved: {c.resolution}</p>
                    )}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.severity === 'blocking' ? 'bg-red-400/20 text-red-400' : 'bg-yellow-400/20 text-yellow-400'}`}>
                    {c.severity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risky Claims */}
      {riskyClaims.length > 0 && (
        <div className="bg-background-secondary rounded-xl border border-border-primary p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">
            Risky Claims ({riskyClaims.length})
          </h3>
          <div className="space-y-2">
            {riskyClaims.map((claim, i) => (
              <div key={i} className={`flex items-start gap-2 text-xs rounded-lg border p-2 ${claim.verified ? 'border-green-400/30' : 'border-orange-400/30'}`}>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${claim.verified ? 'bg-green-400/20 text-green-400' : 'bg-orange-400/20 text-orange-400'}`}>
                  {claim.type}
                </span>
                <span className="text-text-secondary flex-1">"{claim.text}"</span>
                {claim.verified ? (
                  <CheckCircleIcon className="h-4 w-4 text-green-400 flex-shrink-0" />
                ) : (
                  <span className="text-text-quaternary text-[10px]">{claim.suggestion}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source Map */}
      {sourceMap.length > 0 && (
        <div className="bg-background-secondary rounded-xl border border-border-primary p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">Source Map</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {sourceMap.map((entry, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-text-tertiary w-28 truncate">{entry.field}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${originColors[entry.origin] || 'bg-gray-400/20 text-gray-400'}`}>
                  {entry.origin.replace('_', ' ')}
                </span>
                <span className="text-text-quaternary font-mono">{Math.round(entry.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clarification Q&A History */}
      {clarifications.length > 0 && (
        <div className="bg-background-secondary rounded-xl border border-border-primary p-4">
          <h3 className="text-sm font-medium text-text-primary mb-3">Clarifications</h3>
          <div className="space-y-2">
            {clarifications.map((q, i) => (
              <div key={i} className={`text-xs rounded-lg border p-2 ${q.answered ? 'border-green-400/30' : 'border-border-primary'}`}>
                <p className="text-text-secondary">{q.question}</p>
                {q.answered && q.answer && (
                  <p className="mt-1 text-green-400">A: {q.answer}</p>
                )}
                {!q.answered && (
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] ${q.impact === 'blocking' ? 'bg-red-400/20 text-red-400' : q.impact === 'important' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-gray-400/20 text-gray-400'}`}>
                    {q.impact}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
