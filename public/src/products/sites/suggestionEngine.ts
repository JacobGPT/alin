/**
 * ALIN Suggestion Engine — Proactive Design & Animation Recommendations
 *
 * Pure function that analyzes a SiteBrief and returns ALINSuggestion[]
 * for display in Wizard Step 4 (Animation & Effects).
 *
 * Rules are pattern-based: if the brief matches a condition,
 * a suggestion is generated. Users accept/reject in the wizard.
 */

import type { SiteBrief } from '../../api/dbService';
import type { ALINSuggestion, WebsiteSprintConfig } from '../../types/tbwo';

// ============================================================================
// SUGGESTION RULES
// ============================================================================

interface SuggestionRule {
  id: string;
  type: ALINSuggestion['type'];
  condition: (brief: SiteBrief) => boolean;
  pageTarget: (brief: SiteBrief) => string;
  sectionTarget?: string;
  title: string;
  description: string;
  impact: ALINSuggestion['impact'];
  configPatch: Partial<WebsiteSprintConfig>;
}

const RULES: SuggestionRule[] = [
  {
    id: 'hero-3d-float',
    type: '3d',
    condition: (b) => hasPage(b, 'home') || hasPage(b, 'landing'),
    pageTarget: () => 'Home',
    sectionTarget: 'hero',
    title: 'Add a 3D floating element to your hero',
    description: 'A subtle floating geometry or product model in the hero section adds visual depth and a premium feel.',
    impact: 'high',
    configPatch: { scene3DEnabled: true },
  },
  {
    id: 'stats-counter',
    type: 'animation',
    condition: (b) => b.features.length >= 3 || hasSection(b, 'features'),
    pageTarget: () => 'Home',
    sectionTarget: 'features',
    title: 'Scroll-triggered counter animation for stats',
    description: 'Numbers count up from zero as the user scrolls to the stats section. Creates a dynamic, data-driven impression.',
    impact: 'medium',
    configPatch: { animationStyles: ['scroll-linked'] },
  },
  {
    id: 'feature-cards-stagger',
    type: 'animation',
    condition: (b) => b.features.length >= 3,
    pageTarget: () => 'Home',
    sectionTarget: 'features',
    title: 'Staggered reveal animation for feature cards',
    description: 'Feature cards fade in one after another as the user scrolls, creating a cascading entrance effect.',
    impact: 'medium',
    configPatch: { animationStyles: ['staggered-reveals'] },
  },
  {
    id: 'pricing-hover-lift',
    type: 'motion',
    condition: (b) => hasPage(b, 'pricing') || !!b.pricing?.tiers?.length,
    pageTarget: () => 'Pricing',
    sectionTarget: 'pricing',
    title: 'Hover-lift effect on pricing cards',
    description: 'Pricing cards lift and cast a shadow on hover, making the interactive comparison feel tactile.',
    impact: 'low',
    configPatch: {},
  },
  {
    id: 'testimonial-carousel',
    type: 'animation',
    condition: (b) => hasSection(b, 'testimonials'),
    pageTarget: () => 'Home',
    sectionTarget: 'testimonials',
    title: 'Fade-transition testimonial carousel',
    description: 'Testimonials auto-rotate with a smooth crossfade, keeping social proof visible without cluttering the page.',
    impact: 'medium',
    configPatch: { animationStyles: ['scroll-linked'] },
  },
  {
    id: 'parallax-hero',
    type: 'animation',
    condition: (b) => hasPage(b, 'home'),
    pageTarget: () => 'Home',
    sectionTarget: 'hero',
    title: 'Parallax depth effect on hero background',
    description: 'Background image moves at a different speed than the foreground, creating an immersive depth-of-field effect.',
    impact: 'high',
    configPatch: { animationStyles: ['parallax'] },
  },
  {
    id: 'cta-magnetic',
    type: 'motion',
    condition: (b) => !!b.primaryCTA,
    pageTarget: () => 'Home',
    sectionTarget: 'cta',
    title: 'Magnetic cursor effect on CTA buttons',
    description: 'Primary CTA buttons subtly pull toward the cursor on hover, increasing perceived interactivity.',
    impact: 'low',
    configPatch: {},
  },
  {
    id: 'scroll-reveal',
    type: 'animation',
    condition: (b) => getPages(b).length >= 1,
    pageTarget: () => 'All Pages',
    title: 'Scroll-triggered section reveals',
    description: 'Sections fade and slide in as the user scrolls down the page. A baseline animation that makes any site feel more polished.',
    impact: 'high',
    configPatch: { animationStyles: ['scroll-linked'] },
  },
  {
    id: 'hero-clip-reveal',
    type: 'animation',
    condition: () => true,
    pageTarget: () => 'Home',
    sectionTarget: 'hero',
    title: 'Cinematic clip-path headline reveal',
    description: 'The hero headline reveals itself with a clip-path wipe animation on page load, creating a cinematic first impression.',
    impact: 'high',
    configPatch: { animationStyles: ['scroll-linked'] },
  },
  {
    id: 'footer-wave',
    type: 'motion',
    condition: () => true,
    pageTarget: () => 'All Pages',
    sectionTarget: 'footer',
    title: 'Subtle wave animation on footer divider',
    description: 'An animated SVG wave separates the main content from the footer, adding a polished organic touch.',
    impact: 'low',
    configPatch: {},
  },
  {
    id: 'nav-blur',
    type: 'motion',
    condition: (b) => getPages(b).length >= 2,
    pageTarget: () => 'All Pages',
    title: 'Frosted glass effect on sticky navigation',
    description: 'The sticky nav bar gets a backdrop-blur frosted glass effect as the user scrolls, maintaining readability over content.',
    impact: 'medium',
    configPatch: {},
  },
  {
    id: 'dark-mode-toggle',
    type: 'layout',
    condition: () => true,
    pageTarget: () => 'All Pages',
    title: 'CSS dark/light mode toggle',
    description: 'A toggle in the nav lets users switch between dark and light themes. Respects system preference by default.',
    impact: 'medium',
    configPatch: {},
  },
];

// ============================================================================
// HELPERS
// ============================================================================

function getPages(brief: SiteBrief): string[] {
  return brief.navPages?.length ? brief.navPages : brief.pages;
}

function hasPage(brief: SiteBrief, name: string): boolean {
  const pages = getPages(brief);
  return pages.some(p => p.toLowerCase().includes(name.toLowerCase()));
}

function hasSection(brief: SiteBrief, sectionType: string): boolean {
  // Check if any feature or page name suggests this section type
  const allText = [
    ...getPages(brief),
    ...brief.features,
    brief.primaryCTA || '',
  ].join(' ').toLowerCase();
  return allText.includes(sectionType.toLowerCase());
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Analyze a SiteBrief and return a list of ALIN suggestions
 * for animations, 3D elements, motion effects, and layout improvements.
 */
export function generateSuggestions(brief: SiteBrief): ALINSuggestion[] {
  const suggestions: ALINSuggestion[] = [];

  for (const rule of RULES) {
    if (rule.condition(brief)) {
      suggestions.push({
        id: rule.id,
        type: rule.type,
        pageTarget: rule.pageTarget(brief),
        sectionTarget: rule.sectionTarget,
        title: rule.title,
        description: rule.description,
        impact: rule.impact,
        configPatch: rule.configPatch,
      });
    }
  }

  // Sort: high impact first, then medium, then low
  const impactOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);

  return suggestions;
}
