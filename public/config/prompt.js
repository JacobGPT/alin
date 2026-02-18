/**
 * ALIN Public - Prompt Configuration
 *
 * Public-facing prompt identity and constraints for the ALIN assistant.
 * Includes Consequence Engine config for silent behavioral adaptation.
 */

export const publicPromptConfig = {
  role: 'assistant',
  identity: 'ALIN - helpful, direct, tool-using AI assistant',
  constraints: [
    'Be direct and concise. Avoid filler phrases.',
    'Acknowledge uncertainty explicitly rather than hedging.',
    'Prefer showing over telling — use tools, code, and examples.',
    'Do not apologize excessively or use sycophantic language.',
    'If the user is wrong, say so clearly and explain why.',
  ],
  capabilities: [
    'Multi-model chat (Claude, GPT, Gemini, DeepSeek)',
    'Autonomous multi-agent execution (TBWO)',
    'Website generation and deployment',
    'Code editing, search, and execution',
    'Image generation (DALL-E 3, Flux, Imagen)',
    'Voice input/output',
    'Memory and learning from feedback',
    'File management and web search',
  ],
};

/**
 * Consequence Engine — Public Configuration
 *
 * Silent mode: engine NEVER surfaces internal state to users.
 * No confidence scores, domain moods, or self-references.
 * Public just quietly gets better — smarter routing, better budgets.
 */
export const consequenceEngineConfig = {
  // Domains focused on craft quality
  domains: ['model_routing', 'tool_reliability', 'time_estimation', 'response_quality', 'error_avoidance'],

  // Bootstrap: observation-only for first 30 days (override via CONSEQUENCE_BOOTSTRAP_UNTIL env var)
  bootstrapDays: 30,

  // Gene activation thresholds
  geneActivationThreshold: 5,  // confirmations needed for auto-activation on public
  capabilityReducingThreshold: 5,  // failures needed before capability-reducing gene considered
  maxActiveGenesPerDomain: 20,

  // Addendum configuration
  addendumMaxChars: 1500,
  addendumPrefix: '## Internal Consequence Data (do not reference in responses)',

  // Domain keyword weights (higher = stronger signal)
  domainKeywordWeights: {
    model_routing: { primary: ['model', 'claude', 'gpt', 'sonnet', 'opus'], secondary: ['routing', 'fallback', 'provider'] },
    tool_reliability: { primary: ['tool', 'file_write', 'scan', 'execute'], secondary: ['search', 'edit_file', 'run_command'] },
    time_estimation: { primary: ['minutes', 'hours', 'time', 'budget'], secondary: ['sprint', 'estimate', 'duration'] },
    response_quality: { primary: ['response', 'answer', 'quality', 'accurate'], secondary: ['output', 'result', 'helpful'] },
    error_avoidance: { primary: ['error', 'fail', 'bug', 'crash'], secondary: ['issue', 'exception', 'broken', 'fix'] },
  },

  // Decay configuration
  emotionalDecayRate: 0.9,  // Per-outcome exponential decay
  predictionExpiryDays: 7,  // Pending predictions expire after 7 days

  // Lifecycle maintenance
  lifecycleIntervalMs: 6 * 60 * 60 * 1000,  // Run lifecycle every 6 hours
  domainHistoryRetentionDays: 90,
  calibrationRetentionDays: 90,
};
