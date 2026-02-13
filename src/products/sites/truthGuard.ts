/**
 * Truth Guard — Scans generated site copy for unverified claims.
 *
 * Detects numeric marketing claims, trust signals, testimonials, and security
 * assertions that were NOT explicitly provided by the user. Produces a list of
 * violations that must be resolved (via Pause-and-Ask or removal) before deploy.
 *
 * This module is pure logic — no React, no side-effects.
 */

import type { SiteBrief, SiteBriefConstraints } from '../../api/dbService';

// ============================================================================
// TYPES
// ============================================================================

export type TruthViolationType =
  | 'NUMERIC_CLAIM'          // "500+ users", "98% uptime", "$12M raised"
  | 'TRUST_SIGNAL'           // "trusted by", "as seen on", "award-winning"
  | 'TESTIMONIAL'            // Quotes with names/companies
  | 'SECURITY_CLAIM'         // "SOC 2", "bank-level encryption", "99.9% uptime"
  | 'LOGO_CLAIM'             // Customer logos, "as seen on"
  | 'BRAND_MISMATCH';        // Product name differs from siteBrief.productName

export interface TruthViolation {
  id: string;
  type: TruthViolationType;
  file: string;
  lineNumber?: number;
  matchedText: string;
  context: string;          // ~100 chars around the match
  suggestion: string;       // What to do about it
  critical: boolean;        // true = blocks deploy
  resolved: boolean;
  resolution?: 'USER_APPROVED' | 'REMOVED' | 'REPLACED';
  replacementText?: string;
}

export interface TruthGuardResult {
  violations: TruthViolation[];
  passed: boolean;          // true if no unresolved critical violations
  summary: string;
}

// ============================================================================
// PATTERNS
// ============================================================================

/** Numeric claim patterns — matches "500+", "12k", "50,000", "98%", "$12M", etc. */
const NUMERIC_CLAIM_PATTERNS = [
  /\b\d[\d,]*\+?\s*(?:users?|customers?|clients?|companies|businesses|teams?|projects?|people)\b/gi,
  /\b\d[\d,]*\+?\s*(?:countries|cities|locations)\b/gi,
  /\$\d[\d,.]*[KkMmBb]?\b/g,        // Dollar amounts
  /\b\d{1,3}(?:[,.]\d{3})*\+?\s*\+/g,// Standalone numbers with +
  /\b\d+(?:\.\d+)?%\b/g,             // Percentages
  /\b\d+[KkMmBb]\+?\b/g,            // Shorthand: 12k, 5M
];

/** Trust signal phrases */
const TRUST_SIGNAL_PATTERNS = [
  /\btrusted by\b/gi,
  /\bused by\b/gi,
  /\bcustomers worldwide\b/gi,
  /\baward[- ]winning\b/gi,
  /\b#1\b/gi,
  /\bmarket lead(?:er|ing)\b/gi,
  /\bindustry lead(?:er|ing)\b/gi,
  /\bbest[- ]in[- ]class\b/gi,
  /\bas seen (?:on|in)\b/gi,
  /\bfeatured (?:on|in|by)\b/gi,
  /\brecognized by\b/gi,
];

/** Security claim patterns */
const SECURITY_CLAIM_PATTERNS = [
  /\bSOC\s*2\b/gi,
  /\bSOC\s*II\b/gi,
  /\bbank[- ]level\b/gi,
  /\benterprise[- ]grade\s*(?:security|encryption)\b/gi,
  /\b(?:military|bank)[- ]grade\b/gi,
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
  /["\u201C\u201D].{20,200}["\u201C\u201D]\s*[-\u2014\u2013]\s*[A-Z][a-z]+/g,  // "Quote" - Name
  /\b(?:CEO|CTO|Founder|Director|VP|Manager|Head)\s+(?:of|at)\s+/gi,
];

/** Logo/customer claim patterns */
const LOGO_CLAIM_PATTERNS = [
  /\btrusted by companies like\b/gi,
  /\bour (?:clients|customers) include\b/gi,
  /\bused by teams at\b/gi,
  /\bjoining companies like\b/gi,
];

// ============================================================================
// CORE SCAN
// ============================================================================

let _violationCounter = 0;

function makeViolationId(): string {
  return `tv_${Date.now()}_${++_violationCounter}`;
}

function getContext(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - 50);
  const end = Math.min(text.length, matchIndex + matchLength + 50);
  const ctx = text.slice(start, end).replace(/\n/g, ' ');
  return (start > 0 ? '...' : '') + ctx + (end < text.length ? '...' : '');
}

