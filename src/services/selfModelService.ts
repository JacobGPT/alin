/**
 * Self-Model Service — ALIN's model of its own behavior
 *
 * Tracks execution outcomes, tool reliability, user corrections,
 * decision logs, and thinking traces. Generates a dynamic system
 * prompt addendum from accumulated patterns.
 *
 * Tables (SQLite backend):
 *   execution_outcomes  — per-TBWO completion metrics
 *   tool_reliability    — per-tool success/failure stats
 *   user_corrections    — before/after user overrides
 *   decision_log        — auto-accept decisions with reasoning
 *   thinking_traces     — Claude extended thinking blocks
 *   memory_layers       — 8-layer memory with layer-specific TTL
 */

import * as db from '../api/dbService';

const API = '';

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutionOutcome {
  id?: string;
  tbwoId: string;
  objective: string;
  type: string;
  timeBudget: number;
  planConfidence: number;
  phasesCompleted: number;
  phasesFailed: number;
  artifactsCount: number;
  userEditsAfter: number;
  qualityScore: number;
  timestamp: number;
}

export interface ToolReliability {
  toolName: string;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  commonErrors: string[];
  lastFailureReason: string;
}

export interface UserCorrection {
  id?: string;
  originalValue: string;
  correctedValue: string;
  category: string;
  correctionCount: number;
  lastCorrected: number;
}

export interface DecisionLogEntry {
  id?: string;
  tbwoId: string;
  decisionType: string;
  optionsConsidered: string[];
  chosenOption: string;
  reasoning: string;
  outcome: string;
  confidence: number;
  timestamp: number;
}

export interface ThinkingTrace {
  id?: string;
  conversationId: string;
  messageId: string;
  tbwoId?: string;
  thinkingContent: string;
  timestamp: number;
}

export interface MemoryLayerEntry {
  id: string;
  layer: number; // 0-7
  content: string;
  category: string;
  salience: number;
  expiresAt: number | null; // null = permanent
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// REST CLIENT — fire-and-forget writes to backend
// ============================================================================

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Self-model API ${path} → ${res.status}`);
  return res.json();
}

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Self-model API ${path} → ${res.status}`);
  return res.json();
}

// ============================================================================
// EXECUTION OUTCOMES
// ============================================================================

export async function recordOutcome(outcome: ExecutionOutcome): Promise<void> {
  await post('/api/self-model/outcomes', outcome).catch(e =>
    console.warn('[SelfModel] Failed to record outcome:', e.message)
  );
}

export async function getOutcomes(limit = 50): Promise<ExecutionOutcome[]> {
  try {
    const r = await get(`/api/self-model/outcomes?limit=${limit}`) as { outcomes: ExecutionOutcome[] };
    return r.outcomes || [];
  } catch { return []; }
}

export async function getOutcomesByType(type: string): Promise<ExecutionOutcome[]> {
  try {
    const r = await get(`/api/self-model/outcomes?type=${encodeURIComponent(type)}`) as { outcomes: ExecutionOutcome[] };
    return r.outcomes || [];
  } catch { return []; }
}

// ============================================================================
// TOOL RELIABILITY
// ============================================================================

export async function recordToolUse(
  toolName: string,
  success: boolean,
  duration: number,
  errorReason?: string
): Promise<void> {
  await post('/api/self-model/tool-reliability', {
    toolName, success, duration, errorReason,
  }).catch(e =>
    console.warn('[SelfModel] Failed to record tool use:', e.message)
  );
}

export async function getToolReliability(): Promise<ToolReliability[]> {
  try {
    const r = await get('/api/self-model/tool-reliability') as { tools: ToolReliability[] };
    return r.tools || [];
  } catch { return []; }
}

// ============================================================================
// USER CORRECTIONS
// ============================================================================

export async function recordCorrection(
  originalValue: string,
  correctedValue: string,
  category: string
): Promise<void> {
  await post('/api/self-model/corrections', {
    originalValue, correctedValue, category,
  }).catch(e =>
    console.warn('[SelfModel] Failed to record correction:', e.message)
  );
}

