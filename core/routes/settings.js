/**
 * Settings endpoints
 * /api/settings — get all, upsert key
 * /api/settings/local-model/test — test local model connectivity
 */

export function registerSettingsRoutes(ctx) {
  const { app, stmts, requireAuth, sendError } = ctx;

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

  // ── Test local model connection ──
  app.get('/api/settings/local-model/test', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;

      // Read stored settings
      const allSettings = {};
      stmts.getAllSettings.all(userId).forEach(s => {
        try { allSettings[s.key] = JSON.parse(s.value); } catch { allSettings[s.key] = s.value; }
      });

      const endpoint = allSettings.local_model_endpoint || req.query.endpoint;
      const modelName = allSettings.local_model_name || req.query.model || 'llama3.2:latest';

      if (!endpoint) {
        return res.json({ connected: false, error: 'No local model endpoint configured. Set it in Settings → Models.' });
      }

      // Normalize endpoint
      let completionsUrl = endpoint.replace(/\/+$/, '');
      if (!completionsUrl.endsWith('/chat/completions')) {
        completionsUrl = completionsUrl.replace(/\/v1\/?$/, '') + '/v1/chat/completions';
      }

      const startTime = Date.now();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      let response;
      try {
        response = await fetch(completionsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
            max_tokens: 10,
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
      } catch (err) {
        clearTimeout(timeout);
        const isAbort = err.name === 'AbortError';
        return res.json({
          connected: false,
          error: isAbort
            ? 'Connection timed out after 10 seconds.'
            : 'Could not connect to your local model. Make sure Ollama or LM Studio is running at the specified endpoint.',
          details: err.message,
        });
      }

      const latency = Date.now() - startTime;

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return res.json({
          connected: false,
          error: `Local model returned HTTP ${response.status}`,
          details: text.slice(0, 500),
          latency,
        });
      }

      const data = await response.json().catch(() => null);
      const returnedModel = data?.model || data?.choices?.[0]?.message?.model || modelName;

      res.json({
        connected: true,
        modelName: returnedModel,
        latency,
        endpoint,
      });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}
