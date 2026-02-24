/**
 * Memory CRUD endpoints + Proactive Memory Injection
 * /api/memories — list, create, update, delete
 * ctx.proactiveMemory.getContext() — semantic search for relevant memories
 */
import { randomUUID } from 'crypto';

export function registerMemoryRoutes(ctx) {
  const { app, stmts, requireAuth, sendError, cfVectorize } = ctx;

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

  // ══════════════════════════════════════════════════════════════════════════
  // PROACTIVE MEMORY — semantic search for context injection into streaming
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Get proactive context from memory for a given user message.
   * 1. Embed the message using OpenAI text-embedding-3-small (via Vectorize client)
   * 2. Query Cloudflare Vectorize for semantically similar memories (threshold 0.75)
   * 3. Cross-reference with SQLite memory_entries for full content + salience
   * 4. Return top matches sorted by salience × similarity
   *
   * @param {string} userId
   * @param {string} currentMessage - The user's current message text
   * @param {number} limit - Max memories to return (default 5)
   * @returns {Promise<Array<{id, content, salience, similarity, score, layer, tags}>>}
   */
  async function getProactiveContext(userId, currentMessage, limit = 5) {
    // Skip if vectorize not configured or message too short
    if (!cfVectorize?.isConfigured || !currentMessage || currentMessage.length < 10) {
      return [];
    }

    try {
      // 1. Semantic search via Vectorize (embeds query + queries index)
      const vectorResults = await cfVectorize.searchMemory(currentMessage, userId, limit * 2);

      if (!vectorResults || vectorResults.length === 0) return [];

      // 2. Filter by similarity threshold (0.75)
      const SIMILARITY_THRESHOLD = 0.75;
      const relevant = vectorResults.filter(r => r.score >= SIMILARITY_THRESHOLD);

      if (relevant.length === 0) return [];

      // 3. Cross-reference with SQLite for full content + salience
      const enriched = [];
      for (const match of relevant) {
        // Vector ID may be the memory ID directly, or contain it in metadata
        const memoryId = match.metadata?.memoryId || match.metadata?.id || match.id;
        const dbMemory = stmts.getMemory.get(memoryId, userId);

        if (dbMemory && !dbMemory.is_archived) {
          const salience = dbMemory.salience || 0.5;
          const similarity = match.score;
          const combinedScore = salience * similarity;

          enriched.push({
            id: dbMemory.id,
            content: dbMemory.content,
            salience,
            similarity: Math.round(similarity * 1000) / 1000,
            score: Math.round(combinedScore * 1000) / 1000,
            layer: dbMemory.layer,
            tags: JSON.parse(dbMemory.tags || '[]'),
          });

          // Update access count and last_accessed_at (fire-and-forget)
          try {
            const now = Date.now();
            stmts.updateMemory.run(
              dbMemory.layer, dbMemory.content,
              dbMemory.salience, dbMemory.decay_rate,
              (dbMemory.access_count || 0) + 1,
              dbMemory.is_consolidated, dbMemory.is_archived,
              dbMemory.is_pinned, dbMemory.user_modified,
              dbMemory.tags, dbMemory.related_memories,
              dbMemory.edit_history, dbMemory.metadata,
              now, now, dbMemory.id, userId
            );
          } catch {}
        } else if (match.metadata?.preview) {
          // Fallback: use metadata preview from vector if DB entry missing
          enriched.push({
            id: match.id,
            content: match.metadata.preview,
            salience: 0.5,
            similarity: Math.round(match.score * 1000) / 1000,
            score: Math.round(0.5 * match.score * 1000) / 1000,
            layer: match.metadata.layer || 'unknown',
            tags: [],
          });
        }
      }

      // 4. Sort by combined score (salience × similarity) and take top N
      enriched.sort((a, b) => b.score - a.score);
      return enriched.slice(0, limit);
    } catch (e) {
      console.error('[ProactiveMemory] getProactiveContext error:', e.message);
      return [];
    }
  }

  // Expose on ctx for streaming.js to call
  ctx.proactiveMemory = {
    getContext: getProactiveContext,
  };

  console.log(`[Memory] Routes registered (Vectorize ${cfVectorize?.isConfigured ? 'CONFIGURED' : 'NOT CONFIGURED'})`);
}
