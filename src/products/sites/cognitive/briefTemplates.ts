/**
 * Brief Templates — Pre-filled briefs for common business types.
 *
 * 6 templates with sensible defaults: pages, sections, tone, aesthetic, typical features.
 * Shown in wizard as optional starting point.
 *
 * Pure data — no side-effects.
 */

import type { SiteBrief } from '../../../api/dbService';

export type BriefTemplateId = 'saas' | 'agency' | 'portfolio' | 'ecommerce' | 'local' | 'nonprofit';

export interface BriefTemplate {
  id: BriefTemplateId;
  name: string;
  description: string;
  defaults: Partial<SiteBrief>;
  suggestedPages: string[];
  suggestedSections: Record<string, string[]>;
  suggestedTone: string;
  suggestedAesthetic: string;
}

export const BRIEF_TEMPLATES: Record<BriefTemplateId, BriefTemplate> = {
  saas: {
    id: 'saas',
    name: 'SaaS Product',
    description: 'Software-as-a-Service landing page with pricing, features, and signup flow',
    defaults: {
      businessType: 'SaaS',
      toneStyle: 'Professional & Confident',
      designDirection: 'Modern & Clean',
      primaryCTA: 'Start Free Trial',
      goal: 'Convert visitors to free trial signups',
      features: ['Dashboard', 'Analytics', 'Integrations', 'Team Collaboration', 'API Access'],
    },
    suggestedPages: ['Home', 'Features', 'Pricing', 'About', 'Contact'],
    suggestedSections: {
      Home: ['hero', 'features-grid', 'social-proof', 'pricing-preview', 'cta-banner'],
      Features: ['hero', 'feature-detail', 'comparison', 'integrations', 'cta-banner'],
      Pricing: ['hero', 'pricing-table', 'faq', 'cta-banner'],
      About: ['hero', 'story', 'team', 'values'],
      Contact: ['hero', 'contact-form', 'location'],
    },
    suggestedTone: 'Professional & Confident',
    suggestedAesthetic: 'Modern & Clean',
  },

  agency: {
    id: 'agency',
    name: 'Agency / Studio',
    description: 'Creative agency or studio showcase with portfolio and services',
    defaults: {
      businessType: 'Agency',
      toneStyle: 'Bold & Creative',
      designDirection: 'Dark & Bold',
      primaryCTA: 'Start a Project',
      goal: 'Attract new clients and showcase expertise',
      features: ['Strategy', 'Design', 'Development', 'Branding', 'Marketing'],
    },
    suggestedPages: ['Home', 'Work', 'Services', 'About', 'Contact'],
    suggestedSections: {
      Home: ['hero', 'featured-work', 'services-overview', 'testimonials', 'cta-banner'],
      Work: ['hero', 'portfolio-grid', 'case-studies'],
      Services: ['hero', 'service-cards', 'process', 'cta-banner'],
      About: ['hero', 'story', 'team', 'culture'],
      Contact: ['hero', 'contact-form', 'locations'],
    },
    suggestedTone: 'Bold & Creative',
    suggestedAesthetic: 'Dark & Bold',
  },

  portfolio: {
    id: 'portfolio',
    name: 'Portfolio / Personal',
    description: 'Personal portfolio for designers, developers, or creatives',
    defaults: {
      businessType: 'Portfolio',
      toneStyle: 'Personal & Approachable',
      designDirection: 'Minimalist',
      primaryCTA: 'View My Work',
      goal: 'Showcase work and attract freelance clients',
      features: ['Project Showcase', 'Skills', 'Blog', 'Contact'],
    },
    suggestedPages: ['Home', 'Work', 'About', 'Contact'],
    suggestedSections: {
      Home: ['hero', 'featured-projects', 'skills', 'cta-banner'],
      Work: ['hero', 'project-grid'],
      About: ['hero', 'bio', 'experience', 'tools'],
      Contact: ['hero', 'contact-form', 'social-links'],
    },
    suggestedTone: 'Personal & Approachable',
    suggestedAesthetic: 'Minimalist',
  },

  ecommerce: {
    id: 'ecommerce',
    name: 'E-Commerce',
    description: 'Online store or product landing page',
    defaults: {
      businessType: 'E-Commerce',
      toneStyle: 'Friendly & Persuasive',
      designDirection: 'Warm & Organic',
      primaryCTA: 'Shop Now',
      goal: 'Drive product sales and build trust',
      features: ['Product Catalog', 'Shopping Cart', 'Reviews', 'Shipping Info', 'Returns Policy'],
    },
    suggestedPages: ['Home', 'Products', 'About', 'FAQ', 'Contact'],
    suggestedSections: {
      Home: ['hero', 'featured-products', 'benefits', 'testimonials', 'newsletter'],
      Products: ['hero', 'product-grid', 'filters'],
      About: ['hero', 'brand-story', 'values', 'sustainability'],
      FAQ: ['hero', 'faq-accordion'],
      Contact: ['hero', 'contact-form', 'shipping-info'],
    },
    suggestedTone: 'Friendly & Persuasive',
    suggestedAesthetic: 'Warm & Organic',
  },

  local: {
    id: 'local',
    name: 'Local Business',
    description: 'Local business: restaurant, gym, salon, dental, etc.',
    defaults: {
      businessType: 'Local Business',
      toneStyle: 'Warm & Welcoming',
      designDirection: 'Clean & Professional',
      primaryCTA: 'Book an Appointment',
      goal: 'Generate local leads and bookings',
      features: ['Services', 'Hours', 'Location', 'Reviews', 'Booking'],
    },
    suggestedPages: ['Home', 'Services', 'About', 'Contact'],
    suggestedSections: {
      Home: ['hero', 'services-overview', 'testimonials', 'location-map', 'cta-banner'],
      Services: ['hero', 'service-list', 'pricing', 'booking-cta'],
      About: ['hero', 'story', 'team', 'gallery'],
      Contact: ['hero', 'contact-form', 'map', 'hours'],
    },
    suggestedTone: 'Warm & Welcoming',
    suggestedAesthetic: 'Clean & Professional',
  },

  nonprofit: {
    id: 'nonprofit',
    name: 'Nonprofit / Cause',
    description: 'Nonprofit, charity, or cause-driven organization',
    defaults: {
      businessType: 'Nonprofit',
      toneStyle: 'Inspiring & Compassionate',
      designDirection: 'Warm & Organic',
      primaryCTA: 'Donate Now',
      goal: 'Drive donations and volunteer signups',
      features: ['Mission', 'Impact', 'Programs', 'Volunteer', 'Donate'],
    },
    suggestedPages: ['Home', 'About', 'Programs', 'Get Involved', 'Donate'],
    suggestedSections: {
      Home: ['hero', 'impact-stats', 'programs-preview', 'stories', 'donate-cta'],
      About: ['hero', 'mission', 'history', 'team', 'partners'],
      Programs: ['hero', 'program-cards', 'impact-metrics'],
      'Get Involved': ['hero', 'volunteer-form', 'events', 'newsletter'],
      Donate: ['hero', 'donation-form', 'impact-calculator', 'testimonials'],
    },
    suggestedTone: 'Inspiring & Compassionate',
    suggestedAesthetic: 'Warm & Organic',
  },
};

/**
 * Get defaults from a template, ready to merge into a SiteBrief.
 */
export function getTemplateDefaults(templateId: BriefTemplateId): Partial<SiteBrief> {
  const template = BRIEF_TEMPLATES[templateId];
  if (!template) return {};
  return {
    ...template.defaults,
    navPages: template.suggestedPages,
    pages: template.suggestedPages,
    tone: template.suggestedTone,
  };
}
