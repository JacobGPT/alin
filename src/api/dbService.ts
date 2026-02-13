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
// DEPENDENCY INJECTION — Project provider
// ============================================================================

// Project provider set by bootstrap (main.tsx), NOT imported from executive.
// Called at request-time inside apiCall(), never cached at boot.
type ProjectProvider = () => string;
let _projectProvider: ProjectProvider = () => 'default';

export function setProjectProvider(provider: ProjectProvider): void {
  _projectProvider = provider;
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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
  };
  // Add project scope header — called fresh on every request (never cached)
  const projectId = _projectProvider();
  if (projectId && projectId !== 'default') {
    headers['X-Project-Id'] = projectId;
  }
  const opts: RequestInit = { method, headers };
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

// ============================================================================
// SITES
// ============================================================================

export interface DbSite {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  tbwo_run_id: string | null;
  status: string; // 'draft' | 'deployed'
  cloudflare_project_name: string | null;
  domain: string | null;
  manifest: string | null;
  storage_path: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbDeployment {
  id: string;
  site_id: string;
  user_id: string;
  cloudflare_project_name: string | null;
  cloudflare_deployment_id: string | null;
  url: string | null;
  status: string; // 'queued' | 'building' | 'deploying' | 'success' | 'failed'
  build_log: string | null;
  error: string | null;
  created_at: number;
}

export async function createSite(data: {
  name: string;
  tbwoRunId?: string;
  manifest?: string;
}): Promise<DbSite> {
  const r = await apiCall<{ success: boolean; site: DbSite }>('POST', '/api/sites', data);
  return r.site;
}

export async function listSites(limit = 50, offset = 0): Promise<DbSite[]> {
  const r = await apiCall<{ success: boolean; sites: DbSite[] }>(
    'GET',
    `/api/sites?limit=${limit}&offset=${offset}`,
  );
  return r.sites;
}

export async function getSite(siteId: string): Promise<DbSite> {
  const r = await apiCall<{ success: boolean; site: DbSite }>('GET', `/api/sites/${siteId}`);
  return r.site;
}

export async function deploySite(siteId: string): Promise<DbDeployment> {
  const r = await apiCall<{ success: boolean; deployment: DbDeployment }>(
    'POST',
    `/api/sites/${siteId}/deploy`,
  );
  return r.deployment;
}

export async function listDeployments(siteId: string, limit = 20): Promise<DbDeployment[]> {
  const r = await apiCall<{ success: boolean; deployments: DbDeployment[] }>(
    'GET',
    `/api/sites/${siteId}/deployments?limit=${limit}`,
  );
  return r.deployments;
}

// ============================================================================
// DEPLOY PROGRESS SSE STREAM
// ============================================================================

export interface DeployProgressEvent {
  event: 'status' | 'progress' | 'error' | 'done';
  step?: string;
  message?: string;
  url?: string;
  fileCount?: number;
  current?: number;
  total?: number;
  file?: string;
  timestamp: number;
}

/**
 * Stream live deploy progress via SSE.
 * Returns a close function to terminate the connection.
 */
export function streamDeployProgress(
  siteId: string,
  deploymentId: string,
  onEvent: (event: DeployProgressEvent) => void,
): () => void {
  const token = (() => {
    try {
      const raw = localStorage.getItem('alin-auth-storage');
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed?.state?.token || '';
      }
    } catch {}
    return '';
  })();