export async function getCorrections(minCount = 1): Promise<UserCorrection[]> {
  try {
    const r = await get(`/api/self-model/corrections?minCount=${minCount}`) as { corrections: UserCorrection[] };
    return r.corrections || [];
  } catch { return []; }
}

/** Get corrections with 3+ occurrences — these are established patterns */
export async function getEstablishedPatterns(): Promise<UserCorrection[]> {
  return getCorrections(3);
}

// ============================================================================
// DECISION LOG
// ============================================================================

export async function recordDecision(entry: Omit<DecisionLogEntry, 'id' | 'timestamp'>): Promise<void> {
  await post('/api/self-model/decisions', {
    ...entry,
    timestamp: Date.now(),
  }).catch(e =>
    console.warn('[SelfModel] Failed to record decision:', e.message)
  );
}

export async function getDecisions(tbwoId?: string, limit = 50): Promise<DecisionLogEntry[]> {
  try {
    const params = tbwoId ? `?tbwoId=${encodeURIComponent(tbwoId)}&limit=${limit}` : `?limit=${limit}`;
    const r = await get(`/api/self-model/decisions${params}`) as { decisions: DecisionLogEntry[] };
    return r.decisions || [];
  } catch { return []; }
}

// ============================================================================
// THINKING TRACES
// ============================================================================

export async function storeThinkingTrace(trace: Omit<ThinkingTrace, 'id'>): Promise<void> {
  await post('/api/self-model/thinking-traces', trace).catch(e =>
    console.warn('[SelfModel] Failed to store thinking trace:', e.message)
  );
}

export async function searchThinkingTraces(query: string, limit = 10): Promise<ThinkingTrace[]> {
  try {
    const r = await get(`/api/self-model/thinking-traces?q=${encodeURIComponent(query)}&limit=${limit}`) as { traces: ThinkingTrace[] };
    return r.traces || [];
  } catch { return []; }
}

export async function getThinkingTraces(conversationId: string): Promise<ThinkingTrace[]> {
  try {
    const r = await get(`/api/self-model/thinking-traces?conversationId=${encodeURIComponent(conversationId)}`) as { traces: ThinkingTrace[] };
    return r.traces || [];
  } catch { return []; }
}

// ============================================================================
// 8-LAYER MEMORY — SQLite-backed per-layer storage
// ============================================================================

const LAYER_NAMES = [
  'immediate',    // 0 — in-memory, session-scoped
  'short_term',   // 1 — auto-expires after 24h
  'working',      // 2 — persists until project closes
  'episodic',     // 3 — permanent, timestamped experiences
  'semantic',     // 4 — permanent, factual knowledge
  'relational',   // 5 — user model + preference graph
  'notes',        // 6 — user-created explicit memories
  'self_model',   // 7 — ALIN's model of its own behavior
] as const;

export type LayerName = typeof LAYER_NAMES[number];

export async function storeLayerMemory(
  layer: number,
  content: string,
  category: string,
  salience: number = 0.5,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const layerName = LAYER_NAMES[layer] || 'short_term';
  // Layer 1: 24h TTL, Layer 2: session TTL (set to 7 days), Layers 3+: permanent
  const expiresAt = layer === 1 ? Date.now() + 24 * 60 * 60 * 1000
    : layer === 2 ? Date.now() + 7 * 24 * 60 * 60 * 1000
    : null;

  await post('/api/self-model/layer-memory', {
    layer: layerName,
    content,
    category,
    salience,
    expiresAt,
    metadata,
  }).catch(e =>
    console.warn(`[SelfModel] Failed to store layer-${layer} memory:`, e.message)
  );
}

export async function getLayerMemories(layer: number | string, limit = 50): Promise<MemoryLayerEntry[]> {
  try {
    const layerName = typeof layer === 'number' ? (LAYER_NAMES[layer] || 'short_term') : layer;
    const r = await get(`/api/self-model/layer-memory?layer=${encodeURIComponent(layerName)}&limit=${limit}`) as { memories: MemoryLayerEntry[] };
    return r.memories || [];
  } catch { return []; }
}

export async function pruneExpiredMemories(): Promise<number> {
  try {
    const r = await post('/api/self-model/layer-memory/prune', {}) as { pruned: number };
    return r.pruned || 0;
  } catch { return 0; }
}

