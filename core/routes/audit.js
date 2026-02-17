/**
 * Audit entry endpoints
 * /api/audit — list, create, prune
 */
import { randomUUID } from 'crypto';

export function registerAuditRoutes(ctx) {
  const { app, stmts, requireAuth, sendError, incrementQuota } = ctx;

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
}
