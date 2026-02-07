/**
 * Plan Limits - Client-side copy for UI gating
 *
 * The server is the enforcement point. This is only for showing/hiding UI elements.
 */

export interface PlanLimits {
  messagesPerHour: number; // -1 = unlimited
  allowedModels: string[];
  maxConversations: number; // -1 = unlimited
  tbwoEnabled: boolean;
  directModeEnabled: boolean;
  codeLabEnabled: boolean;
  imageStudioEnabled: boolean;
  memoryLayers: number;
  selfLearning: boolean;
  maxTokens: number;
  computerUse: boolean;
  customRouting?: boolean;
}

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    messagesPerHour: 10,
    allowedModels: ['claude-3-5-sonnet-20241022'],
    maxConversations: 10,
    tbwoEnabled: false,
    directModeEnabled: true,
    codeLabEnabled: false,
    imageStudioEnabled: false,
    memoryLayers: 2,
    selfLearning: false,
    maxTokens: 4096,
    computerUse: false,
  },
  pro: {
    messagesPerHour: -1,
    allowedModels: [
      'claude-opus-4-6',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
    ],
    maxConversations: -1,
    tbwoEnabled: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    selfLearning: true,
    maxTokens: 8192,
    computerUse: true,
  },
  enterprise: {
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
    maxConversations: -1,
    tbwoEnabled: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    selfLearning: true,
    maxTokens: 16384,
    computerUse: true,
    customRouting: true,
  },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS['free']!;
}