// ============================================================================
// DYNAMIC SYSTEM PROMPT ADDENDUM
// ============================================================================

let _cachedAddendum: string | null = null;
let _addendumBuiltAt = 0;
const ADDENDUM_TTL = 5 * 60 * 1000; // Rebuild every 5 minutes max

/**
 * Build the dynamic system prompt addendum from self-model data.
 * Cached for 5 minutes. Force rebuild by passing `force=true`.
 */
export async function buildAddendum(force = false): Promise<string> {
  if (!force && _cachedAddendum && Date.now() - _addendumBuiltAt < ADDENDUM_TTL) {
    return _cachedAddendum;
  }

  try {
    const available = await db.isBackendAvailable();
    if (!available) return _cachedAddendum || '';

    const [corrections, outcomes, tools, decisions, selfModelMemories] = await Promise.all([
      getEstablishedPatterns(),
      getOutcomes(20),
      getToolReliability(),
      getDecisions(undefined, 20),
      getLayerMemories('self_model', 30),
    ]);

    const parts: string[] = [];

    // Section 1: User preferences from corrections
    if (corrections.length > 0) {
      parts.push('\n## What I\'ve Learned About This User');
      for (const c of corrections.slice(0, 10)) {
        parts.push(`- ${c.category}: prefers "${c.correctedValue}" over "${c.originalValue}" (corrected ${c.correctionCount} times)`);
      }
    }

    // Section 2: Performance patterns from outcomes
    if (outcomes.length > 0) {
      parts.push('\n## What I\'ve Learned About My Own Performance');

      // Group by type and compute average quality
      const byType = new Map<string, { count: number; avgQuality: number; totalPhases: number; failedPhases: number }>();
      for (const o of outcomes) {
        const existing = byType.get(o.type) || { count: 0, avgQuality: 0, totalPhases: 0, failedPhases: 0 };
        existing.count++;
        existing.avgQuality = (existing.avgQuality * (existing.count - 1) + o.qualityScore) / existing.count;
        existing.totalPhases += o.phasesCompleted;
        existing.failedPhases += o.phasesFailed;
        byType.set(o.type, existing);
      }
      for (const [type, stats] of byType) {
        const successRate = stats.totalPhases > 0
          ? Math.round(((stats.totalPhases - stats.failedPhases) / stats.totalPhases) * 100)
          : 0;
        parts.push(`- ${type}: ${stats.count} completed, avg quality ${stats.avgQuality.toFixed(1)}/10, phase success rate ${successRate}%`);
      }

      // Check for user edits pattern
      const editHeavy = outcomes.filter(o => o.userEditsAfter > 3);
      if (editHeavy.length > outcomes.length * 0.3) {
        parts.push(`- WARNING: ${Math.round((editHeavy.length / outcomes.length) * 100)}% of TBWOs required significant user edits — increase quality/thoroughness`);
      }
    }

    // Section 3: Tool reliability insights
    if (tools.length > 0) {
      const unreliable = tools.filter(t => t.failureCount > 0 && t.failureCount / (t.successCount + t.failureCount) > 0.1);
      if (unreliable.length > 0) {
        for (const t of unreliable.slice(0, 5)) {
          const failRate = Math.round((t.failureCount / (t.successCount + t.failureCount)) * 100);
          parts.push(`- ${t.toolName} tool fails ${failRate}% of the time${t.lastFailureReason ? ` — last error: ${t.lastFailureReason.slice(0, 100)}` : ''}`);
        }
      }
    }

    // Section 4: Recent decisions
    if (decisions.length > 0) {
      parts.push('\n## Recent Decisions');
      // Group similar decisions
      const recentDecisions = decisions.slice(0, 10);
      for (const d of recentDecisions) {
        const outcomeNote = d.outcome ? ` → ${d.outcome}` : '';
        parts.push(`- [${d.decisionType}] Chose "${d.chosenOption}" (confidence: ${Math.round(d.confidence * 100)}%)${outcomeNote}`);
      }
    }

    // Section 5: Self-model memories (layer 7)
    if (selfModelMemories.length > 0) {
      parts.push('\n## Self-Model Insights');
      for (const m of selfModelMemories.slice(0, 10)) {
        parts.push(`- ${m.content}`);
      }
    }

    _cachedAddendum = parts.length > 0 ? parts.join('\n') : '';
    _addendumBuiltAt = Date.now();
    return _cachedAddendum;
  } catch (e) {
    console.warn('[SelfModel] Failed to build addendum:', e);
    return _cachedAddendum || '';
  }
}

