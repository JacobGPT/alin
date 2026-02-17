/**
 * TBWO UI Slice — Dashboard toggle, pod selection, phase expansion, filters
 */

import type { TBWOStatus, TBWOType } from '../../types/tbwo';

export function createTBWOUISlice(set: any, _get: any) {
  return {
    // State
    showDashboard: false,
    selectedPodId: null as string | null,
    expandedPhases: new Set<string>(),
    statusFilter: 'all' as TBWOStatus | 'all',
    typeFilter: 'all' as TBWOType | 'all',

    // Actions
    toggleDashboard: () => {
      set((state: any) => {
        state.showDashboard = !state.showDashboard;
      });
    },

    selectPod: (podId: string | null) => {
      set({ selectedPodId: podId });
    },

    togglePhase: (phaseId: string) => {
      set((state: any) => {
        if (state.expandedPhases.has(phaseId)) {
          state.expandedPhases.delete(phaseId);
        } else {
          state.expandedPhases.add(phaseId);
        }
      });
    },

    setStatusFilter: (status: TBWOStatus | 'all') => {
      set({ statusFilter: status });
    },

    setTypeFilter: (type: TBWOType | 'all') => {
      set({ typeFilter: type });
    },
  };
}
