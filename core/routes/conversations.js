/**
 * Conversation and Message CRUD endpoints
 * /api/conversations — list, create, get, update, delete, search
 * /api/messages — update, delete
 * /api/conversations/:id/messages — add message
 */
import { randomUUID } from 'crypto';

export function registerConversationRoutes(ctx) {
  const { app, db, stmts, requireAuth, sendError, DEFAULT_MODELS } = ctx;

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

  // Message endpoints
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
    try {
      const userId = req.user.id;
      const messageId = req.params.id;

      // Capture original content before edit for training data collection
      let originalContent = null;
      try {
        const original = stmts.getMessageById.get(messageId, userId);
        if (original && original.role === 'assistant') {
          originalContent = original.content;
        }
      } catch {}

      stmts.updateMessage.run(JSON.stringify(req.body.content), JSON.stringify(req.body.metadata || {}), messageId, userId);

      // Silent training data collection — fire-and-forget (only for assistant message edits)
      if (originalContent) {
        try {
          ctx.trainingData?.collectCorrection?.({
            userId,
            messageId,
            originalContent,
            editedContent: req.body.content,
            model: req.body.metadata?.model || '',
          });
        } catch {}
      }

      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.delete('/api/messages/:id', requireAuth, (req, res) => {
    try { stmts.deleteMessage.run(req.params.id, req.user.id); res.json({ success: true }); }
    catch (error) { sendError(res, 500, error.message); }
  });
}
