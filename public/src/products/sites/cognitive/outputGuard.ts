/**
 * Output Guard — Scans generated site copy/HTML for generic phrases.
 *
 * Post-generation check. Detects placeholder text, generic headlines,
 * lazy CTAs, and content that doesn't reference the actual product.
 *
 * Pure logic — no AI calls, no side-effects.
 */

import type { SiteBrief } from '../../../api/dbService';
import type { GenericPhraseViolation } from './types';

interface PatternDef {
  pattern: RegExp;
  suggestion: string;
}

/** Generic phrases to detect */
const GENERIC_PATTERNS: PatternDef[] = [
  // Placeholder text
  { pattern: /Lorem ipsum/gi, suggestion: 'Replace with real product copy' },
  { pattern: /\[Company Name\]/gi, suggestion: 'Replace with actual product/company name' },
  { pattern: /Your Company/gi, suggestion: 'Replace with actual company name' },
  { pattern: /Acme Inc\.?/gi, suggestion: 'Replace with actual company name' },
  { pattern: /\[PLACEHOLDER\]/gi, suggestion: 'Replace with actual content' },
  { pattern: /\[TODO\]/gi, suggestion: 'Complete this section' },
  { pattern: /\[INSERT .+?\]/gi, suggestion: 'Fill in the requested content' },
  { pattern: /\[YOUR .+?\]/gi, suggestion: 'Replace with actual content' },

  // Generic headlines
  { pattern: /Welcome to Our Website/gi, suggestion: 'Write a headline that addresses the user\'s core problem' },
  { pattern: /The Future of \w+/gi, suggestion: 'Be specific about what the product actually does' },
  { pattern: /Revolutionize Your/gi, suggestion: 'Describe the specific transformation your product enables' },

  // Generic value propositions
  { pattern: /We are a leading provider of/gi, suggestion: 'Say what you actually provide and for whom' },
  { pattern: /Best[- ]in[- ]class/gi, suggestion: 'Describe the specific advantage instead' },
  { pattern: /World[- ]class/gi, suggestion: 'Be specific about what makes it exceptional' },
  { pattern: /Cutting[- ]edge/gi, suggestion: 'Describe the specific technology or approach' },
  { pattern: /Next[- ]generation/gi, suggestion: 'Explain what\'s actually new about it' },
  { pattern: /State[- ]of[- ]the[- ]art/gi, suggestion: 'Describe the specific capability' },
  { pattern: /Innovative solutions?/gi, suggestion: 'Name the actual solution and what it does' },

  // Lazy CTAs
  { pattern: />Click here</gi, suggestion: 'Use a specific action label like "Start Your Trial"' },
  { pattern: />Learn more</gi, suggestion: 'Be specific: "See How X Works" or "View Pricing"' },
  { pattern: />Contact us for more information</gi, suggestion: 'Use a specific CTA like "Get a Demo" or "Talk to Sales"' },
  { pattern: />Submit</gi, suggestion: 'Use an action-specific label like "Send Message" or "Subscribe"' },
  { pattern: />Get Started</gi, suggestion: 'Make it product-specific: "Start Your {productName} Trial"' },

  // Generic section headings (just the section type as heading)
  { pattern: /<h[1-3][^>]*>\s*Features\s*<\/h[1-3]>/gi, suggestion: 'Use a headline like "Everything You Need to [outcome]"' },
  { pattern: /<h[1-3][^>]*>\s*About Us\s*<\/h[1-3]>/gi, suggestion: 'Use a headline that tells your story, e.g. "Built by [team] for [audience]"' },
  { pattern: /<h[1-3][^>]*>\s*Testimonials\s*<\/h[1-3]>/gi, suggestion: 'Use "What Our Customers Say" or "Trusted by Teams Like Yours"' },
  { pattern: /<h[1-3][^>]*>\s*Pricing\s*<\/h[1-3]>/gi, suggestion: 'Use "Simple, Transparent Pricing" or "Choose Your Plan"' },
  { pattern: /<h[1-3][^>]*>\s*Services\s*<\/h[1-3]>/gi, suggestion: 'Describe what you actually do, e.g. "How We Help You [outcome]"' },
  { pattern: /<h[1-3][^>]*>\s*FAQ\s*<\/h[1-3]>/gi, suggestion: 'Use "Common Questions" or "Got Questions?"' },

  // Fake contact info
  { pattern: /john@example\.com/gi, suggestion: 'Use real contact email' },
  { pattern: /example\.com/gi, suggestion: 'Use real domain name' },
  { pattern: /\(555\)\s*\d{3}[- ]\d{4}/g, suggestion: 'Use real phone number or remove' },
  { pattern: /123 Main St/gi, suggestion: 'Use real address or remove' },
];

/**
 * Scan generated artifacts for generic content.
 * Returns violations with file, line, phrase, and suggestion.
 */
export function scanForGenericContent(
  artifacts: Map<string, string>,
  brief: SiteBrief,
): GenericPhraseViolation[] {
  const violations: GenericPhraseViolation[] = [];

  for (const [fileName, content] of artifacts) {
    // Only scan HTML, CSS, JSON, and text files
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!['html', 'htm', 'css', 'json', 'txt', 'md'].includes(ext || '')) continue;

    for (const { pattern, suggestion } of GENERIC_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const beforeMatch = content.slice(0, match.index);
        const line = (beforeMatch.match(/\n/g) || []).length + 1;
        violations.push({
          file: fileName,
          line,
          phrase: match[0],
          suggestion,
        });
      }
    }

    // Check that product name appears in HTML files
    if (ext === 'html' && brief.productName && brief.productName.length > 1) {
      if (!content.includes(brief.productName)) {
        violations.push({
          file: fileName,
          line: 1,
          phrase: `(missing "${brief.productName}")`,
          suggestion: `Product name "${brief.productName}" not found in this file — ensure it appears in the page`,
        });
      }
    }
  }

  return violations;
}
