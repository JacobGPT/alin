/**
 * Conversion Audit — Heuristic HTML analysis for conversion intelligence.
 *
 * Pure logic — no React, no side-effects, no AI calls.
 * Scores: hero clarity, CTA placement, pricing psychology, trust signals,
 * visual hierarchy, headline strength.
 */

import type {
  ConversionAuditResult,
  ConversionPageAudit,
  ConversionSectionAudit,
  ConversionRecommendation,
  PageSpec,
} from '../../types/tbwo';

// ============================================================================
// HELPERS
// ============================================================================

function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) || []).length;
}

function hasElement(html: string, tag: string, classOrAttr?: string): boolean {
  if (classOrAttr) {
    return new RegExp(`<${tag}[^>]*${classOrAttr}[^>]*>`, 'i').test(html);
  }
  return new RegExp(`<${tag}[\\s>]`, 'i').test(html);
}

function findSections(html: string): Array<{ type: string; html: string; index: number }> {
  const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
  const sections: Array<{ type: string; html: string; index: number }> = [];
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = sectionRegex.exec(html)) !== null) {
    // Try to identify section type from class
    const classMatch = match[0].match(/class="([^"]+)"/);
    const classes = classMatch ? classMatch[1] : '';
    let type = 'unknown';

    const typePatterns: Record<string, RegExp> = {
      hero: /hero|banner|jumbotron/i,
      features: /feature|benefit|capability/i,
      pricing: /pricing|plans?|tiers?/i,
      testimonials: /testimonial|review|quote/i,
      cta: /cta|call-to-action|signup/i,
      faq: /faq|question|accordion/i,
      footer: /footer/i,
      about: /about|story|mission/i,
      team: /team|people|staff/i,
    };

    for (const [t, pattern] of Object.entries(typePatterns)) {
      if (pattern.test(classes) || (idx === 0 && t === 'hero')) {
        type = t;
        break;
      }
    }
    // First section is often hero even without class
    if (type === 'unknown' && idx === 0) type = 'hero';

    sections.push({ type, html: match[0], index: idx });
    idx++;
  }

  return sections;
}

// ============================================================================
// INDIVIDUAL CHECKS
// ============================================================================

function checkHeroClarity(heroHtml: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // H1 present?
  if (!hasElement(heroHtml, 'h1')) {
    issues.push('No <h1> headline in hero section');
    suggestions.push('Add a clear, benefit-oriented <h1> headline');
    score -= 25;
  } else {
    const h1Match = heroHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const h1Text = extractText(h1Match[1]);
      const wordCount = h1Text.split(/\s+/).length;
      if (wordCount > 12) {
        issues.push(`Hero headline too long (${wordCount} words, recommend <=12)`);
        suggestions.push('Shorten headline to 8-12 words for maximum impact');
        score -= 10;
      }
      if (/^welcome|^hello|^home/i.test(h1Text)) {
        issues.push('Generic hero headline ("Welcome to...")');
        suggestions.push('Replace with a benefit-oriented headline that tells visitors what they get');
        score -= 15;
      }
    }
  }

  // Subheadline present?
  const hasSubheadline = hasElement(heroHtml, 'p', 'class="') || /<p[^>]*>/.test(heroHtml);
  if (!hasSubheadline) {
    issues.push('No subheadline in hero section');
    suggestions.push('Add a supporting subheadline that expands on the value proposition');
    score -= 10;
  }

  // CTA button in hero?
  const hasCtaButton = /<a[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>/i.test(heroHtml) ||
    /<button[^>]*>/i.test(heroHtml) ||
    /<a[^>]*href[^>]*>[^<]*(?:start|try|get|sign|join|buy|learn|contact)/i.test(heroHtml);
  if (!hasCtaButton) {
    issues.push('No CTA button in hero section');
    suggestions.push('Add a prominent call-to-action button in the hero');
    score -= 20;
  }

  return { score: Math.max(0, score), issues, suggestions };
}

