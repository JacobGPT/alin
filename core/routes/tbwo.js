/**
 * TBWO Receipt + Order + Execute endpoints
 * /api/tbwo — CRUD, receipts, execute pipeline
 */
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { runTBWOPipeline, VALID_TBWO_TYPES, getTBWOTypeConfig } from '../services/tbwoOrchestrator.js';

export function registerTBWORoutes(ctx) {
  const { app, stmts, requireAuth, sendError, safeJsonParse, PLAN_LIMITS, getQuotaCount, incrementQuota, tbwoWorkspaces } = ctx;

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

      // Parse the brief from the TBWO order
      const brief = safeJsonParse(tbwo.scope, {});

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

      res.json({ started: true, tbwoId: req.params.id, qualityTier });

      // Run pipeline in background (non-blocking)
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
        },
        onFile: async (filePath, content) => {
          const fullPath = path.join(workspacePath, filePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf8');
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
