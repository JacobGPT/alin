/**
 * QualityScoreCard — Shows all quality scores in one card on the Overview tab.
 *
 * Displays: Confidence, Truth Guard, Conversion, Motion, Scene, and Overall scores.
 */

import type { BriefConfidence } from '../../products/sites/cognitive/types';

interface ScoreItem {
  label: string;
  score: number;  // 0-100
  color: string;
}

interface QualityScoreCardProps {
  confidence?: BriefConfidence;
  truthGuardPassed?: boolean;
  truthGuardViolations?: number;
  conversionScore?: number;
  motionScore?: number;
  sceneScore?: number;
}

function ScoreBar({ label, score, color }: ScoreItem) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">{label}</span>
        <span className={`font-mono font-medium ${color}`}>{score}/100</span>
      </div>
      <div className="h-1.5 bg-background-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            score >= 70 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
        />
      </div>
    </div>
  );
}

function ConfidenceGauge({ score }: { score: number }) {
  const color = score >= 70 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const bgColor = score >= 70 ? 'stroke-green-500' : score >= 50 ? 'stroke-yellow-500' : 'stroke-red-500';
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width="88" height="88" viewBox="0 0 88 88" className="transform -rotate-90">
        <circle cx="44" cy="44" r="36" fill="none" className="stroke-background-elevated" strokeWidth="6" />
        <circle
          cx="44" cy="44" r="36" fill="none"
          className={bgColor}
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
        />
      </svg>
      <span className={`-mt-14 text-lg font-bold font-mono ${color}`}>{score}</span>
      <span className="text-[10px] text-text-quaternary mt-0.5">overall</span>
    </div>
  );
}

export function QualityScoreCard({
  confidence,
  truthGuardPassed,
  truthGuardViolations,
  conversionScore,
  motionScore,
  sceneScore,
}: QualityScoreCardProps) {
  const scores: ScoreItem[] = [];

  if (confidence) {
    scores.push({
      label: 'Brief Confidence',
      score: confidence.overall,
      color: confidence.overall >= 70 ? 'text-green-400' : confidence.overall >= 50 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  if (truthGuardPassed != null) {
    const tgScore = truthGuardPassed ? 100 : Math.max(0, 100 - (truthGuardViolations || 0) * 15);
    scores.push({
      label: 'Truth Guard',
      score: tgScore,
      color: tgScore >= 70 ? 'text-green-400' : tgScore >= 50 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  if (conversionScore != null) {
    scores.push({
      label: 'Conversion',
      score: conversionScore,
      color: conversionScore >= 70 ? 'text-green-400' : conversionScore >= 50 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  if (motionScore != null) {
    scores.push({
      label: 'Motion',
      score: motionScore,
      color: motionScore >= 70 ? 'text-green-400' : motionScore >= 50 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  if (sceneScore != null) {
    scores.push({
      label: '3D Scene',
      score: sceneScore,
      color: sceneScore >= 70 ? 'text-green-400' : sceneScore >= 50 ? 'text-yellow-400' : 'text-red-400',
    });
  }

  if (scores.length === 0) return null;

  const overallScore = Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length);

  return (
    <div className="bg-background-secondary rounded-xl border border-border-primary p-4">
      <h3 className="text-sm font-medium text-text-primary mb-3">Quality Scores</h3>
      <div className="flex gap-4">
        <ConfidenceGauge score={overallScore} />
        <div className="flex-1 space-y-2">
          {scores.map(s => (
            <ScoreBar key={s.label} {...s} />
          ))}
        </div>
      </div>
      {confidence && confidence.blockingGaps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border-primary">
          <p className="text-xs text-red-400 font-medium mb-1">Blocking Issues:</p>
          <ul className="text-xs text-text-tertiary space-y-0.5">
            {confidence.blockingGaps.map((gap, i) => (
              <li key={i}>- {gap}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default QualityScoreCard;
