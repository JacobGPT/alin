/**
 * AuditDashboard - Usage & Cost Tracking Dashboard
 *
 * Shows:
 * - Session totals (tokens, cost, messages)
 * - Period-based summaries (today, week, month, all time)
 * - Per-model cost breakdown
 * - Tool usage stats
 * - Conversation receipts
 */

import { useState } from 'react';
import {
  ChartBarIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CpuChipIcon,
  WrenchScrewdriverIcon,
  DocumentTextIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useAuditStore } from '../../store/auditStore';
import { useUIStore } from '../../store/uiStore';

// ============================================================================
// TYPES
// ============================================================================

type Period = 'today' | 'week' | 'month' | 'all';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function AuditDashboard() {
  const [period, setPeriod] = useState<Period>('today');
  const closeModal = useUIStore((state) => state.closeModal);

  const summary = useAuditStore((state) => state.getUsageSummary(period));
  const session = useAuditStore((state) => state.getSessionCost());
  const totalAllTime = useAuditStore((state) => state.getTotalCost());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl border border-border-primary bg-background-primary shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-primary bg-background-primary px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Usage & Receipts</h2>
            <p className="text-sm text-text-tertiary">Track your API usage, costs, and tool activity</p>
          </div>
          <button
            onClick={closeModal}
            className="rounded-lg p-2 text-text-tertiary hover:bg-background-hover hover:text-text-primary transition-colors"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Session Summary Cards */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3">This Session</h3>
            <div className="grid grid-cols-3 gap-4">
              <MetricCard
                icon={CurrencyDollarIcon}
                label="Cost"
                value={`$${session.cost.toFixed(4)}`}
                color="text-green-400"
              />
              <MetricCard
                icon={ChartBarIcon}
                label="Tokens"
                value={session.tokens.toLocaleString()}
                color="text-blue-400"
              />
              <MetricCard
                icon={DocumentTextIcon}
                label="Messages"
                value={session.messages.toString()}
                color="text-purple-400"
              />
            </div>
          </div>

          {/* Period Selector */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Usage Summary</h3>
              <div className="flex gap-1 rounded-lg bg-background-secondary p-1">
                {(['today', 'week', 'month', 'all'] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      period === p
                        ? 'bg-brand-primary text-white'
                        : 'text-text-tertiary hover:text-text-secondary'
                    }`}
                  >
                    {p === 'all' ? 'All Time' : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <SmallMetric label="Total Cost" value={`$${summary.totalCost.toFixed(4)}`} />
              <SmallMetric label="Messages" value={summary.totalMessages.toLocaleString()} />
              <SmallMetric label="Tokens" value={formatTokens(summary.totalTokens)} />
              <SmallMetric label="Conversations" value={summary.totalConversations.toString()} />
            </div>
          </div>

          {/* Model Breakdown */}
          {Object.keys(summary.byModel).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3 flex items-center gap-2">
                <CpuChipIcon className="h-4 w-4" />
                Cost by Model
              </h3>
              <div className="space-y-2">
                {Object.entries(summary.byModel)
                  .sort((a, b) => b[1].cost - a[1].cost)
                  .map(([model, data]) => (
                    <div
                      key={model}
                      className="flex items-center justify-between rounded-lg bg-background-secondary px-4 py-3"
                    >
                      <div>
                        <span className="text-sm font-medium text-text-primary">{formatModelName(model)}</span>
                        <span className="ml-2 text-xs text-text-quaternary">
                          {data.messages} msgs, {formatTokens(data.tokens)} tokens
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-green-400">${data.cost.toFixed(4)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Tool Usage */}
          {summary.topTools.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3 flex items-center gap-2">
                <WrenchScrewdriverIcon className="h-4 w-4" />
                Tool Usage
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {summary.topTools.slice(0, 8).map((tool) => (
                  <div
                    key={tool.name}
                    className="flex items-center justify-between rounded-lg bg-background-secondary px-3 py-2"
                  >
                    <span className="text-xs text-text-secondary truncate">{tool.name}</span>
                    <span className="text-xs font-medium text-text-tertiary ml-2">{tool.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily Cost Chart (simple text-based) */}
          {summary.dailyCosts.length > 1 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-3 flex items-center gap-2">
                <ClockIcon className="h-4 w-4" />
                Daily Costs
              </h3>
              <div className="space-y-1">
                {summary.dailyCosts.slice(-7).map((day) => {
                  const maxCost = Math.max(...summary.dailyCosts.map((d) => d.cost));
                  const width = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                  return (
                    <div key={day.date} className="flex items-center gap-3">
                      <span className="text-xs text-text-quaternary w-20 flex-shrink-0">{day.date.slice(5)}</span>
                      <div className="flex-1 h-5 bg-background-secondary rounded overflow-hidden">
                        <div
                          className="h-full bg-brand-primary/30 rounded"
                          style={{ width: `${Math.max(width, 2)}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-tertiary w-16 text-right">${day.cost.toFixed(4)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* All-time total */}
          <div className="border-t border-border-primary pt-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-tertiary">All-Time Total Cost</span>
              <span className="text-lg font-bold text-green-400">${totalAllTime.toFixed(4)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs text-text-tertiary">{label}</span>
      </div>
      <span className="text-xl font-bold text-text-primary">{value}</span>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background-secondary p-3 text-center">
      <div className="text-xs text-text-quaternary mb-1">{label}</div>
      <div className="text-sm font-semibold text-text-primary">{value}</div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatModelName(model: string): string {
  const names: Record<string, string> = {
    'claude-opus-4-6': 'Claude Opus 4.6',
    'claude-sonnet-4-6': 'Claude Sonnet 4.6',
    'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o Mini',
  };
  return names[model] || model;
}

export default AuditDashboard;
