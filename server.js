/**
 * ALIN Backend Server
 *
 * Modular architecture: core logic in server/core/, routes in server/routes/.
 * This file creates the context, mounts routes, and starts the server.
 *
 * INSTALL: npm install better-sqlite3
 * RUN: node server.js
 * PORT: http://localhost:3002
 */

// Load .env file so all API keys are available via process.env
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Core Modules ──
import { initDatabase } from './server/core/database.js';
import { createStatements } from './server/core/statements.js';
import { createServerContext } from './server/core/context.js';

// ── Route Modules ──
import { registerAuthRoutes } from './server/routes/auth.js';
import { registerMiscRoutes } from './server/routes/misc.js';
import { registerTelemetryRoutes } from './server/routes/telemetry.js';
import { registerConversationRoutes } from './server/routes/conversations.js';
import { registerStreamingRoutes } from './server/routes/streaming.js';
import { registerCodingRoutes } from './server/routes/coding.js';
import { registerSettingsRoutes } from './server/routes/settings.js';
import { registerTBWORoutes } from './server/routes/tbwo.js';
import { registerTBWOWorkspaceRoutes } from './server/routes/tbwoWorkspace.js';
import { registerSandboxRoutes } from './server/routes/sandbox.js';
import { registerSiteRoutes } from './server/routes/sites.js';
import { registerSitePatchRoutes } from './server/routes/sitePatches.js';
import { registerArtifactRoutes } from './server/routes/artifacts.js';
import { registerMemoryRoutes } from './server/routes/memories.js';
import { registerAuditRoutes } from './server/routes/audit.js';
import { registerImageRoutes } from './server/routes/images.js';
import { registerVoiceRoutes } from './server/routes/voice.js';
import { registerVideoRoutes } from './server/routes/video.js';
import { registerFileRoutes } from './server/routes/files.js';
import { registerCodeOpsRoutes } from './server/routes/codeOps.js';
import { registerComputerUseRoutes } from './server/routes/computerUse.js';
import { registerWebFetchRoutes } from './server/routes/webFetch.js';
import { registerSystemRoutes } from './server/routes/system.js';
import { registerFileWatcherRoutes } from './server/routes/fileWatcher.js';
import { registerSelfModelRoutes } from './server/routes/selfModel.js';
import { registerAssetRoutes } from './server/routes/assets.js';
import { registerCloudflareRoutes } from './server/routes/cloudflare.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3002;

// Trust first proxy (Cloudflare, nginx, etc.) so req.ip is correct
app.set('trust proxy', 1);

// Enable CORS for frontend
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : [
        'http://localhost:3000', 'http://127.0.0.1:3000',
        'http://localhost:3001', 'http://127.0.0.1:3001',
        'http://localhost:3003', 'http://127.0.0.1:3003',
        'http://localhost:5173', 'http://127.0.0.1:5173',
      ],
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
}));

app.use(express.json({ limit: '10mb' }));

// ── Initialize Database + Context ──
const dbPath = process.env.DATABASE_PATH || '/data/alin.db';
const db = initDatabase(dbPath);
const stmts = createStatements(db);
const ctx = createServerContext({ db, stmts, app, rootDir: __dirname });

// ── Marketing Site + Static Serving ──
app.use(express.static(path.join(__dirname, 'marketing')));
app.use('/m', express.static(path.join(__dirname, 'marketing')));
app.use('/app', express.static(path.join(__dirname, 'dist')));

app.get('/download', (req, res) => {
  const platform = req.query.platform || 'windows';
  const DOWNLOAD_URLS = {
    windows: process.env.DOWNLOAD_URL_WIN || '/m/index.html#download',
    mac: process.env.DOWNLOAD_URL_MAC || '/m/index.html#download',
    linux: process.env.DOWNLOAD_URL_LINUX || '/m/index.html#download',
  };
  res.redirect(DOWNLOAD_URLS[platform] || DOWNLOAD_URLS.windows);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'marketing', 'index.html'));
});

app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});


// ── Route Modules (Phase 6) ──
registerAuthRoutes(ctx);
registerMiscRoutes(ctx);

// ── Extracted Route Modules (Phase 2) ──
registerTelemetryRoutes(ctx);
registerConversationRoutes(ctx);

// ── Extracted Route Modules (Phase 5) ──
registerStreamingRoutes(ctx);
registerCodingRoutes(ctx); // Must run before TBWO/sites — sets ctx.callClaudeSync + ctx.toolGenerateImage

// ── Extracted Route Modules (Phase 4) ──
registerSettingsRoutes(ctx);
registerTBWORoutes(ctx);
registerTBWOWorkspaceRoutes(ctx);
registerSandboxRoutes(ctx);
registerSiteRoutes(ctx);
registerSitePatchRoutes(ctx);
registerArtifactRoutes(ctx);
registerMemoryRoutes(ctx);
registerAuditRoutes(ctx);

// ── Extracted Route Modules (Phase 6 cont.) ──
registerImageRoutes(ctx);
registerVoiceRoutes(ctx);
registerVideoRoutes(ctx);

// ── Extracted Route Modules (Phase 3) ──
registerFileRoutes(ctx);
registerCodeOpsRoutes(ctx);
registerComputerUseRoutes(ctx);
registerWebFetchRoutes(ctx);
registerSystemRoutes(ctx);

// ── Extracted Route Modules (Phase 6 cont.) ──
registerFileWatcherRoutes(ctx);
registerSelfModelRoutes(ctx);

registerAssetRoutes(ctx);

registerCloudflareRoutes(ctx);

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('========================================================');
  console.log('           ALIN Backend Server');
  console.log('========================================================');
  console.log(`  Running on: http://localhost:${PORT}`);
  console.log(`  Database:   ${dbPath}`);
  console.log(`  API Keys:   Anthropic=${!!process.env.ANTHROPIC_API_KEY ? 'Y' : 'N'} OpenAI=${!!process.env.OPENAI_API_KEY ? 'Y' : 'N'} Brave=${!!(process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY) ? 'Y' : 'N'}`);
  console.log(`  Routes:     27 modules loaded`);
  console.log('  Health:     GET /api/health');
  console.log('========================================================');
  console.log('');
});

// Periodic WAL checkpoint every 30s so data survives force-kills
setInterval(() => {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch {}
}, 30000);

// Graceful shutdown — checkpoint WAL so data persists across restarts
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
// Windows: handle Ctrl+C
if (process.platform === 'win32') {
  process.on('message', (msg) => { if (msg === 'shutdown') gracefulShutdown('shutdown'); });
}
