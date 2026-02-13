/**
 * SiteModel Parser — reads a workspace and produces a SiteModel.
 *
 * Strategy:
 * 1. If `alin.site.json` exists → parse, validate, return.
 * 2. Else → infer from file structure (ALIN-generated site layout).
 *
 * Functions that access the filesystem (`parseSiteFromWorkspace`,
 * `inferSiteModelFallback`) use dynamic imports for Node.js APIs
 * so the module can safely be bundled for the browser.
 * `parseManifest` is pure and works in any environment.
 */

import { nanoid } from 'nanoid';
import { ContentTag } from '../../../types/tbwo';
import {
  MANIFEST_FILENAME,
  deserializeManifest,
  manifestToSiteModel,
} from './manifest';
import type {
  SiteModel,
  PageModel,
  SectionModel,
  SectionType,
  SiteTheme,
  SiteGlobals,
  DeploymentConfig,
  AssetRef,
  ProvenanceMap,
} from './siteModel';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Parse a SiteModel from a workspace directory.
 * Prefers manifest if present, falls back to inference.
 *
 * NOTE: Node.js only (uses fs/path via dynamic import).
 */
export async function parseSiteFromWorkspace(
  workspacePath: string
): Promise<SiteModel> {
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');

  const manifestPath = join(workspacePath, MANIFEST_FILENAME);

  try {
    const raw = await readFile(manifestPath, 'utf-8');
    const manifest = deserializeManifest(raw);
    return manifestToSiteModel(manifest);
  } catch {
    // No manifest — fall back to inference
    return inferSiteModelFallback(workspacePath);
  }
}

/**
 * Parse a SiteModel from a raw JSON value (e.g. fetched from API).
 * Validates the manifest envelope and extracts the model.
 *
 * Works in any environment (no Node.js APIs).
 */
export function parseManifest(json: unknown): SiteModel {
  if (typeof json === 'string') {
    const manifest = deserializeManifest(json);
    return manifestToSiteModel(manifest);
  }

  // Already parsed object
  if (
    json &&
    typeof json === 'object' &&
    (json as Record<string, unknown>).$schema === 'alin-site-manifest'
  ) {
    // Re-serialize → deserialize to run validation
    const manifest = deserializeManifest(JSON.stringify(json));
    return manifestToSiteModel(manifest);
  }

  throw new Error('Invalid input: expected alin-site-manifest JSON');
}

// ============================================================================
// INFERENCE ENGINE
// ============================================================================

/**
 * Best-effort inference of SiteModel from file structure.
 * Targets ALIN Website Sprint output layout:
 *   site/index.html, site/about.html, site/styles.css, etc.
 *
 * NOTE: Node.js only (uses fs/path via dynamic import).
 */
export async function inferSiteModelFallback(
  workspacePath: string
): Promise<SiteModel> {
  const { join } = await import('path');

  const siteDir = join(workspacePath, 'site');
  const hasSiteDir = await fsExists(siteDir);
  const scanDir = hasSiteDir ? siteDir : workspacePath;

  // Discover HTML files → pages
  const htmlFiles = await findFiles(scanDir, '.html');
  const pages: PageModel[] = [];

  for (const htmlFile of htmlFiles) {
    const page = await inferPageFromHTML(htmlFile, scanDir);
    pages.push(page);
  }

  // If no pages found, create a placeholder home page
  if (pages.length === 0) {
    pages.push(createPlaceholderPage());
  }

  // Attempt to parse CSS variables for theme
  const theme = await inferTheme(scanDir);

  // Discover assets
  const assetsDir = join(workspacePath, 'assets');
  const assets = await discoverAssets(assetsDir);

  // Build globals from first page's nav (if extractable)
  const globals = inferGlobals(pages);

  // Check for deployment config files
  const deployment = await inferDeployment(workspacePath);

  const model: SiteModel = {
    id: nanoid(),
    name: inferSiteName(workspacePath),
    version: '1.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    framework: 'static', // ALIN Website Sprint defaults to static
    deployment,
    theme,
    globals,
    pages,
    assets,
    integrations: {},
    provenance: { _inferred: ContentTag.INFERRED },
  };

  return model;
}

// ============================================================================
// INFERENCE HELPERS
// ============================================================================

async function inferPageFromHTML(
  filePath: string,
  _baseDir: string
): Promise<PageModel> {
  const { readFile } = await import('fs/promises');
  const { basename } = await import('path');

  const fileName = basename(filePath, '.html');
  const route = fileName === 'index' ? '/' : `/${fileName}`;

  let title = fileName.charAt(0).toUpperCase() + fileName.slice(1);
  let description = '';
  const sections: SectionModel[] = [];
  const provenance: ProvenanceMap = {};

  try {
    const html = await readFile(filePath, 'utf-8');

    // Extract <title>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1]!.trim();
      provenance['title'] = ContentTag.INFERRED;
    } else {
      provenance['title'] = ContentTag.PLACEHOLDER;
    }

    // Extract meta description
    const descMatch = html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
    );
    if (descMatch) {
      description = descMatch[1]!.trim();
      provenance['seo.description'] = ContentTag.INFERRED;
    }

    // Infer sections from HTML structure
    const sectionMatches = html.matchAll(
      /<section[^>]*(?:class=["']([^"']*?)["'])?[^>]*>/gi
    );
    for (const match of sectionMatches) {
      const className = match[1] || '';
      const sectionType = inferSectionType(className);
      sections.push({
        id: nanoid(),
        type: sectionType,
        settings: { padding: 'md' },
        blocks: [],
        provenance: { type: ContentTag.INFERRED },
      });
    }

    // Fallback: if no sections detected, create a generic one
    if (sections.length === 0) {
      sections.push({
        id: nanoid(),
        type: route === '/' ? 'hero' : 'custom',
        settings: { padding: 'md' },
        blocks: [],
        provenance: { type: ContentTag.PLACEHOLDER },
      });
    }
  } catch {
    provenance['title'] = ContentTag.PLACEHOLDER;
    sections.push({
      id: nanoid(),
      type: 'custom',
      settings: { padding: 'md' },
      blocks: [],
      provenance: { type: ContentTag.PLACEHOLDER },
    });
  }

  return {
    id: nanoid(),
    route,
    title,
    seo: { title, description: description || undefined },
    status: 'draft',
    sections,
    provenance,
  };
}

