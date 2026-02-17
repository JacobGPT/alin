/**
 * Self-Model API
 * /api/self-model/outcomes, tool-reliability, model-success-rates,
 * corrections, decisions, thinking-traces, layer-memory
 */
import { randomUUID } from 'crypto';

export function registerSelfModelRoutes(ctx) {
  const { app, stmts, requireAuth, sendError } = ctx;

  // --- Execution Outcomes ---
  app.post('/api/self-model/outcomes', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const b = req.body;
      const id = randomUUID();
      stmts.insertOutcome.run(id, b.tbwoId, b.objective || '', b.type || '', b.timeBudget || 0, b.planConfidence || 0, b.phasesCompleted || 0, b.phasesFailed || 0, b.artifactsCount || 0, b.userEditsAfter || 0, b.qualityScore || 0, b.timestamp || Date.now(), userId);
      res.json({ success: true, id });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/self-model/outcomes', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const type = req.query.type;
      const rows = type ? stmts.listOutcomesByType.all(userId, type, limit) : stmts.listOutcomes.all(userId, limit);
      res.json({ success: true, outcomes: rows });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Tool Reliability ---
  app.post('/api/self-model/tool-reliability', requireAuth, (req, res) => {
    try {
      const { toolName, success, duration, errorReason, model } = req.body;
      let commonErrors = '[]';
      if (!success && errorReason) {
        const existing = stmts.getToolReliability.all().find(r => r.tool_name === toolName);
        if (existing) {
          const errors = JSON.parse(existing.common_errors || '[]');
          errors.push(errorReason.slice(0, 200));
          if (errors.length > 10) errors.shift();
          commonErrors = JSON.stringify(errors);
        } else {
          commonErrors = JSON.stringify([errorReason.slice(0, 200)]);
        }
      }
      stmts.upsertToolReliability.run(
        toolName,
        success ? 1 : 0,
        success ? 0 : 1,
        duration || 0,
        commonErrors,
        (!success && errorReason) ? errorReason.slice(0, 500) : ''
      );
      if (model && model !== 'unknown') {
        stmts.upsertModelSuccessRate.run(
          model,
          success ? 1 : 0,
          success ? 0 : 1,
          duration || 0,
          Date.now()
        );
      }
      res.json({ success: true });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/self-model/tool-reliability', requireAuth, (req, res) => {
    try {
      const rows = stmts.getToolReliability.all().map(r => ({
        toolName: r.tool_name,
        successCount: r.success_count,
        failureCount: r.failure_count,
        avgDuration: r.avg_duration,
        commonErrors: JSON.parse(r.common_errors || '[]'),
        lastFailureReason: r.last_failure_reason || '',
      }));
      res.json({ success: true, tools: rows });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Model Success Rates ---
  app.get('/api/self-model/model-success-rates', requireAuth, (req, res) => {
    try {
      const rows = stmts.getModelSuccessRates.all().map(r => ({
        model: r.model,
        successCount: r.success_count,
        failureCount: r.failure_count,
        totalCalls: r.total_calls,
        avgDuration: r.avg_duration,
      }));
      res.json(rows);
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- User Corrections ---
  app.post('/api/self-model/corrections', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { originalValue, correctedValue, category } = req.body;
      const existing = stmts.findCorrection.get(category, correctedValue, userId);
      if (existing) {
        stmts.incrementCorrection.run(Date.now(), existing.id, userId);
        res.json({ success: true, id: existing.id, correctionCount: existing.correction_count + 1 });
      } else {
        const id = randomUUID();
        stmts.insertCorrection.run(id, originalValue || '', correctedValue || '', category || 'general', Date.now(), userId);
        res.json({ success: true, id, correctionCount: 1 });
      }
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/self-model/corrections', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const minCount = parseInt(req.query.minCount) || 1;
      const rows = stmts.listCorrections.all(userId, minCount).map(r => ({
        id: r.id,
        originalValue: r.original_value,
        correctedValue: r.corrected_value,
        category: r.category,
        correctionCount: r.correction_count,
        lastCorrected: r.last_corrected,
      }));
      res.json({ success: true, corrections: rows });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Decision Log ---
  app.post('/api/self-model/decisions', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const b = req.body;
      const id = randomUUID();
      stmts.insertDecision.run(id, b.tbwoId || '', b.decisionType || '', JSON.stringify(b.optionsConsidered || []), b.chosenOption || '', b.reasoning || '', b.outcome || '', b.confidence || 0, b.timestamp || Date.now(), userId);
      res.json({ success: true, id });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/self-model/decisions', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const tbwoId = req.query.tbwoId;
      const rows = (tbwoId ? stmts.listDecisionsByTBWO.all(userId, tbwoId, limit) : stmts.listDecisions.all(userId, limit)).map(r => ({
        id: r.id,
        tbwoId: r.tbwo_id,
        decisionType: r.decision_type,
        optionsConsidered: JSON.parse(r.options_considered || '[]'),
        chosenOption: r.chosen_option,
        reasoning: r.reasoning,
        outcome: r.outcome,
        confidence: r.confidence,
        timestamp: r.timestamp,
      }));
      res.json({ success: true, decisions: rows });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Thinking Traces ---
  app.post('/api/self-model/thinking-traces', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const b = req.body;
      const id = randomUUID();
      stmts.insertThinkingTrace.run(id, b.conversationId || '', b.messageId || '', b.tbwoId || null, b.thinkingContent || '', b.timestamp || Date.now(), userId);
      res.json({ success: true, id });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/self-model/thinking-traces', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      let rows;
      if (req.query.q) {
        rows = stmts.searchThinking.all(userId, `%${req.query.q}%`, limit);
      } else if (req.query.conversationId) {
        rows = stmts.listThinkingByConv.all(req.query.conversationId, userId);
      } else if (req.query.tbwoId) {
        rows = stmts.listThinkingByTBWO.all(req.query.tbwoId, userId);
      } else {
        rows = stmts.searchThinking.all(userId, '%', limit);
      }
      const traces = rows.map(r => ({
        id: r.id,
        conversationId: r.conversation_id,
        messageId: r.message_id,
        tbwoId: r.tbwo_id,
        thinkingContent: r.thinking_content,
        timestamp: r.timestamp,
      }));
      res.json({ success: true, traces });
    } catch (error) { sendError(res, 500, error.message); }
  });

  // --- Layer Memory ---
  app.post('/api/self-model/layer-memory', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const b = req.body;
      const id = randomUUID();
      const now = Date.now();
      stmts.insertLayerMemory.run(id, b.layer || 'short_term', b.content || '', b.category || '', b.salience ?? 0.5, b.expiresAt || null, JSON.stringify(b.metadata || {}), now, now, userId);
      res.json({ success: true, id });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.get('/api/self-model/layer-memory', requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const layer = req.query.layer || 'short_term';
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const now = Date.now();
      const rows = stmts.listLayerMemories.all(layer, userId, now, limit).map(r => ({
        id: r.id,
        layer: r.layer,
        content: r.content,
        category: r.category,
        salience: r.salience,
        expiresAt: r.expires_at,
        metadata: JSON.parse(r.metadata || '{}'),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
      res.json({ success: true, memories: rows });
    } catch (error) { sendError(res, 500, error.message); }
  });

  app.post('/api/self-model/layer-memory/prune', requireAuth, (req, res) => {
    try {
      const result = stmts.pruneExpiredLayers.run(req.user.id, Date.now());
      res.json({ success: true, pruned: result.changes });
    } catch (error) { sendError(res, 500, error.message); }
  });
}
