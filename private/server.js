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
import { registerWebFetchRoutes } from '@alin/core/routes/webFetch';
import { registerSystemRoutes } from '@alin/core/routes/system';
import { registerSelfModelRoutes } from '@alin/core/routes/selfModel';
import { registerArtifactRoutes } from '@alin/core/routes/artifacts';
import { registerAuditRoutes } from '@alin/core/routes/audit';

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
registerConversationRoutes(ctx);

// streaming → coding must come before other routes (ctx late-binding)
registerStreamingRoutes(ctx);
registerCodingRoutes(ctx);

registerSettingsRoutes(ctx);
registerMemoryRoutes(ctx);
registerAuditRoutes(ctx);
registerArtifactRoutes(ctx);

registerImageRoutes(ctx);
registerVoiceRoutes(ctx);
registerVideoRoutes(ctx);

registerFileRoutes(ctx);
registerCodeOpsRoutes(ctx);
registerWebFetchRoutes(ctx);
registerSystemRoutes(ctx);
registerSelfModelRoutes(ctx);

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