function inferSectionType(className: string): SectionType {
  const lower = className.toLowerCase();
  if (lower.includes('hero')) return 'hero';
  if (lower.includes('feature')) return 'features';
  if (lower.includes('pricing')) return 'pricing';
  if (lower.includes('testimonial')) return 'testimonials';
  if (lower.includes('faq')) return 'faq';
  if (lower.includes('cta') || lower.includes('call-to-action')) return 'cta';
  if (lower.includes('footer')) return 'footer';
  if (lower.includes('header') || lower.includes('nav')) return 'header';
  if (lower.includes('about')) return 'about';
  if (lower.includes('team')) return 'team';
  if (lower.includes('gallery')) return 'gallery';
  if (lower.includes('blog')) return 'blog';
  if (lower.includes('contact')) return 'contact';
  return 'custom';
}

async function inferTheme(dir: string): Promise<SiteTheme> {
  const defaultTheme: SiteTheme = {
    colors: {
      primary: '#6366f1',
      secondary: '#a855f7',
      background: '#ffffff',
      text: '#0f172a',
    },
    typography: {
      headingFont: 'Inter, system-ui, sans-serif',
      bodyFont: 'Inter, system-ui, sans-serif',
      scale: 'medium',
    },
    radii: { sm: '4px', md: '8px', lg: '12px', full: '9999px' },
    spacing: { unit: 4 },
  };

  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');

    // Try to read variables.css for design tokens
    const variablesPath = join(dir, 'variables.css');
    const css = await readFile(variablesPath, 'utf-8');

    const extract = (pattern: RegExp): string | undefined => {
      const m = css.match(pattern);
      return m?.[1]?.trim();
    };

    return {
      colors: {
        primary: extract(/--color-primary\s*:\s*([^;]+)/) || defaultTheme.colors.primary,
        secondary: extract(/--color-secondary\s*:\s*([^;]+)/) || defaultTheme.colors.secondary,
        background: extract(/--color-background\s*:\s*([^;]+)/) || defaultTheme.colors.background,
        text: extract(/--color-text\s*:\s*([^;]+)/) || defaultTheme.colors.text,
        accent: extract(/--color-accent\s*:\s*([^;]+)/),
      },
      typography: {
        headingFont: extract(/--font-heading\s*:\s*([^;]+)/) || defaultTheme.typography.headingFont,
        bodyFont: extract(/--font-body\s*:\s*([^;]+)/) || defaultTheme.typography.bodyFont,
        scale: 'medium',
      },
      radii: defaultTheme.radii,
      spacing: defaultTheme.spacing,
    };
  } catch {
    return defaultTheme;
  }
}

async function discoverAssets(assetsDir: string): Promise<AssetRef[]> {
  const { extname } = await import('path');

  const assets: AssetRef[] = [];
  try {
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif']);
    const files = await findFilesRecursive(assetsDir);
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (imageExts.has(ext)) {
        const relativePath = file.slice(assetsDir.length).replace(/\\/g, '/');
        assets.push({
          id: nanoid(),
          type: ext === '.svg' ? 'icon' : 'image',
          src: `assets${relativePath}`,
        });
      }
    }
  } catch {
    // No assets dir — fine
  }
  return assets;
}

function inferGlobals(pages: PageModel[]): SiteGlobals {
  const navigation = pages.map((p) => ({
    label: p.title,
    href: p.route,
  }));

  return {
    siteName: 'ALIN Site',
    navigation,
    seo: {},
  };
}

async function inferDeployment(dir: string): Promise<DeploymentConfig> {
  const { join } = await import('path');

  if (await fsExists(join(dir, 'netlify.toml'))) {
    return { provider: 'netlify' };
  }
  if (await fsExists(join(dir, 'vercel.json'))) {
    return { provider: 'vercel' };
  }
  if (await fsExists(join(dir, 'wrangler.toml'))) {
    return { provider: 'cloudflare' };
  }
  return { provider: 'none' };
}

function inferSiteName(dir: string): string {
  const parts = dir.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'unnamed-site';
}

function createPlaceholderPage(): PageModel {
  return {
    id: nanoid(),
    route: '/',
    title: 'Home',
    seo: { title: 'Home' },
    status: 'draft',
    sections: [
      {
        id: nanoid(),
        type: 'hero',
        settings: { padding: 'lg' },
        blocks: [],
        provenance: { type: ContentTag.PLACEHOLDER },
      },
    ],
    provenance: { title: ContentTag.PLACEHOLDER, route: ContentTag.PLACEHOLDER },
  };
}

// ============================================================================
// FS UTILITIES (dynamic imports for Node.js APIs)
// ============================================================================

async function fsExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import('fs/promises');
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function findFiles(dir: string, ext: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');

  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(ext)) {
        results.push(join(dir, entry.name));
      }
    }
  } catch {
    // Dir doesn't exist
  }
  return results;
}

async function findFilesRecursive(dir: string): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');

  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await findFilesRecursive(full)));
      } else {
        results.push(full);
      }
    }
  } catch {
    // Dir doesn't exist
  }
  return results;
}