function checkCTAPlacement(html: string, sections: Array<{ type: string; html: string }>): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  const ctaPattern = /<a[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>|<button[^>]*>/gi;
  const totalCTAs = countMatches(html, ctaPattern);

  if (totalCTAs === 0) {
    issues.push('No CTA buttons found on entire page');
    suggestions.push('Add CTA buttons in hero, after features, and at page bottom');
    score -= 40;
  } else if (totalCTAs === 1) {
    issues.push('Only 1 CTA button on page — users need multiple opportunities to convert');
    suggestions.push('Add CTAs after key sections (features, testimonials, pricing)');
    score -= 15;
  }

  // CTA at page bottom?
  const lastSection = sections[sections.length - 1];
  if (lastSection && !ctaPattern.test(lastSection.html)) {
    // Check the last 20% of the page
    const bottomPortion = html.slice(Math.floor(html.length * 0.8));
    if (!ctaPattern.test(bottomPortion)) {
      issues.push('No CTA in the bottom section of the page');
      suggestions.push('Add a final CTA section before the footer');
      score -= 10;
    }
  }

  return { score: Math.max(0, score), issues, suggestions };
}

function checkPricingPsychology(html: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 70; // Default — no pricing section is neutral

  // Check if there's a pricing section at all
  if (!/<section[^>]*class="[^"]*pric/i.test(html) && !/pricing|plans/i.test(html)) {
    return { score: 70, issues: ['No pricing section detected'], suggestions: ['Consider adding transparent pricing to reduce friction'] };
  }

  score = 100;

  // "Popular" or "Recommended" badge?
  if (!/popular|recommended|best value|most chosen/i.test(html)) {
    issues.push('No "Popular" or "Recommended" badge on any pricing tier');
    suggestions.push('Add a "Most Popular" badge to the middle tier to guide decisions');
    score -= 15;
  }

  // Price anchoring (3 tiers)?
  const pricePattern = /\$\d+|\d+\/mo|\/month|\/year/gi;
  const priceCount = countMatches(html, pricePattern);
  if (priceCount < 3) {
    issues.push(`Only ${priceCount} price point(s) — weak anchoring`);
    suggestions.push('Show 3 pricing tiers for effective price anchoring');
    score -= 10;
  }

  // Feature comparison?
  if (!hasElement(html, 'ul') && !hasElement(html, 'table')) {
    issues.push('No feature list or comparison in pricing');
    suggestions.push('Add feature lists to each pricing tier for easy comparison');
    score -= 10;
  }

  return { score: Math.max(0, score), issues, suggestions };
}

function checkTrustSignals(html: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // Testimonials?
  if (!/testimonial|review|quote|"[^"]{20,}"/i.test(html)) {
    issues.push('No testimonials or customer quotes found');
    suggestions.push('Add customer testimonials with real names and photos');
    score -= 20;
  }

  // Logo section / social proof?
  if (!/logo|trusted by|used by|partner|client/i.test(html)) {
    issues.push('No company logos or "Trusted by" section');
    suggestions.push('Add a "Trusted by" section with recognizable brand logos');
    score -= 15;
  }

  // Social proof numbers?
  if (!/\d+[,.]?\d*\s*(?:\+|users|customers|companies|teams|downloads|stars|reviews)/i.test(html)) {
    issues.push('No social proof numbers (user counts, ratings, etc.)');
    suggestions.push('Add concrete numbers: "10,000+ users", "4.9/5 rating", "99.9% uptime"');
    score -= 15;
  }

  // Contact info?
  if (!/contact|email|phone|support|@/i.test(html)) {
    issues.push('No contact information visible');
    suggestions.push('Add contact info or a contact link in footer/nav for trust');
    score -= 10;
  }

  return { score: Math.max(0, score), issues, suggestions };
}

