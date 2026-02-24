/**
 * Auth + Admin endpoints
 * /api/auth/* — signup, verify, resend, login, me, profile, change-password, refresh, logout
 * /api/admin/* — bootstrap, users, stats, search, plan, telemetry export, activity, costs
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../middleware/index.js';

export function registerAuthRoutes(ctx) {
  const { app, db, stmts, requireAuth, requireAdmin, sendError, authLimiter, verifyLimiter, revokedTokens, resend } = ctx;

  // ── Email Verification Helper ──
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

  // ── Auth Endpoints ──

  app.post('/api/auth/signup', authLimiter, async (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

      const existing = stmts.getUserByEmail.get(email);
      if (existing && existing.email_verified) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      if (existing && !existing.email_verified) {
        db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
      }

      const id = randomUUID();
      const now = Date.now();
      const passwordHash = await bcrypt.hash(password, 10);

      const userCount = stmts.countUsers.get();
      const plan = userCount.count === 0 ? 'pro' : 'free';
      const isFirstUser = userCount.count === 0;

      const verificationCode = generateVerificationCode();
      const verificationExpires = now + 10 * 60 * 1000;

      stmts.insertUser.run(id, email, passwordHash, displayName || '', plan, isFirstUser ? 1 : 0, now, now);

      db.prepare('UPDATE users SET verification_code = ?, verification_expires = ? WHERE id = ?')
        .run(verificationCode, verificationExpires, id);

      if (isFirstUser) {
        db.prepare('UPDATE users SET email_verified = 1, is_admin = 1 WHERE id = ?').run(id);

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

  app.post('/api/auth/verify', verifyLimiter, async (req, res) => {
    try {
      const { email, code } = req.body;
      if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

      const user = stmts.getUserByEmail.get(email);
      if (!user) return res.status(404).json({ error: 'Account not found' });
      if (user.email_verified) return res.status(400).json({ error: 'Email already verified' });

      if (user.verification_code !== code) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      if (Date.now() > user.verification_expires) {
        return res.status(400).json({ error: 'Verification code expired. Request a new one.' });
      }

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

      if (!user.email_verified) {
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

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) revokedTokens.add(token);
    res.json({ success: true });
  });

  // ── Admin Endpoints ──

  app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, email, display_name, plan, is_admin, created_at FROM users').all();
    res.json({ success: true, users });
  });

  app.post('/api/admin/bootstrap', (req, res) => {
    try {
      const bootstrapToken = process.env.ALIN_BOOTSTRAP_TOKEN;
      const clientIp = req.ip || req.connection?.remoteAddress;
      const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '::ffff:127.0.0.1';

      if (bootstrapToken) {
        const providedToken = req.headers['x-bootstrap-token'] || req.body.token;
        if (providedToken !== bootstrapToken) {
          return res.status(403).json({ error: 'Invalid bootstrap token', code: 'INVALID_TOKEN' });
        }
      } else if (!isLocalhost) {
        return res.status(403).json({ error: 'Bootstrap only allowed from localhost (set ALIN_BOOTSTRAP_TOKEN for remote access)', code: 'LOCALHOST_ONLY' });
      }

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

  // ── Admin Dashboard ──

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

  app.patch('/api/admin/users/:id/plan', requireAuth, requireAdmin, (req, res) => {
    try {
      const { plan } = req.body;
      if (!['free', 'spark', 'pro', 'agency'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan' });
      }
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

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
}
