/**
 * SiteModel v1 — Public API
 *
 * Structured representation of an ALIN-generated site.
 * Supports: parse, serialize, diff, patch, validate.
 */

// Types
export type {
  SiteModel,
  PageModel,
  SectionModel,
  SectionType,
  ContentBlock,
  ContentBlockType,
  HeadingBlock,
  RichTextBlock,
  ButtonBlock,
  ImageBlock,
  ListBlock,
  FeatureGridBlock,
  PricingTableBlock,
  FAQBlock,
  TestimonialBlock,
  FormBlock,
  FeatureGridItem,
  PricingPlan,
  FAQItem,
  TestimonialItem,
  FormField,
  SiteTheme,
  ColorScale,
  DeploymentConfig,
  SiteIntegrations,
  StripeIntegration,
  AnalyticsIntegration,
  EmailIntegration,
  AssetRef,
  SiteGlobals,
  NavItem,
  SEOData,
  SectionSettings,
  PageStatus,
  PageLock,
  SiteFramework,
  ProvenanceMap,
} from './siteModel';

export { ContentTag } from './siteModel';

// Manifest
export {
  MANIFEST_FILENAME,
  CURRENT_MANIFEST_VERSION,
  siteModelToManifest,
  manifestToSiteModel,
  isValidManifestEnvelope,
  serializeManifest,
  deserializeManifest,
} from './manifest';
export type { SiteManifest } from './manifest';

// Parser
export {
  parseSiteFromWorkspace,
  parseManifest,
  inferSiteModelFallback,
} from './parser';

// Serializer
export {
  writeSiteToWorkspace,
  serializeSiteModel,
} from './serializer';

// Diff
export {
  diffSiteModels,
  summarizePatch,
} from './diff';
export type { SitePatch, PatchOperation, PatchOp, PatchSummary } from './diff';

// Patch
export { applyPatch, PatchError } from './patch';

// Validate
export { validateSiteModel } from './validate';
export type { ValidationResult } from './validate';

// Deploy Validation
export { validateForDeploy } from './deployValidator';
export type { DeployValidationResult } from './deployValidator';

// Manifest Generator
export { generateSiteModelFromTBWO } from './manifestGenerator';
