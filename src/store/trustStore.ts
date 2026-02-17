/**
 * Trust Store — Internal trust scoring system for ALIN intelligence
 *
 * NOT visible as a UI panel. Trust data feeds into selfModelService.buildAddendum()
 * to make ALIN smarter: adjusting behavior based on accumulated trust/distrust signals.
 *
 * Trust score (0-1) is computed from user feedback, TBWO outcomes, and tool reliability.
 * The score influences the system prompt addendum, making ALIN more cautious in
 * low-trust domains and more confident in high-trust ones.
 *
 * Persisted via selfModelService memory_layers (layer 7 = self_model).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  TrustLevel,
  TrustCategory,
  TrustTransactionType,
} from '../types/trust';
import type {
  TrustBalance,
  TrustTransaction,
  CategoryTrust,
} from '../types/trust';

// ============================================================================
// HELPERS
// ============================================================================

function scoreToLevel(score: number): TrustLevel {
  if (score >= 0.85) return TrustLevel.FULL;
  if (score >= 0.7) return TrustLevel.HIGH;
  if (score >= 0.5) return TrustLevel.MODERATE;
  if (score >= 0.3) return TrustLevel.LOW;
  if (score >= 0.1) return TrustLevel.MINIMAL;
  return TrustLevel.NONE;
}

function createDefaultCategoryTrust(category: TrustCategory): CategoryTrust {
  return {
    category,
    score: 0.5,
    level: TrustLevel.MODERATE,
    successCount: 0,
    failureCount: 0,
    successRate: 0,
    allowedOperations: ['*'],
    restrictedOperations: [],
    lastActivity: 0,
  };
}

// ============================================================================
// STORE
// ============================================================================

interface TrustState {
  balance: TrustBalance;
  transactions: TrustTransaction[];
  initialized: boolean;

  // Actions
  recordSuccess: (category: TrustCategory, amount: number, reason: string, sourceId?: string) => void;
  recordFailure: (category: TrustCategory, amount: number, reason: string, sourceId?: string) => void;
  recordFeedback: (type: 'positive' | 'negative', category?: TrustCategory) => void;
  recordTBWOOutcome: (qualityScore: number, type: string) => void;
  getCategoryTrust: (category: TrustCategory) => CategoryTrust;
  getOverallLevel: () => TrustLevel;
  getTrustSummaryForPrompt: () => string;
  initialize: () => void;
  persistState: () => void;
}

export const useTrustStore = create<TrustState>()(
  immer((set, get) => ({
    balance: {
      current: 0.7, // Start at moderate-high trust
      level: TrustLevel.HIGH,
      categories: new Map<TrustCategory, CategoryTrust>(),
      allTimeEarned: 0,
      allTimeSpent: 0,
      allTimeRevoked: 0,
      recentTrend: 'stable' as const,
      weeklyChange: 0,
      monthlyChange: 0,
      lastUpdated: Date.now(),
      lastEarned: 0,
      lastSpent: 0,
    },
    transactions: [],
    initialized: false,

    initialize: () => {
      if (get().initialized) return;
      // Initialize all categories with default trust
      set(state => {
        for (const cat of Object.values(TrustCategory)) {
          if (!state.balance.categories.has(cat)) {
            state.balance.categories.set(cat, createDefaultCategoryTrust(cat));
          }
        }
        state.initialized = true;
      });

      // Try to restore from selfModel memory layer
      import('../services/selfModelService').then(sm => {
        sm.getLayerMemories('self_model', 100).then(memories => {
          const trustMemory = memories.find(m => m.category === 'trust_state');
          if (trustMemory) {
            try {
              const saved = JSON.parse(trustMemory.content);
              set(state => {
                state.balance.current = saved.current ?? 0.7;
                state.balance.level = scoreToLevel(state.balance.current);
                state.balance.allTimeEarned = saved.allTimeEarned ?? 0;
                state.balance.allTimeSpent = saved.allTimeSpent ?? 0;
                state.balance.recentTrend = saved.recentTrend ?? 'stable';
                // Restore category scores
                if (saved.categories) {
                  for (const [catKey, catData] of Object.entries(saved.categories)) {
                    const cat = catKey as TrustCategory;
                    const existing = state.balance.categories.get(cat) || createDefaultCategoryTrust(cat);
                    Object.assign(existing, catData);
                    existing.level = scoreToLevel(existing.score);
                    state.balance.categories.set(cat, existing);
                  }
                }
              });
            } catch {}
          }
        }).catch(() => {});
      }).catch(() => {});
    },

    recordSuccess: (category, amount, reason, sourceId) => {
      const prevBalance = get().balance.current;
      set(state => {
        // Update overall score
        state.balance.current = Math.min(1, state.balance.current + amount);
        state.balance.level = scoreToLevel(state.balance.current);
        state.balance.allTimeEarned += amount;
        state.balance.lastEarned = Date.now();
        state.balance.lastUpdated = Date.now();

        // Update category
        const cat = state.balance.categories.get(category) || createDefaultCategoryTrust(category);
        cat.successCount++;
        cat.score = Math.min(1, cat.score + amount * 1.5); // Category-specific gets 1.5x
        cat.successRate = cat.successCount / (cat.successCount + cat.failureCount);
        cat.level = scoreToLevel(cat.score);
        cat.lastActivity = Date.now();
        state.balance.categories.set(category, cat);

        // Record transaction
        state.transactions.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: TrustTransactionType.EARNED,
          amount,
          previousBalance: prevBalance,
          newBalance: state.balance.current,
          category,
          reason,
          sourceType: 'system',
          sourceId,
          timestamp: Date.now(),
        });

        // Keep last 100 transactions
        if (state.transactions.length > 100) {
          state.transactions = state.transactions.slice(-100);
        }

        // Compute trend
        const recent = state.transactions.slice(-10);
        const earned = recent.filter(t => t.type === TrustTransactionType.EARNED).length;
        const lost = recent.filter(t => t.type === TrustTransactionType.SPENT || t.type === TrustTransactionType.PENALTY).length;
        state.balance.recentTrend = earned > lost ? 'increasing' : lost > earned ? 'decreasing' : 'stable';
      });

      // Persist to self-model (fire-and-forget)
      get().persistState();
    },

    recordFailure: (category, amount, reason, sourceId) => {
      const prevBalance = get().balance.current;
      set(state => {
        state.balance.current = Math.max(0, state.balance.current - amount);
        state.balance.level = scoreToLevel(state.balance.current);
        state.balance.allTimeSpent += amount;
        state.balance.lastSpent = Date.now();
        state.balance.lastUpdated = Date.now();

        const cat = state.balance.categories.get(category) || createDefaultCategoryTrust(category);
        cat.failureCount++;
        cat.score = Math.max(0, cat.score - amount * 1.5);
        cat.successRate = cat.successCount / (cat.successCount + cat.failureCount);
        cat.level = scoreToLevel(cat.score);
        cat.lastActivity = Date.now();
        state.balance.categories.set(category, cat);

        state.transactions.push({
          id: `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: TrustTransactionType.PENALTY,
          amount,
          previousBalance: prevBalance,
          newBalance: state.balance.current,
          category,
          reason,
          sourceType: 'system',
          sourceId,
          timestamp: Date.now(),
        });

        if (state.transactions.length > 100) {
          state.transactions = state.transactions.slice(-100);
        }

        const recent = state.transactions.slice(-10);
        const earned = recent.filter(t => t.type === TrustTransactionType.EARNED).length;
        const lost = recent.filter(t => t.type === TrustTransactionType.SPENT || t.type === TrustTransactionType.PENALTY).length;
        state.balance.recentTrend = earned > lost ? 'increasing' : lost > earned ? 'decreasing' : 'stable';
      });

      get().persistState();
    },

    recordFeedback: (type, category) => {
      const cat = category || TrustCategory.AUTONOMOUS_TASKS;
      if (type === 'positive') {
        get().recordSuccess(cat, 0.02, 'User gave positive feedback');
      } else {
        get().recordFailure(cat, 0.05, 'User gave negative feedback');
      }
    },

    recordTBWOOutcome: (qualityScore, type) => {
      const cat = TrustCategory.AUTONOMOUS_TASKS;
      if (qualityScore >= 7) {
        get().recordSuccess(cat, 0.03, `High-quality ${type} TBWO (${qualityScore}/10)`);
      } else if (qualityScore < 4) {
        get().recordFailure(cat, 0.08, `Low-quality ${type} TBWO (${qualityScore}/10)`);
      } else {
        // Neutral — slight passive recovery
        get().recordSuccess(cat, 0.005, `Average ${type} TBWO (${qualityScore}/10)`);
      }
    },

    getCategoryTrust: (category) => {
      return get().balance.categories.get(category) || createDefaultCategoryTrust(category);
    },

    getOverallLevel: () => {
      return get().balance.level;
    },

    getTrustSummaryForPrompt: () => {
      const { balance } = get();
      const parts: string[] = [];
      parts.push(`\n## Internal Trust State`);
      parts.push(`- Overall trust: ${(balance.current * 100).toFixed(0)}% (${balance.level})`);
      parts.push(`- Trend: ${balance.recentTrend}`);

      // Highlight low-trust categories
      const lowTrust: string[] = [];
      const highTrust: string[] = [];
      for (const [cat, trust] of balance.categories) {
        if (trust.score < 0.4 && trust.failureCount > 0) {
          lowTrust.push(`${cat} (${(trust.score * 100).toFixed(0)}%, ${trust.failureCount} failures)`);
        }
        if (trust.score > 0.8 && trust.successCount > 3) {
          highTrust.push(`${cat} (${(trust.score * 100).toFixed(0)}%)`);
        }
      }

      if (lowTrust.length > 0) {
        parts.push(`- Low-trust areas (be extra careful): ${lowTrust.join(', ')}`);
      }
      if (highTrust.length > 0) {
        parts.push(`- High-trust areas: ${highTrust.join(', ')}`);
      }

      if (balance.current < 0.4) {
        parts.push(`- CAUTION: Trust is low. Confirm actions with the user before proceeding. Ask clarifying questions.`);
      }

      return parts.join('\n');
    },

    persistState: () => {
      const state = get();
      const serializable = {
        current: state.balance.current,
        allTimeEarned: state.balance.allTimeEarned,
        allTimeSpent: state.balance.allTimeSpent,
        recentTrend: state.balance.recentTrend,
        categories: Object.fromEntries(
          Array.from(state.balance.categories.entries()).map(([k, v]) => [k, {
            score: v.score,
            successCount: v.successCount,
            failureCount: v.failureCount,
            successRate: v.successRate,
          }])
        ),
      };
      import('../services/selfModelService').then(sm => {
        sm.storeLayerMemory(
          7, // self_model layer
          JSON.stringify(serializable),
          'trust_state',
          1.0, // max salience — this is critical state
        ).catch(() => {});
      }).catch(() => {});
    },
  }))
);