function checkVisualHierarchy(html: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100;

  // H1 → H2 → H3 order?
  const headings = [...html.matchAll(/<h([1-6])[^>]*>/gi)].map(m => parseInt(m[1]));
  if (headings.length > 1) {
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] - headings[i - 1] > 1) {
        issues.push(`Heading hierarchy skip: h${headings[i - 1]} → h${headings[i]}`);
        suggestions.push('Maintain proper heading hierarchy (h1 → h2 → h3) for accessibility and SEO');
        score -= 10;
        break;
      }
    }
  }

  // Multiple H1s?
  const h1Count = countMatches(html, /<h1[^>]*>/gi);
  if (h1Count > 1) {
    issues.push(`Multiple H1 tags found (${h1Count}) — should have exactly one`);
    suggestions.push('Use exactly one H1 per page for SEO and visual hierarchy');
    score -= 10;
  }

  if (h1Count === 0) {
    issues.push('No H1 heading found on page');
    suggestions.push('Add a single H1 heading for the primary page topic');
    score -= 15;
  }

  // CSS variables usage (design consistency indicator)?
  if (!/var\(--/i.test(html)) {
    // Not a strong signal since CSS is usually in separate file
    // Just a minor check
  }

  return { score: Math.max(0, score), issues, suggestions };
}

function checkHeadlineStrength(html: string): { score: number; issues: string[] } {
  const issues: string[] = [];
  let score = 100;

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!h1Match) return { score: 70, issues: ['No H1 to evaluate'] };

  const headline = extractText(h1Match[1]);

  // Action verbs?
  const actionVerbs = /\b(get|start|build|create|grow|transform|unlock|discover|boost|launch|scale|automate|simplify|accelerate|supercharge)\b/i;
  if (!actionVerbs.test(headline)) {
    issues.push('Headline lacks action verbs');
    score -= 10;
  }

  // Generic check
  const genericPatterns = /^(welcome|hello|home|about|our)\b/i;
  if (genericPatterns.test(headline)) {
    issues.push('Headline is generic (starts with "Welcome", "Hello", etc.)');
    score -= 20;
  }

  return { score: Math.max(0, score), issues };
}

// ============================================================================
// MAIN AUDIT FUNCTION
// ============================================================================

