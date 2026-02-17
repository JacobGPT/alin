/**
 * ALIN Public Backend Server
 *
 * Thin entry point — all core logic lives in @alin/core.
 * This file creates the context, mounts routes, and starts the server.
 *
 * RUN: node server.js
 * PORT: http://localhost:3002
 */

import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Core Modules ──
import { initDatabase, createStatements } from '@alin/core/database';
import { createServerContext } from '@alin/core/context';

// ── Route Modules ──
import { registerAuthRoutes } from '@alin/core/routes/auth';
import { registerMiscRoutes } from '@alin/core/routes/misc';
import { registerTelemetryRoutes } from '@alin/core/routes/telemetry';
import { registerConversationRoutes } from '@alin/core/routes/conversations';
import { registerStreamingRoutes } from '@alin/core/routes/streaming';
import { registerCodingRoutes } from '@alin/core/routes/coding';
import { registerSettingsRoutes } from '@alin/core/routes/settings';
import { registerTBWORoutes } from '@alin/core/routes/tbwo';
import { registerTBWOWorkspaceRoutes } from '@alin/core/routes/tbwoWorkspace';
import { registerSandboxRoutes } from '@alin/core/routes/sandbox';
import { registerSiteRoutes } from '@alin/core/routes/sites';
import { registerSitePatchRoutes } from '@alin/core/routes/sitePatches';
import { registerArtifactRoutes } from '@alin/core/routes/artifacts';
import { registerMemoryRoutes } from '@alin/core/routes/memories';
import { registerAuditRoutes } from '@alin/core/routes/audit';
import { registerImageRoutes } from '@alin/core/routes/images';
import { registerVoiceRoutes } from '@alin/core/routes/voice';
import { registerVideoRoutes } from '@alin/core/routes/video';
import { registerFileRoutes } from '@alin/core/routes/files';
import { registerCodeOpsRoutes } from '@alin/core/routes/codeOps';
import { registerComputerUseRoutes } from '@alin/core/routes/computerUse';
import { registerWebFetchRoutes } from '@alin/core/routes/webFetch';
import { registerSystemRoutes } from '@alin/core/routes/system';
import { registerFileWatcherRoutes } from '@alin/core/routes/fileWatcher';
import { registerSelfModelRoutes } from '@alin/core/routes/selfModel';
import { registerAssetRoutes } from '@alin/core/routes/assets';
import { registerCloudflareRoutes } from '@alin/core/routes/cloudflare';

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
const dbPath = process.env.DATABASE_PATH || './data/alin-public.db';
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


// ── Route Modules ──
registerAuthRoutes(ctx);
registerMiscRoutes(ctx);

registerTelemetryRoutes(ctx);
registerConversationRoutes(ctx);

// streaming → coding must come before TBWO/sites/images/misc (ctx late-binding)
registerStreamingRoutes(ctx);
registerCodingRoutes(ctx);

registerSettingsRoutes(ctx);
registerTBWORoutes(ctx);
registerTBWOWorkspaceRoutes(ctx);
registerSandboxRoutes(ctx);
registerSiteRoutes(ctx);
registerSitePatchRoutes(ctx);
registerArtifactRoutes(ctx);
registerMemoryRoutes(ctx);
registerAuditRoutes(ctx);

registerImageRoutes(ctx);
registerVoiceRoutes(ctx);
registerVideoRoutes(ctx);

registerFileRoutes(ctx);
registerCodeOpsRoutes(ctx);
registerComputerUseRoutes(ctx);
registerWebFetchRoutes(ctx);
registerSystemRoutes(ctx);

registerFileWatcherRoutes(ctx);
registerSelfModelRoutes(ctx);

registerAssetRoutes(ctx);

registerCloudflareRoutes(ctx);

// Start server
app.listen(PORT, () => {
  console.log('');
  console.log('========================================================');
  console.log('           ALIN Public Backend Server');
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
