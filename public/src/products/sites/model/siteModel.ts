/**
 * SiteModel v1 — Structured representation of an ALIN-generated site.
 *
 * This model lets ALIN OPERATE a deployed site: parse it, diff it,
 * patch it, validate it, and track provenance per field.
 *
 * Reuses ContentTag from the TBWO type system for provenance tagging.
 */

import { ContentTag } from '../../../types/tbwo';

// Re-export so consumers can import from model/
export { ContentTag };

// ============================================================================
// PROVENANCE
// ============================================================================

/**
 * Per-field provenance map.  Keys are dot-separated paths relative to
 * the owning object (e.g. "title", "seo.description", "blocks.0.content.text").
 */
export type ProvenanceMap = Record<string, ContentTag>;

// ============================================================================
// DESIGN TOKENS / THEME
// ============================================================================

export interface ColorScale {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
}

export interface SiteTheme {
  colors: {
    primary: string;
    secondary: string;
    accent?: string;
    background: string;
    surface?: string;
    text: string;
    /** Optional full scale — most sites only need the top-level values */
    primaryScale?: Partial<ColorScale>;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    scale: 'compact' | 'medium' | 'large';
    baseSizePx?: number;
  };
  radii: {
    sm: string;
    md: string;
    lg: string;
    full: string;
  };
  spacing: {
    unit: number; // base unit in px (e.g. 4)
  };
}

// ============================================================================
// DEPLOYMENT
// ============================================================================

export interface DeploymentConfig {
  provider: 'vercel' | 'netlify' | 'cloudflare' | 'custom' | 'none';
  projectId?: string;
  url?: string;
  lastDeployedAt?: number;
}

// ============================================================================
// INTEGRATIONS
// ============================================================================

export interface StripeIntegration {
  enabled: boolean;
  publishableKey?: string;
  products?: Array<{
    id: string;
    name: string;
    priceId?: string;
  }>;
}

export interface AnalyticsIntegration {
  enabled: boolean;
  provider?: 'google' | 'plausible' | 'posthog' | 'custom';
  trackingId?: string;
}

export interface EmailIntegration {
  enabled: boolean;
  provider?: 'resend' | 'sendgrid' | 'mailgun' | 'custom';
  fromAddress?: string;
}

export interface SiteIntegrations {
  stripe?: StripeIntegration;
  analytics?: AnalyticsIntegration;
  email?: EmailIntegration;
}

// ============================================================================
// ASSETS
// ============================================================================

export interface AssetRef {
  id: string;
  type: 'image' | 'icon' | 'font' | 'video';
  src: string;          // relative path or URL
  alt?: string;
  width?: number;
  height?: number;
}

// ============================================================================
// CONTENT BLOCKS (discriminated union)
// ============================================================================

export type ContentBlockType =
  | 'heading'
  | 'richtext'
  | 'button'
  | 'image'
  | 'list'
  | 'feature-grid'
  | 'pricing-table'
  | 'faq'
  | 'testimonial'
  | 'form';

interface BlockBase {
  id: string;
  type: ContentBlockType;
  provenance?: ProvenanceMap;
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  content: {
    text: string;
    level: 1 | 2 | 3 | 4 | 5 | 6;
  };
}

export interface RichTextBlock extends BlockBase {
  type: 'richtext';
  content: {
    markdown: string;
  };
}

export interface ButtonBlock extends BlockBase {
  type: 'button';
  content: {
    label: string;
    href: string;
    variant: 'primary' | 'secondary' | 'outline' | 'ghost';
    external?: boolean;
  };
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  content: {
    assetRef: string; // ID or path
    alt: string;
    caption?: string;
  };
}

export interface ListBlock extends BlockBase {
  type: 'list';
  content: {
    style: 'bullet' | 'numbered' | 'check';
    items: string[];
  };
}

export interface FeatureGridItem {
  icon?: string;
  title: string;
  description: string;
}

export interface FeatureGridBlock extends BlockBase {
  type: 'feature-grid';
  content: {
    columns: 2 | 3 | 4;
    items: FeatureGridItem[];
  };
}

