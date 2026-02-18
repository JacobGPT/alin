/**
 * ConsequenceDashboard — 5-Layer Neural Architecture Control Panel
 *
 * 7 tabs: Overview | Domains | Predictions | Genome | Patterns | Intelligence | Export
 *
 * Private mode: Full transparency — everything visible
 * Public mode: Reduced view — no gene approval, limited data
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  type ConsequenceDashboard as DashboardData,
  type DashboardDomainState,
  type BehavioralGene,
  type GeneComparison,
  type WeeklyReport,
  type AccuracyTrendPoint,
  type ConsequenceSnapshot,
  type DomainHistoryEntry,
  getDashboard,
  getKillSwitch,
  setKillSwitch,
  getWeeklyReport,
  getAccuracyTrend,
  getGeneComparison,
  getGenes,
  approveGene,
  deleteGene,
  confirmGene,
  contradictGene,
  getDomainHistory,
  getConfig,
  exportSnapshot,
  importSnapshot,
  runLifecycle,
} from '../../services/consequenceService';

// ============================================================================
// TYPES
// ============================================================================

type TabId = 'overview' | 'domains' | 'predictions' | 'genome' | 'patterns' | 'intelligence' | 'export';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'domains', label: 'Domains' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'genome', label: 'Genome' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'intelligence', label: 'Intel' },
  { id: 'export', label: 'Export' },
];

const DOMAIN_COLORS: Record<string, string> = {
  model_routing: 'bg-blue-500/20 text-blue-400',
  tool_reliability: 'bg-amber-500/20 text-amber-400',
  time_estimation: 'bg-purple-500/20 text-purple-400',
  response_quality: 'bg-green-500/20 text-green-400',
  error_avoidance: 'bg-red-500/20 text-red-400',
  market_sensing: 'bg-cyan-500/20 text-cyan-400',
  first_slice: 'bg-orange-500/20 text-orange-400',
  execution_strategy: 'bg-indigo-500/20 text-indigo-400',
  competitive_positioning: 'bg-pink-500/20 text-pink-400',
  user_friction: 'bg-rose-500/20 text-rose-400',
};

function domainColor(domain: string): string {
  return DOMAIN_COLORS[domain] || 'bg-gray-500/20 text-gray-400';
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function trendIcon(trend: string): string {
  if (trend === 'improving') return '\u2191';
  if (trend === 'declining') return '\u2193';
  return '\u2192';
}

// ============================================================================
// MINI BAR CHART (pure CSS/div based, no library needed)
// ============================================================================

function MiniBarChart({ data, height = 60, color = 'bg-brand-primary' }: {
  data: (number | null)[];
  height?: number;
  color?: string;
}) {
  const maxVal = Math.max(...data.filter((d): d is number => d !== null), 1);
  return (
    <div className="flex items-end gap-0.5" style={{ height }}>
      {data.map((val, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm ${val !== null ? color : 'bg-background-tertiary'} transition-all`}
          style={{ height: val !== null ? Math.max(2, (val / maxVal) * height) : 2 }}
          title={val !== null ? `${val}%` : 'No data'}
        />
      ))}
    </div>
  );
}

function MiniLineChart({ data, height = 60, color = '#6366f1' }: {
  data: (number | null)[];
  height?: number;
  color?: string;
}) {
  const filtered = data.map((v, i) => v !== null ? { x: i, y: v } : null).filter(Boolean) as { x: number; y: number }[];
  if (filtered.length < 2) return <div className="text-xs text-text-tertiary italic py-2">Not enough data for chart</div>;

  const maxVal = Math.max(...filtered.map(p => p.y), 1);
  const minVal = Math.min(...filtered.map(p => p.y), 0);
  const range = maxVal - minVal || 1;
  const w = data.length * 20;
  const points = filtered.map(p => `${(p.x / (data.length - 1)) * w},${height - ((p.y - minVal) / range) * (height - 8) - 4}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {filtered.map((p, i) => (
        <circle
          key={i}
          cx={(p.x / (data.length - 1)) * w}
          cy={height - ((p.y - minVal) / range) * (height - 8) - 4}
          r="3"
          fill={color}
        />
      ))}
    </svg>
  );
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================

export function ConsequenceDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState<boolean | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const config = await getConfig();
      setIsPrivate(config.isPrivate);
      const d = await getDashboard();
      setDashboard(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading && !dashboard) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-text-tertiary animate-pulse">Loading Consequence Engine...</div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <div className="text-sm text-red-400">Failed to load dashboard</div>
        <div className="text-xs text-text-tertiary">{error}</div>
        <button onClick={loadDashboard} className="mt-2 rounded bg-brand-primary/20 px-3 py-1 text-xs text-brand-primary hover:bg-brand-primary/30">
          Retry
        </button>
      </div>
    );
  }

  // Guard: public mode should not see the dashboard
  if (isPrivate === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <div className="text-sm text-text-secondary">Consequence Engine</div>
        <div className="text-xs text-text-tertiary text-center max-w-xs">
          The consequence engine is running silently in the background. The full dashboard is only available on the private instance.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tab Bar */}
      <div className="flex gap-0.5 border-b border-border-primary bg-background-secondary px-2 py-1 overflow-x-auto scrollbar-thin">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`whitespace-nowrap rounded-t px-2.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-background-primary text-text-primary border-b-2 border-brand-primary'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-background-hover'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'overview' && <OverviewTab dashboard={dashboard} onRefresh={loadDashboard} />}
            {activeTab === 'domains' && <DomainsTab dashboard={dashboard} />}
            {activeTab === 'predictions' && <PredictionsTab dashboard={dashboard} />}
            {activeTab === 'genome' && <GenomeTab dashboard={dashboard} onRefresh={loadDashboard} />}
            {activeTab === 'patterns' && <PatternsTab dashboard={dashboard} />}
            {activeTab === 'intelligence' && <IntelligenceTab />}
            {activeTab === 'export' && <ExportTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================================
// TAB: OVERVIEW — Kill switch, key metrics, quick summary
// ============================================================================

function OverviewTab({ dashboard, onRefresh }: { dashboard: DashboardData | null; onRefresh: () => void }) {
  const [killSwitch, setKillSwitchState] = useState<{ active: boolean; effect: string } | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    getKillSwitch().then(setKillSwitchState);
  }, []);

  const handleToggle = async () => {
    if (!killSwitch) return;
    setToggling(true);
    const result = await setKillSwitch(!killSwitch.active);
    setKillSwitchState({ active: result.active, effect: result.message });
    setToggling(false);
    onRefresh();
  };

  const s = dashboard?.summary;

  return (
    <div className="space-y-4">
      {/* Kill Switch */}
      <div className={`rounded-lg border p-3 ${killSwitch?.active ? 'border-red-500/50 bg-red-500/5' : 'border-border-primary bg-background-secondary'}`}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Kill Switch</h3>
            <p className="text-xs text-text-tertiary mt-0.5">
              {killSwitch?.active
                ? 'Observation-only mode. Genes are NOT influencing behavior.'
                : 'Engine is active. Genes influence behavior via system prompt.'}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              killSwitch?.active ? 'bg-red-500' : 'bg-green-600'
            } ${toggling ? 'opacity-50' : ''}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                killSwitch?.active ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {killSwitch?.active && (
          <div className="mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
            Tracking continues. Flip this off to restore behavioral influence.
          </div>
        )}
      </div>

      {/* Key Metrics */}
      {s && (
        <div className="grid grid-cols-2 gap-2">
          <MetricCard label="Predictions" value={s.totalPredictions} />
          <MetricCard label="Outcomes" value={s.totalOutcomes} />
          <MetricCard label="Genes" value={s.totalGenes} />
          <MetricCard label="Domains" value={s.domainsTracked} />
        </div>
      )}

      {/* Status Counts */}
      {dashboard?.statusCounts && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Prediction Status</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(dashboard.statusCounts).map(([status, count]) => (
              <span key={status} className={`rounded-full px-2 py-0.5 text-xs ${
                status.includes('correct') ? 'bg-green-500/15 text-green-400'
                : status.includes('wrong') ? 'bg-red-500/15 text-red-400'
                : status.includes('partial') ? 'bg-yellow-500/15 text-yellow-400'
                : status === 'pending' ? 'bg-blue-500/15 text-blue-400'
                : 'bg-gray-500/15 text-gray-400'
              }`}>
                {status.replace('verified_', '')}: {count}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Domain Quick View */}
      {dashboard?.domainStates && dashboard.domainStates.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Domain Health</h3>
          <div className="space-y-2">
            {dashboard.domainStates.map((d) => (
              <div key={d.domain} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-mono ${domainColor(d.domain)}`}>
                  {d.domain.replace('_', ' ')}
                </span>
                <div className="flex-1 h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${d.accuracy >= 0.7 ? 'bg-green-500' : d.accuracy >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${d.accuracy * 100}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary w-10 text-right">{Math.round(d.accuracy * 100)}%</span>
                <span className="text-xs">{trendIcon(d.trend)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bootstrap Notice */}
      {s?.bootstrapActive && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="text-sm font-semibold text-amber-400">Bootstrap Mode Active</h3>
          <p className="text-xs text-text-tertiary mt-1">
            Engine is in observation-only mode. Predictions and outcomes are being tracked,
            but genes will NOT be created or influence behavior until the bootstrap period ends.
          </p>
        </div>
      )}

      {/* Regression Alerts */}
      {dashboard?.regressionAlerts && dashboard.regressionAlerts.length > 0 && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Regression Alerts</h3>
          {dashboard.regressionAlerts.map((alert) => (
            <div key={alert.geneId} className="text-xs text-text-secondary mb-1">
              [{alert.domain}] {alert.geneText.slice(0, 80)}... ({alert.contradictions} contradictions)
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
      <div className="text-lg font-bold text-text-primary">{value}</div>
      <div className="text-xs text-text-tertiary">{label}</div>
    </div>
  );
}

// ============================================================================
// TAB: DOMAINS — Domain mood timeline, confidence map
// ============================================================================

function DomainsTab({ dashboard }: { dashboard: DashboardData | null }) {
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [history, setHistory] = useState<DomainHistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (selectedDomain) {
      setLoadingHistory(true);
      getDomainHistory(selectedDomain, 60).then(h => {
        setHistory(h);
        setLoadingHistory(false);
      });
    }
  }, [selectedDomain]);

  const domains = dashboard?.domainStates || [];

  return (
    <div className="space-y-4">
      {/* Domain Cards */}
      {domains.map((d) => (
        <div
          key={d.domain}
          onClick={() => setSelectedDomain(selectedDomain === d.domain ? null : d.domain)}
          className={`rounded-lg border p-3 cursor-pointer transition-colors ${
            selectedDomain === d.domain
              ? 'border-brand-primary bg-brand-primary/5'
              : 'border-border-primary bg-background-secondary hover:border-border-secondary'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${domainColor(d.domain)}`}>
              {d.domain.replace(/_/g, ' ')}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-tertiary">{d.total} predictions</span>
              <span className={`text-xs font-medium ${d.trend === 'improving' ? 'text-green-400' : d.trend === 'declining' ? 'text-red-400' : 'text-text-secondary'}`}>
                {trendIcon(d.trend)} {d.trend}
              </span>
            </div>
          </div>

          {/* Gauges */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-text-primary">{Math.round(d.accuracy * 100)}%</div>
              <div className="text-xs text-text-tertiary">Accuracy</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: d.pain > 0.5 ? '#ef4444' : d.pain > 0.2 ? '#f59e0b' : '#22c55e' }}>
                {d.pain.toFixed(2)}
              </div>
              <div className="text-xs text-text-tertiary">Pain</div>
            </div>
            <div>
              <div className="text-lg font-bold" style={{ color: d.satisfaction > 0.5 ? '#22c55e' : d.satisfaction > 0.2 ? '#f59e0b' : '#6b7280' }}>
                {d.satisfaction.toFixed(2)}
              </div>
              <div className="text-xs text-text-tertiary">Satisfaction</div>
            </div>
          </div>

          {/* Streak & Stats */}
          <div className="flex items-center gap-3 mt-2 text-xs text-text-tertiary">
            <span>Streak: {d.streak.type === 'none' ? 'N/A' : `${d.streak.count} ${d.streak.type}`}</span>
            <span>Best: {d.bestStreak}</span>
            <span>Volatility: {d.volatility.toFixed(2)}</span>
            <span>Calibration: {d.calibrationOffset > 0 ? '+' : ''}{d.calibrationOffset.toFixed(2)}</span>
          </div>

          {/* Domain Mood Timeline (expanded) */}
          {selectedDomain === d.domain && (
            <div className="mt-3 pt-3 border-t border-border-primary">
              <h4 className="text-xs font-semibold text-text-secondary mb-2">Mood Timeline (60 days)</h4>
              {loadingHistory ? (
                <div className="text-xs text-text-tertiary animate-pulse">Loading history...</div>
              ) : history.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs text-text-tertiary">Pain (red) vs Satisfaction (green)</div>
                  <div className="flex items-end gap-0.5 h-10">
                    {history.slice(-30).map((h, i) => (
                      <div key={i} className="flex-1 flex flex-col gap-px" title={`${formatDate(h.snapshot_at)}: pain=${h.pain_score.toFixed(2)}, sat=${h.satisfaction_score.toFixed(2)}`}>
                        <div className="bg-red-500/60 rounded-t-sm" style={{ height: Math.max(1, h.pain_score * 20) }} />
                        <div className="bg-green-500/60 rounded-b-sm" style={{ height: Math.max(1, h.satisfaction_score * 20) }} />
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-text-quaternary mt-0.5">
                    <span>{history.length > 0 ? formatDate(history[Math.max(0, history.length - 30)].snapshot_at) : ''}</span>
                    <span>Now</span>
                  </div>

                  {/* Accuracy line */}
                  <div className="mt-2 text-xs text-text-tertiary mb-1">Accuracy over time</div>
                  <MiniLineChart
                    data={history.slice(-30).map(h => Math.round(h.prediction_accuracy * 100))}
                    height={40}
                    color="#6366f1"
                  />
                </div>
              ) : (
                <div className="text-xs text-text-tertiary italic">No history data yet</div>
              )}
            </div>
          )}
        </div>
      ))}

      {domains.length === 0 && (
        <div className="text-center text-sm text-text-tertiary py-8 italic">
          No domain data yet. Start chatting and the engine will track predictions automatically.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB: PREDICTIONS — Accuracy trend chart, prediction feed
// ============================================================================

function PredictionsTab({ dashboard }: { dashboard: DashboardData | null }) {
  const [trendData, setTrendData] = useState<AccuracyTrendPoint[]>([]);
  const [trendDirection, setTrendDirection] = useState('stable');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAccuracyTrend(12).then(r => {
      setTrendData(r.trend);
      setTrendDirection(r.trendDirection);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-4">
      {/* Prediction Accuracy Trend */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Prediction Accuracy Trend</h3>
          <span className={`text-xs font-medium ${
            trendDirection === 'improving' ? 'text-green-400'
            : trendDirection === 'declining' ? 'text-red-400'
            : 'text-text-tertiary'
          }`}>
            {trendDirection === 'improving' ? 'Getting smarter' : trendDirection === 'declining' ? 'Needs attention' : 'Stable'}
          </span>
        </div>

        {loading ? (
          <div className="text-xs text-text-tertiary animate-pulse py-4">Loading trend data...</div>
        ) : trendData.length > 0 ? (
          <>
            <MiniLineChart
              data={trendData.map(d => d.accuracy)}
              height={80}
              color={trendDirection === 'improving' ? '#22c55e' : trendDirection === 'declining' ? '#ef4444' : '#6366f1'}
            />
            <div className="flex justify-between text-xs text-text-quaternary mt-1">
              {trendData.filter((_, i) => i % 3 === 0).map((d, i) => (
                <span key={i}>{d.weekLabel}</span>
              ))}
            </div>

            {/* Weekly bars */}
            <div className="mt-3 text-xs text-text-tertiary mb-1">Predictions per week</div>
            <MiniBarChart data={trendData.map(d => d.total)} height={30} color="bg-brand-primary/60" />
          </>
        ) : (
          <div className="text-xs text-text-tertiary italic py-4">Not enough data yet</div>
        )}
      </div>

      {/* Calibration Curve */}
      {dashboard?.calibrationCurve && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Calibration Curve</h3>
          <p className="text-xs text-text-tertiary mb-2">Expected vs actual accuracy per confidence bucket</p>
          <div className="space-y-1.5">
            {dashboard.calibrationCurve.map((b) => (
              <div key={b.bucket} className="flex items-center gap-2">
                <span className="text-xs text-text-tertiary w-16">{b.range}</span>
                <div className="flex-1 flex items-center gap-1">
                  {/* Expected bar */}
                  <div className="relative h-3 flex-1 bg-background-tertiary rounded overflow-hidden">
                    <div className="absolute h-full bg-blue-500/30 rounded" style={{ width: `${b.expectedAccuracy * 100}%` }} />
                    <div className={`absolute h-full rounded ${b.actualAccuracy >= b.expectedAccuracy ? 'bg-green-500/50' : 'bg-red-500/50'}`} style={{ width: `${b.actualAccuracy * 100}%` }} />
                  </div>
                </div>
                <span className="text-xs text-text-secondary w-20 text-right">
                  {Math.round(b.actualAccuracy * 100)}% / {Math.round(b.expectedAccuracy * 100)}%
                </span>
                <span className="text-xs w-6" title="Overconfidence delta">
                  {b.overconfidenceDelta > 0.05 ? <span className="text-red-400">+</span> : b.overconfidenceDelta < -0.05 ? <span className="text-green-400">-</span> : <span className="text-text-quaternary">=</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-text-quaternary">
            <span><span className="inline-block w-2 h-2 bg-blue-500/30 rounded mr-1" />Expected</span>
            <span><span className="inline-block w-2 h-2 bg-green-500/50 rounded mr-1" />Actual (good)</span>
            <span><span className="inline-block w-2 h-2 bg-red-500/50 rounded mr-1" />Actual (overconfident)</span>
          </div>
        </div>
      )}

      {/* Domain Accuracy Trends */}
      {dashboard?.domainTrends && dashboard.domainTrends.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Domain Accuracy: Recent vs All-Time</h3>
          <div className="space-y-2">
            {dashboard.domainTrends.map((d) => (
              <div key={d.domain} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${domainColor(d.domain)}`}>{d.domain.replace(/_/g, ' ')}</span>
                <div className="flex-1" />
                <span className="text-xs text-text-tertiary">7d: {d.recentAccuracy !== null ? `${d.recentAccuracy}%` : 'N/A'}</span>
                <span className="text-xs text-text-tertiary">All: {d.allTimeAccuracy !== null ? `${d.allTimeAccuracy}%` : 'N/A'}</span>
                {d.recentAccuracy !== null && d.allTimeAccuracy !== null && (
                  <span className={`text-xs font-medium ${d.recentAccuracy > d.allTimeAccuracy ? 'text-green-400' : d.recentAccuracy < d.allTimeAccuracy ? 'text-red-400' : 'text-text-tertiary'}`}>
                    {d.recentAccuracy > d.allTimeAccuracy ? '+' : ''}{d.recentAccuracy - d.allTimeAccuracy}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB: GENOME — Gene viewer, A/B comparison, approval flow
// ============================================================================

function GenomeTab({ dashboard, onRefresh }: { dashboard: DashboardData | null; onRefresh: () => void }) {
  const [genes, setGenes] = useState<BehavioralGene[]>([]);
  const [pendingGenes, setPendingGenes] = useState<BehavioralGene[]>([]);
  const [comparison, setComparison] = useState<GeneComparison | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);
  const [geneFilter, setGeneFilter] = useState<'active' | 'pending_review' | 'all'>('active');
  const [loading, setLoading] = useState(true);

  const loadGenes = useCallback(async () => {
    setLoading(true);
    const [active, pending] = await Promise.all([
      getGenes({ status: 'active', limit: 50 }),
      getGenes({ status: 'pending_review', limit: 50 }),
    ]);
    setGenes(active);
    setPendingGenes(pending);
    setLoading(false);
  }, []);

  useEffect(() => { loadGenes(); }, [loadGenes]);

  const handleCompare = async (geneId: string) => {
    if (comparingId === geneId) {
      setComparison(null);
      setComparingId(null);
      return;
    }
    setComparingId(geneId);
    const comp = await getGeneComparison(geneId);
    setComparison(comp);
  };

  const handleApprove = async (geneId: string) => {
    await approveGene(geneId, 'Approved from dashboard');
    await loadGenes();
    onRefresh();
  };

  const handleDelete = async (geneId: string) => {
    await deleteGene(geneId, 'Deleted from dashboard');
    await loadGenes();
    onRefresh();
  };

  const displayGenes = geneFilter === 'pending_review' ? pendingGenes
    : geneFilter === 'active' ? genes
    : [...genes, ...pendingGenes];

  return (
    <div className="space-y-4">
      {/* Pending Review Alert */}
      {pendingGenes.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="text-sm font-semibold text-amber-400">{pendingGenes.length} gene{pendingGenes.length > 1 ? 's' : ''} awaiting review</h3>
          <p className="text-xs text-text-tertiary mt-0.5">These genes need your approval before they can influence behavior.</p>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1">
        {(['active', 'pending_review', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setGeneFilter(f)}
            className={`rounded px-2 py-1 text-xs ${geneFilter === f ? 'bg-brand-primary/20 text-brand-primary' : 'text-text-tertiary hover:bg-background-hover'}`}
          >
            {f === 'pending_review' ? `Pending (${pendingGenes.length})` : f === 'active' ? `Active (${genes.length})` : 'All'}
          </button>
        ))}
      </div>

      {/* Gene List */}
      {loading ? (
        <div className="text-xs text-text-tertiary animate-pulse py-4">Loading genes...</div>
      ) : displayGenes.length > 0 ? (
        <div className="space-y-2">
          {displayGenes.map((g) => (
            <div key={g.id} className="rounded-lg border border-border-primary bg-background-secondary p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${domainColor(g.domain)}`}>{g.domain.replace(/_/g, ' ')}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${
                      g.status === 'active' ? 'bg-green-500/15 text-green-400'
                      : g.status === 'pending_review' ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-gray-500/15 text-gray-400'
                    }`}>{g.status.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-text-quaternary">str: {g.strength.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-text-primary">{g.gene_text}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-text-quaternary">
                    <span>{g.confirmations} confirms</span>
                    <span>{g.contradictions} contradicts</span>
                    {g.regression_risk !== 'none' && (
                      <span className="text-amber-400">Risk: {g.regression_risk}</span>
                    )}
                    <span>{formatTimeAgo(g.created_at)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1 mt-2 border-t border-border-primary pt-2">
                {g.status === 'pending_review' && (
                  <button onClick={() => handleApprove(g.id)} className="rounded bg-green-500/15 px-2 py-0.5 text-xs text-green-400 hover:bg-green-500/25">
                    Approve
                  </button>
                )}
                <button onClick={() => handleCompare(g.id)} className={`rounded px-2 py-0.5 text-xs ${comparingId === g.id ? 'bg-brand-primary/20 text-brand-primary' : 'bg-background-tertiary text-text-tertiary hover:bg-background-hover'}`}>
                  {comparingId === g.id ? 'Hide A/B' : 'A/B Compare'}
                </button>
                <button onClick={() => handleDelete(g.id)} className="rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/20">
                  Delete
                </button>
              </div>

              {/* A/B Comparison (expanded) */}
              {comparingId === g.id && comparison && (
                <div className="mt-3 pt-3 border-t border-border-primary">
                  <h4 className="text-xs font-semibold text-text-secondary mb-2">A/B Comparison</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Before */}
                    <div className="rounded border border-red-500/20 bg-red-500/5 p-2">
                      <div className="text-xs font-semibold text-red-400 mb-1">WITHOUT Gene</div>
                      <p className="text-xs text-text-tertiary mb-2">{comparison.comparison.before.description}</p>
                      {comparison.comparison.before.examples.slice(0, 3).map((ex, i) => (
                        <div key={i} className="text-xs text-text-quaternary mb-1 pl-2 border-l border-red-500/20">
                          "{ex.prediction.slice(0, 60)}..." (conf: {Math.round(ex.confidence * 100)}%)
                        </div>
                      ))}
                      {comparison.comparison.before.domainAccuracy !== null && (
                        <div className="text-xs text-text-tertiary mt-1">Domain accuracy: {comparison.comparison.before.domainAccuracy}%</div>
                      )}
                    </div>

                    {/* After */}
                    <div className="rounded border border-green-500/20 bg-green-500/5 p-2">
                      <div className="text-xs font-semibold text-green-400 mb-1">WITH Gene</div>
                      <p className="text-xs text-text-tertiary mb-2">{comparison.comparison.after.description.slice(0, 100)}</p>
                      {comparison.comparison.after.examples.slice(0, 3).map((ex, i) => (
                        <div key={i} className="text-xs text-text-quaternary mb-1 pl-2 border-l border-green-500/20">
                          {ex.adjustedBehavior.slice(0, 80)}
                        </div>
                      ))}
                      {comparison.comparison.after.estimatedAccuracyGain > 0 && (
                        <div className="text-xs text-green-400 mt-1">Est. accuracy gain: +{comparison.comparison.after.estimatedAccuracyGain}%</div>
                      )}
                    </div>
                  </div>

                  <div className={`mt-2 rounded px-2 py-1 text-xs ${
                    comparison.recommendation.includes('safe') ? 'bg-green-500/10 text-green-400'
                    : comparison.recommendation.includes('carefully') ? 'bg-amber-500/10 text-amber-400'
                    : 'bg-red-500/10 text-red-400'
                  }`}>
                    {comparison.recommendation}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-sm text-text-tertiary py-8 italic">
          No genes yet. The engine creates genes automatically from repeated prediction patterns.
        </div>
      )}

      {/* Gene Stats */}
      {dashboard?.geneEffectiveness && dashboard.geneEffectiveness.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Gene Effectiveness</h3>
          {dashboard.geneEffectiveness.map((g) => (
            <div key={g.id} className="flex items-center gap-2 mb-1">
              <div className="flex-1 h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${g.effectiveness >= 0.6 ? 'bg-green-500' : g.effectiveness >= 0.3 ? 'bg-yellow-500' : 'bg-red-500'}`}
                  style={{ width: `${g.effectiveness * 100}%` }}
                />
              </div>
              <span className="text-xs text-text-tertiary w-8 text-right">{Math.round(g.effectiveness * 100)}%</span>
              <span className="text-xs text-text-quaternary truncate max-w-32">{g.gene_text.slice(0, 40)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB: PATTERNS — Pattern library, emerging patterns
// ============================================================================

function PatternsTab({ dashboard }: { dashboard: DashboardData | null }) {
  const patterns = dashboard?.emergingPatterns || [];

  return (
    <div className="space-y-4">
      {/* Emerging Patterns */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Emerging Patterns</h3>
        {patterns.length > 0 ? (
          <div className="space-y-2">
            {patterns.map((p) => (
              <div key={p.id} className="rounded border border-border-primary bg-background-primary p-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${domainColor(p.domain)}`}>{p.domain.replace(/_/g, ' ')}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${
                    p.status === 'promoted' ? 'bg-green-500/15 text-green-400'
                    : p.status === 'emerging' ? 'bg-blue-500/15 text-blue-400'
                    : 'bg-gray-500/15 text-gray-400'
                  }`}>{p.status}</span>
                  <span className="text-xs text-text-quaternary">freq: {p.frequency}</span>
                </div>
                <p className="text-xs text-text-primary">{p.description}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-text-quaternary">
                  <span>Signature: {p.pattern_signature}</span>
                  <span>Confidence: {(p.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-text-tertiary italic py-2">No patterns detected yet. Patterns emerge from repeated prediction failures.</div>
        )}
      </div>

      {/* Outcomes Summary */}
      {dashboard?.outcomesByResult && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Outcomes by Result</h3>
          <div className="flex gap-3">
            {Object.entries(dashboard.outcomesByResult).map(([result, count]) => (
              <div key={result} className="text-center">
                <div className="text-lg font-bold text-text-primary">{count}</div>
                <div className={`text-xs ${
                  result === 'correct' ? 'text-green-400' : result === 'wrong' ? 'text-red-400' : 'text-yellow-400'
                }`}>{result}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Outcomes */}
      {dashboard?.recentOutcomes && dashboard.recentOutcomes.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Recent Outcomes</h3>
          <div className="space-y-1.5">
            {dashboard.recentOutcomes.slice(0, 10).map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  o.result === 'correct' ? 'bg-green-500' : o.result === 'wrong' ? 'bg-red-500' : 'bg-yellow-500'
                }`} />
                <span className="text-text-tertiary truncate flex-1">
                  {o.prediction_text?.slice(0, 60) || o.trigger_source?.slice(0, 60) || 'Outcome'}
                </span>
                <span className={`${domainColor(o.domain)} rounded px-1 py-0.5 text-xs`}>{o.domain.replace(/_/g, ' ')}</span>
                <span className="text-text-quaternary">{formatTimeAgo(o.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB: INTELLIGENCE — Weekly report
// ============================================================================

function IntelligenceTab() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWeeklyReport().then(r => {
      setReport(r);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <div className="text-xs text-text-tertiary animate-pulse py-4">Generating weekly intelligence report...</div>;
  }

  if (!report) {
    return <div className="text-xs text-text-tertiary italic py-4">Could not generate report. Start using the engine to collect data.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border border-brand-primary/30 bg-brand-primary/5 p-3">
        <h3 className="text-sm font-semibold text-brand-primary mb-1">Weekly Intelligence Report</h3>
        <p className="text-xs text-text-tertiary">{formatDate(report.periodStart)} - {formatDate(report.periodEnd)}</p>
        <p className="text-sm text-text-primary mt-2 leading-relaxed">{report.summary}</p>
      </div>

      {/* Prediction Comparison */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Predictions: This Week vs Last Week</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-text-tertiary mb-1">This Week</div>
            <div className="text-lg font-bold text-text-primary">{report.predictions.thisWeek.accuracy !== null ? `${report.predictions.thisWeek.accuracy}%` : 'N/A'}</div>
            <div className="text-xs text-text-quaternary">{report.predictions.thisWeek.total} predictions, {report.predictions.thisWeek.correct + report.predictions.thisWeek.wrong + report.predictions.thisWeek.partial} resolved</div>
          </div>
          <div>
            <div className="text-xs text-text-tertiary mb-1">Last Week</div>
            <div className="text-lg font-bold text-text-primary">{report.predictions.lastWeek.accuracy !== null ? `${report.predictions.lastWeek.accuracy}%` : 'N/A'}</div>
            <div className="text-xs text-text-quaternary">{report.predictions.lastWeek.total} predictions, {report.predictions.lastWeek.correct + report.predictions.lastWeek.wrong + report.predictions.lastWeek.partial} resolved</div>
          </div>
        </div>
        {report.predictions.accuracyDelta !== null && (
          <div className={`mt-2 text-sm font-medium ${report.predictions.accuracyDelta > 0 ? 'text-green-400' : report.predictions.accuracyDelta < 0 ? 'text-red-400' : 'text-text-tertiary'}`}>
            {report.predictions.accuracyDelta > 0 ? '+' : ''}{report.predictions.accuracyDelta}% week-over-week
          </div>
        )}
      </div>

      {/* Top Correct / Wrong */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
          <h4 className="text-xs font-semibold text-green-400 mb-2">Top Correct</h4>
          {report.topCorrect.length > 0 ? report.topCorrect.map((p, i) => (
            <div key={i} className="text-xs text-text-tertiary mb-1 truncate">"{p.text.slice(0, 50)}..."</div>
          )) : <div className="text-xs text-text-quaternary italic">None this week</div>}
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <h4 className="text-xs font-semibold text-red-400 mb-2">Biggest Misses</h4>
          {report.topWrong.length > 0 ? report.topWrong.map((p, i) => (
            <div key={i} className="text-xs text-text-tertiary mb-1 truncate">"{p.text.slice(0, 50)}..."</div>
          )) : <div className="text-xs text-text-quaternary italic">None this week</div>}
        </div>
      </div>

      {/* Gene Activity */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Gene Activity</h3>
        <div className="flex gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-text-primary">{report.genes.newThisWeek.length}</div>
            <div className="text-xs text-text-tertiary">New</div>
          </div>
          <div>
            <div className="text-lg font-bold text-green-400">{report.genes.activated}</div>
            <div className="text-xs text-text-tertiary">Activated</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-400">{report.genes.goneDormant}</div>
            <div className="text-xs text-text-tertiary">Dormant</div>
          </div>
          <div>
            <div className="text-lg font-bold text-text-primary">{report.genes.totalActive}</div>
            <div className="text-xs text-text-tertiary">Total Active</div>
          </div>
        </div>
        {report.genes.newThisWeek.length > 0 && (
          <div className="mt-2 space-y-1">
            {report.genes.newThisWeek.map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-xs">
                <span className={`rounded px-1 py-0.5 ${domainColor(g.domain)}`}>{g.domain.replace(/_/g, ' ')}</span>
                <span className="text-text-tertiary truncate">{g.text.slice(0, 60)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Domain Drift */}
      {report.domainDrift.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Domain Drift</h3>
          <div className="space-y-1.5">
            {report.domainDrift.map((d) => (
              <div key={d.domain} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${domainColor(d.domain)}`}>{d.domain.replace(/_/g, ' ')}</span>
                <div className="flex-1" />
                {d.drift !== null ? (
                  <span className={`text-xs font-medium ${d.drift > 0 ? 'text-green-400' : d.drift < 0 ? 'text-red-400' : 'text-text-tertiary'}`}>
                    {d.drift > 0 ? '+' : ''}{d.drift}%
                  </span>
                ) : (
                  <span className="text-xs text-text-quaternary">N/A</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calibration Shift */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">Calibration Quality</h3>
        <div className="space-y-1">
          {report.calibrationShift.map((b) => (
            <div key={b.bucket} className="flex items-center gap-2 text-xs">
              <span className="text-text-tertiary w-14">{b.range}</span>
              <span className="text-text-secondary">actual {b.actual}%</span>
              <span className="text-text-quaternary">vs expected {b.expected}%</span>
              <span className={`font-medium ${b.delta > 5 ? 'text-green-400' : b.delta < -5 ? 'text-red-400' : 'text-text-tertiary'}`}>
                ({b.delta > 0 ? '+' : ''}{b.delta})
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TAB: EXPORT — Snapshot & rollback
// ============================================================================

function ExportTab() {
  const [snapshot, setSnapshot] = useState<ConsequenceSnapshot | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ genes: number; domains: number } | null>(null);
  const [runningLifecycle, setRunningLifecycle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    const snap = await exportSnapshot();
    if (snap) {
      setSnapshot(snap);
      // Trigger download
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `alin-consequence-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
    setExporting(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ConsequenceSnapshot;
      if (!parsed.data) throw new Error('Invalid snapshot format');
      const result = await importSnapshot(parsed.data, { clearExisting: false, importGenes: true, importDomainStates: true });
      setImportResult(result);
    } catch (err) {
      setImportResult(null);
      alert('Failed to import: ' + (err as Error).message);
    }
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLifecycle = async () => {
    setRunningLifecycle(true);
    await runLifecycle();
    setRunningLifecycle(false);
  };

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Export Snapshot</h3>
        <p className="text-xs text-text-tertiary mb-3">
          Download the current state of the genome, calibration data, domain states, and all predictions as JSON.
          Use this as a backup or to version-control the brain.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="rounded bg-brand-primary/20 px-3 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary/30 disabled:opacity-50"
        >
          {exporting ? 'Exporting...' : 'Export Full Snapshot'}
        </button>
        {snapshot && (
          <div className="mt-2 text-xs text-text-quaternary">
            Exported: {snapshot.stats.totalGenes} genes, {snapshot.stats.totalPredictions} predictions,
            {snapshot.stats.domainsTracked} domains ({formatDate(snapshot.exportedAt)})
          </div>
        )}
      </div>

      {/* Import */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Import / Rollback</h3>
        <p className="text-xs text-text-tertiary mb-3">
          Restore from a previous snapshot. Imported genes will be set to "pending review" for safety.
          Existing data is preserved unless you explicitly clear it.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="rounded bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/30 disabled:opacity-50"
        >
          {importing ? 'Importing...' : 'Import Snapshot'}
        </button>
        {importResult && (
          <div className="mt-2 text-xs text-green-400">
            Imported: {importResult.genes} genes, {importResult.domains} domain states
          </div>
        )}
      </div>

      {/* Manual Lifecycle */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Run Lifecycle Maintenance</h3>
        <p className="text-xs text-text-tertiary mb-3">
          Expire old predictions, prune weak genes, decay domain states, auto-activate confirmed genes.
          Normally runs automatically every 4-6 hours.
        </p>
        <button
          onClick={handleLifecycle}
          disabled={runningLifecycle}
          className="rounded bg-background-tertiary px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-background-hover disabled:opacity-50"
        >
          {runningLifecycle ? 'Running...' : 'Run Now'}
        </button>
      </div>
    </div>
  );
}
