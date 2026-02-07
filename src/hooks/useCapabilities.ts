/**
 * useCapabilities - Capability detection layer
 *
 * Determines what features are available based on:
 * - Environment (local desktop vs hosted web)
 * - User's plan tier
 * - Browser capabilities
 *
 * Desktop (localhost): Full features — file system, code execution, hardware, etc.
 * Web (alinai.dev): Limited — chat, search, image gen, memory, settings only.
 */

import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { getPlanLimits, type PlanLimits } from '../config/planLimits';

export interface Capabilities {
  // Environment
  isApp: boolean;
  isWeb: boolean;
  isPWA: boolean;

  // Desktop-only (needs local file system / hardware)
  canFileExplore: boolean;
  canExecuteCode: boolean;
  canGitOps: boolean;
  canHardwareMonitor: boolean;
  canComputerUse: boolean;
  canBlender: boolean;
  canTBWO: boolean;

  // Always available (browser-only)
  canChat: boolean;
  canMemory: boolean;
  canImageGen: boolean;
  canWebSearch: boolean;
  canVoiceInput: boolean;
  canVoiceOutput: boolean;

  // Plan-gated
  planAllowsTBWO: boolean;
  planAllowsComputerUse: boolean;
  planAllowsCodeLab: boolean;
  planAllowsImageStudio: boolean;
  allowedModels: string[];
  messagesPerHour: number;
  planLimits: PlanLimits;
}

/** Returns true when running on localhost (desktop app) */
function isLocalEnvironment(): boolean {
  if (typeof window === 'undefined') return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

export function useCapabilities(): Capabilities {
  const user = useAuthStore((s) => s.user);

  return useMemo(() => {
    const isApp = isLocalEnvironment();
    const isWeb = !isApp;
    const plan = user?.plan || 'free';
    const limits = getPlanLimits(plan);

    return {
      isApp,
      isWeb,
      isPWA: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,

      // Desktop-only: require local environment
      canFileExplore: isApp,
      canExecuteCode: isApp && limits.codeLabEnabled,
      canGitOps: isApp,
      canHardwareMonitor: isApp,
      canComputerUse: isApp && limits.computerUse,
      canBlender: isApp,
      canTBWO: isApp && limits.tbwoEnabled,

      // Always available
      canChat: !!user,
      canMemory: true,
      canImageGen: !!user && limits.imageStudioEnabled,
      canWebSearch: !!user,
      canVoiceInput:
        typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window),
      canVoiceOutput: typeof window !== 'undefined' && 'speechSynthesis' in window,

      planAllowsTBWO: limits.tbwoEnabled,
      planAllowsComputerUse: limits.computerUse,
      planAllowsCodeLab: limits.codeLabEnabled,
      planAllowsImageStudio: limits.imageStudioEnabled,
      allowedModels: limits.allowedModels,
      messagesPerHour: limits.messagesPerHour,
      planLimits: limits,
    };
  }, [user]);
}

/**
 * Non-hook version for use in non-React code (apiService, etc.)
 */
export function getCapabilitiesSnapshot(): Capabilities {
  const user = useAuthStore.getState().user;
  const plan = user?.plan || 'free';
  const limits = getPlanLimits(plan);
  const isApp = isLocalEnvironment();

  return {
    isApp,
    isWeb: !isApp,
    isPWA: false,
    canFileExplore: isApp,
    canExecuteCode: isApp && limits.codeLabEnabled,
    canGitOps: isApp,
    canHardwareMonitor: isApp,
    canComputerUse: isApp && limits.computerUse,
    canBlender: isApp,
    canTBWO: isApp && limits.tbwoEnabled,
    canChat: !!user,
    canMemory: true,
    canImageGen: !!user && limits.imageStudioEnabled,
    canWebSearch: !!user,
    canVoiceInput: false,
    canVoiceOutput: false,
    planAllowsTBWO: limits.tbwoEnabled,
    planAllowsComputerUse: limits.computerUse,
    planAllowsCodeLab: limits.codeLabEnabled,
    planAllowsImageStudio: limits.imageStudioEnabled,
    allowedModels: limits.allowedModels,
    messagesPerHour: limits.messagesPerHour,
    planLimits: limits,
  };
}
