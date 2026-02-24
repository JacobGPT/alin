/**
 * TBWO Receipt + Order + Execute endpoints
 * /api/tbwo — CRUD, receipts, execute pipeline
 */
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { runTBWOPipeline, VALID_TBWO_TYPES, getTBWOTypeConfig } from '../services/tbwoOrchestrator.js';
import { CREDIT_COSTS } from '../config/index.js';
import { deductCredits, checkCredits } from '../services/creditService.js';

export function registerTBWORoutes(ctx) {
  const { app, db, stmts, requireAuth, sendError, safeJsonParse, PLAN_LIMITS, getQuotaCount, incrementQuota, tbwoWorkspaces } = ctx;

  const toolGenerateImage = ctx.toolGenerateImage || (async () => ({ success: false, error: 'Image generation not available' }));

  // ============================================================================
  // TBWO RECEIPT ENDPOINTS
  // ============================================================================

  app.post('/api/tbwo/:tbwoId/receipts', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { type, data } = req.body;
      const id = randomUUID();
      stmts.insertReceipt.run(id, req.params.tbwoId, type || 'full', JSON.stringify(data), Date.now(), userId);
      console.log(`[DB] Saved receipt for TBWO: ${req.params.tbwoId}`);
      res.json({ success: true, id });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/tbwo/:tbwoId/receipts', requireAuth, (req, res) => {
    try {
      const receipts = stmts.getReceipts.all(req.params.tbwoId, req.user.id).map(r => ({ ...r, data: JSON.parse(r.data) }));
      res.json({ success: true, receipts });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // TBWO ORDER ENDPOINTS
  // ============================================================================

  app.get('/api/tbwo', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const rows = stmts.listTBWOs.all(userId, limit, offset);
      const tbwos = rows.map(r => {
        const t = { ...r };
        try { t.quality_target = JSON.parse(t.quality_target || '{}'); } catch { t.quality_target = {}; }
        try { t.scope = JSON.parse(t.scope || '{}'); } catch { t.scope = {}; }
        try { t.plan = JSON.parse(t.plan || 'null'); } catch { t.plan = null; }
        try { t.pods = JSON.parse(t.pods || '[]'); } catch { t.pods = []; }
        try { t.active_pods = JSON.parse(t.active_pods || '[]'); } catch { t.active_pods = []; }
        try { t.artifacts = JSON.parse(t.artifacts || '[]'); } catch { t.artifacts = []; }
        try { t.checkpoints = JSON.parse(t.checkpoints || '[]'); } catch { t.checkpoints = []; }
        try { t.receipts = JSON.parse(t.receipts || 'null'); } catch { t.receipts = null; }
        try { t.metadata = JSON.parse(t.metadata || '{}'); } catch { t.metadata = {}; }
        // Map DB column names to camelCase for frontend
        return {
          id: t.id, type: t.type, status: t.status, objective: t.objective,
          timeBudget: { total: t.time_budget_total },
          qualityTarget: t.quality_target, scope: t.scope, plan: t.plan,
          pods: t.pods, activePods: t.active_pods, artifacts: t.artifacts,
          checkpoints: t.checkpoints, authorityLevel: t.authority_level,
          progress: t.progress, receipts: t.receipts,
          chatConversationId: t.chat_conversation_id,
          startedAt: t.started_at, completedAt: t.completed_at,
          metadata: t.metadata, createdAt: t.created_at, updatedAt: t.updated_at,
        };
      });
      res.json({ success: true, tbwos });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.post('/api/tbwo', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
      if (!limits.tbwoEnabled) {
        return res.status(403).json({ error: 'TBWO is not available on your plan. Upgrade to Pro to access autonomous workflows.', code: 'TBWO_DISABLED' });
      }
      if (limits.tbwoRunsPerMonth > 0) {
        const used = getQuotaCount(userId, 'tbwo_runs');
        if (used >= limits.tbwoRunsPerMonth) {
          return res.status(429).json({ error: 'Monthly TBWO run limit reached', used, limit: limits.tbwoRunsPerMonth, code: 'TBWO_QUOTA_EXCEEDED' });
        }
      }
      const b = req.body;
      const tbwoType = b.type || 'custom';
      if (tbwoType !== 'custom' && tbwoType !== 'general' && !VALID_TBWO_TYPES.has(tbwoType)) {
        return res.status(400).json({ error: `Invalid TBWO type: ${tbwoType}`, validTypes: [...VALID_TBWO_TYPES, 'custom'] });
      }
      const id = b.id || randomUUID();
      const now = Date.now();
      stmts.insertTBWO.run(
        id, tbwoType, b.status || 'draft', b.objective || '',
        b.timeBudgetTotal || b.timeBudget?.total || 60,
        JSON.stringify(b.qualityTarget || {}), JSON.stringify(b.scope || {}),
        JSON.stringify(b.plan || null), JSON.stringify(b.pods || []),
        JSON.stringify(b.activePods || []), JSON.stringify(b.artifacts || []),
        JSON.stringify(b.checkpoints || []), b.authorityLevel || 'guided',
        b.progress || 0, JSON.stringify(b.receipts || null),
        b.chatConversationId || null, b.startedAt || null, b.completedAt || null,
        JSON.stringify(b.metadata || {}), b.createdAt || now, b.updatedAt || now, userId
      );
      incrementQuota(userId, 'tbwo_runs');
      res.json({ success: true, id });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/tbwo/:id', requireAuth, (req, res) => {
    try {
      const row = stmts.getTBWO.get(req.params.id, req.user.id);
      if (!row) return res.status(404).json({ error: 'TBWO not found' });
      const t = { ...row };
      try { t.quality_target = JSON.parse(t.quality_target || '{}'); } catch { t.quality_target = {}; }
      try { t.scope = JSON.parse(t.scope || '{}'); } catch { t.scope = {}; }
      try { t.plan = JSON.parse(t.plan || 'null'); } catch { t.plan = null; }
      try { t.pods = JSON.parse(t.pods || '[]'); } catch { t.pods = []; }
      try { t.active_pods = JSON.parse(t.active_pods || '[]'); } catch { t.active_pods = []; }
      try { t.artifacts = JSON.parse(t.artifacts || '[]'); } catch { t.artifacts = []; }
      try { t.checkpoints = JSON.parse(t.checkpoints || '[]'); } catch { t.checkpoints = []; }
      try { t.receipts = JSON.parse(t.receipts || 'null'); } catch { t.receipts = null; }
      try { t.metadata = JSON.parse(t.metadata || '{}'); } catch { t.metadata = {}; }
      res.json({
        success: true,
        tbwo: {
          id: t.id, type: t.type, status: t.status, objective: t.objective,
          timeBudget: { total: t.time_budget_total },
          qualityTarget: t.quality_target, scope: t.scope, plan: t.plan,
          pods: t.pods, activePods: t.active_pods, artifacts: t.artifacts,
          checkpoints: t.checkpoints, authorityLevel: t.authority_level,
          progress: t.progress, receipts: t.receipts,
          chatConversationId: t.chat_conversation_id,
          startedAt: t.started_at, completedAt: t.completed_at,
          metadata: t.metadata, createdAt: t.created_at, updatedAt: t.updated_at,
        },
      });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.patch('/api/tbwo/:id', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const e = stmts.getTBWO.get(req.params.id, userId);
      if (!e) return res.status(404).json({ error: 'Not found' });
      const b = req.body;
      const now = Date.now();
      stmts.updateTBWO.run(
        b.type ?? e.type, b.status ?? e.status, b.objective ?? e.objective,
        b.timeBudgetTotal ?? b.timeBudget?.total ?? e.time_budget_total,
        b.qualityTarget ? JSON.stringify(b.qualityTarget) : e.quality_target,
        b.scope ? JSON.stringify(b.scope) : e.scope,
        b.plan !== undefined ? JSON.stringify(b.plan) : e.plan,
        b.pods ? JSON.stringify(b.pods) : e.pods,
        b.activePods ? JSON.stringify(b.activePods) : e.active_pods,
        b.artifacts ? JSON.stringify(b.artifacts) : e.artifacts,
        b.checkpoints ? JSON.stringify(b.checkpoints) : e.checkpoints,
        b.authorityLevel ?? e.authority_level,
        b.progress ?? e.progress,
        b.receipts !== undefined ? JSON.stringify(b.receipts) : e.receipts,
        b.chatConversationId ?? e.chat_conversation_id,
        b.startedAt ?? e.started_at, b.completedAt ?? e.completed_at,
        b.metadata ? JSON.stringify(b.metadata) : e.metadata,
        b.execution_state !== undefined ? (b.execution_state === null ? null : (typeof b.execution_state === 'string' ? b.execution_state : JSON.stringify(b.execution_state))) : (e.execution_state || null),
        now, req.params.id, userId
      );
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.delete('/api/tbwo/:id', requireAuth, (req, res) => {
    try { stmts.deleteTBWO.run(req.params.id, req.user.id); res.json({ success: true }); }
    catch (error) { sendError(res, 500, error.message); }
  });

  // ============================================================================
  // PUBLISH REPORT AS SITE
  // ============================================================================

  app.post('/api/tbwo/:id/publish-report', requireAuth, async (req, res) => {
    try {
      const tbwo = stmts.getTBWO.get(req.params.id, req.user.id);
      if (!tbwo) return res.status(404).json({ error: 'TBWO not found' });
      if (tbwo.status !== 'completed') return res.status(400).json({ error: 'TBWO must be completed before publishing' });

      // Read artifacts from TBWO
      const artifacts = safeJsonParse(tbwo.artifacts, []);
      const reportArtifact = artifacts.find(a => (a.path || a.name || '').endsWith('REPORT.md'));
      const sourcesArtifact = artifacts.find(a => (a.path || a.name || '').endsWith('SOURCES.md'));
      const execSummaryArtifact = artifacts.find(a => (a.path || a.name || '').endsWith('EXECUTIVE_SUMMARY.md'));

      if (!reportArtifact || !reportArtifact.content) {
        return res.status(400).json({ error: 'No REPORT.md found in TBWO artifacts' });
      }

      // Simple markdown → HTML conversion
      function mdToHtml(md) {
        return md
          .replace(/^### (.+)$/gm, '<h3 id="$1">$1</h3>')
          .replace(/^## (.+)$/gm, '<h2 id="$1">$1</h2>')
          .replace(/^# (.+)$/gm, '<h1>$1</h1>')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.+?)\*/g, '<em>$1</em>')
          .replace(/`(.+?)`/g, '<code>$1</code>')
          .replace(/^\- (.+)$/gm, '<li>$1</li>')
          .replace(/(<li>.*<\/li>\n?)+/gm, (match) => `<ul>${match}</ul>`)
          .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
          .replace(/^(?!<[hulo]|<li|<\/)((?!^\s*$).+)$/gm, '<p>$1</p>')
          .replace(/\n{2,}/g, '\n');
      }

      // Generate Table of Contents from headings
      const tocEntries = [];
      const headingRegex = /^(#{2,3}) (.+)$/gm;
      let match;
      while ((match = headingRegex.exec(reportArtifact.content)) !== null) {
        const level = match[1].length;
        const text = match[2].trim();
        const id = text.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
        tocEntries.push({ level, text, id });
      }

      const tocHtml = tocEntries.length > 0
        ? `<nav class="toc"><h2>Contents</h2><ul>${tocEntries.map(e =>
            `<li class="toc-${e.level === 2 ? 'h2' : 'h3'}"><a href="#${e.id}">${e.text}</a></li>`
          ).join('')}</ul></nav>`
        : '';

      const reportHtml = mdToHtml(reportArtifact.content);
      const sourcesHtml = sourcesArtifact ? mdToHtml(sourcesArtifact.content) : '';
      const execSummaryHtml = execSummaryArtifact ? mdToHtml(execSummaryArtifact.content) : '';
      const genDate = new Date().toISOString().split('T')[0];

      const html = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${tbwo.objective || 'Report'}</title>
  <style>
    :root { --bg: #0f172a; --surface: #1e293b; --border: #334155; --text: #e2e8f0; --text-muted: #94a3b8; --accent: #6366f1; --accent-light: #818cf8; }
    [data-theme="light"] { --bg: #f8fafc; --surface: #ffffff; --border: #e2e8f0; --text: #1e293b; --text-muted: #64748b; --accent: #4f46e5; --accent-light: #6366f1; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
    .container { max-width: 900px; margin: 0 auto; padding: 2rem; }
    .header { border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; margin-bottom: 2rem; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 1.75rem; font-weight: 700; }
    .theme-toggle { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.875rem; }
    .layout { display: grid; grid-template-columns: 200px 1fr; gap: 2rem; }
    .toc { position: sticky; top: 2rem; }
    .toc h2 { font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: 0.75rem; }
    .toc ul { list-style: none; }
    .toc li { margin-bottom: 0.25rem; }
    .toc a { font-size: 0.8125rem; color: var(--text-muted); text-decoration: none; transition: color 0.15s; }
    .toc a:hover { color: var(--accent); }
    .toc-h3 { padding-left: 1rem; }
    .content h1 { font-size: 1.5rem; margin: 2rem 0 1rem; }
    .content h2 { font-size: 1.25rem; margin: 2rem 0 0.75rem; padding-top: 1rem; border-top: 1px solid var(--border); }
    .content h3 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    .content p { margin-bottom: 1rem; }
    .content ul, .content ol { margin: 0 0 1rem 1.5rem; }
    .content li { margin-bottom: 0.25rem; }
    .content code { background: var(--surface); padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875em; }
    .content a { color: var(--accent-light); text-decoration: underline; }
    .content strong { color: var(--text); }
    .content table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    .content th, .content td { padding: 0.5rem; border: 1px solid var(--border); text-align: left; font-size: 0.875rem; }
    .content th { background: var(--surface); font-weight: 600; }
    .exec-summary { background: var(--surface); border: 1px solid var(--border); border-radius: 0.75rem; padding: 1.5rem; margin-bottom: 2rem; }
    .exec-summary h2 { margin: 0 0 1rem; border: none; padding: 0; }
    .sources { margin-top: 3rem; padding-top: 2rem; border-top: 2px solid var(--border); }
    .footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); text-align: center; color: var(--text-muted); font-size: 0.8125rem; }
    @media print { .toc, .theme-toggle { display: none; } .layout { grid-template-columns: 1fr; } body { background: white; color: black; } }
    @media (max-width: 768px) { .layout { grid-template-columns: 1fr; } .toc { position: static; margin-bottom: 2rem; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${tbwo.objective || 'Report'}</h1>
      <button class="theme-toggle" onclick="document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'">Toggle Theme</button>
    </div>
    ${execSummaryHtml ? `<div class="exec-summary"><h2>Executive Summary</h2>${execSummaryHtml}</div>` : ''}
    <div class="layout">
      ${tocHtml}
      <div class="content">
        ${reportHtml}
        ${sourcesHtml ? `<div class="sources"><h2>Sources</h2>${sourcesHtml}</div>` : ''}
      </div>
    </div>
    <div class="footer">Generated by ALIN &middot; ${genDate}</div>
  </div>
</body>
</html>`;

      // Create site record
      const siteId = randomUUID();
      const now = Date.now();
      const storagePath = path.join(os.tmpdir(), 'alin-sites', siteId);
      await fs.mkdir(storagePath, { recursive: true });
      await fs.writeFile(path.join(storagePath, 'index.html'), html, 'utf8');

      stmts.insertSite.run(
        siteId, req.user.id, null, tbwo.objective || 'Report',
        req.params.id, 'preview', null, null,
        JSON.stringify({ pages: ['index.html'], reportTbwoId: req.params.id }),
        storagePath, 0, null, now, now
      );

      res.json({
        success: true,
        siteId,
        previewUrl: `/api/preview/${siteId}/index.html`,
      });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/tbwo/:id/execute — Run the full multi-model website build pipeline.
   * Accepts body: { qualityTier: 'standard' | 'premium' | 'ultra' }
   */
  app.post('/api/tbwo/:id/execute', requireAuth, async (req, res) => {
    try {
      const tbwo = stmts.getTBWO.get(req.params.id, req.user.id);
      if (!tbwo) return res.status(404).json({ error: 'TBWO not found' });

      // Auto-init workspace if not exists
      if (!tbwoWorkspaces.has(req.params.id)) {
        const wsPath = path.join(os.tmpdir(), 'alin-tbwo-workspaces', req.params.id);
        await fs.mkdir(wsPath, { recursive: true });
        tbwoWorkspaces.set(req.params.id, { path: wsPath, userId: req.user.id, createdAt: Date.now() });
      }
      const workspacePath = tbwoWorkspaces.get(req.params.id).path;

      // Determine quality tier and type config
      const tbwoMetadata = safeJsonParse(tbwo.metadata, {});
      const qualityTier = req.body.qualityTier || tbwoMetadata.qualityTier || 'standard';
      const typeConfig = getTBWOTypeConfig(tbwo.type);

      // Block execution for types without a backend pipeline config
      if (!typeConfig && tbwo.type !== 'custom' && tbwo.type !== 'general') {
        return res.status(400).json({
          error: `Pipeline not yet available for type: ${tbwo.type}`,
          code: 'TBWO_TYPE_NOT_IMPLEMENTED',
          hint: 'This TBWO type is coming soon. Try Website Sprint, Research Report, or Market Research.',
        });
      }

      // Parse the brief from the TBWO order
      const brief = safeJsonParse(tbwo.scope, {});

      // ── Unified credit check (pre-execution) ──
      const baseCost = CREDIT_COSTS.tbwo[tbwo.type] || CREDIT_COSTS.tbwo.custom;
      const tierMult = CREDIT_COSTS.tierMultiplier[qualityTier] || 1;
      const estimatedCost = Math.ceil(baseCost * tierMult);

      if (!req.user.isAdmin) {
        const plan = req.user.plan || 'free';
        const check = checkCredits(stmts, req.user.id, estimatedCost, plan);
        if (!check.ok && !check.unlimited) {
          return res.status(402).json({
            error: 'Insufficient credits for this TBWO',
            required: estimatedCost,
            available: check.balance,
            plan,
            code: 'INSUFFICIENT_CREDITS',
          });
        }
      }

      // Update status to running
      const now = Date.now();
      stmts.updateTBWO.run(
        tbwo.type, 'running', tbwo.objective, tbwo.time_budget_total,
        tbwo.quality_target, tbwo.scope, tbwo.plan, tbwo.pods, tbwo.active_pods,
        tbwo.artifacts, tbwo.checkpoints, tbwo.authority_level, 0,
        tbwo.receipts, tbwo.chat_conversation_id, now, null,
        JSON.stringify({ ...tbwoMetadata, qualityTier }),
        tbwo.execution_state || null,
        now, req.params.id, req.user.id
      );

      res.json({ started: true, tbwoId: req.params.id, qualityTier, estimatedCost });

      // Run pipeline in background (non-blocking)
      let lastBilledPct = 0;

      runTBWOPipeline({
        objective: tbwo.objective,
        brief,
        tbwoId: req.params.id,
        tbwoType: tbwo.type,
        typeConfig,
        userId: req.user.id,
        qualityTier,
        workspacePath,
        generateImage: toolGenerateImage,
        onRecallMemories: async (query) => {
          try {
            const rows = stmts.listMemories.all(req.user.id);
            const queryLower = query.slice(0, 30).toLowerCase();
            const relevant = rows
              .filter(r => {
                const tags = JSON.parse(r.tags || '[]');
                return tags.some(t => t.startsWith('report:')) ||
                       r.content.toLowerCase().includes(queryLower);
              })
              .slice(0, 5);
            if (relevant.length === 0) return null;
            return relevant.map(m => `- ${m.content.slice(0, 300)}`).join('\n');
          } catch { return null; }
        },
        onProgress: (phase, pct, msg) => {
          try {
            const current = stmts.getTBWO.get(req.params.id, req.user.id);
            if (current) {
              const checkpoints = safeJsonParse(current.checkpoints, []);
              checkpoints.push({ phase, progress: pct, message: msg, timestamp: Date.now() });
              stmts.updateTBWO.run(
                current.type, 'running', current.objective, current.time_budget_total,
                current.quality_target, current.scope, current.plan, current.pods, current.active_pods,
                current.artifacts, JSON.stringify(checkpoints), current.authority_level, pct,
                current.receipts, current.chat_conversation_id, current.started_at, null,
                current.metadata, current.execution_state || null,
                Date.now(), req.params.id, req.user.id
              );
            }
          } catch (e) { console.error('[TBWO] Progress update failed:', e.message); }

          // Per-stage credit deduction (proportional to progress delta)
          if (!req.user.isAdmin && pct > lastBilledPct && phase !== 'complete') {
            try {
              const delta = pct - lastBilledPct;
              const creditCost = Math.max(1, Math.ceil(estimatedCost * delta / 100));
              deductCredits(db, stmts, req.user.id, creditCost,
                `TBWO ${phase}: ${(tbwo.objective || '').substring(0, 40)}`,
                req.params.id
              );
              lastBilledPct = pct;
            } catch (e) {
              console.error('[TBWO] Credit deduction failed:', e.message);
            }
          }
        },
        onFile: async (filePath, content) => {
          const fullPath = path.join(workspacePath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf8');

          // Create artifact record and update TBWO artifacts column
          try {
            const artifactId = randomUUID();
            const fileNow = Date.now();
            const ext = (filePath.split('.').pop() || '').toLowerCase();
            const artifactType = ext === 'html' ? 'html' : ext === 'css' ? 'css'
              : ext === 'js' || ext === 'ts' ? 'code' : ext === 'json' ? 'json'
              : ext === 'md' ? 'markdown' : ext === 'svg' ? 'svg' : 'file';
            const lang = ext === 'js' ? 'javascript' : ext === 'ts' ? 'typescript'
              : ext === 'html' ? 'html' : ext === 'css' ? 'css' : ext === 'json' ? 'json'
              : ext === 'md' ? 'markdown' : ext;
            const fileName = filePath.split('/').pop() || filePath;
            const safeContent = content.length > 500000 ? content.substring(0, 500000) : content;

            // Insert into artifacts table (cross-reference)
            stmts.insertArtifact.run(
              artifactId, fileName, artifactType, lang, safeContent,
              1, null, req.params.id, '{}', fileNow, fileNow, req.user.id
            );

            // Append to TBWO artifacts JSON column
            const current = stmts.getTBWO.get(req.params.id, req.user.id);
            if (current) {
              const existingArtifacts = safeJsonParse(current.artifacts, []);
              existingArtifacts.push({
                id: artifactId,
                name: fileName,
                path: filePath,
                type: artifactType,
                content: safeContent,
                createdAt: fileNow,
              });
              stmts.updateTBWO.run(
                current.type, current.status, current.objective, current.time_budget_total,
                current.quality_target, current.scope, current.plan, current.pods, current.active_pods,
                JSON.stringify(existingArtifacts), current.checkpoints, current.authority_level, current.progress,
                current.receipts, current.chat_conversation_id, current.started_at, current.completed_at,
                current.metadata, current.execution_state || null,
                fileNow, req.params.id, req.user.id
              );
            }
          } catch (e) {
            console.error('[TBWO] Artifact record creation failed:', e.message);
          }
        },
      }).then(result => {
        try {
          const current = stmts.getTBWO.get(req.params.id, req.user.id);
          if (current) {
            stmts.updateTBWO.run(
              current.type, 'completed', current.objective, current.time_budget_total,
              current.quality_target, current.scope, current.plan,
              JSON.stringify(result.pods), '[]',
              current.artifacts, current.checkpoints, current.authority_level, 100,
              current.receipts, current.chat_conversation_id, current.started_at, Date.now(),
              JSON.stringify({ ...safeJsonParse(current.metadata, {}), result }),
              current.execution_state || null,
              Date.now(), req.params.id, req.user.id
            );
          }
          console.log(`[TBWO ${req.params.id.slice(0, 8)}] COMPLETED [${result.tierLabel}] — Cost: ${result.costEstimate}, Quality: ${result.qualityScore}/10`);

          // Silent training data collection — fire-and-forget
          try {
            ctx.trainingData?.collectTBWOCompletion?.({
              userId: req.user.id,
              tbwoId: req.params.id,
              objective: current.objective,
              result,
              qualityTier: current.quality_target,
            });
          } catch {}

          // ── Report-specific post-completion hooks ──
          if (result.pipelineType === 'report') {
            // 1. Store top insights as LONG_TERM memories
            try {
              const topFindings = (result.scope?.primaryQuestions || [])
                .concat(result.pods?.filter(p => p.phase === 'analyze').length > 0
                  ? ['Analysis completed with ' + (result.analysisConfidence || 'unknown') + ' confidence']
                  : []);
              const objectiveSlug = (current.objective || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
              const tags = JSON.stringify(['report', `report:${tbwo.type}`, `topic:${objectiveSlug}`]);
              const meta = JSON.stringify({ tbwoId: req.params.id, reportType: tbwo.type, confidence: result.analysisConfidence, source: 'report_pipeline' });

              for (const finding of topFindings.slice(0, 5)) {
                const memId = randomUUID();
                const now = Date.now();
                stmts.insertMemory.run(
                  memId, 'long_term', finding, 0.8, 0.01, 0, 0, 0, 0, 0,
                  tags, '[]', '[]', meta, now, now, now, req.user.id
                );
              }
              // Also store the scope as a SEMANTIC memory
              const scopeMemId = randomUUID();
              const scopeContent = `Report scope for "${current.objective}": ${JSON.stringify(result.scope || {}).slice(0, 500)}`;
              stmts.insertMemory.run(
                scopeMemId, 'semantic', scopeContent, 0.6, 0.02, 0, 0, 0, 0, 0,
                tags, '[]', '[]', meta, Date.now(), Date.now(), Date.now(), req.user.id
              );
              console.log(`[TBWO ${req.params.id.slice(0, 8)}] Stored ${topFindings.slice(0, 5).length + 1} report memories`);
            } catch (e) {
              console.error('[TBWO] Memory storage failed:', e.message);
            }

            // 2. Record execution outcome in self-model
            try {
              const outcomeId = randomUUID();
              stmts.insertOutcome.run(
                outcomeId, req.params.id, current.objective, tbwo.type,
                current.time_budget_total, 0,
                result.pods?.length || 5, 0,
                result.pages?.length || 0, 0,
                result.qualityScore || 0, Date.now(), req.user.id
              );
            } catch (e) {
              console.error('[TBWO] Self-model outcome recording failed:', e.message);
            }

            // 3. Record per-phase model success rates
            try {
              for (const pod of (result.pods || [])) {
                stmts.upsertModelSuccessRate.run(
                  pod.model || 'unknown', 1, 0, pod.durationMs || 0, Date.now()
                );
              }
            } catch (e) {
              console.error('[TBWO] Model success rate recording failed:', e.message);
            }
          }
        } catch (e) { console.error('[TBWO] Completion update failed:', e.message); }
      }).catch(err => {
        console.error(`[TBWO ${req.params.id.slice(0, 8)}] FAILED:`, err.message);
        try {
          const current = stmts.getTBWO.get(req.params.id, req.user.id);
          if (current) {
            stmts.updateTBWO.run(
              current.type, 'failed', current.objective, current.time_budget_total,
              current.quality_target, current.scope, current.plan, current.pods, current.active_pods,
              current.artifacts, current.checkpoints, current.authority_level, current.progress,
              current.receipts, current.chat_conversation_id, current.started_at, Date.now(),
              JSON.stringify({ ...safeJsonParse(current.metadata, {}), error: err.message }),
              current.execution_state || null,
              Date.now(), req.params.id, req.user.id
            );
          }
        } catch {}
      });

    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}
