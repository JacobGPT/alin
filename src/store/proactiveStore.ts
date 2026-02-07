/**
 * Proactive Store - Manages AI suggestions, scheduled TBWOs, and context insights
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';

export interface Suggestion {
  id: string;
  type: 'action' | 'info' | 'tbwo' | 'memory' | 'tool';
  title: string;
  description: string;
  action?: {
    label: string;
    handler: string; // serialized action identifier
    params?: Record<string, unknown>;
  };
  confidence: number;
  expiresAt: number;
  dismissed: boolean;
  createdAt: number;
  source: 'pattern' | 'context' | 'schedule' | 'error';
}

export interface ScheduledTBWO {
  id: string;
  name: string;
  description: string;
  cronExpression?: string;
  nextRun: number;
  enabled: boolean;
  lastRun?: number;
  templateId?: string;
}

export interface ContextInsight {
  id: string;
  type: 'topic_shift' | 'repeated_error' | 'long_conversation' | 'complex_task' | 'idle';
  message: string;
  timestamp: number;
  actionable: boolean;
}

interface ProactiveState {
  suggestions: Suggestion[];
  scheduledTBWOs: ScheduledTBWO[];
  contextInsights: ContextInsight[];
  enabled: boolean;
  autoDismissMs: number;
  maxSuggestions: number;

  // Actions
  addSuggestion: (suggestion: Omit<Suggestion, 'id' | 'createdAt' | 'dismissed'>) => string;
  dismissSuggestion: (id: string) => void;
  dismissAll: () => void;
  clearExpired: () => void;
  addScheduledTBWO: (tbwo: Omit<ScheduledTBWO, 'id'>) => string;
  removeScheduledTBWO: (id: string) => void;
  toggleScheduledTBWO: (id: string) => void;
  addInsight: (insight: Omit<ContextInsight, 'id' | 'timestamp'>) => void;
  setEnabled: (enabled: boolean) => void;
  getActiveSuggestions: () => Suggestion[];
}

export const useProactiveStore = create<ProactiveState>()(
  immer((set, get) => ({
    suggestions: [],
    scheduledTBWOs: [],
    contextInsights: [],
    enabled: true,
    autoDismissMs: 30000,
    maxSuggestions: 5,

    addSuggestion: (suggestion) => {
      const id = nanoid();
      set((state) => {
        // Remove oldest if at max
        while (state.suggestions.filter(s => !s.dismissed).length >= state.maxSuggestions) {
          const oldest = state.suggestions.find(s => !s.dismissed);
          if (oldest) oldest.dismissed = true;
          else break;
        }

        state.suggestions.push({
          ...suggestion,
          id,
          createdAt: Date.now(),
          dismissed: false,
        });
      });
      return id;
    },

    dismissSuggestion: (id) => {
      set((state) => {
        const s = state.suggestions.find(s => s.id === id);
        if (s) s.dismissed = true;
      });
    },

    dismissAll: () => {
      set((state) => {
        state.suggestions.forEach(s => { s.dismissed = true; });
      });
    },

    clearExpired: () => {
      const now = Date.now();
      set((state) => {
        state.suggestions.forEach(s => {
          if (s.expiresAt > 0 && s.expiresAt < now) {
            s.dismissed = true;
          }
        });
        // Keep only last 50 suggestions total
        if (state.suggestions.length > 50) {
          state.suggestions = state.suggestions.slice(-50);
        }
      });
    },

    addScheduledTBWO: (tbwo) => {
      const id = nanoid();
      set((state) => {
        state.scheduledTBWOs.push({ ...tbwo, id });
      });
      return id;
    },

    removeScheduledTBWO: (id) => {
      set((state) => {
        state.scheduledTBWOs = state.scheduledTBWOs.filter(t => t.id !== id);
      });
    },

    toggleScheduledTBWO: (id) => {
      set((state) => {
        const t = state.scheduledTBWOs.find(t => t.id === id);
        if (t) t.enabled = !t.enabled;
      });
    },

    addInsight: (insight) => {
      set((state) => {
        state.contextInsights.push({
          ...insight,
          id: nanoid(),
          timestamp: Date.now(),
        });
        // Keep last 20 insights
        if (state.contextInsights.length > 20) {
          state.contextInsights = state.contextInsights.slice(-20);
        }
      });
    },

    setEnabled: (enabled) => {
      set((state) => { state.enabled = enabled; });
    },

    getActiveSuggestions: () => {
      const now = Date.now();
      return get().suggestions.filter(
        s => !s.dismissed && (s.expiresAt <= 0 || s.expiresAt > now)
      );
    },
  }))
);
