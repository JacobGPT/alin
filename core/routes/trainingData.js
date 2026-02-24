/**
 * Training Data Collection Layer
 *
 * Silently collects high-quality training examples in the background.
 * Zero user-facing impact — never surfaces, never slows anything down.
 *
 * Sources:
 * 1. TBWO completions with quality_score > 0.7 (from orchestrator receipt)
 * 2. Consequence engine outcomes (correct/partial predictions)
 * 3. User message edits (original → corrected pairs)
 *
 * Admin endpoints:
 *   GET  /api/admin/training-data/stats   — collection statistics
 *   GET  /api/admin/training-data/export  — JSONL export for fine-tuning
 */
import { randomUUID } from 'crypto';

export function registerTrainingDataRoutes(ctx) {
  const { app, db, stmts, requireAuth, requireAdmin } = ctx;

  const QUALITY_THRESHOLD = 0.7;

  // ══════════════════════════════════════════════════════════════════════════
  // SILENT COLLECTION HELPERS — exposed on ctx for other modules to call
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Store a training example if it meets quality threshold.
   * Fire-and-forget — never throws, never blocks.
   */
  function collectExample({ userId, exampleType, input, output, qualityScore, modelUsed, toolsUsed, sourceId }) {
    try {
      if (!input || !output) return;
      if (qualityScore < QUALITY_THRESHOLD) return;

      // Deduplicate by source_id
      if (sourceId) {
        const existing = stmts.findTrainingBySource.get(sourceId);
        if (existing) return;
      }

      const id = randomUUID();
      const now = Date.now();

      stmts.insertTrainingExample.run(
        id,
        userId || 'system',
        exampleType,
        typeof input === 'string' ? input.slice(0, 50000) : JSON.stringify(input).slice(0, 50000),
        typeof output === 'string' ? output.slice(0, 50000) : JSON.stringify(output).slice(0, 50000),
        Math.max(0, Math.min(1, qualityScore)),
        modelUsed || '',
        JSON.stringify(toolsUsed || []),
        sourceId || '',
        now
      );
    } catch (e) {
      // Silent — never let training data collection break anything
      console.error('[TrainingData] Collection error (non-fatal):', e.message);
    }
  }

  /**
   * Collect a TBWO completion as a training example.
   * Called from tbwo.js after successful pipeline completion.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.tbwoId
   * @param {string} params.objective - The user's original objective/brief
   * @param {object} params.result - The orchestrator result (pods, pages, quality, etc.)
   * @param {string} params.qualityTier
   */
  function collectTBWOCompletion({ userId, tbwoId, objective, result, qualityTier }) {
    // qualityScore is 0-10 in the receipt, normalize to 0-1
    const rawScore = result.qualityScore || 0;
    const normalizedScore = rawScore / 10;

    collectExample({
      userId,
      exampleType: 'tbwo_completion',
      input: JSON.stringify({
        objective,
        qualityTier,
        type: result.tierLabel || qualityTier,
      }),
      output: JSON.stringify({
        pages: result.pages,
        pods: (result.pods || []).map(p => ({
          role: p.role,
          model: p.model,
          tasks: p.completedTasks || p.tasks?.length || 0,
        })),
        costEstimate: result.costEstimate,
        qualityScore: rawScore,
        passesProduction: result.passesProduction,
        imageCount: result.imageCount,
        issuesFound: result.issuesFound,
        issuesFixed: result.issuesFixed,
      }),
      qualityScore: normalizedScore,
      modelUsed: result.pods?.[0]?.model || '',
      toolsUsed: ['tbwo_pipeline'],
      sourceId: `tbwo:${tbwoId}`,
    });
  }

  /**
   * Collect a correct/partial consequence engine outcome.
   * Called from consequenceEngine.js after prediction resolution.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.predictionId
   * @param {string} params.predictionText
   * @param {string} params.result - 'correct' | 'partial' | 'wrong'
   * @param {string} params.domain
   * @param {number} params.confidence
   * @param {string} params.sourceModel
   */
  function collectOutcomeVerified({ userId, predictionId, predictionText, result, domain, confidence, sourceModel }) {
    // Only collect correct and partial — these are positive training signals
    if (result !== 'correct' && result !== 'partial') return;

    const qualityScore = result === 'correct' ? 0.9 : 0.75;

    collectExample({
      userId,
      exampleType: 'outcome_verified',
      input: JSON.stringify({
        domain,
        predictionText,
        confidence,
      }),
      output: JSON.stringify({
        result,
        wasAccurate: true,
        domain,
      }),
      qualityScore,
      modelUsed: sourceModel || '',
      toolsUsed: ['consequence_engine'],
      sourceId: `prediction:${predictionId}`,
    });
  }

  /**
   * Collect a user correction (message edit).
   * Called from conversations.js when a message is edited.
   *
   * @param {object} params
   * @param {string} params.userId
   * @param {string} params.messageId
   * @param {string} params.originalContent - The original assistant response
   * @param {string} params.editedContent - The user's corrected version
   * @param {string} params.model
   */
  function collectCorrection({ userId, messageId, originalContent, editedContent, model }) {
    collectExample({
      userId,
      exampleType: 'correction',
      input: typeof originalContent === 'string' ? originalContent : JSON.stringify(originalContent),
      output: typeof editedContent === 'string' ? editedContent : JSON.stringify(editedContent),
      qualityScore: 0.85, // User-corrected examples are inherently high quality
      modelUsed: model || '',
      toolsUsed: [],
      sourceId: `correction:${messageId}`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS — statistics + export
  // ══════════════════════════════════════════════════════════════════════════

  app.get('/api/admin/training-data/stats', requireAuth, requireAdmin, (_req, res) => {
    try {
      const total = stmts.countTrainingExamples.get()?.count || 0;
      const byType = stmts.countTrainingExamplesByType.all();
      const avgQuality = stmts.avgTrainingQuality.get()?.avg_quality || 0;

      // This month
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const thisMonth = stmts.countTrainingExamplesSince.get(monthStart)?.count || 0;

      // Last 7 days
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const thisWeek = stmts.countTrainingExamplesSince.get(weekAgo)?.count || 0;

      res.json({
        stats: {
          total,
          thisMonth,
          thisWeek,
          averageQuality: Math.round(avgQuality * 1000) / 1000,
          byType: Object.fromEntries(
            byType.map(r => [r.example_type, {
              count: r.count,
              avgQuality: Math.round(r.avg_quality * 1000) / 1000,
            }])
          ),
        },
      });
    } catch (e) {
      console.error('[TrainingData] Stats error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/training-data/export', requireAuth, requireAdmin, (req, res) => {
    try {
      const minQuality = parseFloat(req.query.minQuality) || 0.7;
      const limit = Math.min(parseInt(req.query.limit) || 10000, 100000);
      const offset = parseInt(req.query.offset) || 0;
      const format = req.query.format || 'jsonl';

      const rows = stmts.exportTrainingExamples.all(minQuality, limit, offset);

      if (format === 'jsonl') {
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Content-Disposition', `attachment; filename="training-data-${Date.now()}.jsonl"`);

        for (const row of rows) {
          // Format for fine-tuning: {"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}
          let inputParsed, outputParsed;
          try { inputParsed = JSON.parse(row.input); } catch { inputParsed = row.input; }
          try { outputParsed = JSON.parse(row.output); } catch { outputParsed = row.output; }

          const example = {
            id: row.id,
            example_type: row.example_type,
            quality_score: row.quality_score,
            model_used: row.model_used,
            tools_used: JSON.parse(row.tools_used || '[]'),
            created_at: row.created_at,
            messages: [
              {
                role: 'user',
                content: typeof inputParsed === 'string' ? inputParsed : JSON.stringify(inputParsed),
              },
              {
                role: 'assistant',
                content: typeof outputParsed === 'string' ? outputParsed : JSON.stringify(outputParsed),
              },
            ],
          };

          res.write(JSON.stringify(example) + '\n');
        }

        res.end();
      } else {
        // JSON array format
        res.json({
          examples: rows.map(row => ({
            ...row,
            tools_used: JSON.parse(row.tools_used || '[]'),
            input: (() => { try { return JSON.parse(row.input); } catch { return row.input; } })(),
            output: (() => { try { return JSON.parse(row.output); } catch { return row.output; } })(),
          })),
          total: rows.length,
          offset,
          limit,
          minQuality,
        });
      }
    } catch (e) {
      console.error('[TrainingData] Export error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // EXPOSE ON CTX — other modules call these silently
  // ══════════════════════════════════════════════════════════════════════════

  ctx.trainingData = {
    collectExample,
    collectTBWOCompletion,
    collectOutcomeVerified,
    collectCorrection,
    QUALITY_THRESHOLD,
  };

  console.log('[TrainingData] Silent collection layer registered');
}
