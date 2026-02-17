/**
 * SiteModel Patch Applicator
 *
 * Applies a SitePatch to a SiteModel deterministically.
 * Validates the result after applying.
 */

import type { SiteModel } from './siteModel';
import type { SitePatch, PatchOperation } from './diff';
import { validateSiteModel } from './validate';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Apply a patch to a SiteModel, returning a new model.
 * Throws if the resulting model is invalid.
 */
export function applyPatch(model: SiteModel, patch: SitePatch): SiteModel {
  // Deep clone to avoid mutating the original
  const result: SiteModel = JSON.parse(JSON.stringify(model));

  // Sort operations: removes in reverse order first, then adds/replaces in order
  const removes = patch.operations
    .filter((op) => op.op === 'remove')
    .sort((a, b) => comparePaths(b.path, a.path)); // reverse order for safe removal

  const addOrReplace = patch.operations
    .filter((op) => op.op !== 'remove')
    .sort((a, b) => comparePaths(a.path, b.path)); // natural order

  // Apply removes first
  for (const op of removes) {
    applyOperation(result as unknown as Record<string, unknown>, op);
  }

  // Then adds and replaces
  for (const op of addOrReplace) {
    applyOperation(result as unknown as Record<string, unknown>, op);
  }

  // Update timestamp
  result.updatedAt = Date.now();

  // Validate result
  const validation = validateSiteModel(result);
  if (!validation.valid) {
    throw new PatchError(
      `Patch produced invalid SiteModel: ${validation.errors.join('; ')}`,
      patch,
      validation.errors
    );
  }

  return result;
}

// ============================================================================
// PATCH ERROR
// ============================================================================

export class PatchError extends Error {
  constructor(
    message: string,
    public readonly patch: SitePatch,
    public readonly validationErrors: string[]
  ) {
    super(message);
    this.name = 'PatchError';
  }
}

// ============================================================================
// OPERATION APPLICATOR
// ============================================================================

function applyOperation(obj: Record<string, unknown>, op: PatchOperation): void {
  const segments = op.path.split('.');
  const lastSeg = segments.pop()!;
  let target: unknown = obj;

  // Navigate to parent
  for (const seg of segments) {
    if (target === null || target === undefined) return;
    if (Array.isArray(target)) {
      const idx = parseInt(seg, 10);
      if (isNaN(idx)) return;
      target = (target as unknown[])[idx];
    } else if (typeof target === 'object') {
      target = (target as Record<string, unknown>)[seg];
    } else {
      return;
    }
  }

  if (target === null || target === undefined) return;

  switch (op.op) {
    case 'replace':
    case 'add': {
      if (Array.isArray(target)) {
        const idx = parseInt(lastSeg, 10);
        if (!isNaN(idx)) {
          if (op.op === 'add' && idx >= (target as unknown[]).length) {
            (target as unknown[]).push(op.value);
          } else {
            (target as unknown[])[idx] = op.value;
          }
        }
      } else if (typeof target === 'object') {
        (target as Record<string, unknown>)[lastSeg] = op.value;
      }
      break;
    }
    case 'remove': {
      if (Array.isArray(target)) {
        const idx = parseInt(lastSeg, 10);
        if (!isNaN(idx)) {
          (target as unknown[]).splice(idx, 1);
        }
      } else if (typeof target === 'object') {
        delete (target as Record<string, unknown>)[lastSeg];
      }
      break;
    }
  }
}

/**
 * Compare two dot-separated paths for sorting.
 * Numeric segments are compared as numbers.
 */
function comparePaths(a: string, b: string): number {
  const aParts = a.split('.');
  const bParts = b.split('.');
  const len = Math.min(aParts.length, bParts.length);

  for (let i = 0; i < len; i++) {
    const aNum = parseInt(aParts[i]!, 10);
    const bNum = parseInt(bParts[i]!, 10);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else {
      const cmp = aParts[i]!.localeCompare(bParts[i]!);
      if (cmp !== 0) return cmp;
    }
  }

  return aParts.length - bParts.length;
}
