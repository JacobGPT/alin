/**
 * Site Optimizer — Aggregates 6+ audit types into a unified improvement report.
 *
 * Pure logic — no React, no side-effects, no AI calls.
 * Reuses runConversionAudit() from conversionAudit.ts.
 */

import { nanoid } from 'nanoid';
import type {
  PageSpec,
  SiteImprovementReport,
  SiteImprovement,
  SEOAuditResult,
  ClarityAuditResult,
  TrustAuditResult,
  CTAAuditResult,
  MessagingCohesionResult,
} from '../../types/tbwo';
import { runConversionAudit } from './conversionAudit';

// ============================================================================
// HELPERS
// ============================================================================

function extractText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countMatches(html: string, pattern: RegExp): number {
  return (html.match(pattern) || []).length;
}

// ============================================================================
// SEO AUDIT
// ============================================================================

function runSEOAudit(artifacts: Map<string, string>, pageSpec: PageSpec | null): SEOAuditResult {
  const issues: SEOAuditResult['issues'] = [];
  let totalChecks = 0;
  let passed = 0;

  for (const [path, content] of artifacts) {
    if (!path.endsWith('.html')) continue;
    const pageName = path.split('/').pop() || path;

    totalChecks += 5; // 5 checks per page

    // Title tag
    const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!titleMatch) {
      issues.push({ page: pageName, issue: 'Missing <title> tag', fix: 'Add a descriptive <title> tag', severity: 'high' });
    } else {
      passed++;
      const titleText = titleMatch[1].trim();
      if (titleText.length > 60) {
        issues.push({ page: pageName, issue: `Title too long (${titleText.length} chars, max 60)`, fix: 'Shorten title to under 60 characters', severity: 'medium' });
      } else {
        passed++;
      }
    }

    // Meta description
    const metaDescMatch = content.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
    if (!metaDescMatch) {
      issues.push({ page: pageName, issue: 'Missing meta description', fix: 'Add <meta name="description" content="..."> tag', severity: 'high' });
    } else {
      passed++;
      if (metaDescMatch[1].length > 160) {
        issues.push({ page: pageName, issue: `Meta description too long (${metaDescMatch[1].length} chars, max 160)`, fix: 'Shorten meta description to under 160 characters', severity: 'medium' });
      }
    }

    // OG tags
    if (!/<meta[^>]*property="og:/i.test(content)) {
      issues.push({ page: pageName, issue: 'Missing Open Graph tags', fix: 'Add og:title, og:description, og:image meta tags', severity: 'medium' });
    } else {
      passed++;
    }

    // Heading hierarchy
    const h1Count = countMatches(content, /<h1[^>]*>/gi);
    if (h1Count === 0) {
      issues.push({ page: pageName, issue: 'No H1 heading', fix: 'Add a single H1 heading for the primary topic', severity: 'high' });
    } else if (h1Count > 1) {
      issues.push({ page: pageName, issue: `Multiple H1 tags (${h1Count})`, fix: 'Use exactly one H1 per page', severity: 'medium' });
    } else {
      passed++;
    }

    // Alt text on images
    const imgTags = content.match(/<img[^>]*>/gi) || [];
    const missingAlt = imgTags.filter(img => !img.includes('alt=')).length;
    if (missingAlt > 0) {
      issues.push({ page: pageName, issue: `${missingAlt} image(s) missing alt text`, fix: 'Add descriptive alt attributes to all images', severity: 'medium' });
    } else {
      passed++;
    }
  }

  const score = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 100;
  return { score, issues };
}

// ============================================================================
// CLARITY AUDIT
// ============================================================================

