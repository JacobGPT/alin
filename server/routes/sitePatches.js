/**
 * Site Patch endpoints
 * /api/sites/:siteId/patch — plan, apply, reject, list
 */
import { randomUUID } from 'crypto';
import { generatePatchPlan, applyPatchPlan } from '../services/sitePatchPlanner.js';

export function registerSitePatchRoutes(ctx) {
  const { app, stmts, requireAuth, sendError } = ctx;

  const callClaudeSync = ctx.callClaudeSync || null;

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // --- Plan a patch: Claude analyzes site files + change request ---
  app.post('/api/sites/:siteId/patch/plan', requireAuth, async (req, res) => {
    try {
      const site = stmts.getSite.get(req.params.siteId, req.user.id);
      if (!site) return sendError(res, 404, 'Site not found');
      if (!site.storage_path) return sendError(res, 400, 'Site has no files');

      const { changeRequest } = req.body;
      if (!changeRequest || typeof changeRequest !== 'string' || changeRequest.trim().length < 3) {
        return sendError(res, 400, 'changeRequest is required (min 3 chars)');
      }

      const patchId = randomUUID();
      const now = Date.now();

      // Insert patch record as 'planning'
      stmts.insertPatch.run(patchId, site.id, req.user.id, changeRequest.trim(), null, 'planning', now);

      // Generate plan (async — respond with patchId immediately, update when done)
      res.json({ success: true, patchId, status: 'planning' });

      // Background: call Claude to generate patch plan
      (async () => {
        try {
          const plan = await generatePatchPlan(callClaudeSync, site.storage_path, changeRequest.trim());
          stmts.updatePatch.run(JSON.stringify(plan), 'planned', null, null, patchId, req.user.id);
        } catch (err) {
          console.error('[SitePatch] Plan generation failed:', err.message);
          stmts.updatePatch.run(null, 'failed', JSON.stringify({ error: err.message }), Date.now(), patchId, req.user.id);
        }
      })();
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Get a specific patch plan ---
  app.get('/api/sites/:siteId/patches/:patchId', requireAuth, (req, res) => {
    try {
      const patch = stmts.getPatch.get(req.params.patchId, req.user.id);
      if (!patch) return sendError(res, 404, 'Patch not found');
      // Parse plan JSON if present
      if (patch.plan) {
        try { patch.plan = JSON.parse(patch.plan); } catch { /* leave as string */ }
      }
      if (patch.apply_result) {
        try { patch.apply_result = JSON.parse(patch.apply_result); } catch { /* leave as string */ }
      }
      res.json({ success: true, patch });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- List patches for a site ---
  app.get('/api/sites/:siteId/patches', requireAuth, (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const patches = stmts.listPatches.all(req.params.siteId, req.user.id, limit);
      // Parse JSON fields
      for (const p of patches) {
        if (p.plan) { try { p.plan = JSON.parse(p.plan); } catch { /* leave */ } }
        if (p.apply_result) { try { p.apply_result = JSON.parse(p.apply_result); } catch { /* leave */ } }
      }
      res.json({ success: true, patches });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Apply a patch plan to the site workspace ---
  app.post('/api/sites/:siteId/patch/:patchId/apply', requireAuth, async (req, res) => {
    try {
      const site = stmts.getSite.get(req.params.siteId, req.user.id);
      if (!site) return sendError(res, 404, 'Site not found');
      if (!site.storage_path) return sendError(res, 400, 'Site has no files');

      const patch = stmts.getPatch.get(req.params.patchId, req.user.id);
      if (!patch) return sendError(res, 404, 'Patch not found');
      if (patch.status !== 'planned' && patch.status !== 'approved') {
        return sendError(res, 400, `Cannot apply patch in status: ${patch.status}`);
      }

      let plan;
      try {
        plan = typeof patch.plan === 'string' ? JSON.parse(patch.plan) : patch.plan;
      } catch {
        return sendError(res, 400, 'Invalid patch plan data');
      }

      if (!plan || !Array.isArray(plan.changes) || plan.changes.length === 0) {
        return sendError(res, 400, 'Patch plan has no changes');
      }

      // Check for unresolved PLACEHOLDERs
      const placeholders = plan.placeholders || [];
      if (placeholders.length > 0) {
        // Check if user provided replacements in request body
        const replacements = req.body.replacements || {};
        for (const change of plan.changes) {
          if (change.after && typeof change.after === 'string') {
            for (const [placeholder, value] of Object.entries(replacements)) {
              change.after = change.after.replace(new RegExp(escapeRegex(placeholder), 'g'), value);
            }
          }
        }
      }

      // Apply the patch
      const result = await applyPatchPlan(site.storage_path, plan);
      const now = Date.now();
      stmts.updatePatch.run(
        typeof patch.plan === 'string' ? patch.plan : JSON.stringify(plan),
        result.failed > 0 ? 'partially_applied' : 'applied',
        JSON.stringify(result),
        now,
        patch.id,
        req.user.id,
      );

      // Update site timestamp
      stmts.updateSite.run(site.name, site.status, site.cloudflare_project_name, site.domain, site.manifest, now, site.id, req.user.id);

      res.json({ success: true, result });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Reject a patch plan ---
  app.post('/api/sites/:siteId/patch/:patchId/reject', requireAuth, (req, res) => {
    try {
      const patch = stmts.getPatch.get(req.params.patchId, req.user.id);
      if (!patch) return sendError(res, 404, 'Patch not found');
      stmts.updatePatch.run(patch.plan, 'rejected', null, Date.now(), patch.id, req.user.id);
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });
}
