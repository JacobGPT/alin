/**
 * ALIN Server Configuration
 * DEFAULT_MODELS, PLAN_LIMITS, MODEL_METADATA, quota helpers
 */

// ============================================================================
// DEFAULT MODEL CONFIGURATION — override via environment variables
// ============================================================================

export const DEFAULT_MODELS = {
  claudeSonnet: process.env.DEFAULT_CLAUDE_MODEL || 'claude-sonnet-4-6',
  claudeSonnet45: process.env.CLAUDE_SONNET45_MODEL || 'claude-sonnet-4-5-20250929',
  claudeOpus: process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-6',
  claudeHaiku: process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
  gpt4o: process.env.GPT4O_MODEL || 'gpt-4o',
  gpt4oMini: process.env.GPT4O_MINI_MODEL || 'gpt-4o-mini',
  gpt4Turbo: process.env.GPT4_TURBO_MODEL || 'gpt-4-turbo',
  o1Preview: process.env.O1_PREVIEW_MODEL || 'o1-preview',
  gpt5: process.env.GPT5_MODEL || 'gpt-5',
  gpt5Mini: process.env.GPT5_MINI_MODEL || 'gpt-5-mini',
  gpt5Nano: process.env.GPT5_NANO_MODEL || 'gpt-5-nano',
  gpt51: process.env.GPT51_MODEL || 'gpt-5.1',
  gpt52: process.env.GPT52_MODEL || 'gpt-5.2',
  // GPT-4.1 Family
  gpt41: process.env.GPT41_MODEL || 'gpt-4.1',
  gpt41Mini: process.env.GPT41_MINI_MODEL || 'gpt-4.1-mini',
  gpt41Nano: process.env.GPT41_NANO_MODEL || 'gpt-4.1-nano',
  // o-Series (Reasoning)
  o3: process.env.O3_MODEL || 'o3',
  o3Mini: process.env.O3_MINI_MODEL || 'o3-mini',
  o4Mini: process.env.O4_MINI_MODEL || 'o4-mini',
  claudeSonnet4: process.env.CLAUDE_SONNET4_MODEL || 'claude-sonnet-4-20250514',
  // Gemini
  gemini3Pro: process.env.GEMINI_3_PRO_MODEL || 'gemini-3-pro-preview',
  gemini3Flash: process.env.GEMINI_3_FLASH_MODEL || 'gemini-3-flash-preview',
  gemini25Pro: process.env.GEMINI_25_PRO_MODEL || 'gemini-2.5-pro',
  gemini25Flash: process.env.GEMINI_25_FLASH_MODEL || 'gemini-2.5-flash',
  gemini25FlashLite: process.env.GEMINI_25_FLASH_LITE_MODEL || 'gemini-2.5-flash-lite',
  // DeepSeek
  deepseekChat: process.env.DEEPSEEK_CHAT_MODEL || 'deepseek-chat',
  deepseekReasoner: process.env.DEEPSEEK_REASONER_MODEL || 'deepseek-reasoner',
};

// ============================================================================
// PLAN TIER LIMITS
// ============================================================================

