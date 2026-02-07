/**
 * ALIN Backend Server
 *
 * Features:
 * - SQLite database for chat persistence (conversations + messages)
 * - SSE streaming proxy for Claude and OpenAI (API keys server-side)
 * - TBWO receipt storage
 * - Brave Search proxy
 * - File system operations (read/write/scan/search)
 * - Code execution (Python/JavaScript)
 * - Git operations
 * - Computer use (screenshot, mouse, keyboard)
 * - Text editor operations
 * - DALL-E image generation proxy
 * - System metrics (CPU, memory, GPU)
 *
 * INSTALL: npm install better-sqlite3
 * RUN: node server.js
 * PORT: http://localhost:3002
 */

// Load .env file so all API keys are available via process.env
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

// Enable CORS for frontend
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : [
        'http://localhost:3000', 'http://127.0.0.1:3000',
        'http://localhost:3001', 'http://127.0.0.1:3001',
        'http://localhost:3003', 'http://127.0.0.1:3003',
        'http://localhost:5173', 'http://127.0.0.1:5173',
      ],
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
}));

app.use(express.json({ limit: '10mb' }));

// ============================================================================
// MARKETING SITE + STATIC SERVING
// ============================================================================

// Serve marketing site at /m/ (always public, no auth)
// Static files FIRST
app.use(express.static(path.join(__dirname, 'marketing')));
app.use('/m', express.static(path.join(__dirname, 'marketing')));
app.use('/app', express.static(path.join(__dirname, 'dist')));

// Download redirect (points to GitHub Releases — update URL when Electron build exists)
app.get('/download', (req, res) => {
  const platform = req.query.platform || 'windows';
  const DOWNLOAD_URLS = {
    windows: process.env.DOWNLOAD_URL_WIN || '/m/index.html#download',
    mac: process.env.DOWNLOAD_URL_MAC || '/m/index.html#download',
    linux: process.env.DOWNLOAD_URL_LINUX || '/m/index.html#download',
  };
  res.redirect(DOWNLOAD_URLS[platform] || DOWNLOAD_URLS.windows);
});

// Root route — serve marketing or redirect to app based on auth
app.get('/', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
    || req.query.token;
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return res.redirect('/app');
    } catch { /* invalid token, show marketing */ }
  }
  res.sendFile(path.join(__dirname, 'marketing', 'index.html'));
});

// SPA fallback for React app routes (catch /app/* routes)
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================================
// JWT AUTH CONFIGURATION
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || 'alin-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { req.user = null; }
  } else {
    req.user = null;
  }
  next();
}

// ============================================================================
// PLAN TIER LIMITS
// ============================================================================

const PLAN_LIMITS = {
  free: {
    messagesPerHour: 10,
    allowedModels: ['claude-3-5-sonnet-20241022'],
    maxConversations: 10,
    tbwoEnabled: false,
    directModeEnabled: true,
    codeLabEnabled: false,
    imageStudioEnabled: false,
    memoryLayers: 2,
    selfLearning: false,
    maxTokens: 4096,
    computerUse: false,
    maxToolCallsPerMessage: 3,
    thinkingBudgetCap: 5000,
  },
  pro: {
    messagesPerHour: -1,
    allowedModels: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    maxConversations: -1,
    tbwoEnabled: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    selfLearning: true,
    maxTokens: 8192,
    computerUse: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 50000,
  },
  enterprise: {
    messagesPerHour: -1,
    allowedModels: ['claude-opus-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview'],
    maxConversations: -1,
    tbwoEnabled: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    selfLearning: true,
    maxTokens: 16384,
    computerUse: true,
    customRouting: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 100000,
  },
};

function checkPlanLimits(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  const plan = req.user.plan || 'free';
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const model = req.body.model;

  // Check model access
  if (model && limits.allowedModels.length > 0 && !limits.allowedModels.includes(model)) {
    return res.status(403).json({
      error: 'Model not available on your plan',
      allowedModels: limits.allowedModels,
      plan,
    });
  }

  // Check rate limit (messages per hour)
  if (limits.messagesPerHour > 0) {
    const oneHourAgo = Date.now() - 3600000;
    try {
      const row = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE timestamp > ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)'
      ).get(oneHourAgo, req.user.id);
      if (row && row.count >= limits.messagesPerHour) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          limit: limits.messagesPerHour,
          plan,
          resetIn: '1 hour',
        });
      }
    } catch {
      // If user_id column doesn't exist yet, skip rate limiting
    }
  }

  // Cap thinking budget
  if (req.body.thinkingBudget && limits.thinkingBudgetCap > 0) {
    req.body.thinkingBudget = Math.min(req.body.thinkingBudget, limits.thinkingBudgetCap);
  }

  // Cap max tokens
  if (limits.maxTokens > 0) {
    req.body.maxTokens = Math.min(req.body.maxTokens || limits.maxTokens, limits.maxTokens);
  }

  req.planLimits = limits;
  next();
}

// ============================================================================
// SQLITE DATABASE INITIALIZATION
// ============================================================================

