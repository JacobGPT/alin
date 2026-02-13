/**
 * Layout Variants Registry
 *
 * Defines alternative layout structures for common website section types.
 * Used by the section regeneration service to offer layout switching.
 *
 * Pure data — no React, no side-effects.
 */

import type { LayoutVariant } from '../../types/tbwo';

// ============================================================================
// LAYOUT VARIANTS BY SECTION TYPE
// ============================================================================

export const LAYOUT_VARIANTS: Record<string, LayoutVariant[]> = {
  hero: [
    {
      id: 'hero-centered-minimal',
      sectionType: 'hero',
      name: 'Centered Minimal',
      description: 'Clean centered layout with headline, subheadline, and a single CTA.',
      cssHints: 'text-align: center; max-width: 800px; margin: 0 auto; padding: 6rem 2rem;',
      htmlStructure: '<section class="hero"><div class="hero-content" style="text-align:center;max-width:800px;margin:0 auto"><h1>Headline</h1><p class="subheadline">Subheadline</p><a class="cta-button" href="#">CTA</a></div></section>',
    },
    {
      id: 'hero-split-left',
      sectionType: 'hero',
      name: 'Split Left (Text + Image)',
      description: 'Two-column layout with text on the left and an image/visual on the right.',
      cssHints: 'display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; padding: 6rem 4rem;',
      htmlStructure: '<section class="hero"><div class="hero-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:center"><div class="hero-text"><h1>Headline</h1><p>Subheadline</p><a class="cta-button" href="#">CTA</a></div><div class="hero-visual"><img src="" alt="Hero visual"/></div></div></section>',
    },
    {
      id: 'hero-video-bg',
      sectionType: 'hero',
      name: 'Video Background',
      description: 'Full-width hero with a video or animated gradient background and centered overlay text.',
      cssHints: 'position: relative; min-height: 90vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--color-primary), var(--color-secondary));',
      htmlStructure: '<section class="hero hero-video-bg" style="position:relative;min-height:90vh;display:flex;align-items:center;justify-content:center"><div class="hero-overlay" style="text-align:center;color:#fff"><h1>Headline</h1><p>Subheadline</p><a class="cta-button" href="#">CTA</a></div></section>',
    },
    {
      id: 'hero-full-bleed-gradient',
      sectionType: 'hero',
      name: 'Full Bleed Gradient',
      description: 'Edge-to-edge gradient background with bold typography and stacked layout.',
      cssHints: 'background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-accent, #6366f1) 100%); color: #fff; padding: 8rem 2rem; text-align: center;',
      htmlStructure: '<section class="hero hero-gradient" style="background:linear-gradient(135deg,var(--color-primary),#6366f1);color:#fff;padding:8rem 2rem;text-align:center"><h1 style="font-size:3.5rem">Headline</h1><p style="font-size:1.25rem;opacity:0.9">Subheadline</p><div class="cta-group" style="margin-top:2rem"><a class="cta-button" href="#">Primary CTA</a><a class="cta-button-secondary" href="#">Secondary CTA</a></div></section>',
    },
    {
      id: 'hero-dark-glassmorphism',
      sectionType: 'hero',
      name: 'Dark Glassmorphism',
      description: 'Dark background with frosted glass card containing the hero content.',
      cssHints: 'background: #0a0a0a; min-height: 80vh; display: flex; align-items: center; justify-content: center;',
      htmlStructure: '<section class="hero hero-dark" style="background:#0a0a0a;min-height:80vh;display:flex;align-items:center;justify-content:center"><div class="glass-card" style="background:rgba(255,255,255,0.05);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.1);border-radius:1.5rem;padding:4rem;max-width:700px;text-align:center;color:#fff"><h1>Headline</h1><p>Subheadline</p><a class="cta-button" href="#">CTA</a></div></section>',
    },
  ],

  features: [
    {
      id: 'features-grid-3col',
      sectionType: 'features',
      name: '3-Column Grid',
      description: 'Standard 3-column grid of feature cards with icons.',
      cssHints: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; padding: 4rem 2rem;',
      htmlStructure: '<section class="features"><h2>Features</h2><div class="features-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2rem"><div class="feature-card"><div class="feature-icon">ICON</div><h3>Feature Title</h3><p>Description</p></div></div></section>',
    },
    {
      id: 'features-alternating',
      sectionType: 'features',
      name: 'Alternating Rows',
      description: 'Features shown in alternating left-right rows with large visuals.',
      cssHints: 'display: flex; flex-direction: column; gap: 4rem; padding: 4rem 2rem;',
      htmlStructure: '<section class="features features-alt"><h2>Features</h2><div class="feature-row" style="display:grid;grid-template-columns:1fr 1fr;gap:3rem;align-items:center"><div class="feature-text"><h3>Feature</h3><p>Description</p></div><div class="feature-visual"><img src="" alt=""/></div></div></section>',
    },
    {
      id: 'features-icon-cards',
      sectionType: 'features',
      name: 'Icon Cards',
      description: 'Elevated cards with large icons, ideal for 4-6 features.',
      cssHints: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; padding: 4rem 2rem;',
      htmlStructure: '<section class="features"><h2>Features</h2><div class="features-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.5rem"><div class="feature-card" style="background:#fff;border-radius:1rem;padding:2rem;box-shadow:0 2px 8px rgba(0,0,0,0.06)"><div class="icon" style="font-size:2rem">ICON</div><h3>Title</h3><p>Description</p></div></div></section>',
    },
    {
      id: 'features-bento',
      sectionType: 'features',
      name: 'Bento Grid',
      description: 'Magazine-style bento grid with mixed-size feature cards.',
      cssHints: 'display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: auto; gap: 1rem; padding: 4rem 2rem;',
      htmlStructure: '<section class="features features-bento"><h2>Features</h2><div class="bento-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem"><div class="bento-item bento-wide" style="grid-column:span 2;background:#f8f9fa;border-radius:1rem;padding:2rem"><h3>Main Feature</h3><p>Description</p></div><div class="bento-item" style="background:#f8f9fa;border-radius:1rem;padding:2rem"><h3>Feature</h3><p>Short desc</p></div></div></section>',
    },
  ],

  pricing: [
    {
      id: 'pricing-3tier',
      sectionType: 'pricing',
      name: '3-Tier Cards',
      description: 'Classic 3-tier pricing with a highlighted "Popular" middle card.',
      cssHints: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; padding: 4rem 2rem; align-items: start;',
      htmlStructure: '<section class="pricing"><h2>Pricing</h2><div class="pricing-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2rem"><div class="pricing-card"><h3>Basic</h3><div class="price">$X/mo</div><ul><li>Feature</li></ul><a class="cta-button" href="#">Get Started</a></div><div class="pricing-card popular" style="border:2px solid var(--color-primary);transform:scale(1.05)"><span class="badge">Popular</span><h3>Pro</h3><div class="price">$X/mo</div><ul><li>Feature</li></ul><a class="cta-button" href="#">Get Started</a></div><div class="pricing-card"><h3>Enterprise</h3><div class="price">Custom</div><ul><li>Feature</li></ul><a class="cta-button" href="#">Contact Us</a></div></div></section>',
    },
    {
      id: 'pricing-comparison',
      sectionType: 'pricing',
      name: 'Comparison Table',
      description: 'Full feature comparison table with checkmarks across plans.',
      cssHints: 'padding: 4rem 2rem; overflow-x: auto;',
      htmlStructure: '<section class="pricing pricing-table"><h2>Compare Plans</h2><table style="width:100%;border-collapse:collapse"><thead><tr><th>Feature</th><th>Basic</th><th>Pro</th><th>Enterprise</th></tr></thead><tbody><tr><td>Feature Name</td><td>✓</td><td>✓</td><td>✓</td></tr></tbody></table></section>',
    },
    {
      id: 'pricing-simple',
      sectionType: 'pricing',
      name: 'Simple Single',
      description: 'Single plan with a prominent price and feature list.',
      cssHints: 'text-align: center; padding: 4rem 2rem; max-width: 600px; margin: 0 auto;',
      htmlStructure: '<section class="pricing pricing-simple" style="text-align:center;max-width:600px;margin:0 auto;padding:4rem 2rem"><h2>Simple Pricing</h2><div class="price" style="font-size:3rem;font-weight:bold">$X<span style="font-size:1rem">/mo</span></div><ul style="list-style:none;padding:0"><li>Feature included</li></ul><a class="cta-button" href="#">Start Free Trial</a></section>',
    },
  ],

  testimonials: [
    {
      id: 'testimonials-carousel',
      sectionType: 'testimonials',
      name: 'Carousel',
      description: 'Horizontally scrolling testimonial cards with photos and quotes.',
      cssHints: 'overflow-x: auto; display: flex; gap: 2rem; padding: 4rem 2rem; scroll-snap-type: x mandatory;',
      htmlStructure: '<section class="testimonials"><h2>What Our Customers Say</h2><div class="testimonials-scroll" style="display:flex;gap:2rem;overflow-x:auto;scroll-snap-type:x mandatory"><div class="testimonial-card" style="min-width:350px;scroll-snap-align:start;background:#f8f9fa;border-radius:1rem;padding:2rem"><blockquote>"Quote text"</blockquote><div class="author"><img src="" alt="" style="width:48px;height:48px;border-radius:50%"/><div><strong>Name</strong><span>Title</span></div></div></div></div></section>',
    },
    {
      id: 'testimonials-grid',
      sectionType: 'testimonials',
      name: 'Grid',
      description: 'Masonry-style grid of testimonial cards.',
      cssHints: 'display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; padding: 4rem 2rem;',
      htmlStructure: '<section class="testimonials"><h2>Testimonials</h2><div class="testimonials-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1.5rem"><div class="testimonial-card" style="background:#f8f9fa;border-radius:1rem;padding:2rem"><blockquote>"Quote"</blockquote><strong>Name</strong></div></div></section>',
    },
    {
      id: 'testimonials-spotlight',
      sectionType: 'testimonials',
      name: 'Spotlight',
      description: 'Single large testimonial with a hero-sized quote and author photo.',
      cssHints: 'text-align: center; padding: 6rem 2rem; max-width: 800px; margin: 0 auto;',
      htmlStructure: '<section class="testimonials testimonials-spotlight" style="text-align:center;padding:6rem 2rem;max-width:800px;margin:0 auto"><blockquote style="font-size:1.5rem;font-style:italic">"Featured quote"</blockquote><div class="author" style="margin-top:2rem"><img src="" alt="" style="width:64px;height:64px;border-radius:50%;margin:0 auto"/><strong>Name</strong><p>Title, Company</p></div></section>',
    },
  ],

  cta: [
    {
      id: 'cta-banner',
      sectionType: 'cta',
      name: 'Full-Width Banner',
      description: 'Bold banner CTA with background color and centered text.',
      cssHints: 'background: var(--color-primary); color: #fff; text-align: center; padding: 4rem 2rem;',
      htmlStructure: '<section class="cta cta-banner" style="background:var(--color-primary);color:#fff;text-align:center;padding:4rem 2rem"><h2>Ready to Get Started?</h2><p>Subtext here</p><a class="cta-button" href="#" style="background:#fff;color:var(--color-primary)">Get Started</a></section>',
    },
    {
      id: 'cta-split',
      sectionType: 'cta',
      name: 'Split CTA',
      description: 'Two-column CTA with text on one side and form/button on the other.',
      cssHints: 'display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; padding: 4rem;',
      htmlStructure: '<section class="cta cta-split" style="display:grid;grid-template-columns:1fr 1fr;gap:4rem;align-items:center;padding:4rem"><div><h2>Start Today</h2><p>Compelling reason to act now.</p></div><div style="text-align:center"><a class="cta-button" href="#">Sign Up Free</a><p class="cta-note" style="margin-top:0.5rem;font-size:0.875rem;opacity:0.7">No credit card required</p></div></section>',
    },
  ],

  faq: [
    {
      id: 'faq-accordion',
      sectionType: 'faq',
      name: 'Accordion',
      description: 'Expandable FAQ with click-to-reveal answers.',
      cssHints: 'max-width: 800px; margin: 0 auto; padding: 4rem 2rem;',
      htmlStructure: '<section class="faq" style="max-width:800px;margin:0 auto;padding:4rem 2rem"><h2>FAQ</h2><div class="faq-list"><details><summary>Question here?</summary><p>Answer here.</p></details></div></section>',
    },
    {
      id: 'faq-two-column',
      sectionType: 'faq',
      name: 'Two Column',
      description: 'FAQ items in a two-column grid layout.',
      cssHints: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 2rem; padding: 4rem 2rem;',
      htmlStructure: '<section class="faq"><h2>FAQ</h2><div class="faq-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:2rem"><div class="faq-item"><h3>Question?</h3><p>Answer.</p></div></div></section>',
    },
  ],
};

// ============================================================================
// ACCESSORS
// ============================================================================

export function getLayoutVariantsForSection(sectionType: string): LayoutVariant[] {
  return LAYOUT_VARIANTS[sectionType] || [];
}

export function getLayoutVariant(layoutId: string): LayoutVariant | null {
  for (const variants of Object.values(LAYOUT_VARIANTS)) {
    const found = variants.find(v => v.id === layoutId);
    if (found) return found;
  }
  return null;
}
