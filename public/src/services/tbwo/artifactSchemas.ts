/**
 * Artifact Validation Schemas — Zod-based validation for TBWO artifacts
 *
 * Non-blocking validation: malformed artifacts are stored with status='rejected'
 * so the UI can flag them, but execution continues.
 */

import { z } from 'zod';

export const baseArtifactSchema = z.object({
  name: z.string().min(1, 'Artifact name required'),
  path: z.string().optional(),
  content: z.union([z.string().min(1, 'Content cannot be empty'), z.record(z.unknown())]),
  type: z.string(),
});

export const fileArtifactSchema = baseArtifactSchema.extend({
  path: z.string().min(1, 'File artifacts must have a path'),
  content: z.string().min(1, 'File content cannot be empty'),
});

export const dataArtifactSchema = baseArtifactSchema.extend({
  content: z.union([
    z.string().refine(s => { try { JSON.parse(s); return true; } catch { return false; } }, 'Content must be valid JSON'),
    z.record(z.unknown()),
  ]),
});

export function validateArtifact(artifact: { name: string; path?: string; content: unknown; type: string }):
  { valid: true } | { valid: false; errors: string[] } {
  const schema = artifact.type === 'data' ? dataArtifactSchema
    : (artifact.type === 'file' || artifact.type === 'code') ? fileArtifactSchema
    : baseArtifactSchema;
  const result = schema.safeParse(artifact);
  if (result.success) return { valid: true };
  return { valid: false, errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) };
}
