import type { SceneSpec, PerformanceBudget, PerformanceCheckResult } from './types';

const TIER_BUDGETS: Record<string, PerformanceBudget> = {
  free: { maxPolycount: 50000, maxTextureResolution: 1024, targetFPS: 30, enableLOD: false, mobileMode: 'simplified' },
  pro: { maxPolycount: 100000, maxTextureResolution: 2048, targetFPS: 60, enableLOD: true, mobileMode: 'simplified' },
  elite: { maxPolycount: 200000, maxTextureResolution: 4096, targetFPS: 60, enableLOD: true, mobileMode: 'full' },
};

const MAX_CONTINUOUS_ANIMATIONS = 5;
const MAX_SCROLL_ANIMATIONS = 3;
const MAX_JS_SIZE = 20000; // 20KB

const PARTICLE_LIMITS: Record<string, number> = { free: 500, pro: 2000, elite: 5000 };

const PRIMITIVE_POLYCOUNTS: Record<string, number> = {
  'primitive-cube': 12, 'primitive-sphere': 2048, 'primitive-torus': 1536, 'primitive-torusknot': 3840,
};
const BUILTIN_POLYCOUNTS: Record<string, number> = {
  'abstract-blob': 5000, 'abstract-wave': 4000, 'abstract-ring': 3000,
  'device-laptop': 15000, 'device-phone': 8000, 'device-headphones': 12000, 'device-speaker': 10000,
};

export function validatePerformance(spec: SceneSpec): PerformanceCheckResult {
  const issues: string[] = [];
  const budget = spec.performance;

  const polycount = estimateScenePolycount(spec);
  if (polycount > budget.maxPolycount) issues.push(`Polycount ${polycount} exceeds budget ${budget.maxPolycount}`);

  const textureRes = budget.maxTextureResolution;

  const continuousAnims = spec.animations.filter(a => ['rotate-y','rotate-x','rotate-orbit','float','float-bounce','breathe'].includes(a)).length;
  const scrollAnims = spec.animations.filter(a => ['scroll-rotate','scroll-zoom','scroll-parallax'].includes(a)).length;
  if (continuousAnims > MAX_CONTINUOUS_ANIMATIONS) issues.push(`${continuousAnims} continuous animations exceed max ${MAX_CONTINUOUS_ANIMATIONS}`);
  if (scrollAnims > MAX_SCROLL_ANIMATIONS) issues.push(`${scrollAnims} scroll animations exceed max ${MAX_SCROLL_ANIMATIONS}`);

  const particleEffects = spec.environment.filter(e => e.startsWith('particles-'));
  const particleCount = particleEffects.length * (spec.overrides?.particleCount ?? 500);

  const estimatedJS = estimateSceneBundleSize(spec);
  if (estimatedJS > MAX_JS_SIZE) issues.push(`Estimated JS size ${estimatedJS} exceeds ${MAX_JS_SIZE} bytes`);

  const hasMobileFallback = spec.performance.mobileMode !== 'full';
  if (!hasMobileFallback && !budget.enableLOD) issues.push('No mobile fallback or LOD configured');

  return {
    passed: issues.length === 0,
    polycount,
    maxPolycount: budget.maxPolycount,
    textureResolution: textureRes,
    maxTextureResolution: budget.maxTextureResolution,
    animationCount: spec.animations.length,
    maxAnimationCount: MAX_CONTINUOUS_ANIMATIONS + MAX_SCROLL_ANIMATIONS,
    particleCount,
    maxParticleCount: PARTICLE_LIMITS[getTierFromBudget(budget)] ?? 500,
    estimatedJSSize: estimatedJS,
    maxJSSize: MAX_JS_SIZE,
    hasMobileFallback,
    hasLOD: budget.enableLOD,
    issues,
  };
}

export function getPerformanceBudget(tier: string): PerformanceBudget {
  return TIER_BUDGETS[tier] ?? TIER_BUDGETS.free;
}

export function estimateScenePolycount(spec: SceneSpec): number {
  const assetPoly = PRIMITIVE_POLYCOUNTS[spec.asset.id] ?? BUILTIN_POLYCOUNTS[spec.asset.id] ?? 5000;
  const particleEffects = spec.environment.filter(e => e.startsWith('particles-'));
  const particlePoly = particleEffects.length * (spec.overrides?.particleCount ?? 500);
  return assetPoly + particlePoly;
}

export function estimateSceneBundleSize(spec: SceneSpec): number {
  let size = 3000; // base IIFE overhead
  size += 500; // camera setup
  size += spec.animations.length * 200; // animation code per animation
  size += spec.environment.length * 400; // environment effects
  if (spec.asset.type !== 'primitive') size += 500; // GLB loader code
  return size;
}

function getTierFromBudget(budget: PerformanceBudget): string {
  if (budget.maxPolycount >= 200000) return 'elite';
  if (budget.maxPolycount >= 100000) return 'pro';
  return 'free';
}