function runClarityAudit(artifacts: Map<string, string>): ClarityAuditResult {
  const issues: ClarityAuditResult['issues'] = [];
  let totalChecks = 0;
  let passed = 0;

  for (const [path, content] of artifacts) {
    if (!path.endsWith('.html')) continue;
    const pageName = path.split('/').pop() || path;

    // Check headline word count
    const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      totalChecks++;
      const h1Text = extractText(h1Match[1]);
      const wordCount = h1Text.split(/\s+/).length;
      if (wordCount > 12) {
        issues.push({ page: pageName, section: 'hero', issue: `Headline too wordy (${wordCount} words)`, fix: 'Shorten to 8-12 impactful words' });
      } else {
        passed++;
      }
    }

    // Check for jargon in first section
    const firstSection = content.match(/<section[^>]*>([\s\S]*?)<\/section>/i);
    if (firstSection) {
      totalChecks++;
      const text = extractText(firstSection[1]);
      const jargonPatterns = /\b(synergy|leverage|paradigm|disrupt|blockchain|web3|innovate|scalable|robust|utilize|facilitate|empowerment)\b/gi;
      const jargonMatches = text.match(jargonPatterns);
      if (jargonMatches && jargonMatches.length > 2) {
        issues.push({ page: pageName, section: 'hero', issue: `High jargon density (${jargonMatches.length} buzzwords)`, fix: 'Replace jargon with plain language that communicates specific benefits' });
      } else {
        passed++;
      }
    }

    // Value proposition presence
    totalChecks++;
    const heroArea = content.slice(0, Math.floor(content.length * 0.3));
    const hasValueProp = /\b(save|earn|grow|reduce|increase|faster|easier|better|free|instant|automated)\b/i.test(heroArea);
    if (!hasValueProp) {
      issues.push({ page: pageName, section: 'above-fold', issue: 'No clear value proposition in first 30% of page', fix: 'Add a concrete benefit statement (save time, earn more, etc.)' });
    } else {
      passed++;
    }
  }

  const score = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 100;
  return { score, issues };
}

// ============================================================================
// TRUST AUDIT
// ============================================================================

function runTrustAudit(artifacts: Map<string, string>): TrustAuditResult {
  const issues: TrustAuditResult['issues'] = [];
  let totalChecks = 0;
  let passed = 0;

  for (const [path, content] of artifacts) {
    if (!path.endsWith('.html')) continue;
    const pageName = path.split('/').pop() || path;

    // Testimonials
    totalChecks++;
    if (/testimonial|review|"[^"]{20,}"/i.test(content)) {
      passed++;
    } else {
      issues.push({ page: pageName, issue: 'No testimonials or reviews', fix: 'Add customer testimonials with names and photos' });
    }

    // Trust badges
    totalChecks++;
    if (/trusted|security|ssl|encrypted|badge|certified|award/i.test(content)) {
      passed++;
    } else {
      issues.push({ page: pageName, issue: 'No trust badges or security indicators', fix: 'Add security badges, certifications, or trust seals' });
    }

    // Contact info
    totalChecks++;
    if (/contact|email|phone|support|@[a-z]/i.test(content)) {
      passed++;
    } else {
      issues.push({ page: pageName, issue: 'No contact information', fix: 'Add email, phone, or contact form link' });
    }

    // Privacy / Terms link
    totalChecks++;
    if (/privacy|terms|legal/i.test(content)) {
      passed++;
    } else {
      issues.push({ page: pageName, issue: 'No privacy policy or terms link', fix: 'Add privacy policy and terms of service links in footer' });
    }
  }

  const score = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 100;
  return { score, issues };
}

// ============================================================================
// CTA AUDIT
// ============================================================================

