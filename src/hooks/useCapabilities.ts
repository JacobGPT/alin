/**
 * useCapabilities - Capability detection layer
 *
 * Determines what features are available based on:
 * - Backend availability (app vs web)
 * - User's plan tier
 * - Browser capabilities
 */

import { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { isBackendAvailable } from '../api/dbService';
import { getPlanLimits, type PlanLimits } from '../config/planLimits';

export interface Capabilities {
  // Environment
  isApp: boolean;
  isWeb: boolean;
  isPWA: boolean;

  // Backend-dependent
  canFileExplore: boolean;
  canExecuteCode: boolean;
  canGitOps: boolean;
  canHardwareMonitor: boolean;
  canComputerUse: boolean;
  canBlender: boolean;

  // Always available (browser-only)
  canChat: boolean;
  canMemory: boolean;
  canTBWO: boolean;
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

function useBackendStatus(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = await isBackendAvailable();
      if (mounted) setAvailable(ok);
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return available;
}

export function useCapabilities(): Capabilities {
  const user = useAuthStore((s) => s.user);
  const backendAvailable = useBackendStatus();

  return useMemo(() => {
    const isApp = backendAvailable;
    const isWeb = !backendAvailable;
    const plan = user?.plan || 'free';
    const limits = getPlanLimits(plan);

    return {
      isApp,
      isWeb,
      isPWA: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,

      canFileExplore: isApp,
      canExecuteCode: isApp && limits.codeLabEnabled,
      canGitOps: isApp,
      canHardwareMonitor: isApp,
      canComputerUse: isApp && limits.computerUse,
      canBlender: isApp,

      canChat: !!user,
      canMemory: true,
      canTBWO: limits.tbwoEnabled,
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
  }, [user, backendAvailable]);
}

/**
 * Non-hook version for use in non-React code (apiService, etc.)
 * Reads directly from stores — not reactive.
 */
export function getCapabilitiesSnapshot(): Capabilities {
  const user = useAuthStore.getState().user;
  const plan = user?.plan || 'free';
  const limits = getPlanLimits(plan);

  // Assume backend is available if we've used it recently (optimistic for non-hook contexts)
  const isApp = true; // Non-hook context is always server-side code paths

  return {
    isApp,
    isWeb: false,
    isPWA: false,
    canFileExplore: isApp,
    canExecuteCode: isApp && limits.codeLabEnabled,
    canGitOps: isApp,
    canHardwareMonitor: isApp,
    canComputerUse: isApp && limits.computerUse,
    canBlender: isApp,
    canChat: !!user,
    canMemory: true,
    canTBWO: limits.tbwoEnabled,
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
