/**
 * Model Router — Intelligent model selection for TBWO pods
 *
 * Routes different pod roles to different AI models based on their strengths.
 * Configuration stored in settingsStore.tbwo.modelRouting.
 */

import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import type { ModelRoutingConfig, ModelRoutingRule } from '../../types/tbwo';
import { PodRole } from '../../types/tbwo';

export interface ModelRouteResult {
  provider: string;
  model: string;
  reason?: string;
  fallbackChain?: Array<{ provider: string; model: string }>;
}

// Pricing per 1M tokens (input/output) for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':            { input: 15.0,  output: 75.0  },
  'claude-sonnet-4-5-20250929': { input: 3.0,   output: 15.0  },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.0   },
  'gpt-4o':                     { input: 2.50,  output: 10.0  },
  'gpt-4o-mini':                { input: 0.15,  output: 0.60  },
};

/**
 * Resolve which model to use for a given pod role (and optional task name).
 * Reads config from settingsStore. Returns fallback if routing disabled or no match.
 */
export function resolveModelForPod(
  role: PodRole | string,
  taskName?: string,
): ModelRouteResult {
  const config = getRoutingConfig();

  if (!config.enabled) {
    const fb = { provider: config.fallback.provider, model: config.fallback.model };
    return {
      ...fb,
      reason: 'Model routing disabled — using default',
      fallbackChain: buildFallbackChain(fb),
    };
  }

  // Match rules in order: specific role+task → specific role → wildcard
  for (const rule of config.rules) {
    const roleMatch = rule.podRole === '*' || rule.podRole === role;
    if (!roleMatch) continue;

    if (rule.taskPattern && taskName) {
      try {
        const regex = new RegExp(rule.taskPattern, 'i');
        if (!regex.test(taskName)) continue;
      } catch {
        continue; // Skip invalid regex
      }
    } else if (rule.taskPattern && !taskName) {
      // Rule requires task match but no task name provided — skip
      continue;
    }

    return {
      provider: rule.provider,
      model: rule.model,
      reason: rule.reason || `Matched rule for ${role}`,
      fallbackChain: buildFallbackChain({ provider: rule.provider, model: rule.model }),
    };
  }

  // Fallback
  const fallback = { provider: config.fallback.provider, model: config.fallback.model };
  return {
    ...fallback,
    reason: 'No matching rule — using fallback',
    fallbackChain: buildFallbackChain(fallback),
  };
}

// Status codes that indicate a transient model failure (worth retrying with fallback)
export const FALLBACK_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 529]);

/**
 * Build a fallback chain for a primary model selection.
 * Falls back to Sonnet → Haiku (skipping the primary model).
 */
function buildFallbackChain(primary: { provider: string; model: string }): Array<{ provider: string; model: string }> {
  const chain: Array<{ provider: string; model: string }> = [];
  const sonnet = { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };
  const haiku = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  if (primary.model !== sonnet.model) chain.push(sonnet);
  if (primary.model !== haiku.model) chain.push(haiku);
  return chain;
}

/**
 * Get the current routing config from settings.
 */
