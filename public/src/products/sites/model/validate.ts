/**
 * SiteModel Validator
 *
 * Checks structural integrity, business rules, and provenance coverage.
 * Returns errors (must fix) and warnings (should fix).
 */

import { ContentTag } from '../../../types/tbwo';
import type {
  SiteModel,
  PageModel,
  SectionModel,
  ContentBlock,
  PricingTableBlock,
  ButtonBlock,
  FormBlock,
  ProvenanceMap,
} from './siteModel';

// ============================================================================
// PUBLIC API
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSiteModel(model: SiteModel): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- Required top-level fields ----
  if (!model.id) errors.push('Missing model id');
  if (!model.name) errors.push('Missing model name');
  if (!model.version) errors.push('Missing model version');
  if (!model.pages || model.pages.length === 0) {
    errors.push('Site must have at least one page');
  }

  // ---- Route uniqueness ----
  const routes = new Set<string>();
  for (const page of model.pages) {
    const normalized = page.route.toLowerCase().replace(/\/+$/, '') || '/';
    if (routes.has(normalized)) {
      errors.push(`Duplicate route: "${page.route}" (page "${page.title}")`);
    }
    routes.add(normalized);
  }

  // ---- Homepage must exist ----
  const hasHomepage = model.pages.some(
    (p) => p.route === '/' || p.route === '/index' || p.route === '/index.html'
  );
  if (!hasHomepage) {
    warnings.push('No homepage found (route "/"). Consider adding one.');
  }

  // ---- Homepage should have a hero section ----
  const homepage = model.pages.find(
    (p) => p.route === '/' || p.route === '/index' || p.route === '/index.html'
  );
  if (homepage) {
    const hasHero = homepage.sections.some((s) => s.type === 'hero');
    if (!hasHero) {
      warnings.push('Homepage is missing a hero section.');
    }
  }

  // ---- Per-page validation ----
  for (let i = 0; i < model.pages.length; i++) {
    const page = model.pages[i]!;
    validatePage(page, i, model, errors, warnings);
  }

  // ---- Theme validation ----
  if (!model.theme) {
    errors.push('Missing theme');
  } else {
    if (!model.theme.colors?.primary) warnings.push('Theme missing primary color');
    if (!model.theme.colors?.text) warnings.push('Theme missing text color');
    if (!model.theme.typography?.bodyFont) warnings.push('Theme missing body font');
  }

  // ---- Globals validation ----
  if (!model.globals) {
    errors.push('Missing globals');
  } else {
    if (!model.globals.siteName) warnings.push('Missing globals.siteName');
  }

  // ---- Integration validation ----
  validateIntegrations(model, errors, warnings);

  // ---- Provenance warnings ----
  checkProvenancePlaceholders(model, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// PAGE VALIDATION
// ============================================================================

function validatePage(
  page: PageModel,
  index: number,
  model: SiteModel,
  errors: string[],
  warnings: string[]
): void {
  const prefix = `pages[${index}] ("${page.title || page.route}")`;

  if (!page.id) errors.push(`${prefix}: missing id`);
  if (!page.route) errors.push(`${prefix}: missing route`);
  if (!page.title) warnings.push(`${prefix}: missing title`);
  if (!page.route.startsWith('/')) {
    errors.push(`${prefix}: route must start with "/" (got "${page.route}")`);
  }

  if (!page.sections || page.sections.length === 0) {
    warnings.push(`${prefix}: has no sections`);
  }

  for (let j = 0; j < (page.sections?.length || 0); j++) {
    const section = page.sections[j]!;
    validateSection(section, `${prefix}.sections[${j}]`, model, errors, warnings);
  }
}

// ============================================================================
// SECTION VALIDATION
// ============================================================================

function validateSection(
  section: SectionModel,
  prefix: string,
  model: SiteModel,
  errors: string[],
  warnings: string[]
): void {
  if (!section.id) errors.push(`${prefix}: missing id`);
  if (!section.type) errors.push(`${prefix}: missing type`);

  for (let k = 0; k < (section.blocks?.length || 0); k++) {
    const block = section.blocks[k]!;
    validateBlock(block, `${prefix}.blocks[${k}]`, model, errors, warnings);
  }
}

// ============================================================================
// BLOCK VALIDATION
// ============================================================================

function validateBlock(
  block: ContentBlock,
  prefix: string,
  model: SiteModel,
  errors: string[],
  warnings: string[]
): void {
  if (!block.id) errors.push(`${prefix}: missing id`);
  if (!block.type) errors.push(`${prefix}: missing type`);

  switch (block.type) {
    case 'pricing-table': {
      const ptb = block as PricingTableBlock;
      for (let p = 0; p < ptb.content.plans.length; p++) {
        const plan = ptb.content.plans[p]!;
        if (!plan.currency) {
          errors.push(`${prefix}.plans[${p}]: pricing plan "${plan.name}" missing currency`);
        }
        if (!plan.price && plan.price !== '0') {
          errors.push(`${prefix}.plans[${p}]: pricing plan "${plan.name}" missing price`);
        }
        if (!plan.cta?.label) {
          warnings.push(`${prefix}.plans[${p}]: pricing plan "${plan.name}" has empty CTA label`);
        }
        // Stripe integration check
        if (model.integrations.stripe?.enabled && !plan.stripePriceId) {
          warnings.push(
            `${prefix}.plans[${p}]: Stripe enabled but plan "${plan.name}" missing stripePriceId`
          );
        }
      }
      break;
    }

    case 'button': {
      const btn = block as ButtonBlock;
      if (!btn.content.label) {
        errors.push(`${prefix}: button has empty label`);
      }
      if (!btn.content.href) {
        warnings.push(`${prefix}: button "${btn.content.label}" has no href`);
      } else {
        validateHref(btn.content.href, prefix, model, errors, warnings);
      }
      break;
    }

    case 'form': {
      const form = block as FormBlock;
      if (!form.content.submitLabel) {
        warnings.push(`${prefix}: form has empty submit label`);
      }
      if (form.content.fields.length === 0) {
        warnings.push(`${prefix}: form has no fields`);
      }
      break;
    }

    case 'heading': {
      if (!(block.content as { text: string }).text) {
        warnings.push(`${prefix}: heading has empty text`);
      }
      break;
    }

    case 'image': {
      if (!(block.content as { alt: string }).alt) {
        warnings.push(`${prefix}: image missing alt text`);
      }
      break;
    }
  }
}

// ============================================================================
// HREF VALIDATION
// ============================================================================

function validateHref(
  href: string,
  prefix: string,
  model: SiteModel,
  _errors: string[],
  warnings: string[]
): void {
  // Absolute URLs are fine
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return;
  }

  // Anchors are fine
  if (href.startsWith('#')) return;

  // Internal routes: check they exist
  if (href.startsWith('/')) {
    const normalized = href.toLowerCase().replace(/\/+$/, '') || '/';
    const routeExists = model.pages.some((p) => {
      const pageRoute = p.route.toLowerCase().replace(/\/+$/, '') || '/';
      return pageRoute === normalized;
    });
    if (!routeExists) {
      warnings.push(`${prefix}: href "${href}" does not match any page route`);
    }
    return;
  }

  // Relative paths — warn
  warnings.push(`${prefix}: href "${href}" is a relative path; prefer absolute or route-based links`);
}

