/**
 * Settings endpoints
 * /api/settings — get all, upsert key
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
}