  const url = `/api/sites/${siteId}/deploy/${deploymentId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const es = new EventSource(url);

  const handleEvent = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as DeployProgressEvent;
      onEvent(data);
      if (data.event === 'done' || data.event === 'error') {
        es.close();
      }
    } catch { /* ignore parse errors */ }
  };

  es.addEventListener('status', handleEvent);
  es.addEventListener('progress', handleEvent);
  es.addEventListener('error', handleEvent);
  es.addEventListener('done', handleEvent);

  es.onerror = () => {
    // Connection failed — fire a done event so UI can fall back
    onEvent({ event: 'done', timestamp: Date.now() });
    es.close();
  };

  return () => es.close();
}

// ============================================================================
// SITE BRIEF EXTRACTION
// ============================================================================

export interface SiteBriefPricingTier {
  name: string;
  priceMonthly: string;
  limitLabel: string;
  highlights: string[];
  isMostPopular?: boolean;
}

export interface SiteBriefPricing {
  hasFreePlan: boolean;
  tiers: SiteBriefPricingTier[];
  trial: { enabled: boolean; days: number; requiresCard: boolean };
  annual: { enabled: boolean; discountLabel: string };
}

export interface SiteBriefUnknown {
  id: string;
  question: string;
  reason: string;
  required: boolean;
}

export interface SiteBriefConstraints {
  NO_FABRICATED_STATS: boolean;
  NO_RENAME_WITHOUT_APPROVAL: boolean;
  NO_SECURITY_CLAIMS_UNLESS_PROVIDED: boolean;
}

export interface SiteBrief {
  // Core identity
  productName: string;
  tagline: string;
  oneLinerPositioning: string;

  // Legacy compat (mapped from new fields in wizard)
  businessType: string;
  icpGuess: string;
  goal: string;

  // Audience & pain
  targetAudience: string;
  primaryPain: string;
  primaryCTA: string;
  toneStyle: string;

  // Structure
  navPages: string[];
  features: string[];
  integrations: string[];

  // Pricing
  pricing: SiteBriefPricing;

  // Design
  designDirection: string;

  // Unknowns & assumptions
  requiredUnknowns: SiteBriefUnknown[];
  assumptions: string[];

  // Trust constraints — always enforced
  constraints: SiteBriefConstraints;

  // Cognitive layer fields (optional, added by cognitive analysis)
  coreProblem?: string;
  differentiators?: string[];

  // Contact Information
  contactEmail?: string;
  contactPhone?: string;
  contactAddress?: string;
  socialLinks?: Record<string, string>;
  operatingHours?: string;

  // Legacy arrays (kept for wizard compat)
  pages: string[];
  tone: string;
  ctas: string[];
}

export interface MissingQuestion {
  id: string;
  question: string;
  reason: string;
  blocking: boolean;
}

export interface ExtractBriefResult {
  brief: SiteBrief;
  provenance: Record<string, string>;
  missingQuestions: MissingQuestion[];
  provider?: string;
  cached?: boolean;
  riskyClaims?: Array<{ text: string; type: string }>;
  sourceConfidence?: Record<string, number>;
}

export async function extractBrief(
  sourceText: string,
  sourceType: 'THREAD' | 'DESCRIPTION',
  contextHints?: string,
  model?: string,
): Promise<ExtractBriefResult> {
  const r = await apiCall<{
    success: boolean;
    brief: SiteBrief;
    provider?: string;
    provenance?: Record<string, string>;
    missingQuestions?: MissingQuestion[];
    cached?: boolean;
  }>(
    'POST',
    '/api/sites/extract-brief',
    { sourceText, sourceType, contextHints, model },
  );
  return {
    brief: r.brief,
    provenance: r.provenance || {},
    missingQuestions: r.missingQuestions || [],
    provider: r.provider,
    cached: r.cached,
  };
}

// ============================================================================
// WORKSPACE + SANDBOX FUNCTIONS
// ============================================================================

export interface FileTreeNode {
  type: 'file' | 'directory';
  name: string;
  path: string;
  size?: number;
  children?: FileTreeNode[];
  downloadUrl?: string;
}

export interface ValidationReport {
  passed: boolean;
  score: number;
  violations: Array<{ type: string; file: string; line: number; text: string; critical: boolean }>;
  completeness: { hasIndex: boolean; missingPages: string[]; totalFiles: number; htmlFiles: number };
  placeholders: Array<{ file: string; line: number; text: string }>;
  canDeploy: boolean;
  blockers: string[];
}

export interface SandboxPipelineStatus {
  currentStage: string;
  stagesCompleted: number;
  totalStages: number;
  progress: number;
  stageLog: Array<{
    stage: string;
    status: string;
    duration?: number;
    artifacts?: string[];
    errors?: string[];
    fileCount?: number;
  }>;
  artifacts: Record<string, unknown>;
  error: string | null;
}

export async function getWorkspaceManifest(
  tbwoId: string,
): Promise<{ manifest: FileTreeNode[]; totalFiles: number; totalSize: number }> {
  return apiCall('GET', `/api/tbwo/${tbwoId}/workspace/manifest`);
}

export async function validateWorkspace(
  tbwoId: string,
  expectedPages?: string[],
  approvedClaims?: string[],
): Promise<ValidationReport> {
  return apiCall('POST', `/api/tbwo/${tbwoId}/workspace/validate`, {
    expectedPages,
    approvedClaims,
  });
}

export async function runSandboxPipeline(
  tbwoId: string,
  options?: { throughStage?: string; brief?: unknown; expectedPages?: string[]; approvedClaims?: string[] },
): Promise<{ started: boolean }> {
  return apiCall('POST', `/api/tbwo/${tbwoId}/sandbox/run`, options);
}

export async function getSandboxStatus(
  tbwoId: string,
): Promise<SandboxPipelineStatus> {
  return apiCall('GET', `/api/tbwo/${tbwoId}/sandbox/status`);
}

export async function deploySandbox(
  tbwoId: string,
  adapter?: string,
): Promise<{ deploymentId: string; url: string | null; status: string }> {
  return apiCall('POST', `/api/tbwo/${tbwoId}/sandbox/deploy`, { adapter });
}

// ============================================================================
// SITE PATCHES
// ============================================================================

export interface PatchChange {
  file: string;
  action: 'modify' | 'create' | 'delete';
  summary: string;
  provenance: 'USER_PROVIDED' | 'INFERRED' | 'PLACEHOLDER';
  before: string | null;
  after: string | null;
}

export interface PatchPlan {
  summary: string;
  changes: PatchChange[];
  warnings: string[];
  placeholders: string[];
}

export interface DbSitePatch {
  id: string;
  site_id: string;
  user_id: string;
  change_request: string;
  plan: PatchPlan | null;
  status: 'planning' | 'planned' | 'approved' | 'applied' | 'partially_applied' | 'rejected' | 'failed';
  apply_result: { applied: number; failed: number; errors: string[] } | null;
  created_at: number;
  resolved_at: number | null;
}

export async function createPatchPlan(siteId: string, changeRequest: string): Promise<{ patchId: string; status: string }> {
  const r = await apiCall<{ success: boolean; patchId: string; status: string }>(
    'POST',
    `/api/sites/${siteId}/patch/plan`,
    { changeRequest },
  );
  return { patchId: r.patchId, status: r.status };
}

export async function getPatchPlan(siteId: string, patchId: string): Promise<DbSitePatch> {
  const r = await apiCall<{ success: boolean; patch: DbSitePatch }>(
    'GET',
    `/api/sites/${siteId}/patches/${patchId}`,
  );
  return r.patch;
}

export async function listPatches(siteId: string, limit = 20): Promise<DbSitePatch[]> {
  const r = await apiCall<{ success: boolean; patches: DbSitePatch[] }>(
    'GET',
    `/api/sites/${siteId}/patches?limit=${limit}`,
  );
  return r.patches;
}

export async function applyPatch(
  siteId: string,
  patchId: string,
  replacements?: Record<string, string>,
): Promise<{ applied: number; failed: number; errors: string[] }> {
  const r = await apiCall<{ success: boolean; result: { applied: number; failed: number; errors: string[] } }>(
    'POST',
    `/api/sites/${siteId}/patch/${patchId}/apply`,
    { replacements },
  );
  return r.result;
}

export async function rejectPatch(siteId: string, patchId: string): Promise<void> {
  await apiCall<{ success: boolean }>(
    'POST',
    `/api/sites/${siteId}/patch/${patchId}/reject`,
  );
}

// ============================================================================
// R2 / SITE VERSIONS
// ============================================================================

export interface DbSiteVersion {
  id: string;
  site_id: string;
  user_id: string;
  version: number;
  file_count: number;
  total_bytes: number;
  deployment_id: string | null;
  created_at: number;
}

export interface SiteFile {
  key: string;
  path: string;
  size: number;
  lastModified: string;
}

export async function deployR2(siteId: string): Promise<DbDeployment> {
  const r = await apiCall<{ success: boolean; deployment: DbDeployment }>(
    'POST',
    `/api/sites/${siteId}/deploy-r2`,
  );
  return r.deployment;
}

export async function listSiteFiles(siteId: string): Promise<{ files: SiteFile[]; version: number }> {
  const r = await apiCall<{ success: boolean; files: SiteFile[]; version: number }>(
    'GET',
    `/api/sites/${siteId}/files`,
  );
  return { files: r.files, version: r.version };
}

export async function listSiteVersions(siteId: string, limit = 50): Promise<DbSiteVersion[]> {
  const r = await apiCall<{ success: boolean; versions: DbSiteVersion[] }>(
    'GET',
    `/api/sites/${siteId}/versions?limit=${limit}`,
  );
  return r.versions;
}

export async function rollbackSite(
  siteId: string,
  version: number,
): Promise<DbDeployment> {
  const r = await apiCall<{ success: boolean; deployment: DbDeployment }>(
    'POST',
    `/api/sites/${siteId}/rollback/${version}`,
  );
  return r.deployment;
}

// ============================================================================
// CLOUDFLARE IMAGES
// ============================================================================

export interface DbCfImage {
  id: string;
  user_id: string;
  cf_image_id: string;
  filename: string;
  url: string;
  variants: string[];
  metadata: Record<string, unknown>;
  site_id: string | null;
  created_at: number;
}

export async function uploadCfImage(file: File, siteId?: string): Promise<DbCfImage> {
  const formData = new FormData();
  formData.append('image', file);
  if (siteId) formData.append('siteId', siteId);

  const headers: Record<string, string> = { ...getAuthHeaders() };
  const projectId = _projectProvider();
  if (projectId && projectId !== 'default') headers['X-Project-Id'] = projectId;

  const res = await fetch('/api/images/cf/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = await res.json();
  return data.image;
}

export async function listCfImages(limit = 50): Promise<DbCfImage[]> {
  const r = await apiCall<{ success: boolean; images: DbCfImage[] }>(
    'GET',
    `/api/images/cf?limit=${limit}`,
  );
  return r.images;
}

export async function deleteCfImage(imageId: string): Promise<void> {
  await apiCall<{ success: boolean }>('DELETE', `/api/images/cf/${imageId}`);
}

// ============================================================================
// CLOUDFLARE STREAM (VIDEOS)
// ============================================================================

export interface DbCfVideo {
  id: string;
  user_id: string;
  cf_uid: string;
  status: string;
  thumbnail: string | null;
  preview: string | null;
  duration: number | null;
  metadata: Record<string, unknown>;
  site_id: string | null;
  created_at: number;
}

export async function getVideoUploadUrl(siteId?: string): Promise<{ id: string; uid: string; uploadUrl: string }> {
  const r = await apiCall<{ success: boolean; video: { id: string; uid: string; uploadUrl: string } }>(
    'POST',
    '/api/videos/upload-url',
    { siteId },
  );
  return r.video;
}

export async function uploadVideoFromUrl(url: string, siteId?: string): Promise<{ id: string; uid: string; status: string }> {
  const r = await apiCall<{ success: boolean; video: { id: string; uid: string; status: string } }>(
    'POST',
    '/api/videos/upload-from-url',
    { url, siteId },
  );
  return r.video;
}

export async function getVideo(videoId: string): Promise<DbCfVideo> {
  const r = await apiCall<{ success: boolean; video: DbCfVideo }>('GET', `/api/videos/${videoId}`);
  return r.video;
}

export async function deleteVideo(videoId: string): Promise<void> {
  await apiCall<{ success: boolean }>('DELETE', `/api/videos/${videoId}`);
}

export async function getVideoEmbed(videoId: string): Promise<{ embedUrl: string | null; embedHtml: string | null }> {
  const r = await apiCall<{ success: boolean; embedUrl: string | null; embedHtml: string | null }>(
    'GET',
    `/api/videos/${videoId}/embed`,
  );
  return { embedUrl: r.embedUrl, embedHtml: r.embedHtml };
}

// ============================================================================
// THREADS / VECTORIZE
// ============================================================================

export interface ThreadChunk {
  id: string;
  thread_id: string;
  chunk_index: number;
  content: string;
  summary: string | null;
  token_count: number;
  vector_id: string;
  created_at: number;
}

export interface ThreadSummary {
  thread_id: string;
  created_at: number;
  chunk_count: number;
  total_tokens: number;
}

export interface SemanticSearchResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

export async function ingestThread(text: string, threadId?: string): Promise<{
  threadId: string;
  chunkCount: number;
  chunks: Array<{ index: number; tokenCount: number; preview: string }>;
}> {
  const r = await apiCall<{
    success: boolean;
    threadId: string;
    chunkCount: number;
    chunks: Array<{ index: number; tokenCount: number; preview: string }>;
  }>('POST', '/api/threads/ingest', { text, threadId });
  return { threadId: r.threadId, chunkCount: r.chunkCount, chunks: r.chunks };
}

export async function listThreads(limit = 50): Promise<ThreadSummary[]> {
  const r = await apiCall<{ success: boolean; threads: ThreadSummary[] }>(
    'GET',
    `/api/threads?limit=${limit}`,
  );
  return r.threads;
}

export async function getThreadChunks(threadId: string): Promise<ThreadChunk[]> {
  const r = await apiCall<{ success: boolean; chunks: ThreadChunk[] }>(
    'GET',
    `/api/threads/${threadId}/chunks`,
  );
  return r.chunks;
}

export async function semanticSearch(query: string, topK = 10): Promise<SemanticSearchResult[]> {
  const r = await apiCall<{ success: boolean; results: SemanticSearchResult[] }>(
    'POST',
    '/api/memory/semantic-search',
    { query, topK },
  );
  return r.results;
}

export async function contentSearch(query: string, topK = 10): Promise<SemanticSearchResult[]> {
  const r = await apiCall<{ success: boolean; results: SemanticSearchResult[] }>(
    'POST',
    '/api/content/search',
    { query, topK },
  );
  return r.results;
}

// ============================================================================
// VECTORIZE — TBWO Context Chunking
// ============================================================================

export async function vectorizeIngest(text: string, metadata?: Record<string, unknown>): Promise<{ chunkCount: number; vectorCount: number }> {
  return apiCall<{ success: boolean; chunkCount: number; vectorCount: number }>(
    'POST',
    '/api/vectorize/ingest',
    { text, metadata },
  );
}

export async function vectorizeSearchContext(query: string, topK = 5): Promise<unknown[]> {
  const r = await apiCall<{ success: boolean; chunks: unknown[] }>(
    'POST',
    '/api/vectorize/search-context',
    { query, topK },
  );
  return r.chunks;
}

// ============================================================================
// R2 — User Asset Management
// ============================================================================

export async function uploadAsset(file: File): Promise<{ key: string; url?: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/assets/upload', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${localStorage.getItem('alin-auth-token') || ''}` },
    body: formData,
  });
  if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
  return response.json();
}

