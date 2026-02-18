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

  -- Consequence Engine: Predictions (Layer 1 — Prediction Cortex)
  CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    message_id TEXT,
    prediction_text TEXT NOT NULL,
    prediction_type TEXT DEFAULT 'implicit',
    domain TEXT NOT NULL DEFAULT 'general',
    confidence REAL DEFAULT 0.5,
    context_summary TEXT DEFAULT '',
    source_model TEXT DEFAULT '',
    extraction_method TEXT DEFAULT 'regex',
    status TEXT DEFAULT 'pending',
    outcome_id TEXT,
    verification_attempts INTEGER DEFAULT 0,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pred_status ON predictions(status);
  CREATE INDEX IF NOT EXISTS idx_pred_domain ON predictions(domain);
  CREATE INDEX IF NOT EXISTS idx_pred_created ON predictions(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pred_conv ON predictions(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_pred_msg ON predictions(message_id);
  CREATE INDEX IF NOT EXISTS idx_pred_expires ON predictions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_pred_type ON predictions(prediction_type);

  -- Consequence Engine: Outcomes (Layer 2 — Outcome Cortex)
  CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    prediction_id TEXT,
    trigger_type TEXT NOT NULL,
    trigger_source TEXT DEFAULT '',
    trigger_data TEXT DEFAULT '{}',
    result TEXT NOT NULL,
    confidence_delta REAL DEFAULT 0,
    pain_delta REAL DEFAULT 0,
    satisfaction_delta REAL DEFAULT 0,
    lesson_learned TEXT DEFAULT '',
    corrective_action TEXT DEFAULT '',
    domain TEXT NOT NULL DEFAULT 'general',
    severity TEXT DEFAULT 'normal',
    cascade_effects TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_outcome_pred ON outcomes(prediction_id);
  CREATE INDEX IF NOT EXISTS idx_outcome_domain ON outcomes(domain);
  CREATE INDEX IF NOT EXISTS idx_outcome_created ON outcomes(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_outcome_trigger ON outcomes(trigger_type);
  CREATE INDEX IF NOT EXISTS idx_outcome_result ON outcomes(result);
  CREATE INDEX IF NOT EXISTS idx_outcome_severity ON outcomes(severity);

  -- Consequence Engine: Domain States (Layer 3 — Emotional Weightmap)
  CREATE TABLE IF NOT EXISTS domain_states (
    domain TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pain_score REAL DEFAULT 0,
    satisfaction_score REAL DEFAULT 0,
    prediction_accuracy REAL DEFAULT 0.5,
    calibration_offset REAL DEFAULT 0,
    total_predictions INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    wrong_predictions INTEGER DEFAULT 0,
    partial_predictions INTEGER DEFAULT 0,
    streak_type TEXT DEFAULT 'none',
    streak_count INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    worst_streak INTEGER DEFAULT 0,
    last_pain_event TEXT DEFAULT '',
    last_satisfaction_event TEXT DEFAULT '',
    last_outcome_at INTEGER,
    decay_rate REAL DEFAULT 0.9,
    volatility REAL DEFAULT 0.5,
    trend TEXT DEFAULT 'stable',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (domain, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_domain_state_updated ON domain_states(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_domain_state_pain ON domain_states(pain_score DESC);
  CREATE INDEX IF NOT EXISTS idx_domain_state_accuracy ON domain_states(prediction_accuracy DESC);

  -- Consequence Engine: Domain History (Layer 3b — Temporal Emotional Tracking)
  CREATE TABLE IF NOT EXISTS domain_history (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pain_score REAL DEFAULT 0,
    satisfaction_score REAL DEFAULT 0,
    prediction_accuracy REAL DEFAULT 0.5,
    event_type TEXT NOT NULL,
    event_summary TEXT DEFAULT '',
    snapshot_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_domain_hist_domain ON domain_history(domain, user_id);
  CREATE INDEX IF NOT EXISTS idx_domain_hist_time ON domain_history(snapshot_at DESC);

  -- Consequence Engine: Pattern Library (Layer 4 — Pattern Cortex)
  CREATE TABLE IF NOT EXISTS consequence_patterns (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL DEFAULT 'general',
    pattern_type TEXT NOT NULL,
    pattern_signature TEXT NOT NULL,
    description TEXT DEFAULT '',
    frequency INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.5,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    contributing_outcomes TEXT DEFAULT '[]',
    suggested_gene TEXT DEFAULT '',
    status TEXT DEFAULT 'emerging',
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pattern_domain ON consequence_patterns(domain);
  CREATE INDEX IF NOT EXISTS idx_pattern_type ON consequence_patterns(pattern_type);
  CREATE INDEX IF NOT EXISTS idx_pattern_freq ON consequence_patterns(frequency DESC);
  CREATE INDEX IF NOT EXISTS idx_pattern_status ON consequence_patterns(status);

  -- Consequence Engine: Behavioral Genome (Layer 5 — Behavioral Genome)
  CREATE TABLE IF NOT EXISTS behavioral_genome (
    id TEXT PRIMARY KEY,
    gene_text TEXT NOT NULL,
    gene_type TEXT DEFAULT 'behavioral',
    domain TEXT NOT NULL DEFAULT 'general',
    source_pattern TEXT DEFAULT '',
    source_pattern_id TEXT,
    trigger_condition TEXT DEFAULT '',
    action_directive TEXT DEFAULT '',
    strength REAL DEFAULT 0.5,
    status TEXT DEFAULT 'pending_review',
    confirmations INTEGER DEFAULT 0,
    contradictions INTEGER DEFAULT 0,
    applications INTEGER DEFAULT 0,
    last_applied_at INTEGER,
    requires_review INTEGER DEFAULT 0,
    review_notes TEXT DEFAULT '',
    regression_risk TEXT DEFAULT 'none',
    parent_gene_id TEXT,
    mutation_history TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gene_domain ON behavioral_genome(domain);
  CREATE INDEX IF NOT EXISTS idx_gene_strength ON behavioral_genome(strength DESC);
  CREATE INDEX IF NOT EXISTS idx_gene_status ON behavioral_genome(status);
  CREATE INDEX IF NOT EXISTS idx_gene_type ON behavioral_genome(gene_type);
  CREATE INDEX IF NOT EXISTS idx_gene_parent ON behavioral_genome(parent_gene_id);
  CREATE INDEX IF NOT EXISTS idx_gene_regression ON behavioral_genome(regression_risk);

  -- Consequence Engine: Gene Audit Log (Layer 5b — Genome Mutation Tracking)
  CREATE TABLE IF NOT EXISTS gene_audit_log (
    id TEXT PRIMARY KEY,
    gene_id TEXT NOT NULL,
    action TEXT NOT NULL,
    previous_state TEXT DEFAULT '{}',
    new_state TEXT DEFAULT '{}',
    reason TEXT DEFAULT '',
    actor TEXT DEFAULT 'system',
    created_at INTEGER NOT NULL,
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_gene_audit_gene ON gene_audit_log(gene_id);
  CREATE INDEX IF NOT EXISTS idx_gene_audit_action ON gene_audit_log(action);
  CREATE INDEX IF NOT EXISTS idx_gene_audit_time ON gene_audit_log(created_at DESC);

  -- Consequence Engine: Calibration Snapshots (Layer 4b — Calibration Curve Data)
  CREATE TABLE IF NOT EXISTS calibration_snapshots (
    id TEXT PRIMARY KEY,
    domain TEXT NOT NULL DEFAULT 'all',
    bucket_index INTEGER NOT NULL,
    bucket_min REAL NOT NULL,
    bucket_max REAL NOT NULL,
    total_predictions INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    actual_accuracy REAL DEFAULT 0,
    overconfidence_delta REAL DEFAULT 0,
    snapshot_at INTEGER NOT NULL,
    user_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_calibration_domain ON calibration_snapshots(domain);
  CREATE INDEX IF NOT EXISTS idx_calibration_time ON calibration_snapshots(snapshot_at DESC);
`);

  // ── Migrations ──

  // Add user_id columns to ALL user-scoped tables
  const userIdTables = ['conversations', 'messages', 'tbwo_orders', 'artifacts', 'memory_entries', 'audit_entries', 'images', 'tbwo_receipts', 'execution_outcomes', 'user_corrections', 'decision_log', 'thinking_traces', 'memory_layers', 'predictions', 'outcomes', 'domain_history', 'consequence_patterns', 'behavioral_genome', 'gene_audit_log', 'calibration_snapshots', 'product_metrics', 'product_alerts', 'user_rhythm', 'self_awareness_log', 'scheduler_jobs', 'scheduler_history'];
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

    -- Proactive Intelligence: Product Metrics (Product Pulse)
    CREATE TABLE IF NOT EXISTS product_metrics (
      id TEXT PRIMARY KEY,
      metric_type TEXT NOT NULL,
      value REAL NOT NULL,
      metadata TEXT DEFAULT '{}',
      recorded_at INTEGER NOT NULL,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pm_type ON product_metrics(metric_type, recorded_at DESC);

    -- Proactive Intelligence: Product Alerts (Alert Engine)
    CREATE TABLE IF NOT EXISTS product_alerts (
      id TEXT PRIMARY KEY,
      alert_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      metric_type TEXT,
      metric_value REAL,
      threshold_value REAL,
      acknowledged INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pa_sev ON product_alerts(severity, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pa_ack ON product_alerts(acknowledged, created_at DESC);

    -- Proactive Intelligence: User Rhythm Engine
    CREATE TABLE IF NOT EXISTS user_rhythm (
      id TEXT PRIMARY KEY,
      rhythm_type TEXT NOT NULL,
      value TEXT NOT NULL,
      day_of_week INTEGER,
      hour_of_day INTEGER,
      recorded_at INTEGER NOT NULL,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ur_type ON user_rhythm(rhythm_type, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ur_hour ON user_rhythm(hour_of_day, day_of_week);

    -- Proactive Intelligence: Self-Awareness Monitor
    CREATE TABLE IF NOT EXISTS self_awareness_log (
      id TEXT PRIMARY KEY,
      awareness_type TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      summary TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      related_domain TEXT,
      recorded_at INTEGER NOT NULL,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sa_type ON self_awareness_log(awareness_type, recorded_at DESC);

    -- Proactive Intelligence: Scheduler Jobs
    CREATE TABLE IF NOT EXISTS scheduler_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      interval_ms INTEGER NOT NULL,
      handler TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run_at INTEGER DEFAULT 0,
      next_run_at INTEGER DEFAULT 0,
      run_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sj_next ON scheduler_jobs(enabled, next_run_at);

    -- Proactive Intelligence: Scheduler Run History
    CREATE TABLE IF NOT EXISTS scheduler_history (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_name TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      status TEXT DEFAULT 'running',
      result TEXT DEFAULT '',
      error TEXT DEFAULT '',
      user_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sh_job ON scheduler_history(job_id, started_at DESC);
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
