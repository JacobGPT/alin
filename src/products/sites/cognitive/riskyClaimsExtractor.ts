/**
 * Risky Claims Extractor — Detects claims in user INPUT that need verification.
 *
 * Reuses truthGuard pattern detection but applies it to the raw user input
 * (not generated output). Marks each as user_stated vs inferred/unknown.
 *
 * Pure logic — no AI calls, no side-effects.
 */

import type { SiteBrief } from '../../../api/dbService';
import type { RiskyClaim } from './types';

let _counter = 0;
function makeId(): string {
  return `rc_${Date.now()}_${++_counter}`;
}

/** Numeric claims: "500+", "12k users", "98%", "$12M raised" */
const NUMERIC_PATTERNS = [
  /\b\d[\d,]*\+?\s*(?:users?|customers?|clients?|companies|businesses|teams?|projects?|people)\b/gi,
  /\b\d[\d,]*\+?\s*(?:countries|cities|locations)\b/gi,
  /\$\d[\d,.]*[KkMmBb]?\b/g,
  /\b\d+(?:\.\d+)?%\b/g,
  /\b\d+[KkMmBb]\+?\b/g,
];

/** Trust/comparison claims */
const TRUST_PATTERNS = [
  /\btrusted by\b/gi,
  /\baward[- ]winning\b/gi,
  /\b#1\b/gi,
  /\bmarket lead(?:er|ing)\b/gi,
  /\bindustry lead(?:er|ing)\b/gi,
  /\bbest[- ]in[- ]class\b/gi,
  /\bas seen (?:on|in)\b/gi,
  /\brecognized by\b/gi,
];

/** Security claims */
const SECURITY_PATTERNS = [
  /\bSOC\s*(?:2|II)\b/gi,
  /\bbank[- ]level\b/gi,
  /\benterprise[- ]grade\s*(?:security|encryption)\b/gi,
  /\b256[- ]?bit\s*(?:encryption|SSL|AES)\b/gi,
  /\b99\.9+%\s*(?:uptime|availability|SLA)\b/gi,
  /\bGDPR\s*compliant\b/gi,
  /\bHIPAA\s*compliant\b/gi,
  /\bISO\s*27001\b/gi,
  /\bPCI[- ]DSS\b/gi,
  /\bend[- ]to[- ]end\s*encrypt(?:ed|ion)\b/gi,
];

/** Testimonial patterns */
const TESTIMONIAL_PATTERNS = [
  /["\u201C\u201D].{20,200}["\u201C\u201D]\s*[-\u2014\u2013]\s*[A-Z][a-z]+/g,
  /\b(?:CEO|CTO|Founder|Director|VP|Manager|Head)\s+(?:of|at)\s+/gi,
];

type PatternGroup = {
  patterns: RegExp[];
  type: RiskyClaim['type'];
  suggestion: string;
};

const PATTERN_GROUPS: PatternGroup[] = [
  {
    patterns: NUMERIC_PATTERNS,
    type: 'stat',
    suggestion: 'Verify this number or mark as approximate',
  },
  {
    patterns: TRUST_PATTERNS,
    type: 'award',
    suggestion: 'Provide source/proof or remove this claim',
  },
  {
    patterns: SECURITY_PATTERNS,
    type: 'security',
    suggestion: 'Confirm you hold this certification/capability',
  },
  {
    patterns: TESTIMONIAL_PATTERNS,
    type: 'testimonial',
    suggestion: 'Confirm this is a real testimonial with permission to use',
  },
];

export function extractRiskyClaims(brief: SiteBrief, sourceText: string): RiskyClaim[] {
  const claims: RiskyClaim[] = [];
  const seen = new Set<string>();

  for (const group of PATTERN_GROUPS) {
    for (const pattern of group.patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sourceText)) !== null) {
        const text = match[0].trim();
        const key = `${group.type}:${text.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Determine source: if the matched text appears in the user's input,
        // mark as user_stated (they said it, but we still flag for verification)
        const source: RiskyClaim['source'] = 'user_stated';

        claims.push({
          id: makeId(),
          text,
          type: group.type,
          source,
          verified: false,
          suggestion: group.suggestion,
        });
      }
    }
  }

  // Also check for comparison claims ("better than X", "faster than X")
  const comparisonPatterns = [
    /\bbetter than\s+[A-Z]\w+/gi,
    /\bfaster than\s+[A-Z]\w+/gi,
    /\bcheaper than\s+[A-Z]\w+/gi,
    /\bunlike\s+[A-Z]\w+/gi,
    /\bcompared to\s+[A-Z]\w+/gi,
  ];
  for (const pattern of comparisonPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sourceText)) !== null) {
      const text = match[0].trim();
      const key = `comparison:${text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        id: makeId(),
        text,
        type: 'comparison',
        source: 'user_stated',
        verified: false,
        suggestion: 'Verify this competitive claim or rephrase without naming competitors',
      });
    }
  }

  return claims;
}
