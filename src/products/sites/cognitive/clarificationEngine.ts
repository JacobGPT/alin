/**
 * Clarification Prioritizer — Ranks and deduplicates questions.
 *
 * Rules:
 * - Blocking questions always first
 * - Max 5 questions per round
 * - Deterministic options when possible
 * - Contradiction-derived questions auto-generated
 * - Dedup: if contradiction and missing question target same field, merge
 *
 * Pure logic — no AI calls, no side-effects.
 */

import type { SiteBrief, MissingQuestion } from '../../../api/dbService';
import type {
  ClarificationQuestion,
  Contradiction,
  RiskyClaim,
  BriefConfidence,
  CognitiveBrief,
} from './types';

let _counter = 0;
function makeId(): string {
  return `clr_${Date.now()}_${++_counter}`;
}

const MAX_QUESTIONS_PER_ROUND = 5;

/** Deterministic option sets for common fields */
const FIELD_OPTIONS: Record<string, string[]> = {
  toneStyle: ['Professional', 'Friendly', 'Bold', 'Minimalist', 'Playful'],
  designDirection: ['Modern & Clean', 'Dark & Bold', 'Warm & Organic', 'Corporate', 'Gradient & Vibrant'],
  businessType: ['SaaS', 'Agency', 'E-Commerce', 'Portfolio', 'Local Business', 'Nonprofit'],
};

export function prioritizeClarifications(
  missingQuestions: MissingQuestion[],
  contradictions: Contradiction[],
  riskyClaims: RiskyClaim[],
  confidence: BriefConfidence,
): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const coveredFields = new Set<string>();

  // 1. Convert contradictions to questions (blocking first)
  for (const c of contradictions.filter(x => !x.resolved)) {
    const field = inferFieldFromContradiction(c);
    if (coveredFields.has(field)) continue;
    coveredFields.add(field);
    questions.push({
      id: makeId(),
      field,
      question: `We detected a conflict: "${c.claimA}" vs "${c.claimB}". Which is correct?`,
      reason: c.claimA + ' / ' + c.claimB,
      impact: c.severity === 'blocking' ? 'blocking' : 'important',
      options: buildContradictionOptions(c),
      answered: false,
    });
  }

  // 2. Convert risky claims to verification questions
  for (const claim of riskyClaims.filter(c => !c.verified)) {
    const field = `riskyClaim_${claim.type}`;
    if (coveredFields.has(field)) continue;
    coveredFields.add(field);
    questions.push({
      id: makeId(),
      field,
      question: `You mentioned: "${claim.text}". Can you verify this?`,
      reason: claim.suggestion,
      impact: claim.type === 'security' ? 'blocking' : 'important',
      options: ['Yes, this is accurate', 'Remove it'],
      answered: false,
    });
  }

  // 3. Convert missing questions (from extraction)
  for (const mq of missingQuestions) {
    // Dedup against already covered fields
    const field = inferFieldFromQuestion(mq);
    if (coveredFields.has(field)) continue;
    coveredFields.add(field);
    questions.push({
      id: makeId(),
      field,
      question: mq.question,
      reason: mq.reason,
      impact: mq.blocking ? 'blocking' : 'important',
      options: FIELD_OPTIONS[field],
      answered: false,
    });
  }

  // 4. Add questions from blocking gaps
  for (const gap of confidence.blockingGaps) {
    const field = inferFieldFromGap(gap);
    if (coveredFields.has(field)) continue;
    coveredFields.add(field);
    questions.push({
      id: makeId(),
      field,
      question: gapToQuestion(gap),
      reason: gap,
      impact: 'blocking',
      options: FIELD_OPTIONS[field],
      answered: false,
    });
  }

  // Sort: blocking first, then important, then optional
  const priorityOrder: Record<string, number> = { blocking: 0, important: 1, optional: 2 };
  questions.sort((a, b) => (priorityOrder[a.impact] ?? 2) - (priorityOrder[b.impact] ?? 2));

  // Cap at MAX_QUESTIONS_PER_ROUND
  return questions.slice(0, MAX_QUESTIONS_PER_ROUND);
}

/**
 * Apply user answers to a CognitiveBrief, returning an updated copy.
 * Answers is a map of question.id → answer string.
 */
