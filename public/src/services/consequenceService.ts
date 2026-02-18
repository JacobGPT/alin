/**
 * Consequence Engine — Client Service
 *
 * 5-Layer Neural Architecture for self-learning consequence tracking.
 *
 * Layer 1: Prediction Cortex      — extract predictions from AI responses
 * Layer 2: Outcome Cortex         — verify predictions against reality
 * Layer 3: Emotional Weightmap    — domain pain/satisfaction tracking
 * Layer 4: Pattern Cortex         — cross-outcome intelligence, calibration
 * Layer 5: Behavioral Genome      — adaptive rules that evolve (genes)
 *
 * PUBLIC mode: Engine NEVER surfaces internal state to users.
 *   - Addendum is prefixed with "do not reference in responses"
 *   - No confidence scores, domain moods, or self-reflection in output
 *   - Public just quietly gets better
 *
 * PRIVATE mode: Full transparency — dashboards, genome, calibration.
 *
 * All writes are fire-and-forget. Failures never block the chat flow.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ConsequenceConfig {
  isPrivate: boolean;
  bootstrapActive: boolean;
  bootstrapUntil: number;
  domains: string[];
  predictionPatternCount: number;
  domainKeywordCoverage: Record<string, number>;
}

export interface Prediction {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  prediction_text: string;
  prediction_type: string;
  domain: string;
  confidence: number;
  context_summary: string;
  source_model: string;
  extraction_method: string;
  status: string;
  outcome_id: string | null;
  verification_attempts: number;
  expires_at: number | null;
  created_at: number;
  resolved_at: number | null;
  user_id: string;
}

export interface Outcome {
  id: string;
  prediction_id: string | null;
  trigger_type: string;
  trigger_source: string;
  trigger_data: string;
  result: string;
  confidence_delta: number;
  pain_delta: number;
  satisfaction_delta: number;
  lesson_learned: string;
  corrective_action: string;
  domain: string;
  severity: string;
  cascade_effects: string;
  created_at: number;
  user_id: string;
}

export interface DomainState {
  domain: string;
  user_id: string;
  pain_score: number;
  satisfaction_score: number;
  prediction_accuracy: number;
  calibration_offset: number;
  total_predictions: number;
  correct_predictions: number;
  wrong_predictions: number;
  partial_predictions: number;
  streak_type: string;
  streak_count: number;
  best_streak: number;
  worst_streak: number;
  last_pain_event: string;
  last_satisfaction_event: string;
  last_outcome_at: number | null;
  decay_rate: number;
  volatility: number;
  trend: string;
  updated_at: number;
}

export interface DomainHistoryEntry {
  id: string;
  domain: string;
  pain_score: number;
  satisfaction_score: number;
  prediction_accuracy: number;
  event_type: string;
  event_summary: string;
  snapshot_at: number;
}

export interface ConsequencePattern {
  id: string;
  domain: string;
  pattern_type: string;
  pattern_signature: string;
  description: string;
  frequency: number;
  confidence: number;
  first_seen_at: number;
  last_seen_at: number;
  contributing_outcomes: string;
  suggested_gene: string;
  status: string;
}

export interface BehavioralGene {
  id: string;
  gene_text: string;
  gene_type: string;
  domain: string;
  source_pattern: string;
  source_pattern_id: string | null;
  trigger_condition: string;
  action_directive: string;
  strength: number;
  status: string;
  confirmations: number;
  contradictions: number;
  applications: number;
  last_applied_at: number | null;
  requires_review: number;
  review_notes: string;
  regression_risk: string;
  parent_gene_id: string | null;
  mutation_history: string;
  created_at: number;
  updated_at: number;
}

export interface GeneAuditEntry {
  id: string;
  gene_id: string;
  action: string;
  previous_state: string;
  new_state: string;
  reason: string;
  actor: string;
  created_at: number;
}

export interface CalibrationBucket {
  bucket: number;
  range: string;
  total: number;
  correct: number;
  actualAccuracy: number;
  expectedAccuracy: number;
  overconfidenceDelta: number;
}

export interface DashboardDomainState {
  domain: string;
  accuracy: number;
  pain: number;
  satisfaction: number;
  calibrationOffset: number;
  total: number;
  correct: number;
  wrong: number;
  partial: number;
  streak: { type: string; count: number };
  bestStreak: number;
  worstStreak: number;
  volatility: number;
  trend: string;
}

export interface DomainTrend {
  domain: string;
  recentAccuracy: number | null;
  allTimeAccuracy: number | null;
  recentTotal: number;
  allTotal: number;
}

export interface ConsequenceDashboard {
  summary: {
    totalPredictions: number;
    totalOutcomes: number;
    totalGenes: number;
    domainsTracked: number;
    bootstrapActive: boolean;
    isPrivate: boolean;
  };
  statusCounts: Record<string, number>;
  calibrationCurve: CalibrationBucket[];
  domainStates: DashboardDomainState[];
  predictionsByDomain: Array<{ domain: string; total: number; correct: number; wrong: number; partial: number }>;
  domainTrends: DomainTrend[];
  outcomesByResult: Record<string, number>;
  // Private-only fields
  genesByDomain?: Array<{ domain: string; count: number }>;
  activeGenesByDomain?: Array<{ domain: string; count: number }>;
  pendingReviewGenes?: BehavioralGene[];
  geneEffectiveness?: Array<{ id: string; gene_text: string; domain: string; strength: number; confirmations: number; contradictions: number; effectiveness: number }>;
  regressionAlerts?: Array<{ geneId: string; geneText: string; domain: string; effectiveness: number; contradictions: number; confirmations: number }>;
  recentOutcomes?: Array<Outcome & { prediction_text?: string; pred_confidence?: number; pred_domain?: string; prediction_type?: string }>;
  emergingPatterns?: ConsequencePattern[];
  // Public-only fields
  activeGeneCount?: number;
  pendingReviewCount?: number;
  regressionAlertCount?: number;
}

// ============================================================================
// REST CLIENT — fire-and-forget writes, auth-aware
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

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ConsequenceEngine API ${path} → ${res.status}`);
  return res.json();
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`ConsequenceEngine API ${path} → ${res.status}`);
  return res.json();
}

async function del(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error(`ConsequenceEngine API ${path} → ${res.status}`);
  return res.json();
}

// ============================================================================
// CONFIGURATION (cached)
// ============================================================================

let _configCache: ConsequenceConfig | null = null;
let _configFetchedAt = 0;
const CONFIG_TTL = 10 * 60 * 1000; // 10 minutes

export async function getConfig(): Promise<ConsequenceConfig> {
  if (_configCache && Date.now() - _configFetchedAt < CONFIG_TTL) {
    return _configCache;
  }
  try {
    const r = await get('/api/consequence/config') as { config: ConsequenceConfig };
    _configCache = r.config;
    _configFetchedAt = Date.now();
    return _configCache;
  } catch {
    return _configCache || {
      isPrivate: false,
      bootstrapActive: true,
      bootstrapUntil: Date.now() + 30 * 24 * 60 * 60 * 1000,
      domains: ['general'],
      predictionPatternCount: 0,
      domainKeywordCoverage: {},
    };
  }
}

export function isBootstrapActive(config: ConsequenceConfig): boolean {
  return !config.isPrivate && config.bootstrapUntil > Date.now();
}

export function invalidateConfigCache(): void {
  _configCache = null;
  _configFetchedAt = 0;
}

// ============================================================================
// LAYER 1: PREDICTION CORTEX — client-side extraction
// ============================================================================

const PREDICTION_PATTERNS = [
  { regex: /(?:this (?:will|should|would|is going to))\s+(.{20,200}?)(?:\.|,|$)/gi, type: 'implicit', conf: 0.5 },
  { regex: /(?:I (?:predict|expect|anticipate|believe|think) (?:that )?)\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'explicit', conf: 0.7 },
  { regex: /(?:the (?:result|outcome|output|effect) (?:will|should) (?:be |likely )?)\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'outcome', conf: 0.6 },
  { regex: /(?:this approach (?:will|should|would))\s+(.{20,200}?)(?:\.|,|$)/gi, type: 'approach', conf: 0.55 },
  { regex: /(?:(?:likely|probably|almost certainly|I'm confident) )\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'hedged', conf: 0.4 },
  { regex: /(?:the (?:best|optimal|right|correct) (?:approach|solution|answer|way) (?:is|would be) )\s*(.{20,200}?)(?:\.|,|$)/gi, type: 'prescriptive', conf: 0.65 },
  { regex: /(?:this (?:should|will) (?:take|require) (?:about |approximately |around )?)\s*(.{10,100}?)(?:\.|,|$)/gi, type: 'time_estimate', conf: 0.45 },
  { regex: /(?:the (?:error|issue|bug|problem) is (?:likely |probably )?(?:caused by |due to |because of )?)\s*(.{15,200}?)(?:\.|,|$)/gi, type: 'diagnosis', conf: 0.6 },
];

function extractPredictionsFromText(text: string): Array<{ text: string; type: string; confidence: number }> {
  if (!text || text.length < 50) return [];
  const predictions: Array<{ text: string; type: string; confidence: number }> = [];
  const seen = new Set<string>();

  for (const pattern of PREDICTION_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    while ((match = regex.exec(text)) !== null) {
      const predText = match[1]?.trim();
      if (!predText || predText.length < 15 || seen.has(predText.toLowerCase())) continue;
      seen.add(predText.toLowerCase());
      predictions.push({
        text: predText.slice(0, 300),
        type: pattern.type,
        confidence: pattern.conf,
      });
    }
  }

  return predictions.slice(0, 8);
}

/**
 * Extract predictions from assistant text and record them (fire-and-forget).
 * Called from apiService.ts onComplete callback.
 */
