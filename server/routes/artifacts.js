/**
 * Artifact CRUD endpoints
 * /api/artifacts — list, create, update, delete
 */
import { randomUUID } from 'crypto';

export function registerArtifactRoutes(ctx) {
  const { app, stmts, requireAuth, sendError } = ctx;

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
}
