/**
 * Cognitive Processing Layer — Orchestrator
 *
 * Single entry point that runs all cognitive modules on an extraction result.
 * Flow:
 * 1. Take ExtractBriefResult (already extracted by server)
 * 2. Run detectContradictions(brief, sourceText)
 * 3. Run extractRiskyClaims(brief, sourceText)
 * 4. Build sourceMap from provenance
 * 5. Run computeBriefConfidence()
 * 6. Run prioritizeClarifications()
 * 7. Apply user patterns from retention
 * 8. Return CognitiveBrief
 */

import type { ExtractBriefResult } from '../../../api/dbService';
import type { CognitiveBrief, UserPatterns, SourceMapEntry } from './types';
import { detectContradictions } from './contradictionEngine';
import { extractRiskyClaims } from './riskyClaimsExtractor';
import { computeBriefConfidence } from './confidenceScorer';
import { prioritizeClarifications } from './clarificationEngine';
import { applyClarificationAnswers } from './clarificationEngine';
import { recallUserPatterns } from './retentionService';

/**
 * Run full cognitive analysis on an extracted brief.
 */
export async function runCognitiveAnalysis(
  extractResult: ExtractBriefResult,
  sourceText: string,
  userPatterns?: UserPatterns,
): Promise<CognitiveBrief> {
  const { brief, provenance, missingQuestions } = extractResult;

  // 1. Detect contradictions
  const contradictions = detectContradictions(brief, sourceText);

  // 2. Extract risky claims from source text
  const riskyClaims = extractRiskyClaims(brief, sourceText);

  // 3. Build source map from provenance
  const sourceMap = buildSourceMap(provenance, brief);

  // 4. Compute confidence
  const confidence = computeBriefConfidence(brief, riskyClaims, contradictions, sourceMap);

  // 5. Prioritize clarifications
  const clarifications = prioritizeClarifications(
    missingQuestions,
    contradictions,
    riskyClaims,
    confidence,
  );

  // 6. Recall user patterns from retention (if not provided)
  const patterns = userPatterns || recallUserPatterns() || undefined;

  const now = Date.now();
  return {
    brief,
    riskyClaims,
    contradictions,
    sourceMap,
    confidence,
    clarifications,
    userPatterns: patterns,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing CognitiveBrief with user answers.
 * Recomputes confidence and re-prioritizes remaining clarifications.
 */
export function updateCognitiveBrief(
  existing: CognitiveBrief,
  answers: Record<string, string>,
): CognitiveBrief {
  // Apply answers to clarifications, contradictions, claims, and brief
  const updated = applyClarificationAnswers(existing, answers);

  // Recompute confidence with updated state
  const newConfidence = computeBriefConfidence(
    updated.brief,
    updated.riskyClaims,
    updated.contradictions,
    updated.sourceMap,
  );

  // Re-prioritize remaining questions
  const remainingQuestions = updated.clarifications.filter(q => !q.answered);
  const newClarifications = [
    ...updated.clarifications.filter(q => q.answered),
    ...prioritizeClarifications(
      [],
      updated.contradictions.filter(c => !c.resolved),
      updated.riskyClaims.filter(c => !c.verified && c.suggestion !== 'REMOVED by user'),
      newConfidence,
    ),
  ];

  return {
    ...updated,
    confidence: newConfidence,
    clarifications: newClarifications,
    updatedAt: Date.now(),
  };
}

// ============================================================================
// RE-EXPORTS
// ============================================================================

export { detectContradictions } from './contradictionEngine';
export { computeBriefConfidence, isLaunchReady } from './confidenceScorer';
export { prioritizeClarifications, applyClarificationAnswers } from './clarificationEngine';
export { compressInput, extractKeySignals } from './inputCompressor';
export { extractRiskyClaims } from './riskyClaimsExtractor';
export { scanForGenericContent } from './outputGuard';
export { storeUserPatterns, recallUserPatterns, mergeRetentionIntoDefaults } from './retentionService';
export { BRIEF_TEMPLATES, getTemplateDefaults } from './briefTemplates';
export type { BriefTemplateId, BriefTemplate } from './briefTemplates';

// Re-export all types
export type {
  RiskyClaim,
  Contradiction,
  SourceMapEntry,
  BriefConfidence,
  ClarificationQuestion,
  CognitiveBrief,
  UserPatterns,
  CompressedInput,
  GenericPhraseViolation,
} from './types';

// ============================================================================
// HELPERS
// ============================================================================

function buildSourceMap(
  provenance: Record<string, string>,
  brief: Record<string, any>,
): SourceMapEntry[] {
  const entries: SourceMapEntry[] = [];

  for (const [field, tag] of Object.entries(provenance)) {
    let origin: SourceMapEntry['origin'] = 'ai_inferred';
    let confidence = 0.5;

    switch (tag) {
      case 'USER_PROVIDED':
        origin = 'user_explicit';
        confidence = 1.0;
        break;
      case 'USER_IMPLIED':
        origin = 'user_implied';
        confidence = 0.8;
        break;
      case 'AI_INFERRED':
        origin = 'ai_inferred';
        confidence = 0.5;
        break;
      case 'DEFAULT':
        origin = 'default';
        confidence = 0.3;
        break;
      default:
        // For any provenance tag like INFERRED, PLACEHOLDER, etc.
        origin = 'ai_inferred';
        confidence = 0.4;
    }

    entries.push({
      field,
      origin,
      sourceText: typeof brief[field] === 'string' ? (brief[field] as string).slice(0, 100) : undefined,
      confidence,
    });
  }

  return entries;
}