export async function extractAndRecordPredictions(
  text: string,
  conversationId?: string,
  messageId?: string,
  sourceModel?: string,
): Promise<void> {
  try {
    const predictions = extractPredictionsFromText(text);
    if (predictions.length === 0) return;

    await post('/api/consequence/predictions/batch', {
      predictions,
      conversationId,
      messageId,
      sourceModel,
    });
  } catch (e) {
    console.warn('[ConsequenceEngine] extractAndRecordPredictions failed:', (e as Error).message);
  }
}

/**
 * Record a single prediction explicitly.
 */
export async function recordPrediction(
  predictionText: string,
  options: {
    conversationId?: string;
    messageId?: string;
    predictionType?: string;
    domain?: string;
    confidence?: number;
    contextSummary?: string;
    sourceModel?: string;
  } = {},
): Promise<{ id: string; domain: string } | null> {
  try {
    const r = await post('/api/consequence/predictions', {
      predictionText,
      ...options,
    }) as { prediction: { id: string; domain: string } };
    return r.prediction;
  } catch (e) {
    console.warn('[ConsequenceEngine] recordPrediction failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// LAYER 2: OUTCOME CORTEX — resolve predictions
// ============================================================================

/**
 * Resolve the most recent pending prediction for a conversation.
 * Fire-and-forget — failures never block the chat flow.
 */
export async function resolveRecentPrediction(
  conversationId: string,
  result: 'correct' | 'wrong' | 'partial',
  triggerType: string,
  triggerSource?: string,
): Promise<void> {
  try {
    await post('/api/consequence/predictions/resolve-recent', {
      conversationId,
      result,
      triggerType,
      triggerSource,
    });
  } catch (e) {
    console.warn('[ConsequenceEngine] resolveRecentPrediction failed:', (e as Error).message);
  }
}

/**
 * Resolve a specific prediction by ID.
 */
export async function resolvePrediction(
  predictionId: string,
  result: 'correct' | 'wrong' | 'partial',
  triggerType: string,
  options: {
    triggerSource?: string;
    triggerData?: unknown;
    lessonLearned?: string;
    correctiveAction?: string;
    severity?: string;
  } = {},
): Promise<void> {
  try {
    await post(`/api/consequence/predictions/${predictionId}/resolve`, {
      result,
      triggerType,
      ...options,
    });
  } catch (e) {
    console.warn('[ConsequenceEngine] resolvePrediction failed:', (e as Error).message);
  }
}

/**
 * Record a standalone outcome (not tied to a specific prediction).
 */
export async function recordOutcome(
  triggerType: string,
  result: 'correct' | 'wrong' | 'partial',
  options: {
    predictionId?: string;
    triggerSource?: string;
    triggerData?: unknown;
    lessonLearned?: string;
    correctiveAction?: string;
    domain?: string;
    severity?: string;
  } = {},
): Promise<void> {
  try {
    await post('/api/consequence/outcomes', {
      triggerType,
      result,
      ...options,
    });
  } catch (e) {
    console.warn('[ConsequenceEngine] recordOutcome failed:', (e as Error).message);
  }
}

// ============================================================================
// LAYER 3: EMOTIONAL WEIGHTMAP — domain queries
// ============================================================================

export async function getDomainStates(sortBy?: 'pain' | 'accuracy'): Promise<DomainState[]> {
  try {
    const params = sortBy ? `?sortBy=${sortBy}` : '';
    const r = await get(`/api/consequence/domains${params}`) as { domains: DomainState[] };
    return r.domains || [];
  } catch { return []; }
}

export async function getDomainState(domain: string): Promise<{ domain: DomainState | null; history: DomainHistoryEntry[] }> {
  try {
    const r = await get(`/api/consequence/domains/${encodeURIComponent(domain)}`) as {
      domain: DomainState | null;
      history: DomainHistoryEntry[];
    };
    return r;
  } catch { return { domain: null, history: [] }; }
}

export async function getDomainHistory(domain: string, sinceDays = 30): Promise<DomainHistoryEntry[]> {
  try {
    const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const r = await get(`/api/consequence/domains/${encodeURIComponent(domain)}/history?since=${since}`) as {
      history: DomainHistoryEntry[];
    };
    return r.history || [];
  } catch { return []; }
}

// ============================================================================
// LAYER 4: PATTERN CORTEX
// ============================================================================

export async function getPatterns(options?: { domain?: string; type?: string; status?: string; limit?: number }): Promise<ConsequencePattern[]> {
  try {
    const params = new URLSearchParams();
    if (options?.domain) params.set('domain', options.domain);
    if (options?.type) params.set('type', options.type);
    if (options?.status) params.set('status', options.status);
    if (options?.limit) params.set('limit', String(options.limit));
    const r = await get(`/api/consequence/patterns?${params}`) as { patterns: ConsequencePattern[] };
    return r.patterns || [];
  } catch { return []; }
}

export async function getCalibration(domain = 'all'): Promise<{ snapshots: unknown[]; latest: unknown[] }> {
  try {
    const r = await get(`/api/consequence/calibration?domain=${encodeURIComponent(domain)}`) as {
      snapshots: unknown[];
      latest: unknown[];
    };
    return r;
  } catch { return { snapshots: [], latest: [] }; }
}

// ============================================================================
// LAYER 5: BEHAVIORAL GENOME
// ============================================================================

export async function getGenes(options?: {
  domain?: string;
  status?: string;
  type?: string;
  minStrength?: number;
  limit?: number;
}): Promise<BehavioralGene[]> {
  try {
    const params = new URLSearchParams();
    if (options?.domain) params.set('domain', options.domain);
    if (options?.status) params.set('status', options.status);
    if (options?.type) params.set('type', options.type);
    if (options?.minStrength) params.set('minStrength', String(options.minStrength));
    if (options?.limit) params.set('limit', String(options.limit));
    const r = await get(`/api/consequence/genes?${params}`) as { genes: BehavioralGene[] };
    return r.genes || [];
  } catch { return []; }
}

export async function getGene(id: string): Promise<{ gene: BehavioralGene | null; auditLog: GeneAuditEntry[] }> {
  try {
    const r = await get(`/api/consequence/genes/${id}`) as {
      gene: BehavioralGene | null;
      auditLog: GeneAuditEntry[];
    };
    return r;
  } catch { return { gene: null, auditLog: [] }; }
}

export async function createGene(
  geneText: string,
  options?: {
    geneType?: string;
    domain?: string;
    sourcePattern?: string;
    triggerCondition?: string;
    actionDirective?: string;
    strength?: number;
    regressionRisk?: string;
  },
): Promise<BehavioralGene | null> {
  try {
    const r = await post('/api/consequence/genes', { geneText, ...options }) as { gene: BehavioralGene };
    return r.gene;
  } catch (e) {
    console.warn('[ConsequenceEngine] createGene failed:', (e as Error).message);
    return null;
  }
}

export async function confirmGene(id: string, reason?: string): Promise<void> {
  try { await post(`/api/consequence/genes/${id}/confirm`, { reason }); }
  catch (e) { console.warn('[ConsequenceEngine] confirmGene failed:', (e as Error).message); }
}

export async function contradictGene(id: string, reason?: string): Promise<void> {
  try { await post(`/api/consequence/genes/${id}/contradict`, { reason }); }
  catch (e) { console.warn('[ConsequenceEngine] contradictGene failed:', (e as Error).message); }
}

export async function approveGene(id: string, reviewNotes?: string): Promise<void> {
  try { await post(`/api/consequence/genes/${id}/approve`, { reviewNotes }); }
  catch (e) { console.warn('[ConsequenceEngine] approveGene failed:', (e as Error).message); }
}

export async function mutateGene(id: string, newGeneText: string, options?: {
  newTriggerCondition?: string;
  newActionDirective?: string;
  reason?: string;
}): Promise<void> {
  try { await post(`/api/consequence/genes/${id}/mutate`, { newGeneText, ...options }); }
  catch (e) { console.warn('[ConsequenceEngine] mutateGene failed:', (e as Error).message); }
}

export async function deleteGene(id: string, reason?: string): Promise<void> {
  try { await del(`/api/consequence/genes/${id}`); }
  catch (e) { console.warn('[ConsequenceEngine] deleteGene failed:', (e as Error).message); }
}

export async function getGeneAudit(geneId: string, limit = 50): Promise<GeneAuditEntry[]> {
  try {
    const r = await get(`/api/consequence/genes/${geneId}/audit?limit=${limit}`) as { auditLog: GeneAuditEntry[] };
    return r.auditLog || [];
  } catch { return []; }
}

export async function getRecentAudits(limit = 50): Promise<GeneAuditEntry[]> {
  try {
    const r = await get(`/api/consequence/audit?limit=${limit}`) as { auditLog: GeneAuditEntry[] };
    return r.auditLog || [];
  } catch { return []; }
}

// ============================================================================
// DASHBOARD
// ============================================================================

export async function getDashboard(): Promise<ConsequenceDashboard | null> {
  try {
    const r = await get('/api/consequence/dashboard') as { dashboard: ConsequenceDashboard };
    return r.dashboard;
  } catch (e) {
    console.warn('[ConsequenceEngine] getDashboard failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// LIFECYCLE
// ============================================================================

export async function runLifecycle(): Promise<unknown> {
  try {
    const r = await post('/api/consequence/lifecycle', {});
    return r;
  } catch (e) {
    console.warn('[ConsequenceEngine] runLifecycle failed:', (e as Error).message);
    return null;
  }
}

export async function createCalibrationSnapshot(domain = 'all'): Promise<void> {
  try { await post('/api/consequence/calibration/snapshot', { domain }); }
  catch (e) { console.warn('[ConsequenceEngine] calibration snapshot failed:', (e as Error).message); }
}

// ============================================================================
// PREDICTION QUERIES
// ============================================================================

export async function getPredictions(options?: {
  status?: string;
  domain?: string;
  conversationId?: string;
  type?: string;
  limit?: number;
}): Promise<Prediction[]> {
  try {
    const params = new URLSearchParams();
    if (options?.status) params.set('status', options.status);
    if (options?.domain) params.set('domain', options.domain);
    if (options?.conversationId) params.set('conversationId', options.conversationId);
    if (options?.type) params.set('type', options.type);
    if (options?.limit) params.set('limit', String(options.limit));
    const r = await get(`/api/consequence/predictions?${params}`) as { predictions: Prediction[] };
    return r.predictions || [];
  } catch { return []; }
}

export async function getOutcomes(options?: {
  domain?: string;
  triggerType?: string;
  severity?: string;
  limit?: number;
}): Promise<Outcome[]> {
  try {
    const params = new URLSearchParams();
    if (options?.domain) params.set('domain', options.domain);
    if (options?.triggerType) params.set('triggerType', options.triggerType);
    if (options?.severity) params.set('severity', options.severity);
    if (options?.limit) params.set('limit', String(options.limit));
    const r = await get(`/api/consequence/outcomes?${params}`) as { outcomes: Outcome[] };
    return r.outcomes || [];
  } catch { return []; }
}

// ============================================================================
// KILL SWITCH
// ============================================================================

export async function getKillSwitch(): Promise<{ active: boolean; effect: string }> {
  try {
    const r = await get('/api/consequence/kill-switch') as { active: boolean; effect: string };
    return r;
  } catch { return { active: false, effect: '' }; }
}

export async function setKillSwitch(active: boolean): Promise<{ active: boolean; message: string }> {
  try {
    const r = await post('/api/consequence/kill-switch', { active }) as { active: boolean; message: string };
    invalidateAddendum();
    invalidateConfigCache();
    return r;
  } catch (e) {
    console.warn('[ConsequenceEngine] setKillSwitch failed:', (e as Error).message);
    return { active: false, message: 'Failed to toggle kill switch' };
  }
}

// ============================================================================
// WEEKLY INTELLIGENCE REPORT
// ============================================================================

export interface WeeklyReport {
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  summary: string;
  predictions: {
    thisWeek: { total: number; correct: number; wrong: number; partial: number; accuracy: number | null };
    lastWeek: { total: number; correct: number; wrong: number; partial: number; accuracy: number | null };
    accuracyDelta: number | null;
  };
  topCorrect: Array<{ text: string; domain: string; confidence: number }>;
  topWrong: Array<{ text: string; domain: string; confidence: number }>;
  genes: {
    newThisWeek: Array<{ id: string; text: string; domain: string; strength: number; status: string }>;
    activated: number;
    goneDormant: number;
    totalActive: number;
  };
  domainDrift: Array<{
    domain: string;
    thisWeekAccuracy: number | null;
    lastWeekAccuracy: number | null;
    drift: number | null;
    thisWeekPredictions: number;
    lastWeekPredictions: number;
  }>;
  calibrationShift: Array<{
    bucket: number;
    range: string;
    total: number;
    correct: number;
    actual: number;
    expected: number;
    delta: number;
  }>;
}

export async function getWeeklyReport(): Promise<WeeklyReport | null> {
  try {
    const r = await get('/api/consequence/weekly-report') as { report: WeeklyReport };
    return r.report;
  } catch (e) {
    console.warn('[ConsequenceEngine] getWeeklyReport failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// PREDICTION ACCURACY TREND
// ============================================================================

export interface AccuracyTrendPoint {
  weekStart: number;
  weekEnd: number;
  weekLabel: string;
  total: number;
  resolved: number;
  correct: number;
  wrong: number;
  partial: number;
  accuracy: number | null;
}

export async function getAccuracyTrend(weeks = 12): Promise<{ trend: AccuracyTrendPoint[]; trendDirection: string }> {
  try {
    const r = await get(`/api/consequence/accuracy-trend?weeks=${weeks}`) as {
      trend: AccuracyTrendPoint[];
      trendDirection: string;
    };
    return r;
  } catch { return { trend: [], trendDirection: 'stable' }; }
}

// ============================================================================
// GENE A/B COMPARISON
// ============================================================================

export interface GeneComparison {
  gene: {
    id: string;
    text: string;
    type: string;
    domain: string;
    strength: number;
    status: string;
    triggerCondition: string;
    actionDirective: string;
    regressionRisk: string;
  };
  comparison: {
    before: {
      description: string;
      examples: Array<{ prediction: string; confidence: number; outcome: string; date: number }>;
      domainAccuracy: number | null;
      domainPain: number | null;
    };
    after: {
      description: string;
      examples: Array<{ originalPrediction: string; adjustedBehavior: string; likelyOutcome: string; confidenceReduction: number }>;
      estimatedAccuracyGain: number;
      estimatedPainReduction: number;
    };
  };
  recommendation: string;
  correctPredictionsInDomain: number;
  wrongPredictionsInDomain: number;
}

export async function getGeneComparison(geneId: string): Promise<GeneComparison | null> {
  try {
    const r = await get(`/api/consequence/genes/${geneId}/comparison`) as GeneComparison;
    return r;
  } catch (e) {
    console.warn('[ConsequenceEngine] getGeneComparison failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// EXPORT / IMPORT — snapshot & rollback
// ============================================================================

export interface ConsequenceSnapshot {
  version: number;
  exportedAt: number;
  config: { isPrivate: boolean; domains: string[] };
  data: {
    genes: BehavioralGene[];
    domainStates: DomainState[];
    patterns: ConsequencePattern[];
    calibration: unknown[];
    recentAudits: GeneAuditEntry[];
    predictions: Prediction[];
    outcomes: Outcome[];
  };
  stats: {
    totalGenes: number;
    activeGenes: number;
    pendingGenes: number;
    totalPredictions: number;
    totalOutcomes: number;
    domainsTracked: number;
  };
}

export async function exportSnapshot(): Promise<ConsequenceSnapshot | null> {
  try {
    const r = await get('/api/consequence/export') as ConsequenceSnapshot;
    return r;
  } catch (e) {
    console.warn('[ConsequenceEngine] exportSnapshot failed:', (e as Error).message);
    return null;
  }
}

export async function importSnapshot(
  data: ConsequenceSnapshot['data'],
  options?: { clearExisting?: boolean; importGenes?: boolean; importDomainStates?: boolean },
): Promise<{ genes: number; domains: number } | null> {
  try {
    const r = await post('/api/consequence/import', { data, options }) as { imported: { genes: number; domains: number } };
    invalidateAddendum();
    invalidateConfigCache();
    return r.imported;
  } catch (e) {
    console.warn('[ConsequenceEngine] importSnapshot failed:', (e as Error).message);
    return null;
  }
}

// ============================================================================
// SYSTEM PROMPT ADDENDUM BUILDER
// ============================================================================

let _addendumCache: string | null = null;
let _addendumBuiltAt = 0;
const ADDENDUM_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Build the consequence engine addendum for system prompt injection.
 *
 * PUBLIC (silent mode):
 *   Returns internal-only steering data prefixed with
 *   "do not reference in responses" — guides behavior silently.
 *
 * PRIVATE (transparent mode):
 *   Returns full intelligence report with domain dashboards,
 *   genome mutations, calibration curves, pain scores.
 */
export async function buildConsequenceAddendum(force = false): Promise<string> {
  if (!force && _addendumCache && Date.now() - _addendumBuiltAt < ADDENDUM_TTL) {
    return _addendumCache;
  }

  try {
    const config = await getConfig();
    const [domainStates, activeGenes] = await Promise.all([
      getDomainStates(),
      getGenes({ status: 'active', minStrength: 0.3, limit: 20 }),
    ]);

    // No data yet — return empty
    if (domainStates.length === 0 && activeGenes.length === 0) {
      _addendumCache = '';
      _addendumBuiltAt = Date.now();
      return '';
    }

    const parts: string[] = [];
    const maxChars = config.isPrivate ? 2500 : 1500;

    if (config.isPrivate) {
      // ══════════════════════════════════════════
      // PRIVATE MODE — Full Intelligence Report
      // ══════════════════════════════════════════
      parts.push('\n## Consequence Engine Intelligence Report');

      // Domain Confidence Map
      if (domainStates.length > 0) {
        parts.push('\n### Domain Confidence Map');
        for (const d of domainStates) {
          const accuracyPct = Math.round(d.prediction_accuracy * 100);
          const moodLabel = d.pain_score > 0.5 ? 'CAUTION: pain dominant'
            : d.satisfaction_score > 0.5 ? 'satisfaction dominant'
            : 'neutral';
          const trendEmoji = d.trend === 'improving' ? '(improving)'
            : d.trend === 'declining' ? '(declining)'
            : '(stable)';
          const streakNote = d.streak_count >= 3
            ? ` [${d.streak_type} streak: ${d.streak_count}]`
            : '';
          parts.push(`- ${d.domain}: ${accuracyPct}% accuracy — ${moodLabel} (pain: ${d.pain_score.toFixed(2)}, sat: ${d.satisfaction_score.toFixed(2)}) ${trendEmoji}${streakNote}`);
        }
      }

      // Active Behavioral Genome
      if (activeGenes.length > 0) {
        parts.push(`\n### Active Behavioral Genome (${activeGenes.length} genes)`);
        for (const g of activeGenes.slice(0, 12)) {
          const effectRate = (g.confirmations + g.contradictions) > 0
            ? Math.round((g.confirmations / (g.confirmations + g.contradictions)) * 100)
            : 50;
          parts.push(`- [${g.domain}] ${g.gene_text} (strength: ${g.strength.toFixed(2)}, ${g.confirmations} confirms, effectiveness: ${effectRate}%)`);
        }
      }

      // Pending Review
      try {
        const pendingGenes = await getGenes({ status: 'pending_review', limit: 5 });
        if (pendingGenes.length > 0) {
          parts.push(`\n### Pending Review (${pendingGenes.length} genes awaiting approval)`);
          for (const g of pendingGenes.slice(0, 5)) {
            parts.push(`- [${g.domain}] ${g.gene_text} (risk: ${g.regression_risk})`);
          }
        }
      } catch {}

      // Calibration Summary
      const overconfidentDomains = domainStates.filter(d => d.calibration_offset > 0.15);
      const underconfidentDomains = domainStates.filter(d => d.calibration_offset < -0.15);
      if (overconfidentDomains.length > 0 || underconfidentDomains.length > 0) {
        parts.push('\n### Calibration');
        for (const d of overconfidentDomains) {
          parts.push(`- Overconfident in ${d.domain}: predicted ${Math.round((d.prediction_accuracy + d.calibration_offset) * 100)}%, actual ${Math.round(d.prediction_accuracy * 100)}%`);
        }
        for (const d of underconfidentDomains) {
          parts.push(`- Underconfident in ${d.domain}: predicted ${Math.round((d.prediction_accuracy + d.calibration_offset) * 100)}%, actual ${Math.round(d.prediction_accuracy * 100)}%`);
        }
      }

      // Volatility Warnings
      const volatileDomains = domainStates.filter(d => d.volatility > 0.7);
      if (volatileDomains.length > 0) {
        parts.push('\n### Volatility Warnings');
        for (const d of volatileDomains) {
          parts.push(`- ${d.domain}: high volatility (${d.volatility.toFixed(2)}) — predictions inconsistent`);
        }
      }

    } else {
      // ══════════════════════════════════════════
      // PUBLIC MODE — Silent Internal Steering
      // ══════════════════════════════════════════
      parts.push('\n## Internal Consequence Data (do not reference in responses)');

      // Bootstrap notice
      if (config.bootstrapActive) {
        const daysLeft = Math.ceil((config.bootstrapUntil - Date.now()) / (24 * 60 * 60 * 1000));
        parts.push(`Bootstrap: observation-only for ${daysLeft} more days (tracking only, genes inactive)`);
      }

      // Domain confidence (compact format)
      if (domainStates.length > 0) {
        const domainLine = domainStates
          .map(d => `${d.domain}=${(d.prediction_accuracy * 100).toFixed(0)}%`)
          .join(', ');
        parts.push(`Domain confidence: ${domainLine}`);

        // Warn about high-pain domains
        const painDomains = domainStates.filter(d => d.pain_score > 0.4);
        if (painDomains.length > 0) {
          parts.push(`Caution domains (frequent errors): ${painDomains.map(d => d.domain).join(', ')}`);
        }
      }

      // Active behavioral rules (compact, imperative)
      if (activeGenes.length > 0 && !config.bootstrapActive) {
        parts.push('Active behavioral rules (apply silently):');
        for (const g of activeGenes.slice(0, 8)) {
          parts.push(`- ${g.gene_text} (strength: ${g.strength.toFixed(1)})`);
        }
      }
    }

    // Truncate to max chars
    let addendum = parts.join('\n');
    if (addendum.length > maxChars) {
      addendum = addendum.slice(0, maxChars - 3) + '...';
    }

    _addendumCache = addendum;
    _addendumBuiltAt = Date.now();
    return addendum;
  } catch (e) {
    console.warn('[ConsequenceEngine] buildConsequenceAddendum failed:', (e as Error).message);
    return _addendumCache || '';
  }
}

/** Force rebuild of the addendum cache */
export function invalidateAddendum(): void {
  _addendumCache = null;
  _addendumBuiltAt = 0;
}

// ============================================================================
// PERIODIC LIFECYCLE (auto-runs on interval)
// ============================================================================

let _lifecycleInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic lifecycle maintenance.
 * Runs every 6 hours (public) or 4 hours (private).
 */
export async function startPeriodicLifecycle(): Promise<void> {
  if (_lifecycleInterval) return;

  try {
    const config = await getConfig();
    const intervalMs = config.isPrivate
      ? 4 * 60 * 60 * 1000   // 4 hours for private
      : 6 * 60 * 60 * 1000;  // 6 hours for public

    _lifecycleInterval = setInterval(async () => {
      try {
        await runLifecycle();
        invalidateAddendum();
        console.log('[ConsequenceEngine] Periodic lifecycle completed');
      } catch (e) {
        console.warn('[ConsequenceEngine] Periodic lifecycle failed:', (e as Error).message);
      }
    }, intervalMs);

    // Run once immediately
    runLifecycle().catch(() => {});
  } catch {}
}

export function stopPeriodicLifecycle(): void {
  if (_lifecycleInterval) {
    clearInterval(_lifecycleInterval);
    _lifecycleInterval = null;
  }
}
