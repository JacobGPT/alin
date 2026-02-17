/**
 * 3D Asset + general asset endpoints
 * /api/assets — upload, serve, list
 */
import path from 'path';
import fsSync from 'node:fs';
import { randomUUID } from 'crypto';
import multer from 'multer';

export function registerAssetRoutes(ctx) {
  const { app, requireAuth, cfR2, rootDir } = ctx;

  const ASSETS_DIR = path.join(rootDir, 'data', 'assets');

  const upload = multer({
    dest: path.join(rootDir, 'data', 'assets'),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // Upload .glb asset
  app.post('/api/assets/upload', requireAuth, upload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const originalName = req.file.originalname || 'model.glb';
      if (!originalName.toLowerCase().endsWith('.glb')) {
        fsSync.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Only .glb files are accepted' });
      }

      // Validate magic bytes (glTF binary starts with "glTF")
      const fd = fsSync.openSync(req.file.path, 'r');
      const magic = Buffer.alloc(4);
      fsSync.readSync(fd, magic, 0, 4, 0);
      fsSync.closeSync(fd);
      if (magic.toString('ascii') !== 'glTF') {
        fsSync.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Invalid GLB file (bad magic bytes)' });
      }

      // Size check (15MB pro, 50MB elite/admin)
      const user = req.user;
      const maxSize = (user?.plan === 'elite' || user?.isAdmin) ? 50 * 1024 * 1024 : 15 * 1024 * 1024;
      if (req.file.size > maxSize) {
        fsSync.unlinkSync(req.file.path);
        return res.status(400).json({ error: `File too large (max ${maxSize / 1024 / 1024}MB for your plan)` });
      }

      // Move to assets dir
      fsSync.mkdirSync(ASSETS_DIR, { recursive: true });
      const assetId = randomUUID();
      const destPath = path.join(ASSETS_DIR, `${assetId}.glb`);
      fsSync.renameSync(req.file.path, destPath);

      res.json({
        id: assetId,
        name: originalName.replace('.glb', ''),
        polycount: 0, // Would need a GLB parser to compute
        url: `/api/assets/${assetId}`,
      });
    } catch (err) {
      console.error('[Assets] Upload error:', err);
      if (req.file?.path && fsSync.existsSync(req.file.path)) fsSync.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // Serve uploaded .glb asset
  app.get('/api/assets/:id', async (req, res) => {
    const assetId = req.params.id;

    // 1) Try .glb (3D asset) from local ASSETS_DIR
    const glbPath = path.join(ASSETS_DIR, `${assetId}.glb`);
    if (fsSync.existsSync(glbPath)) {
      res.set('Content-Type', 'model/gltf-binary');
      return res.sendFile(glbPath);
    }

    // 2) Try local data/assets/{userId}/{filename}
    const userId = req.user?.id || 'system';
    const localUserPath = path.join(rootDir, 'data', 'assets', userId, assetId);
    if (fsSync.existsSync(localUserPath)) {
      const ext = path.extname(assetId).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
      res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
      return res.sendFile(localUserPath);
    }
    // Also try system user path
    const localSystemPath = path.join(rootDir, 'data', 'assets', 'system', assetId);
    if (fsSync.existsSync(localSystemPath)) {
      const ext = path.extname(assetId).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
      res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
      return res.sendFile(localSystemPath);
    }

    // 2b) Scan all user directories as fallback
    const assetsBase = path.join(rootDir, 'data', 'assets');
    if (fsSync.existsSync(assetsBase)) {
      try {
        const userDirs = fsSync.readdirSync(assetsBase, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
        for (const dir of userDirs) {
          const tryPath = path.join(assetsBase, dir, assetId);
          if (fsSync.existsSync(tryPath)) {
            const ext = path.extname(assetId).toLowerCase();
            const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };
            res.set('Content-Type', mimeMap[ext] || 'application/octet-stream');
            return res.sendFile(tryPath);
          }
        }
      } catch {}
    }

    // 3) Try R2 (Cloudflare)
    if (cfR2 && cfR2.isConfigured) {
      try {
        const result = await cfR2.getAsset(userId, assetId) || await cfR2.getAsset('system', assetId);
        if (result) {
          res.set('Content-Type', result.contentType || 'application/octet-stream');
          return res.send(result.buffer);
        }
      } catch (r2Err) {
        console.error('[Assets] R2 fetch error:', r2Err.message);
      }
    }

    return res.status(404).json({ error: 'Asset not found' });
  });

  // List user's uploaded assets
  app.get('/api/assets', requireAuth, (req, res) => {
    try {
      if (!fsSync.existsSync(ASSETS_DIR)) return res.json([]);
      const files = fsSync.readdirSync(ASSETS_DIR).filter(f => f.endsWith('.glb'));
      const assets = files.map(f => ({
        id: f.replace('.glb', ''),
        name: f.replace('.glb', ''),
        url: `/api/assets/${f.replace('.glb', '')}`,
      }));
      res.json(assets);
    } catch (err) {
      console.error('[Assets] List error:', err);
      res.status(500).json({ error: 'Failed to list assets' });
    }
  });
}
