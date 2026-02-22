/**
 * Proactive Intelligence — Client Service
 *
 * REST client for the 4-subsystem background intelligence layer.
 * Private-only: all endpoints return 404 on public ALIN.
 *
 * Also provides buildProactiveAddendum() for system prompt injection (max 400 chars).
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ProactiveStatus {
  enabled: boolean;
  jobCount: number;
  lastCollectionTimes: Record<string, number>;
  alertCount: number;
  schedulerActive: boolean;
}

export interface ProductMetric {
  id: string;
  metric_type: string;
  value: number;
  metadata: string;
  recorded_at: number;
  user_id: string;
}

export interface ProductAlert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  metric_type: string | null;
  metric_value: number | null;
  threshold_value: number | null;
  acknowledged: number;
  created_at: number;
  user_id: string;
}

export interface UserRhythmEntry {
  id: string;
  rhythm_type: string;
  value: string;
  day_of_week: number;
  hour_of_day: number;
  recorded_at: number;
  user_id: string;
}

export interface SelfAwarenessEntry {
  id: string;
  awareness_type: string;
  severity: string;
  summary: string;
  details: string;
  related_domain: string | null;
  recorded_at: number;
  user_id: string;
}

export interface SchedulerJob {
  id: string;
  name: string;
  description: string;
  interval_ms: number;
  handler: string;
  enabled: number;
  last_run_at: number;
  next_run_at: number;
  run_count: number;
  error_count: number;
  last_error: string;
  created_at: number;
  user_id: string;
}

export interface SchedulerHistoryEntry {
  id: string;
  job_id: string;
  job_name: string;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  status: string;
  result: string;
  error: string;
  user_id: string;
}

export interface RhythmPreference {
  value: string;
  count: number;
}

export interface AwarenessSummary {
  severityCounts: { severity: string; count: number }[];
  recentCritical: SelfAwarenessEntry[];
  recentWarning: SelfAwarenessEntry[];
}

// ============================================================================
// REST CLIENT
// ============================================================================

const API = '';

function getAuthHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem('alin-auth-storage');
    if (raw) {
      const parsed = JSON.parse(raw);
      const token = parsed?.state?.token;
      if (token) return { Authorization: `Bearer ${token}` };
    }
  } catch {}
  return {};
}

// After the first 404 we know the proactive routes aren't registered (public mode).
// Stop all subsequent requests to avoid console 404 spam.
let _unavailable = false;

async function get<T>(path: string): Promise<T> {
  if (_unavailable) throw new Error('Proactive API unavailable');
  const res = await fetch(`${API}${path}`, { headers: getAuthHeaders() });
  if (res.status === 404) { _unavailable = true; }
  if (!res.ok) throw new Error(`Proactive API ${path} -> ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown = {}): Promise<T> {
  if (_unavailable) throw new Error('Proactive API unavailable');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 404) { _unavailable = true; }
  if (!res.ok) throw new Error(`Proactive API ${path} -> ${res.status}`);
  return res.json();
}

// ── Status ──
export async function getStatus(): Promise<ProactiveStatus> {
  return get<ProactiveStatus>('/api/proactive/status');
}

// ── Metrics ──
export async function getMetrics(type = 'error_rate', since?: number, limit = 100): Promise<ProductMetric[]> {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (since) params.set('since', String(since));
  const r = await get<{ metrics: ProductMetric[] }>(`/api/proactive/metrics?${params}`);
  return r.metrics || [];
}

export async function getLatestMetrics(): Promise<ProductMetric[]> {
  const r = await get<{ metrics: ProductMetric[] }>('/api/proactive/metrics/latest');
  return r.metrics || [];
}

// ── Alerts ──
export async function getAlerts(acknowledged?: boolean): Promise<ProductAlert[]> {
  const params = new URLSearchParams();
  if (acknowledged !== undefined) params.set('acknowledged', acknowledged ? '1' : '0');
  const r = await get<{ alerts: ProductAlert[] }>(`/api/proactive/alerts?${params}`);
  return r.alerts || [];
}

export async function acknowledgeAlert(id: string): Promise<void> {
  await post(`/api/proactive/alerts/${id}/ack`);
}

export async function acknowledgeAllAlerts(): Promise<void> {
  await post('/api/proactive/alerts/ack-all');
}

// ── Rhythm ──
export async function getRhythmData(type = 'activity', limit = 100): Promise<UserRhythmEntry[]> {
  const r = await get<{ rhythm: UserRhythmEntry[] }>(`/api/proactive/rhythm?type=${type}&limit=${limit}`);
  return r.rhythm || [];
}

export async function getRhythmHeatmap(type = 'activity', since?: number): Promise<{ heatmap: number[][]; raw: unknown[] }> {
  const params = new URLSearchParams({ type });
  if (since) params.set('since', String(since));
  return get(`/api/proactive/rhythm/heatmap?${params}`);
}

export async function getRhythmPreferences(type = 'mode_usage', since?: number, limit = 10): Promise<RhythmPreference[]> {
  const params = new URLSearchParams({ type, limit: String(limit) });
  if (since) params.set('since', String(since));
  const r = await get<{ preferences: RhythmPreference[] }>(`/api/proactive/rhythm/preferences?${params}`);
  return r.preferences || [];
}

// ── Awareness ──
export async function getAwareness(type?: string, limit = 50): Promise<SelfAwarenessEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (type) params.set('type', type);
  const r = await get<{ entries: SelfAwarenessEntry[] }>(`/api/proactive/awareness?${params}`);
  return r.entries || [];
}

export async function getAwarenessSummary(since?: number): Promise<AwarenessSummary> {
  const params = new URLSearchParams();
  if (since) params.set('since', String(since));
  return get(`/api/proactive/awareness/summary?${params}`);
}

// ── Scheduler ──
export async function getSchedulerJobs(): Promise<SchedulerJob[]> {
  const r = await get<{ jobs: SchedulerJob[] }>('/api/proactive/scheduler');
  return r.jobs || [];
}

export async function toggleJob(id: string): Promise<{ ok: boolean; enabled: boolean }> {
  return post(`/api/proactive/scheduler/${id}/toggle`);
}

export async function triggerJob(id: string): Promise<{ ok: boolean; result: unknown; duration: number }> {
  return post(`/api/proactive/scheduler/${id}/run`);
}

export async function getJobHistory(id: string, limit = 20): Promise<SchedulerHistoryEntry[]> {
  const r = await get<{ history: SchedulerHistoryEntry[] }>(`/api/proactive/scheduler/${id}/history?limit=${limit}`);
  return r.history || [];
}

// ============================================================================
// ADDENDUM BUILDER — max 400 chars for system prompt
// ============================================================================

let _cachedAddendum: string | null = null;
let _addendumBuiltAt = 0;
const ADDENDUM_TTL = 5 * 60 * 1000;

export async function buildProactiveAddendum(): Promise<string> {
  if (_cachedAddendum !== null && Date.now() - _addendumBuiltAt < ADDENDUM_TTL) {
    return _cachedAddendum;
  }

  try {
    const [latestMetrics, alerts, summary] = await Promise.all([
      getLatestMetrics().catch(() => []),
      getAlerts(false).catch(() => []),
      getAwarenessSummary().catch(() => ({ severityCounts: [], recentCritical: [], recentWarning: [] })),
    ]);

    if (latestMetrics.length === 0 && alerts.length === 0) {
      _cachedAddendum = '';
      _addendumBuiltAt = Date.now();
      return '';
    }

    const parts: string[] = ['## Proactive Intelligence'];

    // Product line
    const errorRate = latestMetrics.find(m => m.metric_type === 'error_rate');
    const toolSuccess = latestMetrics.find(m => m.metric_type === 'tool_success_rate');
    if (errorRate || toolSuccess) {
      const er = errorRate ? `error_rate=${Math.round(errorRate.value * 100)}%` : '';
      const ts = toolSuccess ? `tool_success=${Math.round(toolSuccess.value * 100)}%` : '';
      parts.push(`Product: ${[er, ts].filter(Boolean).join(', ')}`);
    }

    // Awareness summary
    const critCount = summary.severityCounts.find(s => s.severity === 'critical')?.count || 0;
    const warnCount = summary.severityCounts.find(s => s.severity === 'warning')?.count || 0;
    if (critCount > 0 || warnCount > 0) {
      parts.push(`Self: ${critCount} critical, ${warnCount} warnings (7d)`);
    } else {
      parts.push('Self: stable, no critical alerts');
    }

    // Unack alerts
    if (alerts.length > 0) {
      const alertSummary = alerts.slice(0, 2).map(a => a.title).join('; ');
      parts.push(`Alerts: ${alerts.length} unack (${alertSummary})`);
    }

    let addendum = parts.join('\n');
    if (addendum.length > 400) addendum = addendum.slice(0, 397) + '...';

    _cachedAddendum = addendum;
    _addendumBuiltAt = Date.now();
    return addendum;
  } catch {
    _cachedAddendum = '';
    _addendumBuiltAt = Date.now();
    return '';
  }
}

export function invalidateProactiveAddendum(): void {
  _cachedAddendum = null;
  _addendumBuiltAt = 0;
}