// ============================================================================
// INTEGRATION VALIDATION
// ============================================================================

function validateIntegrations(
  model: SiteModel,
  _errors: string[],
  warnings: string[]
): void {
  const stripe = model.integrations.stripe;
  if (stripe?.enabled) {
    if (!stripe.publishableKey) {
      warnings.push('Stripe enabled but missing publishableKey');
    }
    if (!stripe.products || stripe.products.length === 0) {
      warnings.push('Stripe enabled but no products configured');
    } else {
      for (const product of stripe.products) {
        if (!product.priceId) {
          warnings.push(`Stripe product "${product.name}" missing priceId — tag as USER_PROVIDED when available`);
        }
      }
    }
  }

  const analytics = model.integrations.analytics;
  if (analytics?.enabled && !analytics.trackingId) {
    warnings.push('Analytics enabled but missing trackingId');
  }
}

// ============================================================================
// PROVENANCE CHECKS
// ============================================================================

/** Fields that MUST NOT remain PLACEHOLDER for a deployable site */
const CRITICAL_FIELDS = [
  /price/i,
  /checkout/i,
  /href/i,
  /stripe/i,
  /cta/i,
  /publishableKey/i,
  /trackingId/i,
];

function checkProvenancePlaceholders(
  model: SiteModel,
  warnings: string[]
): void {
  // Model-level provenance
  checkProvenance(model.provenance, 'model', warnings);

  // Page-level provenance
  for (const page of model.pages) {
    checkProvenance(page.provenance, `page "${page.title}"`, warnings);

    for (const section of page.sections) {
      checkProvenance(section.provenance, `page "${page.title}" > section "${section.type}"`, warnings);

      for (const block of section.blocks) {
        checkProvenance(block.provenance, `page "${page.title}" > ${section.type} > block "${block.type}"`, warnings);
      }
    }
  }
}

function checkProvenance(
  prov: ProvenanceMap | undefined,
  context: string,
  warnings: string[]
): void {
  if (!prov) return;
  for (const [field, tag] of Object.entries(prov)) {
    if (tag === ContentTag.PLACEHOLDER) {
      const isCritical = CRITICAL_FIELDS.some((p) => p.test(field));
      if (isCritical) {
        warnings.push(
          `PLACEHOLDER on critical field: ${context}.${field} — must be resolved before deploy`
        );
      } else {
        warnings.push(
          `PLACEHOLDER: ${context}.${field} — review before deploy`
        );
      }
    }
  }
}
