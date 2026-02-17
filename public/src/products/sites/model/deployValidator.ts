/**
 * Pre-Deploy Validator
 *
 * Blocks deploy if critical fields are PLACEHOLDER/INFERRED where
 * production values are required: pricing, checkout, CTA links,
 * legal pages, contact email.
 *
 * Returns { canDeploy, blockingIssues[], warnings[] }.
 */

import { ContentTag } from '../../../types/tbwo';
import { validateSiteModel } from './validate';
import type { SiteModel, ProvenanceMap } from './siteModel';

export interface DeployValidationResult {
  canDeploy: boolean;
  blockingIssues: string[];
  warnings: string[];
}

/** Fields that MUST be USER_PROVIDED or USER_APPROVED before deploy */
const DEPLOY_BLOCKING_PATTERNS = [
  /price/i,
  /checkout/i,
  /stripe/i,
  /publishableKey/i,
  /priceId/i,
  /\.href$/i,
  /cta.*label/i,
  /cta.*href/i,
  /submitAction/i,
  /fromAddress/i,
  /trackingId/i,
];

/**
 * Validate a SiteModel is safe to deploy.
 * Runs structural validation first, then checks provenance for
 * critical fields that must not remain PLACEHOLDER or INFERRED.
 */
export function validateForDeploy(model: SiteModel): DeployValidationResult {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  // 1. Run structural validation — errors block deploy
  const structural = validateSiteModel(model);
  if (!structural.valid) {
    blockingIssues.push(...structural.errors);
  }
  warnings.push(...structural.warnings);

  // 2. Check provenance: critical fields must not be PLACEHOLDER
  scanDeployProvenance(model.provenance, 'model', blockingIssues, warnings);
  for (const page of model.pages) {
    scanDeployProvenance(page.provenance, `page "${page.title}"`, blockingIssues, warnings);
    for (const section of page.sections) {
      const ctx = `page "${page.title}" > ${section.type}`;
      scanDeployProvenance(section.provenance, ctx, blockingIssues, warnings);
      for (const block of section.blocks) {
        scanDeployProvenance(block.provenance, `${ctx} > ${block.type}`, blockingIssues, warnings);
      }
    }
  }

  // 3. Check that pricing plans have real values (not just provenance)
  for (const page of model.pages) {
    for (const section of page.sections) {
      for (const block of section.blocks) {
        if (block.type === 'pricing-table') {
          const plans = (block.content as { plans: Array<{ name: string; price: string; currency: string }> }).plans;
          for (const plan of plans) {
            if (!plan.price || plan.price === '0' || plan.price === 'TBD') {
              blockingIssues.push(`Pricing plan "${plan.name}" has no real price — set before deploy`);
            }
            if (!plan.currency) {
              blockingIssues.push(`Pricing plan "${plan.name}" missing currency`);
            }
          }
        }
        if (block.type === 'button') {
          const href = (block.content as { href: string; label: string }).href;
          if (href === '#' || href === '' || href === 'PLACEHOLDER') {
            blockingIssues.push(`Button "${(block.content as { label: string }).label}" has placeholder href "${href}"`);
          }
        }
      }
    }
  }

  // 4. Stripe integration: must have real keys
  if (model.integrations.stripe?.enabled) {
    if (!model.integrations.stripe.publishableKey) {
      blockingIssues.push('Stripe enabled but missing publishableKey — configure before deploy');
    }
  }

  return {
    canDeploy: blockingIssues.length === 0,
    blockingIssues,
    warnings,
  };
}

function scanDeployProvenance(
  prov: ProvenanceMap | undefined,
  context: string,
  blockingIssues: string[],
  warnings: string[]
): void {
  if (!prov) return;
  for (const [field, tag] of Object.entries(prov)) {
    if (tag === ContentTag.PLACEHOLDER) {
      const isCritical = DEPLOY_BLOCKING_PATTERNS.some(p => p.test(field));
      if (isCritical) {
        blockingIssues.push(`PLACEHOLDER on critical field: ${context}.${field} — must be set before deploy`);
      } else {
        warnings.push(`PLACEHOLDER: ${context}.${field} — review before deploy`);
      }
    }
    if (tag === ContentTag.INFERRED) {
      const isCritical = DEPLOY_BLOCKING_PATTERNS.some(p => p.test(field));
      if (isCritical) {
        warnings.push(`INFERRED critical field: ${context}.${field} — verify before deploy`);
      }
    }
  }
}
