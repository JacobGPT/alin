/**
 * SiteModel Serializer — writes a SiteModel to a workspace.
 *
 * Primary output: `alin.site.json` (the canonical manifest).
 * The manifest is the source of truth for future reads.
 *
 * `writeSiteToWorkspace` uses Node.js APIs (fs/path) via dynamic import
 * and is only available in server/CLI contexts.
 * `serializeSiteModel` is pure and works in any environment.
 */

import type { SiteModel } from './siteModel';
import {
  MANIFEST_FILENAME,
  siteModelToManifest,
  serializeManifest,
} from './manifest';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Write the SiteModel manifest to a workspace directory.
 * Creates parent directories if needed.
 *
 * NOTE: Uses dynamic imports for Node.js APIs — only works in Node/CLI,
 * not in the browser bundle.
 */
export async function writeSiteToWorkspace(
  model: SiteModel,
  workspacePath: string
): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises');
  const { join, dirname } = await import('path');

  const manifestPath = join(workspacePath, MANIFEST_FILENAME);

  // Ensure directory exists
  await mkdir(dirname(manifestPath), { recursive: true });

  // Build manifest envelope
  const manifest = siteModelToManifest(model);
  const json = serializeManifest(manifest);

  await writeFile(manifestPath, json, 'utf-8');
}

// ============================================================================
// MANIFEST-ONLY SERIALIZATION (string output, no FS)
// ============================================================================

/**
 * Serialize a SiteModel to a manifest JSON string.
 * Useful when writing through an API (e.g. workspace REST endpoint)
 * instead of direct filesystem access.
 */
export function serializeSiteModel(model: SiteModel): string {
  const manifest = siteModelToManifest(model);
  return serializeManifest(manifest);
}
