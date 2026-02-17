/**
 * Brief Confidence Scorer — Computes a BriefConfidence score from brief state.
 *
 * Pure logic — no AI calls, no side-effects.
 *
 * Scoring (0-100):
 * - Identity coverage (25pts): productName (10), tagline (5), targetAudience (5), primaryPain (5)
 * - Structure coverage (25pts): navPages (8), features (7), pricing completeness (10)
 * - Trust safety (25pts): start at 25, -5 per unverified risky claim, -10 per blocking contradiction
 * - Content readiness (25pts): primaryCTA (5), toneStyle (5), designDirection (5), goal (5),
 *   assumptions vs unknowns ratio (5)
 */

import type { SiteBrief } from '../../../api/dbService';
import type { RiskyClaim, Contradiction, SourceMapEntry, BriefConfidence } from './types';

function fieldPresent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

export function computeBriefConfidence(
  brief: SiteBrief,
  riskyClaims: RiskyClaim[],
  contradictions: Contradiction[],
  _sourceMap: SourceMapEntry[],
): BriefConfidence {
  const blockingGaps: string[] = [];
  const warnings: string[] = [];

  // ---- Identity coverage (25pts) ----
  let identity = 0;
  if (fieldPresent(brief.productName)) {
    identity += 10;
  } else {
    blockingGaps.push('Product name is missing');
  }
  if (fieldPresent(brief.tagline)) identity += 5;
  else warnings.push('No tagline defined');

  if (fieldPresent(brief.targetAudience)) identity += 5;
  else blockingGaps.push('Target audience is missing');

  if (fieldPresent(brief.primaryPain)) identity += 5;
  else warnings.push('No primary pain point defined');

  // ---- Structure coverage (25pts) ----
  let structure = 0;
  const pages = brief.navPages.length > 0 ? brief.navPages : brief.pages;
  if (pages.length > 0) {
    structure += Math.min(8, pages.length * 2);
  } else {
    blockingGaps.push('No pages defined');
  }
  if (brief.features && brief.features.length > 0) {
    structure += Math.min(7, brief.features.length * 2);
  } else {
    warnings.push('No features listed');
  }
  // Pricing completeness
  if (brief.pricing) {
    const tiers = brief.pricing.tiers || [];
    if (tiers.length > 0) {
      structure += 5; // Has tiers
      const allHavePrices = tiers.every(t => t.priceMonthly != null);
      if (allHavePrices) structure += 3;
      const allHaveNames = tiers.every(t => t.name);
      if (allHaveNames) structure += 2;
    }
  }
  structure = Math.min(25, structure);

  // ---- Trust safety (25pts) ----
  let trust = 25;
  const unverifiedClaims = riskyClaims.filter(c => !c.verified);
  trust -= unverifiedClaims.length * 5;
  if (unverifiedClaims.length > 0) {
    warnings.push(`${unverifiedClaims.length} unverified claim(s) in source text`);
  }

  const unresolvedBlocking = contradictions.filter(c => c.severity === 'blocking' && !c.resolved);
  trust -= unresolvedBlocking.length * 10;
  if (unresolvedBlocking.length > 0) {
    blockingGaps.push(`${unresolvedBlocking.length} unresolved blocking contradiction(s)`);
  }

  const unresolvedWarnings = contradictions.filter(c => c.severity === 'warning' && !c.resolved);
  trust -= unresolvedWarnings.length * 2;
  if (unresolvedWarnings.length > 0) {
    warnings.push(`${unresolvedWarnings.length} unresolved warning contradiction(s)`);
  }
  trust = Math.max(0, trust);

  // ---- Content readiness (25pts) ----
  let content = 0;
  if (fieldPresent(brief.primaryCTA)) content += 5;
  else warnings.push('No primary CTA defined');

  if (fieldPresent(brief.toneStyle)) content += 5;
  else warnings.push('No tone/style defined');

  if (fieldPresent(brief.designDirection)) content += 5;

  if (fieldPresent(brief.goal)) content += 5;
  else warnings.push('No goal defined');

  // Assumptions vs unknowns ratio
  const assumptions = brief.assumptions?.length || 0;
  const unknowns = brief.requiredUnknowns?.length || 0;
  if (unknowns === 0 && assumptions > 0) {
    content += 5; // All known, no unknowns
  } else if (unknowns > 0 && assumptions > unknowns) {
    content += 3;
  } else if (unknowns > assumptions) {
    content += 1;
    warnings.push(`${unknowns} required unknown(s) still unresolved`);
  }

  const overall = Math.max(0, Math.min(100, identity + structure + trust + content));

  return {
    overall,
    breakdown: {
      identityCoverage: identity,
      structureCoverage: structure,
      trustSafety: trust,
      contentReadiness: content,
    },
    blockingGaps,
    warnings,
  };
}

/** Check if the brief is ready to launch */
export function isLaunchReady(confidence: BriefConfidence): { ready: boolean; blockers: string[] } {
  const blockers: string[] = [];

  if (confidence.overall < 60) {
    blockers.push(`Overall confidence too low: ${confidence.overall}/100 (need 60+)`);
  }

  blockers.push(...confidence.blockingGaps);

  return {
    ready: blockers.length === 0,
    blockers,
  };
}
