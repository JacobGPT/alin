/**
 * Contradiction Engine — Detects logical conflicts in a SiteBrief.
 *
 * Pure logic — no AI calls, no side-effects.
 *
 * 10 contradiction checks:
 * 1. Pricing page in nav but no pricing tiers
 * 2. "Free" mentioned but no free plan tier
 * 3. Multiple conflicting tones
 * 4. CTA says "Book Demo" but no demo/contact mechanism
 * 5. Claims "enterprise" but pricing is consumer-level
 * 6. Features mention integrations but integrations array empty
 * 7. TargetAudience contradicts businessType
 * 8. "Simple" or "minimalist" claim but 6+ feature categories
 * 9. navPages include blog but no blog content
 * 10. Multiple product names in source text
 */

import type { SiteBrief } from '../../../api/dbService';
import type { Contradiction } from './types';

let _counter = 0;
function makeId(): string {
  return `ctr_${Date.now()}_${++_counter}`;
}

export function detectContradictions(brief: SiteBrief, sourceText: string): Contradiction[] {
  const contradictions: Contradiction[] = [];
  const src = sourceText.toLowerCase();

  // 1. Pricing page in nav but no pricing tiers
  const hasPricingPage = brief.navPages.some(p => /pricing/i.test(p)) ||
                         brief.pages.some(p => /pricing/i.test(p));
  const hasPricingTiers = brief.pricing?.tiers && brief.pricing.tiers.length > 0;
  if (hasPricingPage && !hasPricingTiers) {
    contradictions.push({
      id: makeId(),
      claimA: 'Navigation includes a "Pricing" page',
      claimB: 'No pricing tiers defined in the brief',
      severity: 'blocking',
      resolved: false,
    });
  }

  // 2. "Free" mentioned but no free plan tier
  const mentionsFree = src.includes('free plan') || src.includes('free tier') ||
                       src.includes('freemium') || src.includes('free trial');
  const hasFreeTier = brief.pricing?.tiers?.some(t =>
    t.priceMonthly === '0' || t.priceMonthly === '$0' ||
    /free/i.test(t.name)
  );
  if (mentionsFree && hasPricingTiers && !hasFreeTier) {
    contradictions.push({
      id: makeId(),
      claimA: 'Source text mentions a free plan/tier',
      claimB: 'No free tier ($0) defined in pricing',
      severity: 'warning',
      resolved: false,
    });
  }

  // 3. Multiple conflicting tones
  const toneKeywords: Record<string, string[]> = {
    professional: ['professional', 'corporate', 'formal', 'business'],
    playful: ['playful', 'fun', 'casual', 'quirky', 'humorous'],
    minimalist: ['minimalist', 'minimal', 'clean', 'simple'],
    bold: ['bold', 'aggressive', 'edgy', 'provocative'],
  };
  const detectedTones = Object.entries(toneKeywords)
    .filter(([, words]) => words.some(w => src.includes(w)))
    .map(([tone]) => tone);
  const conflictingPairs: [string, string][] = [
    ['professional', 'playful'],
    ['minimalist', 'bold'],
  ];
  for (const [a, b] of conflictingPairs) {
    if (detectedTones.includes(a) && detectedTones.includes(b)) {
      contradictions.push({
        id: makeId(),
        claimA: `Source text suggests "${a}" tone`,
        claimB: `Source text also suggests "${b}" tone`,
        severity: 'warning',
        resolved: false,
      });
    }
  }

  // 4. CTA says "Book Demo" but no demo/contact mechanism
  const ctaText = (brief.primaryCTA || '').toLowerCase();
  const allCtas = (brief.ctas || []).map(c => c.toLowerCase());
  const wantsDemo = ctaText.includes('demo') || ctaText.includes('book a call') ||
                    allCtas.some(c => c.includes('demo') || c.includes('book'));
  const hasContactPage = brief.navPages.some(p => /contact|demo|schedule|book/i.test(p)) ||
                         brief.pages.some(p => /contact|demo|schedule|book/i.test(p));
  if (wantsDemo && !hasContactPage) {
    contradictions.push({
      id: makeId(),
      claimA: `CTA references a demo/booking ("${brief.primaryCTA || allCtas.find(c => c.includes('demo'))}")`,
      claimB: 'No contact or demo page in navigation',
      severity: 'warning',
      resolved: false,
    });
  }

  // 5. Claims "enterprise" but pricing is consumer-level (<$50/mo)
  const isEnterprise = src.includes('enterprise') ||
                       (brief.targetAudience || '').toLowerCase().includes('enterprise');
  const maxPrice = brief.pricing?.tiers?.reduce((max, t) => {
    const p = typeof t.priceMonthly === 'number' ? t.priceMonthly : parseFloat(String(t.priceMonthly));
    return isNaN(p) ? max : Math.max(max, p);
  }, 0) ?? 0;
  if (isEnterprise && hasPricingTiers && maxPrice > 0 && maxPrice < 50) {
    contradictions.push({
      id: makeId(),
      claimA: 'Product is positioned as "enterprise"',
      claimB: `Highest pricing tier is $${maxPrice}/mo (consumer-level)`,
      severity: 'warning',
      resolved: false,
    });
  }

  // 6. Features mention integrations but integrations array empty
  const featuresText = (brief.features || []).join(' ').toLowerCase();
  const mentionsIntegrations = featuresText.includes('integration') ||
                               featuresText.includes('api') ||
                               featuresText.includes('connect with');
  const hasIntegrations = brief.integrations && brief.integrations.length > 0;
  if (mentionsIntegrations && !hasIntegrations) {
    contradictions.push({
      id: makeId(),
      claimA: 'Features mention integrations/API/connections',
      claimB: 'Integrations array is empty',
      severity: 'warning',
      resolved: false,
    });
  }

  // 7. TargetAudience contradicts businessType
  const audience = (brief.targetAudience || '').toLowerCase();
  const bizType = (brief.businessType || '').toLowerCase();
  const isB2B = bizType.includes('b2b') || bizType.includes('saas') || bizType.includes('enterprise');
  const isB2C = bizType.includes('b2c') || bizType.includes('consumer') || bizType.includes('ecommerce');
  const audienceIsConsumer = audience.includes('consumer') || audience.includes('individual') ||
                             audience.includes('personal') || audience.includes('shopper');
  const audienceIsBusiness = audience.includes('business') || audience.includes('team') ||
                             audience.includes('company') || audience.includes('enterprise');
  if (isB2B && audienceIsConsumer) {
    contradictions.push({
      id: makeId(),
      claimA: `Business type is "${brief.businessType}" (B2B)`,
      claimB: `Target audience is "${brief.targetAudience}" (consumer)`,
      severity: 'warning',
      resolved: false,
    });
  }
  if (isB2C && audienceIsBusiness) {
    contradictions.push({
      id: makeId(),
      claimA: `Business type is "${brief.businessType}" (B2C)`,
      claimB: `Target audience is "${brief.targetAudience}" (business)`,
      severity: 'warning',
      resolved: false,
    });
  }

  // 8. "Simple" or "minimalist" claim but 6+ feature categories
  const claimsSimple = src.includes('simple') || src.includes('minimalist') ||
                       (brief.designDirection || '').toLowerCase().includes('minimalist');
  if (claimsSimple && brief.features && brief.features.length >= 6) {
    contradictions.push({
      id: makeId(),
      claimA: 'Brief describes a "simple" or "minimalist" product',
      claimB: `${brief.features.length} feature categories listed`,
      severity: 'warning',
      resolved: false,
    });
  }

  // 9. navPages include blog but blog not configured
  const navHasBlog = brief.navPages.some(p => /blog/i.test(p));
  const pagesHasBlog = brief.pages.some(p => /blog/i.test(p));
  const blogInNavNotInPages = navHasBlog && !pagesHasBlog;
  if (blogInNavNotInPages) {
    contradictions.push({
      id: makeId(),
      claimA: 'Navigation includes a "Blog" page',
      claimB: 'Blog not included in page definitions',
      severity: 'warning',
      resolved: false,
    });
  }

  // 10. Multiple product names in source text
  const productName = (brief.productName || '').trim();
  if (productName) {
    // Look for capitalized words that could be product names (3+ chars, starts uppercase)
    const potentialNames = sourceText.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
    const uniqueNames = [...new Set(potentialNames)].filter(n => {
      const lower = n.toLowerCase();
      // Exclude common English words
      const commonWords = new Set([
        'the', 'and', 'for', 'our', 'with', 'this', 'that', 'from', 'have', 'been',
        'will', 'your', 'they', 'about', 'each', 'which', 'their', 'would',
        'make', 'like', 'just', 'know', 'take', 'people', 'come', 'could', 'now',
        'than', 'first', 'also', 'new', 'because', 'way', 'who', 'get', 'has',
        'him', 'her', 'how', 'made', 'after', 'did', 'many', 'set', 'through',
        'build', 'create', 'website', 'page', 'app', 'design', 'feature',
        'price', 'pricing', 'home', 'about', 'contact', 'blog', 'team',
        'product', 'service', 'solution', 'platform', 'tool',
      ]);
      return !commonWords.has(lower) && lower !== productName.toLowerCase();
    });
    // If we see 2+ distinct capitalized terms that look like product names
    if (uniqueNames.length >= 2) {
      contradictions.push({
        id: makeId(),
        claimA: `Brief product name is "${productName}"`,
        claimB: `Source text contains other potential product names: ${uniqueNames.slice(0, 3).join(', ')}`,
        severity: 'warning',
        resolved: false,
      });
    }
  }

  return contradictions;
}
