/**
 * SiteModel Diff Engine
 *
 * Computes a structured patch between two SiteModels.
 * Uses a simplified JSON-Patch-like format scoped to the SiteModel schema.
 */

import type { SiteModel, PageModel, SectionModel, ContentBlock } from './siteModel';

// ============================================================================
// PATCH TYPES
// ============================================================================

export type PatchOp = 'add' | 'remove' | 'replace';

export interface PatchOperation {
  op: PatchOp;
  path: string;        // dot-separated path (e.g. "pages.0.title", "theme.colors.primary")
  value?: unknown;      // present for add/replace
  oldValue?: unknown;   // present for replace (informational)
}

export interface SitePatch {
  fromVersion: string;
  toVersion: string;
  createdAt: number;
  operations: PatchOperation[];
}

export interface PatchSummary {
  humanSummary: string;
  affectedPages: string[];
  riskyFields: string[];
}

// ============================================================================
// DIFF ENGINE
// ============================================================================

/**
 * Compute a structured diff between two SiteModels.
 */
export function diffSiteModels(a: SiteModel, b: SiteModel): SitePatch {
  const operations: PatchOperation[] = [];

  // Top-level scalar fields
  diffScalar(operations, 'name', a.name, b.name);
  diffScalar(operations, 'framework', a.framework, b.framework);

  // Theme
  diffObject(operations, 'theme.colors', a.theme.colors, b.theme.colors);
  diffObject(operations, 'theme.typography', a.theme.typography, b.theme.typography);

  // Deployment
  diffObject(operations, 'deployment', a.deployment as unknown as Record<string, unknown>, b.deployment as unknown as Record<string, unknown>);

  // Globals
  diffScalar(operations, 'globals.siteName', a.globals.siteName, b.globals.siteName);
  diffScalar(operations, 'globals.logoText', a.globals.logoText, b.globals.logoText);
  diffScalar(operations, 'globals.logoSrc', a.globals.logoSrc, b.globals.logoSrc);
  diffArray(operations, 'globals.navigation', a.globals.navigation, b.globals.navigation, (n) => n.href);
  diffArray(operations, 'globals.socialLinks', a.globals.socialLinks || [], b.globals.socialLinks || [], (s) => s.platform);

  // SEO
  diffObject(operations, 'globals.seo', a.globals.seo as unknown as Record<string, unknown>, b.globals.seo as unknown as Record<string, unknown>);

  // Pages
  diffPages(operations, a.pages, b.pages);

  // Assets
  diffArray(operations, 'assets', a.assets, b.assets, (asset) => asset.id);

  // Integrations
  diffObject(operations, 'integrations', a.integrations as unknown as Record<string, unknown>, b.integrations as unknown as Record<string, unknown>);

  return {
    fromVersion: a.version,
    toVersion: b.version,
    createdAt: Date.now(),
    operations,
  };
}

// ============================================================================
// SUMMARIZE
// ============================================================================

const RISKY_PATTERNS = [
  /href/i, /price/i, /checkout/i, /stripe/i, /payment/i,
  /action/i, /submit/i, /form/i, /currency/i,
];

export function summarizePatch(patch: SitePatch): PatchSummary {
  const affectedPagesSet = new Set<string>();
  const riskyFields: string[] = [];

  for (const op of patch.operations) {
    // Extract page route from path
    const pageMatch = op.path.match(/^pages\.(\d+)/);
    if (pageMatch) {
      affectedPagesSet.add(`page[${pageMatch[1]}]`);
    }

    // Check for risky fields
    if (RISKY_PATTERNS.some((p) => p.test(op.path))) {
      riskyFields.push(op.path);
    }
  }

  const counts = { add: 0, remove: 0, replace: 0 };
  for (const op of patch.operations) {
    counts[op.op]++;
  }

  const parts: string[] = [];
  if (counts.add > 0) parts.push(`${counts.add} addition${counts.add > 1 ? 's' : ''}`);
  if (counts.remove > 0) parts.push(`${counts.remove} removal${counts.remove > 1 ? 's' : ''}`);
  if (counts.replace > 0) parts.push(`${counts.replace} change${counts.replace > 1 ? 's' : ''}`);

  const humanSummary = parts.length > 0
    ? `${patch.operations.length} operations: ${parts.join(', ')}`
    : 'No changes';

  return {
    humanSummary,
    affectedPages: [...affectedPagesSet],
    riskyFields,
  };
}

// ============================================================================
// DIFF HELPERS
// ============================================================================

function diffScalar(
  ops: PatchOperation[],
  path: string,
  a: unknown,
  b: unknown
): void {
  if (a === b) return;
  if (a === undefined && b !== undefined) {
    ops.push({ op: 'add', path, value: b });
  } else if (a !== undefined && b === undefined) {
    ops.push({ op: 'remove', path, oldValue: a });
  } else {
    ops.push({ op: 'replace', path, value: b, oldValue: a });
  }
}

function diffObject(
  ops: PatchOperation[],
  basePath: string,
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined
): void {
  if (!a && !b) return;
  if (!a && b) {
    ops.push({ op: 'add', path: basePath, value: b });
    return;
  }
  if (a && !b) {
    ops.push({ op: 'remove', path: basePath, oldValue: a });
    return;
  }

  const allKeys = new Set([...Object.keys(a!), ...Object.keys(b!)]);
  for (const key of allKeys) {
    const aVal = (a as Record<string, unknown>)[key];
    const bVal = (b as Record<string, unknown>)[key];
    const fieldPath = `${basePath}.${key}`;

    if (typeof aVal === 'object' && typeof bVal === 'object' && aVal !== null && bVal !== null && !Array.isArray(aVal)) {
      diffObject(ops, fieldPath, aVal as Record<string, unknown>, bVal as Record<string, unknown>);
    } else if (JSON.stringify(aVal) !== JSON.stringify(bVal)) {
      diffScalar(ops, fieldPath, aVal, bVal);
    }
  }
}