function getRoutingConfig(): ModelRoutingConfig {
  const DEFAULT_CONFIG: ModelRoutingConfig = {
    enabled: true,
    rules: [
      // Frontend/Design: Opus 4.6 for highest visual quality and code precision
      { podRole: PodRole.FRONTEND, provider: 'anthropic', model: 'claude-opus-4-6', reason: 'Opus for visual fidelity' },
      { podRole: PodRole.DESIGN, provider: 'anthropic', model: 'claude-opus-4-6', reason: 'Opus for design precision' },
      // Copy/Content: GPT-4o for fast, natural prose at low cost
      { podRole: PodRole.COPY, provider: 'openai', model: 'gpt-4o', reason: 'GPT-4o for natural content writing' },
      // Research: GPT-4o for broad knowledge synthesis
      { podRole: PodRole.RESEARCH, provider: 'openai', model: 'gpt-4o', reason: 'GPT-4o for research synthesis' },
      // QA/Validation: Haiku 4.5 for fast checking (doesn't need creative output)
      { podRole: PodRole.QA, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', reason: 'Haiku for fast validation' },
      // Motion/3D: Sonnet for good code gen at reasonable cost
      { podRole: PodRole.MOTION, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', reason: 'Sonnet for animation code' },
      // File reads: GPT-4o-mini for cheapest simple retrieval
      { podRole: '*', taskPattern: 'file.?read|scan|list|search', provider: 'openai', model: 'gpt-4o-mini', reason: 'GPT-4o-mini for read-only tasks' },
      // Delivery/Deploy: Haiku for fast build/deploy tasks
      { podRole: PodRole.DEPLOYMENT, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', reason: 'Haiku for delivery tasks' },
    ],
    fallback: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  };
  try {
    const tbwoPrefs = useSettingsStore.getState().tbwo;
    if (!tbwoPrefs?.modelRouting) return DEFAULT_CONFIG;
    // Merge user config with defaults — user config takes priority
    return {
      ...DEFAULT_CONFIG,
      ...tbwoPrefs.modelRouting,
      rules: tbwoPrefs.modelRouting.rules?.length > 0
        ? tbwoPrefs.modelRouting.rules
        : DEFAULT_CONFIG.rules,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Estimate cost for a TBWO execution based on model routing config.
 * Assumes average token usage per pod role.
 */
export function estimateTBWOCost(podRoles: PodRole[]): {
  totalEstimate: number;
  breakdown: Array<{ role: string; model: string; estimatedCost: number }>;
} {
  // Average tokens per pod role (rough estimates based on typical TBWO execution)
  const AVG_TOKENS_PER_ROLE: Record<string, { input: number; output: number }> = {
    orchestrator: { input: 20_000, output: 5_000 },
    design:       { input: 30_000, output: 10_000 },
    frontend:     { input: 50_000, output: 30_000 },
    backend:      { input: 40_000, output: 25_000 },
    copy:         { input: 25_000, output: 15_000 },
    qa:           { input: 20_000, output: 8_000 },
    motion:       { input: 15_000, output: 8_000 },
    animation:    { input: 25_000, output: 15_000 },
    three_d:      { input: 35_000, output: 25_000 },
    deployment:   { input: 10_000, output: 5_000 },
    research:     { input: 30_000, output: 10_000 },
    data:         { input: 25_000, output: 10_000 },
  };

  const breakdown: Array<{ role: string; model: string; estimatedCost: number }> = [];
  let totalEstimate = 0;

  for (const role of podRoles) {
    const route = resolveModelForPod(role);
    const pricing = MODEL_PRICING[route.model] || MODEL_PRICING['claude-sonnet-4-5-20250929']!;
    const avgTokens = AVG_TOKENS_PER_ROLE[role] || { input: 20_000, output: 10_000 };

    const cost = (avgTokens.input / 1_000_000) * pricing.input +
                 (avgTokens.output / 1_000_000) * pricing.output;

    breakdown.push({ role, model: route.model, estimatedCost: Math.round(cost * 100) / 100 });
    totalEstimate += cost;
  }

  return {
    totalEstimate: Math.round(totalEstimate * 100) / 100,
    breakdown,
  };
}

/**
 * Get a short display name for a model ID.
 */
export function getModelDisplayName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  if (model.includes('gpt-4o-mini')) return '4o-mini';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('gpt-4-turbo')) return 'GPT-4T';
  if (model.includes('o1')) return 'o1';
  return model.split('-').slice(-1)[0] || model;
}

/**
 * Get badge color class for a model.
 */
export function getModelBadgeColor(model: string): { bg: string; text: string } {
  if (model.includes('opus'))   return { bg: 'bg-amber-500/15', text: 'text-amber-400' };
  if (model.includes('sonnet')) return { bg: 'bg-orange-500/15', text: 'text-orange-400' };
  if (model.includes('haiku'))  return { bg: 'bg-yellow-500/15', text: 'text-yellow-400' };
  if (model.includes('gpt'))    return { bg: 'bg-green-500/15', text: 'text-green-400' };
  return { bg: 'bg-gray-500/15', text: 'text-gray-400' };
}

// ============================================================================
// ADAPTIVE MODEL ROUTING — escalate on failure, downgrade on consistent success
// ============================================================================

const MODEL_TIERS: Record<string, number> = {
  'claude-haiku-4-5-20251001': 1,
  'gpt-4o-mini': 1,
  'claude-sonnet-4-5-20250929': 2,
  'gpt-4o': 2,
  'gpt-4-turbo': 2,
  'claude-opus-4-6': 3,
};

function getEscalationModel(current: string): { provider: string; model: string } | null {
  const tier = MODEL_TIERS[current] || 2;
  if (tier >= 3) return null;
  if (tier === 1) return { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };
  return { provider: 'anthropic', model: 'claude-opus-4-6' };
}

function getDowngradeModel(current: string): { provider: string; model: string } | null {
  const tier = MODEL_TIERS[current] || 2;
  if (tier <= 1) return null;
  if (tier === 3) return { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };
  return { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
}

interface ModelSuccessRate {
  model: string;
  successCount: number;
  failureCount: number;
  totalCalls: number;
  avgDuration: number;
}

let cachedRates: ModelSuccessRate[] | null = null;
let cacheTimestamp = 0;
const RATE_CACHE_TTL = 5 * 60 * 1000;

async function getModelSuccessRates(): Promise<ModelSuccessRate[]> {
  if (cachedRates && Date.now() - cacheTimestamp < RATE_CACHE_TTL) return cachedRates;
  try {
    const res = await fetch('/api/self-model/model-success-rates', {
      headers: useAuthStore.getState().getAuthHeader(),
    });
    if (res.ok) {
      cachedRates = await res.json();
      cacheTimestamp = Date.now();
    }
  } catch { /* backend unavailable */ }
  return cachedRates || [];
}

/**
 * Adaptive model resolver — wraps resolveModelForPod with success-rate-based
 * escalation (on high failure rate) or downgrade (on consistent success).
 */
export async function adaptiveResolveModelForPod(
  role: PodRole | string,
  taskName?: string,
): Promise<ModelRouteResult> {
  const baseRoute = resolveModelForPod(role, taskName);
  const rates = await getModelSuccessRates();
  if (!rates || rates.length === 0) return baseRoute;

  const modelRate = rates.find(r => r.model === baseRoute.model);
  if (!modelRate || modelRate.totalCalls < 10) return baseRoute;

  const successRate = modelRate.successCount / modelRate.totalCalls;

  // Escalate: primary model fails >30% → try next tier up
  if (successRate < 0.7) {
    const escalation = getEscalationModel(baseRoute.model);
    if (escalation) {
      return {
        ...baseRoute,
        model: escalation.model,
        provider: escalation.provider,
        reason: `Escalated from ${getModelDisplayName(baseRoute.model)} (${Math.round(successRate * 100)}% success)`,
        fallbackChain: buildFallbackChain(escalation),
      };
    }
  }

  // Downgrade: expensive model succeeds >95% with 20+ calls → use cheaper model
  if (successRate > 0.95 && modelRate.totalCalls > 20) {
    const downgrade = getDowngradeModel(baseRoute.model);
    if (downgrade) {
      return {
        ...baseRoute,
        model: downgrade.model,
        provider: downgrade.provider,
        reason: `Downgraded from ${getModelDisplayName(baseRoute.model)} (${Math.round(successRate * 100)}% success, saving cost)`,
        fallbackChain: [{ provider: baseRoute.provider, model: baseRoute.model }, ...(baseRoute.fallbackChain || [])],
      };
    }
  }

  return baseRoute;
}
