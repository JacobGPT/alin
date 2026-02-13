import type { MotionIntensity } from '../../../types/tbwo';

interface MotionTokenSet {
  // Timing
  '--motion-duration-instant': string;
  '--motion-duration-fast': string;
  '--motion-duration-normal': string;
  '--motion-duration-slow': string;
  '--motion-duration-dramatic': string;

  // Easing
  '--motion-ease-default': string;
  '--motion-ease-enter': string;
  '--motion-ease-exit': string;
  '--motion-ease-spring': string;
  '--motion-ease-bounce': string;

  // Distances
  '--motion-distance-sm': string;
  '--motion-distance-md': string;
  '--motion-distance-lg': string;
  '--motion-distance-xl': string;

  // Stagger
  '--motion-stagger-delay': string;
  '--motion-stagger-max': string;

  // Scale
  '--motion-scale-subtle': string;
  '--motion-scale-normal': string;
  '--motion-scale-dramatic': string;

  // Blur
  '--motion-blur-sm': string;
  '--motion-blur-md': string;
  '--motion-blur-lg': string;
}

const MINIMAL_TOKENS: MotionTokenSet = {
  // Timing — short durations, everything quick and understated
  '--motion-duration-instant': '0ms',
  '--motion-duration-fast': '100ms',
  '--motion-duration-normal': '150ms',
  '--motion-duration-slow': '200ms',
  '--motion-duration-dramatic': '200ms',

  // Easing — ease-out only
  '--motion-ease-default': 'cubic-bezier(0, 0, 0.58, 1)',
  '--motion-ease-enter': 'cubic-bezier(0, 0, 0.58, 1)',
  '--motion-ease-exit': 'cubic-bezier(0, 0, 0.58, 1)',
  '--motion-ease-spring': 'cubic-bezier(0, 0, 0.58, 1)',
  '--motion-ease-bounce': 'cubic-bezier(0, 0, 0.58, 1)',

  // Distances — small
  '--motion-distance-sm': '4px',
  '--motion-distance-md': '8px',
  '--motion-distance-lg': '16px',
  '--motion-distance-xl': '16px',

  // Stagger — disabled
  '--motion-stagger-delay': '0ms',
  '--motion-stagger-max': '0ms',

  // Scale
  '--motion-scale-subtle': '0.98',
  '--motion-scale-normal': '0.95',
  '--motion-scale-dramatic': '0.9',

  // Blur
  '--motion-blur-sm': '4px',
  '--motion-blur-md': '8px',
  '--motion-blur-lg': '16px',
};

const STANDARD_TOKENS: MotionTokenSet = {
  // Timing — balanced
  '--motion-duration-instant': '0ms',
  '--motion-duration-fast': '150ms',
  '--motion-duration-normal': '300ms',
  '--motion-duration-slow': '500ms',
  '--motion-duration-dramatic': '800ms',

  // Easing — natural
  '--motion-ease-default': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  '--motion-ease-enter': 'cubic-bezier(0.0, 0.0, 0.2, 1)',
  '--motion-ease-exit': 'cubic-bezier(0.4, 0.0, 1, 1)',
  '--motion-ease-spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  '--motion-ease-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',

  // Distances — moderate
  '--motion-distance-sm': '8px',
  '--motion-distance-md': '20px',
  '--motion-distance-lg': '40px',
  '--motion-distance-xl': '60px',

  // Stagger — subtle
  '--motion-stagger-delay': '80ms',
  '--motion-stagger-max': '600ms',

  // Scale
  '--motion-scale-subtle': '0.98',
  '--motion-scale-normal': '0.95',
  '--motion-scale-dramatic': '0.9',

  // Blur
  '--motion-blur-sm': '4px',
  '--motion-blur-md': '8px',
  '--motion-blur-lg': '16px',
};

const PREMIUM_TOKENS: MotionTokenSet = {
  // Timing — expressive
  '--motion-duration-instant': '0ms',
  '--motion-duration-fast': '200ms',
  '--motion-duration-normal': '400ms',
  '--motion-duration-slow': '600ms',
  '--motion-duration-dramatic': '800ms',

  // Easing — spring-like
  '--motion-ease-default': 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
  '--motion-ease-enter': 'cubic-bezier(0.0, 0.0, 0.2, 1)',
  '--motion-ease-exit': 'cubic-bezier(0.4, 0.0, 1, 1)',
  '--motion-ease-spring': 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
  '--motion-ease-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',

  // Distances — larger
  '--motion-distance-sm': '12px',
  '--motion-distance-md': '30px',
  '--motion-distance-lg': '50px',
  '--motion-distance-xl': '60px',

  // Stagger — pronounced
  '--motion-stagger-delay': '100ms',
  '--motion-stagger-max': '800ms',

  // Scale — more dramatic
  '--motion-scale-subtle': '0.96',
  '--motion-scale-normal': '0.92',
  '--motion-scale-dramatic': '0.85',

  // Blur — larger
  '--motion-blur-sm': '6px',
  '--motion-blur-md': '12px',
  '--motion-blur-lg': '24px',
};

const TOKEN_SETS: Record<MotionIntensity, MotionTokenSet> = {
  minimal: MINIMAL_TOKENS,
  standard: STANDARD_TOKENS,
  premium: PREMIUM_TOKENS,
};

/**
 * Returns the raw key-value pairs for the given motion intensity.
 */
export function getMotionTokensForIntensity(
  intensity: MotionIntensity
): Record<string, string> {
  return { ...TOKEN_SETS[intensity] };
}

/**
 * Generates a complete CSS string with `:root {}` block containing all motion
 * tokens for the given intensity, plus a `prefers-reduced-motion` media query
 * that zeroes out all durations and distances.
 */
export function generateMotionTokens(intensity: MotionIntensity): string {
  const tokens = TOKEN_SETS[intensity];
  const entries = Object.entries(tokens);

  // Build :root block
  const rootProps = entries
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  // Build reduced-motion overrides: zero out durations and distances
  const reducedProps = entries
    .filter(
      ([key]) =>
        key.startsWith('--motion-duration-') ||
        key.startsWith('--motion-distance-') ||
        key.startsWith('--motion-stagger-')
    )
    .map(([key]) => {
      if (key.startsWith('--motion-duration-') || key.startsWith('--motion-stagger-')) {
        return `    ${key}: 0ms;`;
      }
      return `    ${key}: 0px;`;
    })
    .join('\n');

  return `:root {
${rootProps}
}

@media (prefers-reduced-motion: reduce) {
  :root {
${reducedProps}
  }
}
`;
}
