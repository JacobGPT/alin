/**
 * ALIN Sites Manifest — `alin.site.json`
 *
 * Canonical serialization target for SiteModel v1.
 * Stored in the site output root, it makes parsing deterministic
 * on subsequent reads.
 */

import type { SiteModel } from './siteModel';

// ============================================================================
// MANIFEST ENVELOPE
// ============================================================================

export const MANIFEST_FILENAME = 'alin.site.json';
export const CURRENT_MANIFEST_VERSION = '1.0.0';

export interface SiteManifest {
  /** Schema identifier */
  $schema: 'alin-site-manifest';
  /** Schema version for migration support */
  manifestVersion: string;
  /** ISO timestamp of last generation */
  generatedAt: string;
  /** Generator identifier */
  generator: string;
  /** The full SiteModel payload */
  site: SiteModel;
}

// ============================================================================
// SERIALIZATION
// ============================================================================

export function siteModelToManifest(model: SiteModel): SiteManifest {
  return {
    $schema: 'alin-site-manifest',
    manifestVersion: CURRENT_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    generator: 'alin-sites-v1',
    site: model,
  };
}

export function manifestToSiteModel(manifest: SiteManifest): SiteModel {
  // Future: run migrations if manifest.manifestVersion < CURRENT_MANIFEST_VERSION
  if (manifest.manifestVersion !== CURRENT_MANIFEST_VERSION) {
    return migrateManifest(manifest);
  }
  return manifest.site;
}

// ============================================================================
// MIGRATIONS (placeholder for forward compatibility)
// ============================================================================

function migrateManifest(manifest: SiteManifest): SiteModel {
  // v1 is the first version — no migrations needed yet.
  // Future versions will add migration steps here:
  //   if (manifest.manifestVersion === '0.9.0') { ... migrate to 1.0.0 ... }
  console.warn(
    `[SiteManifest] Unknown manifest version "${manifest.manifestVersion}", ` +
    `treating as ${CURRENT_MANIFEST_VERSION}. Data may be incomplete.`
  );
  return manifest.site;
}

// ============================================================================
// MANIFEST VALIDATION (structural)
// ============================================================================

export function isValidManifestEnvelope(data: unknown): data is SiteManifest {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.$schema === 'alin-site-manifest' &&
    typeof obj.manifestVersion === 'string' &&
    typeof obj.generatedAt === 'string' &&
    typeof obj.generator === 'string' &&
    obj.site != null &&
    typeof obj.site === 'object'
  );
}

export function serializeManifest(manifest: SiteManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function deserializeManifest(json: string): SiteManifest {
  const parsed = JSON.parse(json);
  if (!isValidManifestEnvelope(parsed)) {
    throw new Error(
      'Invalid alin.site.json: missing $schema, manifestVersion, or site payload'
    );
  }
  return parsed;
}