/** Force rebuild of the addendum (e.g. after TBWO completion or correction learning) */
export function invalidateAddendum(): void {
  _cachedAddendum = null;
  _addendumBuiltAt = 0;
}

// ============================================================================
// CORRECTION LEARNING — detect patterns and promote to self-model
// ============================================================================

/**
 * Check if a correction category has reached the threshold (3+)
 * and if so, store a self-model memory about the pattern.
 */
export async function checkAndPromoteCorrections(): Promise<void> {
  try {
    const patterns = await getEstablishedPatterns();
    const existing = await getLayerMemories('self_model', 100);
    const existingContents = new Set(existing.map(m => m.content));

    for (const p of patterns) {
      const insight = `User prefers "${p.correctedValue}" over "${p.originalValue}" for ${p.category} (corrected ${p.correctionCount} times)`;
      if (!existingContents.has(insight)) {
        await storeLayerMemory(7, insight, p.category, 0.9);
        console.log(`[SelfModel] Promoted correction pattern to self-model: ${insight}`);
      }
    }

    // Rebuild addendum after promoting
    invalidateAddendum();
  } catch (e) {
    console.warn('[SelfModel] checkAndPromoteCorrections failed:', e);
  }
}

// ============================================================================
// WIRING HELPERS — called from other parts of the system
// ============================================================================

/**
 * Called after TBWO completion. Records execution outcome + promotes corrections.
 */
export async function onTBWOComplete(
  tbwoId: string,
  objective: string,
  type: string,
  timeBudget: number,
  phasesCompleted: number,
  phasesFailed: number,
  artifactsCount: number,
  qualityScore: number,
): Promise<void> {
  await recordOutcome({
    tbwoId,
    objective,
    type,
    timeBudget,
    planConfidence: 0,
    phasesCompleted,
    phasesFailed,
    artifactsCount,
    userEditsAfter: 0,
    qualityScore,
    timestamp: Date.now(),
  });

  // Also store as a self-model memory
  await storeLayerMemory(7,
    `Completed ${type} TBWO "${objective.slice(0, 60)}": ${phasesCompleted} phases, ${artifactsCount} artifacts, quality ${qualityScore}/10`,
    'execution_history',
    0.7,
  );

  // Check if any correction patterns should be promoted
  await checkAndPromoteCorrections();

  // Rebuild addendum
  invalidateAddendum();
}

/**
 * Called after every tool call in the execution engine.
 */
export async function onToolCall(
  toolName: string,
  success: boolean,
  duration: number,
  errorReason?: string,
): Promise<void> {
  await recordToolUse(toolName, success, duration, errorReason);
}

/**
 * Called when a user edits ALIN's output or overrides a decision.
 */
export async function onUserCorrection(
  originalValue: string,
  correctedValue: string,
  category: string,
): Promise<void> {
  await recordCorrection(originalValue, correctedValue, category);
  await checkAndPromoteCorrections();
}

/**
 * Called when a pod auto-answers a clarification.
 */
export async function onAutoDecision(
  tbwoId: string,
  decisionType: string,
  options: string[],
  chosen: string,
  reasoning: string,
  confidence: number,
): Promise<void> {
  await recordDecision({
    tbwoId,
    decisionType,
    optionsConsidered: options,
    chosenOption: chosen,
    reasoning,
    outcome: '', // filled in later if tracked
    confidence,
  });
}

/**
 * Called when a thinking block is received from Claude.
 */
export async function onThinkingBlock(
  conversationId: string,
  messageId: string,
  thinkingContent: string,
  tbwoId?: string,
): Promise<void> {
  await storeThinkingTrace({
    conversationId,
    messageId,
    tbwoId,
    thinkingContent,
    timestamp: Date.now(),
  });
}
