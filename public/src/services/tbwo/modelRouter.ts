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

// ============================================================================
// MODEL TIER PRESETS — purchasable during Website Sprint Wizard
// ============================================================================

export type ModelTier = 'budget' | 'pro' | 'max';

type RoutingProvider = 'anthropic' | 'openai' | 'gemini' | 'deepseek';

export interface ModelTierPreset {
  id: ModelTier;
  label: string;
  description: string;
  priceLabel: string;
  rules: Array<{ podRole: string; provider: RoutingProvider; model: string; reason: string }>;
  fallback: { provider: string; model: string };
}

export const MODEL_TIER_PRESETS: Record<ModelTier, ModelTierPreset> = {
  budget: {
    id: 'budget',
    label: 'Starter',
    description: 'Cost-effective models that get the job done',
    priceLabel: 'Included',
    rules: [
      { podRole: 'design',       provider: 'gemini',   model: 'gemini-2.5-flash',           reason: 'Creative output (rec: Gemini 2.5 Flash)' },
      { podRole: 'frontend',     provider: 'deepseek', model: 'deepseek-chat',              reason: 'Code generation (rec: DeepSeek V3)' },
      { podRole: 'copy',         provider: 'openai',   model: 'gpt-4o-mini',                reason: 'Copywriting (rec: GPT-4o Mini)' },
      { podRole: 'qa',           provider: 'gemini',   model: 'gemini-2.5-flash-lite',      reason: 'Fast validation (rec: Gemini Flash-Lite)' },
      { podRole: 'animation',    provider: 'deepseek', model: 'deepseek-chat',              reason: 'Animation code (rec: DeepSeek V3)' },
      { podRole: 'three_d',      provider: 'deepseek', model: 'deepseek-chat',              reason: '3D scene code (rec: DeepSeek V3)' },
      { podRole: 'deployment',   provider: 'deepseek', model: 'deepseek-chat',              reason: 'Config generation (rec: DeepSeek V3)' },
      { podRole: 'orchestrator', provider: 'gemini',   model: 'gemini-2.5-flash',           reason: 'Planning & coordination (rec: Gemini 2.5 Flash)' },
    ],
    fallback: { provider: 'deepseek', model: 'deepseek-chat' },
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    description: 'Strong models with best quality-to-cost balance',
    priceLabel: '$4.99',
    rules: [
      { podRole: 'design',       provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Creative design (rec: Claude Sonnet 4.5)' },
      { podRole: 'frontend',     provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Code generation (rec: Claude Sonnet 4.5)' },
      { podRole: 'copy',         provider: 'openai',    model: 'gpt-4o',                     reason: 'Natural language (rec: GPT-4o)' },
      { podRole: 'qa',           provider: 'gemini',    model: 'gemini-2.5-flash',           reason: 'Fast validation (rec: Gemini 2.5 Flash)' },
      { podRole: 'animation',    provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Animation code (rec: Claude Sonnet 4.5)' },
      { podRole: 'three_d',      provider: 'anthropic', model: 'claude-sonnet-4-6', reason: '3D scene code (rec: Claude Sonnet 4.5)' },
      { podRole: 'deployment',   provider: 'gemini',    model: 'gemini-2.5-flash',           reason: 'Config generation (rec: Gemini 2.5 Flash)' },
      { podRole: 'orchestrator', provider: 'anthropic', model: 'claude-opus-4-6',            reason: 'Planning & coordination (rec: Claude Opus 4.6)' },
    ],
    fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
  max: {
    id: 'max',
    label: 'Max',
    description: 'Frontier models everywhere — maximum quality',
    priceLabel: '$14.99',
    rules: [
      { podRole: 'design',       provider: 'anthropic', model: 'claude-opus-4-6',            reason: 'Deep creative understanding (rec: Claude Opus 4.6)' },
      { podRole: 'frontend',     provider: 'anthropic', model: 'claude-opus-4-6',            reason: 'Best code generation (rec: Claude Opus 4.6)' },
      { podRole: 'copy',         provider: 'openai',    model: 'gpt-5.2',                    reason: 'Most fluent writing (rec: GPT-5.2)' },
      { podRole: 'qa',           provider: 'openai',    model: 'gpt-5',                      reason: 'Thorough QA reasoning (rec: GPT-5)' },
      { podRole: 'animation',    provider: 'anthropic', model: 'claude-opus-4-6',            reason: 'Sophisticated animation (rec: Claude Opus 4.6)' },
      { podRole: 'three_d',      provider: 'anthropic', model: 'claude-opus-4-6',            reason: 'Best 3D/spatial reasoning (rec: Claude Opus 4.6)' },
      { podRole: 'deployment',   provider: 'gemini',    model: 'gemini-2.5-pro',             reason: 'Thorough config + long context (rec: Gemini 2.5 Pro)' },
      { podRole: 'orchestrator', provider: 'anthropic', model: 'claude-opus-4-6',            reason: 'Best reasoning for orchestration (rec: Claude Opus 4.6)' },
    ],
    fallback: { provider: 'anthropic', model: 'claude-opus-4-6' },
  },
};

/**
 * Get the routing rules for a given model tier preset.
 */
export function getModelTierRules(tier: ModelTier): ModelTierPreset {
  return MODEL_TIER_PRESETS[tier];
}

// Pricing per 1M tokens (input/output) for cost estimation
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':            { input: 15.0,  output: 75.0  },
  'claude-sonnet-4-6': { input: 3.0,   output: 15.0  },
  'claude-sonnet-4-20250514':   { input: 3.0,   output: 15.0  },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.0   },
  'gpt-5':                      { input: 1.25,  output: 10.0  },
  'gpt-5-mini':                 { input: 0.25,  output: 2.0   },
  'gpt-5.1':                    { input: 1.25,  output: 10.0  },
  'gpt-5.2':                    { input: 1.75,  output: 14.0  },
  'gpt-4o':                     { input: 2.50,  output: 10.0  },
  'gpt-4o-mini':                { input: 0.15,  output: 0.60  },
  'o4-mini':                    { input: 1.10,  output: 4.40  },
  'o3-mini':                    { input: 1.10,  output: 4.40  },
  // Gemini
  'gemini-3-pro-preview':       { input: 1.25,  output: 10.0  },
  'gemini-3-flash-preview':     { input: 0.10,  output: 0.40  },
  'gemini-2.5-pro':             { input: 1.25,  output: 10.0  },
  'gemini-2.5-flash':           { input: 0.075, output: 0.30  },
  'gemini-2.5-flash-lite':      { input: 0.018, output: 0.075 },
  // DeepSeek
  'deepseek-chat':              { input: 0.14,  output: 0.28  },
  'deepseek-reasoner':          { input: 0.55,  output: 2.19  },
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

  // Provider-affinity fallbacks first
  if (primary.provider === 'openai' || primary.provider === 'gpt') {
    if (!primary.model.includes('gpt-4o-mini')) chain.push({ provider: 'openai', model: 'gpt-4o-mini' });
  } else if (primary.provider === 'gemini' || primary.provider === 'google') {
    if (primary.model !== 'gemini-2.5-flash') chain.push({ provider: 'gemini', model: 'gemini-2.5-flash' });
    if (primary.model !== 'gemini-2.5-flash-lite') chain.push({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });
  } else if (primary.provider === 'deepseek') {
    if (primary.model !== 'deepseek-chat') chain.push({ provider: 'deepseek', model: 'deepseek-chat' });
  }

  // Cross-provider fallbacks as last resort
  const sonnet = { provider: 'anthropic', model: 'claude-sonnet-4-6' };
  const haiku = { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' };
  if (primary.model !== sonnet.model) chain.push(sonnet);
  if (primary.model !== haiku.model) chain.push(haiku);
  return chain;
}

/**
 * Get the current routing config from settings.
 */
function getRoutingConfig(): ModelRoutingConfig {
  // Default config uses Pro tier preset
  const proPreset = MODEL_TIER_PRESETS.pro;
  const DEFAULT_CONFIG: ModelRoutingConfig = {
    enabled: true,
    rules: proPreset.rules.map(r => ({
      podRole: r.podRole as any,
      provider: r.provider,
      model: r.model,
      reason: r.reason,
    })),
    fallback: proPreset.fallback,
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
    const pricing = MODEL_PRICING[route.model] || MODEL_PRICING['claude-sonnet-4-6']!;
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
  if (model.includes('gpt-5-mini')) return 'GPT-5m';
  if (model.includes('gpt-5.2')) return 'GPT-5.2';
  if (model.includes('gpt-5.1')) return 'GPT-5.1';
  if (model.includes('gpt-5')) return 'GPT-5';
  if (model.includes('gpt-4o-mini')) return '4o-mini';
  if (model.includes('gpt-4o')) return 'GPT-4o';
  if (model.includes('gpt-4-turbo')) return 'GPT-4T';
  if (model.includes('o4-mini')) return 'o4-mini';
  if (model.includes('o3-mini')) return 'o3-mini';
  if (model.includes('o1')) return 'o1';
  if (model.includes('gemini-3-pro')) return 'Gem3Pro';
  if (model.includes('gemini-3-flash')) return 'Gem3F';
  if (model.includes('gemini-2.5-pro')) return 'Gem2.5P';
  if (model.includes('gemini-2.5-flash-lite')) return 'Gem2.5FL';
  if (model.includes('gemini-2.5-flash')) return 'Gem2.5F';
  if (model === 'deepseek-reasoner') return 'DS-R';
  if (model === 'deepseek-chat') return 'DS-V3';
  return model.split('-').slice(-1)[0] || model;
}

/**
 * Get badge color class for a model.
 */
export function getModelBadgeColor(model: string): { bg: string; text: string } {
  if (model.includes('opus'))   return { bg: 'bg-amber-500/15', text: 'text-amber-400' };
  if (model.includes('sonnet')) return { bg: 'bg-orange-500/15', text: 'text-orange-400' };
  if (model.includes('haiku'))  return { bg: 'bg-yellow-500/15', text: 'text-yellow-400' };
  if (model.startsWith('o3') || model.startsWith('o4')) return { bg: 'bg-cyan-500/15', text: 'text-cyan-400' };
  if (model.includes('gpt'))    return { bg: 'bg-green-500/15', text: 'text-green-400' };
  if (model.includes('gemini')) return { bg: 'bg-blue-500/15', text: 'text-blue-400' };
  if (model.includes('deepseek')) return { bg: 'bg-teal-500/15', text: 'text-teal-400' };
  return { bg: 'bg-gray-500/15', text: 'text-gray-400' };
}

// ============================================================================
// ADAPTIVE MODEL ROUTING — escalate on failure, downgrade on consistent success
// ============================================================================

const MODEL_TIERS: Record<string, number> = {
  'claude-haiku-4-5-20251001': 1,
  'gpt-4o-mini': 1,
  'gpt-5-mini': 1,
  'o3-mini': 1,
  'o4-mini': 1,
  'claude-sonnet-4-6': 2,
  'claude-sonnet-4-20250514': 2,
  'gpt-4o': 2,
  'gpt-4-turbo': 2,
  'gpt-5': 2,
  'gpt-5.1': 2,
  'claude-opus-4-6': 3,
  'gpt-5.2': 3,
  // Gemini
  'gemini-3-pro-preview': 3,
  'gemini-3-flash-preview': 2,
  'gemini-2.5-pro': 2,
  'gemini-2.5-flash': 1,
  'gemini-2.5-flash-lite': 1,
  // DeepSeek
  'deepseek-chat': 1,
  'deepseek-reasoner': 2,
};

function getEscalationModel(current: string): { provider: string; model: string } | null {
  const tier = MODEL_TIERS[current] || 2;
  if (tier >= 3) return null;
  // Keep provider affinity
  if (current.startsWith('gpt') || current.startsWith('o3') || current.startsWith('o4')) {
    return tier === 1 ? { provider: 'openai', model: 'gpt-5' } : { provider: 'openai', model: 'gpt-5.2' };
  }
  if (current.startsWith('gemini')) {
    return tier === 1 ? { provider: 'gemini', model: 'gemini-2.5-pro' } : { provider: 'gemini', model: 'gemini-3-pro-preview' };
  }
  if (current.startsWith('deepseek')) {
    return { provider: 'deepseek', model: 'deepseek-reasoner' };
  }
  // Default: Anthropic
  if (tier === 1) return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
  return { provider: 'anthropic', model: 'claude-opus-4-6' };
}

function getDowngradeModel(current: string): { provider: string; model: string } | null {
  const tier = MODEL_TIERS[current] || 2;
  if (tier <= 1) return null;
  if (current.startsWith('gpt') || current.startsWith('o3') || current.startsWith('o4')) {
    return tier === 3 ? { provider: 'openai', model: 'gpt-5' } : { provider: 'openai', model: 'gpt-5-mini' };
  }
  if (current.startsWith('gemini')) {
    return tier === 3 ? { provider: 'gemini', model: 'gemini-2.5-pro' } : { provider: 'gemini', model: 'gemini-2.5-flash' };
  }
  if (current.startsWith('deepseek')) {
    return { provider: 'deepseek', model: 'deepseek-chat' };
  }
  if (tier === 3) return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
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