export const PLAN_LIMITS = {
  free: {
    messagesPerHour: 25,
    allowedModels: [
      DEFAULT_MODELS.claudeSonnet,
      DEFAULT_MODELS.gpt5Mini, DEFAULT_MODELS.gpt5Nano,
      DEFAULT_MODELS.gpt41Mini, DEFAULT_MODELS.gpt41Nano,
      DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini,
      DEFAULT_MODELS.gemini25Flash, DEFAULT_MODELS.gemini25FlashLite,
      DEFAULT_MODELS.deepseekChat,
    ],
    opusCreditsPerMonth: 0,
    maxConversations: 50,
    tbwoEnabled: false,
    tbwoParallel: false,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 3,
    memoryRetentionDays: 30,
    selfLearning: false,
    maxTokens: 16384,
    computerUse: false,
    maxToolCallsPerMessage: 10,
    thinkingBudgetCap: 5000,
    tbwoRunsPerMonth: 0,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: false,
    vectorizeEnabled: false,
    maxCfImages: 5,
    maxCfVideos: 0,
    localModelEnabled: false,
    maxSites: 1,
    ephemeralEnabled: false,
  },
  spark: {
    messagesPerHour: 200,
    allowedModels: [
      DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.claudeHaiku,
      DEFAULT_MODELS.gpt5Mini, DEFAULT_MODELS.gpt5Nano,
      DEFAULT_MODELS.gpt41, DEFAULT_MODELS.gpt41Mini, DEFAULT_MODELS.gpt41Nano,
      DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini,
      DEFAULT_MODELS.o3Mini,
      DEFAULT_MODELS.gemini25Pro, DEFAULT_MODELS.gemini25Flash, DEFAULT_MODELS.gemini25FlashLite,
      DEFAULT_MODELS.deepseekChat, DEFAULT_MODELS.deepseekReasoner,
    ],
    opusCreditsPerMonth: 0,
    maxConversations: -1,
    tbwoEnabled: false,
    tbwoParallel: false,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: 90,
    selfLearning: false,
    maxTokens: 24576,
    computerUse: false,
    maxToolCallsPerMessage: 15,
    thinkingBudgetCap: 10000,
    tbwoRunsPerMonth: 0,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: false,
    vectorizeEnabled: false,
    maxCfImages: 25,
    maxCfVideos: 0,
    localModelEnabled: false,
    maxSites: 3,
    ephemeralEnabled: true,
  },
  pro: {
    messagesPerHour: -1,
    allowedModels: [
      DEFAULT_MODELS.claudeOpus, DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.claudeHaiku,
      DEFAULT_MODELS.gpt51, DEFAULT_MODELS.gpt5, DEFAULT_MODELS.gpt5Mini, DEFAULT_MODELS.gpt5Nano,
      DEFAULT_MODELS.gpt41, DEFAULT_MODELS.gpt41Mini, DEFAULT_MODELS.gpt41Nano,
      DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini,
      DEFAULT_MODELS.o4Mini, DEFAULT_MODELS.o3Mini,
      DEFAULT_MODELS.gemini3Flash, DEFAULT_MODELS.gemini25Pro, DEFAULT_MODELS.gemini25Flash, DEFAULT_MODELS.gemini25FlashLite,
      DEFAULT_MODELS.deepseekChat, DEFAULT_MODELS.deepseekReasoner,
    ],
    opusCreditsPerMonth: 100,
    maxConversations: -1,
    tbwoEnabled: true,
    tbwoParallel: false,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: -1,
    selfLearning: true,
    maxTokens: 32768,
    computerUse: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 50000,
    tbwoRunsPerMonth: 20,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: 100,
    maxCfVideos: 5,
    localModelEnabled: true,
    maxSites: 10,
    ephemeralEnabled: true,
  },
  agency: {
    messagesPerHour: -1,
    allowedModels: [
      DEFAULT_MODELS.claudeOpus, DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.claudeHaiku,
      DEFAULT_MODELS.gpt52, DEFAULT_MODELS.gpt51, DEFAULT_MODELS.gpt5, DEFAULT_MODELS.gpt5Mini, DEFAULT_MODELS.gpt5Nano,
      DEFAULT_MODELS.gpt41, DEFAULT_MODELS.gpt41Mini, DEFAULT_MODELS.gpt41Nano,
      DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini,
      DEFAULT_MODELS.o3, DEFAULT_MODELS.o4Mini, DEFAULT_MODELS.o3Mini,
      DEFAULT_MODELS.gemini3Pro, DEFAULT_MODELS.gemini3Flash, DEFAULT_MODELS.gemini25Pro, DEFAULT_MODELS.gemini25Flash, DEFAULT_MODELS.gemini25FlashLite,
      DEFAULT_MODELS.deepseekChat, DEFAULT_MODELS.deepseekReasoner,
    ],
    opusCreditsPerMonth: -1,
    maxConversations: -1,
    tbwoEnabled: true,
    tbwoParallel: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: -1,
    selfLearning: true,
    maxTokens: 65536,
    computerUse: true,
    customRouting: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 100000,
    tbwoRunsPerMonth: 50,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: 500,
    maxCfVideos: 100,
    localModelEnabled: true,
    maxSites: 25,
    ephemeralEnabled: true,
    multiSeat: true,
    apiAccess: true,
    whiteLabelEnabled: true,
  },
  // Admin virtual tier — every capability maxed out
  admin: {
    messagesPerHour: -1,
    allowedModels: ['*'],
    opusCreditsPerMonth: -1,
    maxConversations: -1,
    tbwoEnabled: true,
    tbwoParallel: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: -1,
    selfLearning: true,
    maxTokens: 65536,
    computerUse: true,
    customRouting: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 100000,
    tbwoRunsPerMonth: -1,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: -1,
    maxCfVideos: -1,
    localModelEnabled: true,
    maxSites: -1,
    ephemeralEnabled: true,
    multiSeat: true,
    apiAccess: true,
    whiteLabelEnabled: true,
  },
};

