import type { SceneTemplate, SceneTemplateId } from './types';

export const SCENE_TEMPLATES: Record<SceneTemplateId, SceneTemplate> = {
  productSpin: {
    id: 'productSpin', name: 'Product Spin', description: 'Rotating product showcase with orbit controls',
    tier: 'free', defaultCamera: 'orbit-default', defaultLighting: 'studio', defaultMaterial: 'default',
    defaultAnimations: ['rotate-y'], defaultEnvironment: [],
    defaultAsset: { type: 'primitive', id: 'primitive-torusknot' },
    defaultPerformance: { maxPolycount: 50000, maxTextureResolution: 1024, targetFPS: 30, enableLOD: false, mobileMode: 'simplified' },
  },
  floatingShowcase: {
    id: 'floatingShowcase', name: 'Floating Showcase', description: 'Floating object with breathe animation',
    tier: 'free', defaultCamera: 'fixed-front', defaultLighting: 'natural', defaultMaterial: 'default',
    defaultAnimations: ['float', 'breathe'], defaultEnvironment: [],
    defaultAsset: { type: 'primitive', id: 'primitive-sphere' },
    defaultPerformance: { maxPolycount: 50000, maxTextureResolution: 1024, targetFPS: 30, enableLOD: false, mobileMode: 'simplified' },
  },
  abstractHero: {
    id: 'abstractHero', name: 'Abstract Hero', description: 'Abstract shapes with particles for hero sections',
    tier: 'free', defaultCamera: 'fixed-angle', defaultLighting: 'dramatic', defaultMaterial: 'holographic',
    defaultAnimations: ['rotate-orbit'], defaultEnvironment: ['particles-float'],
    defaultAsset: { type: 'primitive', id: 'primitive-torus' },
    defaultPerformance: { maxPolycount: 50000, maxTextureResolution: 1024, targetFPS: 30, enableLOD: false, mobileMode: 'simplified' },
  },
  deviceTilt: {
    id: 'deviceTilt', name: 'Device Tilt', description: 'Hover-tilt device showcase',
    tier: 'pro', defaultCamera: 'orbit-close', defaultLighting: 'natural', defaultMaterial: 'plastic',
    defaultAnimations: ['hover-tilt'], defaultEnvironment: [],
    defaultAsset: { type: 'builtin', id: 'device-laptop' },
    defaultPerformance: { maxPolycount: 50000, maxTextureResolution: 1024, targetFPS: 30, enableLOD: true, mobileMode: 'simplified' },
  },
  scrollReveal: {
    id: 'scrollReveal', name: 'Scroll Reveal', description: 'Scroll-driven camera animation',
    tier: 'pro', defaultCamera: 'scroll-dolly', defaultLighting: 'minimal', defaultMaterial: 'default',
    defaultAnimations: ['scroll-zoom'], defaultEnvironment: [],
    defaultAsset: { type: 'primitive', id: 'primitive-cube' },
    defaultPerformance: { maxPolycount: 50000, maxTextureResolution: 1024, targetFPS: 30, enableLOD: true, mobileMode: 'simplified' },
  },
};

const TIER_HIERARCHY: Record<string, string[]> = {
  free: ['free'],
  pro: ['free', 'pro'],
  elite: ['free', 'pro', 'elite'],
  admin: ['free', 'pro', 'elite'],
};

export function getTemplatesForTier(tier: 'free' | 'pro' | 'elite'): SceneTemplate[] {
  const allowedTiers = TIER_HIERARCHY[tier];
  return Object.values(SCENE_TEMPLATES).filter((template) => allowedTiers.includes(template.tier));
}

export function getTemplateById(id: SceneTemplateId): SceneTemplate | undefined {
  return SCENE_TEMPLATES[id];
}
