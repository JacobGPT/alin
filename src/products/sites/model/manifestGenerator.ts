/**
 * Manifest Generator — builds a SiteModel from TBWO execution data.
 *
 * Called at the end of a Website Sprint execution to produce `alin.site.json`.
 * Reads the WebsiteSprintConfig stored in TBWO metadata, maps pages/sections/blocks,
 * and carries provenance tags from pause-and-ask responses.
 */

import { nanoid } from 'nanoid';
import { ContentTag } from '../../../types/tbwo';
import type {
  TBWO,
  WebsiteSprintConfig,
  PageDefinition,
  PauseRequest,
} from '../../../types/tbwo';
import type {
  SiteModel,
  PageModel,
  SectionModel,
  SectionType,
  ContentBlock,
  SiteTheme,
  SiteGlobals,
  DeploymentConfig,
  NavItem,
  ProvenanceMap,
  SiteFramework,
} from './siteModel';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generate a SiteModel from a completed TBWO and its sprint config.
 *
 * This produces the canonical `alin.site.json` payload.
 */
export function generateSiteModelFromTBWO(tbwo: TBWO): SiteModel {
  const config = (tbwo.metadata?.websiteSprintConfig as Partial<WebsiteSprintConfig>) || {};

  const framework = mapFramework(config.framework);
  const theme = buildTheme(config);
  const globals = buildGlobals(config, tbwo.objective);
  const pages = buildPages(config);
  const deployment = buildDeployment(config);
  const provenance = buildModelProvenance(tbwo);

  const outputSlug = tbwo.objective
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40);

  return {
    id: nanoid(),
    name: config.navigation?.logoText || extractProjectName(tbwo.objective) || 'ALIN Site',
    version: '1.0.0',
    createdAt: tbwo.createdAt,
    updatedAt: Date.now(),
    framework,
    deployment,
    theme,
    globals,
    pages,
    assets: [],
    integrations: {},
    provenance,
    tbwoId: tbwo.id,
  };
}

/**
 * Serialize the SiteModel to manifest JSON (for writing via workspace API).
 */
export { serializeSiteModel } from './serializer';

// ============================================================================
// FRAMEWORK MAPPING
// ============================================================================

function mapScale(scale?: string): 'compact' | 'medium' | 'large' {
  if (scale === 'small' || scale === 'compact') return 'compact';
  if (scale === 'large') return 'large';
  return 'medium';
}

function mapFramework(fw?: string): SiteFramework {
  switch (fw) {
    case 'react': return 'react';
    case 'vue': return 'vue';
    case 'svelte': return 'svelte';
    default: return 'static';
  }
}

// ============================================================================
// THEME BUILDER
// ============================================================================

function buildTheme(config: Partial<WebsiteSprintConfig>): SiteTheme {
  const colors = config.colorScheme;
  const typo = config.typography;

  return {
    colors: {
      primary: colors?.primary || '#6366f1',
      secondary: colors?.secondary || '#a855f7',
      accent: colors?.accent,
      background: colors?.background || '#ffffff',
      text: colors?.text || '#0f172a',
    },
    typography: {
      headingFont: typo?.headingFont || 'Inter, system-ui, sans-serif',
      bodyFont: typo?.bodyFont || 'Inter, system-ui, sans-serif',
      scale: mapScale(typo?.scale) || 'medium',
    },
    radii: { sm: '4px', md: '8px', lg: '12px', full: '9999px' },
    spacing: { unit: 4 },
  };
}

// ============================================================================
// GLOBALS BUILDER
// ============================================================================

function buildGlobals(
  config: Partial<WebsiteSprintConfig>,
  objective: string
): SiteGlobals {
  const nav = config.navigation;
  const pages = config.pages || [];

  // Build navigation from pages marked isInMainNav
  const navItems: NavItem[] = pages
    .filter((p) => p.isInMainNav)
    .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99))
    .map((p) => ({
      label: p.name,
      href: normalizeRoute(p.path),
    }));

  // Footer navigation
  const footerNav: NavItem[] = (nav?.footerLinks || []).map((l) => ({
    label: l.label,
    href: l.target,
    external: l.isExternal,
  }));

  return {
    siteName: nav?.logoText || extractProjectName(objective) || 'ALIN Site',
    logoText: nav?.logoText,
    navigation: navItems,
    footerNavigation: footerNav.length > 0 ? footerNav : undefined,
    socialLinks: nav?.socialLinks?.map((s) => ({
      platform: s.platform,
      url: s.url,
    })),
    seo: {
      title: nav?.logoText || extractProjectName(objective),
    },
  };
}

// ============================================================================
// PAGE BUILDER
// ============================================================================

function buildPages(config: Partial<WebsiteSprintConfig>): PageModel[] {
  const defs = config.pages || [];
  if (defs.length === 0) {
    // Fallback: single homepage
    return [
      {
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
        provenance: { title: ContentTag.PLACEHOLDER },
      },
    ];
  }

  return defs.map((def) => buildPageFromDefinition(def));
}

