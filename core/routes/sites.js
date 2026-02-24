/**
 * Sites + Deploy Dashboard endpoints
 * /api/sites — CRUD, deploy, preview, brief extraction, regenerate-section, video-analyze, extract-from-url
 */
import { randomUUID, createHash } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { buildStaticSite } from '../services/buildStaticSite.js';

export function registerSiteRoutes(ctx) {
  const {
    app, stmts, db, requireAuth, sendError, PLAN_LIMITS, deployLimiter,
    SITES_DATA_DIR, tbwoWorkspaces, cfR2, cfKV, cfDeploy, deployEvents,
    createDeployEmitter, emitDeployEvent, cleanupDeployEmitter,
    setupSSE, sendSSE, briefCache, DEFAULT_MODELS, getQuotaCount, incrementQuota,
  } = ctx;

  // --- Helper: recursive directory copy ---
  async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  const BRIEF_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  function briefCacheKey(sourceText, sourceType, contextHints) {
    return createHash('sha256')
      .update(sourceText + '|' + (sourceType || '') + '|' + (contextHints || ''))
      .digest('hex');
  }

  // --- LLM caller with Anthropic retry + OpenAI fallback ---
  async function callLLMForBrief({ prompt, system, maxTokens, model, preferOpenAI }) {
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const RETRIES = 3;
    const BACKOFF = [500, 1500, 3500];

    // --- Prefer GPT-4o-mini for structured extraction (cheaper, faster) ---
    const oaiKey = process.env.OPENAI_API_KEY;
    if ((preferOpenAI || !model) && oaiKey) {
      const oaiModel = model || DEFAULT_MODELS.gpt4oMini;
      console.log(`[extract-brief] Calling OpenAI | model: ${oaiModel} | prompt: ${prompt.length} chars (~${estimatedTokens} tokens) | maxTokens: ${maxTokens}`);
      try {
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oaiKey}` },
          body: JSON.stringify({
            model: oaiModel,
            messages: [
              { role: 'system', content: system || 'Extract a site brief from the input. Output ONLY valid JSON.' },
              { role: 'user', content: prompt },
            ],
            max_completion_tokens: maxTokens || 4096,
            temperature: 0.3,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          console.log(`[extract-brief] OpenAI ${oaiModel} succeeded`);
          return { text: data.choices[0]?.message?.content || '', provider: 'openai', requestId: '' };
        }
        console.warn(`[extract-brief] OpenAI ${oaiModel} failed: ${resp.status}, falling back to Anthropic`);
      } catch (oaiErr) {
        console.warn(`[extract-brief] OpenAI error: ${oaiErr.message}, falling back to Anthropic`);
      }
    }

    // --- Fallback to Anthropic ---
    const claudeModel = model || DEFAULT_MODELS.claudeSonnet;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw Object.assign(new Error('ANTHROPIC_API_KEY not set'), { retryable: false });

    console.log(`[extract-brief] Calling Anthropic | model: ${claudeModel} | prompt: ${prompt.length} chars (~${estimatedTokens} tokens) | maxTokens: ${maxTokens}`);

    let lastError = null;
    let lastStatus = 0;
    let lastRequestId = '';

    for (let attempt = 0; attempt < RETRIES; attempt++) {
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: claudeModel,
            max_tokens: maxTokens || 4096,
            stream: false,
            system: system || undefined,
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const requestId = resp.headers.get('request-id') || '';
          const textBlock = data.content?.find(b => b.type === 'text');
          return { text: textBlock?.text || '', provider: 'anthropic', requestId };
        }

        lastStatus = resp.status;
        lastRequestId = resp.headers.get('request-id') || '';

        // Retry on 429, 529, 5xx
        if (resp.status === 429 || resp.status === 529 || resp.status >= 500) {
          const jitter = Math.random() * 500;
          const delay = BACKOFF[attempt] + jitter;
          console.warn(`[extract-brief] Anthropic ${resp.status} — retry ${attempt + 1}/${RETRIES} in ${Math.round(delay)}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Non-retryable error (400, 401, etc.)
        const errText = await resp.text();
        throw Object.assign(new Error(`Anthropic ${resp.status}`), {
          status: resp.status, provider: 'anthropic', requestId: lastRequestId, body: errText, retryable: false,
        });
      } catch (e) {
        if (e.retryable === false) throw e; // non-retryable, don't fallback
        lastError = e;
        if (attempt < RETRIES - 1) {
          const jitter = Math.random() * 500;
          await new Promise(r => setTimeout(r, BACKOFF[attempt] + jitter));
        }
      }
    }

    // All providers failed
    throw Object.assign(
      new Error('All LLM providers failed'),
      { status: lastStatus, provider: 'anthropic', requestId: lastRequestId, retryable: true },
    );
  }

  // ============================================================================
  // SITES + DEPLOY ENDPOINTS (Deploy Dashboard v1)
  // ============================================================================

  // --- Create a site from a TBWO run ---
  app.post('/api/sites', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, tbwoRunId, manifest, ephemeral } = req.body;
      if (!name) return sendError(res, 400, 'name is required');

      // Gate ephemeral sites to paid plans
      const isEphemeral = !!ephemeral;
      if (isEphemeral) {
        const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
        if (!limits.ephemeralEnabled) {
          return res.status(403).json({ error: 'Ephemeral sites require Spark plan or above', code: 'EPHEMERAL_DISABLED' });
        }
      }

      const siteId = randomUUID();
      const now = Date.now();
      const projectId = req.projectId || 'default';
      const expiresAt = isEphemeral ? now + (30 * 24 * 60 * 60 * 1000) : null; // 30 days

      // If tbwoRunId provided, copy workspace files to persistent storage
      let storagePath = null;
      if (tbwoRunId) {
        const ws = tbwoWorkspaces.get(tbwoRunId);
        if (ws && ws.userId === userId) {
          storagePath = path.join(SITES_DATA_DIR, siteId);
          await fs.mkdir(storagePath, { recursive: true });
          await copyDir(ws.path, storagePath);
        }
      }

      stmts.insertSite.run(
        siteId, userId, projectId, name,
        tbwoRunId || null, 'draft', null, null, manifest || null,
        storagePath, isEphemeral ? 1 : 0, expiresAt, now, now
      );

      const site = stmts.getSite.get(siteId, userId);
      res.json({ success: true, site });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- List user's ephemeral sites ---
  app.get('/api/sites/ephemeral', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const now = Date.now();
      const sites = stmts.listEphemeralSites.all(req.user.id, 'expired', limit, offset);

      // Enrich with daysRemaining and isExpired
      const enriched = sites.map(site => {
        const isExpired = site.expires_at && site.expires_at < now;
        const daysRemaining = site.expires_at
          ? Math.max(0, Math.ceil((site.expires_at - now) / (24 * 60 * 60 * 1000)))
          : null;
        return { ...site, daysRemaining, isExpired };
      });

      res.json({ success: true, sites: enriched });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Extend ephemeral site expiry (costs 1 site_hosting credit) ---
  app.post('/api/sites/:siteId/extend-expiry', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');
      if (!site.ephemeral) return sendError(res, 400, 'Only ephemeral sites can be extended');

      const now = Date.now();
      if (site.status === 'expired') return sendError(res, 400, 'Site has already expired and been cleaned up');

      // Deduct 1 site_hosting credit
      const creditResult = stmts.decrementCredit.run(1, userId, 'site_hosting', 'subscription', 1);
      if (creditResult.changes === 0) {
        return res.status(402).json({ error: 'Insufficient site_hosting credits', code: 'INSUFFICIENT_CREDITS' });
      }

      // Record transaction
      const balanceRow = stmts.getCreditByType.get(userId, 'site_hosting', now);
      const balanceAfter = balanceRow ? balanceRow.total : 0;
      stmts.insertCreditTransaction.run(
        randomUUID(), userId, 'site_hosting', -1, balanceAfter,
        `Extended ephemeral site "${site.name}" by 30 days`,
        site.id, now
      );

      // Extend by 30 days from current expiry (or from now if past)
      const baseTime = (site.expires_at && site.expires_at > now) ? site.expires_at : now;
      const newExpiry = baseTime + (30 * 24 * 60 * 60 * 1000);
      stmts.updateSiteExpiry.run(newExpiry, now, site.id, userId);

      const daysRemaining = Math.ceil((newExpiry - now) / (24 * 60 * 60 * 1000));
      res.json({ success: true, expiresAt: newExpiry, daysRemaining });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- List user's sites ---
  app.get('/api/sites', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const sites = stmts.listSites.all(req.user.id, limit, offset);
      res.json({ success: true, sites });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Get single site ---
  app.get('/api/sites/:siteId', requireAuth, (req, res) => {
    try {
      const site = stmts.getSite.get(req.params.siteId, req.user.id);
      if (!site) return sendError(res, 404, 'Site not found');
      res.json({ success: true, site });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Delete a site ---
  app.delete('/api/sites/:siteId', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');

      // Delete related records first (deployments, patches), then the site
      stmts.deleteDeploymentsBySite.run(req.params.siteId, userId);
      stmts.deletePatchesBySite.run(req.params.siteId, userId);
      stmts.deleteSite.run(req.params.siteId, userId);

      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Deploy a site ---
  app.post('/api/sites/:siteId/deploy', requireAuth, deployLimiter, async (req, res) => {
    try {
      const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
      if (!limits.sitesEnabled) {
        return res.status(403).json({ error: 'Site deployment not available on your plan', code: 'SITES_DISABLED' });
      }
      const userId = req.user.id;
      const site = stmts.getSite.get(req.params.siteId, userId);
      if (!site) return sendError(res, 404, 'Site not found');

      const deployId = randomUUID();
      const now = Date.now();
      const cfProjectName = site.cloudflare_project_name ||
        site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);

      // Create deployment record (queued)
      stmts.insertDeployment.run(
        deployId, site.id, userId, cfProjectName,
        null, null, 'queued', null, null, now
      );

      // Send immediate response so client can poll
      res.json({ success: true, deployment: { id: deployId, status: 'queued' } });

      // Create SSE emitter for this deployment
      const emitter = createDeployEmitter(deployId);

      // Async: build + deploy
      (async () => {
        try {
          // 1. Find/build static output
          const siteDir = site.storage_path;
          if (!siteDir) {
            stmts.updateDeploymentStatus.run('failed', null, null, null, 'No site files found. Create from TBWO first.', deployId, userId);
            emitDeployEvent(deployId, 'error', { message: 'No site files found. Create from TBWO first.' });
            emitDeployEvent(deployId, 'done', {});
            cleanupDeployEmitter(deployId);
            return;
          }

          emitDeployEvent(deployId, 'status', { step: 'building', message: 'Building static site...' });
          stmts.updateDeploymentStatus.run('building', null, null, null, null, deployId, userId);
          const { outputDir, buildLog } = await buildStaticSite(siteDir, (step, detail) => {
            emitDeployEvent(deployId, 'status', { step, message: step === 'installing' ? 'Installing dependencies...' : step === 'compiling' ? 'Running build command...' : step === 'built' ? `Build complete. Output: ${detail?.outputDir || 'dist'}/` : step });
          });

          // 2. Deploy — prefer R2 when configured, fall back to CF Pages
          stmts.updateDeploymentStatus.run('deploying', null, null, buildLog, null, deployId, userId);

          if (cfR2.isConfigured) {
            emitDeployEvent(deployId, 'status', { step: 'uploading', message: 'Uploading to R2...' });
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

            stmts.insertSiteVersion.run(
              randomUUID(), site.id, userId, nextVersion,
              r2Result.fileCount, r2Result.totalBytes, deployId, Date.now()
            );

            stmts.updateDeploymentStatus.run('success', deployId, liveUrl, buildLog, null, deployId, userId);
            stmts.updateSite.run(site.name, 'deployed', cfProjectName, liveUrl, site.manifest, Date.now(), site.id, userId);
            emitDeployEvent(deployId, 'status', { step: 'success', message: `Live at ${liveUrl}`, url: liveUrl, fileCount: r2Result.fileCount });
            console.log(`[Deploy] Site ${site.id} deployed to R2 v${nextVersion}: ${liveUrl}`);
          } else {
            emitDeployEvent(deployId, 'status', { step: 'uploading', message: 'Deploying to Cloudflare Pages...' });
            await cfDeploy.ensureProject(cfProjectName);
            const result = await cfDeploy.deploy(cfProjectName, outputDir);
            stmts.updateDeploymentStatus.run('success', result.id, result.url, buildLog, null, deployId, userId);
            stmts.updateSite.run(site.name, 'deployed', cfProjectName, result.url, site.manifest, Date.now(), site.id, userId);
            emitDeployEvent(deployId, 'status', { step: 'success', message: `Live at ${result.url}`, url: result.url });
            console.log(`[Deploy] Site ${site.id} deployed via Pages: ${result.url}${result.stub ? ' (stub)' : ''}`);
          }
          emitDeployEvent(deployId, 'done', {});
          cleanupDeployEmitter(deployId);
        } catch (err) {
          console.error(`[Deploy] Failed for site ${site.id}:`, err.message);
          stmts.updateDeploymentStatus.run('failed', null, null, null, err.message, deployId, userId);
          emitDeployEvent(deployId, 'error', { message: err.message });
          emitDeployEvent(deployId, 'done', {});
          cleanupDeployEmitter(deployId);
        }
      })();
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- List deployments for a site ---
  app.get('/api/sites/:siteId/deployments', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const deployments = stmts.listDeployments.all(req.params.siteId, req.user.id, limit);
      res.json({ success: true, deployments });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- SSE Deploy Progress Stream ---
  app.get('/api/sites/:siteId/deploy/:deploymentId/stream', requireAuth, (req, res) => {
    const { deploymentId } = req.params;
    setupSSE(res);

    const emitter = deployEvents.get(deploymentId);
    if (!emitter) {
      // Deployment already finished or never had an emitter — send current status from DB
      const userId = req.user.id;
      const deployments = stmts.listDeployments.all(req.params.siteId, userId, 5);
      const target = deployments.find(d => d.id === deploymentId);
      if (target) {
        sendSSE(res, 'status', { step: target.status, message: target.status === 'success' ? `Live at ${target.url}` : target.status === 'failed' ? target.error : target.status });
        if (target.status === 'success' || target.status === 'failed') {
          sendSSE(res, 'done', {});
        }
      } else {
        sendSSE(res, 'error', { message: 'Deployment not found' });
        sendSSE(res, 'done', {});
      }
      return res.end();
    }

    // Subscribe to live progress events
    const handler = (data) => {
      try {
        sendSSE(res, data.event, data);
        if (data.event === 'done') {
          res.end();
        }
      } catch {
        // Client disconnected
        emitter.removeListener('progress', handler);
      }
    };

    emitter.on('progress', handler);

    // Cleanup on client disconnect
    req.on('close', () => {
      emitter.removeListener('progress', handler);
    });
  });

  // --- Preview: serve site files statically ---
  app.get('/api/preview/:siteId/*', requireAuth, async (req, res) => {
    try {
      const site = stmts.getSite.get(req.params.siteId, req.user.id);
      if (!site) return sendError(res, 404, 'Site not found');
      if (!site.storage_path) return sendError(res, 404, 'No site files');

      // Requested file path (everything after /api/preview/:siteId/)
      const requestedPath = req.params[0] || 'index.html';
      const safePath = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
      let filePath = path.join(site.storage_path, safePath);

      // Try site/ subdirectory first (ALIN Website Sprint layout)
      const siteDirPath = path.join(site.storage_path, 'site', safePath);
      try {
        await fs.access(siteDirPath);
        filePath = siteDirPath;
      } catch {
        // Try direct path
        try {
          await fs.access(filePath);
        } catch {
          // Default to index.html for SPA routing
          const indexPath = path.join(site.storage_path, 'site', 'index.html');
          try {
            await fs.access(indexPath);
            filePath = indexPath;
          } catch {
            return sendError(res, 404, 'File not found');
          }
        }
      }

      // Determine MIME type
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
        '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
        '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain',
      };
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      const content = await fs.readFile(filePath);
      res.send(content);
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // SITE BRIEF EXTRACTION
  // ============================================================================

  // --- Regenerate a single section via Claude ---
  app.post('/api/sites/regenerate-section', requireAuth, async (req, res) => {
    try {
      const { sectionHtml, action, instruction, cssContext, productName, fullPageContext } = req.body;
      if (!sectionHtml || typeof sectionHtml !== 'string') {
        return sendError(res, 400, 'sectionHtml is required');
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return sendError(res, 500, 'ANTHROPIC_API_KEY not set');

      const systemPrompt = `You are a senior web designer and conversion specialist. You rewrite HTML sections to be more effective.

Rules:
- Return ONLY the rewritten HTML section (no explanation, no markdown fences).
- Keep the same HTML tag structure (section element with same classes/IDs).
- Maintain the same CSS custom properties and class naming conventions.
- Preserve all links and their href values unless the instruction says otherwise.
- Output valid, well-formatted HTML.
${cssContext ? `\nCSS context (design tokens in use):\n${cssContext}` : ''}
${productName ? `\nProduct name: ${productName}` : ''}`;

      const userPrompt = `Action: ${action || 'custom'}

Instruction: ${instruction || 'Improve this section.'}

Current section HTML:
${sectionHtml}

${fullPageContext ? `Page context (for tone/content consistency):\n${fullPageContext.slice(0, 2000)}` : ''}

Rewrite the section HTML now. Output ONLY the HTML.`;

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: DEFAULT_MODELS.claudeSonnet,
          max_tokens: 4096,
          stream: false,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[regenerate-section] Anthropic error:', resp.status, errText);
        return sendError(res, 502, `Claude API error: ${resp.status}`);
      }

      const data = await resp.json();
      const textBlock = data.content?.find(b => b.type === 'text');
      let newHtml = textBlock?.text || '';

      // Strip markdown fences if Claude included them despite instructions
      newHtml = newHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();

      res.json({ success: true, newHtml });
    } catch (err) {
      console.error('[regenerate-section] Error:', err);
      sendError(res, 500, err.message || 'Section regeneration failed');
    }
  });

  // --- Analyze a video for UX issues ---
  app.post('/api/video/analyze-ux', requireAuth, async (req, res) => {
    try {
      // This endpoint accepts base64 frames (client-side extraction)
      // or can be extended with fluent-ffmpeg for server-side extraction
      const { frames, videoName } = req.body;

      if (!frames || !Array.isArray(frames) || frames.length === 0) {
        return sendError(res, 400, 'frames array is required (base64 images)');
      }

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return sendError(res, 500, 'ANTHROPIC_API_KEY not set');

      // Build vision content blocks
      const imageBlocks = frames.slice(0, 10).map((frame, i) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: frame.mediaType || 'image/png',
          data: frame.data,
        },
      }));

      const textBlock = {
        type: 'text',
        text: `Analyze these ${frames.length} keyframes from a product demo video "${videoName || 'unknown'}".

For each frame and overall, evaluate:
1. Layout & Visual Hierarchy: Is the layout clear? Can users find key actions?
2. UX Flow: Does the demonstrated flow feel intuitive? Any confusing steps?
3. Accessibility: Color contrast, text readability, touch target sizes
4. Copy & Messaging: Are labels clear? CTAs compelling? Error messages helpful?
5. Design Consistency: Color scheme, typography, spacing consistent?
6. Friction Points: Where might users get stuck or confused?

Return a JSON object with this structure:
{
  "overallScore": 0-100,
  "scores": { "layout": N, "uxFlow": N, "accessibility": N, "copyClarity": N, "designConsistency": N, "frictionLevel": N },
  "frameAnalyses": [{ "frameIndex": N, "description": "...", "issues": [...], "suggestions": [...], "score": N }],
  "overallRecommendations": ["..."],
  "criticalIssues": ["..."]
}

Output ONLY valid JSON.`,
      };

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: DEFAULT_MODELS.claudeSonnet,
          max_tokens: 8192,
          stream: false,
          messages: [{
            role: 'user',
            content: [...imageBlocks, textBlock],
          }],
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('[video-analyze] Anthropic error:', resp.status, errText);
        return sendError(res, 502, `Claude API error: ${resp.status}`);
      }

      const data = await resp.json();
      const responseText = data.content?.find(b => b.type === 'text')?.text || '{}';

      // Parse JSON from response
      let analysis;
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        analysis = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
      } catch {
        analysis = { overallScore: 0, error: 'Failed to parse analysis', raw: responseText.slice(0, 500) };
      }

      // Enrich with metadata
      analysis.id = `vua-${Date.now()}`;
      analysis.videoName = videoName || 'unknown';
      analysis.frameCount = frames.length;
      analysis.generatedAt = Date.now();

      res.json({ success: true, analysis });
    } catch (err) {
      console.error('[video-analyze] Error:', err);
      sendError(res, 500, err.message || 'Video analysis failed');
    }
  });

  app.post('/api/sites/extract-brief', requireAuth, async (req, res) => {
    try {
      const { sourceText, sourceType, contextHints, model } = req.body;
      if (!sourceText || typeof sourceText !== 'string' || sourceText.trim().length < 10) {
        return sendError(res, 400, 'sourceText is required (min 10 chars)');
      }

      const text = sourceText.trim();
      const llmModel = model || DEFAULT_MODELS.claudeSonnet;

      // --- Cache check ---
      const cacheKey = briefCacheKey(text, sourceType, contextHints);
      const cached = briefCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < BRIEF_CACHE_TTL) {
        console.log(`[extract-brief] Cache hit | key: ${cacheKey.slice(0, 12)}… | age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s`);
        return res.json({ success: true, brief: cached.brief, provider: cached.provider, cached: true });
      }

      const CHUNK_SIZE = 25000;
      const chunks = [];

      // Chunk if needed
      if (text.length > CHUNK_SIZE) {
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
          chunks.push(text.slice(i, i + CHUNK_SIZE));
        }
      } else {
        chunks.push(text);
      }

      const estimatedTokens = Math.ceil(text.length / 4);
      console.log(`[extract-brief] Starting extraction | input: ${text.length} chars (~${estimatedTokens} tokens) | chunks: ${chunks.length} | avg chunk: ${Math.round(text.length / chunks.length)} chars | model: ${llmModel}`);

      // Extract per chunk
      const partialBriefs = [];
      let lastProvider = 'anthropic';

      for (const chunk of chunks) {
        const prompt = `You are analyzing ${sourceType === 'THREAD' ? 'a conversation/thread' : 'a product description'} to extract a structured site brief for building a website.

${contextHints ? `Context hint: This is for a "${contextHints}" type business.` : ''}

INPUT:
${chunk}

Extract a structured JSON site brief. Output ONLY valid JSON, no markdown fences.

CRITICAL RULES:
- productName: Use EXACTLY the product/brand name from the input. NEVER rename or invent one.
- pricing: Only include pricing tiers if the input explicitly mentions them. If not mentioned, set tiers to empty array.
- Do NOT fabricate any numbers, stats, or claims. If the input says "500+ users" mark it as a requiredUnknown unless the speaker clearly states it as fact.
- requiredUnknowns: ONLY list items where fabricating a default would be HARMFUL or MISLEADING. For example: product name (if unclear), pricing tiers (if referenced but not specified), contact info (if a contact page is expected). Do NOT list things like testimonials, team bios, sample photos, user counts, or integration details — the builder can use sensible placeholders for those. Maximum 4 items.
- contactEmail, contactPhone, contactAddress: Extract EXACTLY as provided. If user says "my email is jake@gmail.com", store EXACTLY "jake@gmail.com". Never invent contact info. If not mentioned, set to empty string.

Schema:
{
  "productName": "string — EXACT product/brand name from input, never rename",
  "tagline": "string — short tagline extracted or inferred",
  "oneLinerPositioning": "string — one-sentence positioning statement",
  "businessType": "string — what kind of business/project",
  "icpGuess": "string — ideal customer profile guess",
  "targetAudience": "string — who this is for",
  "primaryPain": "string — main problem this solves",
  "primaryCTA": "string — main call to action (e.g. Start Free Trial, Book a Demo)",
  "toneStyle": "string — voice/tone",
  "goal": "string — primary goal of the website",
  "navPages": ["array of page names for main navigation"],
  "features": ["array of product features mentioned"],
  "integrations": ["array of integrations mentioned, or empty"],
  "pricing": {
    "hasFreePlan": false,
    "tiers": [{"name": "string", "priceMonthly": "string", "limitLabel": "string", "highlights": ["string"], "isMostPopular": false}],
    "trial": {"enabled": false, "days": 0, "requiresCard": false},
    "annual": {"enabled": false, "discountLabel": ""}
  },
  "designDirection": "string — suggested aesthetic",
  "requiredUnknowns": [{"id": "string", "question": "string", "reason": "string", "required": true}],
  "assumptions": ["array of assumptions made"],
  "constraints": {
    "NO_FABRICATED_STATS": true,
    "NO_RENAME_WITHOUT_APPROVAL": true,
    "NO_SECURITY_CLAIMS_UNLESS_PROVIDED": true
  },
  "coreProblem": "string — the core problem this product solves, in one sentence",
  "differentiators": ["array of 2-4 things that make this product different from alternatives"],
  "contactEmail": "string — email address if mentioned, or empty string",
  "contactPhone": "string — phone number if mentioned, or empty string",
  "contactAddress": "string — physical address if mentioned, or empty string",
  "socialLinks": {"platform": "url"},
  "operatingHours": "string — business hours if mentioned, or empty string",
  "pages": ["same as navPages, for compat"],
  "tone": "same as toneStyle, for compat",
  "ctas": ["array of CTA goals"]
}`;

        const result = await callLLMForBrief({
          prompt,
          system: 'Extract a site brief from the input. Output ONLY valid JSON.',
          maxTokens: 4096,
          model: llmModel,
        });

        lastProvider = result.provider;

        if (result.text) {
          let json = result.text.trim();
          if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          try {
            partialBriefs.push(JSON.parse(json));
          } catch { /* skip unparseable chunk */ }
        }
      }

      if (partialBriefs.length === 0) {
        return sendError(res, 500, 'Failed to extract brief from input');
      }

      // Merge if multiple chunks
      let brief;
      if (partialBriefs.length === 1) {
        brief = partialBriefs[0];
      } else {
        // Merge pass
        const mergePrompt = `Merge these partial site briefs into one consolidated brief. Output ONLY valid JSON with the same schema.

PARTIAL BRIEFS:
${JSON.stringify(partialBriefs, null, 2)}

Output the merged brief as a single JSON object.`;

        const mergeResult = await callLLMForBrief({
          prompt: mergePrompt,
          system: 'Merge partial briefs into one. Output ONLY valid JSON.',
          maxTokens: 4096,
          model: llmModel,
        });

        lastProvider = mergeResult.provider;

        if (mergeResult.text) {
          let json = mergeResult.text.trim();
          if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          try {
            brief = JSON.parse(json);
          } catch {
            brief = partialBriefs[0]; // Fallback to first
          }
        } else {
          brief = partialBriefs[0];
        }
      }

      // --- Build provenance map ---
      const provenance = {};
      const provenanceFields = [
        'productName', 'tagline', 'oneLinerPositioning', 'targetAudience',
        'primaryPain', 'primaryCTA', 'toneStyle', 'designDirection',
        'navPages', 'features', 'pricing',
        'contactEmail', 'contactPhone', 'contactAddress',
      ];
      for (const field of provenanceFields) {
        const val = brief[field];
        if (val === undefined || val === null || val === '' ||
            (Array.isArray(val) && val.length === 0) ||
            (typeof val === 'string' && /^(unknown|n\/a|not specified|tbd)$/i.test(val.trim()))) {
          provenance[field] = 'PLACEHOLDER';
        } else {
          provenance[field] = 'INFERRED';
        }
      }

      // --- Detect missing fields → missingQuestions ---
      const missingQuestions = [];
      if (!brief.productName || brief.productName.length < 2 || /^(unknown|my site|untitled)/i.test(brief.productName)) {
        missingQuestions.push({
          id: 'productName',
          question: 'What is the name of your product or brand?',
          reason: 'We need this to avoid making up a name for your site.',
          blocking: true,
        });
      }
      if (!brief.targetAudience || brief.targetAudience.length < 5) {
        missingQuestions.push({
          id: 'targetAudience',
          question: 'Who is the target audience for this website?',
          reason: 'This helps us write copy that resonates with the right people.',
          blocking: false,
        });
      }
      if (brief.pricing?.tiers?.length === 0 && (brief.features?.some(f => /pric/i.test(f)) || brief.navPages?.some(p => /pric/i.test(p)))) {
        missingQuestions.push({
          id: 'pricing',
          question: 'You mentioned pricing — what are your pricing tiers? (name, price, features for each)',
          reason: 'Pricing tiers were referenced but no specifics were provided.',
          blocking: true,
        });
      }
      if (!brief.primaryCTA || brief.primaryCTA.length < 3) {
        missingQuestions.push({
          id: 'primaryCTA',
          question: 'What should the main call-to-action button say? (e.g., "Start Free Trial", "Book a Demo")',
          reason: 'Every page needs a clear CTA.',
          blocking: false,
        });
      }

      // --- Cache the result ---
      briefCache.set(cacheKey, { brief, provider: lastProvider, timestamp: Date.now() });
      console.log(`[extract-brief] Cached result | key: ${cacheKey.slice(0, 12)}… | provider: ${lastProvider} | missing: ${missingQuestions.length}`);

      res.json({ success: true, brief, provider: lastProvider, provenance, missingQuestions });
    } catch (error) {
      console.error('[extract-brief] Failed:', error.message);
      const status = error.retryable !== undefined ? 502 : 500;
      return res.status(status).json({
        error: error.retryable ? 'LLM provider temporarily unavailable. Please retry.' : error.message,
        code: 'PROVIDER_ERROR',
        provider: error.provider || 'anthropic',
        request_id: error.requestId || '',
        retryable: error.retryable ?? true,
      });
    }
  });

  // ============================================================================
  // EXTRACT FROM URL
  // ============================================================================

  app.post('/api/sites/extract-from-url', requireAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        return sendError(res, 400, 'url is required');
      }

      // Fetch page content
      let pageContent = '';
      try {
        const fetchResp = await fetch(url, {
          headers: { 'User-Agent': 'ALIN/1.0 SiteExtractor' },
          signal: AbortSignal.timeout(10000),
        });
        if (!fetchResp.ok) {
          return sendError(res, 502, `Failed to fetch URL: HTTP ${fetchResp.status}`);
        }
        const html = await fetchResp.text();
        // Strip scripts, styles, and tags for text extraction
        pageContent = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 15000);
      } catch (fetchErr) {
        return sendError(res, 502, `Failed to fetch URL: ${fetchErr.message}`);
      }

      if (pageContent.length < 50) {
        return sendError(res, 422, 'Page content too short to extract product info');
      }

      // Ask LLM to extract product info
      const prompt = `Analyze this webpage content and extract product/company information.

URL: ${url}

CONTENT:
${pageContent}

Extract and return ONLY valid JSON:
{
  "productName": "string — product or company name",
  "tagline": "string — tagline or hero text",
  "businessType": "string — type of business",
  "targetAudience": "string — who this is for",
  "features": ["key features mentioned"],
  "toneStyle": "string — detected tone/voice",
  "designDirection": "string — detected design style"
}`;

      const result = await callLLMForBrief({
        prompt,
        system: 'Extract product info from webpage content. Output ONLY valid JSON.',
        maxTokens: 2048,
        model: DEFAULT_MODELS.claudeSonnet,
      });

      if (!result.text) {
        return sendError(res, 500, 'LLM returned no output');
      }

      let json = result.text.trim();
      if (json.startsWith('```')) json = json.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      try {
        const extracted = JSON.parse(json);
        res.json({ success: true, partial: extracted, url });
      } catch {
        return sendError(res, 500, 'Failed to parse LLM response as JSON');
      }
    } catch (error) {
      console.error('[extract-from-url] Failed:', error.message);
      return sendError(res, 500, error.message);
    }
  });

  // ============================================================================
  // EPHEMERAL SITE CLEANUP — runs every 24h, cleans up expired ephemeral sites
  // ============================================================================

  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  const CLEANUP_INITIAL_DELAY = 60 * 1000; // 60 seconds after startup

  setTimeout(() => {
    async function cleanupExpiredEphemeralSites() {
      const now = Date.now();
      let cleanedCount = 0;
      let errorCount = 0;

      try {
        const expired = stmts.listExpiredEphemeralSites.all(now);
        if (expired.length === 0) return;

        console.log(`[Ephemeral Cleanup] Found ${expired.length} expired ephemeral site(s)`);

        for (const site of expired) {
          try {
            // 1. Delete CF Pages project
            if (site.cloudflare_project_name && cfDeploy) {
              try {
                await cfDeploy.deleteProject(site.cloudflare_project_name);
              } catch (err) {
                console.warn(`[Ephemeral Cleanup] CF Pages delete failed for ${site.id}: ${err.message}`);
              }
            }

            // 2. Unregister domain from KV
            if (cfKV?.isConfigured && site.cloudflare_project_name) {
              try {
                const subdomain = site.cloudflare_project_name;
                await cfKV.unregisterDomain(subdomain);
                await cfKV.delete('version:' + site.id);
              } catch (err) {
                console.warn(`[Ephemeral Cleanup] KV cleanup failed for ${site.id}: ${err.message}`);
              }
            }

            // 3. Mark site as expired in DB
            db.prepare('UPDATE sites SET status=?, updated_at=? WHERE id=?').run('expired', now, site.id);

            // 4. Delete local storage files
            if (site.storage_path) {
              try {
                await fs.rm(site.storage_path, { recursive: true, force: true });
              } catch (err) {
                console.warn(`[Ephemeral Cleanup] File cleanup failed for ${site.id}: ${err.message}`);
              }
            }

            cleanedCount++;
          } catch (err) {
            errorCount++;
            console.error(`[Ephemeral Cleanup] Error cleaning site ${site.id}: ${err.message}`);
          }
        }

        console.log(`[Ephemeral Cleanup] Done: ${cleanedCount} cleaned, ${errorCount} errors`);
      } catch (err) {
        console.error('[Ephemeral Cleanup] Fatal error:', err.message);
      }
    }

    // Run immediately on startup (after delay), then every 24h
    cleanupExpiredEphemeralSites();
    setInterval(cleanupExpiredEphemeralSites, CLEANUP_INTERVAL);
    console.log('[Ephemeral Cleanup] Scheduler initialized (24h interval)');
  }, CLEANUP_INITIAL_DELAY);
}
