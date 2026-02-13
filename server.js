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
import { EventEmitter } from 'events';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import JSZip from 'jszip';
import rateLimit from 'express-rate-limit';
import { CloudflarePagesDeploy } from './server/services/cloudflarePagesDeploy.js';
import { CloudflareR2 } from './server/services/cloudflareR2.js';
import { CloudflareKV } from './server/services/cloudflareKV.js';
import { CloudflareImages } from './server/services/cloudflareImages.js';
import { CloudflareStream } from './server/services/cloudflareStream.js';
import { CloudflareVectorize } from './server/services/cloudflareVectorize.js';
import { buildStaticSite } from './server/services/buildStaticSite.js';
import { SandboxPipeline, getPipeline, setPipeline } from './server/services/sandboxPipeline.js';
import { generatePatchPlan, applyPatchPlan } from './server/services/sitePatchPlanner.js';
import { assemblePrompt, detectMode } from './server/prompts/index.js';

const resend = new Resend(process.env.RESEND_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

// Trust first proxy (Cloudflare, nginx, etc.) so req.ip is correct
app.set('trust proxy', 1);

// Deploy progress event emitters — keyed by deploymentId, auto-cleaned after done/error or 10-minute timeout
const deployEvents = new Map();
function emitDeployEvent(deployId, event, data) {
  const emitter = deployEvents.get(deployId);
  if (emitter) emitter.emit('progress', { event, ...data, timestamp: Date.now() });
}
function createDeployEmitter(deployId) {
  const emitter = new EventEmitter();
  deployEvents.set(deployId, emitter);
  // Auto-cleanup after 10 minutes
  const timeout = setTimeout(() => {
    emitter.removeAllListeners();
    deployEvents.delete(deployId);
  }, 10 * 60 * 1000);
  emitter._cleanupTimeout = timeout;
  return emitter;
}
function cleanupDeployEmitter(deployId) {
  const emitter = deployEvents.get(deployId);
  if (emitter) {
    if (emitter._cleanupTimeout) clearTimeout(emitter._cleanupTimeout);
    emitter.removeAllListeners();
    deployEvents.delete(deployId);
  }
}

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
// RATE LIMITING
// ============================================================================

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip?.replace(/^::ffff:/, '') || 'unknown',
  validate: false,
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Try again in 15 minutes.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip?.replace(/^::ffff:/, '') || 'unknown',
  validate: false,
});

const executionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Too many execution requests. Try again in 1 minute.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip?.replace(/^::ffff:/, '') || 'unknown',
  validate: false,
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many scan requests. Try again in 1 minute.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip?.replace(/^::ffff:/, '') || 'unknown',
  validate: false,
});

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

// Root route — always serve marketing site (users go to /app explicitly)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'marketing', 'index.html'));
});

// SPA fallback for React app routes (catch /app/* routes)
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================================
// JWT AUTH CONFIGURATION
// ============================================================================

const DEFAULT_JWT_SECRET = 'alin-dev-secret-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

// Security: fail-fast in production if JWT_SECRET is unset or default
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET)) {
  console.error('\n[FATAL] JWT_SECRET is not set or is using the default value.');
  console.error('[FATAL] Set a strong, unique JWT_SECRET environment variable for production.');
  console.error('[FATAL] Example: JWT_SECRET=$(openssl rand -hex 32)\n');
  process.exit(1);
} else if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET) {
  console.warn('\n⚠️  [Security] WARNING: Using default JWT_SECRET. Set JWT_SECRET env var for production.\n');
}