function runCTAAudit(artifacts: Map<string, string>): CTAAuditResult {
  const issues: CTAAuditResult['issues'] = [];
  let totalChecks = 0;
  let passed = 0;

  for (const [path, content] of artifacts) {
    if (!path.endsWith('.html')) continue;
    const pageName = path.split('/').pop() || path;

    const ctaPattern = /<a[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>|<button[^>]*>/gi;
    const ctaCount = countMatches(content, ctaPattern);

    // CTA present
    totalChecks++;
    if (ctaCount > 0) {
      passed++;
    } else {
      issues.push({ page: pageName, section: 'page', issue: 'No CTA buttons on page', fix: 'Add CTA buttons in hero and after key sections' });
    }

    // CTA above fold (first 40% of page)
    totalChecks++;
    const aboveFold = content.slice(0, Math.floor(content.length * 0.4));
    if (ctaPattern.test(aboveFold)) {
      passed++;
    } else {
      issues.push({ page: pageName, section: 'above-fold', issue: 'No CTA above the fold', fix: 'Add a prominent CTA in the hero section' });
    }

    // CTA language consistency
    const ctaTexts = [...content.matchAll(/<(?:a|button)[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)]
      .map(m => extractText(m[1]).toLowerCase().trim())
      .filter(t => t.length > 0);

    totalChecks++;
    if (ctaTexts.length > 1) {
      const unique = new Set(ctaTexts);
      if (unique.size > 3) {
        issues.push({ page: pageName, section: 'page', issue: `${unique.size} different CTA labels — inconsistent`, fix: 'Use consistent CTA language across the page (1-2 primary labels)' });
      } else {
        passed++;
      }
    } else {
      passed++;
    }
  }

  const score = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) : 100;
  return { score, issues };
}

// ============================================================================
// MESSAGING COHESION AUDIT
// ============================================================================

function runMessagingCohesion(artifacts: Map<string, string>): MessagingCohesionResult {
  const issues: MessagingCohesionResult['issues'] = [];
  let score = 100;

  const pageTexts: Array<{ page: string; text: string }> = [];
  for (const [path, content] of artifacts) {
    if (!path.endsWith('.html')) continue;
    const pageName = path.split('/').pop() || path;
    pageTexts.push({ page: pageName, text: extractText(content) });
  }

  if (pageTexts.length < 2) return { score: 100, issues: [] };

  // Check product name consistency
  const productNames = new Set<string>();
  const titlePattern = /<title[^>]*>([\s\S]*?)<\/title>/i;
  for (const [, content] of artifacts) {
    if (!content.endsWith) continue;
    const match = content.match(titlePattern);
    if (match) {
      const parts = match[1].split(/[|\-–—]/);
      if (parts.length > 1) {
        productNames.add(parts[parts.length - 1].trim().toLowerCase());
      }
    }
  }

  if (productNames.size > 1) {
    issues.push({
      pages: pageTexts.map(p => p.page),
      issue: `Inconsistent product name across pages: ${[...productNames].join(', ')}`,
      fix: 'Use the same product name consistently across all pages',
    });
    score -= 20;
  }

  // Check tone consistency (simple heuristic: formal vs casual markers)
  const toneScores = pageTexts.map(({ text }) => {
    const casualMarkers = countMatches(text, /\b(hey|awesome|cool|gonna|wanna|stuff|things|guys)\b/gi);
    const formalMarkers = countMatches(text, /\b(therefore|furthermore|consequently|hereby|henceforth|pursuant)\b/gi);
    return { casual: casualMarkers, formal: formalMarkers };
  });

  const hasMixedTone = toneScores.some(t => t.casual > 3) && toneScores.some(t => t.formal > 2);
  if (hasMixedTone) {
    issues.push({
      pages: pageTexts.map(p => p.page),
      issue: 'Mixed tone across pages (some casual, some formal)',
      fix: 'Align tone across all pages — choose either professional or conversational',
    });
    score -= 15;
  }

  return { score: Math.max(0, score), issues };
}

// ============================================================================
// FULL SITE AUDIT (AGGREGATOR)
// ============================================================================

export function runFullSiteAudit(
  artifacts: Map<string, string>,
  pageSpec: PageSpec | null,
  tbwoId: string,
): SiteImprovementReport {
  // Run all individual audits
  const conversion = runConversionAudit(artifacts, pageSpec);
  const seo = runSEOAudit(artifacts, pageSpec);
  const clarity = runClarityAudit(artifacts);
  const trust = runTrustAudit(artifacts);
  const cta = runCTAAudit(artifacts);
  const messaging = runMessagingCohesion(artifacts);

  // Aggregate improvements from all audits
  const improvements = aggregateImprovements(conversion, seo, clarity, trust, cta, messaging);

  const overallScore = Math.round(
    (conversion.overallScore + seo.score + clarity.score + trust.score + cta.score + messaging.score) / 6,
  );

  return {
    id: nanoid(),
    tbwoId,
    generatedAt: Date.now(),
    overallScore,
    audits: { conversion, seo, clarity, trust, cta, messaging },
    improvements,
    appliedCount: 0,
    totalCount: improvements.length,
  };
}

// ============================================================================
// IMPROVEMENT AGGREGATION
// ============================================================================

function aggregateImprovements(
  conversion: ReturnType<typeof runConversionAudit>,
  seo: SEOAuditResult,
  clarity: ClarityAuditResult,
  trust: TrustAuditResult,
  cta: CTAAuditResult,
  messaging: MessagingCohesionResult,
): SiteImprovement[] {
  const improvements: SiteImprovement[] = [];

  // From conversion recommendations (already well-structured)
  for (const rec of conversion.recommendations) {
    improvements.push({
      id: nanoid(),
      auditSource: 'conversion',
      priority: rec.priority,
      page: rec.page,
      section: rec.section,
      description: rec.recommendation,
      currentIssue: rec.currentIssue,
      proposedFix: rec.recommendation,
      enabled: rec.priority === 'high',
      applied: false,
      fixAction: rec.fixAction || {
        type: 'rewrite_section',
        sectionSelector: 'section:nth-of-type(1)',
        instruction: rec.recommendation,
      },
    });
  }

  // From SEO issues
  for (const issue of seo.issues) {
    improvements.push({
      id: nanoid(),
      auditSource: 'seo',
      priority: issue.severity,
      page: issue.page,
      section: 'head',
      description: issue.fix,
      currentIssue: issue.issue,
      proposedFix: issue.fix,
      enabled: issue.severity === 'high',
      applied: false,
      fixAction: {
        type: 'add_meta',
        sectionSelector: 'head',
        instruction: issue.fix,
      },
    });
  }

  // From clarity issues
  for (const issue of clarity.issues) {
    improvements.push({
      id: nanoid(),
      auditSource: 'clarity',
      priority: 'medium',
      page: issue.page,
      section: issue.section,
      description: issue.fix,
      currentIssue: issue.issue,
      proposedFix: issue.fix,
      enabled: true,
      applied: false,
      fixAction: {
        type: 'rewrite_section',
        sectionSelector: `section.${issue.section}`,
        instruction: issue.fix,
      },
    });
  }

  // From trust issues
  for (const issue of trust.issues) {
    improvements.push({
      id: nanoid(),
      auditSource: 'trust',
      priority: 'medium',
      page: issue.page,
      section: 'page',
      description: issue.fix,
      currentIssue: issue.issue,
      proposedFix: issue.fix,
      enabled: true,
      applied: false,
      fixAction: {
        type: 'add_element',
        sectionSelector: 'section:last-of-type',
        instruction: issue.fix,
      },
    });
  }

  // From CTA issues
  for (const issue of cta.issues) {
    improvements.push({
      id: nanoid(),
      auditSource: 'cta',
      priority: 'high',
      page: issue.page,
      section: issue.section,
      description: issue.fix,
      currentIssue: issue.issue,
      proposedFix: issue.fix,
      enabled: true,
      applied: false,
      fixAction: {
        type: 'add_element',
        sectionSelector: 'section:nth-of-type(1)',
        instruction: issue.fix,
      },
    });
  }

  // From messaging issues
  for (const issue of messaging.issues) {
    improvements.push({
      id: nanoid(),
      auditSource: 'messaging',
      priority: 'low',
      page: issue.pages.join(', '),
      section: 'global',
      description: issue.fix,
      currentIssue: issue.issue,
      proposedFix: issue.fix,
      enabled: false,
      applied: false,
      fixAction: {
        type: 'restructure',
        sectionSelector: 'body',
        instruction: issue.fix,
      },
    });
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  improvements.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return improvements;
}
