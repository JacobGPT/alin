/**
 * dbService.ts — Typed REST client for SQLite backend
 *
 * All methods use relative /api paths (routed through Vite proxy → localhost:3002).
 * Fire-and-forget writes: callers catch errors themselves.
 * Graceful degradation: isBackendAvailable() cached 30 s.
 */

// ============================================================================
// HEALTH CHECK
// ============================================================================

let _available: boolean | null = null;
let _availableCheckedAt = 0;
const HEALTH_TTL = 30_000; // 30 seconds

export async function isBackendAvailable(): Promise<boolean> {
  const now = Date.now();
  if (_available !== null && now - _availableCheckedAt < HEALTH_TTL) return _available;
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) });
    _available = r.ok;
  } catch {
    _available = false;
  }
  _availableCheckedAt = now;
  return _available;
}

/** Reset cached availability (e.g. after backend restart) */
export function resetAvailabilityCache(): void {
  _available = null;
  _availableCheckedAt = 0;
}

// ============================================================================
// GENERIC FETCH WRAPPER (with auth headers)
// ============================================================================

function getAuthHeaders(): Record<string, string> {
  try {
    // Dynamic import to avoid circular dependency at module load time
    const raw = localStorage.getItem('alin-auth-storage');
    if (raw) {
      const parsed = JSON.parse(raw);
      const token = parsed?.state?.token;
      if (token) return { Authorization: `Bearer ${token}` };
    }
  } catch {}
  return {};
}

async function apiCall<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${method} ${url} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ============================================================================
// DEBOUNCED WRITER UTILITY
// ============================================================================

export function createDebouncedWriter<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  delayMs: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn(...args).catch((e: unknown) => console.warn('[dbService] debounced write failed:', e));
      timer = null;
    }, delayMs);
  };
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

