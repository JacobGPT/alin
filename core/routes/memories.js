/**
 * Memory CRUD endpoints
 * /api/memories — list, create, update, delete
 */
import { randomUUID } from 'crypto';

export function registerMemoryRoutes(ctx) {
  const { app, stmts, requireAuth, sendError } = ctx;

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
}
