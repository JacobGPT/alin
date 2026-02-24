/**
 * ALIN Private Backend Server
 *
 * Minimal server for personal/partnership use.
 * Mounts only essential routes from @alin/core.
 *
 * RUN: node server.js
 * PORT: http://localhost:3001
 */

import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ── Core Modules ──
import { initDatabase, createStatements } from '@alin/core/database';
import { createServerContext } from '@alin/core/context';

// ── Route Modules (essential subset) ──
import { registerAuthRoutes } from '@alin/core/routes/auth';
import { registerMiscRoutes } from '@alin/core/routes/misc';
import { registerConversationRoutes } from '@alin/core/routes/conversations';
import { registerStreamingRoutes } from '@alin/core/routes/streaming';
import { registerCodingRoutes } from '@alin/core/routes/coding';
import { registerSettingsRoutes } from '@alin/core/routes/settings';
import { registerFileRoutes } from '@alin/core/routes/files';
import { registerCodeOpsRoutes } from '@alin/core/routes/codeOps';
import { registerMemoryRoutes } from '@alin/core/routes/memories';
import { registerImageRoutes } from '@alin/core/routes/images';
import { registerVoiceRoutes } from '@alin/core/routes/voice';
import { registerVideoRoutes } from '@alin/core/routes/video';
import { registerVideoAnalysisRoutes } from '@alin/core/routes/videoAnalysis';
import { registerWebFetchRoutes } from '@alin/core/routes/webFetch';
import { registerSystemRoutes } from '@alin/core/routes/system';
import { registerSelfModelRoutes } from '@alin/core/routes/selfModel';
import { registerArtifactRoutes } from '@alin/core/routes/artifacts';
import { registerAuditRoutes } from '@alin/core/routes/audit';
import { registerConsequenceEngineRoutes } from '@alin/core/routes/consequenceEngine';
import { registerTrainingDataRoutes } from '@alin/core/routes/trainingData';
import { registerProactiveIntelligenceRoutes } from '@alin/core/routes/proactiveIntelligence';
import { registerCreditRoutes } from '@alin/core/routes/credits';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    'http://localhost:3000', 'http://127.0.0.1:3000',
    'http://localhost:3001', 'http://127.0.0.1:3001',
    'http://localhost:5173', 'http://127.0.0.1:5173',
  ],
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
}));

app.use(express.json({ limit: '50mb' }));

// ── Initialize Database + Context ──
const dbPath = process.env.DATABASE_PATH || './data/alin-private.db';
const db = initDatabase(dbPath);
const stmts = createStatements(db);
const ctx = createServerContext({ db, stmts, app, rootDir: __dirname });

// ── Mount Essential Routes ──
registerAuthRoutes(ctx);
registerMiscRoutes(ctx);
registerTrainingDataRoutes(ctx);
registerConversationRoutes(ctx);

// streaming → coding must come before other routes (ctx late-binding)
registerStreamingRoutes(ctx);
registerCodingRoutes(ctx);

registerSettingsRoutes(ctx);
registerMemoryRoutes(ctx);
registerAuditRoutes(ctx);
registerArtifactRoutes(ctx);
registerCreditRoutes(ctx);

registerImageRoutes(ctx);
registerVoiceRoutes(ctx);
registerVideoRoutes(ctx);
registerVideoAnalysisRoutes(ctx);

registerFileRoutes(ctx);
registerCodeOpsRoutes(ctx);
registerWebFetchRoutes(ctx);
registerSystemRoutes(ctx);
registerSelfModelRoutes(ctx);

// Consequence Engine — private mode (full transparency, no bootstrap)
ctx.consequenceConfig = {
  isPrivate: true,
  bootstrapUntil: 0,
  domains: ['market_sensing', 'first_slice', 'execution_strategy', 'competitive_positioning', 'user_friction'],
};
registerConsequenceEngineRoutes(ctx);

