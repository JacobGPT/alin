/**
 * Audit Store - Receipt and usage tracking
 *
 * Tracks all API calls, costs, and tool usage for transparency.
 * Persists to localStorage for historical data.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuditEntry, ConversationReceipt, UsageSummary } from '../types/audit';
import * as dbService from '../api/dbService';

// ============================================================================
// STORE STATE
// ============================================================================

interface AuditState {
  // All audit entries (kept for 90 days)
  entries: AuditEntry[];

  // Running session totals
  sessionTokens: number;
  sessionCost: number;
  sessionMessages: number;

  // Actions
  addEntry: (entry: Omit<AuditEntry, 'id'>) => void;
  getConversationReceipt: (conversationId: string, title?: string) => ConversationReceipt;
  getUsageSummary: (period: 'today' | 'week' | 'month' | 'all') => UsageSummary;
  getTotalCost: () => number;
  getSessionCost: () => { tokens: number; cost: number; messages: number };
  pruneOldEntries: () => void;
  clearAll: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

function getStartOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getDateString(timestamp: number): string {
  return new Date(timestamp).toISOString().split('T')[0]!;
}

function getPeriodStart(period: 'today' | 'week' | 'month' | 'all'): number {
  const now = new Date();
  switch (period) {
    case 'today':
      return getStartOfDay(now);
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return getStartOfDay(d);
    }
    case 'month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return getStartOfDay(d);
    }
    case 'all':
      return 0;
  }
}

// ============================================================================
// STORE
// ============================================================================

export const useAuditStore = create<AuditState>()(
  persist(
    (set, get) => ({
      entries: [],
      sessionTokens: 0,
      sessionCost: 0,
      sessionMessages: 0,

      addEntry: (entryData) => {
        const entry: AuditEntry = {
          ...entryData,
          id: crypto.randomUUID(),
        };

        set((state) => ({
          entries: [...state.entries, entry],
          sessionTokens: state.sessionTokens + entry.tokens.total,
          sessionCost: state.sessionCost + entry.cost,
          sessionMessages: state.sessionMessages + 1,
        }));

        // Fire-and-forget DB write
        dbService.createAuditEntry({
          id: entry.id,
          conversationId: entry.conversationId,
          messageId: entry.messageId,
          model: entry.model,
          tokensPrompt: entry.tokens.prompt,
          tokensCompletion: entry.tokens.completion,
          tokensTotal: entry.tokens.total,
          cost: entry.cost,
          toolsUsed: entry.toolsUsed,
          memoryInjections: entry.memoryInjections || [],
          durationMs: entry.durationMs,
          timestamp: entry.timestamp,
        }).catch(e => console.warn('[auditStore] DB createAuditEntry failed:', e));
      },

      getConversationReceipt: (conversationId, title) => {
        const entries = get().entries.filter((e) => e.conversationId === conversationId);

        const modelBreakdown: Record<string, { messages: number; tokens: number; cost: number }> = {};
        const toolBreakdown: Record<string, { calls: number; successes: number; failures: number }> = {};
        let totalTokens = 0;
        let totalCost = 0;

        for (const entry of entries) {
          totalTokens += entry.tokens.total;
          totalCost += entry.cost;

          // Model breakdown
          if (!modelBreakdown[entry.model]) {
            modelBreakdown[entry.model] = { messages: 0, tokens: 0, cost: 0 };
          }
          modelBreakdown[entry.model]!.messages++;
          modelBreakdown[entry.model]!.tokens += entry.tokens.total;
          modelBreakdown[entry.model]!.cost += entry.cost;

          // Tool breakdown
          for (const tool of entry.toolsUsed) {
            if (!toolBreakdown[tool.toolName]) {
              toolBreakdown[tool.toolName] = { calls: 0, successes: 0, failures: 0 };
            }
            toolBreakdown[tool.toolName]!.calls++;
            if (tool.success) {
              toolBreakdown[tool.toolName]!.successes++;
            } else {
              toolBreakdown[tool.toolName]!.failures++;
            }
          }
        }

        return {
          conversationId,
          title: title || 'Untitled',
          createdAt: entries[0]?.timestamp || Date.now(),
          lastMessageAt: entries[entries.length - 1]?.timestamp || Date.now(),
          totalMessages: entries.length,
          totalTokens,
          totalCost,
          modelBreakdown,
          toolBreakdown,
        };
      },

      getUsageSummary: (period) => {
        const periodStart = getPeriodStart(period);
        const now = Date.now();
        const entries = get().entries.filter((e) => e.timestamp >= periodStart);

        const byModel: Record<string, { messages: number; tokens: number; cost: number }> = {};
        const toolCounts: Record<string, number> = {};
        const dailyMap: Record<string, { cost: number; tokens: number; messages: number }> = {};
        const conversationIds = new Set<string>();

        let totalTokens = 0;
        let totalCost = 0;

        for (const entry of entries) {
          totalTokens += entry.tokens.total;
          totalCost += entry.cost;
          conversationIds.add(entry.conversationId);

          // Model breakdown
          if (!byModel[entry.model]) {
            byModel[entry.model] = { messages: 0, tokens: 0, cost: 0 };
          }
          byModel[entry.model]!.messages++;
          byModel[entry.model]!.tokens += entry.tokens.total;
          byModel[entry.model]!.cost += entry.cost;

          // Tool counts
          for (const tool of entry.toolsUsed) {
            toolCounts[tool.toolName] = (toolCounts[tool.toolName] || 0) + 1;
          }

          // Daily costs
          const dateKey = getDateString(entry.timestamp);
          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = { cost: 0, tokens: 0, messages: 0 };
          }
          dailyMap[dateKey]!.cost += entry.cost;
          dailyMap[dateKey]!.tokens += entry.tokens.total;
          dailyMap[dateKey]!.messages++;
        }

        const dailyCosts = Object.entries(dailyMap)
          .map(([date, data]) => ({ date, ...data }))
          .sort((a, b) => a.date.localeCompare(b.date));

        const topTools = Object.entries(toolCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        return {
          period,
          startDate: periodStart,
          endDate: now,
          totalMessages: entries.length,
          totalConversations: conversationIds.size,
          totalTokens,
          totalCost,
          byModel,
          dailyCosts,
          topTools,
        };
      },

      getTotalCost: () => {
        return get().entries.reduce((sum, e) => sum + e.cost, 0);
      },

      getSessionCost: () => {
        const state = get();
        return {
          tokens: state.sessionTokens,
          cost: state.sessionCost,
          messages: state.sessionMessages,
        };
      },

      pruneOldEntries: () => {
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        set((state) => ({
          entries: state.entries.filter((e) => e.timestamp >= ninetyDaysAgo),
        }));
        dbService.pruneAuditEntries().catch(e => console.warn('[auditStore] DB prune failed:', e));
      },

      clearAll: () => {
        set({ entries: [], sessionTokens: 0, sessionCost: 0, sessionMessages: 0 });
      },
    }),
    {
      name: 'alin-audit-storage',
      // Only persist entries, not session totals
      partialize: (state) => ({ entries: state.entries }),
    }
  )
);

// Prune old entries on load
if (typeof window !== 'undefined') {
  useAuditStore.getState().pruneOldEntries();
}
