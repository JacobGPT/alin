/**
 * Miscellaneous endpoints
 * /api/models, /api/specialist, /api/images/list|metadata|:id,
 * /api/keys/status, /api/health, /api/search/brave,
 * /api/claude, /api/memory/store, /api/memory/recall
 */
import { randomUUID } from 'crypto';

export function registerMiscRoutes(ctx) {
  const { app, db, stmts, requireAuth, sendError, DEFAULT_MODELS, PLAN_LIMITS, MODEL_METADATA, getQuotaCount } = ctx;

  // ── Model Listing ──

  app.get('/api/models', requireAuth, (req, res) => {
    const plan = req.user.plan || 'free';
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const allowed = limits.allowedModels || [];

    const models = allowed
      .filter(id => MODEL_METADATA[id])
      .map(id => ({
        id,
        ...MODEL_METADATA[id],
        available: true,
      }));

    const grouped = {};
    for (const m of models) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    }

    const allModels = Object.entries(MODEL_METADATA).map(([id, meta]) => ({
      id,
      ...meta,
      available: allowed.includes(id),
      locked: !allowed.includes(id),
    }));

    res.json({ models, grouped, allModels, plan });
  });

  app.post('/api/specialist', requireAuth, async (req, res) => {
    try {
      const { task, content, options } = req.body;
      if (!task || !content) return res.status(400).json({ error: 'task and content required' });

      // specialistRoute is set on ctx by streaming.js
      const specialistRoute = ctx.specialistRoute;
      if (!specialistRoute) return res.status(501).json({ error: 'Specialist routing not available' });

      const result = await specialistRoute(task, content, options || {});
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Image Metadata ──

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
        b.model || 'flux2-max', b.size || '1024x1024',
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

  // ── API Key Status & Health ──

  app.get('/api/keys/status', requireAuth, (req, res) => {
    res.json({
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      brave: !!(process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY),
    });
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'ALIN Backend Server',
      database: true,
      uptime: process.uptime(),
    });
  });

  // ── Brave Search Proxy ──

  app.post('/api/search/brave', requireAuth, async (req, res) => {
    try {
      const { query, count = 5, apiKey } = req.body;

      if (!query) {
        return res.status(400).json({ error: 'Query is required' });
      }

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

  // ── Claude Proxy (title generation, simple completions) ──

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

  // ── Memory Store/Recall (TBWO execution engine) ──

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

  app.post('/api/memory/recall', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { query, category, limit: maxResults } = req.body;
      if (!query) return res.status(400).json({ error: 'Query required' });

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

  // ── Audit Tracking Helper ──

  function recordAuditEntry(userId, model, inputTokens, outputTokens, source) {
    try {
      const costs = {
        'claude-opus-4-6': { input: 15, output: 75 },
        'claude-sonnet-4-6': { input: 3, output: 15 },
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

  // Expose on ctx for other modules
  ctx.recordAuditEntry = recordAuditEntry;
}
