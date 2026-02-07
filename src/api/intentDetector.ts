/**
 * Intent Detector - Routes messages to Direct Mode or Sprint Mode
 *
 * Quick classification using pattern matching (no LLM call).
 * Default: direct (80% of interactions are quick tasks).
 */

import type { Message } from '../types/chat';

export type TaskIntent = 'direct' | 'sprint';

const SPRINT_PATTERNS = [
  /build\s+(me\s+)?a\s+/i,
  /create\s+(a\s+)?(full|complete|entire)/i,
  /design\s+and\s+implement/i,
  /multi[- ]?page/i,
  /portfolio|landing\s+page|dashboard/i,
  /from\s+scratch/i,
  /\btbwo\b|\bsprint\b/i,
  /generate\s+(a\s+)?(full|complete|whole)/i,
  /\bwebsite\b.*\bwith\b.*\bpages?\b/i,
  /\bgame\b.*\bwith\b.*\blevels?\b/i,
];

const DIRECT_PATTERNS = [
  /fix\s+(the|this|a)\s+/i,
  /\badd\s+(a\s+)?/i,
  /change|update|modify|rename/i,
  /explain|what\s+(is|does)/i,
  /debug|investigate|find/i,
  /refactor|clean\s*up/i,
  /read|show|list/i,
  /run|execute|test/i,
  /\bhello\b|\bhi\b|\bhey\b/i,
  /\bthanks?\b|\bthank\s+you\b/i,
  /\bhelp\b.*\bwith\b/i,
];

export function detectIntent(message: string, _conversationHistory?: Message[]): TaskIntent {
  const lower = message.toLowerCase();

  // Explicit mode override
  if (/\buse\s+sprint\s+mode\b/i.test(lower) || /\btbwo\b/i.test(lower)) return 'sprint';
  if (/\buse\s+direct\s+mode\b/i.test(lower)) return 'direct';

  const sprintScore = SPRINT_PATTERNS.filter((p) => p.test(lower)).length;
  const directScore = DIRECT_PATTERNS.filter((p) => p.test(lower)).length;

  // Need at least 2 sprint signals to override default
  if (sprintScore > directScore && sprintScore >= 2) return 'sprint';
  return 'direct';
}

/** Direct mode system prompt addition */
export const DIRECT_MODE_PROMPT = `
## DIRECT MODE ACTIVE
You are in DIRECT MODE. Work like a senior engineer:
- Read files before editing. Understand before changing.
- Use tools freely in a tight loop: think → act → observe → repeat.
- Don't ask permission for each step. Just do the work.
- When done, summarize what you did and what to verify.
- If the task is too large for direct mode, call tbwo_create to switch to sprint mode.
`;