// ============================================================================
// MONTHLY CREDIT ALLOCATIONS — per plan, per credit type (-1 = unlimited)
// ============================================================================

export const MONTHLY_CREDITS = {
  free:   { credits: 100 },
  spark:  { credits: 1500 },
  pro:    { credits: 6000 },
  agency: { credits: 20000 },
};

// ============================================================================
// CREDIT COSTS — central cost table for all billable actions
// ============================================================================

export const CREDIT_COSTS = {
  chat_message: 1,
  image_generation: 10,
  site_extend: 200,

  // Per-TBWO-type total cost (standard tier)
  tbwo: {
    website_sprint: 1200,
    research_report: 500,
    market_research: 500,
    due_diligence: 650,
    seo_audit: 500,
    business_plan: 650,
    content_strategy: 450,
    newsletter: 250,
    roast_page: 80,
    tribute_page: 90,
    bet_tracker: 120,
    debate_page: 120,
    time_capsule: 100,
    scoreboard: 150,
    custom: 500,
    general: 500,
  },

  // Quality tier multipliers
  tierMultiplier: { standard: 1, premium: 2, ultra: 3 },
};

// ============================================================================
// MODEL METADATA — provider info, display names, categories, tiers
// ============================================================================

export const MODEL_METADATA = {
  // Anthropic
  'claude-opus-4-6':            { provider: 'anthropic', displayName: 'Claude Opus 4.6',        category: 'Anthropic', tier: 'pro',   description: 'Most intelligent, deep reasoning and extended thinking',   inputCost: 15, outputCost: 75 },
  'claude-sonnet-4-6':            { provider: 'anthropic', displayName: 'Claude Sonnet 4.6',      category: 'Anthropic', tier: 'free',  description: 'Best coding, agents, reasoning — the new default',         inputCost: 3, outputCost: 15 },
  'claude-sonnet-4-5-20250929': { provider: 'anthropic', displayName: 'Claude Sonnet 4.5',      category: 'Anthropic', tier: 'free',  description: 'Previous generation all-rounder',                          inputCost: 3, outputCost: 15 },
  'claude-haiku-4-5-20251001':  { provider: 'anthropic', displayName: 'Claude Haiku 4.5',       category: 'Anthropic', tier: 'pro',   description: 'Fastest Claude, quick tasks and classifications',          inputCost: 0.8, outputCost: 4 },

  // GPT-5.x Family
  'gpt-5.2':     { provider: 'openai', displayName: 'GPT-5.2',        category: 'GPT',  tier: 'agency', description: 'OpenAI flagship — best coding, reasoning, vision, agentic',    inputCost: 1.75, outputCost: 14 },
  'gpt-5.1':     { provider: 'openai', displayName: 'GPT-5.1',        category: 'GPT',  tier: 'pro',   description: 'Previous flagship, excellent coding and reasoning',            inputCost: 1.25, outputCost: 10 },
  'gpt-5':       { provider: 'openai', displayName: 'GPT-5',          category: 'GPT',  tier: 'pro',   description: 'Strong reasoning with configurable effort',                    inputCost: 1.25, outputCost: 10 },
  'gpt-5-mini':  { provider: 'openai', displayName: 'GPT-5 Mini',     category: 'GPT',  tier: 'free',  description: 'Fast reasoning at low cost, well-defined tasks',               inputCost: 0.25, outputCost: 2 },
  'gpt-5-nano':  { provider: 'openai', displayName: 'GPT-5 Nano',     category: 'GPT',  tier: 'free',  description: 'Cheapest reasoning model, summarization, classification',      inputCost: 0.05, outputCost: 0.4 },

  // GPT-4.1 Family
  'gpt-4.1':      { provider: 'openai', displayName: 'GPT-4.1',       category: 'GPT',  tier: 'pro',   description: '1M context, strong coding and instruction following',          inputCost: 2, outputCost: 8 },
  'gpt-4.1-mini': { provider: 'openai', displayName: 'GPT-4.1 Mini',  category: 'GPT',  tier: 'free',  description: '1M context at affordable price, versatile',                    inputCost: 0.4, outputCost: 1.6 },
  'gpt-4.1-nano': { provider: 'openai', displayName: 'GPT-4.1 Nano',  category: 'GPT',  tier: 'free',  description: '1M context, cheapest long-context GPT',                        inputCost: 0.1, outputCost: 0.4 },

  // GPT-4o Family
  'gpt-4o':      { provider: 'openai', displayName: 'GPT-4o',         category: 'GPT',  tier: 'free',  description: 'Multimodal, creative writing, vision, structured output',      inputCost: 2.5, outputCost: 10 },
  'gpt-4o-mini': { provider: 'openai', displayName: 'GPT-4o Mini',    category: 'GPT',  tier: 'free',  description: 'Cheapest multimodal, great JSON extraction',                   inputCost: 0.15, outputCost: 0.6 },

  // o-Series (Reasoning)
  'o3':      { provider: 'openai', displayName: 'o3',            category: 'GPT',  tier: 'agency', description: 'Deep multi-step reasoning for hardest problems',               inputCost: 2, outputCost: 8 },
  'o4-mini': { provider: 'openai', displayName: 'o4-mini',       category: 'GPT',  tier: 'pro',   description: 'Fast reasoning, strong math/coding/visual tasks',              inputCost: 1.1, outputCost: 4.4 },
  'o3-mini': { provider: 'openai', displayName: 'o3-mini',       category: 'GPT',  tier: 'pro',   description: 'Efficient reasoning, science/math/coding',                     inputCost: 1.1, outputCost: 4.4 },

  // Gemini
  'gemini-3-pro-preview':  { provider: 'gemini', displayName: 'Gemini 3 Pro',          category: 'Gemini', tier: 'agency', description: 'Strongest reasoning, agentic coding, native multimodal',   inputCost: 2, outputCost: 12 },
  'gemini-3-flash-preview':{ provider: 'gemini', displayName: 'Gemini 3 Flash',        category: 'Gemini', tier: 'pro',   description: 'Fast frontier model, rivals much larger models',            inputCost: 0.5, outputCost: 3 },
  'gemini-2.5-pro':        { provider: 'gemini', displayName: 'Gemini 2.5 Pro',        category: 'Gemini', tier: 'pro',   description: '1M token context, built-in Google Search grounding',        inputCost: 1.25, outputCost: 10 },
  'gemini-2.5-flash':      { provider: 'gemini', displayName: 'Gemini 2.5 Flash',      category: 'Gemini', tier: 'free',  description: 'Hybrid reasoning, excellent value and speed',               inputCost: 0.15, outputCost: 0.6 },
  'gemini-2.5-flash-lite': { provider: 'gemini', displayName: 'Gemini 2.5 Flash-Lite', category: 'Gemini', tier: 'free',  description: 'Ultra-fast, lowest cost, great for background tasks',       inputCost: 0.1, outputCost: 0.4 },

  // DeepSeek
  'deepseek-chat':     { provider: 'deepseek', displayName: 'DeepSeek V3.2',       category: 'DeepSeek', tier: 'free',  description: 'Near-frontier intelligence at 95% lower cost',           inputCost: 0.28, outputCost: 0.42 },
  'deepseek-reasoner': { provider: 'deepseek', displayName: 'DeepSeek Reasoner',   category: 'DeepSeek', tier: 'pro',   description: 'Chain-of-thought reasoning, IMO gold medalist math',     inputCost: 0.28, outputCost: 0.42 },
};