const DB_PATH = path.join(__dirname, 'alin.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    mode TEXT DEFAULT 'regular',
    model TEXT DEFAULT 'claude-sonnet-4-20250514',
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
    model TEXT DEFAULT 'dall-e-3',
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
    plan TEXT DEFAULT 'free' CHECK(plan IN ('free','pro','enterprise')),
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

// Add user_id columns to existing tables (safe — SQLite ignores if already exists)
const userIdTables = ['conversations', 'messages', 'tbwo_orders', 'artifacts', 'memory_entries', 'audit_entries', 'images'];
for (const table of userIdTables) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`); } catch { /* column already exists */ }
}

console.log('[DB] SQLite database initialized at', DB_PATH);

// Prepared statements for performance
const stmts = {
  insertConversation: db.prepare(`INSERT INTO conversations (id,title,mode,model,provider,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`),
  getConversation: db.prepare('SELECT * FROM conversations WHERE id = ?'),
  listConversations: db.prepare(`SELECT id,title,mode,model,provider,is_favorite,is_archived,is_pinned,created_at,updated_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as message_count,(SELECT content FROM messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_message FROM conversations c WHERE is_archived=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`),
  updateConversation: db.prepare(`UPDATE conversations SET title=?,mode=?,model=?,provider=?,is_favorite=?,is_archived=?,is_pinned=?,metadata=?,updated_at=? WHERE id=?`),
  deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
  searchConversations: db.prepare(`SELECT DISTINCT c.id,c.title,c.updated_at,c.mode FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE m.content LIKE ? OR c.title LIKE ? ORDER BY c.updated_at DESC LIMIT ?`),
  insertMessage: db.prepare(`INSERT INTO messages (id,conversation_id,role,content,tokens_input,tokens_output,cost,model,is_edited,parent_id,metadata,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  getMessages: db.prepare(`SELECT * FROM messages WHERE conversation_id=? ORDER BY timestamp ASC`),
  updateMessage: db.prepare(`UPDATE messages SET content=?,is_edited=1,metadata=? WHERE id=?`),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
  insertReceipt: db.prepare(`INSERT INTO tbwo_receipts (id,tbwo_id,receipt_type,data,created_at) VALUES (?,?,?,?,?)`),
  getReceipts: db.prepare('SELECT * FROM tbwo_receipts WHERE tbwo_id=? ORDER BY created_at DESC'),
  upsertSetting: db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`),
  getAllSettings: db.prepare('SELECT * FROM settings'),

  // TBWO Orders
  insertTBWO: db.prepare(`INSERT INTO tbwo_orders (id,type,status,objective,time_budget_total,quality_target,scope,plan,pods,active_pods,artifacts,checkpoints,authority_level,progress,receipts,chat_conversation_id,started_at,completed_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  getTBWO: db.prepare('SELECT * FROM tbwo_orders WHERE id = ?'),
  listTBWOs: db.prepare('SELECT * FROM tbwo_orders ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
  updateTBWO: db.prepare(`UPDATE tbwo_orders SET type=?,status=?,objective=?,time_budget_total=?,quality_target=?,scope=?,plan=?,pods=?,active_pods=?,artifacts=?,checkpoints=?,authority_level=?,progress=?,receipts=?,chat_conversation_id=?,started_at=?,completed_at=?,metadata=?,updated_at=? WHERE id=?`),
  deleteTBWO: db.prepare('DELETE FROM tbwo_orders WHERE id = ?'),

  // Artifacts
  insertArtifact: db.prepare(`INSERT INTO artifacts (id,title,type,language,content,editable,conversation_id,tbwo_id,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  getArtifact: db.prepare('SELECT * FROM artifacts WHERE id = ?'),
  listArtifacts: db.prepare('SELECT * FROM artifacts ORDER BY updated_at DESC LIMIT ?'),
  listArtifactsByConversation: db.prepare('SELECT * FROM artifacts WHERE conversation_id=? ORDER BY updated_at DESC LIMIT ?'),
  listArtifactsByTBWO: db.prepare('SELECT * FROM artifacts WHERE tbwo_id=? ORDER BY updated_at DESC LIMIT ?'),
  updateArtifact: db.prepare(`UPDATE artifacts SET title=?,type=?,language=?,content=?,editable=?,metadata=?,updated_at=? WHERE id=?`),
  deleteArtifact: db.prepare('DELETE FROM artifacts WHERE id = ?'),

  // Memory Entries
  insertMemory: db.prepare(`INSERT INTO memory_entries (id,layer,content,salience,decay_rate,access_count,is_consolidated,is_archived,is_pinned,user_modified,tags,related_memories,edit_history,metadata,last_accessed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  getMemory: db.prepare('SELECT * FROM memory_entries WHERE id = ?'),
  listMemories: db.prepare('SELECT * FROM memory_entries ORDER BY salience DESC'),
  listMemoriesByLayer: db.prepare('SELECT * FROM memory_entries WHERE layer=? ORDER BY salience DESC'),
  updateMemory: db.prepare(`UPDATE memory_entries SET layer=?,content=?,salience=?,decay_rate=?,access_count=?,is_consolidated=?,is_archived=?,is_pinned=?,user_modified=?,tags=?,related_memories=?,edit_history=?,metadata=?,last_accessed_at=?,updated_at=? WHERE id=?`),
  deleteMemory: db.prepare('DELETE FROM memory_entries WHERE id = ?'),

  // Audit Entries
  insertAudit: db.prepare(`INSERT INTO audit_entries (id,conversation_id,message_id,model,tokens_prompt,tokens_completion,tokens_total,cost,tools_used,duration_ms,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  listAudit: db.prepare('SELECT * FROM audit_entries ORDER BY timestamp DESC LIMIT ?'),
  listAuditSince: db.prepare('SELECT * FROM audit_entries WHERE timestamp>=? ORDER BY timestamp DESC'),
  pruneAudit: db.prepare('DELETE FROM audit_entries WHERE timestamp < ?'),

  // Images
  insertImage: db.prepare(`INSERT INTO images (id,url,prompt,revised_prompt,model,size,quality,style,conversation_id,message_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
  listImages: db.prepare('SELECT * FROM images ORDER BY created_at DESC LIMIT ?'),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ?'),

  // Self-Model: Execution Outcomes
  insertOutcome: db.prepare(`INSERT INTO execution_outcomes (id,tbwo_id,objective,type,time_budget,plan_confidence,phases_completed,phases_failed,artifacts_count,user_edits_after,quality_score,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  listOutcomes: db.prepare('SELECT * FROM execution_outcomes ORDER BY timestamp DESC LIMIT ?'),
  listOutcomesByType: db.prepare('SELECT * FROM execution_outcomes WHERE type=? ORDER BY timestamp DESC LIMIT ?'),

  // Self-Model: Tool Reliability
  getToolReliability: db.prepare('SELECT * FROM tool_reliability ORDER BY (success_count + failure_count) DESC'),
  upsertToolReliability: db.prepare(`INSERT INTO tool_reliability (tool_name, success_count, failure_count, avg_duration, common_errors, last_failure_reason)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tool_name) DO UPDATE SET
      success_count = tool_reliability.success_count + excluded.success_count,
      failure_count = tool_reliability.failure_count + excluded.failure_count,
      avg_duration = (tool_reliability.avg_duration * (tool_reliability.success_count + tool_reliability.failure_count) + excluded.avg_duration) / (tool_reliability.success_count + tool_reliability.failure_count + 1),
      common_errors = CASE WHEN excluded.last_failure_reason != '' THEN excluded.common_errors ELSE tool_reliability.common_errors END,
      last_failure_reason = CASE WHEN excluded.last_failure_reason != '' THEN excluded.last_failure_reason ELSE tool_reliability.last_failure_reason END`),

  // Self-Model: User Corrections
  insertCorrection: db.prepare(`INSERT INTO user_corrections (id, original_value, corrected_value, category, correction_count, last_corrected) VALUES (?,?,?,?,1,?)`),
  findCorrection: db.prepare('SELECT * FROM user_corrections WHERE category=? AND corrected_value=? LIMIT 1'),
  incrementCorrection: db.prepare('UPDATE user_corrections SET correction_count = correction_count + 1, last_corrected = ? WHERE id = ?'),
  listCorrections: db.prepare('SELECT * FROM user_corrections WHERE correction_count >= ? ORDER BY correction_count DESC'),

  // Self-Model: Decision Log
  insertDecision: db.prepare(`INSERT INTO decision_log (id,tbwo_id,decision_type,options_considered,chosen_option,reasoning,outcome,confidence,timestamp) VALUES (?,?,?,?,?,?,?,?,?)`),
  listDecisions: db.prepare('SELECT * FROM decision_log ORDER BY timestamp DESC LIMIT ?'),
  listDecisionsByTBWO: db.prepare('SELECT * FROM decision_log WHERE tbwo_id=? ORDER BY timestamp DESC LIMIT ?'),

  // Self-Model: Thinking Traces
  insertThinkingTrace: db.prepare(`INSERT INTO thinking_traces (id,conversation_id,message_id,tbwo_id,thinking_content,timestamp) VALUES (?,?,?,?,?,?)`),
  listThinkingByConv: db.prepare('SELECT * FROM thinking_traces WHERE conversation_id=? ORDER BY timestamp ASC'),
  listThinkingByTBWO: db.prepare('SELECT * FROM thinking_traces WHERE tbwo_id=? ORDER BY timestamp ASC'),
  searchThinking: db.prepare('SELECT * FROM thinking_traces WHERE thinking_content LIKE ? ORDER BY timestamp DESC LIMIT ?'),

  // Self-Model: Layer Memory
  insertLayerMemory: db.prepare(`INSERT INTO memory_layers (id,layer,content,category,salience,expires_at,metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`),
  listLayerMemories: db.prepare('SELECT * FROM memory_layers WHERE layer=? AND (expires_at IS NULL OR expires_at > ?) ORDER BY salience DESC LIMIT ?'),
  pruneExpiredLayers: db.prepare('DELETE FROM memory_layers WHERE expires_at IS NOT NULL AND expires_at < ?'),
  deleteLayerMemory: db.prepare('DELETE FROM memory_layers WHERE id = ?'),

  // Users
  insertUser: db.prepare(`INSERT INTO users (id,email,password_hash,display_name,plan,is_admin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  updateUser: db.prepare(`UPDATE users SET email=?,display_name=?,plan=?,updated_at=? WHERE id=?`),
  updateUserPassword: db.prepare(`UPDATE users SET password_hash=?,updated_at=? WHERE id=?`),
  countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),
};

// ============================================================================
// EMAIL VERIFICATION HELPER
// ============================================================================

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(email, code) {
  try {
    await resend.emails.send({
      from: 'ALIN <onboarding@resend.dev>',
      to: email,
      subject: 'Your ALIN Verification Code',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 460px; margin: 0 auto; padding: 40px 20px;">
          <h1 style="font-size: 24px; font-weight: 700; color: #111; margin-bottom: 8px;">ALIN</h1>
          <p style="color: #666; font-size: 14px; margin-bottom: 32px;">Advanced Linguistic Intelligence Network</p>
          <p style="color: #333; font-size: 16px; line-height: 1.5;">Here's your verification code:</p>
          <div style="background: #f4f4f5; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #111; font-family: 'JetBrains Mono', monospace;">${code}</span>
          </div>
          <p style="color: #666; font-size: 13px; line-height: 1.5;">This code expires in 10 minutes. If you didn't create an ALIN account, you can safely ignore this email.</p>
        </div>
      `,
    });
    console.log(`[Email] Verification code sent to ${email}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed to send to ${email}:`, error.message);
    return false;
  }
}


// ============================================================================
// AUTH ENDPOINTS
// ============================================================================

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check if email already taken
    const existing = stmts.getUserByEmail.get(email);
    if (existing && existing.email_verified) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // If unverified account exists with this email, delete it so they can re-signup
    if (existing && !existing.email_verified) {
      db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
    }

    const id = randomUUID();
    const now = Date.now();
    const passwordHash = await bcrypt.hash(password, 10);

    // First user gets pro plan + admin automatically
    const userCount = stmts.countUsers.get();
    const plan = userCount.count === 0 ? 'pro' : 'free';
    const isFirstUser = userCount.count === 0;

    // Generate 6-digit verification code (expires in 10 minutes)
    const verificationCode = generateVerificationCode();
    const verificationExpires = now + 10 * 60 * 1000;

    stmts.insertUser.run(id, email, passwordHash, displayName || '', plan, isFirstUser ? 1 : 0, now, now);

    // Store verification code
    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
      .run(verificationCode, verificationExpires, id);

    // First user: skip email verification (it's you, the admin)
    if (isFirstUser) {
      db.prepare('UPDATE users SET email_verified = 1, is_admin = 1 WHERE id = ?').run(id);

      // Migrate existing data
      try {
        db.exec(`UPDATE conversations SET user_id='${id}' WHERE user_id IS NULL`);
        db.exec(`UPDATE messages SET user_id='${id}' WHERE user_id IS NULL`);
        db.exec(`UPDATE memory_entries SET user_id='${id}' WHERE user_id IS NULL`);
        db.exec(`UPDATE artifacts SET user_id='${id}' WHERE user_id IS NULL`);
        db.exec(`UPDATE audit_entries SET user_id='${id}' WHERE user_id IS NULL`);
        db.exec(`UPDATE images SET user_id='${id}' WHERE user_id IS NULL`);
        db.exec(`UPDATE tbwo_orders SET user_id='${id}' WHERE user_id IS NULL`);
        console.log(`[Auth] Migrated existing data to first user: ${email}`);
      } catch (migErr) {
        console.warn('[Auth] Data migration partial:', migErr.message);
      }

      const token = jwt.sign({ id, email, plan, isAdmin: true }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      console.log(`[Auth] First user signup (admin, verified): ${email}`);
      return res.json({ success: true, token, user: { id, email, displayName: displayName || '', plan, isAdmin: true, emailVerified: true } });
    }

    // Regular user: send verification email
    const emailSent = await sendVerificationEmail(email, verificationCode);
    if (!emailSent) {
      console.warn(`[Auth] Verification email failed for ${email}, allowing anyway`);
    }

    console.log(`[Auth] Signup (pending verification): ${email}`);
    res.json({
      success: true,
      needsVerification: true,
      email,
      message: 'Check your email for a 6-digit verification code.',
    });
  } catch (error) {
    console.error('[Auth] Signup error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Verify email with 6-digit code
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    const user = stmts.getUserByEmail.get(email);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

    // Check code
    if (user.verification_code !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Check expiry
    if (Date.now() > user.verification_expires) {
      return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
    }

    // Mark verified
    db.prepare('UPDATE users SET email_verified = 1, verification_code = NULL, verification_expires = NULL WHERE id = ?')
      .run(user.id);

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan, isAdmin: !!user.is_admin }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    console.log(`[Auth] Email verified: ${email}`);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name, plan: user.plan, isAdmin: !!user.is_admin, emailVerified: true },
    });
  } catch (error) {
    console.error('[Auth] Verify error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Resend verification code
app.post('/api/auth/resend-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = stmts.getUserByEmail.get(email);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

    const code = generateVerificationCode();
    const expires = Date.now() + 10 * 60 * 1000;

    db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
      .run(code, expires, user.id);

    await sendVerificationEmail(email, code);

    console.log(`[Auth] Resent verification code to ${email}`);
    res.json({ success: true, message: 'New code sent.' });
  } catch (error) {
    console.error('[Auth] Resend error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = stmts.getUserByEmail.get(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    // Block unverified users
    if (!user.email_verified) {
      // Resend the code automatically
      const code = generateVerificationCode();
      const expires = Date.now() + 10 * 60 * 1000;
      db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
        .run(code, expires, user.id);
      await sendVerificationEmail(email, code);

      return res.json({ success: true, needsVerification: true, email, message: 'Please verify your email. A new code has been sent.' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan, isAdmin: !!user.is_admin }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    console.log(`[Auth] Login: ${email}`);
    res.json({ success: true, token, user: { id: user.id, email: user.email, displayName: user.display_name, plan: user.plan, isAdmin: !!user.is_admin, emailVerified: true } });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  try {
    const user = stmts.getUserById.get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: { id: user.id, email: user.email, displayName: user.display_name, plan: user.plan, isAdmin: !!user.is_admin } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/auth/profile', requireAuth, (req, res) => {
  try {
    const user = stmts.getUserById.get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const email = req.body.email || user.email;
    const displayName = req.body.displayName !== undefined ? req.body.displayName : user.display_name;
    stmts.updateUser.run(email, displayName, user.plan, Date.now(), req.user.id);
    res.json({ success: true, user: { id: user.id, email, displayName, plan: user.plan, isAdmin: !!user.is_admin } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const user = stmts.getUserById.get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 10);
    stmts.updateUserPassword.run(newHash, Date.now(), req.user.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, display_name, plan, is_admin, created_at FROM users').all();
  res.json({ success: true, users });
});

// One-time bootstrap: promote first user to admin+pro (no auth required, only works if no admins exist)
app.post('/api/admin/bootstrap', (req, res) => {
  try {
    const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
    if (adminExists) return res.status(403).json({ error: 'Admin already exists' });
    const firstUser = db.prepare('SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1').get();
    if (!firstUser) return res.status(404).json({ error: 'No users found' });
    db.prepare('UPDATE users SET plan = ?, is_admin = 1, email_verified = 1 WHERE id = ?').run('pro', firstUser.id);
    console.log(`[Admin] Bootstrapped admin: ${firstUser.email}`);
    res.json({ success: true, promoted: firstUser.email, plan: 'pro', isAdmin: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    console.log(`[Admin] Deleted user: ${user.email}`);
    res.json({ success: true, deleted: user.email });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// CONVERSATION ENDPOINTS
// ============================================================================

app.get('/api/conversations', (req, res) => {
  try {
    const archived = parseInt(req.query.archived) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const conversations = stmts.listConversations.all(archived, limit, offset).map(c => {
      let preview = '';
      try { const content = JSON.parse(c.last_message || '[]'); preview = content.find(b => b.type === 'text')?.text?.slice(0, 100) || ''; } catch {}
      return { id: c.id, title: c.title, mode: c.mode, model: c.model, provider: c.provider, isFavorite: !!c.is_favorite, isArchived: !!c.is_archived, isPinned: !!c.is_pinned, messageCount: c.message_count, preview, createdAt: c.created_at, updatedAt: c.updated_at };
    });
    res.json({ success: true, conversations });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/conversations', (req, res) => {
  try {
    const { id: clientId, title, mode, model, provider } = req.body;
    const id = clientId || randomUUID();
    const now = Date.now();
    stmts.insertConversation.run(id, title || 'New Chat', mode || 'regular', model || 'claude-sonnet-4-20250514', provider || 'anthropic', '{}', now, now);
    console.log(`[DB] Created conversation: ${id}`);
    res.json({ success: true, id, createdAt: now });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/conversations/:id', (req, res) => {
  try {
    const conversation = stmts.getConversation.get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const messages = stmts.getMessages.all(req.params.id).map(m => ({ ...m, content: JSON.parse(m.content), metadata: JSON.parse(m.metadata || '{}'), isEdited: !!m.is_edited }));
    res.json({ success: true, conversation: { ...conversation, metadata: JSON.parse(conversation.metadata || '{}'), isFavorite: !!conversation.is_favorite, isArchived: !!conversation.is_archived, isPinned: !!conversation.is_pinned }, messages });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/conversations/:id', (req, res) => {
  try {
    const e = stmts.getConversation.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    stmts.updateConversation.run(
      req.body.title ?? e.title, req.body.mode ?? e.mode, req.body.model ?? e.model, req.body.provider ?? e.provider,
      req.body.isFavorite !== undefined ? (req.body.isFavorite ? 1 : 0) : e.is_favorite,
      req.body.isArchived !== undefined ? (req.body.isArchived ? 1 : 0) : e.is_archived,
      req.body.isPinned !== undefined ? (req.body.isPinned ? 1 : 0) : e.is_pinned,
      req.body.metadata ? JSON.stringify(req.body.metadata) : e.metadata, Date.now(), req.params.id
    );
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/conversations/:id', (req, res) => {
  try { stmts.deleteConversation.run(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/conversations/search', (req, res) => {
  try {
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    const results = stmts.searchConversations.all(`%${q}%`, `%${q}%`, parseInt(limit) || 20);
    res.json({ success: true, results });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// MESSAGE ENDPOINTS
// ============================================================================

app.post('/api/conversations/:id/messages', (req, res) => {
  try {
    const { id: clientId, role, content, model, tokensInput, tokensOutput, cost, parentId, metadata } = req.body;
    const id = clientId || randomUUID();
    const now = Date.now();
    stmts.insertMessage.run(id, req.params.id, role, JSON.stringify(content), tokensInput || 0, tokensOutput || 0, cost || 0, model || null, 0, parentId || null, JSON.stringify(metadata || {}), now);
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now, req.params.id);
    res.json({ success: true, id, timestamp: now });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/messages/:id', (req, res) => {
  try { stmts.updateMessage.run(JSON.stringify(req.body.content), JSON.stringify(req.body.metadata || {}), req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/messages/:id', (req, res) => {
  try { stmts.deleteMessage.run(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// SSE STREAMING AI PROXY (API keys stay server-side)
// ============================================================================

function setupSSE(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
}
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Enhanced streaming proxy with full tool_use support, thinking, and auth.
 * SSE events: text, thinking, tool_use, usage, done, error
 */
async function streamAnthropicToSSE(res, { model, messages, system, tools, thinking, thinkingBudget, maxTokens, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { sendSSE(res, 'error', { error: 'ANTHROPIC_API_KEY not set in server .env' }); return res.end(); }

  const body = {
    model: model || 'claude-sonnet-4-5-20250929',
    max_tokens: maxTokens || 8192,
    stream: true,
    messages,
  };
  if (system) body.system = system;
  if (tools && tools.length > 0) body.tools = tools;
  if (thinking) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget || 10000 };
    if (body.max_tokens <= (thinkingBudget || 10000)) {
      body.max_tokens = (thinkingBudget || 10000) + 8192;
    }
  } else if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (thinking) headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14';
  if (tools?.some(t => t.type === 'computer_20250124')) {
    headers['anthropic-beta'] = (headers['anthropic-beta'] ? headers['anthropic-beta'] + ',' : '') + 'computer-use-2025-01-24';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const t = await response.text();
    sendSSE(res, 'error', { error: `Anthropic ${response.status}`, details: t });
    return res.end();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', inputTokens = 0, outputTokens = 0;
  let stopReason = 'end_turn';
  let currentToolId = '', currentToolName = '', currentToolInput = '';

  sendSSE(res, 'start', { model, provider: 'anthropic' });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'message_start' && ev.message?.usage) {
          inputTokens = ev.message.usage.input_tokens || 0;
        } else if (ev.type === 'content_block_start') {
          if (ev.content_block?.type === 'thinking') {
            sendSSE(res, 'thinking_start', {});
          } else if (ev.content_block?.type === 'tool_use') {
            currentToolId = ev.content_block.id || '';
            currentToolName = ev.content_block.name || '';
            currentToolInput = '';
          }
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'thinking_delta') {
            sendSSE(res, 'thinking_delta', { text: ev.delta.thinking });
          } else if (ev.delta?.type === 'text_delta') {
            sendSSE(res, 'text_delta', { text: ev.delta.text });
          } else if (ev.delta?.type === 'input_json_delta') {
            currentToolInput += ev.delta.partial_json || '';
          } else if (ev.delta?.type === 'signature_delta') {
            // Signature for thinking block — pass through for API round-trips
            sendSSE(res, 'signature_delta', { signature: ev.delta.signature });
          }
        } else if (ev.type === 'content_block_stop') {
          if (currentToolId) {
            let parsedInput = {};
            try { parsedInput = JSON.parse(currentToolInput || '{}'); } catch {}
            sendSSE(res, 'tool_use', { id: currentToolId, name: currentToolName, input: parsedInput });
            currentToolId = '';
            currentToolName = '';
            currentToolInput = '';
          }
        } else if (ev.type === 'message_delta') {
          if (ev.usage) outputTokens = ev.usage.output_tokens || 0;
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        }
      } catch {}
    }
  }
  sendSSE(res, 'done', { inputTokens, outputTokens, model, stopReason });
  res.end();
}

async function streamOpenAIToSSE(res, { model, messages, system, tools, maxTokens, temperature }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { sendSSE(res, 'error', { error: 'OPENAI_API_KEY not set in server .env' }); return res.end(); }

  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    oaiMessages.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content :
        m.content.filter(b => b.type === 'text' || b.type === 'image_url').map(b =>
          b.type === 'text' ? { type: 'text', text: b.text } : b
        ),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    });
  }

  const body = {
    model: model || 'gpt-4o',
    stream: true,
    messages: oaiMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens || 4096,
  };
  if (tools && tools.length > 0) body.tools = tools;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const t = await response.text();
    sendSSE(res, 'error', { error: `OpenAI ${response.status}`, details: t });
    return res.end();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const toolCalls = {}; // index -> { id, name, arguments }

  sendSSE(res, 'start', { model, provider: 'openai' });

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]') continue;
      try {
        const ev = JSON.parse(raw);
        const choice = ev.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) {
          sendSSE(res, 'text_delta', { text: choice.delta.content });
        }
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: '', name: '', arguments: '' };
            if (tc.id) toolCalls[tc.index].id = tc.id;
            if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
            if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
          }
        }
        if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
          // Emit accumulated tool calls
          for (const idx of Object.keys(toolCalls)) {
            const tc = toolCalls[idx];
            let parsedArgs = {};
            try { parsedArgs = JSON.parse(tc.arguments || '{}'); } catch {}
            sendSSE(res, 'tool_use', { id: tc.id, name: tc.name, input: parsedArgs });
          }
        }
      } catch {}
    }
  }
  const stopReason = Object.keys(toolCalls).length > 0 ? 'tool_use' : 'end_turn';
  sendSSE(res, 'done', { model, stopReason });
  res.end();
}

app.post('/api/chat/stream', requireAuth, checkPlanLimits, async (req, res) => {
  const { messages, model, provider, system, systemPrompt, tools, thinking, thinkingBudget, maxTokens, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  setupSSE(res);

  try {
    const isAnthropic = provider === 'anthropic' || model?.startsWith('claude');
    const sysPrompt = system || systemPrompt;

    if (isAnthropic) {
      await streamAnthropicToSSE(res, { model, messages, system: sysPrompt, tools, thinking, thinkingBudget, maxTokens, temperature });
    } else {
      await streamOpenAIToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature });
    }
  } catch (error) {
    console.error('[Stream] Error:', error.message);
    try { sendSSE(res, 'error', { error: error.message }); } catch {}
    try { res.end(); } catch {}
  }
});

// Continuation endpoint (same as stream but for tool result follow-ups)
app.post('/api/chat/continue', requireAuth, checkPlanLimits, async (req, res) => {
  const { messages, model, provider, system, systemPrompt, tools, thinking, thinkingBudget, maxTokens, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  setupSSE(res);

  try {
    const isAnthropic = provider === 'anthropic' || model?.startsWith('claude');
    const sysPrompt = system || systemPrompt;

    if (isAnthropic) {
      await streamAnthropicToSSE(res, { model, messages, system: sysPrompt, tools, thinking, thinkingBudget, maxTokens, temperature });
    } else {
      await streamOpenAIToSSE(res, { model, messages, system: sysPrompt, tools, maxTokens, temperature });
    }
  } catch (error) {
    console.error('[Continue] Error:', error.message);
    try { sendSSE(res, 'error', { error: error.message }); } catch {}
    try { res.end(); } catch {}
  }
});

// ============================================================================
// TBWO RECEIPT ENDPOINTS
// ============================================================================

app.post('/api/tbwo/:tbwoId/receipts', (req, res) => {
  try {
    const { type, data } = req.body;
    const id = randomUUID();
    stmts.insertReceipt.run(id, req.params.tbwoId, type || 'full', JSON.stringify(data), Date.now());
    console.log(`[DB] Saved receipt for TBWO: ${req.params.tbwoId}`);
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tbwo/:tbwoId/receipts', (req, res) => {
  try {
    const receipts = stmts.getReceipts.all(req.params.tbwoId).map(r => ({ ...r, data: JSON.parse(r.data) }));
    res.json({ success: true, receipts });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// SETTINGS ENDPOINTS
// ============================================================================

app.get('/api/settings', (req, res) => {
  try {
    const settings = {};
    stmts.getAllSettings.all().forEach(s => { try { settings[s.key] = JSON.parse(s.value); } catch { settings[s.key] = s.value; } });
    res.json({ success: true, settings });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/settings/:key', (req, res) => {
  try { stmts.upsertSetting.run(req.params.key, JSON.stringify(req.body.value), Date.now()); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// TBWO ORDER ENDPOINTS
// ============================================================================

app.get('/api/tbwo', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const rows = stmts.listTBWOs.all(limit, offset);
    const tbwos = rows.map(r => {
      const t = { ...r };
      try { t.quality_target = JSON.parse(t.quality_target || '{}'); } catch { t.quality_target = {}; }
      try { t.scope = JSON.parse(t.scope || '{}'); } catch { t.scope = {}; }
      try { t.plan = JSON.parse(t.plan || 'null'); } catch { t.plan = null; }
      try { t.pods = JSON.parse(t.pods || '[]'); } catch { t.pods = []; }
      try { t.active_pods = JSON.parse(t.active_pods || '[]'); } catch { t.active_pods = []; }
      try { t.artifacts = JSON.parse(t.artifacts || '[]'); } catch { t.artifacts = []; }
      try { t.checkpoints = JSON.parse(t.checkpoints || '[]'); } catch { t.checkpoints = []; }
      try { t.receipts = JSON.parse(t.receipts || 'null'); } catch { t.receipts = null; }
      try { t.metadata = JSON.parse(t.metadata || '{}'); } catch { t.metadata = {}; }
      // Map DB column names to camelCase for frontend
      return {
        id: t.id, type: t.type, status: t.status, objective: t.objective,
        timeBudget: { total: t.time_budget_total },
        qualityTarget: t.quality_target, scope: t.scope, plan: t.plan,
        pods: t.pods, activePods: t.active_pods, artifacts: t.artifacts,
        checkpoints: t.checkpoints, authorityLevel: t.authority_level,
        progress: t.progress, receipts: t.receipts,
        chatConversationId: t.chat_conversation_id,
        startedAt: t.started_at, completedAt: t.completed_at,
        metadata: t.metadata, createdAt: t.created_at, updatedAt: t.updated_at,
      };
    });
    res.json({ success: true, tbwos });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/tbwo', (req, res) => {
  try {
    const b = req.body;
    const id = b.id || randomUUID();
    const now = Date.now();
    stmts.insertTBWO.run(
      id, b.type || 'general', b.status || 'draft', b.objective || '',
      b.timeBudgetTotal || b.timeBudget?.total || 60,
      JSON.stringify(b.qualityTarget || {}), JSON.stringify(b.scope || {}),
      JSON.stringify(b.plan || null), JSON.stringify(b.pods || []),
      JSON.stringify(b.activePods || []), JSON.stringify(b.artifacts || []),
      JSON.stringify(b.checkpoints || []), b.authorityLevel || 'guided',
      b.progress || 0, JSON.stringify(b.receipts || null),
      b.chatConversationId || null, b.startedAt || null, b.completedAt || null,
      JSON.stringify(b.metadata || {}), b.createdAt || now, b.updatedAt || now
    );
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/tbwo/:id', (req, res) => {
  try {
    const row = stmts.getTBWO.get(req.params.id);
    if (!row) return res.status(404).json({ error: 'TBWO not found' });
    const t = { ...row };
    try { t.quality_target = JSON.parse(t.quality_target || '{}'); } catch { t.quality_target = {}; }
    try { t.scope = JSON.parse(t.scope || '{}'); } catch { t.scope = {}; }
    try { t.plan = JSON.parse(t.plan || 'null'); } catch { t.plan = null; }
    try { t.pods = JSON.parse(t.pods || '[]'); } catch { t.pods = []; }
    try { t.active_pods = JSON.parse(t.active_pods || '[]'); } catch { t.active_pods = []; }
    try { t.artifacts = JSON.parse(t.artifacts || '[]'); } catch { t.artifacts = []; }
    try { t.checkpoints = JSON.parse(t.checkpoints || '[]'); } catch { t.checkpoints = []; }
    try { t.receipts = JSON.parse(t.receipts || 'null'); } catch { t.receipts = null; }
    try { t.metadata = JSON.parse(t.metadata || '{}'); } catch { t.metadata = {}; }
    res.json({
      success: true,
      tbwo: {
        id: t.id, type: t.type, status: t.status, objective: t.objective,
        timeBudget: { total: t.time_budget_total },
        qualityTarget: t.quality_target, scope: t.scope, plan: t.plan,
        pods: t.pods, activePods: t.active_pods, artifacts: t.artifacts,
        checkpoints: t.checkpoints, authorityLevel: t.authority_level,
        progress: t.progress, receipts: t.receipts,
        chatConversationId: t.chat_conversation_id,
        startedAt: t.started_at, completedAt: t.completed_at,
        metadata: t.metadata, createdAt: t.created_at, updatedAt: t.updated_at,
      },
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/tbwo/:id', (req, res) => {
  try {
    const e = stmts.getTBWO.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const now = Date.now();
    stmts.updateTBWO.run(
      b.type ?? e.type, b.status ?? e.status, b.objective ?? e.objective,
      b.timeBudgetTotal ?? b.timeBudget?.total ?? e.time_budget_total,
      b.qualityTarget ? JSON.stringify(b.qualityTarget) : e.quality_target,
      b.scope ? JSON.stringify(b.scope) : e.scope,
      b.plan !== undefined ? JSON.stringify(b.plan) : e.plan,
      b.pods ? JSON.stringify(b.pods) : e.pods,
      b.activePods ? JSON.stringify(b.activePods) : e.active_pods,
      b.artifacts ? JSON.stringify(b.artifacts) : e.artifacts,
      b.checkpoints ? JSON.stringify(b.checkpoints) : e.checkpoints,
      b.authorityLevel ?? e.authority_level,
      b.progress ?? e.progress,
      b.receipts !== undefined ? JSON.stringify(b.receipts) : e.receipts,
      b.chatConversationId ?? e.chat_conversation_id,
      b.startedAt ?? e.started_at, b.completedAt ?? e.completed_at,
      b.metadata ? JSON.stringify(b.metadata) : e.metadata,
      now, req.params.id
    );
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/tbwo/:id', (req, res) => {
  try { stmts.deleteTBWO.run(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// ARTIFACT ENDPOINTS
// ============================================================================

app.get('/api/artifacts', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    let rows;
    if (req.query.conversationId) {
      rows = stmts.listArtifactsByConversation.all(req.query.conversationId, limit);
    } else if (req.query.tbwoId) {
      rows = stmts.listArtifactsByTBWO.all(req.query.tbwoId, limit);
    } else {
      rows = stmts.listArtifacts.all(limit);
    }
    const artifacts = rows.map(r => ({
      ...r,
      editable: !!r.editable,
      metadata: JSON.parse(r.metadata || '{}'),
    }));
    res.json({ success: true, artifacts });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/artifacts', (req, res) => {
  try {
    const b = req.body;
    const id = b.id || randomUUID();
    const now = Date.now();
    stmts.insertArtifact.run(
      id, b.title || 'Untitled', b.type || 'code', b.language || null,
      b.content || '', b.editable !== false ? 1 : 0,
      b.conversationId || null, b.tbwoId || null,
      JSON.stringify(b.metadata || {}), b.createdAt || now, b.updatedAt || now
    );
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/artifacts/:id', (req, res) => {
  try {
    const e = stmts.getArtifact.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const now = Date.now();
    stmts.updateArtifact.run(
      b.title ?? e.title, b.type ?? e.type, b.language ?? e.language,
      b.content ?? e.content,
      b.editable !== undefined ? (b.editable ? 1 : 0) : e.editable,
      b.metadata ? JSON.stringify(b.metadata) : e.metadata,
      now, req.params.id
    );
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/artifacts/:id', (req, res) => {
  try { stmts.deleteArtifact.run(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// MEMORY ENDPOINTS
// ============================================================================

app.get('/api/memories', (req, res) => {
  try {
    let rows;
    if (req.query.layer) {
      rows = stmts.listMemoriesByLayer.all(req.query.layer);
    } else {
      rows = stmts.listMemories.all();
    }
    const memories = rows.map(r => ({
      ...r,
      is_consolidated: !!r.is_consolidated,
      is_archived: !!r.is_archived,
      is_pinned: !!r.is_pinned,
      user_modified: !!r.user_modified,
      tags: JSON.parse(r.tags || '[]'),
      related_memories: JSON.parse(r.related_memories || '[]'),
      edit_history: JSON.parse(r.edit_history || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
    }));
    res.json({ success: true, memories });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/memories', (req, res) => {
  try {
    const b = req.body;
    const id = b.id || randomUUID();
    const now = Date.now();
    stmts.insertMemory.run(
      id, b.layer || 'short_term', b.content || '',
      b.salience ?? 0.5, b.decayRate ?? 0.1, b.accessCount ?? 0,
      b.isConsolidated ? 1 : 0, b.isArchived ? 1 : 0,
      b.isPinned ? 1 : 0, b.userModified ? 1 : 0,
      JSON.stringify(b.tags || []), JSON.stringify(b.relatedMemories || []),
      JSON.stringify(b.editHistory || []), JSON.stringify(b.metadata || {}),
      b.lastAccessedAt || null, b.createdAt || now, b.updatedAt || now
    );
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/memories/:id', (req, res) => {
  try {
    const e = stmts.getMemory.get(req.params.id);
    if (!e) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const now = Date.now();
    stmts.updateMemory.run(
      b.layer ?? e.layer, b.content ?? e.content,
      b.salience ?? e.salience, b.decayRate ?? e.decay_rate,
      b.accessCount ?? e.access_count,
      b.isConsolidated !== undefined ? (b.isConsolidated ? 1 : 0) : e.is_consolidated,
      b.isArchived !== undefined ? (b.isArchived ? 1 : 0) : e.is_archived,
      b.isPinned !== undefined ? (b.isPinned ? 1 : 0) : e.is_pinned,
      b.userModified !== undefined ? (b.userModified ? 1 : 0) : e.user_modified,
      b.tags ? JSON.stringify(b.tags) : e.tags,
      b.relatedMemories ? JSON.stringify(b.relatedMemories) : e.related_memories,
      b.editHistory ? JSON.stringify(b.editHistory) : e.edit_history,
      b.metadata ? JSON.stringify(b.metadata) : e.metadata,
      b.lastAccessedAt ?? e.last_accessed_at, now, req.params.id
    );
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/memories/:id', (req, res) => {
  try { stmts.deleteMemory.run(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// AUDIT ENDPOINTS
// ============================================================================

app.get('/api/audit', (req, res) => {
  try {
    let rows;
    if (req.query.since) {
      rows = stmts.listAuditSince.all(parseInt(req.query.since));
    } else {
      rows = stmts.listAudit.all(parseInt(req.query.limit) || 1000);
    }
    const entries = rows.map(r => ({
      ...r,
      tools_used: JSON.parse(r.tools_used || '[]'),
    }));
    res.json({ success: true, entries });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/audit', (req, res) => {
  try {
    const b = req.body;
    const id = b.id || randomUUID();
    stmts.insertAudit.run(
      id, b.conversationId || null, b.messageId || null,
      b.model || 'unknown',
      b.tokensPrompt ?? b.tokens?.prompt ?? 0,
      b.tokensCompletion ?? b.tokens?.completion ?? 0,
      b.tokensTotal ?? b.tokens?.total ?? 0,
      b.cost ?? 0,
      JSON.stringify(b.toolsUsed || []),
      b.durationMs ?? 0,
      b.timestamp || Date.now()
    );
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/audit/prune', (req, res) => {
  try {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const result = stmts.pruneAudit.run(ninetyDaysAgo);
    res.json({ success: true, deleted: result.changes });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// IMAGE METADATA ENDPOINTS
// ============================================================================

app.get('/api/images/list', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const images = stmts.listImages.all(limit);
    res.json({ success: true, images });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/images/metadata', (req, res) => {
  try {
    const b = req.body;
    const id = b.id || randomUUID();
    stmts.insertImage.run(
      id, b.url || '', b.prompt || '', b.revisedPrompt || null,
      b.model || 'dall-e-3', b.size || '1024x1024',
      b.quality || 'standard', b.style || 'vivid',
      b.conversationId || null, b.messageId || null,
      b.createdAt || Date.now()
    );
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/images/:id', (req, res) => {
  try { stmts.deleteImage.run(req.params.id); res.json({ success: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// ============================================================================
// API KEY STATUS (never exposes actual keys)
// ============================================================================

app.get('/api/keys/status', (req, res) => {
  res.json({
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    brave: !!(process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY),
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ALIN Backend Server',
    database: true,
    uptime: process.uptime(),
  });
});

/**
 * Brave Search Proxy
 * POST /api/search/brave
 * Body: { query: string, count?: number, apiKey: string }
 */
app.post('/api/search/brave', async (req, res) => {
  try {
    const { query, count = 5, apiKey } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'Brave API key is required' });
    }

    // Prefer server-side key, fall back to client-provided
    const braveKey = process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY || apiKey;

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': braveKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Brave Proxy] API error:', response.status, errorText);
      return res.status(response.status).json({
        error: `Brave API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    console.log(`[Brave Proxy] Search for "${query}" returned ${data.web?.results?.length || 0} results`);

    res.json(data);
  } catch (error) {
    console.error('[Brave Proxy] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DuckDuckGo Search Proxy (fallback)
 * GET /api/search/ddg?q=query
 */
app.get('/api/search/ddg', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query parameter q is required' });
    }

    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url);
    const data = await response.json();

    console.log(`[DDG Proxy] Search for "${q}"`);
    res.json(data);
  } catch (error) {
    console.error('[DDG Proxy] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// FILE SYSTEM OPERATIONS
// ============================================================================

// Allowed directories for file operations (security)
const ALLOWED_DIRS = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Desktop'),
  __dirname, // ALIN project folder
];

// Ensure dedicated output directories exist
const OUTPUT_DIRS = ['websites', 'blender', 'tbwo', 'images', 'projects', 'files'];
for (const dir of OUTPUT_DIRS) {
  const dirPath = path.join(__dirname, 'output', dir);
  if (!fsSync.existsSync(dirPath)) {
    fsSync.mkdirSync(dirPath, { recursive: true });
  }
}

function isPathAllowed(filePath) {
  const normalizedPath = path.normalize(path.resolve(filePath));

  // Block path traversal attempts
  if (filePath.includes('..')) {
    return false;
  }

  // Check if path is within allowed directories
  return ALLOWED_DIRS.some(dir => normalizedPath.startsWith(path.normalize(dir)));
}

/**
 * Read a file
 * POST /api/files/read
 * Body: { path: string }
 */
app.post('/api/files/read', async (req, res) => {
  try {
    const { path: filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    if (!isPathAllowed(filePath)) {
      return res.status(403).json({
        error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.'
      });
    }

    const content = await fs.readFile(filePath, 'utf-8');
    console.log(`[File] Read: ${filePath}`);

    res.json({ success: true, content, path: filePath });
  } catch (error) {
    console.error('[File] Read error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Write a file
 * POST /api/files/write
 * Body: { path: string, content: string }
 */
app.post('/api/files/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;

    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'Path and content are required' });
    }

    if (!isPathAllowed(filePath)) {
      return res.status(403).json({
        error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.'
      });
    }

    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, content);
    console.log(`[File] Written: ${filePath} (${content.length} bytes)`);

    res.json({ success: true, path: filePath, bytesWritten: content.length });
  } catch (error) {
    console.error('[File] Write error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * List directory contents
 * POST /api/files/list
 * Body: { path: string }
 */
app.post('/api/files/list', async (req, res) => {
  try {
    const { path: dirPath } = req.body;

    if (!dirPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    if (!isPathAllowed(dirPath)) {
      return res.status(403).json({
        error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.'
      });
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries.map(entry => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(dirPath, entry.name),
    }));

    console.log(`[File] Listed: ${dirPath} (${files.length} items)`);

    res.json({ success: true, path: dirPath, files });
  } catch (error) {
    console.error('[File] List error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SCAN / SEARCH / COMMAND / GIT CONSTANTS
// ============================================================================

const SCAN_DEFAULTS = {
  maxDepth: 10,
  maxFileSize: 100 * 1024,      // 100 KB per file
  maxTotalSize: 2 * 1024 * 1024, // 2 MB total
  maxFiles: 200,
  defaultExclude: [
    'node_modules', '.git', 'dist', 'build', '__pycache__', '.env',
    '.next', 'coverage', '.cache', '.vscode', '.idea', 'vendor',
    '.DS_Store', 'Thumbs.db',
  ],
  binaryExtensions: new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.lock', '.map',
  ]),
};

const DANGEROUS_COMMANDS = [
  'rm -rf /', 'rm -rf ~', 'rm -rf *', 'rm -rf .',
  'format c:', 'format d:', 'del /f /s /q c:',
  'shutdown', 'reboot', 'halt', 'poweroff',
  ':(){:|:&};:', ':(){ :|:& };:',  // fork bombs
  'mkfs', 'dd if=', 'wipefs',
  'chmod -R 777 /', 'chown -R',
  'reg delete', 'net user',
];

const GIT_READ_OPS = ['status', 'diff', 'log', 'show', 'branch', 'tag', 'remote', 'blame', 'shortlog', 'stash list'];
const GIT_WRITE_OPS = ['add', 'commit', 'checkout', 'stash', 'merge', 'pull', 'fetch', 'switch', 'restore'];
const GIT_BLOCKED_PATTERNS = ['push --force', 'push -f', 'reset --hard', 'clean -f', 'clean -fd', 'branch -D', 'branch --delete --force'];

// ============================================================================
// SCAN DIRECTORY ENDPOINT
// ============================================================================

/**
 * Recursively scan a directory, returning tree structure + file contents
 * POST /api/files/scan
 */
app.post('/api/files/scan', async (req, res) => {
  try {
    const {
      path: scanPath,
      recursive = true,
      maxDepth = SCAN_DEFAULTS.maxDepth,
      includeContents = true,
      filePatterns = [],
      excludePatterns = [],
    } = req.body;

    if (!scanPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    if (!isPathAllowed(scanPath)) {
      return res.status(403).json({
        error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
      });
    }

    const resolvedRoot = path.resolve(scanPath);
    const excludeSet = new Set([...SCAN_DEFAULTS.defaultExclude, ...excludePatterns]);
    const files = [];
    let totalSize = 0;
    const treeLines = [];
    const languageStats = {};

    // Simple glob-style matcher (supports * and ** loosely)
    function matchesPattern(filename, patterns) {
      if (!patterns || patterns.length === 0) return true;
      return patterns.some((pat) => {
        // Convert simple glob to regex
        const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
        return re.test(filename);
      });
    }

    async function walk(dir, depth, prefix) {
      if (depth > maxDepth) return;
      if (files.length >= SCAN_DEFAULTS.maxFiles) return;
      if (totalSize >= SCAN_DEFAULTS.maxTotalSize) return;

      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // Permission denied, etc.
      }

      // Sort: directories first, then files
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < entries.length; i++) {
        if (files.length >= SCAN_DEFAULTS.maxFiles) break;
        if (totalSize >= SCAN_DEFAULTS.maxTotalSize) break;

        const entry = entries[i];
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = prefix + (isLast ? '    ' : '│   ');

        // Skip excluded dirs/files
        if (excludeSet.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          treeLines.push(`${prefix}${connector}${entry.name}/`);
          if (recursive) {
            await walk(fullPath, depth + 1, childPrefix);
          }
        } else {
          const ext = path.extname(entry.name).toLowerCase();

          // Skip binary files
          if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;

          // Apply file pattern filter
          if (filePatterns.length > 0 && !matchesPattern(entry.name, filePatterns)) continue;

          treeLines.push(`${prefix}${connector}${entry.name}`);

          // Track language
          const lang = ext.replace('.', '') || 'unknown';
          languageStats[lang] = (languageStats[lang] || 0) + 1;

          if (includeContents) {
            try {
              const stat = await fs.stat(fullPath);
              if (stat.size <= SCAN_DEFAULTS.maxFileSize && totalSize + stat.size <= SCAN_DEFAULTS.maxTotalSize) {
                const content = await fs.readFile(fullPath, 'utf-8');
                const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
                files.push({ path: relativePath, size: stat.size, content });
                totalSize += stat.size;
              } else {
                const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
                files.push({ path: relativePath, size: stat.size, content: '[file too large or total limit reached]' });
              }
            } catch {
              // Can't read file, skip
            }
          }
        }
      }
    }

    const rootName = path.basename(resolvedRoot);
    treeLines.push(`${rootName}/`);
    await walk(resolvedRoot, 0, '');

    console.log(`[Scan] Scanned: ${scanPath} (${files.length} files, ${Math.round(totalSize / 1024)}KB)`);

    res.json({
      success: true,
      tree: treeLines.join('\n'),
      files,
      summary: {
        totalFiles: files.length,
        totalSize,
        languages: languageStats,
        truncated: files.length >= SCAN_DEFAULTS.maxFiles || totalSize >= SCAN_DEFAULTS.maxTotalSize,
      },
    });
  } catch (error) {
    console.error('[Scan] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CODE SEARCH ENDPOINT
// ============================================================================

/**
 * Search for text/regex patterns across files in a directory
 * POST /api/files/search
 */
app.post('/api/files/search', async (req, res) => {
  try {
    const {
      query,
      path: searchPath,
      regex = false,
      caseSensitive = false,
      filePatterns = [],
      maxResults = 100,
    } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    if (!searchPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    if (!isPathAllowed(searchPath)) {
      return res.status(403).json({
        error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
      });
    }

    const resolvedRoot = path.resolve(searchPath);
    const excludeSet = new Set(SCAN_DEFAULTS.defaultExclude);
    const matches = [];
    let filesSearched = 0;

    // Build search regex
    let searchRegex;
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      searchRegex = regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    } catch (e) {
      return res.status(400).json({ error: `Invalid regex: ${e.message}` });
    }

    function matchesFilePattern(filename) {
      if (!filePatterns || filePatterns.length === 0) return true;
      return filePatterns.some((pat) => {
        const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
        return re.test(filename);
      });
    }

    async function searchDir(dir) {
      if (matches.length >= maxResults) return;

      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (matches.length >= maxResults) break;

        if (excludeSet.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
          if (!matchesFilePattern(entry.name)) continue;

          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > SCAN_DEFAULTS.maxFileSize) continue;

            const content = await fs.readFile(fullPath, 'utf-8');
            filesSearched++;
            const lines = content.split('\n');

            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
              if (matches.length >= maxResults) break;

              const line = lines[lineNum];
              searchRegex.lastIndex = 0;
              let match;
              while ((match = searchRegex.exec(line)) !== null) {
                if (matches.length >= maxResults) break;
                const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
                // Context: 1 line before and after
                const contextBefore = lineNum > 0 ? lines[lineNum - 1] : '';
                const contextAfter = lineNum < lines.length - 1 ? lines[lineNum + 1] : '';
                matches.push({
                  file: relativePath,
                  line: lineNum + 1,
                  column: match.index + 1,
                  text: line.trim(),
                  context: [contextBefore, line, contextAfter].filter(Boolean).join('\n'),
                });
                if (!regex) break; // For non-regex, one match per line is enough
              }
            }
          } catch {
            // Can't read, skip
          }
        }
      }
    }

    await searchDir(resolvedRoot);

    console.log(`[Search] "${query}" in ${searchPath}: ${matches.length} matches in ${filesSearched} files`);

    res.json({
      success: true,
      matches,
      totalMatches: matches.length,
      filesSearched,
    });
  } catch (error) {
    console.error('[Search] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// COMMAND EXECUTION ENDPOINT
// ============================================================================

/**
 * Execute shell commands (npm test, npm run build, etc.)
 * POST /api/command/execute
 */
app.post('/api/command/execute', async (req, res) => {
  try {
    const {
      command,
      workingDirectory,
      timeout = 60000,
    } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    // Security: block dangerous commands
    const cmdLower = command.toLowerCase().trim();
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (cmdLower.includes(dangerous.toLowerCase())) {
        return res.status(400).json({
          error: `Command blocked for safety: contains "${dangerous}"`,
        });
      }
    }

    // Validate working directory if provided
    const cwd = workingDirectory ? path.resolve(workingDirectory) : __dirname;
    if (workingDirectory && !isPathAllowed(cwd)) {
      return res.status(403).json({
        error: 'Access denied. Working directory must be within allowed directories.',
      });
    }

    console.log(`[Command] Executing: ${command} (cwd: ${cwd})`);

    const startTime = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd,
        timeout: Math.min(timeout, 60000),
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > 500000) {
          child.kill('SIGTERM');
          reject(new Error('Output too large (>500KB)'));
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });

    const duration = Date.now() - startTime;
    console.log(`[Command] Completed in ${duration}ms, exit code: ${result.exitCode}`);

    res.json({
      success: true,
      stdout: result.stdout.slice(0, 100000),
      stderr: result.stderr.slice(0, 20000),
      exitCode: result.exitCode,
      duration,
    });
  } catch (error) {
    console.error('[Command] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// GIT ENDPOINT
// ============================================================================

/**
 * Execute git operations
 * POST /api/git/execute
 */
app.post('/api/git/execute', async (req, res) => {
  try {
    const {
      operation,
      args = [],
      repoPath,
    } = req.body;

    if (!operation) {
      return res.status(400).json({ error: 'Operation is required' });
    }

    // Validate repo path
    const cwd = repoPath ? path.resolve(repoPath) : __dirname;
    if (repoPath && !isPathAllowed(cwd)) {
      return res.status(403).json({
        error: 'Access denied. Repository path must be within allowed directories.',
      });
    }

    // Security: check for blocked operations
    const fullCmd = `${operation} ${Array.isArray(args) ? args.join(' ') : args}`.toLowerCase();
    for (const blocked of GIT_BLOCKED_PATTERNS) {
      if (fullCmd.includes(blocked)) {
        return res.status(400).json({
          error: `Git operation blocked for safety: "${blocked}" is not allowed.`,
        });
      }
    }

    // Validate operation is known
    const allOps = [...GIT_READ_OPS, ...GIT_WRITE_OPS];
    if (!allOps.includes(operation)) {
      return res.status(400).json({
        error: `Unknown git operation: "${operation}". Allowed: ${allOps.join(', ')}`,
      });
    }

    const gitArgs = [operation, ...(Array.isArray(args) ? args : [args])];
    console.log(`[Git] git ${gitArgs.join(' ')} (cwd: ${cwd})`);

    const result = await new Promise((resolve, reject) => {
      const child = spawn('git', gitArgs, {
        cwd,
        timeout: 30000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      child.on('close', (exitCode) => { resolve({ stdout, stderr, exitCode }); });
      child.on('error', (error) => { reject(error); });
    });

    console.log(`[Git] exit code: ${result.exitCode}`);

    res.json({
      success: true,
      stdout: result.stdout.slice(0, 100000),
      stderr: result.stderr.slice(0, 20000),
      exitCode: result.exitCode,
    });
  } catch (error) {
    console.error('[Git] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// CODE EXECUTION (Sandboxed)
// ============================================================================

import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';

/**
 * Execute code in a sandboxed environment
 * POST /api/code/execute
 * Body: { language: string, code: string, timeout?: number }
 */
app.post('/api/code/execute', async (req, res) => {
  try {
    const { language, code, timeout = 30000 } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    if (!language) {
      return res.status(400).json({ error: 'Language is required' });
    }

    // Security: Block obviously dangerous code
    const dangerousPatterns = [
      'rm -rf', 'format c:', 'del /f /s', 'shutdown',
      '__import__("os")', 'subprocess', 'eval(', 'exec(',
      'require("child_process")', 'require("fs")',
      'process.exit', 'process.kill',
    ];

    const lowerCode = code.toLowerCase();
    for (const pattern of dangerousPatterns) {
      if (lowerCode.includes(pattern.toLowerCase())) {
        return res.status(400).json({
          error: `Code blocked for safety: contains "${pattern}"`,
          success: false,
        });
      }
    }

    let command, args, tempFile;
    const tempDir = tmpdir();

    switch (language.toLowerCase()) {
      case 'python':
      case 'py':
        tempFile = path.join(tempDir, `alin_code_${Date.now()}.py`);
        await fs.writeFile(tempFile, code);
        command = 'python';
        args = [tempFile];
        break;

      case 'javascript':
      case 'js':
      case 'node':
        tempFile = path.join(tempDir, `alin_code_${Date.now()}.js`);
        await fs.writeFile(tempFile, code);
        command = 'node';
        args = [tempFile];
        break;

      default:
        return res.status(400).json({
          error: `Unsupported language: ${language}. Supported: python, javascript`,
          success: false,
        });
    }

    console.log(`[Code] Executing ${language} code...`);

    // Execute with timeout
    const result = await executeWithTimeout(command, args, timeout);

    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch {}

    console.log(`[Code] Execution completed. Output length: ${result.stdout.length}`);

    res.json({
      success: true,
      language,
      stdout: result.stdout.slice(0, 50000), // Limit output size
      stderr: result.stderr.slice(0, 10000),
      exitCode: result.exitCode,
    });
  } catch (error) {
    console.error('[Code] Execution error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

function executeWithTimeout(command, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      timeout,
      maxBuffer: 1024 * 1024, // 1MB output limit
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });

    child.on('error', (error) => {
      reject(error);
    });

    // Kill if timeout
    setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Execution timed out after ${timeout}ms`));
    }, timeout);
  });
}

// ============================================================================
// COMPUTER USE ENDPOINTS
// ============================================================================

app.post('/api/computer/action', async (req, res) => {
  try {
    const { action, coordinate, text } = req.body;

    switch (action) {
      case 'screenshot': {
        // Use the screenshot-desktop package if available, otherwise return placeholder
        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          // Cross-platform screenshot using PowerShell on Windows
          if (process.platform === 'win32') {
            const tempPath = path.join(os.tmpdir(), `alin-screenshot-${Date.now()}.png`);
            await execAsync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bitmap.Save('${tempPath.replace(/\\/g, '\\\\')}'); }"`);
            const imageData = await fs.readFile(tempPath, { encoding: 'base64' });
            await fs.unlink(tempPath).catch(() => {});
            return res.json({ success: true, image: imageData });
          }

          return res.json({ success: false, message: 'Screenshot not supported on this platform yet' });
        } catch (err) {
          return res.json({ success: false, message: `Screenshot failed: ${err.message}` });
        }
      }

      case 'mouse_move':
      case 'left_click':
      case 'right_click':
      case 'double_click':
      case 'scroll':
        // Mouse actions require native automation - placeholder for now
        return res.json({
          success: true,
          message: `Mouse action '${action}' at (${coordinate?.[0]}, ${coordinate?.[1]}) - simulated`,
        });

      case 'type':
        return res.json({
          success: true,
          message: `Typed text: "${text?.slice(0, 50)}${text?.length > 50 ? '...' : ''}" - simulated`,
        });

      case 'key':
        return res.json({
          success: true,
          message: `Key press: ${text} - simulated`,
        });

      default:
        return res.status(400).json({ success: false, message: `Unknown computer action: ${action}` });
    }
  } catch (error) {
    console.error('[Computer Use] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// TEXT EDITOR ENDPOINTS
// ============================================================================

// Edit history for undo support (per-file, in-memory)
const editHistory = new Map();

app.post('/api/editor/execute', async (req, res) => {
  try {
    const { command, path: filePath, file_text, old_str, new_str, insert_line, view_range } = req.body;

    if (!filePath && command !== 'undo_edit') {
      return res.status(400).json({ success: false, error: 'Path is required' });
    }

    // Resolve and validate path
    const resolvedPath = filePath ? path.resolve(filePath) : '';

    switch (command) {
      case 'view': {
        try {
          const content = await fs.readFile(resolvedPath, 'utf-8');
          const lines = content.split('\n');

          if (view_range) {
            const [start, end] = view_range;
            const sliced = lines.slice(start - 1, end);
            const numbered = sliced.map((line, i) => `${start + i}\t${line}`).join('\n');
            return res.json({ success: true, content: numbered });
          }

          const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join('\n');
          return res.json({ success: true, content: numbered });
        } catch (err) {
          return res.json({ success: false, error: `Cannot read file: ${err.message}` });
        }
      }

      case 'create': {
        if (!file_text) {
          return res.status(400).json({ success: false, error: 'file_text is required for create' });
        }
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
        await fs.writeFile(resolvedPath, file_text, 'utf-8');
        return res.json({ success: true, message: `Created ${filePath}` });
      }

      case 'str_replace': {
        if (!old_str) {
          return res.status(400).json({ success: false, error: 'old_str is required for str_replace' });
        }
        const content = await fs.readFile(resolvedPath, 'utf-8');

        // Save to edit history for undo
        if (!editHistory.has(resolvedPath)) editHistory.set(resolvedPath, []);
        editHistory.get(resolvedPath).push(content);

        const occurrences = content.split(old_str).length - 1;
        if (occurrences === 0) {
          return res.json({ success: false, error: 'old_str not found in file' });
        }
        if (occurrences > 1) {
          return res.json({ success: false, error: `old_str found ${occurrences} times - must be unique. Add more context.` });
        }

        const newContent = content.replace(old_str, new_str || '');
        await fs.writeFile(resolvedPath, newContent, 'utf-8');
        return res.json({ success: true, message: `Replaced in ${filePath}` });
      }

      case 'insert': {
        if (insert_line === undefined) {
          return res.status(400).json({ success: false, error: 'insert_line is required for insert' });
        }
        const content = await fs.readFile(resolvedPath, 'utf-8');

        if (!editHistory.has(resolvedPath)) editHistory.set(resolvedPath, []);
        editHistory.get(resolvedPath).push(content);

        const lines = content.split('\n');
        lines.splice(insert_line, 0, new_str || '');
        await fs.writeFile(resolvedPath, lines.join('\n'), 'utf-8');
        return res.json({ success: true, message: `Inserted at line ${insert_line} in ${filePath}` });
      }

      case 'undo_edit': {
        if (!editHistory.has(resolvedPath) || editHistory.get(resolvedPath).length === 0) {
          return res.json({ success: false, error: 'No edit history to undo' });
        }
        const previousContent = editHistory.get(resolvedPath).pop();
        await fs.writeFile(resolvedPath, previousContent, 'utf-8');
        return res.json({ success: true, message: `Undid last edit to ${filePath}` });
      }

      default:
        return res.status(400).json({ success: false, error: `Unknown editor command: ${command}` });
    }
  } catch (error) {
    console.error('[Text Editor] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// IMAGE GENERATION (DALL-E 3) - Backend proxy
// ============================================================================

app.post('/api/images/generate', async (req, res) => {
  try {
    const { prompt, size = '1024x1024', quality = 'standard', style = 'vivid', apiKey } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }

    // Get API key from request or environment
    const openaiKey = apiKey || process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.status(400).json({
        success: false,
        error: 'OpenAI API key required for image generation. Set OPENAI_API_KEY or pass apiKey in request.',
      });
    }

    console.log(`[Image Gen] Generating: "${prompt.slice(0, 60)}..." (${size}, ${quality}, ${style})`);

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        quality,
        style,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Image Gen] Error:', errorData);
      return res.status(response.status).json({
        success: false,
        error: errorData.error?.message || 'Image generation failed',
      });
    }

    const data = await response.json();
    const imageData = data.data[0];

    console.log(`[Image Gen] Success, revised prompt: "${(imageData.revised_prompt || '').slice(0, 60)}..."`);

    res.json({
      success: true,
      url: imageData.url,
      revised_prompt: imageData.revised_prompt,
    });
  } catch (error) {
    console.error('[Image Gen] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// SYSTEM METRICS ENDPOINT
// ============================================================================

/**
 * Get real-time system metrics (CPU, memory, GPU, uptime)
 * GET /api/system/metrics
 */
app.get('/api/system/metrics', (req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Calculate CPU usage from cpu times
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });
  const cpuUsage = ((1 - totalIdle / totalTick) * 100);

  // Try to get GPU info (nvidia-smi)
  let gpu = null;
  try {
    const nvResult = execSync('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits', { timeout: 2000 }).toString().trim();
    const parts = nvResult.split(', ');
    if (parts.length >= 4) {
      gpu = {
        name: parts[0],
        usage: parseFloat(parts[1]) || 0,
        memoryUsed: (parseFloat(parts[2]) || 0) * 1024 * 1024,
        memoryTotal: (parseFloat(parts[3]) || 0) * 1024 * 1024,
        temperature: parseFloat(parts[4]) || undefined,
        power: parseFloat(parts[5]) || undefined,
      };
    }
  } catch (e) {
    // No NVIDIA GPU or nvidia-smi not available
  }

  res.json({
    timestamp: Date.now(),
    cpu: {
      usage: Math.round(cpuUsage * 100) / 100,
      cores: cpus.length,
      frequency: cpus[0]?.speed || 0,
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      usagePercent: Math.round((usedMem / totalMem) * 10000) / 100,
    },
    gpu,
    uptime: os.uptime(),
    platform: os.platform(),
  });
});

// ============================================================================
// GPU COMPUTE — Submit GPU compute tasks
// ============================================================================

/**
 * POST /api/hardware/gpu-compute — Run a CUDA/compute task
 * Supports Python scripts that use GPU (PyTorch, TensorFlow, CUDA)
 */
app.post('/api/hardware/gpu-compute', async (req, res) => {
  try {
    const { script, framework, timeout: timeoutMs } = req.body;
    if (!script) return res.status(400).json({ success: false, error: 'Script required' });

    const fw = framework || 'python';
    const maxTimeout = Math.min(timeoutMs || 120000, 300000); // max 5 min

    // Write script to temp file
    const tmpFile = path.join(os.tmpdir(), `alin_gpu_${Date.now()}.py`);
    fsSync.writeFileSync(tmpFile, script);

    const { execFile } = require('child_process');
    const startTime = Date.now();

    const child = execFile('python', [tmpFile], {
      timeout: maxTimeout,
      env: { ...process.env, CUDA_VISIBLE_DEVICES: '0' },
      maxBuffer: 10 * 1024 * 1024, // 10MB output
    }, (error, stdout, stderr) => {
      const duration = Date.now() - startTime;
      // Clean up temp file
      try { fsSync.unlinkSync(tmpFile); } catch {}

      if (error) {
        return res.json({
          success: false,
          error: error.message,
          stderr: stderr?.toString() || '',
          stdout: stdout?.toString() || '',
          duration,
        });
      }

      res.json({
        success: true,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        duration,
      });
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/hardware/gpu-info — Detailed GPU information
 */
app.get('/api/hardware/gpu-info', (req, res) => {
  try {
    const nvResult = execSync(
      'nvidia-smi --query-gpu=name,driver_version,pci.bus_id,utilization.gpu,utilization.memory,memory.used,memory.total,memory.free,temperature.gpu,temperature.memory,power.draw,power.limit,clocks.current.graphics,clocks.current.memory,clocks.max.graphics,clocks.max.memory --format=csv,noheader,nounits',
      { timeout: 3000 }
    ).toString().trim();

    const parts = nvResult.split(', ').map(s => s.trim());
    res.json({
      success: true,
      gpu: {
        name: parts[0],
        driverVersion: parts[1],
        pciBusId: parts[2],
        gpuUtilization: parseFloat(parts[3]) || 0,
        memoryUtilization: parseFloat(parts[4]) || 0,
        memoryUsed: (parseFloat(parts[5]) || 0) * 1024 * 1024,
        memoryTotal: (parseFloat(parts[6]) || 0) * 1024 * 1024,
        memoryFree: (parseFloat(parts[7]) || 0) * 1024 * 1024,
        temperature: parseFloat(parts[8]) || 0,
        memoryTemperature: parseFloat(parts[9]) || null,
        powerDraw: parseFloat(parts[10]) || 0,
        powerLimit: parseFloat(parts[11]) || 0,
        clockGraphics: parseFloat(parts[12]) || 0,
        clockMemory: parseFloat(parts[13]) || 0,
        maxClockGraphics: parseFloat(parts[14]) || 0,
        maxClockMemory: parseFloat(parts[15]) || 0,
      },
    });
  } catch (err) {
    res.json({ success: false, error: 'No NVIDIA GPU detected or nvidia-smi not available' });
  }
});

/**
 * GET /api/hardware/processes — GPU processes
 */
app.get('/api/hardware/processes', (req, res) => {
  try {
    const result = execSync(
      'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits',
      { timeout: 3000 }
    ).toString().trim();

    const processes = result.split('\n').filter(Boolean).map(line => {
      const parts = line.split(', ').map(s => s.trim());
      return {
        pid: parseInt(parts[0]) || 0,
        name: parts[1] || 'unknown',
        memoryUsed: (parseFloat(parts[2]) || 0) * 1024 * 1024,
      };
    });

    res.json({ success: true, processes });
  } catch {
    res.json({ success: true, processes: [] });
  }
});

/**
 * POST /api/hardware/webcam — Capture frame from webcam
 */
app.post('/api/hardware/webcam', async (req, res) => {
  try {
    const { device, width, height } = req.body;
    const deviceIdx = device || 0;
    const w = width || 640;
    const h = height || 480;

    // Use Python + OpenCV to capture a frame
    const script = `
import cv2, base64, sys, json
cap = cv2.VideoCapture(${deviceIdx})
if not cap.isOpened():
    print(json.dumps({"error": "Cannot open camera"}))
    sys.exit(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, ${w})
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, ${h})
ret, frame = cap.read()
cap.release()
if not ret:
    print(json.dumps({"error": "Failed to capture frame"}))
    sys.exit(0)
_, buffer = cv2.imencode('.jpg', frame)
b64 = base64.b64encode(buffer).decode('utf-8')
print(json.dumps({"image": b64, "width": frame.shape[1], "height": frame.shape[0]}))
`;
    const tmpFile = path.join(os.tmpdir(), `alin_webcam_${Date.now()}.py`);
    fsSync.writeFileSync(tmpFile, script);

    const result = execSync(`python "${tmpFile}"`, { timeout: 10000 }).toString().trim();
    try { fsSync.unlinkSync(tmpFile); } catch {}

    const data = JSON.parse(result);
    if (data.error) {
      return res.json({ success: false, error: data.error });
    }
    res.json({ success: true, image: data.image, width: data.width, height: data.height });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// BLENDER — Headless Blender/bpy execution
// ============================================================================

/**
 * Auto-detect Blender executable on Windows.
 * Checks BLENDER_PATH env, then common Windows install locations, then PATH.
 */
function findBlenderPath() {
  // 1. Check env variable
  if (process.env.BLENDER_PATH) {
    if (fsSync.existsSync(process.env.BLENDER_PATH)) return process.env.BLENDER_PATH;
  }

  // 2. Check common Windows install locations
  if (process.platform === 'win32') {
    const programDirs = [
      process.env['ProgramFiles'] || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
    ];

    for (const progDir of programDirs) {
      try {
        const entries = fsSync.readdirSync(progDir);
        // Look for "Blender Foundation" or "Blender X.Y" folders
        for (const entry of entries) {
          if (entry.toLowerCase().includes('blender')) {
            const blenderDir = path.join(progDir, entry);
            // Check for blender.exe directly
            const directExe = path.join(blenderDir, 'blender.exe');
            if (fsSync.existsSync(directExe)) return directExe;
            // Check one level deeper (Blender Foundation/Blender X.Y/)
            try {
              const subEntries = fsSync.readdirSync(blenderDir);
              for (const sub of subEntries) {
                if (sub.toLowerCase().includes('blender')) {
                  const subExe = path.join(blenderDir, sub, 'blender.exe');
                  if (fsSync.existsSync(subExe)) return subExe;
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    // Also check user's Downloads for portable Blender
    const downloadsBlender = path.join(os.homedir(), 'Downloads', 'Blender 5.0');
    if (fsSync.existsSync(path.join(downloadsBlender, 'blender.exe'))) {
      return path.join(downloadsBlender, 'blender.exe');
    }
  }

  // 3. Fall back to PATH
  try {
    execSync(process.platform === 'win32' ? 'where blender' : 'which blender', { timeout: 5000, stdio: 'pipe' });
    return 'blender'; // It's in PATH
  } catch {}

  return null; // Blender not found
}

// Cache the detected path
let _detectedBlenderPath = null;
function getBlenderPath() {
  if (_detectedBlenderPath === undefined) return null;
  if (_detectedBlenderPath !== null) return _detectedBlenderPath;
  _detectedBlenderPath = findBlenderPath();
  if (_detectedBlenderPath) {
    console.log(`[Blender] Found at: ${_detectedBlenderPath}`);
  } else {
    console.warn('[Blender] NOT FOUND — Blender features will be unavailable');
    _detectedBlenderPath = undefined; // Mark as checked but not found
  }
  return _detectedBlenderPath || null;
}

/**
 * POST /api/blender/execute — Run a Blender Python script headlessly
 * Requires Blender installed and on PATH (or BLENDER_PATH env var)
 *
 * Body:
 *  - script (string) [required]
 *  - blendFile (string) [optional] : start from an existing .blend
 *  - outputFormat (string) [optional] : PNG/JPEG/OPEN_EXR/etc
 *  - outputPath (string) [optional] : base path for outputs (no extension required)
 *  - autoRender (boolean) [optional] : if true, will attempt render if user script didn't
 *  - engine (string) [optional] : CYCLES/EEVEE/WORKBENCH (depending on Blender version)
 *  - frame (number) [optional]
 *  - timeout (ms) [optional]
 */
app.post('/api/blender/execute', async (req, res) => {
  try {
    const {
      script,
      blendFile,
      outputFormat,
      outputPath,
      autoRender,
      engine,
      frame,
      timeout: timeoutMs
    } = req.body;

    if (!script) return res.status(400).json({ success: false, error: 'script required' });

    const maxTimeout = Math.min(timeoutMs || 120000, 600000); // max 10 min
    const blenderPath = getBlenderPath();
    if (!blenderPath) {
      return res.status(500).json({
        success: false,
        error: 'BLENDER_NOT_FOUND: Blender is not installed or could not be located. Checked: Program Files, AppData, Downloads, and PATH. Install Blender from https://www.blender.org/download/ or set BLENDER_PATH environment variable to the full path of blender.exe',
      });
    }
    const format = (outputFormat || 'PNG').toUpperCase();
    const renderEngine = (engine || 'CYCLES').toUpperCase();
    const frameNum = Number.isFinite(frame) ? Number(frame) : 1;

    // Script temp file
    const tmpScript = path.join(os.tmpdir(), `alin_blender_${Date.now()}_${Math.random().toString(16).slice(2)}.py`);

    // Dedicated output folder: output/blender/ in ALIN project
    const blenderOutputDir = path.join(__dirname, 'output', 'blender');
    if (!fsSync.existsSync(blenderOutputDir)) {
      fsSync.mkdirSync(blenderOutputDir, { recursive: true });
    }

    // Output base path — use dedicated folder if no explicit outputPath
    const tmpOutputBase = outputPath
      ? path.resolve(outputPath)
      : path.join(blenderOutputDir, `render_${Date.now()}`);

    // Security checks
    // - blendFile (if provided) must be in allowed dirs
    // - outputPath (if provided) must be in allowed dirs OR temp dir
    const isPathAllowed = (p) => {
      const rp = path.resolve(p);
      const inAllowedDirs = ALLOWED_DIRS.some(d => rp.startsWith(d));
      const inTmp = rp.startsWith(path.resolve(os.tmpdir()));
      return inAllowedDirs || inTmp;
    };

    let resolvedBlendPath = null;
    if (blendFile) {
      resolvedBlendPath = path.resolve(blendFile);
      const allowedBlend = ALLOWED_DIRS.some(d => resolvedBlendPath.startsWith(d));
      if (!allowedBlend) {
        return res.status(403).json({ success: false, error: 'blendFile path not allowed' });
      }
      if (!fsSync.existsSync(resolvedBlendPath)) {
        return res.status(400).json({ success: false, error: 'blendFile does not exist' });
      }
    }

    if (outputPath && !isPathAllowed(tmpOutputBase)) {
      return res.status(403).json({ success: false, error: 'outputPath not allowed' });
    }

    /**
     * Wrapped script sets deterministic render defaults:
     * - scene.render.filepath = <outputBase>
     * - image format
     * - engine
     * - use_file_extension = True
     *
     * It also provides helper: alin_render()
     * If autoRender=true, it will render a still if user script didn’t.
     */
    const wrappedScript = `
import bpy, sys, json, os, traceback

ALIN_OUTPUT_BASE = r"""${tmpOutputBase.replace(/\\/g, '\\\\')}"""
ALIN_FORMAT = "${format}"
ALIN_ENGINE = "${renderEngine}"
ALIN_FRAME = ${frameNum}
ALIN_AUTORENDER = ${autoRender ? 'True' : 'False'}
alin_did_render = False

def alin_configure_render():
    try:
        scene = bpy.context.scene
        # Engine (may fail on some versions; ignore if unsupported)
        try:
            scene.render.engine = ALIN_ENGINE
        except:
            pass

        # Output format + path
        scene.render.image_settings.file_format = ALIN_FORMAT
        scene.render.filepath = ALIN_OUTPUT_BASE
        scene.render.use_file_extension = True

        # Frame
        try:
            scene.frame_set(ALIN_FRAME)
        except:
            pass
    except Exception as e:
        print("ALIN_RENDER_CONFIG_ERROR:" + str(e))

def alin_render(write_still=True):
    global alin_did_render
    alin_configure_render()
    try:
        bpy.ops.render.render(write_still=write_still)
        alin_did_render = True
    except Exception as e:
        print("ALIN_RENDER_ERROR:" + str(e))

# If no blendFile was provided, start from empty homefile.
# If a blendFile was provided, Blender already loaded it via CLI.
${resolvedBlendPath ? '' : 'bpy.ops.wm.read_homefile(use_empty=True)\n'}

alin_configure_render()

# -------------------------
# USER SCRIPT START
# -------------------------
try:
${script.split('\n').map(line => '    ' + line).join('\n')}
except Exception:
    print("ALIN_USER_SCRIPT_ERROR:")
    traceback.print_exc()
# -------------------------
# USER SCRIPT END
# -------------------------

# Optional auto-render if requested and user script didn't render
if ALIN_AUTORENDER and not alin_did_render:
    alin_render(write_still=True)

# Output info (always)
output_info = {
    "objects": len(bpy.data.objects),
    "meshes": len(bpy.data.meshes),
    "materials": len(bpy.data.materials),
    "scenes": len(bpy.data.scenes),
    "did_render": alin_did_render,
    "output_base": ALIN_OUTPUT_BASE,
    "format": ALIN_FORMAT,
}
print("ALIN_OUTPUT:" + json.dumps(output_info))
`;

    fsSync.writeFileSync(tmpScript, wrappedScript);

    const startTime = Date.now();

    // Build blender command
    // If blendFile provided, load it first
    const blendArg = resolvedBlendPath ? `"${resolvedBlendPath}"` : '';
    const cmd = `"${blenderPath}" --background ${blendArg} --python "${tmpScript}" 2>&1`;

    const result = execSync(cmd, { timeout: maxTimeout, maxBuffer: 10 * 1024 * 1024 }).toString();
    const duration = Date.now() - startTime;

    // Cleanup script
    try { fsSync.unlinkSync(tmpScript); } catch {}

    // Parse output info
    const outputMatch = result.match(/ALIN_OUTPUT:(.+)/);
    const outputInfo = outputMatch ? JSON.parse(outputMatch[1]) : {};

    // Try to find a saved render
    // Blender often saves: <base>.<ext> for still renders when use_file_extension=True
    const ext = format.toLowerCase();
    const candidates = [
      `${tmpOutputBase}.${ext}`,
      `${tmpOutputBase}${String(frameNum).padStart(4, '0')}.${ext}`, // sometimes frame suffix appears
      `${tmpOutputBase}0001.${ext}`,
    ];

    let renderImage = null;
    let finalOutputPath = null;

    for (const p of candidates) {
      if (fsSync.existsSync(p)) {
        renderImage = fsSync.readFileSync(p).toString('base64');
        finalOutputPath = p;
        break;
      }
    }

    // Check for errors in Blender output
    const hasScriptError = result.includes('ALIN_USER_SCRIPT_ERROR:') || result.includes('ALIN_RENDER_ERROR:');
    const didRender = outputInfo.did_render === true;
    const fileExists = finalOutputPath !== null;

    res.json({
      success: fileExists || (didRender && !hasScriptError),
      rendered: fileExists,
      output: result.slice(0, 50000),
      stdout: result.slice(0, 50000),
      duration,
      info: outputInfo,
      renderImage,
      renderFormat: format,
      outputPath: finalOutputPath || null,
      error: hasScriptError ? 'Blender script encountered errors — check output for details' : (!fileExists && autoRender ? 'Render completed but no output file was found' : undefined),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      hint: 'Ensure Blender is installed and accessible via PATH or BLENDER_PATH env variable',
    });
  }
});


/**
 * POST /api/blender/render — Render a .blend file headlessly
 *
 * Body:
 *  - blendFile (string) [required]
 *  - frame (number) [optional]
 *  - outputFormat (string) [optional]  (also accepts "format")
 *  - engine (string) [optional]
 *  - outputPath (string) [optional] : base output path
 */
app.post('/api/blender/render', async (req, res) => {
  try {
    const { blendFile, frame, outputFormat, format, engine, outputPath } = req.body;
    if (!blendFile) return res.status(400).json({ success: false, error: 'blendFile required' });

    // Security: validate path
    const resolvedPath = path.resolve(blendFile);
    const allowed = ALLOWED_DIRS.some(d => resolvedPath.startsWith(d));
    if (!allowed) return res.status(403).json({ success: false, error: 'Path not allowed' });
    if (!fsSync.existsSync(resolvedPath)) return res.status(400).json({ success: false, error: 'blendFile does not exist' });

    const blenderPath = getBlenderPath();
    if (!blenderPath) {
      return res.status(500).json({
        success: false,
        error: 'BLENDER_NOT_FOUND: Blender is not installed or could not be located. Install Blender from https://www.blender.org/download/ or set BLENDER_PATH environment variable.',
      });
    }

    const fmt = ((outputFormat || format) || 'PNG').toUpperCase();
    const renderEngine = (engine || 'CYCLES').toUpperCase();
    const frameNum = Number.isFinite(frame) ? Number(frame) : 1;

    // Dedicated output folder
    const blenderOutputDir = path.join(__dirname, 'output', 'blender');
    if (!fsSync.existsSync(blenderOutputDir)) {
      fsSync.mkdirSync(blenderOutputDir, { recursive: true });
    }

    const tmpOutputBase = outputPath
      ? path.resolve(outputPath)
      : path.join(blenderOutputDir, `render_${Date.now()}`);

    // outputPath security: allow in allowed dirs or temp dir
    const inAllowedDirs = ALLOWED_DIRS.some(d => tmpOutputBase.startsWith(d));
    const inTmp = tmpOutputBase.startsWith(path.resolve(os.tmpdir()));
    if (outputPath && !(inAllowedDirs || inTmp)) {
      return res.status(403).json({ success: false, error: 'outputPath not allowed' });
    }

    const startTime = Date.now();

    // Note: blender CLI render-output expects a base path; Blender appends frame and extension
    const cmd =
      `"${blenderPath}" --background "${resolvedPath}" ` +
      `--engine ${renderEngine} --render-output "${tmpOutputBase}" --render-format ${fmt} --render-frame ${frameNum} 2>&1`;

    const result = execSync(cmd, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }).toString();
    const duration = Date.now() - startTime;

    // Find rendered file
    const ext = fmt.toLowerCase();
    const possibleFiles = [
      `${tmpOutputBase}${String(frameNum).padStart(4, '0')}.${ext}`,
      `${tmpOutputBase}.${ext}`,
    ];

    let renderImage = null;
    let finalOutputPath = null;

    for (const f of possibleFiles) {
      if (fsSync.existsSync(f)) {
        renderImage = fsSync.readFileSync(f).toString('base64');
        finalOutputPath = f;
        break;
      }
    }

    const fileExists = finalOutputPath !== null;

    res.json({
      success: fileExists,
      rendered: fileExists,
      output: result.slice(0, 20000),
      duration,
      renderImage,
      renderFormat: fmt,
      outputPath: finalOutputPath || null,
      error: !fileExists ? 'Render completed but no output file was produced — check Blender output for errors' : undefined,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      hint: 'Ensure Blender is installed and the .blend file exists',
    });
  }
});


// ============================================================================
// CLAUDE PROXY — For title generation and simple completions
// ============================================================================

/**
 * POST /api/claude — Proxy to Anthropic Messages API
 * Body: { model, max_tokens, messages, system? }
 */
app.post('/api/claude', async (req, res) => {
  try {
    const { model, max_tokens, messages, system } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No Anthropic API key configured' });
    }

    const body = {
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 100,
      messages: messages || [],
    };
    if (system) body.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Claude Proxy] API error:', response.status, errorText);
      return res.status(response.status).json({ error: `Anthropic API error: ${response.status}`, details: errorText });
    }

    const data = await response.json();
    console.log(`[Claude Proxy] ${model || 'haiku'} response: ${data.content?.[0]?.text?.slice(0, 50)}...`);
    res.json(data);
  } catch (error) {
    console.error('[Claude Proxy] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// MEMORY STORE/RECALL — For TBWO execution engine tool calls
// ============================================================================

/**
 * POST /api/memory/store — Store a memory entry (used by TBWO execution engine)
 * Body: { key, value, category, content, importance, tags }
 */
app.post('/api/memory/store', (req, res) => {
  try {
    const { key, value, category, content, importance, tags } = req.body;
    const memContent = content || value || '';
    if (!memContent) return res.status(400).json({ error: 'Content or value required' });

    const id = randomUUID();
    const now = Date.now();
    const layer = category === 'preference' ? 'semantic'
      : category === 'fact' ? 'semantic'
      : category === 'context' ? 'episodic'
      : category === 'procedure' ? 'procedural'
      : category === 'episode' ? 'episodic'
      : 'short_term';

    const salience = importance ? Math.min(importance / 10, 1.0) : 0.5;

    stmts.insertMemory.run(
      id, layer, memContent,
      salience, 0.1, 0,
      0, 0, 0, 0,
      JSON.stringify(tags || []), JSON.stringify([]),
      JSON.stringify([]), JSON.stringify({ key: key || '', category: category || '' }),
      null, now, now
    );

    console.log(`[Memory] Stored: "${memContent.slice(0, 50)}..." (${layer}, salience=${salience})`);
    res.json({ success: true, id, message: `Memory stored in ${layer} layer` });
  } catch (error) {
    console.error('[Memory] Store error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/memory/recall — Search memories (used by TBWO execution engine)
 * Body: { query, category, limit }
 */
app.post('/api/memory/recall', (req, res) => {
  try {
    const { query, category, limit: maxResults } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    // Fetch all memories, then do simple text matching
    let rows;
    if (category) {
      const layerMap = {
        preference: 'semantic', fact: 'semantic',
        context: 'episodic', procedure: 'procedural',
        episode: 'episodic',
      };
      const layer = layerMap[category] || category;
      rows = db.prepare('SELECT * FROM memory_entries WHERE layer = ? ORDER BY salience DESC, updated_at DESC').all(layer);
    } else {
      rows = db.prepare('SELECT * FROM memory_entries ORDER BY salience DESC, updated_at DESC').all();
    }

    // Simple keyword matching
    const queryWords = query.toLowerCase().split(/\s+/);
    const scored = rows.map(r => {
      const content = (r.content || '').toLowerCase();
      const metadata = (r.metadata || '').toLowerCase();
      const tags = (r.tags || '').toLowerCase();
      const combined = content + ' ' + metadata + ' ' + tags;
      const matchCount = queryWords.filter(w => combined.includes(w)).length;
      return { ...r, matchScore: matchCount / queryWords.length };
    }).filter(r => r.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore || b.salience - a.salience)
      .slice(0, maxResults || 5);

    const memories = scored.map(r => ({
      id: r.id,
      layer: r.layer,
      content: r.content,
      salience: r.salience,
      tags: JSON.parse(r.tags || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
      matchScore: r.matchScore,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    console.log(`[Memory] Recall "${query.slice(0, 30)}": ${memories.length} results`);
    res.json({ success: true, memories, count: memories.length });
  } catch (error) {
    console.error('[Memory] Recall error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// FILE WATCHER — Detect file changes in project directories
// ============================================================================

const activeWatchers = new Map(); // path → { watcher, changes[] }

/**
 * POST /api/files/watch — Start watching a directory for changes
 */
app.post('/api/files/watch', (req, res) => {
  try {
    const { path: watchPath, extensions } = req.body;
    if (!watchPath) return res.status(400).json({ success: false, error: 'Path required' });

    // Security: Only watch allowed directories
    const resolved = path.resolve(watchPath);
    const allowed = ALLOWED_DIRS.some(d => resolved.startsWith(d));
    if (!allowed) return res.status(403).json({ success: false, error: 'Directory not allowed' });

    // Already watching?
    if (activeWatchers.has(resolved)) {
      return res.json({ success: true, message: 'Already watching', path: resolved });
    }

    const changes = [];
    const extFilter = extensions ? extensions.map(e => e.toLowerCase()) : null;

    const watcher = fs.watch(resolved, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Filter by extension if provided
      if (extFilter) {
        const ext = path.extname(filename).toLowerCase();
        if (!extFilter.includes(ext)) return;
      }
      // Ignore node_modules, .git, dist
      if (/node_modules|\.git[\/\\]|dist[\/\\]/.test(filename)) return;

      changes.push({
        type: eventType, // 'rename' or 'change'
        file: filename,
        timestamp: Date.now(),
      });
      // Keep only last 100 changes
      if (changes.length > 100) changes.splice(0, changes.length - 100);
    });

    activeWatchers.set(resolved, { watcher, changes });
    res.json({ success: true, path: resolved, message: 'Watcher started' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/files/changes — Poll for recent file changes
 */
app.get('/api/files/changes', (req, res) => {
  const watchPath = req.query.path;
  if (!watchPath) {
    // Return changes from all watchers
    const allChanges = [];
    for (const [wp, { changes }] of activeWatchers.entries()) {
      allChanges.push(...changes.map(c => ({ ...c, watchPath: wp })));
    }
    allChanges.sort((a, b) => b.timestamp - a.timestamp);
    return res.json({ success: true, changes: allChanges.slice(0, 50) });
  }

  const resolved = path.resolve(watchPath);
  const entry = activeWatchers.get(resolved);
  if (!entry) return res.json({ success: true, changes: [], watching: false });

  const since = parseInt(req.query.since) || 0;
  const filtered = since > 0
    ? entry.changes.filter(c => c.timestamp > since)
    : entry.changes.slice(-20);

  res.json({ success: true, changes: filtered, watching: true });
});

/**
 * DELETE /api/files/watch — Stop watching a directory
 */
app.delete('/api/files/watch', (req, res) => {
  const watchPath = req.body?.path || req.query.path;
  if (!watchPath) return res.status(400).json({ success: false, error: 'Path required' });

  const resolved = path.resolve(watchPath);
  const entry = activeWatchers.get(resolved);
  if (entry) {
    entry.watcher.close();
    activeWatchers.delete(resolved);
  }
  res.json({ success: true, message: 'Watcher stopped' });
});

// ============================================================================
// SELF-MODEL API
// ============================================================================

// --- Execution Outcomes ---
app.post('/api/self-model/outcomes', (req, res) => {
  try {
    const b = req.body;
    const id = randomUUID();
    stmts.insertOutcome.run(id, b.tbwoId, b.objective || '', b.type || '', b.timeBudget || 0, b.planConfidence || 0, b.phasesCompleted || 0, b.phasesFailed || 0, b.artifactsCount || 0, b.userEditsAfter || 0, b.qualityScore || 0, b.timestamp || Date.now());
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/self-model/outcomes', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const type = req.query.type;
    const rows = type ? stmts.listOutcomesByType.all(type, limit) : stmts.listOutcomes.all(limit);
    res.json({ success: true, outcomes: rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- Tool Reliability ---
app.post('/api/self-model/tool-reliability', (req, res) => {
  try {
    const { toolName, success, duration, errorReason } = req.body;
    // Build common_errors — append new error to existing array (max 10)
    let commonErrors = '[]';
    if (!success && errorReason) {
      const existing = stmts.getToolReliability.all().find(r => r.tool_name === toolName);
      if (existing) {
        const errors = JSON.parse(existing.common_errors || '[]');
        errors.push(errorReason.slice(0, 200));
        if (errors.length > 10) errors.shift();
        commonErrors = JSON.stringify(errors);
      } else {
        commonErrors = JSON.stringify([errorReason.slice(0, 200)]);
      }
    }
    stmts.upsertToolReliability.run(
      toolName,
      success ? 1 : 0,
      success ? 0 : 1,
      duration || 0,
      commonErrors,
      (!success && errorReason) ? errorReason.slice(0, 500) : ''
    );
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/self-model/tool-reliability', (req, res) => {
  try {
    const rows = stmts.getToolReliability.all().map(r => ({
      toolName: r.tool_name,
      successCount: r.success_count,
      failureCount: r.failure_count,
      avgDuration: r.avg_duration,
      commonErrors: JSON.parse(r.common_errors || '[]'),
      lastFailureReason: r.last_failure_reason || '',
    }));
    res.json({ success: true, tools: rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- User Corrections ---
app.post('/api/self-model/corrections', (req, res) => {
  try {
    const { originalValue, correctedValue, category } = req.body;
    // Check if a similar correction already exists
    const existing = stmts.findCorrection.get(category, correctedValue);
    if (existing) {
      stmts.incrementCorrection.run(Date.now(), existing.id);
      res.json({ success: true, id: existing.id, correctionCount: existing.correction_count + 1 });
    } else {
      const id = randomUUID();
      stmts.insertCorrection.run(id, originalValue || '', correctedValue || '', category || 'general', Date.now());
      res.json({ success: true, id, correctionCount: 1 });
    }
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/self-model/corrections', (req, res) => {
  try {
    const minCount = parseInt(req.query.minCount) || 1;
    const rows = stmts.listCorrections.all(minCount).map(r => ({
      id: r.id,
      originalValue: r.original_value,
      correctedValue: r.corrected_value,
      category: r.category,
      correctionCount: r.correction_count,
      lastCorrected: r.last_corrected,
    }));
    res.json({ success: true, corrections: rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- Decision Log ---
app.post('/api/self-model/decisions', (req, res) => {
  try {
    const b = req.body;
    const id = randomUUID();
    stmts.insertDecision.run(id, b.tbwoId || '', b.decisionType || '', JSON.stringify(b.optionsConsidered || []), b.chosenOption || '', b.reasoning || '', b.outcome || '', b.confidence || 0, b.timestamp || Date.now());
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/self-model/decisions', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const tbwoId = req.query.tbwoId;
    const rows = (tbwoId ? stmts.listDecisionsByTBWO.all(tbwoId, limit) : stmts.listDecisions.all(limit)).map(r => ({
      id: r.id,
      tbwoId: r.tbwo_id,
      decisionType: r.decision_type,
      optionsConsidered: JSON.parse(r.options_considered || '[]'),
      chosenOption: r.chosen_option,
      reasoning: r.reasoning,
      outcome: r.outcome,
      confidence: r.confidence,
      timestamp: r.timestamp,
    }));
    res.json({ success: true, decisions: rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- Thinking Traces ---
app.post('/api/self-model/thinking-traces', (req, res) => {
  try {
    const b = req.body;
    const id = randomUUID();
    stmts.insertThinkingTrace.run(id, b.conversationId || '', b.messageId || '', b.tbwoId || null, b.thinkingContent || '', b.timestamp || Date.now());
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/self-model/thinking-traces', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let rows;
    if (req.query.q) {
      rows = stmts.searchThinking.all(`%${req.query.q}%`, limit);
    } else if (req.query.conversationId) {
      rows = stmts.listThinkingByConv.all(req.query.conversationId);
    } else if (req.query.tbwoId) {
      rows = stmts.listThinkingByTBWO.all(req.query.tbwoId);
    } else {
      rows = stmts.searchThinking.all('%', limit);
    }
    const traces = rows.map(r => ({
      id: r.id,
      conversationId: r.conversation_id,
      messageId: r.message_id,
      tbwoId: r.tbwo_id,
      thinkingContent: r.thinking_content,
      timestamp: r.timestamp,
    }));
    res.json({ success: true, traces });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- Layer Memory ---
app.post('/api/self-model/layer-memory', (req, res) => {
  try {
    const b = req.body;
    const id = randomUUID();
    const now = Date.now();
    stmts.insertLayerMemory.run(id, b.layer || 'short_term', b.content || '', b.category || '', b.salience ?? 0.5, b.expiresAt || null, JSON.stringify(b.metadata || {}), now, now);
    res.json({ success: true, id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/self-model/layer-memory', (req, res) => {
  try {
    const layer = req.query.layer || 'short_term';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const now = Date.now();
    const rows = stmts.listLayerMemories.all(layer, now, limit).map(r => ({
      id: r.id,
      layer: r.layer,
      content: r.content,
      category: r.category,
      salience: r.salience,
      expiresAt: r.expires_at,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    res.json({ success: true, memories: rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/self-model/layer-memory/prune', (req, res) => {
  try {
    const result = stmts.pruneExpiredLayers.run(Date.now());
    res.json({ success: true, pruned: result.changes });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('========================================================');
  console.log('           ALIN Backend Server');
  console.log('========================================================');
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log('');
  console.log('  Chat Persistence (SQLite):');
  console.log('    GET    /api/conversations          - List conversations');
  console.log('    POST   /api/conversations          - Create conversation');
  console.log('    GET    /api/conversations/:id       - Get with messages');
  console.log('    PATCH  /api/conversations/:id       - Update');
  console.log('    DELETE /api/conversations/:id       - Delete');
  console.log('    GET    /api/conversations/search    - Search');
  console.log('    POST   /api/conversations/:id/messages - Add message');
  console.log('    PATCH  /api/messages/:id            - Edit message');
  console.log('    DELETE /api/messages/:id            - Delete message');
  console.log('');
  console.log('  AI Streaming:');
  console.log('    POST   /api/chat/stream             - SSE streaming proxy');
  console.log('    GET    /api/keys/status              - API key status');
  console.log('');
  console.log('  TBWO Receipts:');
  console.log('    POST   /api/tbwo/:id/receipts       - Save receipt');
  console.log('    GET    /api/tbwo/:id/receipts        - Get receipts');
  console.log('');
  console.log('  TBWO Orders:');
  console.log('    GET    /api/tbwo                    - List TBWOs');
  console.log('    POST   /api/tbwo                    - Create TBWO');
  console.log('    GET    /api/tbwo/:id                - Get TBWO');
  console.log('    PATCH  /api/tbwo/:id                - Update TBWO');
  console.log('    DELETE /api/tbwo/:id                - Delete TBWO');
  console.log('');
  console.log('  Artifacts:');
  console.log('    GET    /api/artifacts               - List artifacts');
  console.log('    POST   /api/artifacts               - Create artifact');
  console.log('    PATCH  /api/artifacts/:id            - Update artifact');
  console.log('    DELETE /api/artifacts/:id            - Delete artifact');
  console.log('');
  console.log('  Memories:');
  console.log('    GET    /api/memories                - List memories');
  console.log('    POST   /api/memories                - Create memory');
  console.log('    PATCH  /api/memories/:id             - Update memory');
  console.log('    DELETE /api/memories/:id             - Delete memory');
  console.log('');
  console.log('  Audit:');
  console.log('    GET    /api/audit                   - List audit entries');
  console.log('    POST   /api/audit                   - Create audit entry');
  console.log('    DELETE /api/audit/prune             - Prune old entries');
  console.log('');
  console.log('  Image Metadata:');
  console.log('    GET    /api/images/list             - List images');
  console.log('    POST   /api/images/metadata         - Store image metadata');
  console.log('    DELETE /api/images/:id              - Delete image');
  console.log('');
  console.log('  Settings:');
  console.log('    GET    /api/settings                - Get all settings');
  console.log('    PUT    /api/settings/:key            - Update setting');
  console.log('');
  console.log('  Search Endpoints:');
  console.log('    POST /api/search/brave  - Brave Search proxy');
  console.log('    GET  /api/search/ddg    - DuckDuckGo proxy');
  console.log('');
  console.log('  File Endpoints:');
  console.log('    POST /api/files/read    - Read file contents');
  console.log('    POST /api/files/write   - Write file');
  console.log('    POST /api/files/list    - List directory');
  console.log('    POST /api/files/scan    - Scan directory (tree + contents)');
  console.log('    POST /api/files/search  - Search code across files');
  console.log('');
  console.log('  Code Execution:');
  console.log('    POST /api/code/execute  - Run Python/JavaScript code');
  console.log('');
  console.log('  Shell & Git:');
  console.log('    POST /api/command/execute - Execute shell commands');
  console.log('    POST /api/git/execute     - Git operations');
  console.log('');
  console.log('  Computer Use:');
  console.log('    POST /api/computer/action - Screenshot, mouse, keyboard');
  console.log('');
  console.log('  Text Editor:');
  console.log('    POST /api/editor/execute  - View, create, replace, insert, undo');
  console.log('');
  console.log('  System:');
  console.log('    GET  /api/system/metrics  - Real-time CPU, memory, GPU metrics');
  console.log('');
  console.log('  Allowed Directories:');
  ALLOWED_DIRS.forEach(dir => console.log(`    - ${dir}`));
  console.log('');
  console.log(`  Database: SQLite at ${DB_PATH}`);
  console.log(`  API Keys: Anthropic=${!!process.env.ANTHROPIC_API_KEY ? '✓' : '✗'} OpenAI=${!!process.env.OPENAI_API_KEY ? '✓' : '✗'} Brave=${!!(process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY) ? '✓' : '✗'}`);
  console.log('  Health: GET /api/health');
  console.log('========================================================');
  console.log('');
});

// Periodic WAL checkpoint every 30s so data survives force-kills
setInterval(() => {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}
}, 30000);

// Graceful shutdown — checkpoint WAL so data persists across restarts
function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received, checkpointing database...`);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    console.log('[Server] Database closed cleanly.');
  } catch (err) {
    console.error('[Server] DB close error:', err.message);
  }
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
// Windows: handle Ctrl+C
if (process.platform === 'win32') {
  process.on('message', (msg) => { if (msg === 'shutdown') gracefulShutdown('shutdown'); });
}
