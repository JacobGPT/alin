/**
 * ALIN Database Initialization
 * Creates all tables, runs migrations, validates DB health.
 */
import Database from 'better-sqlite3';
import fsSync from 'node:fs';
import path from 'path';

export function initDatabase(dbPath) {
  // Ensure DB directory exists (Railway volumes may need this)
  const dbDir = path.dirname(dbPath);
  try { fsSync.mkdirSync(dbDir, { recursive: true }); } catch {}

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // ── Table Creation ──
  db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    mode TEXT DEFAULT 'regular',
    model TEXT DEFAULT 'claude-sonnet-4-5-20250929',
    provider TEXT DEFAULT 'anthropic',
    is_favorite INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tokens_input INTEGER DEFAULT 0,
    tokens_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    model TEXT,
    is_edited INTEGER DEFAULT 0,
    parent_id TEXT,
    metadata TEXT DEFAULT '{}',
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS tbwo_receipts (
    id TEXT PRIMARY KEY,
    tbwo_id TEXT NOT NULL,
    receipt_type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tbwo_receipts_tbwo ON tbwo_receipts(tbwo_id);

  CREATE TABLE IF NOT EXISTS tbwo_orders (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    objective TEXT NOT NULL,
    time_budget_total INTEGER DEFAULT 60,
    quality_target TEXT DEFAULT '{}',
    scope TEXT DEFAULT '{}',
    plan TEXT,
    pods TEXT DEFAULT '[]',
    active_pods TEXT DEFAULT '[]',
    artifacts TEXT DEFAULT '[]',
    checkpoints TEXT DEFAULT '[]',
    authority_level TEXT DEFAULT 'guided',
    progress REAL DEFAULT 0,
    receipts TEXT,
    chat_conversation_id TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    language TEXT,
    content TEXT NOT NULL,
    editable INTEGER DEFAULT 1,
    conversation_id TEXT,
    tbwo_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory_entries (
    id TEXT PRIMARY KEY,
    layer TEXT NOT NULL,
    content TEXT NOT NULL,
    salience REAL DEFAULT 0.5,
    decay_rate REAL DEFAULT 0.1,
    access_count INTEGER DEFAULT 0,
    is_consolidated INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    user_modified INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    related_memories TEXT DEFAULT '[]',
    edit_history TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    last_accessed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_entries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    message_id TEXT,
    model TEXT NOT NULL,
    tokens_prompt INTEGER DEFAULT 0,
    tokens_completion INTEGER DEFAULT 0,
    tokens_total INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    tools_used TEXT DEFAULT '[]',
    duration_ms INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    prompt TEXT NOT NULL,
    revised_prompt TEXT,
    model TEXT DEFAULT 'flux2-max',
    size TEXT DEFAULT '1024x1024',
    quality TEXT DEFAULT 'standard',
    style TEXT DEFAULT 'vivid',
    conversation_id TEXT,
    message_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT DEFAULT '',
    plan TEXT DEFAULT 'free' CHECK(plan IN ('free','pro','elite')),
    email_verified INTEGER DEFAULT 0,
    verification_code TEXT,
    verification_expires INTEGER,
    messages_used_today INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    messages_reset_at INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memory_layer ON memory_entries(layer);
  CREATE INDEX IF NOT EXISTS idx_memory_salience ON memory_entries(salience DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- Self-Model: Execution Outcomes
  CREATE TABLE IF NOT EXISTS execution_outcomes (
    id TEXT PRIMARY KEY,
    tbwo_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    type TEXT NOT NULL,
    time_budget INTEGER NOT NULL,
    plan_confidence REAL DEFAULT 0,
    phases_completed INTEGER DEFAULT 0,
    phases_failed INTEGER DEFAULT 0,
    artifacts_count INTEGER DEFAULT 0,
    user_edits_after INTEGER DEFAULT 0,
    quality_score REAL DEFAULT 0,
    timestamp INTEGER NOT NULL
  );

  -- Self-Model: Tool Reliability
  CREATE TABLE IF NOT EXISTS tool_reliability (
    tool_name TEXT PRIMARY KEY,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    avg_duration REAL DEFAULT 0,
    common_errors TEXT DEFAULT '[]',
    last_failure_reason TEXT DEFAULT ''
  );

  -- Self-Model: User Corrections
  CREATE TABLE IF NOT EXISTS user_corrections (
    id TEXT PRIMARY KEY,
    original_value TEXT NOT NULL,
    corrected_value TEXT NOT NULL,
    category TEXT NOT NULL,
    correction_count INTEGER DEFAULT 1,
    last_corrected INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_corrections_category ON user_corrections(category);
  CREATE INDEX IF NOT EXISTS idx_corrections_count ON user_corrections(correction_count DESC);

  -- Self-Model: Decision Log
  CREATE TABLE IF NOT EXISTS decision_log (
    id TEXT PRIMARY KEY,
    tbwo_id TEXT,
    decision_type TEXT NOT NULL,
    options_considered TEXT DEFAULT '[]',
    chosen_option TEXT NOT NULL,
    reasoning TEXT DEFAULT '',
    outcome TEXT DEFAULT '',
    confidence REAL DEFAULT 0,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_decisions_tbwo ON decision_log(tbwo_id);
  CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decision_log(timestamp DESC);

  -- Self-Model: Thinking Traces
  CREATE TABLE IF NOT EXISTS thinking_traces (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    tbwo_id TEXT,
    thinking_content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_thinking_conv ON thinking_traces(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_thinking_tbwo ON thinking_traces(tbwo_id);
  CREATE INDEX IF NOT EXISTS idx_thinking_timestamp ON thinking_traces(timestamp DESC);

  -- Self-Model: Layer Memory (8-layer system)
  CREATE TABLE IF NOT EXISTS memory_layers (
    id TEXT PRIMARY KEY,
    layer TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT '',
    salience REAL DEFAULT 0.5,
    expires_at INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memlayer_layer ON memory_layers(layer);
  CREATE INDEX IF NOT EXISTS idx_memlayer_expires ON memory_layers(expires_at);
  CREATE INDEX IF NOT EXISTS idx_memlayer_salience ON memory_layers(salience DESC);
`);

  // ── Migrations ──

  // Add user_id columns to ALL user-scoped tables
  const userIdTables = ['conversations', 'messages', 'tbwo_orders', 'artifacts', 'memory_entries', 'audit_entries', 'images', 'tbwo_receipts', 'execution_outcomes', 'user_corrections', 'decision_log', 'thinking_traces', 'memory_layers'];
  for (const table of userIdTables) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`); } catch { /* column already exists */ }
  }

  // Add project_id columns to root entities
  const projectIdTables = ['conversations', 'tbwo_orders', 'memory_entries'];
  for (const table of projectIdTables) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT DEFAULT 'default'`); } catch { /* column already exists */ }
  }

  // Per-model success rate tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_success_rates (
      model TEXT PRIMARY KEY,
      success_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      avg_duration REAL DEFAULT 0,
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
  `);

  // Add execution_state column to tbwo_orders for resumable execution
  try { db.exec('ALTER TABLE tbwo_orders ADD COLUMN execution_state TEXT'); } catch { /* column already exists */ }

  // Create projects table (ownership-validated)
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Default Project',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(id, user_id)
    );
  `);

  // Seed default project for local-user
  try {
    db.exec(`INSERT OR IGNORE INTO projects (id, user_id, name) VALUES ('default', 'local-user', 'Default Project')`);
  } catch { /* already exists */ }

  // Create user-scoped indexes (now that user_id columns exist)
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_user_timestamp ON messages(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user_timestamp ON audit_entries(user_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_user_layer ON memory_entries(user_id, layer);
      CREATE INDEX IF NOT EXISTS idx_conv_user_project ON conversations(user_id, project_id);
      CREATE INDEX IF NOT EXISTS idx_tbwo_user_project ON tbwo_orders(user_id, project_id);
      CREATE INDEX IF NOT EXISTS idx_mem_user_project ON memory_entries(user_id, project_id);
    `);
  } catch { /* indexes may already exist */ }

  // Per-user settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS telemetry_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      session_id TEXT,
      event_type TEXT NOT NULL,
      event_data TEXT DEFAULT '{}',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS telemetry_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      conversation_id TEXT,
      model_used TEXT,
      mode TEXT DEFAULT 'regular',
      message_count INTEGER DEFAULT 0,
      tool_calls_count INTEGER DEFAULT 0,
      thumbs_up INTEGER DEFAULT 0,
      thumbs_down INTEGER DEFAULT 0,
      regenerations INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS telemetry_tool_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      conversation_id TEXT,
      tool_name TEXT NOT NULL,
      success INTEGER DEFAULT 1,
      duration_ms INTEGER DEFAULT 0,
      error_message TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS telemetry_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      conversation_id TEXT,
      message_id TEXT,
      feedback_type TEXT NOT NULL,
      original_response TEXT,
      corrected_response TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS telemetry_daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      total_users INTEGER DEFAULT 0,
      active_users INTEGER DEFAULT 0,
      new_signups INTEGER DEFAULT 0,
      total_messages INTEGER DEFAULT 0,
      total_conversations INTEGER DEFAULT 0,
      total_tokens_used INTEGER DEFAULT 0,
      avg_messages_per_user REAL DEFAULT 0,
      top_model TEXT,
      top_mode TEXT
    );

    -- Sites (Deploy + Dashboard v1)
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT DEFAULT 'default',
      name TEXT NOT NULL,
      tbwo_run_id TEXT,
      status TEXT DEFAULT 'draft',
      cloudflare_project_name TEXT,
      domain TEXT,
      manifest TEXT,
      storage_path TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_sites_user ON sites(user_id);

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      cloudflare_project_name TEXT,
      cloudflare_deployment_id TEXT,
      url TEXT,
      status TEXT DEFAULT 'queued',
      build_log TEXT,
      error TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_deployments_site ON deployments(site_id, user_id);

    CREATE TABLE IF NOT EXISTS site_patches (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      change_request TEXT NOT NULL,
      plan TEXT,
      status TEXT DEFAULT 'planning',
      apply_result TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      resolved_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_patches_site ON site_patches(site_id, user_id);

    -- Site versions: track each R2 deployment version
    CREATE TABLE IF NOT EXISTS site_versions (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      file_count INTEGER DEFAULT 0,
      total_bytes INTEGER DEFAULT 0,
      deployment_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(site_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_site_versions_site ON site_versions(site_id, user_id);

    -- CF Images: user-uploaded Cloudflare Images records
    CREATE TABLE IF NOT EXISTS cf_images (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cf_image_id TEXT NOT NULL,
      filename TEXT,
      url TEXT,
      variants TEXT,
      metadata TEXT,
      site_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_cf_images_user ON cf_images(user_id);

    -- CF Videos: Cloudflare Stream video records
    CREATE TABLE IF NOT EXISTS cf_videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cf_uid TEXT NOT NULL,
      status TEXT DEFAULT 'uploading',
      thumbnail TEXT,
      preview TEXT,
      duration REAL,
      metadata TEXT,
      site_id TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_cf_videos_user ON cf_videos(user_id);

    -- Thread chunks: Vectorize-backed thread ingestion
    CREATE TABLE IF NOT EXISTS thread_chunks (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      chunk_index INTEGER,
      content TEXT,
      summary TEXT,
      token_count INTEGER,
      vector_id TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_thread_chunks_thread ON thread_chunks(thread_id, user_id);

    -- User quotas: fast monthly limit tracking
    CREATE TABLE IF NOT EXISTS user_quotas (
      user_id TEXT NOT NULL,
      quota_type TEXT NOT NULL,
      period TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, quota_type, period)
    );
  `);

  console.log('[DB] SQLite database initialized at', dbPath);

  // ── Startup Validation ──
  try {
    db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('__healthcheck', 'ok', ?) ON CONFLICT(key) DO UPDATE SET value='ok'").run(Date.now());
    db.prepare("DELETE FROM settings WHERE key = '__healthcheck'").run();
    console.log('[DB] Write health check passed');
  } catch (dbErr) {
    console.error('[FATAL] Database is not writable:', dbErr.message);
    process.exit(1);
  }

  // Warn about missing API keys
  const envWarnings = [];
  if (!process.env.ANTHROPIC_API_KEY) envWarnings.push('ANTHROPIC_API_KEY (Claude will not work)');
  if (!process.env.OPENAI_API_KEY) envWarnings.push('OPENAI_API_KEY (GPT will not work)');
  if (!process.env.BFL_API_KEY) envWarnings.push('BFL_API_KEY (FLUX.2 image generation will not work)');
  if (!process.env.GEMINI_API_KEY) envWarnings.push('GEMINI_API_KEY (Gemini/Imagen/Veo models will not work)');
  if (!process.env.DEEPSEEK_API_KEY) envWarnings.push('DEEPSEEK_API_KEY (DeepSeek models will not work)');
  if (!process.env.RESEND_API_KEY) envWarnings.push('RESEND_API_KEY (email verification will not work)');
  if (!process.env.BRAVE_API_KEY && !process.env.VITE_BRAVE_API_KEY) envWarnings.push('BRAVE_API_KEY (web search will not work)');
  if (envWarnings.length > 0) {
    console.warn('\n\u26a0\ufe0f  [Config] Missing optional environment variables:');
    envWarnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  return db;
}
