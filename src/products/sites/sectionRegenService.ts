/**
 * Section Regeneration Service
 *
 * AI-powered section-level regeneration for website sprint outputs.
 * Handles extracting sections from HTML, calling Claude for rewrites,
 * and replacing sections back into the full page.
 *
 * Pure service — no React, no side-effects beyond API calls.
 */

import type {
  SectionRegenerationAction,
  SectionRegenerationRequest,
  SectionRegenerationResult,
} from '../../types/tbwo';
import { getLayoutVariant } from './layoutVariants';

// ============================================================================
// ACTION PROMPTS
// ============================================================================

const ACTION_PROMPTS: Record<SectionRegenerationAction, string> = {
  improve_conversion:
    'Rewrite this section to maximize conversions. Strengthen the headline to be benefit-oriented, make the CTA compelling and urgent, add social proof or trust indicators where appropriate. Every element should drive the user toward the primary action.',
  rewrite_tone:
    'Rewrite this section with a more professional, polished, and confident tone. Remove casual language. Make copy crisp and authoritative while keeping it approachable.',
  make_premium:
    'Elevate this section to premium/luxury quality. Refine the copy to feel exclusive, add sophisticated design cues (generous whitespace, refined typography hints), and ensure every word earns its place.',
  make_aggressive:
    'Make this section more aggressive and sales-focused. Use stronger headlines, urgent CTAs ("Start now", "Don\'t miss out"), add scarcity indicators, and make the value proposition impossible to ignore.',
  shorten_copy:
    'Condense this section significantly. Remove filler words, combine redundant phrases, and ensure every remaining word earns its place. Aim for 40-60% fewer words while keeping all key information.',
  add_social_proof:
    'Add compelling social proof to this section. Include testimonial quotes, user/customer counts, trust badges, company logos, star ratings, or case study metrics as appropriate for the section type.',
  add_urgency:
    'Add urgency elements to this section. Include limited-time offers, countdown language, scarcity indicators ("Only X spots left"), or time-sensitive CTAs. Make the user feel they should act now.',
  switch_layout: '', // Uses layout variant from customInstruction
  custom: '',        // Uses customInstruction directly
};

// ============================================================================
// HTML SECTION EXTRACTION & REPLACEMENT
// ============================================================================

/**
 * Extract a section from full HTML by CSS-like selector.
 * Supports: `section.hero`, `section:nth-of-type(2)`, `#features`, `.pricing-section`
 */
export function extractSectionFromHtml(
  fullHtml: string,
  sectionSelector: string,
): { html: string; startIndex: number; endIndex: number } | null {
  // Parse selector into tag + class/id
  const classMatch = sectionSelector.match(/^(\w+)\.(.+)$/);
  const idMatch = sectionSelector.match(/^#(.+)$/);
  const nthMatch = sectionSelector.match(/^(\w+):nth-of-type\((\d+)\)$/);

  let regex: RegExp;
  let matchIndex = 0;

  if (classMatch) {
    // e.g., section.hero — match <section ... class="...hero..."
    const [, tag, cls] = classMatch;
    regex = new RegExp(`<${tag}[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  } else if (idMatch) {
    // e.g., #features
    const id = idMatch[1];
    regex = new RegExp(`<\\w+[^>]*id="${id}"[^>]*>[\\s\\S]*?</\\w+>`, 'gi');
  } else if (nthMatch) {
    // e.g., section:nth-of-type(2)
    const [, tag, nth] = nthMatch;
    regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    matchIndex = parseInt(nth, 10) - 1;
  } else {
    // Fallback: treat as tag name with optional class
    const tag = sectionSelector.replace(/[^a-zA-Z]/g, '') || 'section';
    regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  }

  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(fullHtml)) !== null) {
    if (idx === matchIndex) {
      return {
        html: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      };
    }
    idx++;
  }

  return null;
}

/**
 * Replace a section in the full HTML by selector.
 */
export function replaceSectionInHtml(
  fullHtml: string,
  sectionSelector: string,
  newSectionHtml: string,
): string {
  const extracted = extractSectionFromHtml(fullHtml, sectionSelector);
  if (!extracted) return fullHtml;

  return (
    fullHtml.slice(0, extracted.startIndex) +
    newSectionHtml +
    fullHtml.slice(extracted.endIndex)
  );
}

// ============================================================================
// SECTION REGENERATION (calls backend)
// ============================================================================

/**
 * Regenerate a single section via the backend Claude endpoint.
 */
export async function regenerateSection(
  request: SectionRegenerationRequest,
  cssContent: string,
): Promise<SectionRegenerationResult> {
  let instruction = ACTION_PROMPTS[request.action] || '';

  // For switch_layout, build instruction from layout variant
  if (request.action === 'switch_layout' && request.customInstruction) {
    const variant = getLayoutVariant(request.customInstruction);
    if (variant) {
      instruction = `Restructure this section to use the "${variant.name}" layout. CSS hints: ${variant.cssHints}. HTML structure reference: ${variant.htmlStructure}. Keep the same content/copy but reorganize into this new layout structure.`;
    } else {
      instruction = `Switch to layout: ${request.customInstruction}`;
    }
  }

  // For custom, use the custom instruction directly
  if (request.action === 'custom') {
    instruction = request.customInstruction || 'Improve this section.';
  }

  const response = await fetch('/api/sites/regenerate-section', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sectionHtml: request.sectionHtml,
      action: request.action,
      instruction,
      cssContext: cssContent.slice(0, 2000), // Send first 2K of CSS for context
      fullPageContext: '', // Could be expanded later
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return {
      success: false,
      originalHtml: request.sectionHtml,
      newHtml: request.sectionHtml,
      action: request.action,
      artifactPath: request.artifactPath,
      sectionSelector: request.sectionSelector,
    };
  }

  const data = await response.json();

  return {
    success: true,
    originalHtml: request.sectionHtml,
    newHtml: data.newHtml || request.sectionHtml,
    action: request.action,
    artifactPath: request.artifactPath,
    sectionSelector: request.sectionSelector,
  };
}

// ============================================================================
// A/B VARIANT GENERATION
// ============================================================================

/**
 * Generate multiple variants of a section for A/B comparison.
 */
export async function generateVariants(
  request: SectionRegenerationRequest,
  cssContent: string,
  count: number = 3,
): Promise<SectionRegenerationResult[]> {
  const variants = await Promise.all(
    Array.from({ length: count }, (_, i) => {
      const variantRequest = {
        ...request,
        customInstruction: `${request.customInstruction || ACTION_PROMPTS[request.action] || 'Improve this section.'} (Variant ${i + 1} of ${count} — make each variant distinctly different in approach while keeping the same information.)`,
        action: 'custom' as SectionRegenerationAction,
      };
      return regenerateSection(variantRequest, cssContent);
    }),
  );
  return variants;
}
