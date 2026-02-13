/**
 * Cognitive Processing Layer Types
 *
 * Extends SiteBrief with structured intelligence: contradiction detection,
 * risky claim tracking, confidence scoring, and clarification prioritization.
 *
 * This module is pure types — no logic, no side-effects.
 */

import type { SiteBrief, MissingQuestion, ExtractBriefResult } from '../../../api/dbService';

// ============================================================================
// RISKY CLAIMS
// ============================================================================

/** A claim detected in user input that may need verification */
export interface RiskyClaim {
  id: string;
  text: string;
  type: 'stat' | 'testimonial' | 'security' | 'award' | 'comparison';
  source: 'user_stated' | 'inferred' | 'unknown';
  verified: boolean;
  suggestion: string;
}

// ============================================================================
// CONTRADICTIONS
// ============================================================================

/** A logical conflict detected between two parts of the brief */
export interface Contradiction {
  id: string;
  claimA: string;
  claimB: string;
  severity: 'blocking' | 'warning';
  resolution?: string;
  resolved: boolean;
}

// ============================================================================
// SOURCE MAP
// ============================================================================

/** Tracks which parts of the brief came from where */
export interface SourceMapEntry {
  field: string;
  origin: 'user_explicit' | 'user_implied' | 'ai_inferred' | 'default' | 'user_answered';
  sourceText?: string;
  confidence: number;
}

// ============================================================================
// BRIEF CONFIDENCE
// ============================================================================

/** Composite confidence score for a brief */
export interface BriefConfidence {
  overall: number; // 0-100
  breakdown: {
    identityCoverage: number;   // productName, tagline, audience
    structureCoverage: number;  // pages, features, pricing
    trustSafety: number;        // no unverified claims, no contradictions
    contentReadiness: number;   // enough info to write copy
  };
  blockingGaps: string[];
  warnings: string[];
}

// ============================================================================
// CLARIFICATION QUESTIONS
// ============================================================================

/** A priority-ranked question for the user */
export interface ClarificationQuestion {
  id: string;
  field: string;
  question: string;
  reason: string;
  impact: 'blocking' | 'important' | 'optional';
  options?: string[];
  defaultValue?: string;
  answered: boolean;
  answer?: string;
}

// ============================================================================
// COGNITIVE BRIEF
// ============================================================================

/** Full cognitive wrapper around SiteBrief */
export interface CognitiveBrief {
  brief: SiteBrief;
  riskyClaims: RiskyClaim[];
  contradictions: Contradiction[];
  sourceMap: SourceMapEntry[];
  confidence: BriefConfidence;
  clarifications: ClarificationQuestion[];
  userPatterns?: UserPatterns;
  version: number;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// RETENTION / USER PATTERNS
// ============================================================================

/** Cross-session user patterns from memory */
export interface UserPatterns {
  preferredTone?: string;
  preferredAesthetic?: string;
  businessType?: string;
  previousProductNames?: string[];
  previousColorSchemes?: string[];
  commonFeatures?: string[];
}

// ============================================================================
// INPUT COMPRESSION
// ============================================================================

/** Result of compressing long user input */
export interface CompressedInput {
  chunks: string[];
  totalChars: number;
  chunkCount: number;
  summary?: string;
}

// ============================================================================
// OUTPUT GUARD
// ============================================================================

/** A generic phrase violation in generated output */
export interface GenericPhraseViolation {
  file: string;
  line: number;
  phrase: string;
  suggestion: string;
}
