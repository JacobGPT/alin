/**
 * Mode Store - ALIN Mode Management
 *
 * Manages the current ALIN mode (Regular, Coding, Image, TBWO, Research)
 * and provides mode-specific configuration access.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ALINMode, getModeConfig, type ModeConfig } from '../config/modes';

// ============================================================================
// STORE TYPES
// ============================================================================

interface ModeState {
  currentMode: ALINMode;
  previousMode: ALINMode | null;
}

interface ModeActions {
  setMode: (mode: ALINMode) => void;
  getModeConfig: () => ModeConfig;
  revertMode: () => void;
}

// ============================================================================
// STORE
// ============================================================================

export const useModeStore = create<ModeState & ModeActions>()(
  persist(
    (set, get) => ({
      // State
      currentMode: 'regular',
      previousMode: null,

      // Actions
      setMode: (mode) => {
        set({
          previousMode: get().currentMode,
          currentMode: mode,
        });
      },

      getModeConfig: () => {
        return getModeConfig(get().currentMode);
      },

      revertMode: () => {
        const prev = get().previousMode;
        if (prev) {
          set({
            currentMode: prev,
            previousMode: null,
          });
        }
      },
    }),
    {
      name: 'alin-mode-storage',
    }
  )
);
