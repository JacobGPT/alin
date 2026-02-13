import type { SceneSpec, SceneValidationResult, SceneValidationIssue } from './types';

export function validateScene(
  artifacts: Map<string, string>,
  sceneSpec: SceneSpec | null
): SceneValidationResult {
  const issues: SceneValidationIssue[] = [];
  let score = 100;

  // Find scene-related artifacts
  const sceneJS = findArtifact(artifacts, 'scene-loader.js');
  const sceneCSS = findArtifact(artifacts, 'scene.css');
  const specJson = findArtifact(artifacts, 'sceneSpec.json');

  // If no 3D artifacts at all, return passing (standard mode)
  if (!sceneJS && !sceneCSS && !sceneSpec && !specJson) {
    return {
      passed: true, score: 100, issues: [],
      summary: 'No 3D scene system detected (standard mode).',
      totalPolycount: 0, estimatedBundleSize: 0,
      reducedMotionCompliant: true, mobileFallbackPresent: true,
    };
  }

  // 1. Reduced motion compliance
  if (sceneJS) {
    if (!sceneJS.includes('prefers-reduced-motion')) {
      issues.push({ severity: 'error', rule: 'reduced-motion', message: 'Scene JS must check prefers-reduced-motion media query', file: 'scene-loader.js', fix: 'Add matchMedia("(prefers-reduced-motion: reduce)") check before animation loop' });
      score -= 15;
    }
  }

  // 2. Mobile fallback
  let mobileFallbackPresent = false;
  if (sceneCSS) {
    mobileFallbackPresent = sceneCSS.includes('.scene-fallback');
    if (!mobileFallbackPresent) {
      issues.push({ severity: 'error', rule: 'mobile-fallback', message: 'Scene CSS must include .scene-fallback class for non-WebGL browsers', file: 'scene.css', fix: 'Add .scene-fallback styles with static background image' });
      score -= 15;
    }
  } else {
    issues.push({ severity: 'warning', rule: 'scene-css-missing', message: 'No scene.css found — fallback styles may be missing', fix: 'Generate scene.css with container and fallback styles' });
    score -= 5;
  }

  // 3. Performance budget
  let totalPolycount = 0;
  if (sceneSpec) {
    totalPolycount = estimatePolycount(sceneSpec);
    if (totalPolycount > sceneSpec.performance.maxPolycount) {
      issues.push({ severity: 'error', rule: 'polycount-budget', message: `Estimated polycount ${totalPolycount} exceeds budget ${sceneSpec.performance.maxPolycount}`, fix: 'Use simpler geometry or enable LOD' });
      score -= 15;
    }
    if (sceneSpec.animations.length > 5) {
      issues.push({ severity: 'warning', rule: 'animation-count', message: `${sceneSpec.animations.length} animations may impact performance (max recommended: 5)`, fix: 'Reduce number of concurrent animations' });
      score -= 5;
    }
  }

  // 4. CDN loading (Three.js from CDN, not inline)
  if (sceneJS) {
    const hasCDN = sceneJS.includes('cdn.jsdelivr.net') || sceneJS.includes('cdnjs.cloudflare.com') || sceneJS.includes('unpkg.com');
    if (!hasCDN) {
      issues.push({ severity: 'error', rule: 'cdn-loading', message: 'Three.js must be loaded from CDN, not bundled inline', file: 'scene-loader.js', fix: 'Load Three.js via script tag from cdn.jsdelivr.net' });
      score -= 15;
    }
  }

  // 5. IntersectionObserver pause
  if (sceneJS) {
    if (!sceneJS.includes('IntersectionObserver')) {
      issues.push({ severity: 'warning', rule: 'intersection-observer', message: 'Scene should use IntersectionObserver to pause rendering when off-screen', file: 'scene-loader.js', fix: 'Add IntersectionObserver to pause animation loop when container not visible' });
      score -= 5;
    }
  }

  // 6. Container sizing
  if (sceneCSS) {
    const hasWidth = sceneCSS.includes('width') || sceneCSS.includes('min-width');
    const hasHeight = sceneCSS.includes('height') || sceneCSS.includes('min-height');
    if (!hasWidth || !hasHeight) {
      issues.push({ severity: 'warning', rule: 'container-sizing', message: 'Scene container should have explicit width and height', file: 'scene.css', fix: 'Set width: 100% and min-height on .scene-container' });
      score -= 5;
    }
  }

  // 7. Accessibility
  // Check HTML artifacts for aria-label
  const htmlFiles = Array.from(artifacts.entries()).filter(([k]) => k.endsWith('.html'));
  const hasSceneAriaLabel = htmlFiles.some(([, v]) => v.includes('aria-label') && v.includes('scene'));
  const hasNoscript = htmlFiles.some(([, v]) => v.includes('<noscript'));
  if (sceneJS && !hasSceneAriaLabel) {
    issues.push({ severity: 'warning', rule: 'accessibility-aria', message: 'Scene container should have aria-label for screen readers', fix: 'Add aria-label="3D scene" to scene container div' });
    score -= 5;
  }
  if (sceneJS && !hasNoscript) {
    issues.push({ severity: 'info', rule: 'accessibility-noscript', message: 'Consider adding <noscript> fallback for non-JS browsers', fix: 'Add <noscript> tag with static content description' });
  }

  // 8. Bundle size
  let estimatedBundleSize = 0;
  if (sceneJS) estimatedBundleSize += sceneJS.length;
  if (sceneCSS) estimatedBundleSize += sceneCSS.length;
  if (estimatedBundleSize > 25000) {
    issues.push({ severity: 'warning', rule: 'bundle-size', message: `Scene assets total ${(estimatedBundleSize / 1024).toFixed(1)}KB (recommended: <25KB)`, fix: 'Simplify scene configuration or reduce preset complexity' });
    score -= 5;
  }

  // 9. No infinite loops (rAF, not setInterval)
  if (sceneJS) {
    if (sceneJS.includes('setInterval') && !sceneJS.includes('requestAnimationFrame')) {
      issues.push({ severity: 'error', rule: 'animation-loop', message: 'Use requestAnimationFrame, not setInterval for animation loop', file: 'scene-loader.js', fix: 'Replace setInterval with requestAnimationFrame loop' });
      score -= 15;
    }
  }

  // 10. Asset registry check
  if (sceneSpec && sceneSpec.asset.type === 'builtin') {
    // Just flag if asset id looks suspicious (we don't import registry to keep this independent)
    if (!sceneSpec.asset.id.startsWith('primitive-') && !sceneSpec.asset.id.startsWith('abstract-') && !sceneSpec.asset.id.startsWith('device-')) {
      issues.push({ severity: 'warning', rule: 'asset-registry', message: `Asset "${sceneSpec.asset.id}" may not be in the built-in registry`, fix: 'Use a known asset ID from the asset registry' });
      score -= 5;
    }
  }

  // Reduced motion compliance
  const reducedMotionCompliant = !issues.some(i => i.rule === 'reduced-motion');

  score = Math.max(0, score);
  const passed = score >= 60 && !issues.some(i => i.severity === 'error');

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const summary = passed
    ? `3D scene validation passed (score: ${score}/100, ${warningCount} warnings)`
    : `3D scene validation failed (score: ${score}/100, ${errorCount} errors, ${warningCount} warnings)`;

  return {
    passed, score, issues, summary,
    totalPolycount, estimatedBundleSize,
    reducedMotionCompliant, mobileFallbackPresent,
  };
}

function findArtifact(artifacts: Map<string, string>, filename: string): string | undefined {
  for (const [key, value] of artifacts) {
    if (key.endsWith(filename) || key.includes(filename)) {
      return value;
    }
  }
  return undefined;
}

function estimatePolycount(spec: SceneSpec): number {
  const PRIMITIVE_POLYCOUNTS: Record<string, number> = {
    'primitive-cube': 12,
    'primitive-sphere': 2048,
    'primitive-torus': 1536,
    'primitive-torusknot': 3840,
  };
  const BUILTIN_POLYCOUNTS: Record<string, number> = {
    'abstract-blob': 5000,
    'abstract-wave': 4000,
    'abstract-ring': 3000,
    'device-laptop': 15000,
    'device-phone': 8000,
    'device-headphones': 12000,
    'device-speaker': 10000,
  };
  const count = PRIMITIVE_POLYCOUNTS[spec.asset.id] ?? BUILTIN_POLYCOUNTS[spec.asset.id] ?? 5000;
  // Particles add ~1 poly each
  const particleEffects = spec.environment.filter(e => e.startsWith('particles-'));
  const particleCount = particleEffects.length * (spec.overrides?.particleCount ?? 500);
  return count + particleCount;
}
