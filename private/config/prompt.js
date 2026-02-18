/**
 * ALIN Private - Prompt Configuration
 *
 * Partnership-focused prompt identity for private ALIN instances.
 * Includes Consequence Engine config for full transparency mode.
 */

export const privatePromptConfig = {
  role: 'partner',
  identity: 'ALIN - your personal AI development partner',
  constraints: [
    'Communicate as a collaborator, not a servant.',
    'Be honest about limitations and tradeoffs.',
    'Proactively suggest improvements when relevant.',
    'Remember context across conversations.',
    'Prioritize correctness over speed.',
  ],
  capabilities: [
    'Full multi-model chat with extended context',
    'Autonomous code generation and editing',
    'Deep memory and learning from corrections',
    'File system access and code search',
    'Image and voice generation',
    'No rate limits or plan restrictions',
  ],
};

/**
 * Consequence Engine — Private Configuration
 *
 * Full transparency mode: domain dashboards, genome mutations,
 * calibration curves, pain scores, intelligence reports.
 * This is the control room.
 */
export const consequenceEngineConfig = {
  // Domains focused on product strategy
  domains: ['market_sensing', 'first_slice', 'execution_strategy', 'competitive_positioning', 'user_friction'],

  // No bootstrap — active immediately (we can course-correct in real time)
  bootstrapDays: 0,

  // Gene activation thresholds (more permissive on private)
  geneActivationThreshold: 3,
  capabilityReducingThreshold: 5,
  maxActiveGenesPerDomain: 20,

  // Addendum configuration (full intelligence report)
  addendumMaxChars: 2500,
  addendumPrefix: '## Consequence Engine Intelligence Report',

  // Domain keyword weights
  domainKeywordWeights: {
    market_sensing: { primary: ['users', 'market', 'demand', 'adoption'], secondary: ['feature', 'customer', 'engagement', 'retention'] },
    first_slice: { primary: ['ship', 'mvp', 'priority', 'launch'], secondary: ['release', 'deploy', 'iterate', 'prototype'] },
    execution_strategy: { primary: ['build', 'architecture', 'approach', 'strategy'], secondary: ['design', 'implement', 'refactor', 'plan'] },
    competitive_positioning: { primary: ['differentiate', 'compete', 'unique', 'advantage'], secondary: ['moat', 'rival', 'alternative', 'benchmark'] },
    user_friction: { primary: ['confuse', 'friction', 'onboarding', 'UX'], secondary: ['usability', 'intuitive', 'frustrat', 'abandon'] },
  },

  // Decay configuration
  emotionalDecayRate: 0.9,
  predictionExpiryDays: 7,

  // Lifecycle maintenance
  lifecycleIntervalMs: 4 * 60 * 60 * 1000,  // Run lifecycle every 4 hours (more aggressive on private)
  domainHistoryRetentionDays: 180,  // Longer retention for private
  calibrationRetentionDays: 180,

  // Private-only features
  transparency: {
    showDomainDashboard: true,
    showGenomeMutations: true,
    showCalibrationCurves: true,
    showPainScores: true,
    showIntelligenceReports: true,
    showRegressionAlerts: true,
    showPatternLibrary: true,
    showGeneAuditLog: true,
  },
};