function diffArray<T>(
  ops: PatchOperation[],
  basePath: string,
  a: T[],
  b: T[],
  keyFn: (item: T) => string
): void {
  const aMap = new Map(a.map((item, i) => [keyFn(item), { item, index: i }]));
  const bMap = new Map(b.map((item, i) => [keyFn(item), { item, index: i }]));

  // Removed items
  for (const [key, { index }] of aMap) {
    if (!bMap.has(key)) {
      ops.push({ op: 'remove', path: `${basePath}.${index}`, oldValue: aMap.get(key)!.item });
    }
  }

  // Added or changed items
  for (const [key, { item: bItem, index: bIndex }] of bMap) {
    if (!aMap.has(key)) {
      ops.push({ op: 'add', path: `${basePath}.${bIndex}`, value: bItem });
    } else {
      const aItem = aMap.get(key)!.item;
      if (JSON.stringify(aItem) !== JSON.stringify(bItem)) {
        ops.push({
          op: 'replace',
          path: `${basePath}.${bIndex}`,
          value: bItem,
          oldValue: aItem,
        });
      }
    }
  }
}

function diffPages(
  ops: PatchOperation[],
  aPages: PageModel[],
  bPages: PageModel[]
): void {
  const aMap = new Map(aPages.map((p, i) => [p.id, { page: p, index: i }]));
  const bMap = new Map(bPages.map((p, i) => [p.id, { page: p, index: i }]));

  // Removed pages
  for (const [id, { index }] of aMap) {
    if (!bMap.has(id)) {
      ops.push({ op: 'remove', path: `pages.${index}`, oldValue: aMap.get(id)!.page });
    }
  }

  // Added pages
  for (const [id, { page, index }] of bMap) {
    if (!aMap.has(id)) {
      ops.push({ op: 'add', path: `pages.${index}`, value: page });
      continue;
    }

    // Changed pages — diff fields
    const aPage = aMap.get(id)!.page;
    const bPage = page;
    const pageBase = `pages.${index}`;

    diffScalar(ops, `${pageBase}.route`, aPage.route, bPage.route);
    diffScalar(ops, `${pageBase}.title`, aPage.title, bPage.title);
    diffScalar(ops, `${pageBase}.status`, aPage.status, bPage.status);
    diffScalar(ops, `${pageBase}.layout`, aPage.layout, bPage.layout);
    diffObject(ops, `${pageBase}.seo`, aPage.seo as Record<string, unknown>, bPage.seo as Record<string, unknown>);

    // Sections
    diffSections(ops, `${pageBase}.sections`, aPage.sections, bPage.sections);
  }
}

function diffSections(
  ops: PatchOperation[],
  basePath: string,
  aSections: SectionModel[],
  bSections: SectionModel[]
): void {
  const aMap = new Map(aSections.map((s, i) => [s.id, { section: s, index: i }]));
  const bMap = new Map(bSections.map((s, i) => [s.id, { section: s, index: i }]));

  for (const [id, { index }] of aMap) {
    if (!bMap.has(id)) {
      ops.push({ op: 'remove', path: `${basePath}.${index}`, oldValue: aMap.get(id)!.section });
    }
  }

  for (const [id, { section: bSection, index }] of bMap) {
    if (!aMap.has(id)) {
      ops.push({ op: 'add', path: `${basePath}.${index}`, value: bSection });
      continue;
    }

    const aSection = aMap.get(id)!.section;
    const sectionBase = `${basePath}.${index}`;

    diffScalar(ops, `${sectionBase}.type`, aSection.type, bSection.type);
    diffScalar(ops, `${sectionBase}.variant`, aSection.variant, bSection.variant);
    diffObject(ops, `${sectionBase}.settings`, aSection.settings as Record<string, unknown>, bSection.settings as Record<string, unknown>);

    // Blocks
    diffBlocks(ops, `${sectionBase}.blocks`, aSection.blocks, bSection.blocks);
  }
}

function diffBlocks(
  ops: PatchOperation[],
  basePath: string,
  aBlocks: ContentBlock[],
  bBlocks: ContentBlock[]
): void {
  const aMap = new Map(aBlocks.map((b, i) => [b.id, { block: b, index: i }]));
  const bMap = new Map(bBlocks.map((b, i) => [b.id, { block: b, index: i }]));

  for (const [id, { index }] of aMap) {
    if (!bMap.has(id)) {
      ops.push({ op: 'remove', path: `${basePath}.${index}`, oldValue: aMap.get(id)!.block });
    }
  }

  for (const [id, { block: bBlock, index }] of bMap) {
    if (!aMap.has(id)) {
      ops.push({ op: 'add', path: `${basePath}.${index}`, value: bBlock });
      continue;
    }

    const aBlock = aMap.get(id)!.block;
    if (JSON.stringify(aBlock.content) !== JSON.stringify(bBlock.content)) {
      ops.push({
        op: 'replace',
        path: `${basePath}.${index}.content`,
        value: bBlock.content,
        oldValue: aBlock.content,
      });
    }
  }
}
