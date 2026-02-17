/**
 * File Watcher endpoints
 * /api/files/watch, /api/files/changes
 */
import path from 'path';
import fsSync from 'node:fs';

export function registerFileWatcherRoutes(ctx) {
  const { app, requireAuth, ALLOWED_DIRS, activeWatchers } = ctx;

  app.post('/api/files/watch', requireAuth, (req, res) => {
    try {
      const { path: watchPath, extensions } = req.body;
      if (!watchPath) return res.status(400).json({ success: false, error: 'Path required' });

      const resolved = path.resolve(watchPath);
      const allowed = ALLOWED_DIRS.some(d => resolved.startsWith(d));
      if (!allowed) return res.status(403).json({ success: false, error: 'Directory not allowed' });

      if (activeWatchers.has(resolved)) {
        return res.json({ success: true, message: 'Already watching', path: resolved });
      }

      const changes = [];
      const extFilter = extensions ? extensions.map(e => e.toLowerCase()) : null;

      const watcher = fsSync.watch(resolved, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (extFilter) {
          const ext = path.extname(filename).toLowerCase();
          if (!extFilter.includes(ext)) return;
        }
        if (/node_modules|\.git[\/\\]|dist[\/\\]/.test(filename)) return;

        changes.push({
          type: eventType,
          file: filename,
          timestamp: Date.now(),
        });
        if (changes.length > 100) changes.splice(0, changes.length - 100);
      });

      activeWatchers.set(resolved, { watcher, changes });
      res.json({ success: true, path: resolved, message: 'Watcher started' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/files/changes', requireAuth, (req, res) => {
    const watchPath = req.query.path;
    if (!watchPath) {
      const allChanges = [];
      for (const [wp, { changes }] of activeWatchers.entries()) {
        allChanges.push(...changes.map(c => ({ ...c, watchPath: wp })));
      }
      allChanges.sort((a, b) => b.timestamp - a.timestamp);
      return res.json({ success: true, changes: allChanges.slice(0, 50) });
    }

    const resolved = path.resolve(watchPath);
    const entry = activeWatchers.get(resolved);
    if (!entry) return res.json({ success: true, changes: [], watching: false });

    const since = parseInt(req.query.since) || 0;
    const filtered = since > 0
      ? entry.changes.filter(c => c.timestamp > since)
      : entry.changes.slice(-20);

    res.json({ success: true, changes: filtered, watching: true });
  });

  app.delete('/api/files/watch', requireAuth, (req, res) => {
    const watchPath = req.body?.path || req.query.path;
    if (!watchPath) return res.status(400).json({ success: false, error: 'Path required' });

    const resolved = path.resolve(watchPath);
    const entry = activeWatchers.get(resolved);
    if (entry) {
      entry.watcher.close();
      activeWatchers.delete(resolved);
    }
    res.json({ success: true, message: 'Watcher stopped' });
  });
}
