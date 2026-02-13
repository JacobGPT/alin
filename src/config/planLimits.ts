/**
 * Plan Limits - Client-side copy for UI gating
 *
 * The server is the enforcement point. This is only for showing/hiding UI elements.
 *
 * Tiers: free | pro | elite | admin
 * - "admin" is a virtual tier — any user with isAdmin: true gets admin limits
 * - Hosting is separate from the plan (see HOSTING_LIMITS)
 */

export interface PlanLimits {
  messagesPerHour: number;           // -1 = unlimited
  allowedModels: string[];
  opusCreditsPerMonth: number;       // -1 = unlimited, 0 = none
  maxConversations: number;          // -1 = unlimited
  tbwoEnabled: boolean;
  tbwoParallel: boolean;             // concurrent TBWO runs
  directModeEnabled: boolean;
  codeLabEnabled: boolean;
  imageStudioEnabled: boolean;
  memoryLayers: number;
  memoryRetentionDays: number;       // -1 = unlimited
  selfLearning: boolean;
  maxTokens: number;
  computerUse: boolean;
  customRouting?: boolean;
  maxToolCallsPerMessage: number;    // -1 = unlimited
  thinkingBudgetCap: number;         // max thinking tokens
  scene3DTemplates: number;          // -1 = unlimited
  scene3DUpload: boolean;
  scene3DImmersive: boolean;
  tbwoRunsPerMonth: number;           // all TBWO types (sites, code, research), -1 = unlimited
  sitesEnabled: boolean;              // UI gate for sites section
  cfImagesEnabled: boolean;
  cfStreamEnabled: boolean;
  vectorizeEnabled: boolean;
  maxCfImages: number;               // per month, -1 = unlimited
  maxCfVideos: number;               // per month, -1 = unlimited
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    messagesPerHour: 25,
    allowedModels: [
      'claude-sonnet-4-5-20250929',
      'gpt-4o-mini',
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
    scene3DTemplates: 3,
    scene3DUpload: false,
    scene3DImmersive: false,
    tbwoRunsPerMonth: 0,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: false,
    vectorizeEnabled: false,
    maxCfImages: 5,
    maxCfVideos: 0,
  },
  pro: {
    messagesPerHour: -1,
    allowedModels: [
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
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
    scene3DTemplates: -1,
    scene3DUpload: true,
    scene3DImmersive: false,
    tbwoRunsPerMonth: 50,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: 50,
    maxCfVideos: 20,
  },
  elite: {
    messagesPerHour: -1,
    allowedModels: [
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1-preview',
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
    scene3DTemplates: -1,
    scene3DUpload: true,
    scene3DImmersive: true,
    tbwoRunsPerMonth: -1,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: -1,
    maxCfVideos: -1,
  },
  // Admin virtual tier — every capability maxed out
  admin: {
    messagesPerHour: -1,
    allowedModels: [
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'o1-preview',
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
    scene3DTemplates: -1,
    scene3DUpload: true,
    scene3DImmersive: true,
    tbwoRunsPerMonth: -1,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: -1,
    maxCfVideos: -1,
  },
};

// ============================================================================
// HOSTING LIMITS (separate from plan — pay-per-site model)
// ============================================================================

export type HostingPlan = 'none' | 'starter' | 'pro_hosting' | 'business';

export interface HostingLimits {
  maxSites: number;
  bandwidthLimitMB: number;
  storageLimitMBPerSite: number;
  customDomainEnabled: boolean;
}

export const HOSTING_LIMITS: Record<HostingPlan, HostingLimits> = {
  none: {
    maxSites: 0,
    bandwidthLimitMB: 0,
    storageLimitMBPerSite: 0,
    customDomainEnabled: false,
  },
  starter: {
    maxSites: 3,
    bandwidthLimitMB: 10240,         // 10 GB
    storageLimitMBPerSite: 250,
    customDomainEnabled: false,
  },
  pro_hosting: {
    maxSites: 10,
    bandwidthLimitMB: 102400,        // 100 GB
    storageLimitMBPerSite: 1024,     // 1 GB
    customDomainEnabled: true,
  },
  business: {
    maxSites: 25,
    bandwidthLimitMB: 1048576,       // 1 TB
    storageLimitMBPerSite: 5120,     // 5 GB
    customDomainEnabled: true,
  },
};

export function getHostingLimits(hostingPlan: HostingPlan): HostingLimits {
  return HOSTING_LIMITS[hostingPlan] ?? HOSTING_LIMITS['none'];
}

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['free']!;
}