export function runConversionAudit(
  artifacts: Map<string, string>,
  pageSpec: PageSpec | null,
): ConversionAuditResult {
  const pageAudits: ConversionPageAudit[] = [];
  const allRecommendations: ConversionRecommendation[] = [];

  const scores = {
    clarity: 0,
    persuasion: 0,
    friction: 0,
    trustSignals: 0,
    visualHierarchy: 0,
    pricingPsychology: 0,
  };
  let pageCount = 0;

  for (const [path, content] of artifacts) {
    if (!path.endsWith('.html')) continue;
    pageCount++;

    const sections = findSections(content);
    const heroSection = sections.find(s => s.type === 'hero');
    const route = pageSpec?.routes?.find(r => path.endsWith(r.fileName))?.route || '/' + path.split('/').pop()?.replace('.html', '');
    const pageName = path.split('/').pop() || path;

    // Run checks
    const heroCheck = heroSection ? checkHeroClarity(heroSection.html) : { score: 50, issues: ['No hero section found'], suggestions: ['Add a hero section with headline + CTA'] };
    const ctaCheck = checkCTAPlacement(content, sections);
    const pricingCheck = checkPricingPsychology(content);
    const trustCheck = checkTrustSignals(content);
    const hierarchyCheck = checkVisualHierarchy(content);
    const headlineCheck = checkHeadlineStrength(content);

    // Accumulate scores
    scores.clarity += heroCheck.score;
    scores.persuasion += (headlineCheck.score + ctaCheck.score) / 2;
    scores.friction += ctaCheck.score; // Low CTA = high friction
    scores.trustSignals += trustCheck.score;
    scores.visualHierarchy += hierarchyCheck.score;
    scores.pricingPsychology += pricingCheck.score;

    // Build section audits
    const sectionAudits: ConversionSectionAudit[] = sections.map((s, i) => {
      const sectionIssues: string[] = [];
      const sectionSuggestions: string[] = [];

      if (s.type === 'hero') {
        sectionIssues.push(...heroCheck.issues);
        sectionSuggestions.push(...heroCheck.suggestions);
      }

      return {
        sectionType: s.type,
        sectionIndex: i,
        scores: {
          clarity: s.type === 'hero' ? heroCheck.score : 75,
          persuasion: headlineCheck.score,
          friction: ctaCheck.score,
        },
        issues: sectionIssues,
        suggestions: sectionSuggestions,
      };
    });

    pageAudits.push({ page: pageName, route, sections: sectionAudits });

    // Build recommendations from issues
    const addRec = (
      category: ConversionRecommendation['category'],
      priority: ConversionRecommendation['priority'],
      section: string,
      issue: string,
      rec: string,
      impact: string,
      autoFixable: boolean,
      fixAction?: ConversionRecommendation['fixAction'],
    ) => {
      allRecommendations.push({
        id: `rec-${allRecommendations.length + 1}`,
        priority,
        category,
        page: pageName,
        section,
        currentIssue: issue,
        recommendation: rec,
        estimatedImpact: impact,
        autoFixable,
        fixAction,
      });
    };

    // Hero issues → recommendations
    for (const issue of heroCheck.issues) {
      addRec('clarity', 'high', 'hero', issue, heroCheck.suggestions[0] || 'Improve hero section', 'Clearer value proposition increases conversions 10-30%', true, {
        type: 'rewrite_section',
        sectionSelector: 'section:nth-of-type(1)',
        instruction: 'Rewrite hero with clear headline, subheadline, and CTA',
      });
    }

    // CTA issues
    for (const issue of ctaCheck.issues) {
      addRec('friction', ctaCheck.score < 60 ? 'high' : 'medium', 'page', issue, ctaCheck.suggestions[0] || 'Add more CTAs', 'More CTA touchpoints increase conversion rate 15-25%', true, {
        type: 'add_element',
        sectionSelector: 'section:last-of-type',
        instruction: 'Add a compelling CTA section',
      });
    }

    // Trust issues
    for (const issue of trustCheck.issues) {
      addRec('trust', trustCheck.score < 60 ? 'high' : 'medium', 'page', issue, trustCheck.suggestions[0] || 'Add trust signals', 'Trust signals reduce bounce rate 10-20%', true, {
        type: 'add_element',
        sectionSelector: 'section:nth-of-type(2)',
        instruction: 'Add social proof and trust indicators',
      });
    }

    // Pricing issues
    for (const issue of pricingCheck.issues) {
      if (issue.includes('No pricing')) continue; // Skip if no pricing section
      addRec('pricing', 'medium', 'pricing', issue, pricingCheck.suggestions[0] || 'Improve pricing', 'Better pricing presentation increases purchase intent 15-25%', true, {
        type: 'restructure',
        sectionSelector: 'section.pricing',
        instruction: 'Improve pricing section with anchoring and badges',
      });
    }
  }

  // Average scores across pages
  if (pageCount > 0) {
    scores.clarity = Math.round(scores.clarity / pageCount);
    scores.persuasion = Math.round(scores.persuasion / pageCount);
    scores.friction = Math.round(scores.friction / pageCount);
    scores.trustSignals = Math.round(scores.trustSignals / pageCount);
    scores.visualHierarchy = Math.round(scores.visualHierarchy / pageCount);
    scores.pricingPsychology = Math.round(scores.pricingPsychology / pageCount);
  }

  const overallScore = Math.round(
    (scores.clarity + scores.persuasion + scores.friction + scores.trustSignals + scores.visualHierarchy + scores.pricingPsychology) / 6,
  );

  // Sort recommendations by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  allRecommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    overallScore,
    scores,
    pageAudits,
    recommendations: allRecommendations,
    generatedAt: Date.now(),
  };
}