function scanPatterns(
  content: string,
  fileName: string,
  patterns: RegExp[],
  type: TruthViolationType,
  critical: boolean,
  suggestion: string,
): TruthViolation[] {
  const violations: TruthViolation[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const key = `${type}:${match[0].toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Calculate line number
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

      violations.push({
        id: makeViolationId(),
        type,
        file: fileName,
        lineNumber,
        matchedText: match[0],
        context: getContext(content, match.index, match[0].length),
        suggestion,
        critical,
        resolved: false,
      });
    }
  }

  return violations;
}

// ============================================================================
// BRAND NAME CHECK
// ============================================================================

function scanBrandMismatch(
  content: string,
  fileName: string,
  productName: string,
): TruthViolation[] {
  if (!productName || productName.length < 2) return [];

  const violations: TruthViolation[] = [];

  // Common AI-substituted names
  const fakeNames = [
    'Acme', 'AcmeCorp', 'TechCo', 'MyApp', 'AppName', 'BrandName',
    'YourCompany', 'CompanyName', 'SiteName', 'ProjectName',
  ];

  for (const fakeName of fakeNames) {
    const regex = new RegExp(`\\b${fakeName}\\b`, 'gi');
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
      violations.push({
        id: makeViolationId(),
        type: 'BRAND_MISMATCH',
        file: fileName,
        lineNumber,
        matchedText: match[0],
        context: getContext(content, match.index, match[0].length),
        suggestion: `Replace "${match[0]}" with "${productName}"`,
        critical: true,
        resolved: false,
      });
    }
  }

  return violations;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Scan a single file's content for truth violations.
 */
export function scanFileForViolations(
  content: string,
  fileName: string,
  brief: SiteBrief | null,
  provenance: Record<string, string>,
): TruthViolation[] {
  const constraints: SiteBriefConstraints = brief?.constraints || {
    NO_FABRICATED_STATS: true,
    NO_RENAME_WITHOUT_APPROVAL: true,
    NO_SECURITY_CLAIMS_UNLESS_PROVIDED: true,
  };

  const violations: TruthViolation[] = [];

  // Only scan HTML, MD, and text-like files
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!['html', 'htm', 'md', 'txt', 'json'].includes(ext || '')) return [];

  // 1. Numeric claims
  if (constraints.NO_FABRICATED_STATS) {
    violations.push(...scanPatterns(
      content, fileName, NUMERIC_CLAIM_PATTERNS, 'NUMERIC_CLAIM', true,
      'Remove stat or ask user for verified number via Pause-and-Ask',
    ));
  }

  // 2. Trust signals
  violations.push(...scanPatterns(
    content, fileName, TRUST_SIGNAL_PATTERNS, 'TRUST_SIGNAL', true,
    'Remove trust claim or ask user to confirm via Pause-and-Ask',
  ));

  // 3. Security claims
  if (constraints.NO_SECURITY_CLAIMS_UNLESS_PROVIDED) {
    violations.push(...scanPatterns(
      content, fileName, SECURITY_CLAIM_PATTERNS, 'SECURITY_CLAIM', true,
      'Remove security claim or ask user to confirm via Pause-and-Ask',
    ));
  }

  // 4. Testimonials
  violations.push(...scanPatterns(
    content, fileName, TESTIMONIAL_PATTERNS, 'TESTIMONIAL', false,
    'Replace with "Early Access" or "Built with" section, or ask user for real testimonials',
  ));

  // 5. Logo claims
  violations.push(...scanPatterns(
    content, fileName, LOGO_CLAIM_PATTERNS, 'LOGO_CLAIM', true,
    'Remove logo/customer claim or ask user for real customer names',
  ));

  // 6. Brand mismatch
  if (constraints.NO_RENAME_WITHOUT_APPROVAL && brief?.productName) {
    violations.push(...scanBrandMismatch(content, fileName, brief.productName));
  }

  // Filter out violations that match USER_PROVIDED data
  return violations.filter(v => {
    // If the matched text is directly from user-provided content, skip it
    const matchLower = v.matchedText.toLowerCase();
    for (const [field, tag] of Object.entries(provenance)) {
      if (tag === 'USER_PROVIDED') {
        const briefValue = (brief as any)?.[field];
        if (typeof briefValue === 'string' && briefValue.toLowerCase().includes(matchLower)) {
          return false; // User provided this, don't flag it
        }
      }
    }
    return true;
  });
}

/**
 * Scan ALL generated files for truth violations.
 * `files` is a map of filename → content.
 */
export function runTruthGuard(
  files: Map<string, string>,
  brief: SiteBrief | null,
  provenance: Record<string, string>,
): TruthGuardResult {
  const allViolations: TruthViolation[] = [];

  for (const [fileName, content] of files) {
    allViolations.push(...scanFileForViolations(content, fileName, brief, provenance));
  }

  const unresolvedCritical = allViolations.filter(v => v.critical && !v.resolved);
  const passed = unresolvedCritical.length === 0;

  const summary = passed
    ? `Truth Guard passed. ${allViolations.length} items scanned, all clear.`
    : `Truth Guard FAILED: ${unresolvedCritical.length} unresolved critical violation(s) found. ` +
      unresolvedCritical.map(v => `[${v.type}] "${v.matchedText}" in ${v.file}`).join('; ');

  return { violations: allViolations, passed, summary };
}

/**
 * Build Pause-and-Ask questions from truth violations.
 * Groups violations by type to avoid spamming the user with 20 separate pauses.
 */
export function buildPauseQuestionsFromViolations(
  violations: TruthViolation[],
): Array<{ reason: string; question: string; contextPath: string; requiredFields: string[] }> {
  const unresolved = violations.filter(v => v.critical && !v.resolved);
  if (unresolved.length === 0) return [];

  // Group by type
  const grouped = new Map<TruthViolationType, TruthViolation[]>();
  for (const v of unresolved) {
    const list = grouped.get(v.type) || [];
    list.push(v);
    grouped.set(v.type, list);
  }

  const questions: Array<{ reason: string; question: string; contextPath: string; requiredFields: string[] }> = [];

  for (const [type, group] of grouped) {
    const claims = group.map(v => `"${v.matchedText}"`).slice(0, 5).join(', ');
    const files = [...new Set(group.map(v => v.file))].join(', ');

    switch (type) {
      case 'NUMERIC_CLAIM':
        questions.push({
          reason: 'MISSING_CRITICAL_FACT',
          question: `The generated website includes numeric claims: ${claims}. ` +
            `Are these accurate? Please provide verified numbers, or say "remove" to replace with non-numeric copy.`,
          contextPath: `files.${files}`,
          requiredFields: group.map(v => v.matchedText),
        });
        break;
      case 'SECURITY_CLAIM':
        questions.push({
          reason: 'MISSING_CRITICAL_FACT',
          question: `Security claims detected: ${claims}. ` +
            `Do you have these certifications/capabilities? Provide specifics or say "remove".`,
          contextPath: `files.${files}`,
          requiredFields: group.map(v => v.matchedText),
        });
        break;
      case 'TRUST_SIGNAL':
        questions.push({
          reason: 'MISSING_CRITICAL_FACT',
          question: `Trust claims detected: ${claims}. ` +
            `Can you back these up with specifics? If not, I'll replace with honest alternatives.`,
          contextPath: `files.${files}`,
          requiredFields: group.map(v => v.matchedText),
        });
        break;
      case 'BRAND_MISMATCH':
        questions.push({
          reason: 'REQUIRES_USER_PREFERENCE',
          question: `Product name mismatch: found ${claims} but expected the product name from your brief. Which is correct?`,
          contextPath: 'productName',
          requiredFields: ['productName'],
        });
        break;
      case 'LOGO_CLAIM':
        questions.push({
          reason: 'MISSING_CRITICAL_FACT',
          question: `Customer/logo claims detected: ${claims}. ` +
            `Please provide real customer names or say "remove".`,
          contextPath: `files.${files}`,
          requiredFields: group.map(v => v.matchedText),
        });
        break;
      default:
        break;
    }
  }

  return questions;
}

/**
 * Generate neutral replacement text for removed claims.
 */
export function getNeutralReplacement(violationType: TruthViolationType): string {
  switch (violationType) {
    case 'NUMERIC_CLAIM':
      return 'Built for teams who want a better workflow';
    case 'TRUST_SIGNAL':
      return 'Designed for professionals';
    case 'SECURITY_CLAIM':
      return 'Built with security in mind';
    case 'TESTIMONIAL':
      return ''; // Remove entirely, replaced by "Early Access" section
    case 'LOGO_CLAIM':
      return ''; // Remove entirely
    case 'BRAND_MISMATCH':
      return ''; // Handled by rename
    default:
      return '';
  }
}
