/**
 * Motion Validation Module
 *
 * Pure-logic validation for the motion system. Checks HTML, CSS, and JS
 * artifacts for motion quality issues including accessibility, performance,
 * bundle size, and best practices.
 */

import type {
  MotionSpec,
  MotionValidationResult,
  MotionValidationIssue,
} from '../../../types/tbwo';

// Layout-triggering properties that should never be animated
const LAYOUT_PROPERTIES = ['width', 'height', 'top', 'left', 'margin', 'padding'];

// Allowed animated properties (compositor-only)
const ALLOWED_ANIMATED_PROPERTIES = ['transform', 'opacity', 'filter'];

// Banned external animation libraries
const BANNED_DEPS = ['gsap', 'framer-motion', 'animate.css', 'aos', 'lottie'];

// Motion-related file suffixes for bundle size estimation
const MOTION_FILE_PATTERNS = ['motion.js', 'motion-tokens.css', 'motion.css'];

export function validateMotion(
  artifacts: Map<string, string>,
  motionSpec: MotionSpec | null,
): MotionValidationResult {
  const issues: MotionValidationIssue[] = [];

  const cssFiles = new Map<string, string>();
  const htmlFiles = new Map<string, string>();
  const jsFiles = new Map<string, string>();

  for (const [filename, content] of artifacts) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.css')) {
      cssFiles.set(filename, content);
    } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
      htmlFiles.set(filename, content);
    } else if (lower.endsWith('.js') || lower.endsWith('.ts')) {
      jsFiles.set(filename, content);
    }
  }

  // ── Check 1: Reduced motion compliance ──────────────────────────────────
  let reducedMotionCompliant = true;

  for (const [file, content] of cssFiles) {
    const hasAnimation =
      /animation\s*:/i.test(content) ||
      /transition\s*:/i.test(content) ||
      /@keyframes\s/i.test(content);

    if (hasAnimation) {
      const hasReducedMotionQuery = content.includes('@media (prefers-reduced-motion');
      if (!hasReducedMotionQuery) {
        reducedMotionCompliant = false;
        issues.push({
          severity: 'error',
          rule: 'reduced-motion-compliance',
          message: `Missing prefers-reduced-motion media query in ${file}`,
          file,
          fix: 'Add @media (prefers-reduced-motion: reduce) { /* disable animations */ }',
        });
      }
    }
  }

  // ── Check 2: Performance budget - layout animations ─────────────────────
  for (const [file, content] of cssFiles) {
    // Match transition and animation property values
    const transitionRegex = /transition\s*:\s*([^;}{]+)/gi;
    const animationRegex = /@keyframes\s+[\w-]+\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/gi;

    // Check transitions
    let match: RegExpExecArray | null;
    while ((match = transitionRegex.exec(content)) !== null) {
      const transitionValue = match[1];
      for (const prop of LAYOUT_PROPERTIES) {
        // Check if the layout property is the animated property (not just mentioned in a shorthand)
        const propRegex = new RegExp(`(?:^|,|\\s)${prop}(?:\\s|,|$)`, 'i');
        if (propRegex.test(transitionValue) && !ALLOWED_ANIMATED_PROPERTIES.includes(prop)) {
          issues.push({
            severity: 'error',
            rule: 'performance-layout-animation',
            message: `Layout-triggering property "${prop}" used in transition in ${file}. Only transform, opacity, and filter should be animated.`,
            file,
            fix: `Replace "${prop}" animation with transform-based equivalent`,
          });
        }
      }
    }

    // Check @keyframes for layout properties
    while ((match = animationRegex.exec(content)) !== null) {
      const keyframeBody = match[1];
      for (const prop of LAYOUT_PROPERTIES) {
        const propInKeyframe = new RegExp(`${prop}\\s*:`, 'i');
        if (propInKeyframe.test(keyframeBody)) {
          issues.push({
            severity: 'error',
            rule: 'performance-layout-animation',
            message: `Layout-triggering property "${prop}" used in @keyframes in ${file}. Only transform, opacity, and filter should be animated.`,
            file,
            fix: `Replace "${prop}" in keyframes with transform-based equivalent`,
          });
        }
      }
    }
  }

  // ── Check 3: Animation count ────────────────────────────────────────────
  let totalAnimatedElements = 0;

  for (const [, content] of htmlFiles) {
    const dataMotionMatches = content.match(/data-motion/g);
    if (dataMotionMatches) {
      totalAnimatedElements += dataMotionMatches.length;
    }
  }

  if (totalAnimatedElements > 50) {
    issues.push({
      severity: 'error',
      rule: 'animation-count',
      message: `Found ${totalAnimatedElements} animated elements (max recommended: 30)`,
      fix: 'Reduce animated elements to 30 or fewer for optimal performance',
    });
  } else if (totalAnimatedElements > 30) {
    issues.push({
      severity: 'warning',
      rule: 'animation-count',
      message: `Found ${totalAnimatedElements} animated elements (max recommended: 30)`,
      fix: 'Consider reducing animated elements for better performance',
    });
  }

  // ── Check 4: Duration sanity ────────────────────────────────────────────
  if (motionSpec) {
    const allDurations: { value: number; location: string }[] = [];

    // Collect durations from global config
    allDurations.push({ value: motionSpec.global.defaultDuration, location: 'global.defaultDuration' });

    // Collect from sections
    for (const section of motionSpec.sections) {
      allDurations.push({ value: section.entrance.duration, location: `section[${section.sectionType}].entrance.duration` });
      allDurations.push({ value: section.entrance.delay, location: `section[${section.sectionType}].entrance.delay` });
      allDurations.push({ value: section.children.animation.duration, location: `section[${section.sectionType}].children.animation.duration` });
      allDurations.push({ value: section.children.animation.delay, location: `section[${section.sectionType}].children.animation.delay` });
      allDurations.push({ value: section.children.staggerDelay, location: `section[${section.sectionType}].children.staggerDelay` });
    }

    // Collect from hero motion
    allDurations.push({ value: motionSpec.heroMotion.headlineDuration, location: 'heroMotion.headlineDuration' });
    allDurations.push({ value: motionSpec.heroMotion.subheadlineDelay, location: 'heroMotion.subheadlineDelay' });
    allDurations.push({ value: motionSpec.heroMotion.ctaDelay, location: 'heroMotion.ctaDelay' });

    for (const { value, location } of allDurations) {
      if (value > 2000) {
        issues.push({
          severity: 'error',
          rule: 'duration-sanity',
          message: `Duration/delay of ${value}ms at ${location} exceeds 2000ms maximum`,
          fix: 'Reduce duration to 2000ms or less',
        });
      } else if (value > 1000) {
        issues.push({
          severity: 'warning',
          rule: 'duration-sanity',
          message: `Duration/delay of ${value}ms at ${location} exceeds 1000ms recommended limit`,
          fix: 'Consider reducing duration to 1000ms or less for snappier feel',
        });
      }
    }
  }

  // ── Check 5: Stagger overflow ───────────────────────────────────────────
  if (motionSpec) {
    for (const section of motionSpec.sections) {
      if (section.children.stagger && section.children.staggerDelay > 0) {
        // Estimate child count from HTML by finding containers with matching section type
        let estimatedChildren = 0;

        for (const [, htmlContent] of htmlFiles) {
          // Look for sections matching this type and count their direct children
          const sectionRegex = new RegExp(
            `<section[^>]*(?:class|data-section)=[^>]*${section.sectionType}[^>]*>([\\s\\S]*?)</section>`,
            'gi',
          );
          let sectionMatch: RegExpExecArray | null;
          while ((sectionMatch = sectionRegex.exec(htmlContent)) !== null) {
            const sectionBody = sectionMatch[1];
            // Count immediate child-like elements (div, li, article, card, etc.)
            const childMatches = sectionBody.match(/<(?:div|li|article|a|figure|card)[^>]*>/gi);
            if (childMatches) {
              estimatedChildren += childMatches.length;
            }
          }
        }

        // Use a minimum estimate of 4 if we couldn't find containers
        if (estimatedChildren === 0) {
          estimatedChildren = 4;
        }

        const totalStaggerTime = section.children.staggerDelay * estimatedChildren;
        if (totalStaggerTime > 2000) {
          issues.push({
            severity: 'warning',
            rule: 'stagger-overflow',
            message: `Stagger in section "${section.sectionType}" totals ~${totalStaggerTime}ms (${section.children.staggerDelay}ms x ~${estimatedChildren} children). Exceeds 2000ms recommended limit.`,
            fix: `Reduce staggerDelay or limit visible children in "${section.sectionType}"`,
          });
        }
      }
    }
  }

  // ── Check 6: Bundle size estimate ───────────────────────────────────────
  let estimatedBundleSize = 0;
  const encoder = new TextEncoder();

  for (const [filename, content] of artifacts) {
    const lower = filename.toLowerCase();
    const isMotionFile = MOTION_FILE_PATTERNS.some((pattern) => lower.endsWith(pattern));
    if (isMotionFile) {
      estimatedBundleSize += encoder.encode(content).length;
    }
  }

  if (estimatedBundleSize > 25000) {
    issues.push({
      severity: 'error',
      rule: 'bundle-size',
      message: `Motion bundle size is ~${estimatedBundleSize} bytes (max: 25000 bytes)`,
      fix: 'Reduce motion CSS/JS size by removing unused animations or simplifying keyframes',
    });
  } else if (estimatedBundleSize > 15000) {
    issues.push({
      severity: 'warning',
      rule: 'bundle-size',
      message: `Motion bundle size is ~${estimatedBundleSize} bytes (recommended max: 15000 bytes)`,
      fix: 'Consider optimizing motion CSS/JS to reduce bundle size',
    });
  }

  // ── Check 7: Accessibility - decorative animated elements ───────────────
  for (const [file, content] of htmlFiles) {
    const decorativeMotionRegex = /data-motion[^>]*(?:role\s*=\s*["']presentation["']|aria-hidden\s*=\s*["']true["'])/gi;
    const reverseRegex = /(?:role\s*=\s*["']presentation["']|aria-hidden\s*=\s*["']true["'])[^>]*data-motion/gi;

    const matches = (content.match(decorativeMotionRegex) || []).length +
                    (content.match(reverseRegex) || []).length;

    if (matches > 0) {
      issues.push({
        severity: 'info',
        rule: 'accessibility-decorative',
        message: `Found ${matches} decorative animated element(s) with proper aria attributes in ${file} (good practice)`,
        file,
      });
    }
  }

  // ── Check 8: No external dependencies ───────────────────────────────────
  for (const [file, content] of jsFiles) {
    for (const dep of BANNED_DEPS) {
      // Match import/require statements
      const importRegex = new RegExp(
        `(?:import\\s.*from\\s+['"]${dep}|require\\s*\\(\\s*['"]${dep})`,
        'i',
      );
      if (importRegex.test(content)) {
        issues.push({
          severity: 'error',
          rule: 'no-external-deps',
          message: `External animation dependency "${dep}" found in ${file}. Only vanilla CSS/JS animations are allowed.`,
          file,
          fix: `Remove "${dep}" and replace with CSS transitions/animations or vanilla JS`,
        });
      }
    }
  }

  // ── Check 9: Parallax layer count ───────────────────────────────────────
  if (motionSpec && motionSpec.parallax.enabled) {
    if (motionSpec.parallax.layers.length > 5) {
      issues.push({
        severity: 'warning',
        rule: 'parallax-layer-count',
        message: `Parallax has ${motionSpec.parallax.layers.length} layers (max recommended: 5)`,
        fix: 'Reduce parallax layers to 5 or fewer for better performance',
      });
    }
  }

  // ── Check 10: Flicker prevention (FOUC) ─────────────────────────────────
  if (totalAnimatedElements > 0) {
    let hasInitialHidden = false;

    for (const [, content] of cssFiles) {
      // Check for [data-motion] { opacity: 0 } or similar initial hidden state
      const foucPreventionRegex = /\[data-motion\]\s*\{[^}]*opacity\s*:\s*0/i;
      if (foucPreventionRegex.test(content)) {
        hasInitialHidden = true;
        break;
      }
    }

    if (!hasInitialHidden) {
      issues.push({
        severity: 'warning',
        rule: 'fouc-prevention',
        message: 'Animated elements with [data-motion] exist but no initial opacity:0 found in CSS. This may cause a flash of unstyled content (FOUC).',
        fix: 'Add [data-motion] { opacity: 0; } to CSS so elements are hidden until animation triggers',
      });
    }
  }

  // ── Scoring ─────────────────────────────────────────────────────────────
  let score = 100;
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const issue of issues) {
    switch (issue.severity) {
      case 'error':
        score -= 15;
        errorCount++;
        break;
      case 'warning':
        score -= 5;
        warningCount++;
        break;
      case 'info':
        infoCount++;
        break;
    }
  }

  score = Math.max(0, score);

  const passed = score >= 60 && errorCount === 0;

  // ── Summary ─────────────────────────────────────────────────────────────
  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount !== 1 ? 's' : ''}`);
  if (infoCount > 0) parts.push(`${infoCount} info note${infoCount !== 1 ? 's' : ''}`);

  const issuesSuffix = parts.length > 0 ? ` ${parts.join(' and ')} found.` : '';

  const summary = passed
    ? `Motion validation passed with score ${score}/100.${issuesSuffix}`
    : `Motion validation failed with score ${score}/100.${issuesSuffix}`;

  return {
    passed,
    score,
    issues,
    summary,
    totalAnimatedElements,
    estimatedBundleSize,
    reducedMotionCompliant,
  };
}
