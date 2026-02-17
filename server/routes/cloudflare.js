/**
 * Cloudflare R2, KV, Images, Stream, and Vectorize routes
 * /api/sites/:siteId/deploy-r2, /api/sites/:siteId/files, /api/sites/:siteId/versions,
 * /api/images/cf, /api/videos, /api/threads, /api/vectorize, /api/memory/semantic-search,
 * /api/kv, /api/sites/domain
 */
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import multer from 'multer';
import { buildStaticSite } from '../services/buildStaticSite.js';

export function registerCloudflareRoutes(ctx) {
  const {
    app, stmts, db, requireAuth, sendError, PLAN_LIMITS, getQuotaCount, incrementQuota,
    deployLimiter, mediaUploadLimiter, threadIngestLimiter,
    cfR2, cfKV, cfImages, cfStream, cfVectorize,
    createDeployEmitter, emitDeployEvent, cleanupDeployEmitter,
  } = ctx;

  // Multer for video/image file uploads
  const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ============================================================================
  // R2 DEPLOY + FILE ROUTES
  // ============================================================================

  // --- Deploy via R2 (explicit R2 deploy endpoint) ---
  app.post('/api/sites/:siteId/deploy-r2', requireAuth, deployLimiter, async (req, res) => {
    try {
      const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
      if (!limits.sitesEnabled) {
        return res.status(403).json({ error: 'Site deployment not available on your plan', code: 'SITES_DISABLED' });
      }
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');
      if (!cfR2.isConfigured) return sendError(res, 503, 'R2 storage not configured');

      const siteDir = site.storage_path;
      if (!siteDir) return sendError(res, 400, 'No site files found');

      const deployId = randomUUID();
      const now = Date.now();
      const cfProjectName = site.cloudflare_project_name ||
        site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);

      stmts.insertDeployment.run(deployId, site.id, userId, cfProjectName, null, null, 'queued', null, null, now);
      res.json({ success: true, deployment: { id: deployId, status: 'queued' } });

      const emitter = createDeployEmitter(deployId);

      // Async deploy
      (async () => {
        try {
          emitDeployEvent(deployId, 'status', { step: 'building', message: 'Building static site...' });
          stmts.updateDeploymentStatus.run('building', null, null, null, null, deployId, userId);
          const { outputDir, buildLog } = await buildStaticSite(siteDir, (step, detail) => {
            emitDeployEvent(deployId, 'status', { step, message: step === 'installing' ? 'Installing dependencies...' : step === 'compiling' ? 'Running build command...' : step === 'built' ? `Build complete. Output: ${detail?.outputDir || 'dist'}/` : step });
          });

          emitDeployEvent(deployId, 'status', { step: 'uploading', message: 'Uploading to R2...' });
          stmts.updateDeploymentStatus.run('deploying', null, null, buildLog, null, deployId, userId);
          const latestRow = stmts.getLatestVersion.get(site.id, userId);
          const nextVersion = latestRow ? latestRow.version + 1 : 1;
          const r2Result = await cfR2.deploySite(site.id, outputDir, nextVersion);
          const subdomain = cfProjectName;
          const liveUrl = `https://${subdomain}.alinai.dev`;

          emitDeployEvent(deployId, 'status', { step: 'registering', message: 'Registering domain...' });
          if (cfKV.isConfigured) {
            await cfKV.registerDomain(subdomain, userId, site.id, nextVersion);
            await cfKV.setActiveVersion(site.id, nextVersion, deployId);
          }

          stmts.insertSiteVersion.run(randomUUID(), site.id, userId, nextVersion, r2Result.fileCount, r2Result.totalBytes, deployId, Date.now());
          stmts.updateDeploymentStatus.run('success', deployId, liveUrl, buildLog, null, deployId, userId);
          stmts.updateSite.run(site.name, 'deployed', cfProjectName, liveUrl, site.manifest, Date.now(), site.id, userId);
          emitDeployEvent(deployId, 'status', { step: 'success', message: `Live at ${liveUrl}`, url: liveUrl, fileCount: r2Result.fileCount });
          emitDeployEvent(deployId, 'done', {});
          cleanupDeployEmitter(deployId);
          console.log(`[Deploy-R2] Site ${site.id} v${nextVersion}: ${liveUrl}`);
        } catch (err) {
          console.error(`[Deploy-R2] Failed:`, err.message);
          stmts.updateDeploymentStatus.run('failed', null, null, null, err.message, deployId, userId);
          emitDeployEvent(deployId, 'error', { message: err.message });
          emitDeployEvent(deployId, 'done', {});
          cleanupDeployEmitter(deployId);
        }
      })();
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- List site files (from R2) ---
  app.get('/api/sites/:siteId/files', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');

      const versionRow = stmts.getLatestVersion.get(site.id, userId);
      if (!versionRow) return res.json({ success: true, files: [], version: 0 });

      const files = await cfR2.listSiteFiles(site.id, versionRow.version);
      res.json({ success: true, files, version: versionRow.version });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Get a specific site file (from R2) ---
  app.get('/api/sites/:siteId/files/*', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');

      const versionRow = stmts.getLatestVersion.get(site.id, userId);
      if (!versionRow) return sendError(res, 404, 'No versions found');

      const filePath = req.params[0];
      const file = await cfR2.getSiteFile(site.id, versionRow.version, filePath);
      if (!file) return sendError(res, 404, 'File not found');

      res.setHeader('Content-Type', file.contentType);
      res.send(file.buffer);
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- List site versions ---
  app.get('/api/sites/:siteId/versions', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const versions = stmts.listSiteVersions.all(req.params.siteId, req.user.id, limit);
      res.json({ success: true, versions });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Rollback to a previous version ---
  app.post('/api/sites/:siteId/rollback/:version', requireAuth, deployLimiter, async (req, res) => {
    try {
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');

      const targetVersion = parseInt(req.params.version);
      if (isNaN(targetVersion) || targetVersion < 1) return sendError(res, 400, 'Invalid version number');

      // Verify version exists
      const versions = stmts.listSiteVersions.all(site.id, userId, 100);
      const versionExists = versions.some(v => v.version === targetVersion);
      if (!versionExists) return sendError(res, 404, 'Version not found');

      const deployId = randomUUID();
      const cfProjectName = site.cloudflare_project_name ||
        site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);
      const subdomain = cfProjectName;

      if (cfKV.isConfigured) {
        await cfKV.setActiveVersion(site.id, targetVersion, deployId);
        await cfKV.registerDomain(subdomain, userId, site.id, targetVersion);
      }

      const liveUrl = `https://${subdomain}.alinai.dev`;
      stmts.insertDeployment.run(deployId, site.id, userId, cfProjectName, deployId, liveUrl, 'success', `Rollback to v${targetVersion}`, null, Date.now());
      stmts.updateSite.run(site.name, 'deployed', cfProjectName, liveUrl, site.manifest, Date.now(), site.id, userId);

      res.json({ success: true, deployment: { id: deployId, version: targetVersion, url: liveUrl, status: 'success' } });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // CLOUDFLARE IMAGES ROUTES
  // ============================================================================

  app.post('/api/images/cf/upload', requireAuth, mediaUploadLimiter, upload.single('image'), async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = req.user.plan || 'free';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      if (!limits.cfImagesEnabled) return sendError(res, 403, 'CF Images not available on your plan');

      if (!req.file) return sendError(res, 400, 'No image file uploaded');
      if (!cfImages.isConfigured) return sendError(res, 503, 'CF Images not configured');

      const buffer = await fs.readFile(req.file.path);
      const result = await cfImages.upload(buffer, req.file.originalname, {
        userId,
        siteId: req.body.siteId || null,
      });

      // Clean up temp file
      try { await fs.unlink(req.file.path); } catch {}

      const id = randomUUID();
      const deliveryUrl = cfImages.getDeliveryUrl(result.id, 'public');
      stmts.insertCfImage.run(
        id, userId, result.id, result.filename,
        deliveryUrl, JSON.stringify(result.variants),
        JSON.stringify({ siteId: req.body.siteId }), req.body.siteId || null, Date.now()
      );

      res.json({
        success: true,
        image: {
          id, cfImageId: result.id, filename: result.filename,
          url: deliveryUrl, variants: result.variants,
        },
      });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/images/cf', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const rows = stmts.listCfImages.all(req.user.id, limit);
      const images = rows.map(r => ({
        ...r,
        variants: r.variants ? JSON.parse(r.variants) : [],
        metadata: r.metadata ? JSON.parse(r.metadata) : {},
      }));
      res.json({ success: true, images });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.delete('/api/images/cf/:imageId', requireAuth, async (req, res) => {
    try {
      const row = stmts.getCfImage.get(req.params.imageId, req.user.id);
      if (!row) return sendError(res, 404, 'Image not found');

      if (cfImages.isConfigured) {
        try { await cfImages.delete(row.cf_image_id); } catch (e) { console.warn('[CF Images] Delete failed:', e.message); }
      }
      stmts.deleteCfImage.run(req.params.imageId, req.user.id);
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // CLOUDFLARE STREAM ROUTES
  // ============================================================================

  app.post('/api/videos/upload-url', requireAuth, mediaUploadLimiter, async (req, res) => {
    try {
      const plan = req.user.plan || 'free';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      if (!limits.cfStreamEnabled) return sendError(res, 403, 'CF Stream not available on your plan');
      if (limits.maxCfVideos >= 0) {
        const used = getQuotaCount(req.user.id, 'video_uploads');
        if (used >= limits.maxCfVideos) {
          return res.status(429).json({ error: 'Monthly video upload limit reached', used, limit: limits.maxCfVideos, code: 'VIDEO_QUOTA_EXCEEDED' });
        }
      }
      if (!cfStream.isConfigured) return sendError(res, 503, 'CF Stream not configured');

      const result = await cfStream.getDirectUploadUrl(
        req.body.maxDurationSeconds || 3600,
        { userId: req.user.id, siteId: req.body.siteId }
      );

      const id = randomUUID();
      stmts.insertCfVideo.run(
        id, req.user.id, result.uid, 'uploading',
        null, null, null, JSON.stringify({ siteId: req.body.siteId }),
        req.body.siteId || null, Date.now()
      );

      incrementQuota(req.user.id, 'video_uploads');
      res.json({ success: true, video: { id, uid: result.uid, uploadUrl: result.uploadUrl } });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.post('/api/videos/upload-from-url', requireAuth, mediaUploadLimiter, async (req, res) => {
    try {
      const plan = req.user.plan || 'free';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      if (!limits.cfStreamEnabled) return sendError(res, 403, 'CF Stream not available on your plan');
      if (limits.maxCfVideos >= 0) {
        const used = getQuotaCount(req.user.id, 'video_uploads');
        if (used >= limits.maxCfVideos) {
          return res.status(429).json({ error: 'Monthly video upload limit reached', used, limit: limits.maxCfVideos, code: 'VIDEO_QUOTA_EXCEEDED' });
        }
      }
      if (!cfStream.isConfigured) return sendError(res, 503, 'CF Stream not configured');
      if (!req.body.url) return sendError(res, 400, 'url is required');

      const result = await cfStream.uploadFromUrl(req.body.url, {
        userId: req.user.id,
        siteId: req.body.siteId,
      });

      const id = randomUUID();
      stmts.insertCfVideo.run(
        id, req.user.id, result.uid, result.status,
        result.thumbnail || null, result.preview || null,
        result.duration || null, JSON.stringify({ siteId: req.body.siteId }),
        req.body.siteId || null, Date.now()
      );

      incrementQuota(req.user.id, 'video_uploads');
      res.json({ success: true, video: { id, uid: result.uid, status: result.status } });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/videos/:videoId', requireAuth, async (req, res) => {
    try {
      const row = stmts.getCfVideo.get(req.params.videoId, req.user.id);
      if (!row) return sendError(res, 404, 'Video not found');

      // Refresh status from CF if not ready
      if (row.status !== 'ready' && cfStream.isConfigured) {
        try {
          const cfVideo = await cfStream.getVideo(row.cf_uid);
          if (cfVideo) {
            stmts.updateCfVideo.run(
              cfVideo.status, cfVideo.thumbnail || row.thumbnail,
              cfVideo.preview || row.preview, cfVideo.duration || row.duration,
              row.id, req.user.id
            );
            row.status = cfVideo.status;
            row.thumbnail = cfVideo.thumbnail || row.thumbnail;
            row.preview = cfVideo.preview || row.preview;
            row.duration = cfVideo.duration || row.duration;
          }
        } catch {}
      }

      res.json({ success: true, video: { ...row, metadata: row.metadata ? JSON.parse(row.metadata) : {} } });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.delete('/api/videos/:videoId', requireAuth, async (req, res) => {
    try {
      const row = stmts.getCfVideo.get(req.params.videoId, req.user.id);
      if (!row) return sendError(res, 404, 'Video not found');

      if (cfStream.isConfigured) {
        try { await cfStream.delete(row.cf_uid); } catch (e) { console.warn('[CF Stream] Delete failed:', e.message); }
      }
      stmts.deleteCfVideo.run(req.params.videoId, req.user.id);
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/videos/:videoId/embed', requireAuth, (req, res) => {
    try {
      const row = stmts.getCfVideo.get(req.params.videoId, req.user.id);
      if (!row) return sendError(res, 404, 'Video not found');

      res.json({
        success: true,
        embedUrl: cfStream.getEmbedUrl(row.cf_uid),
        embedHtml: cfStream.getEmbedHtml(row.cf_uid),
      });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // THREAD / VECTORIZE ROUTES
  // ============================================================================

  app.post('/api/threads/ingest', requireAuth, threadIngestLimiter, async (req, res) => {
    try {
      const plan = req.user.plan || 'free';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
      if (!limits.vectorizeEnabled) return sendError(res, 403, 'Vectorize not available on your plan');
      if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');

      const { text, threadId: providedThreadId } = req.body;
      if (!text || typeof text !== 'string') return sendError(res, 400, 'text is required');

      const threadId = providedThreadId || randomUUID();
      const userId = req.user.id;

      // Chunk + embed + upsert
      const result = await cfVectorize.ingestThread(threadId, text, userId);

      // Store chunks in DB
      const now = Date.now();
      for (const chunk of result.chunks) {
        stmts.insertThreadChunk.run(
          randomUUID(), threadId, userId, chunk.index,
          chunk.content, null, chunk.tokenCount,
          `${threadId}-chunk-${chunk.index}`, null, now
        );
      }

      res.json({
        success: true,
        threadId,
        chunkCount: result.chunkCount,
        chunks: result.chunks.map(c => ({
          index: c.index,
          tokenCount: c.tokenCount,
          preview: c.content.slice(0, 200),
        })),
      });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/threads', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const threads = stmts.listUserThreads.all(req.user.id, limit);
      res.json({ success: true, threads });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.post('/api/memory/semantic-search', requireAuth, async (req, res) => {
    try {
      if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');
      const { query, topK } = req.body;
      if (!query) return sendError(res, 400, 'query is required');

      const results = await cfVectorize.searchMemory(query, req.user.id, topK || 10);
      res.json({ success: true, results });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // VECTORIZE — TBWO Context Chunking
  // ============================================================================

  // POST /api/vectorize/ingest — Chunk and embed arbitrary text for TBWO context
  app.post('/api/vectorize/ingest', requireAuth, async (req, res) => {
    try {
      if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');
      const { text, metadata = {} } = req.body;
      if (!text) return sendError(res, 400, 'text is required');

      const chunks = cfVectorize.chunkText(text, 500, 50);
      const vectors = [];
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await cfVectorize.embedText(chunks[i]);
        if (embedding) {
          vectors.push({
            id: `ctx-${Date.now()}-${i}`,
            values: embedding,
            metadata: { ...metadata, chunk_index: i, content: chunks[i].slice(0, 500), user_id: req.user.id },
          });
        }
      }
      if (vectors.length > 0) {
        await cfVectorize.upsert('content', vectors);
      }
      res.json({ success: true, chunkCount: chunks.length, vectorCount: vectors.length });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // POST /api/vectorize/search-context — Search for relevant context chunks
  app.post('/api/vectorize/search-context', requireAuth, async (req, res) => {
    try {
      if (!cfVectorize.isConfigured) return sendError(res, 503, 'Vectorize not configured');
      const { query, topK = 5 } = req.body;
      if (!query) return sendError(res, 400, 'query is required');

      const results = await cfVectorize.searchContent(query, req.user.id, topK);
      res.json({ success: true, chunks: results });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // R2 — User Asset Management
  // ============================================================================

  // DELETE /api/sites/:siteId/versions/:version — Delete old site version from R2
  app.delete('/api/sites/:siteId/versions/:version', requireAuth, async (req, res) => {
    try {
      if (!cfR2 || !cfR2.isConfigured) return sendError(res, 503, 'R2 not configured');
      await cfR2.deleteSiteVersion(req.params.siteId, parseInt(req.params.version));
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // KV — Domain Management
  // ============================================================================

  // GET /api/sites/domain/:subdomain — Check domain availability
  app.get('/api/sites/domain/:subdomain', requireAuth, async (req, res) => {
    try {
      if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
      const info = await cfKV.lookupDomain(req.params.subdomain);
      res.json({ success: true, available: !info, info: info || null });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // DELETE /api/sites/domain/:subdomain — Remove domain registration
  app.delete('/api/sites/domain/:subdomain', requireAuth, async (req, res) => {
    try {
      if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
      await cfKV.unregisterDomain(req.params.subdomain);
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // GET /api/sites/:siteId/version-info — Get active version info from KV
  app.get('/api/sites/:siteId/version-info', requireAuth, async (req, res) => {
    try {
      if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
      const info = await cfKV.getVersionInfo(req.params.siteId);
      res.json({ success: true, info: info || null });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // GET /api/kv/list — Admin KV browser
  app.get('/api/kv/list', requireAuth, async (req, res) => {
    try {
      if (!cfKV || !cfKV.isConfigured) return sendError(res, 503, 'KV not configured');
      const { prefix, limit, cursor } = req.query;
      const result = await cfKV.list(prefix || '', parseInt(limit) || 1000, cursor || undefined);
      res.json({ success: true, ...result });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // CF Images — Gallery & URL Upload
  // ============================================================================

  // POST /api/images/from-url — Import image from URL
  app.post('/api/images/from-url', requireAuth, async (req, res) => {
    try {
      if (!cfImages || !cfImages.isConfigured) return sendError(res, 503, 'CF Images not configured');
      const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
      if (limits.maxCfImages >= 0) {
        const used = getQuotaCount(req.user.id, 'image_generations');
        if (used >= limits.maxCfImages) {
          return res.status(429).json({ error: 'Monthly image generation limit reached', used, limit: limits.maxCfImages, code: 'IMAGE_QUOTA_EXCEEDED' });
        }
      }
      const { url, metadata = {} } = req.body;
      if (!url) return sendError(res, 400, 'url is required');

      const result = await cfImages.uploadFromUrl(url, { ...metadata, userId: req.user.id });
      // Store in DB
      db.prepare(`INSERT INTO cf_images (id, user_id, cf_image_id, filename, url, variants, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), req.user.id, result.id, url.split('/').pop() || 'image',
        result.variants?.[0] || '', JSON.stringify(result.variants || []),
        JSON.stringify(metadata), Date.now()
      );
      incrementQuota(req.user.id, 'image_generations');
      res.json({ success: true, image: result });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // CF Stream — Video Gallery
  // ============================================================================

  // GET /api/videos/list — List uploaded videos
  app.get('/api/videos/list', requireAuth, async (req, res) => {
    try {
      if (!cfStream || !cfStream.isConfigured) return sendError(res, 503, 'CF Stream not configured');
      const limit = parseInt(req.query.limit) || 50;
      const result = await cfStream.list(limit);
      res.json({ success: true, videos: result });
    } catch (error) { sendError(res, 500, error.message); }
  });
}