export interface PricingPlan {
  name: string;
  price: string;
  currency: string;
  interval?: 'month' | 'year' | 'one-time';
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
  stripePriceId?: string;
}

export interface PricingTableBlock extends BlockBase {
  type: 'pricing-table';
  content: {
    plans: PricingPlan[];
  };
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface FAQBlock extends BlockBase {
  type: 'faq';
  content: {
    items: FAQItem[];
  };
}

export interface TestimonialItem {
  name: string;
  title?: string;
  quote: string;
  avatarRef?: string;
  rating?: number;
}

export interface TestimonialBlock extends BlockBase {
  type: 'testimonial';
  content: {
    items: TestimonialItem[];
  };
}

export interface FormField {
  name: string;
  type: 'text' | 'email' | 'textarea' | 'select' | 'checkbox';
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: string[]; // for select
}

export interface FormBlock extends BlockBase {
  type: 'form';
  content: {
    fields: FormField[];
    submitLabel: string;
    action?: string;          // endpoint or integration ref
    integrationRef?: string;  // e.g. "email"
  };
}

export type ContentBlock =
  | HeadingBlock
  | RichTextBlock
  | ButtonBlock
  | ImageBlock
  | ListBlock
  | FeatureGridBlock
  | PricingTableBlock
  | FAQBlock
  | TestimonialBlock
  | FormBlock;

// ============================================================================
// SECTIONS
// ============================================================================

export type SectionType =
  | 'hero'
  | 'features'
  | 'pricing'
  | 'testimonials'
  | 'faq'
  | 'cta'
  | 'footer'
  | 'header'
  | 'about'
  | 'team'
  | 'gallery'
  | 'blog'
  | 'contact'
  | 'custom';

export interface SectionSettings {
  background?: 'default' | 'muted' | 'accent' | 'dark' | 'image';
  backgroundImage?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}

export interface SectionModel {
  id: string;
  type: SectionType;
  variant?: string;
  settings: SectionSettings;
  blocks: ContentBlock[];
  provenance?: ProvenanceMap;
}

// ============================================================================
// SEO
// ============================================================================

export interface SEOData {
  title?: string;
  description?: string;
  ogImage?: string;
  ogType?: string;
  canonical?: string;
  noIndex?: boolean;
}

// ============================================================================
// GLOBALS (header, footer, nav, meta)
// ============================================================================

export interface NavItem {
  label: string;
  href: string;
  external?: boolean;
  children?: NavItem[];
}

export interface SiteGlobals {
  siteName: string;
  logoSrc?: string;
  logoText?: string;
  navigation: NavItem[];
  footerNavigation?: NavItem[];
  socialLinks?: Array<{ platform: string; url: string }>;
  seo: SEOData;
  faviconSrc?: string;
}

// ============================================================================
// PAGES
// ============================================================================

export type PageStatus = 'draft' | 'published';

export interface PageLock {
  field: string;
  reason: string;
}

export interface PageModel {
  id: string;
  route: string;
  title: string;
  seo: SEOData;
  layout?: 'default' | 'full-width' | 'sidebar';
  status: PageStatus;
  sections: SectionModel[];
  locks?: PageLock[];
  provenance?: ProvenanceMap;
}

// ============================================================================
// SITE MODEL (root)
// ============================================================================

export type SiteFramework = 'static' | 'react' | 'nextjs' | 'vite-react' | 'vue' | 'svelte';

export interface SiteModel {
  id: string;
  name: string;
  version: string; // schema version, e.g. "1.0.0"
  createdAt: number;
  updatedAt: number;

  framework: SiteFramework;
  deployment: DeploymentConfig;
  theme: SiteTheme;
  globals: SiteGlobals;
  pages: PageModel[];
  assets: AssetRef[];
  integrations: SiteIntegrations;
  provenance?: ProvenanceMap;

  /** TBWO ID that generated this site (if applicable) */
  tbwoId?: string;
}