// ============================================================================
// QUOTA HELPERS — monthly limit tracking via user_quotas table
// ============================================================================

export function getCurrentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function getQuotaCount(stmts, userId, quotaType) {
  const row = stmts.getQuota.get(userId, quotaType, getCurrentPeriod());
  return row ? row.count : 0;
}

export function incrementQuota(stmts, userId, quotaType) {
  stmts.incrementQuota.run(userId, quotaType, getCurrentPeriod());
}

/**
 * Express middleware: checks plan-based limits (model access, quotas, rate limits).
 * Requires `ctx` to be bound via closure.
 */
export function createCheckPlanLimits(db, stmts) {
  return function checkPlanLimits(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    // Admin users get admin-level access (every ability maxed out)
    const plan = req.user.isAdmin ? 'admin' : (req.user.plan || 'free');
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const model = req.body.model;

    // Check model access
    if (model && limits.allowedModels.length > 0 && !limits.allowedModels.includes('*') && !limits.allowedModels.includes(model)) {
      return res.status(403).json({
        error: 'Model not available on your plan',
        allowedModels: limits.allowedModels,
        plan,
      });
    }

    // Check Opus monthly credits
    if (model && model.includes('opus') && limits.opusCreditsPerMonth > 0) {
      const used = getQuotaCount(stmts, req.user.id, 'opus_messages');
      if (used >= limits.opusCreditsPerMonth) {
        return res.status(429).json({
          error: 'Monthly Opus credits exhausted. Switch to Sonnet or upgrade to Agency for unlimited Opus.',
          used,
          limit: limits.opusCreditsPerMonth,
          code: 'OPUS_QUOTA_EXCEEDED',
        });
      }
    }

    // Check rate limit (messages per hour)
    if (limits.messagesPerHour > 0) {
      const oneHourAgo = Date.now() - 3600000;
      try {
        const row = db.prepare(
          'SELECT COUNT(*) as count FROM messages WHERE timestamp > ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)'
        ).get(oneHourAgo, req.user.id);
        if (row && row.count >= limits.messagesPerHour) {
          return res.status(429).json({
            error: 'Rate limit exceeded',
            limit: limits.messagesPerHour,
            plan,
            resetIn: '1 hour',
          });
        }
      } catch {
        // If user_id column doesn't exist yet, skip rate limiting
      }
    }

    // Daily message cap (safety net)
    const DAILY_CAPS = { free: 100, spark: 500, pro: 1000, agency: -1, admin: -1 };
    const dailyCap = DAILY_CAPS[plan] ?? 100;
    if (dailyCap > 0) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      try {
        const row = db.prepare(
          'SELECT COUNT(*) as count FROM messages WHERE timestamp > ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)'
        ).get(todayStart.getTime(), req.user.id);
        if (row && row.count >= dailyCap) {
          return res.status(429).json({
            error: 'Daily message limit reached. Resets at midnight.',
            limit: dailyCap,
            plan,
            code: 'DAILY_LIMIT_EXCEEDED',
          });
        }
      } catch {
        // Skip if query fails
      }
    }

    // Cap thinking budget
    if (req.body.thinkingBudget && limits.thinkingBudgetCap > 0) {
      req.body.thinkingBudget = Math.min(req.body.thinkingBudget, limits.thinkingBudgetCap);
    }

    // Cap max tokens
    if (limits.maxTokens > 0) {
      req.body.maxTokens = Math.min(req.body.maxTokens || limits.maxTokens, limits.maxTokens);
    }

    req.planLimits = limits;
    next();
  };
}
