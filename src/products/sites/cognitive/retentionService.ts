/**
 * Retention Service — Stores/retrieves user patterns using memoryStore.
 *
 * Stores: preferred tone, aesthetic, business type, color schemes, features.
 * Recalled on wizard open to pre-fill defaults.
 */

import type { UserPatterns } from './types';
import type { CognitiveBrief } from './types';
import { useMemoryStore } from '../../../store/memoryStore';

const RETENTION_TAG = 'site-retention';
const RETENTION_CATEGORY = 'site_patterns';

/**
 * Store user patterns from a completed cognitive brief into memoryStore.
 */
export function storeUserPatterns(cb: CognitiveBrief): void {
  try {
    // Dynamic import to avoid circular deps
    const store = useMemoryStore.getState();

    const patterns: UserPatterns = {
      preferredTone: cb.brief.toneStyle || undefined,
      preferredAesthetic: cb.brief.designDirection || undefined,
      businessType: cb.brief.businessType || undefined,
      previousProductNames: cb.brief.productName ? [cb.brief.productName] : undefined,
      commonFeatures: cb.brief.features?.length > 0 ? cb.brief.features.slice(0, 10) : undefined,
    };

    // Check for existing retention memory
    const existing = store.retrieveMemories({
      tags: [RETENTION_TAG],
      limit: 1,
    });

    if (existing.length > 0) {
      // Merge with existing patterns
      const existingPatterns = parsePatterns(existing[0].memory.content);
      const merged = mergePatterns(existingPatterns, patterns);
      store.updateMemory(existing[0].memory.id, {
        content: JSON.stringify(merged),
        updatedAt: Date.now(),
      });
    } else {
      // Create new retention memory
      store.addMemory({
        layer: 5, // LONG_TERM
        content: JSON.stringify(patterns),
        salience: 0.8,
        decayRate: 0.01,
        tags: [RETENTION_TAG],
        metadata: { category: RETENTION_CATEGORY },
      });
    }
  } catch (e) {
    console.warn('[retentionService] Failed to store user patterns:', e);
  }
}

/**
 * Recall user patterns from memoryStore.
 */
export function recallUserPatterns(): UserPatterns | null {
  try {
    const store = useMemoryStore.getState();

    const results = store.retrieveMemories({
      tags: [RETENTION_TAG],
      limit: 1,
    });

    if (results.length > 0) {
      return parsePatterns(results[0].memory.content);
    }
  } catch (e) {
    console.warn('[retentionService] Failed to recall user patterns:', e);
  }
  return null;
}

/**
 * Merge retention patterns into wizard config defaults.
 * Returns a new config with pre-filled values where patterns exist.
 */
export function mergeRetentionIntoDefaults<T extends Record<string, unknown>>(
  patterns: UserPatterns,
  defaults: T,
): T {
  const merged = { ...defaults };
  if (patterns.preferredTone && !merged.tone) {
    (merged as any).tone = patterns.preferredTone;
  }
  if (patterns.preferredAesthetic && !merged.aesthetic) {
    (merged as any).aesthetic = patterns.preferredAesthetic;
  }
  if (patterns.businessType && !merged.businessType) {
    (merged as any).businessType = patterns.businessType;
  }
  return merged;
}

// ============================================================================
// HELPERS
// ============================================================================

function parsePatterns(content: string): UserPatterns {
  try {
    return JSON.parse(content) as UserPatterns;
  } catch {
    return {};
  }
}

function mergePatterns(existing: UserPatterns, incoming: UserPatterns): UserPatterns {
  const merged: UserPatterns = { ...existing };

  // Prefer incoming for single-value fields
  if (incoming.preferredTone) merged.preferredTone = incoming.preferredTone;
  if (incoming.preferredAesthetic) merged.preferredAesthetic = incoming.preferredAesthetic;
  if (incoming.businessType) merged.businessType = incoming.businessType;

  // Merge arrays (dedup, cap at 10)
  if (incoming.previousProductNames) {
    merged.previousProductNames = [...new Set([
      ...(incoming.previousProductNames || []),
      ...(existing.previousProductNames || []),
    ])].slice(0, 10);
  }
  if (incoming.commonFeatures) {
    merged.commonFeatures = [...new Set([
      ...(incoming.commonFeatures || []),
      ...(existing.commonFeatures || []),
    ])].slice(0, 15);
  }
  if (incoming.previousColorSchemes) {
    merged.previousColorSchemes = [...new Set([
      ...(incoming.previousColorSchemes || []),
      ...(existing.previousColorSchemes || []),
    ])].slice(0, 5);
  }

  return merged;
}