// Proactive Intelligence — private-only background monitoring
ctx.proactiveConfig = {
  enabled: true,
  collectIntervalMs: 5 * 60 * 1000,
  rhythmIntervalMs: 10 * 60 * 1000,
  awarenessIntervalMs: 15 * 60 * 1000,
  alertCheckIntervalMs: 5 * 60 * 1000,
  retentionDays: 90,
};
registerProactiveIntelligenceRoutes(ctx);

// ── One-Way Intelligence Flow: Private reads Public's consequence data (read-only) ──
// If PUBLIC_DB_PATH is set, open public's DB in read-only mode so private's dashboard
// can merge aggregate patterns from public users. Private NEVER writes to public DB.
if (process.env.PUBLIC_DB_PATH) {
  try {
    const publicDb = new Database(process.env.PUBLIC_DB_PATH, { readonly: true, fileMustExist: true });
    publicDb.pragma('journal_mode = WAL');
    ctx.publicConsequenceDb = publicDb;

    // Endpoint: aggregate public consequence data into private dashboard
    app.get('/api/consequence/public-aggregate', ctx.requireAuth, (req, res) => {
      try {
        if (!ctx.publicConsequenceDb) return res.json({ available: false });

        // Read-only aggregate queries against public DB
        const publicDomainStates = ctx.publicConsequenceDb.prepare(
          'SELECT domain, AVG(prediction_accuracy) as avg_accuracy, AVG(pain_score) as avg_pain, AVG(satisfaction_score) as avg_satisfaction, SUM(total_predictions) as total_predictions, SUM(correct_predictions) as total_correct, SUM(wrong_predictions) as total_wrong FROM domain_states GROUP BY domain'
        ).all();

        const publicGenePatterns = ctx.publicConsequenceDb.prepare(
          'SELECT domain, COUNT(*) as gene_count, AVG(strength) as avg_strength, SUM(confirmations) as total_confirmations, SUM(contradictions) as total_contradictions FROM behavioral_genome WHERE status != ? GROUP BY domain'
        ).all('deleted');

        const publicPredictionStats = ctx.publicConsequenceDb.prepare(
          'SELECT domain, COUNT(*) as total, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) as correct, SUM(CASE WHEN status=? THEN 1 ELSE 0 END) as wrong FROM predictions GROUP BY domain'
        ).all('verified_correct', 'verified_wrong');

        const publicCalibration = ctx.publicConsequenceDb.prepare(
          `SELECT
            CASE WHEN confidence < 0.2 THEN 0 WHEN confidence < 0.4 THEN 1 WHEN confidence < 0.6 THEN 2 WHEN confidence < 0.8 THEN 3 ELSE 4 END as bucket,
            COUNT(*) as total,
            SUM(CASE WHEN status='verified_correct' THEN 1 ELSE 0 END) as correct
          FROM predictions WHERE status IN ('verified_correct','verified_wrong','verified_partial') GROUP BY bucket ORDER BY bucket`
        ).all();

        const publicPatterns = ctx.publicConsequenceDb.prepare(
          'SELECT domain, pattern_type, pattern_signature, frequency, confidence, description FROM consequence_patterns WHERE status != ? ORDER BY frequency DESC LIMIT ?'
        ).all('deleted', 20);

        // Top-performing and worst-performing genes from public
        const publicTopGenes = ctx.publicConsequenceDb.prepare(
          'SELECT gene_text, domain, strength, confirmations, contradictions FROM behavioral_genome WHERE status=? ORDER BY strength DESC LIMIT ?'
        ).all('active', 10);

        const publicWeakGenes = ctx.publicConsequenceDb.prepare(
          'SELECT gene_text, domain, strength, confirmations, contradictions FROM behavioral_genome WHERE status=? AND contradictions > confirmations ORDER BY strength ASC LIMIT ?'
        ).all('active', 10);

        res.json({
          available: true,
          publicDomainStates,
          publicGenePatterns,
          publicPredictionStats,
          publicCalibration: publicCalibration.map(row => ({
            bucket: row.bucket,
            total: row.total,
            correct: row.correct,
            accuracy: row.total > 0 ? Math.round((row.correct / row.total) * 100) : 0,
          })),
          publicPatterns,
          publicTopGenes,
          publicWeakGenes,
          note: 'Read-only aggregate from public ALIN instance',
        });
      } catch (e) {
        console.error('[ConsequenceEngine] Public aggregate read error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    // Cross-pollinate: endpoint to import high-value genes from public into private
    app.post('/api/consequence/import-public-genes', ctx.requireAuth, (req, res) => {
      try {
        if (!ctx.publicConsequenceDb) return res.json({ imported: 0 });

        const { minStrength, minConfirmations, domains } = req.body;
        const threshold = minStrength || 0.7;
        const minConf = minConfirmations || 5;

        // Read high-value active genes from public
        const publicGenes = ctx.publicConsequenceDb.prepare(
          'SELECT gene_text, gene_type, domain, source_pattern, trigger_condition, action_directive, strength, confirmations, contradictions FROM behavioral_genome WHERE status=? AND strength>=? AND confirmations>=? ORDER BY strength DESC LIMIT ?'
        ).all('active', threshold, minConf, 50);

        const userId = req.userId;
        const now = Date.now();
        let imported = 0;
        let skipped = 0;

        for (const pg of publicGenes) {
          // Check domain filter
          if (domains && Array.isArray(domains) && !domains.includes(pg.domain)) { skipped++; continue; }

          // Check if this gene already exists in private
          const existing = ctx.stmts.findGeneByText?.get?.(userId, pg.domain, pg.gene_text);
          if (existing) { skipped++; continue; }

          // Import with pending_review status (user must approve)
          const geneId = randomUUID();
          ctx.stmts.insertGene.run(
            geneId, pg.gene_text, pg.gene_type || 'behavioral', pg.domain,
            `imported_from_public: ${pg.source_pattern || ''}`, null,
            pg.trigger_condition || '', pg.action_directive || '',
            pg.strength * 0.8, // Reduce strength slightly when importing
            'pending_review', 0, 0, 0, 1, 'none', null, '[]', now, now, userId
          );

          ctx.stmts.insertGeneAudit.run(
            randomUUID(), geneId, 'imported_from_public',
            '{}',
            JSON.stringify({ strength: pg.strength * 0.8, public_confirmations: pg.confirmations }),
            `Imported from public: ${pg.confirmations} confirmations, ${pg.strength.toFixed(2)} strength`,
            'system', now, userId
          );

          imported++;
        }

        res.json({ imported, skipped, total: publicGenes.length });
      } catch (e) {
        console.error('[ConsequenceEngine] Import public genes error:', e.message);
        res.status(500).json({ error: e.message });
      }
    });

    console.log(`[ConsequenceEngine] One-way intelligence flow: reading public DB at ${process.env.PUBLIC_DB_PATH}`);
  } catch (e) {
    console.warn(`[ConsequenceEngine] Could not open public DB at ${process.env.PUBLIC_DB_PATH}:`, e.message);
  }
}

// ── Start (localhost only) ──
app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('========================================================');
  console.log('           ALIN Private Backend Server');
  console.log('========================================================');
  console.log(`  Running on: http://127.0.0.1:${PORT}`);
  console.log(`  Database:   ${dbPath}`);
  console.log(`  API Keys:   Anthropic=${!!process.env.ANTHROPIC_API_KEY ? 'Y' : 'N'} OpenAI=${!!process.env.OPENAI_API_KEY ? 'Y' : 'N'}`);
  console.log('  Health:     GET /api/health');
  console.log('========================================================');
  console.log('');
});

// Periodic WAL checkpoint every 30s
setInterval(() => {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}
}, 30000);

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n[Server] ${signal} received, checkpointing database...`);
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    console.log('[Server] Database closed cleanly.');
  } catch (err) {
    console.error('[Server] DB close error:', err.message);
  }
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
if (process.platform === 'win32') {
  process.on('message', (msg) => { if (msg === 'shutdown') gracefulShutdown('shutdown'); });
}
