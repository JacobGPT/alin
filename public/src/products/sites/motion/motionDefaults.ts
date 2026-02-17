import type {
  MotionIntensity,
  MotionSpec,
  GlobalMotionConfig,
  SectionMotionConfig,
  HeroMotionConfig,
  MicroInteractionConfig,
  ParallaxConfig,
  AdvancedMotionConfig,
  EntranceAnimation,
  ChildrenAnimation,
  PageSection,
} from '../../../types/tbwo';

// ---------------------------------------------------------------------------
// Default entrance animation (no-op baseline)
// ---------------------------------------------------------------------------

function defaultEntrance(overrides?: Partial<EntranceAnimation>): EntranceAnimation {
  return {
    type: 'fade-up',
    duration: 300,
    delay: 0,
    easing: 'ease-out',
    ...overrides,
  };
}

function defaultChildren(overrides?: Partial<ChildrenAnimation>): ChildrenAnimation {
  return {
    stagger: false,
    staggerDelay: 0,
    animation: defaultEntrance(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Global motion config by intensity
// ---------------------------------------------------------------------------

function buildGlobalConfig(intensity: MotionIntensity): GlobalMotionConfig {
  switch (intensity) {
    case 'minimal':
      return {
        scrollRevealEnabled: true,
        staggerDelay: 0,
        defaultEasing: 'cubic-bezier(0,0,0.58,1)',
        defaultDuration: 150,
        reducedMotionFallback: 'instant',
        viewportThreshold: 0.2,
        triggerOnce: true,
      };
    case 'standard':
      return {
        scrollRevealEnabled: true,
        staggerDelay: 80,
        defaultEasing: 'cubic-bezier(0.25,0.46,0.45,0.94)',
        defaultDuration: 300,
        reducedMotionFallback: 'fade-only',
        viewportThreshold: 0.15,
        triggerOnce: true,
      };
    case 'premium':
      return {
        scrollRevealEnabled: true,
        staggerDelay: 100,
        defaultEasing: 'cubic-bezier(0.175,0.885,0.32,1.275)',
        defaultDuration: 500,
        reducedMotionFallback: 'fade-only',
        viewportThreshold: 0.1,
        triggerOnce: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Hero motion config by intensity
// ---------------------------------------------------------------------------

function buildHeroMotion(intensity: MotionIntensity): HeroMotionConfig {
  switch (intensity) {
    case 'minimal':
      return {
        headlineAnimation: 'fade-up',
        headlineDuration: 300,
        subheadlineDelay: 100,
        ctaAnimation: 'fade-in',
        ctaDelay: 200,
        backgroundMotion: 'none',
        backgroundIntensity: 0,
      };
    case 'standard':
      return {
        headlineAnimation: 'fade-up',
        headlineDuration: 500,
        subheadlineDelay: 200,
        ctaAnimation: 'slide-up',
        ctaDelay: 400,
        backgroundMotion: 'gradient-shift',
        backgroundIntensity: 0.3,
      };
    case 'premium':
      return {
        headlineAnimation: 'clip-reveal',
        headlineDuration: 800,
        subheadlineDelay: 300,
        ctaAnimation: 'pulse-glow',
        ctaDelay: 600,
        backgroundMotion: 'gradient-shift',
        backgroundIntensity: 0.6,
      };
  }
}

// ---------------------------------------------------------------------------
// Micro-interaction config by intensity
// ---------------------------------------------------------------------------

function buildMicroInteractions(intensity: MotionIntensity): MicroInteractionConfig {
  switch (intensity) {
    case 'minimal':
      return {
        buttonHover: 'scale',
        buttonClick: 'none',
        cardHover: 'scale',
        linkHover: 'color-shift',
        navHover: 'scale',
        inputFocus: 'border-glow',
        scrollToTop: 'fade',
        tooltips: false,
      };
    case 'standard':
      return {
        buttonHover: 'lift',
        buttonClick: 'ripple',
        cardHover: 'lift-shadow',
        linkHover: 'underline-grow',
        navHover: 'underline-slide',
        inputFocus: 'border-glow',
        scrollToTop: 'slide-up',
        tooltips: true,
      };
    case 'premium':
      return {
        buttonHover: 'glow',
        buttonClick: 'ripple',
        cardHover: 'tilt-3d',
        linkHover: 'underline-grow',
        navHover: 'underline-slide',
        inputFocus: 'underline-expand',
        scrollToTop: 'slide-up',
        tooltips: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Parallax config by intensity
// ---------------------------------------------------------------------------

function buildParallax(intensity: MotionIntensity): ParallaxConfig {
  switch (intensity) {
    case 'minimal':
      return {
        enabled: false,
        layers: [],
        smoothScrolling: false,
        maxSpeed: 0,
      };
    case 'standard':
      return {
        enabled: false,
        layers: [],
        smoothScrolling: false,
        maxSpeed: 0.3,
      };
    case 'premium':
      return {
        enabled: true,
        layers: [
          { selector: '.hero-bg', speed: 0.3, direction: 'vertical', clamp: true },
        ],
        smoothScrolling: true,
        maxSpeed: 0.5,
      };
  }
}

// ---------------------------------------------------------------------------
// Advanced motion config by intensity
// ---------------------------------------------------------------------------

function buildAdvanced(intensity: MotionIntensity): AdvancedMotionConfig {
  switch (intensity) {
    case 'minimal':
      return {
        scrollProgressBar: false,
        scrollProgressPosition: 'top',
        scrollProgressColor: '',
        animatedCounters: false,
        counterDuration: 0,
        counterEasing: 'linear',
        cssCarousels: false,
        carouselAutoplay: false,
        carouselInterval: 0,
        blobMorphing: false,
        blobColors: [],
        magneticCursor: false,
        magneticStrength: 0,
        textGradientAnimation: false,
        smoothAnchorScroll: false,
        smoothScrollDuration: 0,
      };
    case 'standard':
      return {
        scrollProgressBar: true,
        scrollProgressPosition: 'top',
        scrollProgressColor: 'var(--color-primary)',
        animatedCounters: true,
        counterDuration: 1500,
        counterEasing: 'ease-out',
        cssCarousels: false,
        carouselAutoplay: false,
        carouselInterval: 0,
        blobMorphing: false,
        blobColors: [],
        magneticCursor: false,
        magneticStrength: 0,
        textGradientAnimation: false,
        smoothAnchorScroll: false,
        smoothScrollDuration: 0,
      };
    case 'premium':
      return {
        scrollProgressBar: true,
        scrollProgressPosition: 'top',
        scrollProgressColor: 'var(--color-primary)',
        animatedCounters: true,
        counterDuration: 1500,
        counterEasing: 'ease-out',
        cssCarousels: true,
        carouselAutoplay: true,
        carouselInterval: 5000,
        blobMorphing: false,
        blobColors: [],
        magneticCursor: false,
        magneticStrength: 0,
        textGradientAnimation: true,
        smoothAnchorScroll: true,
        smoothScrollDuration: 800,
      };
  }
}

// ---------------------------------------------------------------------------
// Per-section motion defaults
// ---------------------------------------------------------------------------

const INTENSITY_DURATION: Record<MotionIntensity, number> = {
  minimal: 150,
  standard: 300,
  premium: 500,
};

const INTENSITY_STAGGER: Record<MotionIntensity, number> = {
  minimal: 0,
  standard: 80,
  premium: 120,
};

const INTENSITY_EASING: Record<MotionIntensity, string> = {
  minimal: 'ease-out',
  standard: 'cubic-bezier(0.25,0.46,0.45,0.94)',
  premium: 'cubic-bezier(0.175,0.885,0.32,1.275)',
};

export function getSectionMotionDefaults(
  sectionType: string,
  intensity: MotionIntensity,
): SectionMotionConfig {
  const dur = INTENSITY_DURATION[intensity];
  const stag = INTENSITY_STAGGER[intensity];
  const ease = INTENSITY_EASING[intensity];

  switch (sectionType) {
    // ------------------------------------------------------------------
    case 'hero':
      return {
        sectionType: 'hero',
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({ stagger: false, staggerDelay: 0 }),
      };

    // ------------------------------------------------------------------
    case 'features':
      return {
        sectionType: 'features',
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({
          stagger: true,
          staggerDelay: stag,
          animation: defaultEntrance({ type: 'fade-up', duration: dur, easing: ease }),
          selector: '.feature-card, .feature-item, [class*="feature"]',
        }),
      };

    // ------------------------------------------------------------------
    case 'pricing':
      return {
        sectionType: 'pricing',
        entrance: defaultEntrance({
          type: intensity === 'minimal' ? 'fade-up' : 'zoom-in',
          duration: dur,
          delay: 0,
          easing: ease,
          scale: intensity === 'minimal' ? undefined : 0.9,
        }),
        children: defaultChildren({
          stagger: intensity !== 'minimal',
          staggerDelay: stag,
          animation: defaultEntrance({
            type: intensity === 'minimal' ? 'fade-up' : 'zoom-in',
            duration: dur,
            easing: ease,
          }),
          selector: '.pricing-card, .pricing-tier, [class*="pricing"]',
        }),
        custom: {
          pricingToggle: intensity === 'minimal' ? 'fade' : 'slide',
        },
      };

    // ------------------------------------------------------------------
    case 'testimonials':
      return {
        sectionType: 'testimonials',
        entrance: defaultEntrance({ type: 'fade-in' as EntranceAnimation['type'], duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({
          stagger: intensity !== 'minimal',
          staggerDelay: intensity === 'minimal' ? 0 : 100,
          animation: defaultEntrance({ type: 'fade-in' as EntranceAnimation['type'], duration: dur, easing: ease }),
          selector: '.testimonial-card, .testimonial, [class*="testimonial"]',
        }),
        custom: {
          testimonialTransition: intensity === 'premium' ? 'flip-card' : 'fade',
        },
      };

    // ------------------------------------------------------------------
    case 'faq':
      return {
        sectionType: 'faq',
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({
          stagger: intensity !== 'minimal',
          staggerDelay: stag,
          animation: defaultEntrance({ type: 'fade-up', duration: dur, easing: ease }),
          selector: '.faq-item, [class*="faq"]',
        }),
        custom: {
          faqAccordion: 'slide-down',
        },
      };

    // ------------------------------------------------------------------
    case 'cta':
      return {
        sectionType: 'cta',
        entrance: defaultEntrance({
          type: 'fade-up',
          duration: dur,
          delay: 0,
          easing: ease,
          scale: intensity === 'minimal' ? undefined : 0.95,
        }),
        children: defaultChildren({ stagger: false, staggerDelay: 0 }),
      };

    // ------------------------------------------------------------------
    case 'footer':
      return {
        sectionType: 'footer',
        entrance: defaultEntrance({
          type: 'fade-in' as EntranceAnimation['type'],
          duration: Math.round(dur * 0.6),
          delay: 0,
          easing: ease,
        }),
        children: defaultChildren({ stagger: false, staggerDelay: 0 }),
      };

    // ------------------------------------------------------------------
    case 'gallery':
      return {
        sectionType: 'gallery',
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({
          stagger: intensity !== 'minimal',
          staggerDelay: stag,
          animation: defaultEntrance({ type: 'fade-up', duration: dur, easing: ease }),
          selector: '.gallery-item, [class*="gallery"]',
        }),
        custom: {
          galleryReveal:
            intensity === 'premium'
              ? 'stagger-zoom'
              : intensity === 'standard'
                ? 'masonry-fade'
                : 'none',
        },
      };

    // ------------------------------------------------------------------
    case 'team':
      return {
        sectionType: 'team',
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({
          stagger: intensity !== 'minimal',
          staggerDelay: stag,
          animation: defaultEntrance({ type: 'fade-up', duration: dur, easing: ease }),
          selector: '.team-card, .team-member, [class*="team"]',
        }),
      };

    // ------------------------------------------------------------------
    case 'about':
      return {
        sectionType: 'about',
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({ stagger: false, staggerDelay: 0 }),
      };

    // ------------------------------------------------------------------
    default:
      return {
        sectionType,
        entrance: defaultEntrance({ type: 'fade-up', duration: dur, delay: 0, easing: ease }),
        children: defaultChildren({ stagger: false, staggerDelay: 0 }),
      };
  }
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function createDefaultMotionSpec(
  intensity: MotionIntensity,
  sections: PageSection[],
): MotionSpec {
  const global = buildGlobalConfig(intensity);
  const sectionMotions = sections.map((s) => getSectionMotionDefaults(s.type, intensity));
  const heroMotion = buildHeroMotion(intensity);
  const microInteractions = buildMicroInteractions(intensity);
  const parallax = buildParallax(intensity);
  const advanced = buildAdvanced(intensity);

  return {
    intensity,
    global,
    sections: sectionMotions,
    heroMotion,
    microInteractions,
    parallax,
    advanced,
  };
}
