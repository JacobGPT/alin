/**
 * TBWO Workspace management endpoints
 * /api/tbwo/:id/workspace — init, write, read, list, file, zip, delete, manifest, validate
 */
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import JSZip from 'jszip';
import { SandboxPipeline } from '../services/sandboxPipeline.js';

export function registerTBWOWorkspaceRoutes(ctx) {
  const { app, tbwoWorkspaces, requireAuth, requireAuthOrToken, sendError } = ctx;

  const WORKSPACE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Sweep stale workspaces every 15 minutes
  setInterval(async () => {
    const now = Date.now();
    for (const [tbwoId, ws] of tbwoWorkspaces.entries()) {
      if (now - ws.createdAt > WORKSPACE_TTL_MS) {
        try {
          await fs.rm(ws.path, { recursive: true, force: true });
          tbwoWorkspaces.delete(tbwoId);
          console.log(`[Workspace] Cleaned up stale workspace: ${tbwoId}`);
        } catch {}
      }
    }
  }, 15 * 60 * 1000);

  // POST /api/tbwo/:id/workspace/init — Create temp dir for TBWO workspace
  app.post('/api/tbwo/:id/workspace/init', requireAuth, async (req, res) => {
    try {
      const tbwoId = req.params.id;
      const workspacePath = path.join(os.tmpdir(), `alin-tbwo-${tbwoId}`);

      // Clean up any previous workspace for this TBWO
      try { await fs.rm(workspacePath, { recursive: true, force: true }); } catch {}

      await fs.mkdir(workspacePath, { recursive: true });

      tbwoWorkspaces.set(tbwoId, {
        path: workspacePath,
        userId: req.user.id,
        createdAt: Date.now(),
        fileCount: 0,
      });

      console.log(`[Workspace] Initialized: ${workspacePath}`);
      res.json({ success: true, workspaceId: tbwoId, workspacePath });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // POST /api/tbwo/:id/workspace/write — Write file to workspace
  app.post('/api/tbwo/:id/workspace/write', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found. Call /init first.' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const { path: filePath, content } = req.body;
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: 'path and content required' });
      }

      // Normalize to prevent path traversal
      const relativePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
      const fullPath = path.join(ws.path, relativePath);

      // Verify resolved path is inside workspace
      if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
        return res.status(403).json({ error: 'Path traversal detected' });
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
      ws.fileCount++;

      const size = Buffer.byteLength(content, 'utf-8');
      const downloadUrl = `/api/tbwo/${req.params.id}/workspace/file?path=${encodeURIComponent(relativePath)}`;

      console.log(`[Workspace] File written: ${relativePath} (${size} bytes)`);
      res.json({ success: true, path: relativePath, size, downloadUrl });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // POST /api/tbwo/:id/workspace/read — Read file from workspace
  app.post('/api/tbwo/:id/workspace/read', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const { path: filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'path required' });

      const relativePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
      const fullPath = path.join(ws.path, relativePath);

      if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
        return res.status(403).json({ error: 'Path traversal detected' });
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      res.json({ success: true, content, path: relativePath });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: `File not found: ${req.body.path}` });
      }
      if (error.code === 'EISDIR') {
        return res.status(400).json({ error: `Path is a directory, not a file: ${req.body.path}` });
      }
      sendError(res, 500, error.message);
    }
  });

  // POST /api/tbwo/:id/workspace/list — List workspace directory
  app.post('/api/tbwo/:id/workspace/list', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const subPath = req.body.path || '.';
      const relativePath = path.normalize(subPath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
      const fullPath = path.join(ws.path, relativePath);

      if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
        return res.status(403).json({ error: 'Path traversal detected' });
      }

      let entries;
      try {
        entries = await fs.readdir(fullPath, { withFileTypes: true });
      } catch (e) {
        if (e.code === 'ENOENT') return res.json({ success: true, files: [] });
        throw e;
      }
      const files = entries.map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: path.join(relativePath, e.name).replace(/\\/g, '/'),
      }));

      res.json({ success: true, files });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // GET /api/tbwo/:id/workspace/file — Download single file (supports token query param for <a href> download)
  app.get('/api/tbwo/:id/workspace/file', requireAuthOrToken, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const filePath = req.query.path;
      if (!filePath) return res.status(400).json({ error: 'path query param required' });

      const relativePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
      const fullPath = path.join(ws.path, relativePath);

      if (!path.resolve(fullPath).startsWith(path.resolve(ws.path))) {
        return res.status(403).json({ error: 'Path traversal detected' });
      }

      const filename = path.basename(relativePath);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(path.resolve(fullPath));
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // GET /api/tbwo/:id/workspace/zip — Download all workspace files as zip
  app.get('/api/tbwo/:id/workspace/zip', requireAuthOrToken, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const zip = new JSZip();

      // Recursively add all files
      async function addDir(dirPath, zipFolder) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await addDir(entryPath, zipFolder.folder(entry.name));
          } else {
            const content = await fs.readFile(entryPath);
            zipFolder.file(entry.name, content);
          }
        }
      }

      await addDir(ws.path, zip);

      const tbwoId = req.params.id;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="tbwo-${tbwoId.slice(0, 8)}.zip"`);

      // Stream the zip to avoid loading entire buffer into memory
      zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' })
        .pipe(res);
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // DELETE /api/tbwo/:id/workspace — Remove workspace and deregister
  app.delete('/api/tbwo/:id/workspace', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.json({ success: true, message: 'No workspace to clean up' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      try { await fs.rm(ws.path, { recursive: true, force: true }); } catch {}
      tbwoWorkspaces.delete(req.params.id);

      console.log(`[Workspace] Deleted: ${req.params.id}`);
      res.json({ success: true });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // ============================================================================
  // WORKSPACE MANIFEST + VALIDATION
  // ============================================================================

  // GET /api/tbwo/:id/workspace/manifest — Generate file tree manifest
  app.get('/api/tbwo/:id/workspace/manifest', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      async function buildTree(dirPath, relativeTo) {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const nodes = [];
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relPath = path.relative(relativeTo, fullPath).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            const children = await buildTree(fullPath, relativeTo);
            nodes.push({ type: 'directory', name: entry.name, path: relPath, children });
          } else {
            const stat = await fs.stat(fullPath);
            nodes.push({
              type: 'file',
              name: entry.name,
              path: relPath,
              size: stat.size,
              downloadUrl: `/api/tbwo/${req.params.id}/workspace/file?path=${encodeURIComponent(relPath)}`,
            });
          }
        }
        return nodes;
      }

      const manifest = await buildTree(ws.path, ws.path);
      const totalFiles = (function countFiles(nodes) {
        return nodes.reduce((sum, n) => sum + (n.type === 'file' ? 1 : countFiles(n.children || [])), 0);
      })(manifest);
      const totalSize = (function sumSize(nodes) {
        return nodes.reduce((sum, n) => sum + (n.type === 'file' ? (n.size || 0) : sumSize(n.children || [])), 0);
      })(manifest);

      res.json({ manifest, totalFiles, totalSize });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // POST /api/tbwo/:id/workspace/validate — Run server-side validation
  app.post('/api/tbwo/:id/workspace/validate', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const { expectedPages = [], approvedClaims = [] } = req.body;

      const pipeline = new SandboxPipeline(req.params.id, req.user.id, {
        expectedPages,
        approvedClaims,
      });
      pipeline.workspacePath = ws.path;

      const result = await pipeline.validate();
      res.json(result);
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}
