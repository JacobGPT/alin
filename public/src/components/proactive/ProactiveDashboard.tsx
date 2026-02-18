/**
 * ProactiveDashboard — 4-Tab Background Intelligence Panel
 *
 * Tabs: Product Vitals | Your Rhythm | Self-Awareness | Scheduler
 *
 * Private-only: gated by /api/proactive/status availability.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  type ProactiveStatus,
  type ProductMetric,
  type ProductAlert,
  type SelfAwarenessEntry,
  type SchedulerJob,
  type SchedulerHistoryEntry,
  type RhythmPreference,
  type AwarenessSummary,
  getStatus,
  getLatestMetrics,
  getMetrics,
  getAlerts,
  acknowledgeAlert,
  acknowledgeAllAlerts,
  getRhythmHeatmap,
  getRhythmPreferences,
  getAwareness,
  getAwarenessSummary,
  getSchedulerJobs,
  toggleJob,
  triggerJob,
  getJobHistory,
} from '../../services/proactiveIntelligenceService';

// ============================================================================
// TYPES
// ============================================================================

type TabId = 'vitals' | 'rhythm' | 'awareness' | 'scheduler';

const TABS: { id: TabId; label: string }[] = [
  { id: 'vitals', label: 'Product Vitals' },
  { id: 'rhythm', label: 'Your Rhythm' },
  { id: 'awareness', label: 'Self-Awareness' },
  { id: 'scheduler', label: 'Scheduler' },
];

// ============================================================================
// HELPERS
// ============================================================================

function formatTimeAgo(ts: number): string {
  if (!ts || ts <= 0) return 'never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function humanInterval(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function severityColor(sev: string): string {
  switch (sev) {
    case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'warning': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'info': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function metricColor(type: string, value: number): string {
  if (type === 'error_rate') {
    if (value < 0.1) return 'text-green-400';
    if (value < 0.3) return 'text-amber-400';
    return 'text-red-400';
  }
  if (type === 'tool_success_rate') {
    if (value >= 0.9) return 'text-green-400';
    if (value >= 0.7) return 'text-amber-400';
    return 'text-red-400';
  }
  return 'text-blue-400';
}

function metricLabel(type: string): string {
  switch (type) {
    case 'error_rate': return 'Error Rate';
    case 'tool_success_rate': return 'Tool Success';
    case 'conversation_count': return 'Conversations (1h)';
    default: return type;
  }
}

function metricDisplay(type: string, value: number): string {
  if (type === 'conversation_count') return String(Math.round(value));
  return `${Math.round(value * 100)}%`;
}

// ============================================================================
// MINI LINE CHART (pure CSS/div-based)
// ============================================================================

function MiniLineChart({ data, height = 40, color = 'bg-brand-primary' }: {
  data: number[];
  height?: number;
  color?: string;
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 0.01);
  return (
    <div className="flex items-end gap-px" style={{ height }}>
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm ${color} opacity-70`}
          style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
          title={`${Math.round(v * 100)}%`}
        />
      ))}
    </div>
  );
}

// ============================================================================
// TAB 1: PRODUCT VITALS
// ============================================================================

function ProductVitalsTab() {
  const [latestMetrics, setLatestMetrics] = useState<ProductMetric[]>([]);
  const [alerts, setAlerts] = useState<ProductAlert[]>([]);
  const [errorTrend, setErrorTrend] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, a, trend] = await Promise.all([
        getLatestMetrics().catch(() => []),
        getAlerts(false).catch(() => []),
        getMetrics('error_rate', Date.now() - 24 * 60 * 60 * 1000, 48).catch(() => []),
      ]);
      setLatestMetrics(m);
      setAlerts(a);
      setErrorTrend(trend.reverse().map(t => t.value));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAck = async (id: string) => {
    await acknowledgeAlert(id).catch(() => {});
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handleAckAll = async () => {
    await acknowledgeAllAlerts().catch(() => {});
    setAlerts([]);
  };

  if (loading) return <div className="p-4 text-sm text-text-tertiary">Loading metrics...</div>;

  return (
    <div className="space-y-4 p-3">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 gap-3">
        {['error_rate', 'tool_success_rate', 'conversation_count'].map(type => {
          const metric = latestMetrics.find(m => m.metric_type === type);
          const value = metric?.value ?? 0;
          return (
            <div key={type} className="rounded-lg border border-border-primary bg-background-primary p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-tertiary uppercase tracking-wider">{metricLabel(type)}</span>
                {metric && <span className="text-xs text-text-quaternary">{formatTimeAgo(metric.recorded_at)}</span>}
              </div>
              <div className={`mt-1 text-2xl font-bold ${metricColor(type, value)}`}>
                {metric ? metricDisplay(type, value) : '--'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Error rate 24h trend */}
      {errorTrend.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-background-primary p-3">
          <span className="text-xs text-text-tertiary uppercase tracking-wider">Error Rate (24h)</span>
          <div className="mt-2">
            <MiniLineChart data={errorTrend} height={40} color="bg-red-400" />
          </div>
        </div>
      )}

      {/* Alerts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-tertiary uppercase tracking-wider">
            Unacknowledged Alerts ({alerts.length})
          </span>
          {alerts.length > 0 && (
            <button
              onClick={handleAckAll}
              className="text-xs text-brand-primary hover:underline"
            >
              Ack All
            </button>
          )}
        </div>
        {alerts.length === 0 ? (
          <div className="text-xs text-text-quaternary py-2">No active alerts</div>
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 10).map(alert => (
              <div key={alert.id} className={`rounded border px-3 py-2 ${severityColor(alert.severity)}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase">{alert.severity}</span>
                    <span className="text-sm">{alert.title}</span>
                  </div>
                  <button
                    onClick={() => handleAck(alert.id)}
                    className="text-xs opacity-60 hover:opacity-100"
                  >
                    Ack
                  </button>
                </div>
                {alert.description && <p className="text-xs mt-1 opacity-80">{alert.description}</p>}
                <span className="text-xs opacity-50">{formatTimeAgo(alert.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TAB 2: YOUR RHYTHM
// ============================================================================

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function YourRhythmTab() {
  const [heatmap, setHeatmap] = useState<number[][]>([]);
  const [preferences, setPreferences] = useState<RhythmPreference[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [hm, prefs] = await Promise.all([
          getRhythmHeatmap().catch(() => ({ heatmap: [], raw: [] })),
          getRhythmPreferences().catch(() => []),
        ]);
        setHeatmap(hm.heatmap || []);
        setPreferences(prefs);
      } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-4 text-sm text-text-tertiary">Loading rhythm data...</div>;

  const maxCount = Math.max(1, ...heatmap.flat());

  // Find peak hours
  let peakDay = 0, peakHour = 0, peakVal = 0;
  heatmap.forEach((day, di) => {
    day.forEach((val, hi) => {
      if (val > peakVal) { peakVal = val; peakDay = di; peakHour = hi; }
    });
  });

  return (
    <div className="space-y-4 p-3">
      {/* Activity Heatmap */}
      <div className="rounded-lg border border-border-primary bg-background-primary p-3">
        <span className="text-xs text-text-tertiary uppercase tracking-wider">Activity Heatmap (30d)</span>
        {heatmap.length === 0 ? (
          <div className="text-xs text-text-quaternary py-4 text-center">No activity data yet</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            {/* Hour labels */}
            <div className="flex ml-8">
              {Array.from({ length: 24 }, (_, i) => (
                <div key={i} className="flex-1 text-center text-[9px] text-text-quaternary">
                  {i % 4 === 0 ? `${i}` : ''}
                </div>
              ))}
            </div>
            {/* Grid */}
            {heatmap.map((dayData, dayIdx) => (
              <div key={dayIdx} className="flex items-center gap-1">
                <span className="w-7 text-[10px] text-text-quaternary text-right">{DAY_LABELS[dayIdx]}</span>
                <div className="flex flex-1 gap-px">
                  {dayData.map((count, hourIdx) => {
                    const intensity = count / maxCount;
                    const bg = count === 0
                      ? 'bg-background-tertiary'
                      : intensity < 0.33
                        ? 'bg-brand-primary/20'
                        : intensity < 0.66
                          ? 'bg-brand-primary/50'
                          : 'bg-brand-primary/80';
                    return (
                      <div
                        key={hourIdx}
                        className={`flex-1 aspect-square rounded-sm ${bg}`}
                        title={`${DAY_LABELS[dayIdx]} ${hourIdx}:00 — ${count} events`}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {peakVal > 0 && (
          <div className="mt-2 text-xs text-text-secondary">
            Peak: {DAY_LABELS[peakDay]} at {peakHour}:00 ({peakVal} events)
          </div>
        )}
      </div>

      {/* Mode Preferences */}
      <div className="rounded-lg border border-border-primary bg-background-primary p-3">
        <span className="text-xs text-text-tertiary uppercase tracking-wider">Mode Preferences (30d)</span>
        {preferences.length === 0 ? (
          <div className="text-xs text-text-quaternary py-2">No mode data yet</div>
        ) : (
          <div className="mt-2 space-y-1.5">
            {(() => {
              const maxPref = Math.max(1, ...preferences.map(p => p.count));
              return preferences.map(pref => (
                <div key={pref.value} className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary w-16 truncate">{pref.value}</span>
                  <div className="flex-1 h-4 bg-background-tertiary rounded overflow-hidden">
                    <div
                      className="h-full bg-brand-primary/60 rounded"
                      style={{ width: `${(pref.count / maxPref) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-text-quaternary w-8 text-right">{pref.count}</span>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TAB 3: SELF-AWARENESS
// ============================================================================

function SelfAwarenessTab() {
  const [summary, setSummary] = useState<AwarenessSummary | null>(null);
  const [entries, setEntries] = useState<SelfAwarenessEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, e] = await Promise.all([
          getAwarenessSummary().catch(() => null),
          getAwareness(undefined, 30).catch(() => []),
        ]);
        setSummary(s);
        setEntries(e);
      } catch {}
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-4 text-sm text-text-tertiary">Loading awareness data...</div>;

  const infoCount = summary?.severityCounts.find(s => s.severity === 'info')?.count || 0;
  const warnCount = summary?.severityCounts.find(s => s.severity === 'warning')?.count || 0;
  const critCount = summary?.severityCounts.find(s => s.severity === 'critical')?.count || 0;

  // Group entries by type
  const grouped = entries.reduce((acc, e) => {
    if (!acc[e.awareness_type]) acc[e.awareness_type] = [];
    acc[e.awareness_type].push(e);
    return acc;
  }, {} as Record<string, SelfAwarenessEntry[]>);

  return (
    <div className="space-y-4 p-3">
      {/* Severity Cards */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Info', count: infoCount, color: 'text-blue-400' },
          { label: 'Warning', count: warnCount, color: 'text-amber-400' },
          { label: 'Critical', count: critCount, color: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-border-primary bg-background-primary p-2 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.count}</div>
            <div className="text-[10px] text-text-tertiary uppercase">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Entries grouped by type */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-xs text-text-quaternary py-4 text-center">No self-awareness entries yet</div>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([type, typeEntries]) => (
            <div key={type}>
              <div className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-1">
                {type.replace(/_/g, ' ')}
              </div>
              <div className="space-y-1">
                {typeEntries.slice(0, 5).map(entry => (
                  <div
                    key={entry.id}
                    className={`rounded border px-2.5 py-1.5 text-xs ${severityColor(entry.severity)}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span>{entry.summary}</span>
                      <span className="text-[10px] opacity-50 whitespace-nowrap">{formatTimeAgo(entry.recorded_at)}</span>
                    </div>
                    {entry.related_domain && (
                      <span className="text-[10px] opacity-60 mt-0.5 inline-block">Domain: {entry.related_domain}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TAB 4: SCHEDULER
// ============================================================================

function SchedulerTab() {
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [history, setHistory] = useState<SchedulerHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const j = await getSchedulerJobs().catch(() => []);
      setJobs(j);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const handleToggle = async (id: string) => {
    await toggleJob(id).catch(() => {});
    loadJobs();
  };

  const handleTrigger = async (id: string) => {
    setTriggering(id);
    await triggerJob(id).catch(() => {});
    setTriggering(null);
    loadJobs();
  };

  const handleExpand = async (id: string) => {
    if (expandedJob === id) {
      setExpandedJob(null);
      return;
    }
    setExpandedJob(id);
    const h = await getJobHistory(id, 10).catch(() => []);
    setHistory(h);
  };

  if (loading) return <div className="p-4 text-sm text-text-tertiary">Loading scheduler...</div>;

  return (
    <div className="space-y-2 p-3">
      <div className="text-xs text-text-quaternary mb-2">
        Scheduler active, checking every 30s
      </div>

      {jobs.map(job => (
        <div key={job.id} className="rounded-lg border border-border-primary bg-background-primary overflow-hidden">
          {/* Job row */}
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Toggle */}
            <button
              onClick={() => handleToggle(job.id)}
              className={`w-8 h-4 rounded-full relative transition-colors ${job.enabled ? 'bg-green-500/60' : 'bg-gray-600'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${job.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>

            {/* Info */}
            <button
              onClick={() => handleExpand(job.id)}
              className="flex-1 text-left min-w-0"
            >
              <div className="text-xs font-medium text-text-primary truncate">
                {job.name.replace(/_/g, ' ')}
              </div>
              <div className="text-[10px] text-text-quaternary flex gap-2">
                <span>every {humanInterval(job.interval_ms)}</span>
                <span>{job.run_count} runs</span>
                {job.error_count > 0 && <span className="text-red-400">{job.error_count} errors</span>}
                {job.last_run_at > 0 && <span>last: {formatTimeAgo(job.last_run_at)}</span>}
              </div>
            </button>

            {/* Run Now */}
            <button
              onClick={() => handleTrigger(job.id)}
              disabled={triggering === job.id}
              className="text-[10px] px-2 py-0.5 rounded border border-border-primary text-text-secondary hover:text-text-primary hover:bg-background-hover transition-colors disabled:opacity-50"
            >
              {triggering === job.id ? '...' : 'Run'}
            </button>
          </div>

          {/* Expanded history */}
          {expandedJob === job.id && (
            <div className="border-t border-border-primary px-3 py-2 bg-background-secondary">
              <div className="text-[10px] text-text-tertiary uppercase tracking-wider mb-1">Recent Runs</div>
              {history.length === 0 ? (
                <div className="text-[10px] text-text-quaternary">No run history yet</div>
              ) : (
                <div className="space-y-1">
                  {history.slice(0, 10).map(h => (
                    <div key={h.id} className="flex items-center gap-2 text-[10px]">
                      <span className={`px-1 rounded ${h.status === 'completed' ? 'bg-green-500/20 text-green-400' : h.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                        {h.status}
                      </span>
                      {h.duration_ms != null && <span className="text-text-quaternary">{h.duration_ms}ms</span>}
                      <span className="text-text-quaternary">{formatTimeAgo(h.started_at)}</span>
                      {h.error && <span className="text-red-400 truncate">{h.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// MAIN DASHBOARD
// ============================================================================

export function ProactiveDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('vitals');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ProactiveStatus | null>(null);

  useEffect(() => {
    getStatus()
      .then(s => { setStatus(s); setAvailable(true); })
      .catch(() => setAvailable(false));
  }, []);

  if (available === null) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-sm text-text-tertiary">Checking proactive intelligence...</div>
      </div>
    );
  }

  if (available === false) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-sm text-text-tertiary">Proactive Intelligence is not available.</div>
          <div className="text-xs text-text-quaternary mt-1">Only available in private mode.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-primary bg-background-tertiary/30">
        <div className={`w-2 h-2 rounded-full ${status?.enabled ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-[10px] text-text-quaternary">
          {status?.jobCount || 0} jobs | {status?.alertCount || 0} alerts
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-primary bg-background-secondary">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-2 py-2 text-[10px] font-medium uppercase tracking-wider transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'vitals' && <ProductVitalsTab />}
        {activeTab === 'rhythm' && <YourRhythmTab />}
        {activeTab === 'awareness' && <SelfAwarenessTab />}
        {activeTab === 'scheduler' && <SchedulerTab />}
      </div>
    </div>
  );
}
