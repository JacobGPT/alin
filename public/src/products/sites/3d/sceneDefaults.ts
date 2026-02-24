/**
 * Scene Defaults Factory
 *
 * Creates default SceneSpec based on render mode, section type, and intent keywords.
 * Uses finite keyword→template and keyword→asset dictionaries (no arbitrary geometry).
 */

import type { RenderMode, SceneSpec, SceneTemplateId, PerformanceBudget } from './types';
import { SCENE_TEMPLATES } from './templates';
import { isAssetAvailable } from './assetRegistry';

// ============================================================================
// KEYWORD → TEMPLATE MAPPING
// ============================================================================

const TEMPLATE_KEYWORDS: Record<SceneTemplateId, string[]> = {
  productSpin: ['product', 'spin', 'showcase', 'display', 'shop', 'store', 'ecommerce', 'retail', '360'],
  floatingShowcase: ['floating', 'float', 'elegant', 'minimal', 'clean', 'calm', 'gentle', 'simple'],
  abstractHero: ['abstract', 'hero', 'creative', 'artistic', 'bold', 'dynamic', 'tech', 'futuristic', 'startup'],
  deviceTilt: ['device', 'app', 'software', 'saas', 'laptop', 'phone', 'mobile', 'desktop', 'dashboard'],
  scrollReveal: ['scroll', 'reveal', 'story', 'narrative', 'journey', 'timeline', 'portfolio', 'experience'],
};

// ============================================================================
// KEYWORD → ASSET MAPPING
// ============================================================================

const ASSET_KEYWORDS: Record<string, string[]> = {
  'primitive-torusknot': ['product', 'abstract', 'default', 'creative', 'artistic'],
  'primitive-sphere': ['globe', 'world', 'planet', 'ball', 'round', 'simple', 'clean'],
  'primitive-torus': ['ring', 'loop', 'cycle', 'infinity', 'tech'],
  'primitive-cube': ['box', 'block', 'square', 'minimal', 'basic'],
  'abstract-blob': ['organic', 'fluid', 'blob', 'soft', 'natural'],
  'abstract-wave': ['wave', 'flow', 'ocean', 'water', 'music', 'audio', 'sound'],
  'abstract-ring': ['ring', 'halo', 'portal', 'futuristic', 'sci-fi'],
  'device-laptop': ['laptop', 'computer', 'desktop', 'saas', 'software', 'dashboard', 'app'],
  'device-phone': ['phone', 'mobile', 'ios', 'android', 'app'],
  'device-headphones': ['headphones', 'audio', 'music', 'podcast', 'sound'],
  'device-speaker': ['speaker', 'audio', 'music', 'sound', 'voice'],
};

// ============================================================================
// TIER PERFORMANCE BUDGETS
// ============================================================================

const TIER_PERFORMANCE: Record<string, PerformanceBudget> = {
  free: {
    maxPolycount: 50000,
    maxTextureResolution: 1024,
    targetFPS: 30,
    enableLOD: false,
    mobileMode: 'simplified',
  },
  pro: {
    maxPolycount: 100000,
    maxTextureResolution: 2048,
    targetFPS: 60,
    enableLOD: true,
    mobileMode: 'simplified',
  },
  agency: {
    maxPolycount: 200000,
    maxTextureResolution: 4096,
    targetFPS: 60,
    enableLOD: true,
    mobileMode: 'full',
  },
};

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create a default SceneSpec from render mode, section type, and intent keywords.
 * Returns null for standard render mode (no 3D needed).
 */
export function createDefaultSceneSpec(
  renderMode: RenderMode,
  sectionType: string,
  intentKeywords: string[],
  tier: string
): SceneSpec | null {
  if (renderMode === 'standard') return null;

  const templateId = mapIntentToTemplate(intentKeywords);
  const template = SCENE_TEMPLATES[templateId];
  if (!template) return null;

  // Check tier access — fall back to free-tier template if needed
  const tierOrder = ['free', 'spark', 'pro', 'agency'];
  const userTierIdx = tierOrder.indexOf(tier);
  const templateTierIdx = tierOrder.indexOf(template.tier);
  const effectiveTemplate = templateTierIdx <= userTierIdx
    ? template
    : SCENE_TEMPLATES.productSpin; // safe free fallback

  const assetId = mapIntentToAsset(intentKeywords);
  const asset = isAssetAvailable(assetId, tier as 'free' | 'spark' | 'pro' | 'agency')
    ? { type: 'primitive' as const, id: assetId }
    : effectiveTemplate.defaultAsset;

  const performance = TIER_PERFORMANCE[tier] ?? TIER_PERFORMANCE.free;

  return {
    version: '1.0',
    renderMode,
    template: effectiveTemplate.id,
    asset,
    camera: effectiveTemplate.defaultCamera,
    lighting: effectiveTemplate.defaultLighting,
    material: effectiveTemplate.defaultMaterial,
    animations: [...effectiveTemplate.defaultAnimations],
    environment: [...effectiveTemplate.defaultEnvironment],
    performance,
  };
}

/**
 * Map intent keywords to the best matching template.
 * Uses simple keyword scoring — highest match count wins.
 */
export function mapIntentToTemplate(keywords: string[]): SceneTemplateId {
  const lower = keywords.map(k => k.toLowerCase());
  let bestId: SceneTemplateId = 'abstractHero';
  let bestScore = 0;

  for (const [templateId, templateKeywords] of Object.entries(TEMPLATE_KEYWORDS)) {
    const score = templateKeywords.filter(tk => lower.some(k => k.includes(tk))).length;
    if (score > bestScore) {
      bestScore = score;
      bestId = templateId as SceneTemplateId;
    }
  }

  return bestId;
}

/**
 * Map intent keywords to the best matching asset ID.
 * Falls back to primitive-torusknot.
 */
export function mapIntentToAsset(keywords: string[]): string {
  const lower = keywords.map(k => k.toLowerCase());
  let bestId = 'primitive-torusknot';
  let bestScore = 0;

  for (const [assetId, assetKeywords] of Object.entries(ASSET_KEYWORDS)) {
    const score = assetKeywords.filter(ak => lower.some(k => k.includes(ak))).length;
    if (score > bestScore) {
      bestScore = score;
      bestId = assetId;
    }
  }

  return bestId;
}