export async function listAssets(limit = 100): Promise<unknown[]> {
  const r = await apiCall<{ success: boolean; assets: unknown[] }>(
    'GET',
    `/api/assets?limit=${limit}`,
  );
  return r.assets;
}

export async function deleteSiteVersion(siteId: string, version: number): Promise<void> {
  await apiCall<{ success: boolean }>('DELETE', `/api/sites/${siteId}/versions/${version}`);
}

// ============================================================================
// KV — Domain Management
// ============================================================================

export async function lookupDomain(subdomain: string): Promise<{ available: boolean; info: unknown }> {
  return apiCall<{ success: boolean; available: boolean; info: unknown }>(
    'GET',
    `/api/sites/domain/${encodeURIComponent(subdomain)}`,
  );
}

export async function unregisterDomain(subdomain: string): Promise<void> {
  await apiCall<{ success: boolean }>('DELETE', `/api/sites/domain/${encodeURIComponent(subdomain)}`);
}

export async function getSiteVersionInfo(siteId: string): Promise<unknown> {
  const r = await apiCall<{ success: boolean; info: unknown }>(
    'GET',
    `/api/sites/${siteId}/version-info`,
  );
  return r.info;
}

// ============================================================================
// CF Images — Gallery & URL Upload
// ============================================================================

export async function uploadImageFromUrl(url: string, metadata?: Record<string, unknown>): Promise<unknown> {
  const r = await apiCall<{ success: boolean; image: unknown }>(
    'POST',
    '/api/images/from-url',
    { url, metadata },
  );
  return r.image;
}

export async function listCfImagesFromApi(page = 1, perPage = 50): Promise<unknown> {
  return apiCall<{ success: boolean; images: unknown[]; result_info?: unknown }>(
    'GET',
    `/api/images/list?page=${page}&perPage=${perPage}`,
  );
}

// ============================================================================
// CF Stream — Video Gallery
// ============================================================================

export async function listVideos(limit = 50): Promise<unknown[]> {
  const r = await apiCall<{ success: boolean; videos: unknown[] }>(
    'GET',
    `/api/videos/list?limit=${limit}`,
  );
  return r.videos;
}

// Re-export types for consumers
export type { DbConversation, DbMessage, DbTBWO, DbArtifact, DbMemory, DbAuditEntry, DbImage };
