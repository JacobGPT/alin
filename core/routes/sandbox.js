/**
 * Sandbox Pipeline endpoints
 * /api/tbwo/:id/sandbox — run, status, deploy
 */
import { SandboxPipeline, getPipeline, setPipeline } from '../services/sandboxPipeline.js';

export function registerSandboxRoutes(ctx) {
  const { app, tbwoWorkspaces, requireAuth, sendError, PLAN_LIMITS, cfR2, cfKV, cfDeploy } = ctx;

  // POST /api/tbwo/:id/sandbox/run — Kick off validate→repair→package pipeline
  app.post('/api/tbwo/:id/sandbox/run', requireAuth, async (req, res) => {
    try {
      const limits = PLAN_LIMITS[req.user.plan || 'free'] || PLAN_LIMITS.free;
      if (!limits.tbwoEnabled) {
        return res.status(403).json({ error: 'TBWO is not available on your plan. Upgrade to Pro to access autonomous workflows.', code: 'TBWO_DISABLED' });
      }
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found. Init workspace first.' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const { throughStage = 'package', brief, expectedPages, approvedClaims } = req.body;

      const pipeline = new SandboxPipeline(req.params.id, req.user.id, {
        brief: brief || null,
        expectedPages: expectedPages || [],
        approvedClaims: approvedClaims || [],
      });

      await pipeline.init(ws.path);
      setPipeline(req.params.id, pipeline);

      // Run pipeline in background
      res.json({ started: true, stage: 'init' });

      // Non-blocking execution
      pipeline.run(throughStage).catch(err => {
        console.error(`[SandboxPipeline] ${req.params.id} failed:`, err.message);
        pipeline.error = err.message;
        pipeline.stage = 'failed';
      });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // GET /api/tbwo/:id/sandbox/status — Poll pipeline progress
  app.get('/api/tbwo/:id/sandbox/status', requireAuth, async (req, res) => {
    try {
      const pipeline = getPipeline(req.params.id);
      if (!pipeline) {
        return res.json({ stage: 'none', stageLog: [], artifacts: {}, progress: 0 });
      }
      res.json(pipeline.getProgress());
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // POST /api/tbwo/:id/sandbox/deploy — Trigger deploy stage
  app.post('/api/tbwo/:id/sandbox/deploy', requireAuth, async (req, res) => {
    try {
      const ws = tbwoWorkspaces.get(req.params.id);
      if (!ws) return res.status(404).json({ error: 'Workspace not found' });
      if (ws.userId !== req.user.id) return res.status(403).json({ error: 'Not your workspace' });

      const tbwoId = req.params.id;
      const userId = req.user.id;
      const cfProjectName = `alin-site-${tbwoId.slice(0, 8)}`;

      // Prefer R2 + KV path for *.alinai.dev subdomains
      if (cfR2.isConfigured) {
        const r2Result = await cfR2.deploySite(tbwoId, ws.path, 1);
        const subdomain = cfProjectName;
        const liveUrl = `https://${subdomain}.${process.env.ALIN_SITES_DOMAIN || 'alinai.dev'}`;

        if (cfKV.isConfigured) {
          await cfKV.registerDomain(subdomain, userId, tbwoId, 1);
          await cfKV.setActiveVersion(tbwoId, 1, tbwoId);
        }

        res.json({ deploymentId: tbwoId, url: liveUrl, status: 'deployed', fileCount: r2Result.fileCount });
      } else if (cfDeploy.isConfigured) {
        // Fallback: Cloudflare Pages direct upload
        await cfDeploy.ensureProject(cfProjectName);
        const result = await cfDeploy.deploy(cfProjectName, ws.path);
        res.json({ deploymentId: result.id || tbwoId, url: result.url || null, status: 'deployed' });
      } else {
        res.json({ deploymentId: tbwoId, url: null, status: 'no_deploy_adapter' });
      }
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}
