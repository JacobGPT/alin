/**
 * ALIN Server Context
 * Creates the shared ctx object that every route module receives.
 */
import path from 'path';
import os from 'os';
import fsSync from 'node:fs';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { EventEmitter } from 'events';
import { Resend } from 'resend';
import { CloudflarePagesDeploy } from '../services/cloudflarePagesDeploy.js';
import { CloudflareR2 } from '../services/cloudflareR2.js';
import { CloudflareKV } from '../services/cloudflareKV.js';
import { CloudflareImages } from '../services/cloudflareImages.js';
import { CloudflareStream } from '../services/cloudflareStream.js';
import { CloudflareVectorize } from '../services/cloudflareVectorize.js';
import { createAuthMiddleware, createSendError, safeJsonParse, setupSSE, sendSSE, JWT_SECRET, JWT_EXPIRES_IN, IS_PRODUCTION } from './middleware.js';
import { DEFAULT_MODELS, PLAN_LIMITS, MODEL_METADATA, createCheckPlanLimits, getCurrentPeriod, getQuotaCount, incrementQuota } from './config.js';

/**
 * Create the full server context object.
 * Every route module destructures what it needs from `ctx`.
 */
export function createServerContext({ db, stmts, app, rootDir }) {
  // ── Cloudflare Clients ──
  const cfDeploy = new CloudflarePagesDeploy();
  const cfR2 = new CloudflareR2();
  const cfKV = new CloudflareKV();
  const cfImages = new CloudflareImages();
  const cfStream = new CloudflareStream();
  const cfVectorize = new CloudflareVectorize();

  // ── Shared State (Maps + Sets) ──
  const deployEvents = new Map();
  const revokedTokens = new Set();
  const tbwoWorkspaces = new Map();
  const briefCache = new Map();
  const editHistory = new Map();
  const activeWatchers = new Map();
  const userWorkspaces = new Map();

  // ── Deploy Event Helpers ──
  function emitDeployEvent(deployId, event, data) {
    const emitter = deployEvents.get(deployId);
    if (emitter) emitter.emit('progress', { event, ...data, timestamp: Date.now() });
  }
  function createDeployEmitter(deployId) {
    const emitter = new EventEmitter();
    deployEvents.set(deployId, emitter);
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

  // ── Periodically prune revoked tokens (every hour) ──
  setInterval(() => {
    for (const token of revokedTokens) {
      try { jwt.verify(token, JWT_SECRET); } catch { revokedTokens.delete(token); }
    }
  }, 60 * 60 * 1000);

  // ── Auth Middleware ──
  const { requireAuth, optionalAuth, requireAdmin, requireAuthOrToken } = createAuthMiddleware(db, revokedTokens);
  const sendError = createSendError(db);
  const checkPlanLimits = createCheckPlanLimits(db, stmts);

  // ── Rate Limiters ──
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
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
    windowMs: 60 * 1000,
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
  const deployLimiter = rateLimit({ windowMs: 60_000, max: 5, keyGenerator: (req) => req.user?.id || 'anon', validate: false });
  const mediaUploadLimiter = rateLimit({ windowMs: 60_000, max: 20, keyGenerator: (req) => req.user?.id || 'anon', validate: false });
  const threadIngestLimiter = rateLimit({ windowMs: 60_000, max: 10, keyGenerator: (req) => req.user?.id || 'anon', validate: false });

  // ── Allowed Directories ──
  const ALLOWED_DIRS = [
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents'),
    path.join(os.homedir(), 'Desktop'),
    rootDir,
  ];

  // Ensure dedicated output directories exist
  const OUTPUT_DIRS = ['websites', 'blender', 'tbwo', 'images', 'projects', 'files'];
  for (const dir of OUTPUT_DIRS) {
    const dirPath = path.join(rootDir, 'output', dir);
    if (!fsSync.existsSync(dirPath)) {
      fsSync.mkdirSync(dirPath, { recursive: true });
    }
  }

  // ── Path Security ──
  function isPathAllowed(filePath) {
    const resolvedPath = path.resolve(filePath);
    const normalizedPath = path.normalize(resolvedPath);
    if (normalizedPath.startsWith('\\\\')) return false;
    return ALLOWED_DIRS.some(dir => {
      const normalizedDir = path.normalize(dir);
      return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
    });
  }

  // ── Resend (Email) ──
  const resend = new Resend(process.env.RESEND_API_KEY);

  // ── Sites Data Dir ──
  const SITES_DATA_DIR = path.join(rootDir, 'data', 'sites');

  // ── Bound quota helpers (2-arg signature for backward compat with inline handlers) ──
  const boundGetQuotaCount = (userId, quotaType) => getQuotaCount(stmts, userId, quotaType);
  const boundIncrementQuota = (userId, quotaType) => incrementQuota(stmts, userId, quotaType);

  return {
    // Core
    db, stmts, app, rootDir,

    // Cloudflare
    cfDeploy, cfR2, cfKV, cfImages, cfStream, cfVectorize,

    // Shared state
    deployEvents, revokedTokens, tbwoWorkspaces, briefCache, editHistory, activeWatchers, userWorkspaces,

    // Deploy helpers
    emitDeployEvent, createDeployEmitter, cleanupDeployEmitter,

    // Auth & middleware
    requireAuth, optionalAuth, requireAdmin, requireAuthOrToken, sendError, checkPlanLimits,

    // Rate limiters
    authLimiter, verifyLimiter, executionLimiter, scanLimiter, deployLimiter, mediaUploadLimiter, threadIngestLimiter,

    // Helpers
    safeJsonParse, setupSSE, sendSSE,

    // Config
    DEFAULT_MODELS, PLAN_LIMITS, MODEL_METADATA,
    JWT_SECRET, JWT_EXPIRES_IN, IS_PRODUCTION,
    getCurrentPeriod,
    getQuotaCount: boundGetQuotaCount,
    incrementQuota: boundIncrementQuota,

    // Directories & path security
    ALLOWED_DIRS, SITES_DATA_DIR, isPathAllowed,

    // Services
    resend,
  };
}