function buildPageFromDefinition(def: PageDefinition): PageModel {
  const route = normalizeRoute(def.path);
  const sections = buildSections(def);

  const provenance: ProvenanceMap = {};
  // Mark title provenance based on whether user provided it
  provenance['title'] = def.name ? ContentTag.USER_PROVIDED : ContentTag.PLACEHOLDER;
  if (def.metaDescription) {
    provenance['seo.description'] = ContentTag.USER_PROVIDED;
  }

  return {
    id: nanoid(),
    route,
    title: def.name,
    seo: {
      title: def.name,
      description: def.metaDescription || undefined,
    },
    status: 'draft',
    sections,
    provenance,
  };
}

function buildSections(def: PageDefinition): SectionModel[] {
  return (def.sections || []).map((s) => {
    const sectionType = mapSectionType(s.type);
    const blocks: ContentBlock[] = [];

    // If section has a heading, create a heading block
    if (s.heading) {
      blocks.push({
        id: nanoid(),
        type: 'heading',
        content: { text: s.heading, level: 2 },
        provenance: { 'content.text': ContentTag.USER_PROVIDED },
      });
    }

    // CTA sections get a button block placeholder
    if (sectionType === 'cta') {
      blocks.push({
        id: nanoid(),
        type: 'button',
        content: {
          label: 'Get Started',
          href: '#',
          variant: 'primary',
        },
        provenance: {
          'content.label': ContentTag.INFERRED,
          'content.href': ContentTag.PLACEHOLDER,
        },
      });
    }

    // FAQ sections get an empty FAQ block
    if (sectionType === 'faq') {
      blocks.push({
        id: nanoid(),
        type: 'faq',
        content: { items: [] },
        provenance: { 'content.items': ContentTag.PLACEHOLDER },
      });
    }

    // Pricing sections get an empty pricing block
    if (sectionType === 'pricing') {
      blocks.push({
        id: nanoid(),
        type: 'pricing-table',
        content: { plans: [] },
        provenance: { 'content.plans': ContentTag.PLACEHOLDER },
      });
    }

    // Features sections get an empty feature grid
    if (sectionType === 'features') {
      blocks.push({
        id: nanoid(),
        type: 'feature-grid',
        content: { columns: 3, items: [] },
        provenance: { 'content.items': ContentTag.PLACEHOLDER },
      });
    }

    // Testimonials get an empty testimonial block
    if (sectionType === 'testimonials') {
      blocks.push({
        id: nanoid(),
        type: 'testimonial',
        content: { items: [] },
        provenance: { 'content.items': ContentTag.PLACEHOLDER },
      });
    }

    // Contact sections with form enabled
    if (sectionType === 'contact') {
      blocks.push({
        id: nanoid(),
        type: 'form',
        content: {
          fields: [
            { name: 'name', type: 'text', label: 'Name', required: true },
            { name: 'email', type: 'email', label: 'Email', required: true },
            { name: 'message', type: 'textarea', label: 'Message', required: true },
          ],
          submitLabel: 'Send Message',
        },
        provenance: { 'content.fields': ContentTag.INFERRED },
      });
    }

    return {
      id: nanoid(),
      type: sectionType,
      settings: { padding: 'md' },
      blocks,
      provenance: { type: ContentTag.USER_PROVIDED },
    };
  });
}

function mapSectionType(
  type: string
): SectionType {
  const mapping: Record<string, SectionType> = {
    hero: 'hero',
    features: 'features',
    about: 'about',
    testimonials: 'testimonials',
    cta: 'cta',
    footer: 'footer',
    gallery: 'gallery',
    pricing: 'pricing',
    faq: 'faq',
    team: 'team',
    blog: 'blog',
    custom: 'custom',
    contact: 'contact',
    header: 'header',
  };
  return mapping[type] || 'custom';
}

// ============================================================================
// DEPLOYMENT BUILDER
// ============================================================================

function buildDeployment(config: Partial<WebsiteSprintConfig>): DeploymentConfig {
  if (!config.deployTarget) return { provider: 'none' };

  const mapping: Record<string, DeploymentConfig['provider']> = {
    netlify: 'netlify',
    vercel: 'vercel',
    cloudflare: 'cloudflare',
    'github-pages': 'custom',
  };

  return {
    provider: mapping[config.deployTarget] || 'none',
  };
}

// ============================================================================
// PROVENANCE FROM PAUSE-AND-ASK
// ============================================================================

function buildModelProvenance(tbwo: TBWO): ProvenanceMap {
  const prov: ProvenanceMap = {};

  // Carry provenance from pause-and-ask responses
  const pauses = tbwo.pauseRequests || [];
  for (const pause of pauses) {
    if (pause.status === 'answered' || pause.status === 'inferred') {
      const tag = pause.contentTag || ContentTag.INFERRED;
      if (pause.contextPath) {
        prov[pause.contextPath] = tag;
      }
    }
  }

  return prov;
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizeRoute(path: string): string {
  if (!path) return '/';
  // Convert "/index.html" to "/"
  if (path === '/index.html' || path === 'index.html' || path === '/index') return '/';
  // Ensure leading slash
  const route = path.startsWith('/') ? path : `/${path}`;
  // Remove .html extension for cleaner routes
  return route.replace(/\.html$/, '');
}

function extractProjectName(objective: string): string | undefined {
  // Try to extract quoted project name: Build "My Site": ...
  const match = objective.match(/["']([^"']+)["']/);
  return match?.[1];
}
