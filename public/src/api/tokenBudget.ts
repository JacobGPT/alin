/**
 * Token Budget — Hard gate for LLM prompt sizes.
 *
 * Ensures no single prompt exceeds 25K tokens (~87K chars).
 * Provides compaction utilities for Site Briefs.
 */

export const MAX_INPUT_TOKENS = 25_000;
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function assertTokenBudget(
  text: string,
  context: string,
  maxTokens = MAX_INPUT_TOKENS,
): { tokens: number; ok: boolean } {
  const tokens = estimateTokens(text);
  const ok = tokens <= maxTokens;
  if (!ok) {
    console.warn(
      `[TokenBudget] EXCEEDED in ${context}: ${tokens} > ${maxTokens} (${text.length} chars)`,
    );
  }
  return { tokens, ok };
}

/**
 * Strip verbose/optional fields from a brief, keeping only what a pod needs
 * to produce site content. Returns a compact JSON string.
 */
export function compactBrief(brief: Record<string, unknown>): string {
  return JSON.stringify(
    {
      productName: brief.productName,
      tagline: brief.tagline,
      oneLinerPositioning: brief.oneLinerPositioning,
      targetAudience: brief.targetAudience,
      primaryPain: brief.primaryPain,
      primaryCTA: brief.primaryCTA,
      toneStyle: brief.toneStyle,
      designDirection: brief.designDirection,
      navPages: ((brief.navPages as string[]) || []).slice(0, 8),
      features: ((brief.features as string[]) || []).slice(0, 8),
      pricing: brief.pricing,
      constraints: brief.constraints,
    },
    null,
    2,
  );
}