interface DbConversation {
  id: string;
  title: string;
  mode: string;
  model: string;
  provider: string;
  isFavorite: boolean;
  isArchived: boolean;
  isPinned: boolean;
  messageCount?: number;
  preview?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export async function listConversations(
  archived = 0,
  limit = 200,
  offset = 0,
): Promise<DbConversation[]> {
  const r = await apiCall<{ success: boolean; conversations: DbConversation[] }>(
    'GET',
    `/api/conversations?archived=${archived}&limit=${limit}&offset=${offset}`,
  );
  return r.conversations;
}

export async function getConversation(id: string) {
  return apiCall<{ success: boolean; conversation: DbConversation; messages: DbMessage[] }>(
    'GET',
    `/api/conversations/${id}`,
  );
}

export async function createConversation(data: {
  id: string;
  title?: string;
  mode?: string;
  model?: string;
  provider?: string;
}): Promise<void> {
  await apiCall('POST', '/api/conversations', data);
}

export async function updateConversation(
  id: string,
  data: Partial<{
    title: string;
    mode: string;
    model: string;
    provider: string;
    isFavorite: boolean;
    isArchived: boolean;
    isPinned: boolean;
    metadata: Record<string, unknown>;
  }>,
): Promise<void> {
  await apiCall('PATCH', `/api/conversations/${id}`, data);
}

export async function deleteConversation(id: string): Promise<void> {
  await apiCall('DELETE', `/api/conversations/${id}`);
}

// ============================================================================
// MESSAGES
// ============================================================================

interface DbMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: unknown;
  tokens_input: number;
  tokens_output: number;
  cost: number;
  model: string | null;
  isEdited: boolean;
  parent_id: string | null;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export async function createMessage(
  conversationId: string,
  data: {
    id: string;
    role: string;
    content: unknown;
    model?: string;
    tokensInput?: number;
    tokensOutput?: number;
    cost?: number;
    parentId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await apiCall('POST', `/api/conversations/${conversationId}/messages`, data);
}

export async function updateMessage(
  id: string,
  data: { content: unknown; metadata?: Record<string, unknown> },
): Promise<void> {
  await apiCall('PATCH', `/api/messages/${id}`, data);
}

export async function deleteMessage(id: string): Promise<void> {
  await apiCall('DELETE', `/api/messages/${id}`);
}

export async function getMessages(conversationId: string): Promise<DbMessage[]> {
  const r = await apiCall<{ success: boolean; conversation: DbConversation; messages: DbMessage[] }>(
    'GET',
    `/api/conversations/${conversationId}`,
  );
  return r.messages;
}

// ============================================================================
// SETTINGS
// ============================================================================

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const r = await apiCall<{ success: boolean; settings: Record<string, unknown> }>('GET', '/api/settings');
  return r.settings;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await apiCall('PUT', `/api/settings/${key}`, { value });
}

// ============================================================================
// TBWO ORDERS
// ============================================================================

interface DbTBWO {
  id: string;
  type: string;
  status: string;
  objective: string;
  [key: string]: unknown;
}

export async function listTBWOs(limit = 50, offset = 0): Promise<DbTBWO[]> {
  const r = await apiCall<{ success: boolean; tbwos: DbTBWO[] }>(
    'GET',
    `/api/tbwo?limit=${limit}&offset=${offset}`,
  );
  return r.tbwos;
}

export async function createTBWO(data: Record<string, unknown>): Promise<void> {
  await apiCall('POST', '/api/tbwo', data);
}

export async function getTBWO(id: string): Promise<DbTBWO> {
  const r = await apiCall<{ success: boolean; tbwo: DbTBWO }>('GET', `/api/tbwo/${id}`);
  return r.tbwo;
}

export async function updateTBWO(id: string, data: Record<string, unknown>): Promise<void> {
  await apiCall('PATCH', `/api/tbwo/${id}`, data);
}

export async function deleteTBWO(id: string): Promise<void> {
  await apiCall('DELETE', `/api/tbwo/${id}`);
}

// ============================================================================
// ARTIFACTS
// ============================================================================

interface DbArtifact {
  id: string;
  title: string;
  type: string;
  language?: string;
  content: string;
  editable: boolean;
  conversation_id?: string;
  tbwo_id?: string;
  metadata: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export async function listArtifacts(filters?: {
  conversationId?: string;
  tbwoId?: string;
  limit?: number;
}): Promise<DbArtifact[]> {
  const params = new URLSearchParams();
  if (filters?.conversationId) params.set('conversationId', filters.conversationId);
  if (filters?.tbwoId) params.set('tbwoId', filters.tbwoId);
  if (filters?.limit) params.set('limit', String(filters.limit));
  const r = await apiCall<{ success: boolean; artifacts: DbArtifact[] }>(
    'GET',
    `/api/artifacts?${params}`,
  );
  return r.artifacts;
}

export async function createArtifact(data: Record<string, unknown>): Promise<void> {
  await apiCall('POST', '/api/artifacts', data);
}

export async function updateArtifact(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await apiCall('PATCH', `/api/artifacts/${id}`, data);
}

export async function deleteArtifact(id: string): Promise<void> {
  await apiCall('DELETE', `/api/artifacts/${id}`);
}

// ============================================================================
// MEMORIES
// ============================================================================

interface DbMemory {
  id: string;
  layer: string;
  content: string;
  salience: number;
  decay_rate: number;
  access_count: number;
  is_consolidated: boolean;
  is_archived: boolean;
  is_pinned: boolean;
  user_modified: boolean;
  tags: string[];
  related_memories: string[];
  edit_history: unknown[];
  metadata: Record<string, unknown>;
  last_accessed_at: number | null;
  created_at: number;
  updated_at: number;
}

export async function listMemories(layer?: string): Promise<DbMemory[]> {
  const params = layer ? `?layer=${encodeURIComponent(layer)}` : '';
  const r = await apiCall<{ success: boolean; memories: DbMemory[] }>('GET', `/api/memories${params}`);
  return r.memories;
}

export async function createMemory(data: Record<string, unknown>): Promise<void> {
  await apiCall('POST', '/api/memories', data);
}

export async function updateMemory(id: string, data: Record<string, unknown>): Promise<void> {
  await apiCall('PATCH', `/api/memories/${id}`, data);
}

export async function deleteMemory(id: string): Promise<void> {
  await apiCall('DELETE', `/api/memories/${id}`);
}

// ============================================================================
// AUDIT ENTRIES
// ============================================================================

interface DbAuditEntry {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  model: string;
  tokens_prompt: number;
  tokens_completion: number;
  tokens_total: number;
  cost: number;
  tools_used: string[];
  duration_ms: number;
  timestamp: number;
}

export async function listAuditEntries(since?: number): Promise<DbAuditEntry[]> {
  const params = since ? `?since=${since}` : '';
  const r = await apiCall<{ success: boolean; entries: DbAuditEntry[] }>('GET', `/api/audit${params}`);
  return r.entries;
}

export async function createAuditEntry(data: Record<string, unknown>): Promise<void> {
  await apiCall('POST', '/api/audit', data);
}

export async function pruneAuditEntries(): Promise<void> {
  await apiCall('DELETE', '/api/audit/prune');
}

// ============================================================================
// IMAGES
// ============================================================================

interface DbImage {
  id: string;
  url: string;
  prompt: string;
  revised_prompt: string | null;
  model: string;
  size: string;
  quality: string;
  style: string;
  conversation_id: string | null;
  message_id: string | null;
  created_at: number;
}

export async function listImages(limit = 100): Promise<DbImage[]> {
  const r = await apiCall<{ success: boolean; images: DbImage[] }>(
    'GET',
    `/api/images/list?limit=${limit}`,
  );
  return r.images;
}

export async function createImage(data: Record<string, unknown>): Promise<void> {
  await apiCall('POST', '/api/images/metadata', data);
}

export async function deleteImage(id: string): Promise<void> {
  await apiCall('DELETE', `/api/images/${id}`);
}

// Re-export types for consumers
export type { DbConversation, DbMessage, DbTBWO, DbArtifact, DbMemory, DbAuditEntry, DbImage };
