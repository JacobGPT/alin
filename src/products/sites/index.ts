import { productRegistry } from '../../alin-executive/productRegistry';
import { productUIRegistry } from '../../alin-surface/productUIRegistry';
import { TBWOType } from '../../types/tbwo';
import type { TBWO } from '../../types/tbwo';
import {
  createWebsiteSprintPlan,
  createWebsiteSprintPods,
  DEFAULT_WEBSITE_SPRINT_CONFIG,
  createWebsiteSprintTBWO,
} from './template';
import { WebsiteSprintWizard } from './WebsiteSprintWizard';
import { validateCompleteness } from './sitesValidation';
import type { SiteBrief } from '../../api/dbService';

/**
 * Completeness validator — runs after execution to check all required pages exist.
 */
function sitesCompletenessValidator(tbwo: TBWO): { valid: boolean; errors: string[] } {
  const brief = (tbwo.metadata?.siteBrief as SiteBrief) || null;
  const artifacts = tbwo.artifacts || [];
  const fileNames = artifacts
    .filter((a: any) => a.path || a.name)
    .map((a: any) => (a.path || a.name) as string);

  const result = validateCompleteness(fileNames, brief);
  return {
    valid: result.passed,
    errors: result.checks.filter(c => !c.passed).map(c => c.detail),
  };
}

export function registerSitesProduct(): void {
  // Executive registry — pure orchestration data
  productRegistry.register({
    type: TBWOType.WEBSITE_SPRINT,
    name: 'Website Sprint',
    description: 'Build a complete website with AI pods',
    icon: '\u{1F310}',
    templateFactory: createWebsiteSprintTBWO,
    planFactory: createWebsiteSprintPlan,
    podsFactory: createWebsiteSprintPods,
    defaultConfig: DEFAULT_WEBSITE_SPRINT_CONFIG,
    validators: [sitesCompletenessValidator],
  });

  // Surface UI registry — React wizard component
  productUIRegistry.registerWizard(TBWOType.WEBSITE_SPRINT, WebsiteSprintWizard);
}