function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Token revocation blocklist — stores JWTs that have been explicitly logged out / refreshed
const revokedTokens = new Set();
// Periodically prune expired tokens from the blocklist (every hour)
setInterval(() => {
  for (const token of revokedTokens) {
    try { jwt.verify(token, JWT_SECRET); } catch { revokedTokens.delete(token); }
  }
}, 60 * 60 * 1000);

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  if (revokedTokens.has(token)) return res.status(401).json({ error: 'Token has been revoked' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Validate X-Project-Id ownership (falls back to 'default' if invalid)
    const rawProjectId = req.headers['x-project-id'] || 'default';
    try {
      const projectRow = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(rawProjectId, req.user.id);
      req.projectId = projectRow ? rawProjectId : 'default';
    } catch {
      req.projectId = 'default';
    }
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
  req.projectId = req.headers['x-project-id'] || 'default';
  next();
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Standardized error response helper.
 * In production, strips internal details from 500 errors.
 */
function sendError(res, status, error, code, suggestion) {
  const body = { error, code: code || 'INTERNAL_ERROR' };
  if (suggestion) body.suggestion = suggestion;
  if (!IS_PRODUCTION && status >= 500) body.details = error;
  if (IS_PRODUCTION && status >= 500) body.error = 'An internal error occurred. Please try again.';
  // Log 500 errors for audit trail
  if (status >= 500) {
    console.error(`[ServerError] ${status} ${code || 'INTERNAL_ERROR'}: ${error}`);
    try {
      db.prepare('INSERT INTO audit_entries (id, conversation_id, message_id, model, tokens_prompt, tokens_completion, tokens_total, cost, tools_used, duration_ms, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), '', '', 'server-error', 0, 0, 0, 0, JSON.stringify([{ error: error?.slice?.(0, 500) || error, code, status }]), 0, Date.now(), '');
    } catch {}
  }
  return res.status(status).json(body);
}

/**
 * Safe JSON parse — returns fallback on failure instead of throwing.
 * Use for parsing user-provided JSON, DB columns, request bodies, etc.
 */
function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== 'string') return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// ============================================================================
// DEFAULT MODEL CONFIGURATION — override via environment variables
// ============================================================================

const DEFAULT_MODELS = {
  claudeSonnet: process.env.DEFAULT_CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  claudeOpus: process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-6',
  claudeHaiku: process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
  gpt4o: process.env.GPT4O_MODEL || 'gpt-4o',
  gpt4oMini: process.env.GPT4O_MINI_MODEL || 'gpt-4o-mini',
  gpt4Turbo: process.env.GPT4_TURBO_MODEL || 'gpt-4-turbo',
  o1Preview: process.env.O1_PREVIEW_MODEL || 'o1-preview',
};

// ============================================================================
// PLAN TIER LIMITS
// ============================================================================

const PLAN_LIMITS = {
  free: {
    messagesPerHour: 25,
    allowedModels: [DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.gpt4oMini],
    opusCreditsPerMonth: 0,
    maxConversations: 50,
    tbwoEnabled: false,
    tbwoParallel: false,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 3,
    memoryRetentionDays: 30,
    selfLearning: false,
    maxTokens: 16384,
    computerUse: false,
    maxToolCallsPerMessage: 10,
    thinkingBudgetCap: 5000,
    tbwoRunsPerMonth: 0,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: false,
    vectorizeEnabled: false,
    maxCfImages: 5,
    maxCfVideos: 0,
  },
  pro: {
    messagesPerHour: -1,
    allowedModels: [DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.claudeHaiku, DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini, DEFAULT_MODELS.gpt4Turbo],
    opusCreditsPerMonth: 100,
    maxConversations: -1,
    tbwoEnabled: true,
    tbwoParallel: false,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: -1,
    selfLearning: true,
    maxTokens: 32768,
    computerUse: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 50000,
    tbwoRunsPerMonth: 50,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: 50,
    maxCfVideos: 20,
  },
  elite: {
    messagesPerHour: -1,
    allowedModels: [DEFAULT_MODELS.claudeOpus, DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.claudeHaiku, DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini, DEFAULT_MODELS.gpt4Turbo, DEFAULT_MODELS.o1Preview],
    opusCreditsPerMonth: -1,
    maxConversations: -1,
    tbwoEnabled: true,
    tbwoParallel: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: -1,
    selfLearning: true,
    maxTokens: 65536,
    computerUse: true,
    customRouting: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 100000,
    tbwoRunsPerMonth: -1,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: -1,
    maxCfVideos: -1,
  },
  // Admin virtual tier — every capability maxed out
  admin: {
    messagesPerHour: -1,
    allowedModels: [DEFAULT_MODELS.claudeOpus, DEFAULT_MODELS.claudeSonnet, DEFAULT_MODELS.claudeHaiku, DEFAULT_MODELS.gpt4o, DEFAULT_MODELS.gpt4oMini, DEFAULT_MODELS.gpt4Turbo, DEFAULT_MODELS.o1Preview],
    opusCreditsPerMonth: -1,
    maxConversations: -1,
    tbwoEnabled: true,
    tbwoParallel: true,
    directModeEnabled: true,
    codeLabEnabled: true,
    imageStudioEnabled: true,
    memoryLayers: 8,
    memoryRetentionDays: -1,
    selfLearning: true,
    maxTokens: 65536,
    computerUse: true,
    customRouting: true,
    maxToolCallsPerMessage: -1,
    thinkingBudgetCap: 100000,
    tbwoRunsPerMonth: -1,
    sitesEnabled: true,
    cfImagesEnabled: true,
    cfStreamEnabled: true,
    vectorizeEnabled: true,
    maxCfImages: -1,
    maxCfVideos: -1,
  },
};

// ============================================================================
// QUOTA HELPERS — monthly limit tracking via user_quotas table
// ============================================================================

function getCurrentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getQuotaCount(userId, quotaType) {
  const row = stmts.getQuota.get(userId, quotaType, getCurrentPeriod());
  return row ? row.count : 0;
}

function incrementQuota(userId, quotaType) {
  stmts.incrementQuota.run(userId, quotaType, getCurrentPeriod());
}

function checkPlanLimits(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  // Admin users get admin-level access (every ability maxed out)
  const plan = req.user.isAdmin ? 'admin' : (req.user.plan || 'free');
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

  // Check Opus monthly credits
  if (model && model.includes('opus') && limits.opusCreditsPerMonth > 0) {
    const used = getQuotaCount(req.user.id, 'opus_messages');
    if (used >= limits.opusCreditsPerMonth) {
      return res.status(429).json({
        error: 'Monthly Opus credits exhausted. Switch to Sonnet or upgrade to Elite for unlimited Opus.',
        used,
        limit: limits.opusCreditsPerMonth,
        code: 'OPUS_QUOTA_EXCEEDED',
      });
    }
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

  // Daily message cap (safety net)
  const DAILY_CAPS = { free: 100, pro: 1000, elite: -1, admin: -1 };
  const dailyCap = DAILY_CAPS[plan] ?? 100;
  if (dailyCap > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    try {
      const row = db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE timestamp > ? AND conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)'
      ).get(todayStart.getTime(), req.user.id);
      if (row && row.count >= dailyCap) {
        return res.status(429).json({
          error: 'Daily message limit reached. Resets at midnight.',
          limit: dailyCap,
          plan,
          code: 'DAILY_LIMIT_EXCEEDED',
        });
      }
    } catch {
      // Skip if query fails
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

const DB_DIR = process.env.DB_DIR || '/data';
// Ensure DB directory exists (Railway volumes may need this)
try { fsSync.mkdirSync(DB_DIR, { recursive: true }); } catch {}
const dbPath = process.env.DATABASE_PATH || '/data/alin.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

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

  -- Performance indexes for user-scoped queries (user_id added by migration below)
  -- These are created after the ALTER TABLE migration runs

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

// Add user_id columns to ALL user-scoped tables (safe — SQLite ignores if already exists)
const userIdTables = ['conversations', 'messages', 'tbwo_orders', 'artifacts', 'memory_entries', 'audit_entries', 'images', 'tbwo_receipts', 'execution_outcomes', 'user_corrections', 'decision_log', 'thinking_traces', 'memory_layers'];
for (const table of userIdTables) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT`); } catch { /* column already exists */ }
}

// Add project_id columns to root entities (safe — SQLite ignores if already exists)
const projectIdTables = ['conversations', 'tbwo_orders', 'memory_entries'];
for (const table of projectIdTables) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN project_id TEXT DEFAULT 'default'`); } catch { /* column already exists */ }
}

// Feature 6: Per-model success rate tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS model_success_rates (
    model TEXT PRIMARY KEY,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    avg_duration REAL DEFAULT 0,
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );
`);

// Feature 10: Add execution_state column to tbwo_orders for resumable execution
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

// Per-user settings table (composite PK so each user has their own settings)
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

// ============================================================================
// STARTUP VALIDATION
// ============================================================================

// Validate DB is writable
try {
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('__healthcheck', 'ok', ?) ON CONFLICT(key) DO UPDATE SET value='ok'").run(Date.now());
  db.prepare("DELETE FROM settings WHERE key = '__healthcheck'").run();
  console.log('[DB] Write health check passed');
} catch (dbErr) {
  console.error('[FATAL] Database is not writable:', dbErr.message);
  process.exit(1);
}

// Warn about missing API keys (fail on first use, not startup)
const envWarnings = [];
if (!process.env.ANTHROPIC_API_KEY) envWarnings.push('ANTHROPIC_API_KEY (Claude will not work)');
if (!process.env.OPENAI_API_KEY) envWarnings.push('OPENAI_API_KEY (GPT/DALL-E will not work)');
if (!process.env.RESEND_API_KEY) envWarnings.push('RESEND_API_KEY (email verification will not work)');
if (!process.env.BRAVE_API_KEY && !process.env.VITE_BRAVE_API_KEY) envWarnings.push('BRAVE_API_KEY (web search will not work)');
if (envWarnings.length > 0) {
  console.warn('\n⚠️  [Config] Missing optional environment variables:');
  envWarnings.forEach(w => console.warn(`   - ${w}`));
  console.warn('');
}

// Production CORS validation
if (IS_PRODUCTION && !process.env.CORS_ORIGIN) {
  console.error('[FATAL] CORS_ORIGIN must be set in production (e.g., CORS_ORIGIN=https://yourdomain.com)');
  process.exit(1);
}

// Prepared statements for performance — ALL user-scoped queries filter by user_id
const stmts = {
  // Conversations
  insertConversation: db.prepare(`INSERT INTO conversations (id,title,mode,model,provider,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?)`),
  getConversation: db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?'),
  listConversations: db.prepare(`SELECT id,title,mode,model,provider,is_favorite,is_archived,is_pinned,created_at,updated_at,(SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as message_count,(SELECT content FROM messages WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as last_message FROM conversations c WHERE is_archived=? AND user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`),
  updateConversation: db.prepare(`UPDATE conversations SET title=?,mode=?,model=?,provider=?,is_favorite=?,is_archived=?,is_pinned=?,metadata=?,updated_at=? WHERE id=? AND user_id=?`),
  deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?'),
  searchConversations: db.prepare(`SELECT DISTINCT c.id,c.title,c.updated_at,c.mode FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE c.user_id=? AND (m.content LIKE ? OR c.title LIKE ?) ORDER BY c.updated_at DESC LIMIT ?`),

  // Messages
  insertMessage: db.prepare(`INSERT INTO messages (id,conversation_id,role,content,tokens_input,tokens_output,cost,model,is_edited,parent_id,metadata,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  getMessages: db.prepare(`SELECT * FROM messages WHERE conversation_id=? AND user_id=? ORDER BY timestamp ASC`),
  updateMessage: db.prepare(`UPDATE messages SET content=?,is_edited=1,metadata=? WHERE id=? AND user_id=?`),
  deleteMessage: db.prepare('DELETE FROM messages WHERE id = ? AND user_id = ?'),

  // TBWO Receipts
  insertReceipt: db.prepare(`INSERT INTO tbwo_receipts (id,tbwo_id,receipt_type,data,created_at,user_id) VALUES (?,?,?,?,?,?)`),
  getReceipts: db.prepare('SELECT * FROM tbwo_receipts WHERE tbwo_id=? AND user_id=? ORDER BY created_at DESC'),

  // Settings (per-user via user_settings table)
  upsertSetting: db.prepare(`INSERT INTO user_settings (user_id,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`),
  getAllSettings: db.prepare('SELECT * FROM user_settings WHERE user_id=?'),

  // TBWO Orders
  insertTBWO: db.prepare(`INSERT INTO tbwo_orders (id,type,status,objective,time_budget_total,quality_target,scope,plan,pods,active_pods,artifacts,checkpoints,authority_level,progress,receipts,chat_conversation_id,started_at,completed_at,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  getTBWO: db.prepare('SELECT * FROM tbwo_orders WHERE id = ? AND user_id = ?'),
  listTBWOs: db.prepare('SELECT * FROM tbwo_orders WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
  updateTBWO: db.prepare(`UPDATE tbwo_orders SET type=?,status=?,objective=?,time_budget_total=?,quality_target=?,scope=?,plan=?,pods=?,active_pods=?,artifacts=?,checkpoints=?,authority_level=?,progress=?,receipts=?,chat_conversation_id=?,started_at=?,completed_at=?,metadata=?,execution_state=?,updated_at=? WHERE id=? AND user_id=?`),
  deleteTBWO: db.prepare('DELETE FROM tbwo_orders WHERE id = ? AND user_id = ?'),

  // Artifacts
  insertArtifact: db.prepare(`INSERT INTO artifacts (id,title,type,language,content,editable,conversation_id,tbwo_id,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  getArtifact: db.prepare('SELECT * FROM artifacts WHERE id = ? AND user_id = ?'),
  listArtifacts: db.prepare('SELECT * FROM artifacts WHERE user_id=? ORDER BY updated_at DESC LIMIT ?'),
  listArtifactsByConversation: db.prepare('SELECT * FROM artifacts WHERE conversation_id=? AND user_id=? ORDER BY updated_at DESC LIMIT ?'),
  listArtifactsByTBWO: db.prepare('SELECT * FROM artifacts WHERE tbwo_id=? AND user_id=? ORDER BY updated_at DESC LIMIT ?'),
  updateArtifact: db.prepare(`UPDATE artifacts SET title=?,type=?,language=?,content=?,editable=?,metadata=?,updated_at=? WHERE id=? AND user_id=?`),
  deleteArtifact: db.prepare('DELETE FROM artifacts WHERE id = ? AND user_id = ?'),

  // Memory Entries
  insertMemory: db.prepare(`INSERT INTO memory_entries (id,layer,content,salience,decay_rate,access_count,is_consolidated,is_archived,is_pinned,user_modified,tags,related_memories,edit_history,metadata,last_accessed_at,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  getMemory: db.prepare('SELECT * FROM memory_entries WHERE id = ? AND user_id = ?'),
  listMemories: db.prepare('SELECT * FROM memory_entries WHERE user_id=? ORDER BY salience DESC'),
  listMemoriesByLayer: db.prepare('SELECT * FROM memory_entries WHERE layer=? AND user_id=? ORDER BY salience DESC'),
  updateMemory: db.prepare(`UPDATE memory_entries SET layer=?,content=?,salience=?,decay_rate=?,access_count=?,is_consolidated=?,is_archived=?,is_pinned=?,user_modified=?,tags=?,related_memories=?,edit_history=?,metadata=?,last_accessed_at=?,updated_at=? WHERE id=? AND user_id=?`),
  deleteMemory: db.prepare('DELETE FROM memory_entries WHERE id = ? AND user_id = ?'),

  // Audit Entries
  insertAudit: db.prepare(`INSERT INTO audit_entries (id,conversation_id,message_id,model,tokens_prompt,tokens_completion,tokens_total,cost,tools_used,duration_ms,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  listAudit: db.prepare('SELECT * FROM audit_entries WHERE user_id=? ORDER BY timestamp DESC LIMIT ?'),
  listAuditSince: db.prepare('SELECT * FROM audit_entries WHERE user_id=? AND timestamp>=? ORDER BY timestamp DESC'),
  pruneAudit: db.prepare('DELETE FROM audit_entries WHERE user_id=? AND timestamp < ?'),

  // Images
  insertImage: db.prepare(`INSERT INTO images (id,url,prompt,revised_prompt,model,size,quality,style,conversation_id,message_id,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  listImages: db.prepare('SELECT * FROM images WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?'),

  // Sites
  insertSite: db.prepare(`INSERT INTO sites (id,user_id,project_id,name,tbwo_run_id,status,cloudflare_project_name,domain,manifest,storage_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
  getSite: db.prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?'),
  listSites: db.prepare('SELECT * FROM sites WHERE user_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
  updateSite: db.prepare('UPDATE sites SET name=?,status=?,cloudflare_project_name=?,domain=?,manifest=?,updated_at=? WHERE id=? AND user_id=?'),

  // Deployments
  insertDeployment: db.prepare(`INSERT INTO deployments (id,site_id,user_id,cloudflare_project_name,cloudflare_deployment_id,url,status,build_log,error,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  listDeployments: db.prepare('SELECT * FROM deployments WHERE site_id=? AND user_id=? ORDER BY created_at DESC LIMIT ?'),
  updateDeploymentStatus: db.prepare('UPDATE deployments SET status=?,cloudflare_deployment_id=?,url=?,build_log=?,error=? WHERE id=? AND user_id=?'),

  // Site Patches
  insertPatch: db.prepare(`INSERT INTO site_patches (id,site_id,user_id,change_request,plan,status,created_at) VALUES (?,?,?,?,?,?,?)`),
  getPatch: db.prepare('SELECT * FROM site_patches WHERE id = ? AND user_id = ?'),
  listPatches: db.prepare('SELECT * FROM site_patches WHERE site_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?'),
  updatePatch: db.prepare('UPDATE site_patches SET plan=?,status=?,apply_result=?,resolved_at=? WHERE id=? AND user_id=?'),

  // Self-Model: Execution Outcomes
  insertOutcome: db.prepare(`INSERT INTO execution_outcomes (id,tbwo_id,objective,type,time_budget,plan_confidence,phases_completed,phases_failed,artifacts_count,user_edits_after,quality_score,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  listOutcomes: db.prepare('SELECT * FROM execution_outcomes WHERE user_id=? ORDER BY timestamp DESC LIMIT ?'),
  listOutcomesByType: db.prepare('SELECT * FROM execution_outcomes WHERE user_id=? AND type=? ORDER BY timestamp DESC LIMIT ?'),

  // Self-Model: Tool Reliability (shared — measures backend tool behavior, not user data)
  getToolReliability: db.prepare('SELECT * FROM tool_reliability ORDER BY (success_count + failure_count) DESC'),
  upsertToolReliability: db.prepare(`INSERT INTO tool_reliability (tool_name, success_count, failure_count, avg_duration, common_errors, last_failure_reason)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tool_name) DO UPDATE SET
      success_count = tool_reliability.success_count + excluded.success_count,
      failure_count = tool_reliability.failure_count + excluded.failure_count,
      avg_duration = (tool_reliability.avg_duration * (tool_reliability.success_count + tool_reliability.failure_count) + excluded.avg_duration) / (tool_reliability.success_count + tool_reliability.failure_count + 1),
      common_errors = CASE WHEN excluded.last_failure_reason != '' THEN excluded.common_errors ELSE tool_reliability.common_errors END,
      last_failure_reason = CASE WHEN excluded.last_failure_reason != '' THEN excluded.last_failure_reason ELSE tool_reliability.last_failure_reason END`),

  // Self-Model: Model Success Rates (Feature 6 — adaptive routing)
  getModelSuccessRates: db.prepare('SELECT model, success_count, failure_count, (success_count + failure_count) as total_calls, avg_duration FROM model_success_rates WHERE model != \'unknown\' ORDER BY total_calls DESC'),
  upsertModelSuccessRate: db.prepare(`INSERT INTO model_success_rates (model, success_count, failure_count, avg_duration, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(model) DO UPDATE SET
      success_count = model_success_rates.success_count + excluded.success_count,
      failure_count = model_success_rates.failure_count + excluded.failure_count,
      avg_duration = (model_success_rates.avg_duration * (model_success_rates.success_count + model_success_rates.failure_count) + excluded.avg_duration) / (model_success_rates.success_count + model_success_rates.failure_count + 1),
      updated_at = excluded.updated_at`),

  // Self-Model: User Corrections
  insertCorrection: db.prepare(`INSERT INTO user_corrections (id, original_value, corrected_value, category, correction_count, last_corrected, user_id) VALUES (?,?,?,?,1,?,?)`),
  findCorrection: db.prepare('SELECT * FROM user_corrections WHERE category=? AND corrected_value=? AND user_id=? LIMIT 1'),
  incrementCorrection: db.prepare('UPDATE user_corrections SET correction_count = correction_count + 1, last_corrected = ? WHERE id = ? AND user_id = ?'),
  listCorrections: db.prepare('SELECT * FROM user_corrections WHERE user_id=? AND correction_count >= ? ORDER BY correction_count DESC'),

  // Self-Model: Decision Log
  insertDecision: db.prepare(`INSERT INTO decision_log (id,tbwo_id,decision_type,options_considered,chosen_option,reasoning,outcome,confidence,timestamp,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  listDecisions: db.prepare('SELECT * FROM decision_log WHERE user_id=? ORDER BY timestamp DESC LIMIT ?'),
  listDecisionsByTBWO: db.prepare('SELECT * FROM decision_log WHERE user_id=? AND tbwo_id=? ORDER BY timestamp DESC LIMIT ?'),

  // Self-Model: Thinking Traces
  insertThinkingTrace: db.prepare(`INSERT INTO thinking_traces (id,conversation_id,message_id,tbwo_id,thinking_content,timestamp,user_id) VALUES (?,?,?,?,?,?,?)`),
  listThinkingByConv: db.prepare('SELECT * FROM thinking_traces WHERE conversation_id=? AND user_id=? ORDER BY timestamp ASC'),
  listThinkingByTBWO: db.prepare('SELECT * FROM thinking_traces WHERE tbwo_id=? AND user_id=? ORDER BY timestamp ASC'),
  searchThinking: db.prepare('SELECT * FROM thinking_traces WHERE user_id=? AND thinking_content LIKE ? ORDER BY timestamp DESC LIMIT ?'),

  // Self-Model: Layer Memory
  insertLayerMemory: db.prepare(`INSERT INTO memory_layers (id,layer,content,category,salience,expires_at,metadata,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  listLayerMemories: db.prepare('SELECT * FROM memory_layers WHERE layer=? AND user_id=? AND (expires_at IS NULL OR expires_at > ?) ORDER BY salience DESC LIMIT ?'),
  pruneExpiredLayers: db.prepare('DELETE FROM memory_layers WHERE user_id=? AND expires_at IS NOT NULL AND expires_at < ?'),
  deleteLayerMemory: db.prepare('DELETE FROM memory_layers WHERE id = ? AND user_id = ?'),

  // Site Versions
  insertSiteVersion: db.prepare(`INSERT INTO site_versions (id,site_id,user_id,version,file_count,total_bytes,deployment_id,created_at) VALUES (?,?,?,?,?,?,?,?)`),
  listSiteVersions: db.prepare('SELECT * FROM site_versions WHERE site_id=? AND user_id=? ORDER BY version DESC LIMIT ?'),
  getLatestVersion: db.prepare('SELECT * FROM site_versions WHERE site_id=? AND user_id=? ORDER BY version DESC LIMIT 1'),

  // CF Images
  insertCfImage: db.prepare(`INSERT INTO cf_images (id,user_id,cf_image_id,filename,url,variants,metadata,site_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)`),
  listCfImages: db.prepare('SELECT * FROM cf_images WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
  getCfImage: db.prepare('SELECT * FROM cf_images WHERE id=? AND user_id=?'),
  deleteCfImage: db.prepare('DELETE FROM cf_images WHERE id=? AND user_id=?'),

  // CF Videos
  insertCfVideo: db.prepare(`INSERT INTO cf_videos (id,user_id,cf_uid,status,thumbnail,preview,duration,metadata,site_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  listCfVideos: db.prepare('SELECT * FROM cf_videos WHERE user_id=? ORDER BY created_at DESC LIMIT ?'),
  getCfVideo: db.prepare('SELECT * FROM cf_videos WHERE id=? AND user_id=?'),
  updateCfVideo: db.prepare('UPDATE cf_videos SET status=?,thumbnail=?,preview=?,duration=? WHERE id=? AND user_id=?'),
  deleteCfVideo: db.prepare('DELETE FROM cf_videos WHERE id=? AND user_id=?'),

  // Thread Chunks
  insertThreadChunk: db.prepare(`INSERT INTO thread_chunks (id,thread_id,user_id,chunk_index,content,summary,token_count,vector_id,metadata,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`),
  deleteThreadChunks: db.prepare('DELETE FROM thread_chunks WHERE thread_id=? AND user_id=?'),
  listUserThreads: db.prepare('SELECT thread_id, MIN(created_at) as created_at, COUNT(*) as chunk_count, SUM(token_count) as total_tokens FROM thread_chunks WHERE user_id=? GROUP BY thread_id ORDER BY MIN(created_at) DESC LIMIT ?'),

  // Users (no user_id filtering — these ARE the user table)
  insertUser: db.prepare(`INSERT INTO users (id,email,password_hash,display_name,plan,is_admin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`),
  getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  updateUser: db.prepare(`UPDATE users SET email=?,display_name=?,plan=?,updated_at=? WHERE id=?`),
  updateUserPassword: db.prepare(`UPDATE users SET password_hash=?,updated_at=? WHERE id=?`),
  countUsers: db.prepare('SELECT COUNT(*) as count FROM users'),

  // User Quotas
  getQuota: db.prepare('SELECT count FROM user_quotas WHERE user_id=? AND quota_type=? AND period=?'),
  incrementQuota: db.prepare(`INSERT INTO user_quotas (user_id, quota_type, period, count) VALUES (?, ?, ?, 1) ON CONFLICT(user_id, quota_type, period) DO UPDATE SET count = count + 1`),
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
      from: 'ALIN <noreply@alinai.dev>',
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

app.post('/api/auth/signup', authLimiter, async (req, res) => {
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

      // Migrate existing data (use prepared statements to prevent SQL injection)
      try {
        const migrateTables = ['conversations', 'messages', 'memory_entries', 'artifacts', 'audit_entries', 'images', 'tbwo_orders'];
        for (const table of migrateTables) {
          db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(id);
        }
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
    sendError(res, 500, error.message);
  }
});

// Verify email with 6-digit code
app.post('/api/auth/verify', verifyLimiter, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

// Resend verification code
app.post('/api/auth/resend-code', authLimiter, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  try {
    const user = stmts.getUserById.get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, user: { id: user.id, email: user.email, displayName: user.display_name, plan: user.plan, isAdmin: !!user.is_admin } });
  } catch (error) {
    sendError(res, 500, error.message);
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
    sendError(res, 500, error.message);
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
    sendError(res, 500, error.message);
  }
});

// POST /api/auth/refresh — Issue a new JWT, revoking the old one
app.post('/api/auth/refresh', requireAuth, async (req, res) => {
  try {
    const oldToken = req.headers.authorization?.replace('Bearer ', '');
    const user = stmts.getUserById.get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newToken = jwt.sign(
      { id: user.id, email: user.email, plan: user.plan, isAdmin: !!user.is_admin },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // Revoke the old token
    if (oldToken) revokedTokens.add(oldToken);

    res.json({
      success: true,
      token: newToken,
      user: { id: user.id, email: user.email, displayName: user.display_name, plan: user.plan, isAdmin: !!user.is_admin, emailVerified: !!user.email_verified },
    });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// POST /api/auth/logout — Revoke the current token
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) revokedTokens.add(token);
  res.json({ success: true });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, display_name, plan, is_admin, created_at FROM users').all();
  res.json({ success: true, users });
});

// One-time bootstrap: promote first user to admin+pro
// Requires ALIN_BOOTSTRAP_TOKEN env var OR localhost-only access
app.post('/api/admin/bootstrap', (req, res) => {
  try {
    // Security: require either a setup token or localhost access
    const bootstrapToken = process.env.ALIN_BOOTSTRAP_TOKEN;
    const clientIp = req.ip || req.connection?.remoteAddress;
    const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';

    if (bootstrapToken) {
      // Token-based auth: works from any IP (safer for proxied setups)
      const providedToken = req.headers['x-bootstrap-token'] || req.body.token;
      if (providedToken !== bootstrapToken) {
        return res.status(403).json({ error: 'Invalid bootstrap token', code: 'INVALID_TOKEN' });
      }
    } else if (!isLocalhost) {
      // Fallback to localhost-only if no token configured
      return res.status(403).json({ error: 'Bootstrap only allowed from localhost (set ALIN_BOOTSTRAP_TOKEN for remote access)', code: 'LOCALHOST_ONLY' });
    }

    // Use a transaction to prevent race conditions between check and update
    const bootstrapTx = db.transaction(() => {
      const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
      if (adminExists) return { error: 'Admin already exists' };
      const firstUser = db.prepare('SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1').get();
      if (!firstUser) return { error: 'No users found', status: 404 };
      db.prepare('UPDATE users SET plan = ?, is_admin = 1, email_verified = 1 WHERE id = ?').run('pro', firstUser.id);
      return { success: true, email: firstUser.email };
    });
    const result = bootstrapTx();
    if (result.error) return res.status(result.status || 403).json({ error: result.error });
    console.log(`[Admin] Bootstrapped admin: ${result.email}`);
    res.json({ success: true, promoted: result.email, plan: 'pro', isAdmin: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    console.log(`[Admin] Deleted user: ${user.email}`);
    res.json({ success: true, deleted: user.email });
  } catch (error) { sendError(res, 500, error.message); }
});

// Per-user cost aggregation
app.get('/api/admin/users/:id/costs', requireAuth, requireAdmin, (req, res) => {
  try {
    const period = req.query.period || 'month';
    const periodMs = { day: 86400000, week: 604800000, month: 2592000000, all: 0 }[period] || 2592000000;
    const since = periodMs > 0 ? Date.now() - periodMs : 0;
    const row = db.prepare(
      'SELECT COALESCE(SUM(cost), 0) as totalCost, COUNT(*) as messageCount, COALESCE(SUM(tokens_total), 0) as totalTokens FROM audit_entries WHERE user_id = ? AND timestamp > ?'
    ).get(req.params.id, since);
    res.json({ success: true, userId: req.params.id, period, ...row });
  } catch (error) { sendError(res, 500, error.message); }
});

// All users' costs ranked
app.get('/api/admin/costs/summary', requireAuth, requireAdmin, (req, res) => {
  try {
    const period = req.query.period || 'month';
    const periodMs = { day: 86400000, week: 604800000, month: 2592000000, all: 0 }[period] || 2592000000;
    const since = periodMs > 0 ? Date.now() - periodMs : 0;
    const rows = db.prepare(
      `SELECT a.user_id, u.email, u.display_name, u.plan,
              COALESCE(SUM(a.cost), 0) as totalCost, COUNT(*) as messageCount, COALESCE(SUM(a.tokens_total), 0) as totalTokens
       FROM audit_entries a LEFT JOIN users u ON a.user_id = u.id
       WHERE a.timestamp > ? GROUP BY a.user_id ORDER BY totalCost DESC`
    ).all(since);
    res.json({ success: true, period, users: rows });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// ADMIN DASHBOARD ENDPOINTS
// ============================================================================

// Overview stats
app.get('/api/admin/stats', requireAuth, requireAdmin, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const proUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE plan = 'pro'").get().count;
    const totalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
    const todaySignups = db.prepare(
      "SELECT COUNT(*) as count FROM users WHERE created_at > datetime('now', '-1 day')"
    ).get().count;
    const activeToday = db.prepare(
      "SELECT COUNT(DISTINCT user_id) as count FROM telemetry_events WHERE timestamp > datetime('now', '-1 day')"
    ).get().count;

    const tokenUsage = db.prepare(
      "SELECT COALESCE(SUM(total_input_tokens), 0) as input, COALESCE(SUM(total_output_tokens), 0) as output FROM telemetry_conversations"
    ).get();

    const topModels = db.prepare(
      "SELECT model_used, COUNT(*) as count FROM telemetry_conversations GROUP BY model_used ORDER BY count DESC LIMIT 5"
    ).all();

    const recentUsers = db.prepare(
      "SELECT id, email, display_name, plan, created_at FROM users ORDER BY created_at DESC LIMIT 20"
    ).all();

    const recentEvents = db.prepare(
      "SELECT event_type, COUNT(*) as count FROM telemetry_events WHERE timestamp > datetime('now', '-1 day') GROUP BY event_type ORDER BY count DESC"
    ).all();

    res.json({
      overview: {
        totalUsers,
        proUsers,
        freeUsers: totalUsers - proUsers,
        totalConversations,
        totalMessages,
        todaySignups,
        activeToday,
        totalInputTokens: tokenUsage.input,
        totalOutputTokens: tokenUsage.output,
      },
      topModels,
      recentUsers,
      recentEvents,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User list with search (enhanced version)
app.get('/api/admin/users/search', requireAuth, requireAdmin, (req, res) => {
  try {
    const search = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    let users;
    if (search) {
      users = db.prepare(
        "SELECT id, email, display_name, plan, is_admin, created_at FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(`%${search}%`, `%${search}%`, limit, offset);
    } else {
      users = db.prepare(
        "SELECT id, email, display_name, plan, is_admin, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?"
      ).all(limit, offset);
    }

    const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update user plan
app.patch('/api/admin/users/:id/plan', requireAuth, requireAdmin, (req, res) => {
  try {
    const { plan } = req.body;
    if (!['free', 'pro', 'elite'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Telemetry data export (for training)
app.get('/api/admin/telemetry/export', requireAuth, requireAdmin, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const events = db.prepare(
      "SELECT * FROM telemetry_events WHERE timestamp > datetime('now', ? || ' days') ORDER BY timestamp DESC"
    ).all(`-${days}`);
    const conversations = db.prepare(
      "SELECT * FROM telemetry_conversations WHERE started_at > datetime('now', ? || ' days') ORDER BY started_at DESC"
    ).all(`-${days}`);
    const feedback = db.prepare(
      "SELECT * FROM telemetry_feedback WHERE timestamp > datetime('now', ? || ' days') ORDER BY timestamp DESC"
    ).all(`-${days}`);
    const tools = db.prepare(
      "SELECT * FROM telemetry_tool_usage WHERE timestamp > datetime('now', ? || ' days') ORDER BY timestamp DESC"
    ).all(`-${days}`);

    res.json({ events, conversations, feedback, tools });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Live activity feed
app.get('/api/admin/activity', requireAuth, requireAdmin, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const events = db.prepare(`
      SELECT te.*, u.email, u.display_name
      FROM telemetry_events te
      LEFT JOIN users u ON te.user_id = u.id
      ORDER BY te.timestamp DESC
      LIMIT ?
    `).all(limit);
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// TELEMETRY ENDPOINTS
// ============================================================================

// Log feedback (thumbs up/down, corrections)
app.post('/api/telemetry/feedback', requireAuth, (req, res) => {
  try {
    const { conversationId, messageId, feedbackType,
            originalResponse, correctedResponse } = req.body;
    db.prepare(`
      INSERT INTO telemetry_feedback
        (user_id, conversation_id, message_id, feedback_type,
         original_response, corrected_response)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, conversationId, messageId, feedbackType,
           originalResponse || null, correctedResponse || null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// WEBHOOK ENDPOINTS
// ============================================================================

app.post('/api/webhook/email', express.json(), (req, res) => {
  const event = req.body;

  if (event.type === 'email.received') {
    const { from, to, subject, text, html } = event.data;

    if (to.some(addr => addr.includes('help@'))) {
      console.log(`[Webhook] Support email from ${from}: ${subject}`);

      resend.emails.send({
        from: 'noreply@alinai.dev',
        to: from,
        subject: `Re: ${subject}`,
        text: 'Thanks for reaching out! We received your message and will respond shortly.'
      }).catch(err => console.error('[Webhook] Auto-reply failed:', err.message));
    }
  }

  res.json({ received: true });
});

app.post('/api/contact', express.json(), async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message)
    return res.status(400).json({ error: 'Name, email, and message required.' });

  try {
    await resend.emails.send({
      from: 'ALIN Contact <noreply@alinai.dev>',
      to: 'jacobbeach2@icloud.com',
      replyTo: email,
      subject: `[${subject}] from ${name}`,
      text: `From: ${name} <${email}>\nSubject: ${subject}\n\n${message}`
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Contact] Failed to send:', err.message);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

// ============================================================================
// CONVERSATION ENDPOINTS
// ============================================================================

app.get('/api/conversations', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const archived = parseInt(req.query.archived) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const conversations = stmts.listConversations.all(archived, userId, limit, offset).map(c => {
      let preview = '';
      try { const content = JSON.parse(c.last_message || '[]'); preview = content.find(b => b.type === 'text')?.text?.slice(0, 100) || ''; } catch {}
      return { id: c.id, title: c.title, mode: c.mode, model: c.model, provider: c.provider, isFavorite: !!c.is_favorite, isArchived: !!c.is_archived, isPinned: !!c.is_pinned, messageCount: c.message_count, preview, createdAt: c.created_at, updatedAt: c.updated_at };
    });
    res.json({ success: true, conversations });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/conversations', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { id: clientId, title, mode, model, provider } = req.body;
    const id = clientId || randomUUID();
    const now = Date.now();
    stmts.insertConversation.run(id, title || 'New Chat', mode || 'regular', model || DEFAULT_MODELS.claudeSonnet, provider || 'anthropic', '{}', now, now, userId);
    console.log(`[DB] Created conversation: ${id} for user: ${userId}`);
    res.json({ success: true, id, createdAt: now });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/conversations/:id', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const conversation = stmts.getConversation.get(req.params.id, userId);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    const messages = stmts.getMessages.all(req.params.id, userId).map(m => ({ ...m, content: JSON.parse(m.content), metadata: JSON.parse(m.metadata || '{}'), isEdited: !!m.is_edited }));
    res.json({ success: true, conversation: { ...conversation, metadata: JSON.parse(conversation.metadata || '{}'), isFavorite: !!conversation.is_favorite, isArchived: !!conversation.is_archived, isPinned: !!conversation.is_pinned }, messages });
  } catch (error) { sendError(res, 500, error.message); }
});

app.patch('/api/conversations/:id', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const e = stmts.getConversation.get(req.params.id, userId);
    if (!e) return res.status(404).json({ error: 'Not found' });
    stmts.updateConversation.run(
      req.body.title ?? e.title, req.body.mode ?? e.mode, req.body.model ?? e.model, req.body.provider ?? e.provider,
      req.body.isFavorite !== undefined ? (req.body.isFavorite ? 1 : 0) : e.is_favorite,
      req.body.isArchived !== undefined ? (req.body.isArchived ? 1 : 0) : e.is_archived,
      req.body.isPinned !== undefined ? (req.body.isPinned ? 1 : 0) : e.is_pinned,
      req.body.metadata ? JSON.stringify(req.body.metadata) : e.metadata, Date.now(), req.params.id, userId
    );
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/conversations/:id', requireAuth, (req, res) => {
  try { stmts.deleteConversation.run(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/conversations/search', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { q, limit } = req.query;
    if (!q) return res.status(400).json({ error: 'Query required' });
    const results = stmts.searchConversations.all(userId, `%${q}%`, `%${q}%`, parseInt(limit) || 20);
    res.json({ success: true, results });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// MESSAGE ENDPOINTS
// ============================================================================

app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { id: clientId, role, content, model, tokensInput, tokensOutput, cost, parentId, metadata } = req.body;
    const id = clientId || randomUUID();
    const now = Date.now();
    stmts.insertMessage.run(id, req.params.id, role, JSON.stringify(content), tokensInput || 0, tokensOutput || 0, cost || 0, model || null, 0, parentId || null, JSON.stringify(metadata || {}), now, userId);
    db.prepare('UPDATE conversations SET updated_at=? WHERE id=? AND user_id=?').run(now, req.params.id, userId);
    res.json({ success: true, id, timestamp: now });
  } catch (error) { sendError(res, 500, error.message); }
});

app.patch('/api/messages/:id', requireAuth, (req, res) => {
  try { stmts.updateMessage.run(JSON.stringify(req.body.content), JSON.stringify(req.body.metadata || {}), req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/messages/:id', requireAuth, (req, res) => {
  try { stmts.deleteMessage.run(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// SSE STREAMING AI PROXY (API keys stay server-side)
// ============================================================================

function setupSSE(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  // Keep-alive heartbeat every 15s to prevent proxy/LB timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 15_000);
  res.on('close', () => clearInterval(heartbeat));
}
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

/**
 * Enhanced streaming proxy with full tool_use support, thinking, and auth.
 * SSE events: text, thinking, tool_use, usage, done, error
 */
async function streamAnthropicToSSE(res, { model, messages, system, tools, thinking, thinkingBudget, maxTokens, temperature }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { sendSSE(res, 'error', { error: 'ANTHROPIC_API_KEY not set in server .env' }); return res.end(); }

  const body = {
    model: model || DEFAULT_MODELS.claudeSonnet,
    max_tokens: maxTokens || 16384,
    stream: true,
    messages,
  };
  if (system) body.system = system;
  if (tools && tools.length > 0) body.tools = tools;
  if (thinking) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget || 10000 };
    if (body.max_tokens <= (thinkingBudget || 10000)) {
      body.max_tokens = (thinkingBudget || 10000) + 16384;
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
    console.error(`[Anthropic] ${response.status} error:`, t.slice(0, 500));
    // Parse Anthropic error to extract the actual message
    let errorMsg = `Anthropic ${response.status}`;
    try {
      const errBody = JSON.parse(t);
      if (errBody.error?.message) errorMsg = errBody.error.message;
    } catch {}
    sendSSE(res, 'error', { error: errorMsg, details: t });
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
            sendSSE(res, 'thinking_delta', { thinking: ev.delta.thinking });
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

// Convert Claude-format tools to OpenAI function-calling format
function convertToolsToOpenAI(tools) {
  if (!tools || !Array.isArray(tools)) return [];
  return tools
    .filter(t => t.name && t.input_schema) // skip non-standard tools (computer_use, text_editor)
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.input_schema || { type: 'object', properties: {} },
      },
    }));
}

// Convert Claude-format messages to OpenAI-format messages
function convertMessagesToOpenAI(messages, system) {
  const oaiMessages = [];
  if (system) oaiMessages.push({ role: 'system', content: system });

  for (const m of messages) {
    // Handle string content directly
    if (typeof m.content === 'string') {
      oaiMessages.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) {
      oaiMessages.push({ role: m.role, content: String(m.content || '') });
      continue;
    }

    // Check if this message contains tool_result blocks (= tool response message)
    const toolResults = m.content.filter(b => b.type === 'tool_result');
    if (toolResults.length > 0) {
      // OpenAI expects each tool result as a separate {role:'tool'} message
      for (const tr of toolResults) {
        oaiMessages.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id || tr.toolUseId || '',
          content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content || ''),
        });
      }
      continue;
    }

    // Check if this is an assistant message with tool_use blocks
    const toolUses = m.content.filter(b => b.type === 'tool_use');
    const textBlocks = m.content.filter(b => b.type === 'text');
    const imageBlocks = m.content.filter(b => b.type === 'image' || b.type === 'image_url');

    if (m.role === 'assistant' && toolUses.length > 0) {
      // OpenAI assistant messages with tool calls
      const textContent = textBlocks.map(b => b.text).join('') || null;
      oaiMessages.push({
        role: 'assistant',
        content: textContent,
        tool_calls: toolUses.map((tu, i) => ({
          id: tu.id || tu.toolUseId || `call_${i}`,
          type: 'function',
          function: {
            name: tu.name || tu.toolName || '',
            arguments: JSON.stringify(tu.input || tu.toolInput || {}),
          },
        })),
      });
      continue;
    }

    // Regular message — convert content blocks
    const oaiContent = [];
    for (const b of m.content) {
      if (b.type === 'text' && b.text) {
        oaiContent.push({ type: 'text', text: b.text });
      } else if (b.type === 'image_url') {
        oaiContent.push(b);
      } else if (b.type === 'image' && b.source) {
        // Convert Claude image format to OpenAI image_url format
        if (b.source.type === 'base64') {
          oaiContent.push({
            type: 'image_url',
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          });
        } else if (b.source.type === 'url') {
          oaiContent.push({ type: 'image_url', image_url: { url: b.source.url } });
        }
      }
      // Skip thinking, redacted_thinking, tool_activity — not relevant for OpenAI
    }

    if (oaiContent.length > 0) {
      oaiMessages.push({ role: m.role, content: oaiContent.length === 1 && oaiContent[0].type === 'text' ? oaiContent[0].text : oaiContent });
    } else {
      oaiMessages.push({ role: m.role, content: '[empty message]' });
    }
  }

  return oaiMessages;
}

async function streamOpenAIToSSE(res, { model, messages, system, tools, maxTokens, temperature }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { sendSSE(res, 'error', { error: 'OPENAI_API_KEY not set in server .env' }); return res.end(); }

  const oaiMessages = convertMessagesToOpenAI(messages, system);

  const body = {
    model: model || DEFAULT_MODELS.gpt4o,
    stream: true,
    messages: oaiMessages,
    temperature: temperature ?? 0.7,
    max_tokens: maxTokens || 16384,
  };
  // Convert tools from Claude format to OpenAI function-calling format
  const oaiTools = convertToolsToOpenAI(tools);
  if (oaiTools.length > 0) body.tools = oaiTools;

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
  let lastFinishReason = '';

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
        if (choice.finish_reason) {
          lastFinishReason = choice.finish_reason;
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            // Emit accumulated tool calls
            for (const idx of Object.keys(toolCalls)) {
              const tc = toolCalls[idx];
              let parsedArgs = {};
              try { parsedArgs = JSON.parse(tc.arguments || '{}'); } catch {}
              sendSSE(res, 'tool_use', { id: tc.id, name: tc.name, input: parsedArgs });
            }
          }
        }
      } catch {}
    }
  }
  let stopReason;
  if (Object.keys(toolCalls).length > 0) {
    stopReason = 'tool_use';
  } else if (lastFinishReason === 'length') {
    stopReason = 'max_tokens';
  } else {
    stopReason = 'end_turn';
  }
  sendSSE(res, 'done', { model, stopReason });
  res.end();
}

app.post('/api/chat/stream', requireAuth, checkPlanLimits, async (req, res) => {
  const { messages, model, provider, system, systemPrompt, tools, thinking, thinkingBudget, maxTokens, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  setupSSE(res);

  try {
    const isAnthropic = provider === 'anthropic' || model?.startsWith('claude');

    // Server-side prompt assembly: if frontend sends '[DEPRECATED]' or no system prompt,
    // assemble from modular prompts. Otherwise use provided system prompt (backward compat).
    let sysPrompt;
    if (system && system !== '[DEPRECATED]') {
      sysPrompt = system;
    } else if (systemPrompt && systemPrompt !== '[DEPRECATED]') {
      sysPrompt = systemPrompt;
    } else {
      const mode = req.body.mode || 'regular';
      sysPrompt = assemblePrompt(mode, { additionalContext: req.body.additionalContext || '' });
    }

    // Mode detection hint (only in chat/regular mode)
    if ((!req.body.mode || req.body.mode === 'regular') && messages?.length > 0) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const lastText = typeof lastUser?.content === 'string' ? lastUser.content
        : Array.isArray(lastUser?.content) ? lastUser.content.filter(b => b.type === 'text').map(b => b.text).join('') : '';
      if (lastText) {
        const recentTexts = messages.filter(m => m.role === 'user').slice(-5)
          .map(m => typeof m.content === 'string' ? m.content : '');
        const hint = detectMode(lastText, 'chat', recentTexts);
        if (hint.shouldSwitch) {
          sendSSE(res, 'mode_hint', { suggestedMode: hint.mode, confidence: hint.confidence, reason: hint.reason });
        }
      }
    }

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

    // Server-side prompt assembly (same logic as /api/chat/stream, no mode detection on continuations)
    let sysPrompt;
    if (system && system !== '[DEPRECATED]') {
      sysPrompt = system;
    } else if (systemPrompt && systemPrompt !== '[DEPRECATED]') {
      sysPrompt = systemPrompt;
    } else {
      const mode = req.body.mode || 'regular';
      sysPrompt = assemblePrompt(mode, { additionalContext: req.body.additionalContext || '' });
    }

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

app.post('/api/tbwo/:tbwoId/receipts', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { type, data } = req.body;
    const id = randomUUID();
    stmts.insertReceipt.run(id, req.params.tbwoId, type || 'full', JSON.stringify(data), Date.now(), userId);
    console.log(`[DB] Saved receipt for TBWO: ${req.params.tbwoId}`);
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/tbwo/:tbwoId/receipts', requireAuth, (req, res) => {
  try {
    const receipts = stmts.getReceipts.all(req.params.tbwoId, req.user.id).map(r => ({ ...r, data: JSON.parse(r.data) }));
    res.json({ success: true, receipts });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// SETTINGS ENDPOINTS
// ============================================================================

app.get('/api/settings', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const settings = {};
    stmts.getAllSettings.all(userId).forEach(s => { try { settings[s.key] = JSON.parse(s.value); } catch { settings[s.key] = s.value; } });
    res.json({ success: true, settings });
  } catch (error) { sendError(res, 500, error.message); }
});

app.put('/api/settings/:key', requireAuth, (req, res) => {
  try { stmts.upsertSetting.run(req.user.id, req.params.key, JSON.stringify(req.body.value), Date.now()); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// TBWO ORDER ENDPOINTS
// ============================================================================

app.get('/api/tbwo', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const rows = stmts.listTBWOs.all(userId, limit, offset);
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
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/tbwo', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
    if (!limits.tbwoEnabled) {
      return res.status(403).json({ error: 'TBWO is not available on your plan. Upgrade to Pro to access autonomous workflows.', code: 'TBWO_DISABLED' });
    }
    if (limits.tbwoRunsPerMonth > 0) {
      const used = getQuotaCount(userId, 'tbwo_runs');
      if (used >= limits.tbwoRunsPerMonth) {
        return res.status(429).json({ error: 'Monthly TBWO run limit reached', used, limit: limits.tbwoRunsPerMonth, code: 'TBWO_QUOTA_EXCEEDED' });
      }
    }
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
      JSON.stringify(b.metadata || {}), b.createdAt || now, b.updatedAt || now, userId
    );
    incrementQuota(userId, 'tbwo_runs');
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/tbwo/:id', requireAuth, (req, res) => {
  try {
    const row = stmts.getTBWO.get(req.params.id, req.user.id);
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
  } catch (error) { sendError(res, 500, error.message); }
});

app.patch('/api/tbwo/:id', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const e = stmts.getTBWO.get(req.params.id, userId);
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
      b.execution_state !== undefined ? (b.execution_state === null ? null : (typeof b.execution_state === 'string' ? b.execution_state : JSON.stringify(b.execution_state))) : (e.execution_state || null),
      now, req.params.id, userId
    );
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/tbwo/:id', requireAuth, (req, res) => {
  try { stmts.deleteTBWO.run(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// TBWO WORKSPACE MANAGEMENT
// ============================================================================

/**
 * In-memory registry of active TBWO workspaces.
 * Maps tbwoId -> { path, userId, createdAt, fileCount }
 * Cleaned up on explicit DELETE or via 2-hour TTL sweep.
 */
const tbwoWorkspaces = new Map();
const WORKSPACE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Sweep stale workspaces every 15 minutes
setInterval(async () => {
  const now = Date.now();
  for (const [tbwoId, ws] of tbwoWorkspaces.entries()) {
    if (now - ws.createdAt > WORKSPACE_TTL_MS) {
      try {
        await fs.rm(ws.path, { recursive: true, force: true });
        tbwoWorkspaces.delete(tbwoId);
        console.log(`[Workspace] Cleaned up stale workspace: ${tbwoId}`);
      } catch {}
    }
  }
}, 15 * 60 * 1000);

/**
 * Accept auth from header OR query param (for direct download links like <a href download>)
 */
function requireAuthOrToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// POST /api/tbwo/:id/workspace/init — Create temp dir for TBWO workspace
app.post('/api/tbwo/:id/workspace/init', requireAuth, async (req, res) => {
  try {
    const tbwoId = req.params.id;
    const workspacePath = path.join(os.tmpdir(), `alin-tbwo-${tbwoId}`);

    // Clean up any previous workspace for this TBWO
    try { await fs.rm(workspacePath, { recursive: true, force: true }); } catch {}

    await fs.mkdir(workspacePath, { recursive: true });

    tbwoWorkspaces.set(tbwoId, {
      path: workspacePath,
      userId: req.user.id,
      createdAt: Date.now(),
      fileCount: 0,
    });

    console.log(`[Workspace] Initialized: ${workspacePath}`);
    res.json({ success: true, workspaceId: tbwoId, workspacePath });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// POST /api/tbwo/:id/workspace/write — Write file to workspace
app.post('/api/tbwo/:id/workspace/write', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found. Call /init first.' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) {
      return res.status(400).json({ error: 'path and content required' });
    }

    // Normalize to prevent path traversal
    const relativePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
    const fullPath = path.join(ws.path, relativePath);

    // Verify resolved path is inside workspace
    if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content);
    ws.fileCount++;

    const size = Buffer.byteLength(content, 'utf-8');
    const downloadUrl = `/api/tbwo/${req.params.id}/workspace/file?path=${encodeURIComponent(relativePath)}`;

    console.log(`[Workspace] File written: ${relativePath} (${size} bytes)`);
    res.json({ success: true, path: relativePath, size, downloadUrl });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// POST /api/tbwo/:id/workspace/read — Read file from workspace
app.post('/api/tbwo/:id/workspace/read', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const relativePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
    const fullPath = path.join(ws.path, relativePath);

    if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ success: true, content, path: relativePath });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: `File not found: ${req.body.path}` });
    }
    if (error.code === 'EISDIR') {
      return res.status(400).json({ error: `Path is a directory, not a file: ${req.body.path}` });
    }
    sendError(res, 500, error.message);
  }
});

// POST /api/tbwo/:id/workspace/list — List workspace directory
app.post('/api/tbwo/:id/workspace/list', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const subPath = req.body.path || '.';
    const relativePath = path.normalize(subPath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
    const fullPath = path.join(ws.path, relativePath);

    if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    let entries;
    try {
      entries = await fs.readdir(fullPath, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return res.json({ success: true, files: [] });
      throw e;
    }
    const files = entries.map(e => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: path.join(relativePath, e.name).replace(/\\/g, '/'),
    }));

    res.json({ success: true, files });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// GET /api/tbwo/:id/workspace/file — Download single file (supports token query param for <a href> download)
app.get('/api/tbwo/:id/workspace/file', requireAuthOrToken, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });

    const relativePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
    const fullPath = path.join(ws.path, relativePath);

    if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    const filename = path.basename(relativePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(path.resolve(fullPath));
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// GET /api/tbwo/:id/workspace/zip — Download all workspace files as zip
app.get('/api/tbwo/:id/workspace/zip', requireAuthOrToken, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const zip = new JSZip();

    // Recursively add all files
    async function addDir(dirPath, zipFolder) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await addDir(entryPath, zipFolder.folder(entry.name));
        } else {
          const content = await fs.readFile(entryPath);
          zipFolder.file(entry.name, content);
        }
      }
    }

    await addDir(ws.path, zip);

    const tbwoId = req.params.id;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="tbwo-${tbwoId.slice(0, 8)}.zip"`);

    // Stream the zip to avoid loading entire buffer into memory
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
      .pipe(res);
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// DELETE /api/tbwo/:id/workspace — Remove workspace and deregister
app.delete('/api/tbwo/:id/workspace', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.json({ success: true, message: 'No workspace to clean up' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    try { await fs.rm(ws.path, { recursive: true, force: true }); } catch {}
    tbwoWorkspaces.delete(req.params.id);

    console.log(`[Workspace] Deleted: ${req.params.id}`);
    res.json({ success: true });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// WORKSPACE MANIFEST + VALIDATION
// ============================================================================

// GET /api/tbwo/:id/workspace/manifest — Generate file tree manifest
app.get('/api/tbwo/:id/workspace/manifest', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    async function buildTree(dirPath, relativeTo) {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const nodes = [];
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          const children = await buildTree(fullPath, relativeTo);
          nodes.push({ type: 'directory', name: entry.name, path: relPath, children });
        } else {
          const stat = await fs.stat(fullPath);
          nodes.push({
            type: 'file',
            name: entry.name,
            path: relPath,
            size: stat.size,
            downloadUrl: `/api/tbwo/${req.params.id}/workspace/file?path=${encodeURIComponent(relPath)}`,
          });
        }
      }
      return nodes;
    }

    const manifest = await buildTree(ws.path, ws.path);
    const totalFiles = (function countFiles(nodes) {
      return nodes.reduce((sum, n) => sum + (n.type === 'file' ? 1 : countFiles(n.children || [])), 0);
    })(manifest);
    const totalSize = (function sumSize(nodes) {
      return nodes.reduce((sum, n) => sum + (n.type === 'file' ? (n.size || 0) : sumSize(n.children || [])), 0);
    })(manifest);

    res.json({ manifest, totalFiles, totalSize });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// POST /api/tbwo/:id/workspace/validate — Run server-side validation
app.post('/api/tbwo/:id/workspace/validate', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const { expectedPages = [], approvedClaims = [] } = req.body;

    const pipeline = new SandboxPipeline(req.params.id, req.user.id, {
      expectedPages,
      approvedClaims,
    });
    pipeline.workspacePath = ws.path;

    const result = await pipeline.validate();
    res.json(result);
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// SANDBOX PIPELINE ENDPOINTS
// ============================================================================

// POST /api/tbwo/:id/sandbox/run — Kick off validate→repair→package pipeline
app.post('/api/tbwo/:id/sandbox/run', requireAuth, async (req, res) => {
  try {
    const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
    if (!limits.tbwoEnabled) {
      return res.status(403).json({ error: 'TBWO is not available on your plan. Upgrade to Pro to access autonomous workflows.', code: 'TBWO_DISABLED' });
    }
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found. Init workspace first.' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    const { throughStage = 'package', brief, expectedPages, approvedClaims } = req.body;

    const pipeline = new SandboxPipeline(req.params.id, req.user.id, {
      brief: brief || null,
      expectedPages: expectedPages || [],
      approvedClaims: approvedClaims || [],
    });

    await pipeline.init(ws.path);
    setPipeline(req.params.id, pipeline);

    // Run pipeline in background
    res.json({ started: true, stage: 'init' });

    // Non-blocking execution
    pipeline.run(throughStage).catch(err => {
      console.error(`[SandboxPipeline] ${req.params.id} failed:`, err.message);
      pipeline.error = err.message;
      pipeline.stage = 'failed';
    });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// GET /api/tbwo/:id/sandbox/status — Poll pipeline progress
app.get('/api/tbwo/:id/sandbox/status', requireAuth, async (req, res) => {
  try {
    const pipeline = getPipeline(req.params.id);
    if (!pipeline) {
      return res.json({ stage: 'none', stageLog: [], artifacts: {}, progress: 0 });
    }
    res.json(pipeline.getProgress());
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// POST /api/tbwo/:id/sandbox/deploy — Trigger deploy stage
app.post('/api/tbwo/:id/sandbox/deploy', requireAuth, async (req, res) => {
  try {
    const ws = tbwoWorkspaces.get(req.params.id);
    if (!ws) return res.status(404).json({ error: 'Workspace not found' });
    if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

    // Use existing deploy infrastructure
    const { adapter = 'cloudflare' } = req.body;

    if (adapter === 'cloudflare') {
      const result = await cfDeploy.deploy(ws.path, {
        projectName: `alin-site-${req.params.id.slice(0, 8)}`,
      });
      res.json({ deploymentId: result.id || req.params.id, url: result.url || null, status: 'deployed' });
    } else {
      res.json({ deploymentId: req.params.id, url: null, status: 'unsupported_adapter' });
    }
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// SITES + DEPLOY ENDPOINTS (Deploy Dashboard v1)
// ============================================================================

const cfDeploy = new CloudflarePagesDeploy();
const cfR2 = new CloudflareR2();
const cfKV = new CloudflareKV();
const cfImages = new CloudflareImages();
const cfStream = new CloudflareStream();
const cfVectorize = new CloudflareVectorize();
const SITES_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'sites');

// Rate limit deploys (max 5 per minute per user, in-memory)
const deployLimiter = rateLimit({ windowMs: 60_000, max: 5, keyGenerator: (req) => req.user?.id || req.ip });
const mediaUploadLimiter = rateLimit({ windowMs: 60_000, max: 20, keyGenerator: (req) => req.user?.id || req.ip });
const threadIngestLimiter = rateLimit({ windowMs: 60_000, max: 10, keyGenerator: (req) => req.user?.id || req.ip });

// --- Create a site from a TBWO run ---
app.post('/api/sites', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, tbwoRunId, manifest } = req.body;
    if (!name) return sendError(res, 400, 'name is required');

    const siteId = randomUUID();
    const now = Date.now();
    const projectId = req.projectId || 'default';

    // If tbwoRunId provided, copy workspace files to persistent storage
    let storagePath = null;
    if (tbwoRunId) {
      const ws = tbwoWorkspaces.get(tbwoRunId);
      if (ws && ws.userId === userId) {
        storagePath = path.join(SITES_DATA_DIR, siteId);
        await fs.mkdir(storagePath, { recursive: true });
        await copyDir(ws.path, storagePath);
      }
    }

    stmts.insertSite.run(
      siteId, userId, projectId, name,
      tbwoRunId || null, 'draft', null, null, manifest || null,
      storagePath, now, now
    );

    const site = stmts.getSite.get(siteId, userId);
    res.json({ success: true, site });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- List user's sites ---
app.get('/api/sites', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const sites = stmts.listSites.all(req.user.id, limit, offset);
    res.json({ success: true, sites });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Get single site ---
app.get('/api/sites/:siteId', requireAuth, (req, res) => {
  try {
    const site = stmts.getSite.get(req.params.siteId, req.user.id);
    if (!site) return sendError(res, 404, 'Site not found');
    res.json({ success: true, site });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Deploy a site ---
app.post('/api/sites/:siteId/deploy', requireAuth, deployLimiter, async (req, res) => {
  try {
    const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
    if (!limits.sitesEnabled) {
      return res.status(403).json({ error: 'Site deployment not available on your plan', code: 'SITES_DISABLED' });
    }
    const userId = req.user.id;
    const site = stmts.getSite.get(req.params.siteId, userId);
    if (!site) return sendError(res, 404, 'Site not found');

    const deployId = randomUUID();
    const now = Date.now();
    const cfProjectName = site.cloudflare_project_name ||
      site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);

    // Create deployment record (queued)
    stmts.insertDeployment.run(
      deployId, site.id, userId, cfProjectName,
      null, null, 'queued', null, null, now
    );

    // Send immediate response so client can poll
    res.json({ success: true, deployment: { id: deployId, status: 'queued' } });

    // Create SSE emitter for this deployment
    const emitter = createDeployEmitter(deployId);

    // Async: build + deploy
    (async () => {
      try {
        // 1. Find/build static output
        const siteDir = site.storage_path;
        if (!siteDir) {
          stmts.updateDeploymentStatus.run('failed', null, null, null, 'No site files found. Create from TBWO first.', deployId, userId);
          emitDeployEvent(deployId, 'error', { message: 'No site files found. Create from TBWO first.' });
          emitDeployEvent(deployId, 'done', {});
          cleanupDeployEmitter(deployId);
          return;
        }

        emitDeployEvent(deployId, 'status', { step: 'building', message: 'Building static site...' });
        stmts.updateDeploymentStatus.run('building', null, null, null, null, deployId, userId);
        const { outputDir, buildLog } = await buildStaticSite(siteDir, (step, detail) => {
          emitDeployEvent(deployId, 'status', { step, message: step === 'installing' ? 'Installing dependencies...' : step === 'compiling' ? 'Running build command...' : step === 'built' ? `Build complete. Output: ${detail?.outputDir || 'dist'}/` : step });
        });

        // 2. Deploy — prefer R2 when configured, fall back to CF Pages
        stmts.updateDeploymentStatus.run('deploying', null, null, buildLog, null, deployId, userId);

        if (cfR2.isConfigured) {
          emitDeployEvent(deployId, 'status', { step: 'uploading', message: 'Uploading to R2...' });
          const latestRow = stmts.getLatestVersion.get(site.id, userId);
          const nextVersion = latestRow ? latestRow.version + 1 : 1;
          const r2Result = await cfR2.deploySite(site.id, outputDir, nextVersion);
          const subdomain = cfProjectName;
          const liveUrl = `https://${subdomain}.alinai.dev`;

          emitDeployEvent(deployId, 'status', { step: 'registering', message: 'Registering domain...' });
          if (cfKV.isConfigured) {
            await cfKV.registerDomain(subdomain, userId, site.id, nextVersion);
            await cfKV.setActiveVersion(site.id, nextVersion, deployId);
          }

          stmts.insertSiteVersion.run(
            randomUUID(), site.id, userId, nextVersion,
            r2Result.fileCount, r2Result.totalBytes, deployId, Date.now()
          );

          stmts.updateDeploymentStatus.run('success', deployId, liveUrl, buildLog, null, deployId, userId);
          stmts.updateSite.run(site.name, 'deployed', cfProjectName, liveUrl, site.manifest, Date.now(), site.id, userId);
          emitDeployEvent(deployId, 'status', { step: 'success', message: `Live at ${liveUrl}`, url: liveUrl, fileCount: r2Result.fileCount });
          console.log(`[Deploy] Site ${site.id} deployed to R2 v${nextVersion}: ${liveUrl}`);
        } else {
          emitDeployEvent(deployId, 'status', { step: 'uploading', message: 'Deploying to Cloudflare Pages...' });
          await cfDeploy.ensureProject(cfProjectName);
          const result = await cfDeploy.deploy(cfProjectName, outputDir);
          stmts.updateDeploymentStatus.run('success', result.id, result.url, buildLog, null, deployId, userId);
          stmts.updateSite.run(site.name, 'deployed', cfProjectName, result.url, site.manifest, Date.now(), site.id, userId);
          emitDeployEvent(deployId, 'status', { step: 'success', message: `Live at ${result.url}`, url: result.url });
          console.log(`[Deploy] Site ${site.id} deployed via Pages: ${result.url}${result.stub ? ' (stub)' : ''}`);
        }
        emitDeployEvent(deployId, 'done', {});
        cleanupDeployEmitter(deployId);
      } catch (err) {
        console.error(`[Deploy] Failed for site ${site.id}:`, err.message);
        stmts.updateDeploymentStatus.run('failed', null, null, null, err.message, deployId, userId);
        emitDeployEvent(deployId, 'error', { message: err.message });
        emitDeployEvent(deployId, 'done', {});
        cleanupDeployEmitter(deployId);
      }
    })();
  } catch (error) { sendError(res, 500, error.message); }
});

// --- List deployments for a site ---
app.get('/api/sites/:siteId/deployments', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const deployments = stmts.listDeployments.all(req.params.siteId, req.user.id, limit);
    res.json({ success: true, deployments });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- SSE Deploy Progress Stream ---
app.get('/api/sites/:siteId/deploy/:deploymentId/stream', requireAuth, (req, res) => {
  const { deploymentId } = req.params;
  setupSSE(res);

  const emitter = deployEvents.get(deploymentId);
  if (!emitter) {
    // Deployment already finished or never had an emitter — send current status from DB
    const userId = req.user.id;
    const deployments = stmts.listDeployments.all(req.params.siteId, userId, 5);
    const target = deployments.find(d => d.id === deploymentId);
    if (target) {
      sendSSE(res, 'status', { step: target.status, message: target.status === 'success' ? `Live at ${target.url}` : target.status === 'failed' ? target.error : target.status });
      if (target.status === 'success' || target.status === 'failed') {
        sendSSE(res, 'done', {});
      }
    } else {
      sendSSE(res, 'error', { message: 'Deployment not found' });
      sendSSE(res, 'done', {});
    }
    return res.end();
  }

  // Subscribe to live progress events
  const handler = (data) => {
    try {
      sendSSE(res, data.event, data);
      if (data.event === 'done') {
        res.end();
      }
    } catch {
      // Client disconnected
      emitter.removeListener('progress', handler);
    }
  };

  emitter.on('progress', handler);

  // Cleanup on client disconnect
  req.on('close', () => {
    emitter.removeListener('progress', handler);
  });
});

// --- Preview: serve site files statically ---
app.get('/api/preview/:siteId/*', requireAuth, async (req, res) => {
  try {
    const site = stmts.getSite.get(req.params.siteId, req.user.id);
    if (!site) return sendError(res, 404, 'Site not found');
    if (!site.storage_path) return sendError(res, 404, 'No site files');

    // Requested file path (everything after /api/preview/:siteId/)
    const requestedPath = req.params[0] || 'index.html';
    const safePath = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
    let filePath = path.join(site.storage_path, safePath);

    // Try site/ subdirectory first (ALIN Website Sprint layout)
    const siteDirPath = path.join(site.storage_path, 'site', safePath);
    try {
      await fs.access(siteDirPath);
      filePath = siteDirPath;
    } catch {
      // Try direct path
      try {
        await fs.access(filePath);
      } catch {
        // Default to index.html for SPA routing
        const indexPath = path.join(site.storage_path, 'site', 'index.html');
        try {
          await fs.access(indexPath);
          filePath = indexPath;
        } catch {
          return sendError(res, 404, 'File not found');
        }
      }
    }

    // Determine MIME type
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
      '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
      '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    const content = await fs.readFile(filePath);
    res.send(content);
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Helper: recursive directory copy ---
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ============================================================================
// SITE BRIEF EXTRACTION
// ============================================================================

// --- Brief extraction cache (content-hash → result, 24h TTL) ---
const briefCache = new Map(); // hash → { brief, provider, timestamp }
const BRIEF_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function briefCacheKey(sourceText, sourceType, contextHints) {
  return createHash('sha256')
    .update(sourceText + '|' + (sourceType || '') + '|' + (contextHints || ''))
    .digest('hex');
}

// --- LLM caller with Anthropic retry + OpenAI fallback ---
async function callLLMForBrief({ prompt, system, maxTokens, model, preferOpenAI }) {
  const estimatedTokens = Math.ceil(prompt.length / 4);
  const RETRIES = 3;
  const BACKOFF = [500, 1500, 3500];

  // --- Prefer GPT-4o-mini for structured extraction (cheaper, faster) ---
  const oaiKey = process.env.OPENAI_API_KEY;
  if ((preferOpenAI || !model) && oaiKey) {
    const oaiModel = model || DEFAULT_MODELS.gpt4oMini;
    console.log(`[extract-brief] Calling OpenAI | model: ${oaiModel} | prompt: ${prompt.length} chars (~${estimatedTokens} tokens) | maxTokens: ${maxTokens}`);
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oaiKey}` },
        body: JSON.stringify({
          model: oaiModel,
          messages: [
            { role: 'system', content: system || 'Extract a site brief from the input. Output ONLY valid JSON.' },
            { role: 'user', content: prompt },
          ],
          max_tokens: maxTokens || 4096,
          temperature: 0.3,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        console.log(`[extract-brief] OpenAI ${oaiModel} succeeded`);
        return { text: data.choices[0]?.message?.content || '', provider: 'openai', requestId: '' };
      }
      console.warn(`[extract-brief] OpenAI ${oaiModel} failed: ${resp.status}, falling back to Anthropic`);
    } catch (oaiErr) {
      console.warn(`[extract-brief] OpenAI error: ${oaiErr.message}, falling back to Anthropic`);
    }
  }

  // --- Fallback to Anthropic ---
  const claudeModel = model || DEFAULT_MODELS.claudeSonnet;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY not set'), { retryable: false });

  console.log(`[extract-brief] Calling Anthropic | model: ${claudeModel} | prompt: ${prompt.length} chars (~${estimatedTokens} tokens) | maxTokens: ${maxTokens}`);

  let lastError = null;
  let lastStatus = 0;
  let lastRequestId = '';

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: maxTokens || 4096,
          stream: false,
          system: system || undefined,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        const requestId = resp.headers.get('request-id') || '';
        const textBlock = data.content?.find(b => b.type === 'text');
        return { text: textBlock?.text || '', provider: 'anthropic', requestId };
      }

      lastStatus = resp.status;
      lastRequestId = resp.headers.get('request-id') || '';

      // Retry on 429, 529, 5xx
      if (resp.status === 429 || resp.status === 529 || resp.status >= 500) {
        const jitter = Math.random() * 500;
        const delay = BACKOFF[attempt] + jitter;
        console.warn(`[extract-brief] Anthropic ${resp.status} — retry ${attempt + 1}/${RETRIES} in ${Math.round(delay)}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Non-retryable error (400, 401, etc.)
      const errText = await resp.text();
      throw Object.assign(new Error(`Anthropic ${resp.status}`), {
        status: resp.status, provider: 'anthropic', requestId: lastRequestId, body: errText, retryable: false,
      });
    } catch (e) {
      if (e.retryable === false) throw e; // non-retryable, don't fallback
      lastError = e;
      if (attempt < RETRIES - 1) {
        const jitter = Math.random() * 500;
        await new Promise(r => setTimeout(r, BACKOFF[attempt] + jitter));
      }
    }
  }

  // All providers failed
  throw Object.assign(
    new Error('All LLM providers failed'),
    { status: lastStatus, provider: 'anthropic', requestId: lastRequestId, retryable: true },
  );
}

// --- Regenerate a single section via Claude ---
app.post('/api/sites/regenerate-section', requireAuth, async (req, res) => {
  try {
    const { sectionHtml, action, instruction, cssContext, productName, fullPageContext } = req.body;
    if (!sectionHtml || typeof sectionHtml !== 'string') {
      return sendError(res, 400, 'sectionHtml is required');
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return sendError(res, 500, 'ANTHROPIC_API_KEY not set');

    const systemPrompt = `You are a senior web designer and conversion specialist. You rewrite HTML sections to be more effective.

Rules:
- Return ONLY the rewritten HTML section (no explanation, no markdown fences).
- Keep the same HTML tag structure (section element with same classes/IDs).
- Maintain the same CSS custom properties and class naming conventions.
- Preserve all links and their href values unless the instruction says otherwise.
- Output valid, well-formatted HTML.
${cssContext ? `\nCSS context (design tokens in use):\n${cssContext}` : ''}
${productName ? `\nProduct name: ${productName}` : ''}`;

    const userPrompt = `Action: ${action || 'custom'}

Instruction: ${instruction || 'Improve this section.'}

Current section HTML:
${sectionHtml}

${fullPageContext ? `Page context (for tone/content consistency):\n${fullPageContext.slice(0, 2000)}` : ''}

Rewrite the section HTML now. Output ONLY the HTML.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DEFAULT_MODELS.claudeSonnet,
        max_tokens: 4096,
        stream: false,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[regenerate-section] Anthropic error:', resp.status, errText);
      return sendError(res, 502, `Claude API error: ${resp.status}`);
    }

    const data = await resp.json();
    const textBlock = data.content?.find(b => b.type === 'text');
    let newHtml = textBlock?.text || '';

    // Strip markdown fences if Claude included them despite instructions
    newHtml = newHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();

    res.json({ success: true, newHtml });
  } catch (err) {
    console.error('[regenerate-section] Error:', err);
    sendError(res, 500, err.message || 'Section regeneration failed');
  }
});

// --- Analyze a video for UX issues ---
app.post('/api/video/analyze-ux', requireAuth, async (req, res) => {
  try {
    // This endpoint accepts base64 frames (client-side extraction)
    // or can be extended with fluent-ffmpeg for server-side extraction
    const { frames, videoName } = req.body;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return sendError(res, 400, 'frames array is required (base64 images)');
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return sendError(res, 500, 'ANTHROPIC_API_KEY not set');

    // Build vision content blocks
    const imageBlocks = frames.slice(0, 10).map((frame, i) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: frame.mediaType || 'image/png',
        data: frame.data,
      },
    }));

    const textBlock = {
      type: 'text',
      text: `Analyze these ${frames.length} keyframes from a product demo video "${videoName || 'unknown'}".

For each frame and overall, evaluate:
1. Layout & Visual Hierarchy: Is the layout clear? Can users find key actions?
2. UX Flow: Does the demonstrated flow feel intuitive? Any confusing steps?
3. Accessibility: Color contrast, text readability, touch target sizes
4. Copy & Messaging: Are labels clear? CTAs compelling? Error messages helpful?
5. Design Consistency: Color scheme, typography, spacing consistent?
6. Friction Points: Where might users get stuck or confused?

Return a JSON object with this structure:
{
  "overallScore": 0-100,
  "scores": { "layout": N, "uxFlow": N, "accessibility": N, "copyClarity": N, "designConsistency": N, "frictionLevel": N },
  "frameAnalyses": [{ "frameIndex": N, "description": "...", "issues": [...], "suggestions": [...], "score": N }],
  "overallRecommendations": ["..."],
  "criticalIssues": ["..."]
}

Output ONLY valid JSON.`,
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: DEFAULT_MODELS.claudeSonnet,
        max_tokens: 8192,
        stream: false,
        messages: [{
          role: 'user',
          content: [...imageBlocks, textBlock],
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[video-analyze] Anthropic error:', resp.status, errText);
      return sendError(res, 502, `Claude API error: ${resp.status}`);
    }

    const data = await resp.json();
    const responseText = data.content?.find(b => b.type === 'text')?.text || '{}';

    // Parse JSON from response
    let analysis;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      analysis = { overallScore: 0, error: 'Failed to parse analysis', raw: responseText.slice(0, 500) };
    }

    // Enrich with metadata
    analysis.id = `vua-${Date.now()}`;
    analysis.videoName = videoName || 'unknown';
    analysis.frameCount = frames.length;
    analysis.generatedAt = Date.now();

    res.json({ success: true, analysis });
  } catch (err) {
    console.error('[video-analyze] Error:', err);
    sendError(res, 500, err.message || 'Video analysis failed');
  }
});

app.post('/api/sites/extract-brief', requireAuth, async (req, res) => {
  try {
    const { sourceText, sourceType, contextHints, model } = req.body;
    if (!sourceText || typeof sourceText !== 'string' || sourceText.trim().length < 10) {
      return sendError(res, 400, 'sourceText is required (min 10 chars)');
    }

    const text = sourceText.trim();
    const llmModel = model || DEFAULT_MODELS.claudeSonnet;

    // --- Cache check ---
    const cacheKey = briefCacheKey(text, sourceType, contextHints);
    const cached = briefCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < BRIEF_CACHE_TTL) {
      console.log(`[extract-brief] Cache hit | key: ${cacheKey.slice(0, 12)}… | age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s`);
      return res.json({ success: true, brief: cached.brief, provider: cached.provider, cached: true });
    }

    const CHUNK_SIZE = 25000;
    const chunks = [];

    // Chunk if needed
    if (text.length > CHUNK_SIZE) {
      for (let i = 0; i < text.length; i += CHUNK_SIZE) {
        chunks.push(text.slice(i, i + CHUNK_SIZE));
      }
    } else {
      chunks.push(text);
    }

    const estimatedTokens = Math.ceil(text.length / 4);
    console.log(`[extract-brief] Starting extraction | input: ${text.length} chars (~${estimatedTokens} tokens) | chunks: ${chunks.length} | avg chunk: ${Math.round(text.length / chunks.length)} chars | model: ${llmModel}`);

    // Extract per chunk
    const partialBriefs = [];
    let lastProvider = 'anthropic';

    for (const chunk of chunks) {
      const prompt = `You are analyzing ${sourceType === 'THREAD' ? 'a conversation/thread' : 'a product description'} to extract a structured site brief for building a website.

${contextHints ? `Context hint: This is for a "${contextHints}" type business.` : ''}

INPUT:
${chunk}

Extract a structured JSON site brief. Output ONLY valid JSON, no markdown fences.

CRITICAL RULES:
- productName: Use EXACTLY the product/brand name from the input. NEVER rename or invent one.
- pricing: Only include pricing tiers if the input explicitly mentions them. If not mentioned, set tiers to empty array.
- Do NOT fabricate any numbers, stats, or claims. If the input says "500+ users" mark it as a requiredUnknown unless the speaker clearly states it as fact.
- requiredUnknowns: ONLY list items where fabricating a default would be HARMFUL or MISLEADING. For example: product name (if unclear), pricing tiers (if referenced but not specified), contact info (if a contact page is expected). Do NOT list things like testimonials, team bios, sample photos, user counts, or integration details — the builder can use sensible placeholders for those. Maximum 4 items.
- contactEmail, contactPhone, contactAddress: Extract EXACTLY as provided. If user says "my email is jake@gmail.com", store EXACTLY "jake@gmail.com". Never invent contact info. If not mentioned, set to empty string.

Schema:
{
  "productName": "string — EXACT product/brand name from input, never rename",
  "tagline": "string — short tagline extracted or inferred",
  "oneLinerPositioning": "string — one-sentence positioning statement",
  "businessType": "string — what kind of business/project",
  "icpGuess": "string — ideal customer profile guess",
  "targetAudience": "string — who this is for",
  "primaryPain": "string — main problem this solves",
  "primaryCTA": "string — main call to action (e.g. Start Free Trial, Book a Demo)",
  "toneStyle": "string — voice/tone",
  "goal": "string — primary goal of the website",
  "navPages": ["array of page names for main navigation"],
  "features": ["array of product features mentioned"],
  "integrations": ["array of integrations mentioned, or empty"],
  "pricing": {
    "hasFreePlan": false,
    "tiers": [{"name": "string", "priceMonthly": "string", "limitLabel": "string", "highlights": ["string"], "isMostPopular": false}],
    "trial": {"enabled": false, "days": 0, "requiresCard": false},
    "annual": {"enabled": false, "discountLabel": ""}
  },
  "designDirection": "string — suggested aesthetic",
  "requiredUnknowns": [{"id": "string", "question": "string", "reason": "string", "required": true}],
  "assumptions": ["array of assumptions made"],
  "constraints": {
    "NO_FABRICATED_STATS": true,
    "NO_RENAME_WITHOUT_APPROVAL": true,
    "NO_SECURITY_CLAIMS_UNLESS_PROVIDED": true
  },
  "coreProblem": "string — the core problem this product solves, in one sentence",
  "differentiators": ["array of 2-4 things that make this product different from alternatives"],
  "contactEmail": "string — email address if mentioned, or empty string",
  "contactPhone": "string — phone number if mentioned, or empty string",
  "contactAddress": "string — physical address if mentioned, or empty string",
  "socialLinks": {"platform": "url"},
  "operatingHours": "string — business hours if mentioned, or empty string",
  "pages": ["same as navPages, for compat"],
  "tone": "same as toneStyle, for compat",
  "ctas": ["array of CTA goals"]
}`;

      const result = await callLLMForBrief({
        prompt,
        system: 'Extract a site brief from the input. Output ONLY valid JSON.',
        maxTokens: 4096,
        model: llmModel,
      });

      lastProvider = result.provider;

      if (result.text) {
        let json = result.text.trim();
        if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        try {
          partialBriefs.push(JSON.parse(json));
        } catch { /* skip unparseable chunk */ }
      }
    }

    if (partialBriefs.length === 0) {
      return sendError(res, 500, 'Failed to extract brief from input');
    }

    // Merge if multiple chunks
    let brief;
    if (partialBriefs.length === 1) {
      brief = partialBriefs[0];
    } else {
      // Merge pass
      const mergePrompt = `Merge these partial site briefs into one consolidated brief. Output ONLY valid JSON with the same schema.

PARTIAL BRIEFS:
${JSON.stringify(partialBriefs, null, 2)}

Output the merged brief as a single JSON object.`;

      const mergeResult = await callLLMForBrief({
        prompt: mergePrompt,
        system: 'Merge partial briefs into one. Output ONLY valid JSON.',
        maxTokens: 4096,
        model: llmModel,
      });

      lastProvider = mergeResult.provider;

      if (mergeResult.text) {
        let json = mergeResult.text.trim();
        if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        try {
          brief = JSON.parse(json);
        } catch {
          brief = partialBriefs[0]; // Fallback to first
        }
      } else {
        brief = partialBriefs[0];
      }
    }

    // --- Build provenance map ---
    const provenance = {};
    const provenanceFields = [
      'productName', 'tagline', 'oneLinerPositioning', 'targetAudience',
      'primaryPain', 'primaryCTA', 'toneStyle', 'designDirection',
      'navPages', 'features', 'pricing',
      'contactEmail', 'contactPhone', 'contactAddress',
    ];
    for (const field of provenanceFields) {
      const val = brief[field];
      if (val === undefined || val === null || val === '' ||
          (Array.isArray(val) && val.length === 0) ||
          (typeof val === 'string' && /^(unknown|n\/a|not specified|tbd)$/i.test(val.trim()))) {
        provenance[field] = 'PLACEHOLDER';
      } else {
        provenance[field] = 'INFERRED';
      }
    }

    // --- Detect missing fields → missingQuestions ---
    const missingQuestions = [];
    if (!brief.productName || brief.productName.length < 2 || /^(unknown|my site|untitled)/i.test(brief.productName)) {
      missingQuestions.push({
        id: 'productName',
        question: 'What is the name of your product or brand?',
        reason: 'We need this to avoid making up a name for your site.',
        blocking: true,
      });
    }
    if (!brief.targetAudience || brief.targetAudience.length < 5) {
      missingQuestions.push({
        id: 'targetAudience',
        question: 'Who is the target audience for this website?',
        reason: 'This helps us write copy that resonates with the right people.',
        blocking: false,
      });
    }
    if (brief.pricing?.tiers?.length === 0 && (brief.features?.some(f => /pric/i.test(f)) || brief.navPages?.some(p => /pric/i.test(p)))) {
      missingQuestions.push({
        id: 'pricing',
        question: 'You mentioned pricing — what are your pricing tiers? (name, price, features for each)',
        reason: 'Pricing tiers were referenced but no specifics were provided.',
        blocking: true,
      });
    }
    if (!brief.primaryCTA || brief.primaryCTA.length < 3) {
      missingQuestions.push({
        id: 'primaryCTA',
        question: 'What should the main call-to-action button say? (e.g., "Start Free Trial", "Book a Demo")',
        reason: 'Every page needs a clear CTA.',
        blocking: false,
      });
    }

    // --- Cache the result ---
    briefCache.set(cacheKey, { brief, provider: lastProvider, timestamp: Date.now() });
    console.log(`[extract-brief] Cached result | key: ${cacheKey.slice(0, 12)}… | provider: ${lastProvider} | missing: ${missingQuestions.length}`);

    res.json({ success: true, brief, provider: lastProvider, provenance, missingQuestions });
  } catch (error) {
    console.error('[extract-brief] Failed:', error.message);
    const status = error.retryable !== undefined ? 502 : 500;
    return res.status(status).json({
      error: error.retryable ? 'LLM provider temporarily unavailable. Please retry.' : error.message,
      code: 'PROVIDER_ERROR',
      provider: error.provider || 'anthropic',
      request_id: error.requestId || '',
      retryable: error.retryable ?? true,
    });
  }
});

// ============================================================================
// EXTRACT FROM URL
// ============================================================================

app.post('/api/sites/extract-from-url', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return sendError(res, 400, 'url is required');
    }

    // Fetch page content
    let pageContent = '';
    try {
      const fetchResp = await fetch(url, {
        headers: { 'User-Agent': 'ALIN/1.0 SiteExtractor' },
        signal: AbortSignal.timeout(10000),
      });
      if (!fetchResp.ok) {
        return sendError(res, 502, `Failed to fetch URL: HTTP ${fetchResp.status}`);
      }
      const html = await fetchResp.text();
      // Strip scripts, styles, and tags for text extraction
      pageContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 15000);
    } catch (fetchErr) {
      return sendError(res, 502, `Failed to fetch URL: ${fetchErr.message}`);
    }

    if (pageContent.length < 50) {
      return sendError(res, 422, 'Page content too short to extract product info');
    }

    // Ask LLM to extract product info
    const prompt = `Analyze this webpage content and extract product/company information.

URL: ${url}

CONTENT:
${pageContent}

Extract and return ONLY valid JSON:
{
  "productName": "string — product or company name",
  "tagline": "string — tagline or hero text",
  "businessType": "string — type of business",
  "targetAudience": "string — who this is for",
  "features": ["key features mentioned"],
  "toneStyle": "string — detected tone/voice",
  "designDirection": "string — detected design style"
}`;

    const result = await callLLMForBrief({
      prompt,
      system: 'Extract product info from webpage content. Output ONLY valid JSON.',
      maxTokens: 2048,
      model: DEFAULT_MODELS.claudeSonnet,
    });

    if (!result.text) {
      return sendError(res, 500, 'LLM returned no output');
    }

    let json = result.text.trim();
    if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    try {
      const extracted = JSON.parse(json);
      res.json({ success: true, partial: extracted, url });
    } catch {
      return sendError(res, 500, 'Failed to parse LLM response as JSON');
    }
  } catch (error) {
    console.error('[extract-from-url] Failed:', error.message);
    return sendError(res, 500, error.message);
  }
});

// ============================================================================
// SITE PATCH ENDPOINTS
// ============================================================================

// --- Plan a patch: Claude analyzes site files + change request ---
app.post('/api/sites/:siteId/patch/plan', requireAuth, async (req, res) => {
  try {
    const site = stmts.getSite.get(req.params.siteId, req.user.id);
    if (!site) return sendError(res, 404, 'Site not found');
    if (!site.storage_path) return sendError(res, 400, 'Site has no files');

    const { changeRequest } = req.body;
    if (!changeRequest || typeof changeRequest !== 'string' || changeRequest.trim().length < 3) {
      return sendError(res, 400, 'changeRequest is required (min 3 chars)');
    }

    const patchId = randomUUID();
    const now = Date.now();

    // Insert patch record as 'planning'
    stmts.insertPatch.run(patchId, site.id, req.user.id, changeRequest.trim(), null, 'planning', now);

    // Generate plan (async — respond with patchId immediately, update when done)
    res.json({ success: true, patchId, status: 'planning' });

    // Background: call Claude to generate patch plan
    (async () => {
      try {
        const plan = await generatePatchPlan(callClaudeSync, site.storage_path, changeRequest.trim());
        stmts.updatePatch.run(JSON.stringify(plan), 'planned', null, null, patchId, req.user.id);
      } catch (err) {
        console.error('[SitePatch] Plan generation failed:', err.message);
        stmts.updatePatch.run(null, 'failed', JSON.stringify({ error: err.message }), Date.now(), patchId, req.user.id);
      }
    })();
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Get a specific patch plan ---
app.get('/api/sites/:siteId/patches/:patchId', requireAuth, (req, res) => {
  try {
    const patch = stmts.getPatch.get(req.params.patchId, req.user.id);
    if (!patch) return sendError(res, 404, 'Patch not found');
    // Parse plan JSON if present
    if (patch.plan) {
      try { patch.plan = JSON.parse(patch.plan); } catch { /* leave as string */ }
    }
    if (patch.apply_result) {
      try { patch.apply_result = JSON.parse(patch.apply_result); } catch { /* leave as string */ }
    }
    res.json({ success: true, patch });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- List patches for a site ---
app.get('/api/sites/:siteId/patches', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const patches = stmts.listPatches.all(req.params.siteId, req.user.id, limit);
    // Parse JSON fields
    for (const p of patches) {
      if (p.plan) { try { p.plan = JSON.parse(p.plan); } catch { /* leave */ } }
      if (p.apply_result) { try { p.apply_result = JSON.parse(p.apply_result); } catch { /* leave */ } }
    }
    res.json({ success: true, patches });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Apply a patch plan to the site workspace ---
app.post('/api/sites/:siteId/patch/:patchId/apply', requireAuth, async (req, res) => {
  try {
    const site = stmts.getSite.get(req.params.siteId, req.user.id);
    if (!site) return sendError(res, 404, 'Site not found');
    if (!site.storage_path) return sendError(res, 400, 'Site has no files');

    const patch = stmts.getPatch.get(req.params.patchId, req.user.id);
    if (!patch) return sendError(res, 404, 'Patch not found');
    if (patch.status !== 'planned' && patch.status !== 'approved') {
      return sendError(res, 400, `Cannot apply patch in status: ${patch.status}`);
    }

    let plan;
    try {
      plan = typeof patch.plan === 'string' ? JSON.parse(patch.plan) : patch.plan;
    } catch {
      return sendError(res, 400, 'Invalid patch plan data');
    }

    if (!plan || !Array.isArray(plan.changes) || plan.changes.length === 0) {
      return sendError(res, 400, 'Patch plan has no changes');
    }

    // Check for unresolved PLACEHOLDERs
    const placeholders = plan.placeholders || [];
    if (placeholders.length > 0) {
      // Check if user provided replacements in request body
      const replacements = req.body.replacements || {};
      for (const change of plan.changes) {
        if (change.after && typeof change.after === 'string') {
          for (const [placeholder, value] of Object.entries(replacements)) {
            change.after = change.after.replace(new RegExp(escapeRegex(placeholder), 'g'), value);
          }
        }
      }
    }

    // Apply the patch
    const result = await applyPatchPlan(site.storage_path, plan);
    const now = Date.now();
    stmts.updatePatch.run(
      typeof patch.plan === 'string' ? patch.plan : JSON.stringify(plan),
      result.failed > 0 ? 'partially_applied' : 'applied',
      JSON.stringify(result),
      now,
      patch.id,
      req.user.id,
    );

    // Update site timestamp
    stmts.updateSite.run(site.name, site.status, site.cloudflare_project_name, site.domain, site.manifest, now, site.id, req.user.id);

    res.json({ success: true, result });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Reject a patch plan ---
app.post('/api/sites/:siteId/patch/:patchId/reject', requireAuth, (req, res) => {
  try {
    const patch = stmts.getPatch.get(req.params.patchId, req.user.id);
    if (!patch) return sendError(res, 404, 'Patch not found');
    stmts.updatePatch.run(patch.plan, 'rejected', null, Date.now(), patch.id, req.user.id);
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// ARTIFACT ENDPOINTS
// ============================================================================

app.get('/api/artifacts', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    let rows;
    if (req.query.conversationId) {
      rows = stmts.listArtifactsByConversation.all(req.query.conversationId, userId, limit);
    } else if (req.query.tbwoId) {
      rows = stmts.listArtifactsByTBWO.all(req.query.tbwoId, userId, limit);
    } else {
      rows = stmts.listArtifacts.all(userId, limit);
    }
    const artifacts = rows.map(r => ({
      ...r,
      editable: !!r.editable,
      metadata: JSON.parse(r.metadata || '{}'),
    }));
    res.json({ success: true, artifacts });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/artifacts', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const id = b.id || randomUUID();
    const now = Date.now();
    stmts.insertArtifact.run(
      id, b.title || 'Untitled', b.type || 'code', b.language || null,
      b.content || '', b.editable !== false ? 1 : 0,
      b.conversationId || null, b.tbwoId || null,
      JSON.stringify(b.metadata || {}), b.createdAt || now, b.updatedAt || now, userId
    );
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.patch('/api/artifacts/:id', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const e = stmts.getArtifact.get(req.params.id, userId);
    if (!e) return res.status(404).json({ error: 'Not found' });
    const b = req.body;
    const now = Date.now();
    stmts.updateArtifact.run(
      b.title ?? e.title, b.type ?? e.type, b.language ?? e.language,
      b.content ?? e.content,
      b.editable !== undefined ? (b.editable ? 1 : 0) : e.editable,
      b.metadata ? JSON.stringify(b.metadata) : e.metadata,
      now, req.params.id, userId
    );
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/artifacts/:id', requireAuth, (req, res) => {
  try { stmts.deleteArtifact.run(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// MEMORY ENDPOINTS
// ============================================================================

app.get('/api/memories', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    let rows;
    if (req.query.layer) {
      rows = stmts.listMemoriesByLayer.all(req.query.layer, userId);
    } else {
      rows = stmts.listMemories.all(userId);
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
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/memories', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
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
      b.lastAccessedAt || null, b.createdAt || now, b.updatedAt || now, userId
    );
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.patch('/api/memories/:id', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const e = stmts.getMemory.get(req.params.id, userId);
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
      b.lastAccessedAt ?? e.last_accessed_at, now, req.params.id, userId
    );
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/memories/:id', requireAuth, (req, res) => {
  try { stmts.deleteMemory.run(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// AUDIT ENDPOINTS
// ============================================================================

app.get('/api/audit', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    let rows;
    if (req.query.since) {
      rows = stmts.listAuditSince.all(userId, parseInt(req.query.since));
    } else {
      rows = stmts.listAudit.all(userId, parseInt(req.query.limit) || 1000);
    }
    const entries = rows.map(r => ({
      ...r,
      tools_used: JSON.parse(r.tools_used || '[]'),
    }));
    res.json({ success: true, entries });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/audit', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
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
      b.timestamp || Date.now(), userId
    );
    // Track Opus usage for monthly quota enforcement
    if (b.model && b.model.includes('opus')) {
      incrementQuota(userId, 'opus_messages');
    }
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/audit/prune', requireAuth, (req, res) => {
  try {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const result = stmts.pruneAudit.run(req.user.id, ninetyDaysAgo);
    res.json({ success: true, deleted: result.changes });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// IMAGE METADATA ENDPOINTS
// ============================================================================

app.get('/api/images/list', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const images = stmts.listImages.all(req.user.id, limit);
    res.json({ success: true, images });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/images/metadata', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const id = b.id || randomUUID();
    stmts.insertImage.run(
      id, b.url || '', b.prompt || '', b.revisedPrompt || null,
      b.model || 'dall-e-3', b.size || '1024x1024',
      b.quality || 'standard', b.style || 'vivid',
      b.conversationId || null, b.messageId || null,
      b.createdAt || Date.now(), userId
    );
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/images/:id', requireAuth, (req, res) => {
  try { stmts.deleteImage.run(req.params.id, req.user.id); res.json({ success: true }); }
  catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// API KEY STATUS (never exposes actual keys)
// ============================================================================

app.get('/api/keys/status', requireAuth, (req, res) => {
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
app.post('/api/search/brave', requireAuth, async (req, res) => {
  try {
    const { query, count = 5, apiKey } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Server-side key takes priority, client key is optional fallback
    const braveKey = process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY || apiKey;
    if (!braveKey) {
      return res.status(400).json({ error: 'Brave API key not configured' });
    }

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
    const webResults = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));
    console.log(`[Brave Proxy] Search for "${query}" returned ${webResults.length} results`);

    res.json({ results: webResults, query });
  } catch (error) {
    console.error('[Brave Proxy] Error:', error.message);
    sendError(res, 500, error.message);
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
  // Resolve to absolute path first, then normalize (handles .. AFTER resolution)
  const resolvedPath = path.resolve(filePath);
  const normalizedPath = path.normalize(resolvedPath);

  // Block Windows UNC paths (\\server\share)
  if (normalizedPath.startsWith('\\\\')) {
    return false;
  }

  // Check if resolved path is within allowed directories
  // Use path.sep to prevent prefix-matching bypasses (e.g., /home/userEvil matching /home/user)
  return ALLOWED_DIRS.some(dir => {
    const normalizedDir = path.normalize(dir);
    return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
  });
}

/**
 * Read a file
 * POST /api/files/read
 * Body: { path: string }
 */
app.post('/api/files/read', requireAuth, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

/**
 * Write a file
 * POST /api/files/write
 * Body: { path: string, content: string }
 */
app.post('/api/files/write', requireAuth, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

/**
 * List directory contents
 * POST /api/files/list
 * Body: { path: string }
 */
app.post('/api/files/list', requireAuth, async (req, res) => {
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
    sendError(res, 500, error.message);
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
app.post('/api/files/scan', requireAuth, scanLimiter, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// CODE SEARCH ENDPOINT
// ============================================================================

/**
 * Search for text/regex patterns across files in a directory
 * POST /api/files/search
 */
app.post('/api/files/search', requireAuth, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// COMMAND EXECUTION ENDPOINT
// ============================================================================

/**
 * Execute shell commands (npm test, npm run build, etc.)
 * POST /api/command/execute
 */
app.post('/api/command/execute', requireAuth, executionLimiter, async (req, res) => {
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

    const MAX_STDOUT = 500000;
    const MAX_STDERR = 50000;
    const stdoutTruncated = result.stdout.length > MAX_STDOUT;
    const stderrTruncated = result.stderr.length > MAX_STDERR;

    res.json({
      success: true,
      stdout: stdoutTruncated
        ? result.stdout.slice(0, MAX_STDOUT) + `\n\n[Output truncated. ${(result.stdout.length - MAX_STDOUT).toLocaleString()} bytes omitted.]`
        : result.stdout,
      stderr: stderrTruncated
        ? result.stderr.slice(0, MAX_STDERR) + `\n\n[Stderr truncated. ${(result.stderr.length - MAX_STDERR).toLocaleString()} bytes omitted.]`
        : result.stderr,
      exitCode: result.exitCode,
      duration,
      truncated: stdoutTruncated || stderrTruncated,
    });
  } catch (error) {
    console.error('[Command] Error:', error.message);
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// GIT ENDPOINT
// ============================================================================

/**
 * Execute git operations
 * POST /api/git/execute
 */
app.post('/api/git/execute', requireAuth, async (req, res) => {
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
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// CODE EXECUTION (Sandboxed)
// ============================================================================

import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';

// Detect available Python command (python3 on Linux/Railway, python on Windows)
let _pythonCmd = null;
function getPythonCommand() {
  if (_pythonCmd) return _pythonCmd;
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 });
      _pythonCmd = cmd;
      console.log(`[Code] Using Python command: ${cmd}`);
      return cmd;
    } catch {}
  }
  _pythonCmd = 'python3'; // fallback, will fail with clear error
  return _pythonCmd;
}

/**
 * Execute code in a sandboxed environment
 * POST /api/code/execute
 * Body: { language: string, code: string, timeout?: number }
 */
app.post('/api/code/execute', requireAuth, executionLimiter, async (req, res) => {
  try {
    const { language, code, timeout = 30000 } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    if (!language) {
      return res.status(400).json({ error: 'Language is required' });
    }

    // Security: Block dangerous system-level operations
    // Targeted patterns — won't block legitimate Python builtins like eval()/exec()
    const dangerousPatterns = [
      'rm -rf /',           // destructive delete
      'format c:',          // Windows format
      'del /f /s /q c:',    // Windows destructive delete
      'shutdown',           // system shutdown
      '__import__("os").system',  // shell escape via os.system
      'subprocess.call',    // shell subprocess
      'subprocess.run',     // shell subprocess
      'subprocess.Popen',   // shell subprocess
      'require("child_process")', // Node shell escape
      'process.exit',       // Node process kill
      'process.kill',       // Node process kill
      'os.remove(',         // file deletion
      'shutil.rmtree',      // recursive directory deletion
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
        command = getPythonCommand();
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
    let settled = false;
    const child = spawn(command, args, {
      timeout: timeout + 1000, // spawn timeout as safety net (slightly longer)
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      if (stdout.length < 1024 * 1024) stdout += data.toString(); // 1MB cap
    });

    child.stderr.on('data', (data) => {
      if (stderr.length < 256 * 1024) stderr += data.toString(); // 256KB cap
    });

    child.on('close', (exitCode) => {
      if (!settled) { settled = true; resolve({ stdout, stderr, exitCode }); }
    });

    child.on('error', (error) => {
      if (!settled) { settled = true; reject(error); }
    });

    // Primary timeout — kill and resolve with timeout error
    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGTERM'); } catch {}
        resolve({ stdout, stderr: stderr + `\n[Execution timed out after ${timeout}ms]`, exitCode: 124 });
      }
    }, timeout);
  });
}

// ============================================================================
// COMPUTER USE ENDPOINTS
// ============================================================================

app.post('/api/computer/action', requireAuth, async (req, res) => {
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
const EDIT_HISTORY_MAX_FILES = 1000;

// LRU eviction: when edit history exceeds max, remove oldest entries
function editHistorySet(filePath, content) {
  if (!editHistory.has(filePath)) editHistory.set(filePath, []);
  editHistory.get(filePath).push(content);
  // Evict oldest files if over limit
  if (editHistory.size > EDIT_HISTORY_MAX_FILES) {
    const oldestKey = editHistory.keys().next().value;
    editHistory.delete(oldestKey);
  }
}

app.post('/api/editor/execute', requireAuth, async (req, res) => {
  try {
    const { command, path: filePath, file_text, old_str, new_str, insert_line, view_range } = req.body;

    if (!filePath && command !== 'undo_edit') {
      return res.status(400).json({ success: false, error: 'Path is required' });
    }

    // Resolve and validate path
    const resolvedPath = filePath ? path.resolve(filePath) : '';

    // Security: validate path is within allowed directories
    if (resolvedPath && !isPathAllowed(resolvedPath)) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Editor operations are restricted to allowed directories.',
        code: 'PATH_DENIED',
      });
    }

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

        // Save to edit history for undo (with LRU eviction)
        editHistorySet(resolvedPath, content);

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

        editHistorySet(resolvedPath, content);

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

app.post('/api/images/generate', requireAuth, async (req, res) => {
  try {
    const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
    if (limits.maxCfImages >= 0) {
      const used = getQuotaCount(req.user.id, 'image_generations');
      if (used >= limits.maxCfImages) {
        return res.status(429).json({ error: 'Monthly image generation limit reached', used, limit: limits.maxCfImages, code: 'IMAGE_QUOTA_EXCEEDED' });
      }
    }
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

    incrementQuota(req.user.id, 'image_generations');
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
// WEB FETCH — Fetch URL content as text
// ============================================================================

app.post('/api/web/fetch', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    console.log(`[Web Fetch] Fetching: ${url.slice(0, 100)}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ALIN/1.0 (Web Fetch)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(502).json({ success: false, error: `Upstream returned ${response.status}` });
    }

    let html = await response.text();

    // Strip scripts and styles
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    // Strip HTML tags, keep text
    let text = html.replace(/<[^>]+>/g, ' ');
    // Collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();
    // Cap at 50K chars
    text = text.slice(0, 50_000);

    res.json({ success: true, content: text, url });
  } catch (error) {
    if (error.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Request timed out (15s)' });
    }
    console.error('[Web Fetch] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// IMAGE SEARCH — Unsplash or picsum fallback
// ============================================================================

app.post('/api/images/search', requireAuth, async (req, res) => {
  try {
    const { query, count = 5, orientation } = req.body;
    if (!query) {
      return res.status(400).json({ success: false, error: 'Query is required' });
    }

    const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
    let images = [];

    if (unsplashKey) {
      // Use Unsplash API
      const params = new URLSearchParams({
        query,
        per_page: String(Math.min(count, 30)),
        ...(orientation ? { orientation } : {}),
      });
      const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
        headers: { Authorization: `Client-ID ${unsplashKey}` },
      });
      if (!response.ok) {
        throw new Error(`Unsplash API returned ${response.status}`);
      }
      const data = await response.json();
      images = (data.results || []).map(img => ({
        url: img.urls?.regular || img.urls?.small,
        alt: img.alt_description || img.description || query,
        attribution: `Photo by ${img.user?.name || 'Unknown'} on Unsplash`,
        width: img.width,
        height: img.height,
      }));
    } else {
      // Fallback to picsum.photos placeholders
      console.log(`[Image Search] No UNSPLASH_ACCESS_KEY set, using picsum placeholders for "${query}"`);
      const baseW = orientation === 'portrait' ? 600 : orientation === 'landscape' ? 1200 : 800;
      const baseH = orientation === 'portrait' ? 900 : orientation === 'landscape' ? 800 : 800;
      for (let i = 0; i < Math.min(count, 10); i++) {
        const seed = Math.floor(Math.random() * 1000);
        images.push({
          url: `https://picsum.photos/seed/${seed}/${baseW}/${baseH}`,
          alt: `${query} placeholder image ${i + 1}`,
          attribution: 'Via picsum.photos (placeholder)',
          width: baseW,
          height: baseH,
        });
      }
    }

    res.json({ success: true, images });
  } catch (error) {
    console.error('[Image Search] Error:', error.message);
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
app.get('/api/system/metrics', requireAuth, (req, res) => {
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
app.post('/api/hardware/gpu-compute', requireAuth, async (req, res) => {
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
app.get('/api/hardware/gpu-info', requireAuth, (req, res) => {
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
app.get('/api/hardware/processes', requireAuth, (req, res) => {
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
app.post('/api/hardware/webcam', requireAuth, async (req, res) => {
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
app.post('/api/blender/execute', requireAuth, async (req, res) => {
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
    const isBlenderPathAllowed = (p) => {
      // Reuse the shared isPathAllowed + also allow tmpdir for Blender outputs
      if (isPathAllowed(p)) return true;
      const rp = path.resolve(p);
      return rp.startsWith(path.resolve(os.tmpdir()));
    };

    let resolvedBlendPath = null;
    if (blendFile) {
      resolvedBlendPath = path.resolve(blendFile);
      if (!isPathAllowed(resolvedBlendPath)) {
        return res.status(403).json({ success: false, error: 'blendFile path not allowed' });
      }
      if (!fsSync.existsSync(resolvedBlendPath)) {
        return res.status(400).json({ success: false, error: 'blendFile does not exist' });
      }
    }

    if (outputPath && !isBlenderPathAllowed(tmpOutputBase)) {
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
app.post('/api/blender/render', requireAuth, async (req, res) => {
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
app.post('/api/claude', requireAuth, async (req, res) => {
  try {
    const { model, max_tokens, messages, system } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(400).json({ error: 'No Anthropic API key configured' });
    }

    const body = {
      model: model || DEFAULT_MODELS.claudeHaiku,
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
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// MEMORY STORE/RECALL — For TBWO execution engine tool calls
// ============================================================================

/**
 * POST /api/memory/store — Store a memory entry (used by TBWO execution engine)
 * Body: { key, value, category, content, importance, tags }
 */
app.post('/api/memory/store', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
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
      null, now, now, userId
    );

    console.log(`[Memory] Stored: "${memContent.slice(0, 50)}..." (${layer}, salience=${salience})`);
    res.json({ success: true, id, message: `Memory stored in ${layer} layer` });
  } catch (error) {
    console.error('[Memory] Store error:', error.message);
    sendError(res, 500, error.message);
  }
});

/**
 * POST /api/memory/recall — Search memories (used by TBWO execution engine)
 * Body: { query, category, limit }
 */
app.post('/api/memory/recall', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { query, category, limit: maxResults } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });

    // Fetch user's memories, then do simple text matching
    let rows;
    if (category) {
      const layerMap = {
        preference: 'semantic', fact: 'semantic',
        context: 'episodic', procedure: 'procedural',
        episode: 'episodic',
      };
      const layer = layerMap[category] || category;
      rows = db.prepare('SELECT * FROM memory_entries WHERE layer = ? AND user_id = ? ORDER BY salience DESC, updated_at DESC').all(layer, userId);
    } else {
      rows = db.prepare('SELECT * FROM memory_entries WHERE user_id = ? ORDER BY salience DESC, updated_at DESC').all(userId);
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
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// FILE WATCHER — Detect file changes in project directories
// ============================================================================

const activeWatchers = new Map(); // path → { watcher, changes[] }

/**
 * POST /api/files/watch — Start watching a directory for changes
 */
app.post('/api/files/watch', requireAuth, (req, res) => {
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
app.get('/api/files/changes', requireAuth, (req, res) => {
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
app.delete('/api/files/watch', requireAuth, (req, res) => {
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
app.post('/api/self-model/outcomes', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const id = randomUUID();
    stmts.insertOutcome.run(id, b.tbwoId, b.objective || '', b.type || '', b.timeBudget || 0, b.planConfidence || 0, b.phasesCompleted || 0, b.phasesFailed || 0, b.artifactsCount || 0, b.userEditsAfter || 0, b.qualityScore || 0, b.timestamp || Date.now(), userId);
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/self-model/outcomes', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const type = req.query.type;
    const rows = type ? stmts.listOutcomesByType.all(userId, type, limit) : stmts.listOutcomes.all(userId, limit);
    res.json({ success: true, outcomes: rows });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Tool Reliability (shared across users — measures backend tool behavior) ---
app.post('/api/self-model/tool-reliability', requireAuth, (req, res) => {
  try {
    const { toolName, success, duration, errorReason, model } = req.body;
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
    // Feature 6: Also track per-model success rates for adaptive routing
    if (model && model !== 'unknown') {
      stmts.upsertModelSuccessRate.run(
        model,
        success ? 1 : 0,
        success ? 0 : 1,
        duration || 0,
        Date.now()
      );
    }
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/self-model/tool-reliability', requireAuth, (req, res) => {
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
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Model Success Rates (Feature 6 — adaptive routing) ---
app.get('/api/self-model/model-success-rates', requireAuth, (req, res) => {
  try {
    const rows = stmts.getModelSuccessRates.all().map(r => ({
      model: r.model,
      successCount: r.success_count,
      failureCount: r.failure_count,
      totalCalls: r.total_calls,
      avgDuration: r.avg_duration,
    }));
    res.json(rows);
  } catch (error) { sendError(res, 500, error.message); }
});

// --- User Corrections ---
app.post('/api/self-model/corrections', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const { originalValue, correctedValue, category } = req.body;
    // Check if a similar correction already exists for this user
    const existing = stmts.findCorrection.get(category, correctedValue, userId);
    if (existing) {
      stmts.incrementCorrection.run(Date.now(), existing.id, userId);
      res.json({ success: true, id: existing.id, correctionCount: existing.correction_count + 1 });
    } else {
      const id = randomUUID();
      stmts.insertCorrection.run(id, originalValue || '', correctedValue || '', category || 'general', Date.now(), userId);
      res.json({ success: true, id, correctionCount: 1 });
    }
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/self-model/corrections', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const minCount = parseInt(req.query.minCount) || 1;
    const rows = stmts.listCorrections.all(userId, minCount).map(r => ({
      id: r.id,
      originalValue: r.original_value,
      correctedValue: r.corrected_value,
      category: r.category,
      correctionCount: r.correction_count,
      lastCorrected: r.last_corrected,
    }));
    res.json({ success: true, corrections: rows });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Decision Log ---
app.post('/api/self-model/decisions', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const id = randomUUID();
    stmts.insertDecision.run(id, b.tbwoId || '', b.decisionType || '', JSON.stringify(b.optionsConsidered || []), b.chosenOption || '', b.reasoning || '', b.outcome || '', b.confidence || 0, b.timestamp || Date.now(), userId);
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/self-model/decisions', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const tbwoId = req.query.tbwoId;
    const rows = (tbwoId ? stmts.listDecisionsByTBWO.all(userId, tbwoId, limit) : stmts.listDecisions.all(userId, limit)).map(r => ({
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
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Thinking Traces ---
app.post('/api/self-model/thinking-traces', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const id = randomUUID();
    stmts.insertThinkingTrace.run(id, b.conversationId || '', b.messageId || '', b.tbwoId || null, b.thinkingContent || '', b.timestamp || Date.now(), userId);
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/self-model/thinking-traces', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    let rows;
    if (req.query.q) {
      rows = stmts.searchThinking.all(userId, `%${req.query.q}%`, limit);
    } else if (req.query.conversationId) {
      rows = stmts.listThinkingByConv.all(req.query.conversationId, userId);
    } else if (req.query.tbwoId) {
      rows = stmts.listThinkingByTBWO.all(req.query.tbwoId, userId);
    } else {
      rows = stmts.searchThinking.all(userId, '%', limit);
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
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Layer Memory ---
app.post('/api/self-model/layer-memory', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body;
    const id = randomUUID();
    const now = Date.now();
    stmts.insertLayerMemory.run(id, b.layer || 'short_term', b.content || '', b.category || '', b.salience ?? 0.5, b.expiresAt || null, JSON.stringify(b.metadata || {}), now, now, userId);
    res.json({ success: true, id });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/self-model/layer-memory', requireAuth, (req, res) => {
  try {
    const userId = req.user.id;
    const layer = req.query.layer || 'short_term';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const now = Date.now();
    const rows = stmts.listLayerMemories.all(layer, userId, now, limit).map(r => ({
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
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/self-model/layer-memory/prune', requireAuth, (req, res) => {
  try {
    const result = stmts.pruneExpiredLayers.run(req.user.id, Date.now());
    res.json({ success: true, pruned: result.changes });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// MULTI-AGENT CODING ARCHITECTURE — Server-Side Tool Loop
// ============================================================================

import multer from 'multer';
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max per file

// --- User workspace registry ---
const userWorkspaces = new Map(); // userId → { path, createdAt, lastAccessed }
const WORKSPACE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_WORKSPACES = 500; // Prevent unbounded growth

/** Evict least-recently-accessed workspaces when map exceeds size cap */
function evictStaleWorkspaces() {
  if (userWorkspaces.size <= MAX_WORKSPACES) return;
  const entries = [...userWorkspaces.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  const toEvict = entries.slice(0, userWorkspaces.size - MAX_WORKSPACES);
  for (const [userId, ws] of toEvict) {
    fs.rm(ws.path, { recursive: true, force: true }).catch(() => {});
    userWorkspaces.delete(userId);
    console.log(`[Workspace] Evicted LRU workspace: ${userId}`);
  }
}

function getUserWorkspacePath(userId) {
  return path.join(os.tmpdir(), 'alin-workspaces', userId);
}

function sanitizePath(p) {
  return path.normalize(p).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
}

function isWithinDirectory(fullPath, baseDir) {
  return path.resolve(fullPath).startsWith(path.resolve(baseDir));
}

// --- Non-streaming Claude API call (for tool loop + scan agent) ---
async function callClaudeSync({ model, messages, system, tools, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const body = {
    model: model || DEFAULT_MODELS.claudeSonnet,
    max_tokens: maxTokens || 16384,
    stream: false,
    messages,
  };
  if (system) body.system = system;
  if (tools && tools.length > 0) body.tools = tools;

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    // Retry on 429 (rate limit), 500 (transient API error), and 529 (overloaded)
    if ((response.status === 429 || response.status === 500 || response.status === 529) && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
      const jitter = Math.random() * 500;
      const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 10000) + jitter;
      console.warn(`[callClaudeSync] ${response.status} — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    const text = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 500)}`);
  }
}

// --- Compress tool result (cap at 70K chars) ---
function compressToolResult(result) {
  if (!result || typeof result !== 'string') return result || '';
  if (result.length <= 70000) return result;
  return result.slice(0, 70000) + `\n\n[...truncated, ${result.length} chars total]`;
}

// --- Internal tool handler functions (workspace-scoped) ---

async function toolFileRead(input, workspacePath) {
  try {
    const filePath = sanitizePath(input.path || '');
    const fullPath = path.join(workspacePath, filePath);
    if (!isWithinDirectory(fullPath, workspacePath)) {
      return { success: false, error: 'Path traversal detected' };
    }
    const content = await fs.readFile(fullPath, 'utf-8');
    return { success: true, result: content };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolFileWrite(input, workspacePath) {
  try {
    const filePath = sanitizePath(input.path || '');
    const fullPath = path.join(workspacePath, filePath);
    if (!isWithinDirectory(fullPath, workspacePath)) {
      return { success: false, error: 'Path traversal detected' };
    }
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.content || '');
    return { success: true, result: `File written: ${filePath} (${(input.content || '').length} bytes)` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolFileList(input, workspacePath) {
  try {
    const dirPath = sanitizePath(input.path || '.');
    const fullPath = path.join(workspacePath, dirPath);
    if (!isWithinDirectory(fullPath, workspacePath)) {
      return { success: false, error: 'Path traversal detected' };
    }
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    const list = entries.map(e => `${e.isDirectory() ? '[DIR] ' : ''}${e.name}`).join('\n');
    return { success: true, result: list || '(empty directory)' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolScanDirectory(input, workspacePath) {
  try {
    const scanPath = sanitizePath(input.path || '.');
    const rootPath = path.join(workspacePath, scanPath);
    if (!isWithinDirectory(rootPath, workspacePath)) {
      return { success: false, error: 'Path traversal detected' };
    }
    const maxDepth = input.maxDepth || input.depth || 3;
    const maxFiles = input.maxFiles || 50;
    const excludeSet = new Set(SCAN_DEFAULTS.defaultExclude);
    const files = [];
    let totalSize = 0;
    const treeLines = [];

    async function walk(dir, depth, prefix) {
      if (depth > maxDepth || files.length >= maxFiles || totalSize >= 2 * 1024 * 1024) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (let i = 0; i < entries.length; i++) {
        if (files.length >= maxFiles) break;
        const entry = entries[i];
        if (excludeSet.has(entry.name)) continue;
        const isLast = i === entries.length - 1;
        const connector = isLast ? '└── ' : '├── ';
        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          treeLines.push(`${prefix}${connector}${entry.name}/`);
          await walk(fullPath, depth + 1, childPrefix);
        } else {
          const ext = path.extname(entry.name).toLowerCase();
          if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
          treeLines.push(`${prefix}${connector}${entry.name}`);
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size <= 100 * 1024 && totalSize + stat.size <= 2 * 1024 * 1024) {
              const content = await fs.readFile(fullPath, 'utf-8');
              const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
              files.push({ path: relPath, content });
              totalSize += stat.size;
            }
          } catch {}
        }
      }
    }

    treeLines.push(path.basename(rootPath) + '/');
    await walk(rootPath, 0, '');

    let result = `## Directory Tree\n\`\`\`\n${treeLines.join('\n')}\n\`\`\`\n\n## File Contents\n`;
    for (const f of files) {
      const ext = path.extname(f.path).replace('.', '') || 'text';
      result += `\n### ${f.path}\n\`\`\`${ext}\n${f.content}\n\`\`\`\n`;
    }
    result += `\n(${files.length} files, ${Math.round(totalSize / 1024)}KB total)`;

    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolCodeSearch(input, workspacePath) {
  try {
    const query = input.query || input.pattern || '';
    if (!query) return { success: false, error: 'Query is required' };
    const searchPath = sanitizePath(input.path || '.');
    const rootPath = path.join(workspacePath, searchPath);
    if (!isWithinDirectory(rootPath, workspacePath)) {
      return { success: false, error: 'Path traversal detected' };
    }
    const excludeSet = new Set(SCAN_DEFAULTS.defaultExclude);
    const matches = [];
    const maxResults = 100;

    let searchRegex;
    try { searchRegex = new RegExp(query, 'gi'); } catch { searchRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }

    async function searchDir(dir) {
      if (matches.length >= maxResults) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (matches.length >= maxResults) break;
        if (excludeSet.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { await searchDir(fullPath); continue; }
        const ext = path.extname(entry.name).toLowerCase();
        if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
        try {
          const stat = await fs.stat(fullPath);
          if (stat.size > 100 * 1024) continue;
          const content = await fs.readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          for (let ln = 0; ln < lines.length && matches.length < maxResults; ln++) {
            searchRegex.lastIndex = 0;
            if (searchRegex.test(lines[ln])) {
              const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
              matches.push(`${relPath}:${ln + 1}: ${lines[ln].trim()}`);
            }
          }
        } catch {}
      }
    }

    await searchDir(rootPath);
    return { success: true, result: matches.length > 0 ? matches.join('\n') : 'No matches found.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolEditFile(input, workspacePath) {
  try {
    const filePath = sanitizePath(input.path || '');
    const fullPath = path.join(workspacePath, filePath);
    if (!isWithinDirectory(fullPath, workspacePath)) {
      return { success: false, error: 'Path traversal detected' };
    }
    const oldStr = input.old_str ?? input.oldStr ?? '';
    const newStr = input.new_str ?? input.newStr ?? '';
    if (!oldStr) return { success: false, error: 'old_str is required' };

    const content = await fs.readFile(fullPath, 'utf-8');
    const occurrences = content.split(oldStr).length - 1;
    if (occurrences === 0) return { success: false, error: `old_str not found in ${filePath}` };
    if (occurrences > 1) return { success: false, error: `old_str found ${occurrences} times in ${filePath} — must be unique. Include more surrounding context.` };

    const newContent = content.replace(oldStr, newStr);
    await fs.writeFile(fullPath, newContent);
    return { success: true, result: `Edited ${filePath}: replaced ${oldStr.length} chars with ${newStr.length} chars` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolRunCommand(input, workspacePath) {
  try {
    const command = input.command || '';
    if (!command) return { success: false, error: 'Command is required' };
    const cmdLower = command.toLowerCase().trim();
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (cmdLower.includes(dangerous.toLowerCase())) {
        return { success: false, error: `Command blocked: contains "${dangerous}"` };
      }
    }

    const result = await new Promise((resolve, reject) => {
      const child = spawn(command, { shell: true, cwd: workspacePath, timeout: 60000, env: { ...process.env, FORCE_COLOR: '0' } });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 200000) child.kill('SIGTERM'); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
      child.on('error', reject);
    });

    let output = '';
    if (result.stdout) output += result.stdout.slice(0, 100000);
    if (result.stderr) output += (output ? '\n--- stderr ---\n' : '') + result.stderr.slice(0, 20000);
    output += `\n(exit code: ${result.exitCode})`;
    return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolGit(input, workspacePath) {
  try {
    const operation = input.operation || '';
    const args = Array.isArray(input.args) ? input.args : (input.args ? [input.args] : []);
    if (!operation) return { success: false, error: 'Operation is required' };

    const allOps = [...GIT_READ_OPS, ...GIT_WRITE_OPS];
    if (!allOps.includes(operation)) {
      return { success: false, error: `Unknown git operation: "${operation}". Allowed: ${allOps.join(', ')}` };
    }

    const fullCmd = `${operation} ${args.join(' ')}`.toLowerCase();
    for (const blocked of GIT_BLOCKED_PATTERNS) {
      if (fullCmd.includes(blocked)) {
        return { success: false, error: `Git operation blocked: "${blocked}" not allowed` };
      }
    }

    const gitArgs = [operation, ...args];
    const result = await new Promise((resolve, reject) => {
      const child = spawn('git', gitArgs, { cwd: workspacePath, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
      child.on('error', reject);
    });

    let output = result.stdout.slice(0, 100000);
    if (result.stderr) output += '\n' + result.stderr.slice(0, 20000);
    return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolExecuteCode(input) {
  try {
    const { language, code } = input;
    if (!code) return { success: false, error: 'Code is required' };
    const tempDir = os.tmpdir();
    const lang = (language || 'python').toLowerCase();
    const ext = (lang === 'python' || lang === 'py') ? 'py' : 'js';
    const tempFile = path.join(tempDir, `alin-exec-${Date.now()}.${ext}`);
    await fs.writeFile(tempFile, code);
    const pyCmd = getPythonCommand();
    const cmd = (lang === 'python' || lang === 'py') ? `${pyCmd} "${tempFile}"` : `node "${tempFile}"`;

    const result = await new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(cmd, { shell: true, timeout: 35000 });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => { if (stdout.length < 512000) stdout += d.toString(); });
      child.stderr.on('data', d => { if (stderr.length < 128000) stderr += d.toString(); });
      child.on('close', exitCode => { if (!settled) { settled = true; resolve({ stdout, stderr, exitCode }); } });
      child.on('error', err => { if (!settled) { settled = true; reject(err); } });
      setTimeout(() => {
        if (!settled) { settled = true; try { child.kill('SIGTERM'); } catch {} resolve({ stdout, stderr: stderr + '\n[Timed out after 30s]', exitCode: 124 }); }
      }, 30000);
    });

    try { await fs.unlink(tempFile); } catch {}
    let output = result.stdout.slice(0, 50000);
    if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 10000);
    return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolWebSearch(input) {
  try {
    const query = input.query || '';
    if (!query) return { success: false, error: 'Query is required' };
    const braveKey = process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY;
    if (!braveKey) return { success: false, error: 'Brave API key not configured' };

    const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey },
    });
    if (!resp.ok) return { success: false, error: `Search failed: ${resp.status}` };
    const data = await resp.json();
    const results = (data.web?.results || []).map(r => `**${r.title}**\n${r.url}\n${r.description || ''}`).join('\n\n');
    return { success: true, result: results || 'No results found.' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolMemoryStore(input, userId) {
  try {
    const { content, tags, category } = input;
    if (!content) return { success: false, error: 'Content is required' };
    const id = randomUUID();
    const now = Date.now();
    stmts.insertMemory.run(id, content, 'general', category || '', 0.5, 0, JSON.stringify(tags || []), '[]', '[]', '{}', 0, 0, 0, now, now, userId);
    return { success: true, result: `Memory stored (id: ${id.slice(0, 8)})` };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function toolMemoryRecall(input, userId) {
  try {
    const query = input.query || '';
    if (!query) return { success: false, error: 'Query is required' };
    const rows = stmts.listMemories.all(userId);
    const queryLower = query.toLowerCase();
    const matching = rows.filter(r => r.content.toLowerCase().includes(queryLower)).slice(0, 10);
    if (matching.length === 0) return { success: true, result: 'No matching memories found.' };
    return { success: true, result: matching.map(m => `- ${m.content}`).join('\n') };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- Template library tools ---
async function toolListTemplates() {
  try {
    const manifest = await cfR2.getTemplateManifest();
    if (!manifest.templates || manifest.templates.length === 0) {
      return { success: true, templates: [], message: 'No templates available. Build from scratch using design standards.' };
    }
    // Return summary (don't include file contents, just metadata)
    const templates = manifest.templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      pages: t.pages,
      components: t.components,
      tags: t.tags,
      tier: t.tier,
    }));
    return { success: true, templates };
  } catch (err) {
    return { success: false, error: `Failed to list templates: ${err.message}` };
  }
}

async function toolGetTemplate(input) {
  const templateId = input.template_id || input.templateId || input.id;
  if (!templateId) return { success: false, error: 'template_id is required' };

  try {
    const result = await cfR2.getTemplate(templateId);
    if (!result) {
      return { success: false, error: `Template "${templateId}" not found. Use list_templates to see available options.` };
    }
    return {
      success: true,
      template: result.template,
      files: result.files,
      instructions: 'Replace ALL {{VARIABLE}} placeholders with real content. Customize colors in CSS :root variables. Adapt copy to match the user\'s brand voice. Add/remove sections as needed. NEVER deploy with placeholder variables still present.',
    };
  } catch (err) {
    return { success: false, error: `Failed to fetch template: ${err.message}` };
  }
}

// --- Main tool dispatcher ---
async function executeToolServerSide(toolName, toolInput, workspacePath, userId) {
  switch (toolName) {
    case 'file_read': return toolFileRead(toolInput, workspacePath);
    case 'file_write': return toolFileWrite(toolInput, workspacePath);
    case 'file_list': return toolFileList(toolInput, workspacePath);
    case 'scan_directory': return toolScanDirectory(toolInput, workspacePath);
    case 'code_search': return toolCodeSearch(toolInput, workspacePath);
    case 'edit_file': return toolEditFile(toolInput, workspacePath);
    case 'run_command': return toolRunCommand(toolInput, workspacePath);
    case 'execute_code': return toolExecuteCode(toolInput);
    case 'git': return toolGit(toolInput, workspacePath);
    case 'web_search': return toolWebSearch(toolInput);
    case 'web_fetch': return toolWebFetch(toolInput);
    case 'memory_store': return toolMemoryStore(toolInput, userId);
    case 'memory_recall': return toolMemoryRecall(toolInput, userId);
    case 'spawn_scan_agent': return runScanAgent(toolInput.task || toolInput.query || '', workspacePath, userId);
    case 'list_templates': return toolListTemplates();
    case 'get_template': return toolGetTemplate(toolInput);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// --- Coding mode tool definitions (sent to Claude) ---
const CODING_TOOLS = [
  { name: 'file_read', description: 'Read a file from the workspace', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path within workspace' } }, required: ['path'] } },
  { name: 'file_write', description: 'Write/create a file in the workspace', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] } },
  { name: 'file_list', description: 'List files in a directory', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory path (default: .)' } } } },
  { name: 'scan_directory', description: 'Recursively scan a directory tree and read all file contents in one call. Use this FIRST to understand a codebase.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path (default: .)' }, depth: { type: 'number', description: 'Max depth (default: 3)' }, maxFiles: { type: 'number', description: 'Max files to read (default: 50)' } } } },
  { name: 'code_search', description: 'Search for text/regex patterns across files (like grep/ripgrep)', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search pattern (supports regex)' }, path: { type: 'string', description: 'Directory to search (default: .)' } }, required: ['query'] } },
  { name: 'edit_file', description: 'Find-and-replace edit. old_str must be unique in the file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string', description: 'Exact text to find (must be unique)' }, new_str: { type: 'string', description: 'Replacement text' } }, required: ['path', 'old_str', 'new_str'] } },
  { name: 'run_command', description: 'Execute a shell command in the workspace (npm test, npm run build, etc.)', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'execute_code', description: 'Execute Python or JavaScript code', input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['python', 'javascript'] }, code: { type: 'string' } }, required: ['language', 'code'] } },
  { name: 'git', description: 'Execute git operations (status, diff, log, add, commit, etc.)', input_schema: { type: 'object', properties: { operation: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['operation'] } },
  { name: 'web_search', description: 'Search the web for information', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'web_fetch', description: 'Fetch the contents of a URL directly. Returns the text/HTML content of any publicly accessible web page.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)' } }, required: ['url'] } },
  { name: 'memory_store', description: 'Store information for later recall', input_schema: { type: 'object', properties: { content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string' } }, required: ['content'] } },
  { name: 'memory_recall', description: 'Search stored memories', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'spawn_scan_agent', description: 'Spawn a fast read-only subagent (Haiku) to explore and analyze the codebase. Returns a summary. Use for large-scale code understanding without consuming main context.', input_schema: { type: 'object', properties: { task: { type: 'string', description: 'What to explore/analyze (e.g., "Find all React components that use useState")' } }, required: ['task'] } },
  { name: 'list_templates', description: 'List all available website templates from the ALIN template library. Returns template IDs, names, descriptions, categories, and which components each includes. Use this FIRST when a user wants to build a website — check if a template matches before building from scratch.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_template', description: 'Fetch a specific website template by ID. Returns all template files (HTML, CSS, JS) with {{VARIABLE}} placeholders. Adapt the template to the user\'s needs by replacing all variables with real content, adjusting colors/fonts, and customizing copy. NEVER deploy a raw template — always customize it.', input_schema: { type: 'object', properties: { template_id: { type: 'string', description: 'Template ID from list_templates (e.g., "saas-landing", "portfolio", "restaurant")' } }, required: ['template_id'] } },
];

// DEPRECATED: Coding mode prompt now served by server/prompts/codingMode.js
// Kept as fallback — will be removed in a future cleanup pass.
const CODING_SERVER_SYSTEM_PROMPT = `You are ALIN in coding mode — an expert autonomous software engineer. You solve coding tasks by working through them methodically: reading, understanding, planning, implementing, and verifying.

CORE PRINCIPLES:
1. Read before writing. Always call scan_directory or file_read first.
2. Verify after changing. Run tests or check for errors after every edit.
3. Fix your own mistakes. If something breaks, fix it yourself.
4. Minimize user interruption. Complete the task autonomously.
5. Work in tight loops. Think → Act → Observe → Repeat.

WORKFLOW:
1. scan_directory → understand project structure in ONE call
2. code_search → find definitions, imports, usages
3. edit_file or file_write → implement changes
4. run_command → verify (npm test, tsc --noEmit, etc.)
5. Repeat until complete

Use spawn_scan_agent for large-scale codebase exploration — it uses a fast model to scan and summarize without consuming your context.

All file paths are relative to the workspace root. Never use absolute paths.`;

// --- Scan subagent (Haiku-powered read-only codebase explorer) ---
async function runScanAgent(task, workspacePath, userId) {
  if (!task) return { success: false, error: 'Task is required' };

  const scanTools = CODING_TOOLS.filter(t => ['file_read', 'file_list', 'scan_directory', 'code_search'].includes(t.name));
  const scanSystem = `You are a fast, read-only code scanner. Your job is to explore a codebase and provide a clear, structured summary.

You have these read-only tools: file_read, file_list, scan_directory, code_search.
Use scan_directory first to get an overview, then drill into specific files as needed.
All paths are relative to the workspace root.

Be thorough but concise. Return a structured summary answering the user's question.`;

  let messages = [{ role: 'user', content: task }];
  const MAX_SCAN_ITERATIONS = 10;

  for (let i = 0; i < MAX_SCAN_ITERATIONS; i++) {
    const response = await callClaudeSync({
      model: DEFAULT_MODELS.claudeHaiku,
      messages,
      system: scanSystem,
      tools: scanTools,
      maxTokens: 16384,
    });

    // Extract text
    const textBlocks = (response.content || []).filter(b => b.type === 'text');
    const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');

    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      // Done — return final text
      const summary = textBlocks.map(b => b.text).join('\n');
      return { success: true, result: summary || 'Scan completed but no summary was generated.' };
    }

    // Execute tools and continue
    messages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      const result = await executeToolServerSide(toolUse.name, toolUse.input, workspacePath, userId);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: compressToolResult(result.success ? (result.result || 'Done') : `Error: ${result.error}`),
        is_error: !result.success,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { success: true, result: 'Scan agent reached maximum iterations.' };
}

// --- Main coding tool loop endpoint ---
app.post('/api/coding/stream', requireAuth, checkPlanLimits, async (req, res) => {
  const { messages, workspaceId, model, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const userId = req.user.id;
  const wsId = workspaceId || userId;
  const workspacePath = getUserWorkspacePath(wsId);

  // Ensure workspace exists
  try { await fs.mkdir(workspacePath, { recursive: true }); } catch {}

  // Update workspace registry
  userWorkspaces.set(userId, {
    path: workspacePath,
    createdAt: userWorkspaces.get(userId)?.createdAt || Date.now(),
    lastAccessed: Date.now(),
  });

  setupSSE(res);
  sendSSE(res, 'start', { model: model || DEFAULT_MODELS.claudeSonnet, provider: 'anthropic' });

  const MAX_ITERATIONS = 25;
  const MAX_DURATION_MS = 5 * 60 * 1000; // 5-minute time budget
  const streamStartTime = Date.now();
  const systemPrompt = (system && system !== '[DEPRECATED]')
      ? system
      : assemblePrompt('coding', { additionalContext: req.body.additionalContext || '' });
  const selectedModel = model || DEFAULT_MODELS.claudeSonnet;
  let conversationMessages = [...messages];

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Time budget enforcement
      if (Date.now() - streamStartTime > MAX_DURATION_MS) {
        sendSSE(res, 'text_delta', { text: '\n\n*Time budget exceeded (5 minutes). Stopping execution.*' });
        sendSSE(res, 'done', { stopReason: 'time_budget', model: selectedModel, iterations: iteration });
        res.end();
        return;
      }
      // Call Claude (non-streaming)
      const response = await callClaudeSync({
        model: selectedModel,
        messages: conversationMessages,
        system: systemPrompt,
        tools: CODING_TOOLS,
        maxTokens: 16384,
      });

      const contentBlocks = response.content || [];
      const textBlocks = contentBlocks.filter(b => b.type === 'text');
      const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');

      // Send text to client
      for (const tb of textBlocks) {
        if (tb.text) sendSSE(res, 'text_delta', { text: tb.text });
      }

      // If no tool calls, we're done
      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        sendSSE(res, 'done', {
          stopReason: response.stop_reason || 'end_turn',
          inputTokens: response.usage?.input_tokens || 0,
          outputTokens: response.usage?.output_tokens || 0,
          model: selectedModel,
          iterations: iteration + 1,
        });
        res.end();
        return;
      }

      // Execute each tool
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const activityId = randomUUID();
        sendSSE(res, 'tool_start', {
          activityId,
          toolName: toolUse.name,
          toolInput: toolUse.input,
        });

        const result = await executeToolServerSide(toolUse.name, toolUse.input, workspacePath, userId);

        const rawResult = result.success ? (result.result || 'Done') : `Error: ${result.error}`;
        sendSSE(res, 'tool_result', {
          activityId,
          toolName: toolUse.name,
          success: result.success,
          result: rawResult.slice(0, 2000), // abbreviated for client display
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: compressToolResult(rawResult),
          is_error: !result.success,
        });
      }

      // Append to conversation for next iteration
      conversationMessages.push({ role: 'assistant', content: contentBlocks });
      conversationMessages.push({ role: 'user', content: toolResults });
    }

    // Reached max iterations
    sendSSE(res, 'text_delta', { text: '\n\n*Reached maximum tool iterations (25). You can continue by sending another message.*' });
    sendSSE(res, 'done', { stopReason: 'max_iterations', model: selectedModel, iterations: MAX_ITERATIONS });
    res.end();
  } catch (error) {
    console.error('[CodingLoop] Error:', error.message);
    try { sendSSE(res, 'error', { error: error.message }); } catch {}
    try { res.end(); } catch {}
  }
});

// --- Scan agent endpoint (client-initiated) ---
app.post('/api/coding/scan-agent', requireAuth, async (req, res) => {
  try {
    const { task, workspaceId } = req.body;
    if (!task) return res.status(400).json({ error: 'task is required' });

    const userId = req.user.id;
    const wsId = workspaceId || userId;
    const workspacePath = getUserWorkspacePath(wsId);

    const result = await runScanAgent(task, workspacePath, userId);
    res.json(result);
  } catch (error) {
    console.error('[ScanAgent] Error:', error.message);
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// USER WORKSPACE ENDPOINTS
// ============================================================================

// POST /api/workspace/init — Create/get workspace
app.post('/api/workspace/init', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(userId);
    await fs.mkdir(workspacePath, { recursive: true });

    userWorkspaces.set(userId, {
      path: workspacePath,
      createdAt: userWorkspaces.get(userId)?.createdAt || Date.now(),
      lastAccessed: Date.now(),
    });

    console.log(`[Workspace] Initialized user workspace: ${workspacePath}`);
    res.json({ success: true, workspaceId: userId, workspacePath });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// POST /api/workspace/upload — Upload files (with zip auto-extraction)
app.post('/api/workspace/upload', requireAuth, upload.array('files', 50), async (req, res) => {
  try {
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(userId);
    await fs.mkdir(workspacePath, { recursive: true });

    const uploadedFiles = [];

    for (const file of (req.files || [])) {
      const targetDir = req.body.targetDir ? sanitizePath(req.body.targetDir) : '';
      const destDir = path.join(workspacePath, targetDir);

      if (!isWithinDirectory(destDir, workspacePath)) {
        continue; // skip path traversal attempts
      }

      // Check if zip file — auto-extract
      if (file.originalname.toLowerCase().endsWith('.zip')) {
        try {
          const zipData = await fs.readFile(file.path);
          const zip = await JSZip.loadAsync(zipData);
          const entries = Object.entries(zip.files);

          for (const [entryName, zipEntry] of entries) {
            if (zipEntry.dir) continue;
            const safeName = sanitizePath(entryName);
            const entryDest = path.join(destDir, safeName);
            if (!isWithinDirectory(entryDest, workspacePath)) continue;

            await fs.mkdir(path.dirname(entryDest), { recursive: true });
            const content = await zipEntry.async('nodebuffer');
            await fs.writeFile(entryDest, content);
            uploadedFiles.push(path.relative(workspacePath, entryDest).replace(/\\/g, '/'));
          }
        } catch (zipErr) {
          console.error('[Workspace] Zip extraction error:', zipErr.message);
        }
      } else {
        // Regular file — copy to workspace
        const safeName = sanitizePath(file.originalname);
        const dest = path.join(destDir, safeName);
        if (!isWithinDirectory(dest, workspacePath)) continue;

        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(file.path, dest);
        uploadedFiles.push(path.relative(workspacePath, dest).replace(/\\/g, '/'));
      }

      // Clean up temp file
      try { await fs.unlink(file.path); } catch {}
    }

    // Update workspace registry
    userWorkspaces.set(userId, {
      path: workspacePath,
      createdAt: userWorkspaces.get(userId)?.createdAt || Date.now(),
      lastAccessed: Date.now(),
    });

    console.log(`[Workspace] Uploaded ${uploadedFiles.length} files for user ${userId}`);
    res.json({ success: true, files: uploadedFiles, count: uploadedFiles.length });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// GET /api/workspace/tree — Recursive directory tree
app.get('/api/workspace/tree', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(userId);

    async function buildTree(dir, depth = 0, maxDepth = 5) {
      if (depth > maxDepth) return [];
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }

      const result = [];
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        if (SCAN_DEFAULTS.defaultExclude.includes(entry.name)) continue;
        const relativePath = path.relative(workspacePath, path.join(dir, entry.name)).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          const children = await buildTree(path.join(dir, entry.name), depth + 1, maxDepth);
          result.push({ name: entry.name, type: 'directory', path: relativePath, children });
        } else {
          try {
            const stat = await fs.stat(path.join(dir, entry.name));
            result.push({ name: entry.name, type: 'file', path: relativePath, size: stat.size });
          } catch {
            result.push({ name: entry.name, type: 'file', path: relativePath });
          }
        }
      }
      return result;
    }

    const tree = await buildTree(workspacePath);
    res.json({ success: true, files: tree });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// GET /api/workspace/file?path=... — Download single file
app.get('/api/workspace/file', requireAuthOrToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(userId);
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path query param required' });

    const relativePath = sanitizePath(filePath);
    const fullPath = path.join(workspacePath, relativePath);
    if (!isWithinDirectory(fullPath, workspacePath)) {
      return res.status(403).json({ error: 'Path traversal detected' });
    }

    const filename = path.basename(relativePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(path.resolve(fullPath));
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// GET /api/workspace/zip — Download all as zip
app.get('/api/workspace/zip', requireAuthOrToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(userId);

    const zip = new JSZip();

    async function addDir(dirPath, zipFolder) {
      let entries;
      try { entries = await fs.readdir(dirPath, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (SCAN_DEFAULTS.defaultExclude.includes(entry.name)) continue;
        const entryPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          await addDir(entryPath, zipFolder.folder(entry.name));
        } else {
          const content = await fs.readFile(entryPath);
          zipFolder.file(entry.name, content);
        }
      }
    }

    await addDir(workspacePath, zip);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="workspace-${userId.slice(0, 8)}.zip"`);
    zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' }).pipe(res);
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// DELETE /api/workspace — Delete workspace
app.delete('/api/workspace', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(userId);
    try { await fs.rm(workspacePath, { recursive: true, force: true }); } catch {}
    userWorkspaces.delete(userId);
    console.log(`[Workspace] Deleted user workspace: ${userId}`);
    res.json({ success: true });
  } catch (error) {
    sendError(res, 500, error.message);
  }
});

// --- Workspace TTL cleanup (every 6 hours) + LRU eviction ---
setInterval(() => {
  const now = Date.now();
  for (const [userId, ws] of userWorkspaces) {
    if (now - ws.lastAccessed > WORKSPACE_TTL) {
      fs.rm(ws.path, { recursive: true, force: true }).catch(() => {});
      userWorkspaces.delete(userId);
      console.log(`[Workspace] Cleaned up stale workspace: ${userId}`);
    }
  }
  evictStaleWorkspaces();
}, 6 * 60 * 60 * 1000);

// ============================================================================
// WEB_FETCH TOOL HANDLER
// ============================================================================

async function toolWebFetch(input) {
  try {
    const url = input.url;
    if (!url) return { success: false, error: 'URL is required' };
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, error: 'URL must start with http:// or https://' };
    }
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ALIN/1.0 (AI Assistant)' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('image') || contentType.includes('audio') || contentType.includes('video')) {
      return { success: true, result: `[Binary content: ${contentType}]` };
    }
    let result = await resp.text();
    if (contentType.includes('html')) {
      result = result.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    }
    return { success: true, result: result.slice(0, 100000) };
  } catch (error) { return { success: false, error: error.message }; }
}

// ============================================================================
// TOOL HANDLERS — GPU, WEBCAM, BLENDER (for unified executor)
// ============================================================================

async function toolGpuCompute(input) {
  try {
    const { script, framework, timeout } = input;
    if (!script) return { success: false, error: 'Script is required' };
    const pyCmd = getPythonCommand();
    const tempFile = path.join(os.tmpdir(), `alin-gpu-${Date.now()}.py`);
    await fs.writeFile(tempFile, script);
    const result = await executeWithTimeout(pyCmd, [tempFile], timeout || 120000);
    try { await fs.unlink(tempFile); } catch {}
    let output = result.stdout.slice(0, 100000);
    if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 20000);
    return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toolWebcamCapture(input) {
  try {
    const device = input.device ?? 0;
    const pyCmd = getPythonCommand();
    const outFile = path.join(os.tmpdir(), `alin_webcam_${Date.now()}.jpg`);
    const pyScript = `import cv2, base64, sys\ncap=cv2.VideoCapture(${device})\nret,frame=cap.read()\ncap.release()\nif not ret: sys.exit(1)\ncv2.imwrite("${outFile.replace(/\\/g, '/')}",frame)\nwith open("${outFile.replace(/\\/g, '/')}","rb") as f: print(base64.b64encode(f.read()).decode())`;
    const tempPy = path.join(os.tmpdir(), `alin_webcam_${Date.now()}.py`);
    await fs.writeFile(tempPy, pyScript);
    const result = await executeWithTimeout(pyCmd, [tempPy], 15000);
    try { await fs.unlink(tempPy); } catch {}
    try { await fs.unlink(outFile); } catch {}
    if (result.exitCode !== 0) return { success: false, error: result.stderr || 'Webcam capture failed (is OpenCV installed?)' };
    return { success: true, result: `data:image/jpeg;base64,${result.stdout.trim()}` };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toolBlenderExecute(input) {
  try {
    const { script, blendFile, timeout } = input;
    if (!script) return { success: false, error: 'Script is required' };
    const tempScript = path.join(os.tmpdir(), `alin-blender-${Date.now()}.py`);
    await fs.writeFile(tempScript, script);
    const args = ['--background'];
    if (blendFile) args.push(blendFile);
    args.push('--python', tempScript);
    const result = await executeWithTimeout('blender', args, timeout || 120000);
    try { await fs.unlink(tempScript); } catch {}
    let output = result.stdout.slice(0, 100000);
    if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 20000);
    return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toolBlenderRender(input) {
  try {
    const { blendFile, outputPath, engine, format, frame } = input;
    if (!blendFile) return { success: false, error: 'blendFile is required' };
    if (!outputPath) return { success: false, error: 'outputPath is required' };
    const args = ['--background', blendFile, '--render-output', outputPath];
    if (engine) args.push('--engine', engine);
    if (format) args.push('--render-format', format);
    args.push('--render-frame', String(frame || 1));
    const result = await executeWithTimeout('blender', args, 300000);
    let output = result.stdout.slice(0, 50000);
    if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 10000);
    return { success: result.exitCode === 0, result: output || `Rendered to ${outputPath}`, error: result.exitCode !== 0 ? output : undefined };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toolGenerateImage(input) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not configured for image generation' };
    const { prompt, size, quality, style } = input;
    if (!prompt) return { success: false, error: 'Prompt is required' };
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'dall-e-3', prompt, n: 1,
        size: size || '1024x1024', quality: quality || 'standard', style: style || 'vivid',
      }),
    });
    if (!resp.ok) { const t = await resp.text(); return { success: false, error: `DALL-E error ${resp.status}: ${t}` }; }
    const data = await resp.json();
    const img = data.data?.[0];
    return { success: true, result: JSON.stringify({ url: img?.url, revised_prompt: img?.revised_prompt }) };
  } catch (error) { return { success: false, error: error.message }; }
}

async function toolSystemStatus() {
  try {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    return {
      success: true,
      result: JSON.stringify({
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        memory: { heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB', heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB', rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB' },
        platform: process.platform, nodeVersion: process.version,
      }),
    };
  } catch (error) { return { success: false, error: error.message }; }
}

// ============================================================================
// UNIFIED TOOL EXECUTOR — /api/tools/execute
// ============================================================================

app.post('/api/tools/execute', requireAuth, async (req, res) => {
  try {
    const { toolName, toolInput, workspaceId } = req.body;
    if (!toolName) return res.status(400).json({ error: 'toolName required' });
    const userId = req.user.id;
    const workspacePath = getUserWorkspacePath(workspaceId || userId);
    try { await fs.mkdir(workspacePath, { recursive: true }); } catch {}
    const startTime = Date.now();
    let result;
    switch (toolName) {
      case 'file_read': result = await toolFileRead(toolInput, workspacePath); break;
      case 'file_write': result = await toolFileWrite(toolInput, workspacePath); break;
      case 'file_list': result = await toolFileList(toolInput, workspacePath); break;
      case 'scan_directory': result = await toolScanDirectory(toolInput, workspacePath); break;
      case 'code_search': result = await toolCodeSearch(toolInput, workspacePath); break;
      case 'edit_file': result = await toolEditFile(toolInput, workspacePath); break;
      case 'run_command': result = await toolRunCommand(toolInput, workspacePath); break;
      case 'execute_code': result = await toolExecuteCode(toolInput); break;
      case 'git': result = await toolGit(toolInput, workspacePath); break;
      case 'web_search': result = await toolWebSearch(toolInput); break;
      case 'web_fetch': result = await toolWebFetch(toolInput); break;
      case 'memory_store': result = await toolMemoryStore(toolInput, userId); break;
      case 'memory_recall': result = await toolMemoryRecall(toolInput, userId); break;
      case 'spawn_scan_agent': result = await runScanAgent(toolInput.task || toolInput.query || '', workspacePath, userId); break;
      case 'list_templates': result = await toolListTemplates(); break;
      case 'get_template': result = await toolGetTemplate(toolInput); break;
      case 'gpu_compute': result = await toolGpuCompute(toolInput); break;
      case 'webcam_capture': result = await toolWebcamCapture(toolInput); break;
      case 'blender_execute': result = await toolBlenderExecute(toolInput); break;
      case 'blender_render': result = await toolBlenderRender(toolInput); break;
      case 'generate_image': result = await toolGenerateImage(toolInput); break;
      case 'system_status': result = await toolSystemStatus(toolInput); break;
      default: result = { success: false, error: `Unknown tool: ${toolName}` };
    }
    const durationMs = Date.now() - startTime;
    try {
      db.prepare('INSERT INTO telemetry_tool_usage (id, user_id, session_id, conversation_id, tool_name, success, duration_ms, error_message, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), userId, '', req.body.conversationId || '', toolName, result.success ? 1 : 0, durationMs, result.error || null, Date.now());
    } catch {}
    res.json(result);
  } catch (error) {
    console.error('[ToolExecutor] Error:', error.message);
    sendError(res, 500, error.message);
  }
});

// ============================================================================
// CAPABILITIES ENDPOINT
// ============================================================================

app.get('/api/capabilities', requireAuth, (req, res) => {
  // Admin users get admin-level access (every ability maxed out)
  const plan = req.user.isAdmin ? 'admin' : (req.user.plan || 'free');
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  res.json({
    canChat: true,
    canWebSearch: !!process.env.BRAVE_API_KEY,
    canWebFetch: true,
    canMemory: true,
    canExecuteCode: limits.codeLabEnabled,
    canFileExplore: limits.codeLabEnabled,
    canGitOps: limits.codeLabEnabled,
    canImageGen: !!process.env.OPENAI_API_KEY && limits.imageStudioEnabled,
    canTBWO: limits.tbwoEnabled,
    canComputerUse: limits.computerUse,
    canHardwareMonitor: false,
    canBlender: false,
    canSiteDeploy: !!limits.sitesEnabled && (cfR2.isConfigured || cfDeploy.isConfigured),
    canCfImages: !!limits.cfImagesEnabled && cfImages.isConfigured,
    canCfStream: !!limits.cfStreamEnabled && cfStream.isConfigured,
    canVectorize: !!limits.vectorizeEnabled && cfVectorize.isConfigured,
    canSites: !!limits.sitesEnabled,
    sitesDomain: 'alinai.dev',
    plan,
    limits: {
      messagesPerHour: limits.messagesPerHour,
      maxConversations: limits.maxConversations,
      maxTokens: limits.maxTokens,
      allowedModels: limits.allowedModels,
    },
  });
});

// ============================================================================
// AUDIT TRACKING HELPER
// ============================================================================

function recordAuditEntry(userId, model, inputTokens, outputTokens, source) {
  try {
    const costs = {
      'claude-opus-4-6': { input: 15, output: 75 },
      'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    };
    const rate = costs[model] || { input: 3, output: 15 };
    const cost = ((inputTokens / 1000000) * rate.input) + ((outputTokens / 1000000) * rate.output);
    db.prepare('INSERT INTO audit_entries (id, conversation_id, message_id, model, tokens_prompt, tokens_completion, tokens_total, cost, tools_used, duration_ms, timestamp, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), '', '', model, inputTokens, outputTokens, inputTokens + outputTokens, cost, '[]', 0, Date.now(), userId);
  } catch (err) { console.warn('[Audit] Failed:', err.message); }
}

// ============================================================================
// 3D ASSET ENDPOINTS
// ============================================================================

const ASSETS_DIR = path.join(__dirname, 'data', 'assets');

// Upload .glb asset
app.post('/api/assets/upload', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const originalName = req.file.originalname || 'model.glb';
    if (!originalName.toLowerCase().endsWith('.glb')) {
      fsSync.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Only .glb files are accepted' });
    }

    // Validate magic bytes (glTF binary starts with "glTF")
    const fd = fsSync.openSync(req.file.path, 'r');
    const magic = Buffer.alloc(4);
    fsSync.readSync(fd, magic, 0, 4, 0);
    fsSync.closeSync(fd);
    if (magic.toString('ascii') !== 'glTF') {
      fsSync.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid GLB file (bad magic bytes)' });
    }

    // Size check (15MB pro, 50MB elite/admin)
    const user = req.user;
    const maxSize = (user?.plan === 'elite' || user?.isAdmin) ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
    if (req.file.size > maxSize) {
      fsSync.unlinkSync(req.file.path);
      return res.status(400).json({ error: `File too large (max ${maxSize / 1024 / 1024}MB for your plan)` });
    }

    // Move to assets dir
    fsSync.mkdirSync(ASSETS_DIR, { recursive: true });
    const assetId = randomUUID();
    const destPath = path.join(ASSETS_DIR, `${assetId}.glb`);
    fsSync.renameSync(req.file.path, destPath);

    res.json({
      id: assetId,
      name: originalName.replace('.glb', ''),
      polycount: 0, // Would need a GLB parser to compute
      url: `/api/assets/${assetId}`,
    });
  } catch (err) {
    console.error('[Assets] Upload error:', err);
    if (req.file?.path && fsSync.existsSync(req.file.path)) fsSync.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Serve uploaded .glb asset
app.get('/api/assets/:id', requireAuth, (req, res) => {
  const filePath = path.join(ASSETS_DIR, `${req.params.id}.glb`);
  if (!fsSync.existsSync(filePath)) return res.status(404).json({ error: 'Asset not found' });
  res.set('Content-Type', 'model/gltf-binary');
  res.sendFile(filePath);
});

// List user's uploaded assets
app.get('/api/assets', requireAuth, (req, res) => {
  try {
    if (!fsSync.existsSync(ASSETS_DIR)) return res.json([]);
    const files = fsSync.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.glb'));
    const assets = files.map(f => ({
      id: f.replace('.glb', ''),
      name: f.replace('.glb', ''),
      url: `/api/assets/${f.replace('.glb', '')}`,
    }));
    res.json(assets);
  } catch (err) {
    console.error('[Assets] List error:', err);
    res.status(500).json({ error: 'Failed to list assets' });
  }
});

// ============================================================================
// R2 DEPLOY + FILE ROUTES
// ============================================================================

// --- Deploy via R2 (explicit R2 deploy endpoint) ---
app.post('/api/sites/:siteId/deploy-r2', requireAuth, deployLimiter, async (req, res) => {
  try {
    const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
    if (!limits.sitesEnabled) {
      return res.status(403).json({ error: 'Site deployment not available on your plan', code: 'SITES_DISABLED' });
    }
    const userId = req.user.id;
    const site = stmts.getSite.get(req.params.siteId, userId);
    if (!site) return sendError(res, 404, 'Site not found');
    if (!cfR2.isConfigured) return sendError(res, 503, 'R2 storage not configured');

    const siteDir = site.storage_path;
    if (!siteDir) return sendError(res, 400, 'No site files found');

    const deployId = randomUUID();
    const now = Date.now();
    const cfProjectName = site.cloudflare_project_name ||
      site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);

    stmts.insertDeployment.run(deployId, site.id, userId, cfProjectName, null, null, 'queued', null, null, now);
    res.json({ success: true, deployment: { id: deployId, status: 'queued' } });

    const emitter = createDeployEmitter(deployId);

    // Async deploy
    (async () => {
      try {
        emitDeployEvent(deployId, 'status', { step: 'building', message: 'Building static site...' });
        stmts.updateDeploymentStatus.run('building', null, null, null, null, deployId, userId);
        const { outputDir, buildLog } = await buildStaticSite(siteDir, (step, detail) => {
          emitDeployEvent(deployId, 'status', { step, message: step === 'installing' ? 'Installing dependencies...' : step === 'compiling' ? 'Running build command...' : step === 'built' ? `Build complete. Output: ${detail?.outputDir || 'dist'}/` : step });
        });

        emitDeployEvent(deployId, 'status', { step: 'uploading', message: 'Uploading to R2...' });
        stmts.updateDeploymentStatus.run('deploying', null, null, buildLog, null, deployId, userId);
        const latestRow = stmts.getLatestVersion.get(site.id, userId);
        const nextVersion = latestRow ? latestRow.version + 1 : 1;
        const r2Result = await cfR2.deploySite(site.id, outputDir, nextVersion);
        const subdomain = cfProjectName;
        const liveUrl = `https://${subdomain}.alinai.dev`;

        emitDeployEvent(deployId, 'status', { step: 'registering', message: 'Registering domain...' });
        if (cfKV.isConfigured) {
          await cfKV.registerDomain(subdomain, userId, site.id, nextVersion);
          await cfKV.setActiveVersion(site.id, nextVersion, deployId);
        }

        stmts.insertSiteVersion.run(randomUUID(), site.id, userId, nextVersion, r2Result.fileCount, r2Result.totalBytes, deployId, Date.now());
        stmts.updateDeploymentStatus.run('success', deployId, liveUrl, buildLog, null, deployId, userId);
        stmts.updateSite.run(site.name, 'deployed', cfProjectName, liveUrl, site.manifest, Date.now(), site.id, userId);
        emitDeployEvent(deployId, 'status', { step: 'success', message: `Live at ${liveUrl}`, url: liveUrl, fileCount: r2Result.fileCount });
        emitDeployEvent(deployId, 'done', {});
        cleanupDeployEmitter(deployId);
        console.log(`[Deploy-R2] Site ${site.id} v${nextVersion}: ${liveUrl}`);
      } catch (err) {
        console.error(`[Deploy-R2] Failed:`, err.message);
        stmts.updateDeploymentStatus.run('failed', null, null, null, err.message, deployId, userId);
        emitDeployEvent(deployId, 'error', { message: err.message });
        emitDeployEvent(deployId, 'done', {});
        cleanupDeployEmitter(deployId);
      }
    })();
  } catch (error) { sendError(res, 500, error.message); }
});

// --- List site files (from R2) ---
app.get('/api/sites/:siteId/files', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const site = stmts.getSite.get(req.params.siteId, userId);
    if (!site) return sendError(res, 404, 'Site not found');

    const versionRow = stmts.getLatestVersion.get(site.id, userId);
    if (!versionRow) return res.json({ success: true, files: [], version: 0 });

    const files = await cfR2.listSiteFiles(site.id, versionRow.version);
    res.json({ success: true, files, version: versionRow.version });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Get a specific site file (from R2) ---
app.get('/api/sites/:siteId/files/*', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const site = stmts.getSite.get(req.params.siteId, userId);
    if (!site) return sendError(res, 404, 'Site not found');

    const versionRow = stmts.getLatestVersion.get(site.id, userId);
    if (!versionRow) return sendError(res, 404, 'No versions found');

    const filePath = req.params[0];
    const file = await cfR2.getSiteFile(site.id, versionRow.version, filePath);
    if (!file) return sendError(res, 404, 'File not found');

    res.setHeader('Content-Type', file.contentType);
    res.send(file.buffer);
  } catch (error) { sendError(res, 500, error.message); }
});

// --- List site versions ---
app.get('/api/sites/:siteId/versions', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const versions = stmts.listSiteVersions.all(req.params.siteId, req.user.id, limit);
    res.json({ success: true, versions });
  } catch (error) { sendError(res, 500, error.message); }
});

// --- Rollback to a previous version ---
app.post('/api/sites/:siteId/rollback/:version', requireAuth, deployLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const site = stmts.getSite.get(req.params.siteId, userId);
    if (!site) return sendError(res, 404, 'Site not found');

    const targetVersion = parseInt(req.params.version);
    if (isNaN(targetVersion) || targetVersion < 1) return sendError(res, 400, 'Invalid version number');

    // Verify version exists
    const versions = stmts.listSiteVersions.all(site.id, userId, 100);
    const versionExists = versions.some(v => v.version === targetVersion);
    if (!versionExists) return sendError(res, 404, 'Version not found');

    const deployId = randomUUID();
    const cfProjectName = site.cloudflare_project_name ||
      site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);
    const subdomain = cfProjectName;

    if (cfKV.isConfigured) {
      await cfKV.setActiveVersion(site.id, targetVersion, deployId);
      await cfKV.registerDomain(subdomain, userId, site.id, targetVersion);
    }

    const liveUrl = `https://${subdomain}.alinai.dev`;
    stmts.insertDeployment.run(deployId, site.id, userId, cfProjectName, deployId, liveUrl, 'success', `Rollback to v${targetVersion}`, null, Date.now());
    stmts.updateSite.run(site.name, 'deployed', cfProjectName, liveUrl, site.manifest, Date.now(), site.id, userId);

    res.json({ success: true, deployment: { id: deployId, version: targetVersion, url: liveUrl, status: 'success' } });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// CLOUDFLARE IMAGES ROUTES
// ============================================================================

app.post('/api/images/cf/upload', requireAuth, mediaUploadLimiter, upload.single('image'), async (req, res) => {
  try {
    const userId = req.user.id;
    const plan = req.user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    if (!limits.cfImagesEnabled) return sendError(res, 403, 'CF Images not available on your plan');

    if (!req.file) return sendError(res, 400, 'No image file uploaded');
    if (!cfImages.isConfigured) return sendError(res, 503, 'CF Images not configured');

    const buffer = await fs.readFile(req.file.path);
    const result = await cfImages.upload(buffer, req.file.originalname, {
      userId,
      siteId: req.body.siteId || null,
    });

    // Clean up temp file
    try { await fs.unlink(req.file.path); } catch {}

    const id = randomUUID();
    const deliveryUrl = cfImages.getDeliveryUrl(result.id, 'public');
    stmts.insertCfImage.run(
      id, userId, result.id, result.filename,
      deliveryUrl, JSON.stringify(result.variants),
      JSON.stringify({ siteId: req.body.siteId }), req.body.siteId || null, Date.now()
    );

    res.json({
      success: true,
      image: {
        id, cfImageId: result.id, filename: result.filename,
        url: deliveryUrl, variants: result.variants,
      },
    });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/images/cf', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const rows = stmts.listCfImages.all(req.user.id, limit);
    const images = rows.map(r => ({
      ...r,
      variants: r.variants ? JSON.parse(r.variants) : [],
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    }));
    res.json({ success: true, images });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/images/cf/:imageId', requireAuth, async (req, res) => {
  try {
    const row = stmts.getCfImage.get(req.params.imageId, req.user.id);
    if (!row) return sendError(res, 404, 'Image not found');

    if (cfImages.isConfigured) {
      try { await cfImages.delete(row.cf_image_id); } catch (e) { console.warn('[CF Images] Delete failed:', e.message); }
    }
    stmts.deleteCfImage.run(req.params.imageId, req.user.id);
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// CLOUDFLARE STREAM ROUTES
// ============================================================================

app.post('/api/videos/upload-url', requireAuth, mediaUploadLimiter, async (req, res) => {
  try {
    const plan = req.user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    if (!limits.cfStreamEnabled) return sendError(res, 403, 'CF Stream not available on your plan');
    if (limits.maxCfVideos >= 0) {
      const used = getQuotaCount(req.user.id, 'video_uploads');
      if (used >= limits.maxCfVideos) {
        return res.status(429).json({ error: 'Monthly video upload limit reached', used, limit: limits.maxCfVideos, code: 'VIDEO_QUOTA_EXCEEDED' });
      }
    }
    if (!cfStream.isConfigured) return sendError(res, 503, 'CF Stream not configured');

    const result = await cfStream.getDirectUploadUrl(
      req.body.maxDurationSeconds || 3600,
      { userId: req.user.id, siteId: req.body.siteId }
    );

    const id = randomUUID();
    stmts.insertCfVideo.run(
      id, req.user.id, result.uid, 'uploading',
      null, null, null, JSON.stringify({ siteId: req.body.siteId }),
      req.body.siteId || null, Date.now()
    );

    incrementQuota(req.user.id, 'video_uploads');
    res.json({ success: true, video: { id, uid: result.uid, uploadUrl: result.uploadUrl } });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/videos/upload-from-url', requireAuth, mediaUploadLimiter, async (req, res) => {
  try {
    const plan = req.user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    if (!limits.cfStreamEnabled) return sendError(res, 403, 'CF Stream not available on your plan');
    if (limits.maxCfVideos >= 0) {
      const used = getQuotaCount(req.user.id, 'video_uploads');
      if (used >= limits.maxCfVideos) {
        return res.status(429).json({ error: 'Monthly video upload limit reached', used, limit: limits.maxCfVideos, code: 'VIDEO_QUOTA_EXCEEDED' });
      }
    }
    if (!cfStream.isConfigured) return sendError(res, 503, 'CF Stream not configured');
    if (!req.body.url) return sendError(res, 400, 'url is required');

    const result = await cfStream.uploadFromUrl(req.body.url, {
      userId: req.user.id,
      siteId: req.body.siteId,
    });

    const id = randomUUID();
    stmts.insertCfVideo.run(
      id, req.user.id, result.uid, result.status,
      result.thumbnail || null, result.preview || null,
      result.duration || null, JSON.stringify({ siteId: req.body.siteId }),
      req.body.siteId || null, Date.now()
    );

    incrementQuota(req.user.id, 'video_uploads');
    res.json({ success: true, video: { id, uid: result.uid, status: result.status } });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/videos/:videoId', requireAuth, async (req, res) => {
  try {
    const row = stmts.getCfVideo.get(req.params.videoId, req.user.id);
    if (!row) return sendError(res, 404, 'Video not found');

    // Refresh status from CF if not ready
    if (row.status !== 'ready' && cfStream.isConfigured) {
      try {
        const cfVideo = await cfStream.getVideo(row.cf_uid);
        if (cfVideo) {
          stmts.updateCfVideo.run(
            cfVideo.status, cfVideo.thumbnail || row.thumbnail,
            cfVideo.preview || row.preview, cfVideo.duration || row.duration,
            row.id, req.user.id
          );
          row.status = cfVideo.status;
          row.thumbnail = cfVideo.thumbnail || row.thumbnail;
          row.preview = cfVideo.preview || row.preview;
          row.duration = cfVideo.duration || row.duration;
        }
      } catch {}
    }

    res.json({ success: true, video: { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : {} } });
  } catch (error) { sendError(res, 500, error.message); }
});

app.delete('/api/videos/:videoId', requireAuth, async (req, res) => {
  try {
    const row = stmts.getCfVideo.get(req.params.videoId, req.user.id);
    if (!row) return sendError(res, 404, 'Video not found');

    if (cfStream.isConfigured) {
      try { await cfStream.delete(row.cf_uid); } catch (e) { console.warn('[CF Stream] Delete failed:', e.message); }
    }
    stmts.deleteCfVideo.run(req.params.videoId, req.user.id);
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/videos/:videoId/embed', requireAuth, (req, res) => {
  try {
    const row = stmts.getCfVideo.get(req.params.videoId, req.user.id);
    if (!row) return sendError(res, 404, 'Video not found');

    res.json({
      success: true,
      embedUrl: cfStream.getEmbedUrl(row.cf_uid),
      embedHtml: cfStream.getEmbedHtml(row.cf_uid),
    });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// THREAD / VECTORIZE ROUTES
// ============================================================================

app.post('/api/threads/ingest', requireAuth, threadIngestLimiter, async (req, res) => {
  try {
    const plan = req.user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    if (!limits.vectorizeEnabled) return sendError(res, 403, 'Vectorize not available on your plan');
    if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');

    const { text, threadId: providedThreadId } = req.body;
    if (!text || typeof text !== 'string') return sendError(res, 400, 'text is required');

    const threadId = providedThreadId || randomUUID();
    const userId = req.user.id;

    // Chunk + embed + upsert
    const result = await cfVectorize.ingestThread(threadId, text, userId);

    // Store chunks in DB
    const now = Date.now();
    for (const chunk of result.chunks) {
      stmts.insertThreadChunk.run(
        randomUUID(), threadId, userId, chunk.index,
        chunk.content, null, chunk.tokenCount,
        `${threadId}-chunk-${chunk.index}`, null, now
      );
    }

    res.json({
      success: true,
      threadId,
      chunkCount: result.chunkCount,
      chunks: result.chunks.map(c => ({
        index: c.index,
        tokenCount: c.tokenCount,
        preview: c.content.slice(0, 200),
      })),
    });
  } catch (error) { sendError(res, 500, error.message); }
});

app.get('/api/threads', requireAuth, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const threads = stmts.listUserThreads.all(req.user.id, limit);
    res.json({ success: true, threads });
  } catch (error) { sendError(res, 500, error.message); }
});

app.post('/api/memory/semantic-search', requireAuth, async (req, res) => {
  try {
    if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');
    const { query, topK } = req.body;
    if (!query) return sendError(res, 400, 'query is required');

    const results = await cfVectorize.searchMemory(query, req.user.id, topK || 10);
    res.json({ success: true, results });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// VECTORIZE — TBWO Context Chunking
// ============================================================================

// POST /api/vectorize/ingest — Chunk and embed arbitrary text for TBWO context
app.post('/api/vectorize/ingest', requireAuth, async (req, res) => {
  try {
    if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');
    const { text, metadata = {} } = req.body;
    if (!text) return sendError(res, 400, 'text is required');

    const chunks = cfVectorize.chunkText(text, 500, 50);
    const vectors = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await cfVectorize.embedText(chunks[i]);
      if (embedding) {
        vectors.push({
          id: `ctx-${Date.now()}-${i}`,
          values: embedding,
          metadata: { ...metadata, chunk_index: i, content: chunks[i].slice(0, 500), user_id: req.user.id },
        });
      }
    }
    if (vectors.length > 0) {
      await cfVectorize.upsert('content', vectors);
    }
    res.json({ success: true, chunkCount: chunks.length, vectorCount: vectors.length });
  } catch (error) { sendError(res, 500, error.message); }
});

// POST /api/vectorize/search-context — Search for relevant context chunks
app.post('/api/vectorize/search-context', requireAuth, async (req, res) => {
  try {
    if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');
    const { query, topK = 5 } = req.body;
    if (!query) return sendError(res, 400, 'query is required');

    const results = await cfVectorize.searchContent(query, req.user.id, topK);
    res.json({ success: true, chunks: results });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// R2 — User Asset Management
// ============================================================================

// GET /api/assets/:filename — Get a user's uploaded asset (R2 backend)
app.get('/api/assets/:filename', requireAuth, async (req, res) => {
  try {
    if (!cfR2 || !cfR2.isConfigured) return sendError(res, 503, 'R2 not configured');
    const result = await cfR2.getAsset(req.user.id, req.params.filename);
    if (!result) return res.status(404).json({ error: 'Asset not found' });
    res.set('Content-Type', result.contentType || 'application/octet-stream');
    res.send(result.body);
  } catch (error) { sendError(res, 500, error.message); }
});

// DELETE /api/sites/:siteId/versions/:version — Delete old site version from R2
app.delete('/api/sites/:siteId/versions/:version', requireAuth, async (req, res) => {
  try {
    if (!cfR2 || !cfR2.isConfigured) return sendError(res, 503, 'R2 not configured');
    await cfR2.deleteSiteVersion(req.params.siteId, parseInt(req.params.version));
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// KV — Domain Management
// ============================================================================

// GET /api/sites/domain/:subdomain — Check domain availability
app.get('/api/sites/domain/:subdomain', requireAuth, async (req, res) => {
  try {
    if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
    const info = await cfKV.lookupDomain(req.params.subdomain);
    res.json({ success: true, available: !info, info: info || null });
  } catch (error) { sendError(res, 500, error.message); }
});

// DELETE /api/sites/domain/:subdomain — Remove domain registration
app.delete('/api/sites/domain/:subdomain', requireAuth, async (req, res) => {
  try {
    if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
    await cfKV.unregisterDomain(req.params.subdomain);
    res.json({ success: true });
  } catch (error) { sendError(res, 500, error.message); }
});

// GET /api/sites/:siteId/version-info — Get active version info from KV
app.get('/api/sites/:siteId/version-info', requireAuth, async (req, res) => {
  try {
    if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
    const info = await cfKV.getVersionInfo(req.params.siteId);
    res.json({ success: true, info: info || null });
  } catch (error) { sendError(res, 500, error.message); }
});

// GET /api/kv/list — Admin KV browser
app.get('/api/kv/list', requireAuth, async (req, res) => {
  try {
    if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
    const { prefix, limit, cursor } = req.query;
    const result = await cfKV.list(prefix || '', parseInt(limit) || 1000, cursor || undefined);
    res.json({ success: true, ...result });
  } catch (error) { sendError(res, 500, error.message); }
});

// ============================================================================
// CF Images — Gallery & URL Upload
// ============================================================================

// POST /api/images/from-url — Import image from URL
app.post('/api/images/from-url', requireAuth, async (req, res) => {
  try {
    if (!cfImages || !cfImages.isConfigured) return sendError(res, 503, 'CF Images not configured');
    const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
    if (limits.maxCfImages >= 0) {
      const used = getQuotaCount(req.user.id, 'image_generations');
      if (used >= limits.maxCfImages) {
        return res.status(429).json({ error: 'Monthly image generation limit reached', used, limit: limits.maxCfImages, code: 'IMAGE_QUOTA_EXCEEDED' });
      }
    }
    const { url, metadata = {} } = req.body;
    if (!url) return sendError(res, 400, 'url is required');

    const result = await cfImages.uploadFromUrl(url, { ...metadata, userId: req.user.id });
    // Store in DB
    db.prepare(`INSERT INTO cf_images (id, user_id, cf_image_id, filename, url, variants, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), req.user.id, result.id, url.split('/').pop() || 'image',
      result.variants?.[0] || '', JSON.stringify(result.variants || []),
      JSON.stringify(metadata), Date.now()
    );
    incrementQuota(req.user.id, 'image_generations');
    res.json({ success: true, image: result });
  } catch (error) { sendError(res, 500, error.message); }
});


// ============================================================================
// CF Stream — Video Gallery
// ============================================================================

// GET /api/videos/list — List uploaded videos
app.get('/api/videos/list', requireAuth, async (req, res) => {
  try {
    if (!cfStream || !cfStream.isConfigured) return sendError(res, 503, 'CF Stream not configured');
    const limit = parseInt(req.query.limit) || 50;
    const result = await cfStream.list(limit);
    res.json({ success: true, videos: result });
  } catch (error) { sendError(res, 500, error.message); }
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
  console.log(`  Database: SQLite at ${dbPath}`);
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