export function applyClarificationAnswers(
  cb: CognitiveBrief,
  answers: Record<string, string>,
): CognitiveBrief {
  const updatedBrief = { ...cb.brief };
  const updatedClarifications = cb.clarifications.map(q => {
    if (answers[q.id] == null) return q;
    const answer = answers[q.id];
    // Apply answer to brief field
    applyAnswerToField(updatedBrief, q.field, answer);
    return { ...q, answered: true, answer };
  });

  // Resolve contradictions that were answered
  const updatedContradictions = cb.contradictions.map(c => {
    const relatedQ = updatedClarifications.find(
      q => q.answered && q.reason.includes(c.claimA)
    );
    if (relatedQ && relatedQ.answer) {
      return { ...c, resolved: true, resolution: relatedQ.answer };
    }
    return c;
  });

  // Mark risky claims as verified/removed based on answers
  const updatedClaims = cb.riskyClaims.map(claim => {
    const relatedQ = updatedClarifications.find(
      q => q.answered && q.field === `riskyClaim_${claim.type}`
    );
    if (relatedQ) {
      if (relatedQ.answer === 'Yes, this is accurate') {
        return { ...claim, verified: true };
      }
      if (relatedQ.answer === 'Remove it') {
        return { ...claim, verified: false, suggestion: 'REMOVED by user' };
      }
    }
    return claim;
  });

  // Update source map for answered fields
  const updatedSourceMap = cb.sourceMap.map(entry => {
    const relatedQ = updatedClarifications.find(q => q.answered && q.field === entry.field);
    if (relatedQ) {
      return { ...entry, origin: 'user_answered' as const, confidence: 1.0 };
    }
    return entry;
  });

  return {
    ...cb,
    brief: updatedBrief,
    clarifications: updatedClarifications,
    contradictions: updatedContradictions,
    riskyClaims: updatedClaims,
    sourceMap: updatedSourceMap,
    version: cb.version + 1,
    updatedAt: Date.now(),
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function inferFieldFromContradiction(c: Contradiction): string {
  const text = (c.claimA + ' ' + c.claimB).toLowerCase();
  if (text.includes('pricing') || text.includes('tier') || text.includes('free')) return 'pricing';
  if (text.includes('tone')) return 'toneStyle';
  if (text.includes('audience') || text.includes('b2b') || text.includes('b2c')) return 'targetAudience';
  if (text.includes('demo') || text.includes('contact')) return 'primaryCTA';
  if (text.includes('enterprise')) return 'businessType';
  if (text.includes('integration')) return 'integrations';
  if (text.includes('blog')) return 'navPages';
  if (text.includes('feature') || text.includes('minimalist') || text.includes('simple')) return 'features';
  if (text.includes('product name') || text.includes('name')) return 'productName';
  return 'general';
}

function inferFieldFromQuestion(mq: MissingQuestion): string {
  const text = (mq.question + ' ' + mq.reason).toLowerCase();
  if (text.includes('product name') || text.includes('name')) return 'productName';
  if (text.includes('audience') || text.includes('who')) return 'targetAudience';
  if (text.includes('tone') || text.includes('voice')) return 'toneStyle';
  if (text.includes('design') || text.includes('aesthetic')) return 'designDirection';
  if (text.includes('pricing') || text.includes('price')) return 'pricing';
  if (text.includes('feature')) return 'features';
  if (text.includes('cta') || text.includes('call to action')) return 'primaryCTA';
  if (text.includes('goal')) return 'goal';
  if (text.includes('page')) return 'navPages';
  return 'general';
}

function inferFieldFromGap(gap: string): string {
  const text = gap.toLowerCase();
  if (text.includes('product name')) return 'productName';
  if (text.includes('target audience')) return 'targetAudience';
  if (text.includes('page')) return 'navPages';
  if (text.includes('contradiction')) return 'contradictions';
  return 'general';
}

function gapToQuestion(gap: string): string {
  if (gap.includes('Product name')) return 'What is the name of your product or company?';
  if (gap.includes('Target audience')) return 'Who is your target audience?';
  if (gap.includes('page')) return 'What pages should your website have?';
  if (gap.includes('contradiction')) return 'We found conflicting information — see details above.';
  return `Please clarify: ${gap}`;
}

function buildContradictionOptions(c: Contradiction): string[] {
  // Extract short labels from claims
  return [
    c.claimA.length > 50 ? c.claimA.slice(0, 47) + '...' : c.claimA,
    c.claimB.length > 50 ? c.claimB.slice(0, 47) + '...' : c.claimB,
  ];
}

function applyAnswerToField(brief: SiteBrief, field: string, answer: string): void {
  switch (field) {
    case 'productName': brief.productName = answer; break;
    case 'targetAudience': brief.targetAudience = answer; break;
    case 'toneStyle': brief.toneStyle = answer; brief.tone = answer; break;
    case 'designDirection': brief.designDirection = answer; break;
    case 'primaryCTA': brief.primaryCTA = answer; break;
    case 'goal': brief.goal = answer; break;
    case 'businessType': brief.businessType = answer; break;
    // Complex fields - just set as best-effort
    default: break;
  }
}
