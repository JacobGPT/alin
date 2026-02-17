/**
 * ALIN Server Middleware
 * Auth middleware, error helpers, SSE helpers.
 */
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

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
  console.warn('\n\u26a0\ufe0f  [Security] WARNING: Using default JWT_SECRET. Set JWT_SECRET env var for production.\n');
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Production CORS validation
if (IS_PRODUCTION && !process.env.CORS_ORIGIN) {
  console.error('[FATAL] CORS_ORIGIN must be set in production (e.g., CORS_ORIGIN=https://yourdomain.com)');
  process.exit(1);
}

export { JWT_SECRET, JWT_EXPIRES_IN, IS_PRODUCTION };

/**
 * Create auth middleware functions.
 * @param {object} db - SQLite database instance
 * @param {Set} revokedTokens - In-memory revocation blocklist
 */
export function createAuthMiddleware(db, revokedTokens) {
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

  function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    next();
  }

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

  return { requireAuth, optionalAuth, requireAdmin, requireAuthOrToken };
}

/**
 * Standardized error response helper.
 * In production, strips internal details from 500 errors.
 */
export function createSendError(db) {
  return function sendError(res, status, error, code, suggestion) {
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
  };
}

/**
 * Safe JSON parse — returns fallback on failure instead of throwing.
 */
export function safeJsonParse(str, fallback = null) {
  if (!str || typeof str !== 'string') return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * SSE setup helper — sets headers and starts heartbeat.
 */
export function setupSSE(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  // Keep-alive heartbeat every 15s to prevent proxy/LB timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 15_000);
  res.on('close', () => clearInterval(heartbeat));
}

/**
 * SSE event sender — includes type field in data for client compatibility.
 */
export function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}
