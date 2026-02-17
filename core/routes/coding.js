/**
 * Multi-Agent Coding Architecture + User Workspace + Unified Tool Executor
 * /api/coding/stream — Server-side tool loop (autonomous 25-iteration coding)
 * /api/coding/scan-agent — Client-initiated scan subagent
 * /api/workspace/* — User workspace init/upload/tree/file/zip/delete
 * /api/tools/execute — Unified tool executor
 * /api/capabilities — Feature capabilities per plan
 */
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import fsSync from 'node:fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import multer from 'multer';
import JSZip from 'jszip';
import { assemblePrompt } from '../prompts/index.js';
import { SCAN_DEFAULTS } from './files.js';
import { DANGEROUS_COMMANDS, GIT_READ_OPS, GIT_WRITE_OPS, GIT_BLOCKED_PATTERNS, getPythonCommand, executeWithTimeout } from './codeOps.js';
import { generateImageVertex, generateVideoVertex, pollVeoOperation } from '../services/vertexMedia.js';
import { generateImage as bflGenerateImage, editImage as bflEditImage } from '../services/bflClient.js';
import { getGCPAccessToken } from '../services/gcpAuth.js';

export function registerCodingRoutes(ctx) {
  const {
    app, db, stmts, requireAuth, requireAuthOrToken, checkPlanLimits,
    setupSSE, sendSSE, sendError,
    DEFAULT_MODELS, PLAN_LIMITS, MODEL_METADATA,
    userWorkspaces, cfR2,
    rootDir,
  } = ctx;

  const __dirname = rootDir;
  const PORT = process.env.PORT || 3002;
  const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

  // ============================================================================
  // MULTI-AGENT CODING ARCHITECTURE — Server-Side Tool Loop
  // ============================================================================


  // --- User workspace registry ---
  const WORKSPACE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
  const MAX_WORKSPACES = 500; // Prevent unbounded growth

  /** Evict least-recently-accessed workspaces when map exceeds size cap */
  function evictStaleWorkspaces() {
    if (userWorkspaces.size <= MAX_WORKSPACES) return;
    const entries = [...userWorkspaces.entries()].sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    const toEvict = entries.slice(0, userWorkspaces.size - MAX_WORKSPACES);
    for (const [userId, ws] of toEvict) {
      fs.rm(ws.path, { recursive: true, force: true }).catch(() => {});
      userWorkspaces.delete(userId);
      console.log(`[Workspace] Evicted LRU workspace: ${userId}`);
    }
  }

  function getUserWorkspacePath(userId) {
    return path.join(os.tmpdir(), 'alin-workspaces', userId);
  }

  function sanitizePath(p) {
    return path.normalize(p).replace(/^(\.\.[/\\])+/, '').replace(/\\/g, '/');
  }

  function isWithinDirectory(fullPath, baseDir) {
    return path.resolve(fullPath).startsWith(path.resolve(baseDir));
  }

  // --- Non-streaming Claude API call (for tool loop + scan agent) ---
  async function callClaudeSync({ model, messages, system, tools, maxTokens }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const body = {
      model: model || DEFAULT_MODELS.claudeSonnet,
      max_tokens: maxTokens || 16384,
      stream: false,
      messages,
    };
    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = tools;

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return response.json();
      }

      // Retry on 429 (rate limit), 500 (transient API error), and 529 (overloaded)
      if ((response.status === 429 || response.status === 500 || response.status === 529) && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '0', 10);
        const jitter = Math.random() * 500;
        const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt), 10000) + jitter;
        console.warn(`[callClaudeSync] ${response.status} — retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      const text = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${text.slice(0, 500)}`);
    }
  }

  // --- Compress tool result (cap at 70K chars) ---
  function compressToolResult(result) {
    if (!result || typeof result !== 'string') return result || '';
    if (result.length <= 70000) return result;
    return result.slice(0, 70000) + `\n\n[...truncated, ${result.length} chars total]`;
  }

  // --- Internal tool handler functions (workspace-scoped) ---

  async function toolFileRead(input, workspacePath) {
    try {
      const filePath = sanitizePath(input.path || '');
      const fullPath = path.join(workspacePath, filePath);
      if (!isWithinDirectory(fullPath, workspacePath)) {
        return { success: false, error: 'Path traversal detected' };
      }
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, result: content };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolFileWrite(input, workspacePath) {
    try {
      const filePath = sanitizePath(input.path || '');
      const fullPath = path.join(workspacePath, filePath);
      if (!isWithinDirectory(fullPath, workspacePath)) {
        return { success: false, error: 'Path traversal detected' };
      }
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, input.content || '');
      return { success: true, result: `File written: ${filePath} (${(input.content || '').length} bytes)` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolFileList(input, workspacePath) {
    try {
      const dirPath = sanitizePath(input.path || '.');
      const fullPath = path.join(workspacePath, dirPath);
      if (!isWithinDirectory(fullPath, workspacePath)) {
        return { success: false, error: 'Path traversal detected' };
      }
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const list = entries.map(e => `${e.isDirectory() ? '[DIR] ' : ''}${e.name}`).join('\n');
      return { success: true, result: list || '(empty directory)' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolScanDirectory(input, workspacePath) {
    try {
      const scanPath = sanitizePath(input.path || '.');
      const rootPath = path.join(workspacePath, scanPath);
      if (!isWithinDirectory(rootPath, workspacePath)) {
        return { success: false, error: 'Path traversal detected' };
      }
      const maxDepth = input.maxDepth || input.depth || 3;
      const maxFiles = input.maxFiles || 50;
      const excludeSet = new Set(SCAN_DEFAULTS.defaultExclude);
      const files = [];
      let totalSize = 0;
      const treeLines = [];

      async function walk(dir, depth, prefix) {
        if (depth > maxDepth || files.length >= maxFiles || totalSize >= 2 * 1024 * 1024) return;
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });
        for (let i = 0; i < entries.length; i++) {
          if (files.length >= maxFiles) break;
          const entry = entries[i];
          if (excludeSet.has(entry.name)) continue;
          const isLast = i === entries.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const childPrefix = prefix + (isLast ? '    ' : '│   ');
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            treeLines.push(`${prefix}${connector}${entry.name}/`);
            await walk(fullPath, depth + 1, childPrefix);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
            treeLines.push(`${prefix}${connector}${entry.name}`);
            try {
              const stat = await fs.stat(fullPath);
              if (stat.size <= 100 * 1024 && totalSize + stat.size <= 2 * 1024 * 1024) {
                const content = await fs.readFile(fullPath, 'utf-8');
                const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
                files.push({ path: relPath, content });
                totalSize += stat.size;
              }
            } catch {}
          }
        }
      }

      treeLines.push(path.basename(rootPath) + '/');
      await walk(rootPath, 0, '');

      let result = `## Directory Tree\n\`\`\`\n${treeLines.join('\n')}\n\`\`\`\n\n## File Contents\n`;
      for (const f of files) {
        const ext = path.extname(f.path).replace('.', '') || 'text';
        result += `\n### ${f.path}\n\`\`\`${ext}\n${f.content}\n\`\`\`\n`;
      }
      result += `\n(${files.length} files, ${Math.round(totalSize / 1024)}KB total)`;

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolCodeSearch(input, workspacePath) {
    try {
      const query = input.query || input.pattern || '';
      if (!query) return { success: false, error: 'Query is required' };
      const searchPath = sanitizePath(input.path || '.');
      const rootPath = path.join(workspacePath, searchPath);
      if (!isWithinDirectory(rootPath, workspacePath)) {
        return { success: false, error: 'Path traversal detected' };
      }
      const excludeSet = new Set(SCAN_DEFAULTS.defaultExclude);
      const matches = [];
      const maxResults = 100;

      let searchRegex;
      try { searchRegex = new RegExp(query, 'gi'); } catch { searchRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }

      async function searchDir(dir) {
        if (matches.length >= maxResults) return;
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (matches.length >= maxResults) break;
          if (excludeSet.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) { await searchDir(fullPath); continue; }
          const ext = path.extname(entry.name).toLowerCase();
          if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size > 100 * 1024) continue;
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let ln = 0; ln < lines.length && matches.length < maxResults; ln++) {
              searchRegex.lastIndex = 0;
              if (searchRegex.test(lines[ln])) {
                const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
                matches.push(`${relPath}:${ln + 1}: ${lines[ln].trim()}`);
              }
            }
          } catch {}
        }
      }

      await searchDir(rootPath);
      return { success: true, result: matches.length > 0 ? matches.join('\n') : 'No matches found.' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolEditFile(input, workspacePath) {
    try {
      const filePath = sanitizePath(input.path || '');
      const fullPath = path.join(workspacePath, filePath);
      if (!isWithinDirectory(fullPath, workspacePath)) {
        return { success: false, error: 'Path traversal detected' };
      }
      const oldStr = input.old_str ?? input.oldStr ?? '';
      const newStr = input.new_str ?? input.newStr ?? '';
      if (!oldStr) return { success: false, error: 'old_str is required' };

      const content = await fs.readFile(fullPath, 'utf-8');
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) return { success: false, error: `old_str not found in ${filePath}` };
      if (occurrences > 1) return { success: false, error: `old_str found ${occurrences} times in ${filePath} — must be unique. Include more surrounding context.` };

      const newContent = content.replace(oldStr, newStr);
      await fs.writeFile(fullPath, newContent);
      return { success: true, result: `Edited ${filePath}: replaced ${oldStr.length} chars with ${newStr.length} chars` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolRunCommand(input, workspacePath) {
    try {
      const command = input.command || '';
      if (!command) return { success: false, error: 'Command is required' };
      const cmdLower = command.toLowerCase().trim();
      for (const dangerous of DANGEROUS_COMMANDS) {
        if (cmdLower.includes(dangerous.toLowerCase())) {
          return { success: false, error: `Command blocked: contains "${dangerous}"` };
        }
      }

      const result = await new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, cwd: workspacePath, timeout: 60000, env: { ...process.env, FORCE_COLOR: '0' } });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 200000) child.kill('SIGTERM'); });
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
        child.on('error', reject);
      });

      let output = '';
      if (result.stdout) output += result.stdout.slice(0, 100000);
      if (result.stderr) output += (output ? '\n--- stderr ---\n' : '') + result.stderr.slice(0, 20000);
      output += `\n(exit code: ${result.exitCode})`;
      return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolGit(input, workspacePath) {
    try {
      const operation = input.operation || '';
      const args = Array.isArray(input.args) ? input.args : (input.args ? [input.args] : []);
      if (!operation) return { success: false, error: 'Operation is required' };

      const allOps = [...GIT_READ_OPS, ...GIT_WRITE_OPS];
      if (!allOps.includes(operation)) {
        return { success: false, error: `Unknown git operation: "${operation}". Allowed: ${allOps.join(', ')}` };
      }

      const fullCmd = `${operation} ${args.join(' ')}`.toLowerCase();
      for (const blocked of GIT_BLOCKED_PATTERNS) {
        if (fullCmd.includes(blocked)) {
          return { success: false, error: `Git operation blocked: "${blocked}" not allowed` };
        }
      }

      const gitArgs = [operation, ...args];
      const result = await new Promise((resolve, reject) => {
        const child = spawn('git', gitArgs, { cwd: workspacePath, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { stdout += d.toString(); });
        child.stderr.on('data', d => { stderr += d.toString(); });
        child.on('close', exitCode => resolve({ stdout, stderr, exitCode }));
        child.on('error', reject);
      });

      let output = result.stdout.slice(0, 100000);
      if (result.stderr) output += '\n' + result.stderr.slice(0, 20000);
      return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolExecuteCode(input) {
    try {
      const { language, code } = input;
      if (!code) return { success: false, error: 'Code is required' };
      const tempDir = os.tmpdir();
      const lang = (language || 'python').toLowerCase();
      const ext = (lang === 'python' || lang === 'py') ? 'py' : 'js';
      const tempFile = path.join(tempDir, `alin-exec-${Date.now()}.${ext}`);
      await fs.writeFile(tempFile, code);
      const pyCmd = getPythonCommand();
      const cmd = (lang === 'python' || lang === 'py') ? `${pyCmd} "${tempFile}"` : `node "${tempFile}"`;

      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(cmd, { shell: true, timeout: 35000 });
        let stdout = '', stderr = '';
        child.stdout.on('data', d => { if (stdout.length < 512000) stdout += d.toString(); });
        child.stderr.on('data', d => { if (stderr.length < 128000) stderr += d.toString(); });
        child.on('close', exitCode => { if (!settled) { settled = true; resolve({ stdout, stderr, exitCode }); } });
        child.on('error', err => { if (!settled) { settled = true; reject(err); } });
        setTimeout(() => {
          if (!settled) { settled = true; try { child.kill('SIGTERM'); } catch {} resolve({ stdout, stderr: stderr + '\n[Timed out after 30s]', exitCode: 124 }); }
        }, 30000);
      });

      try { await fs.unlink(tempFile); } catch {}
      let output = result.stdout.slice(0, 50000);
      if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 10000);
      return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolWebSearch(input) {
    try {
      const query = input.query || '';
      if (!query) return { success: false, error: 'Query is required' };
      const braveKey = process.env.BRAVE_API_KEY || process.env.VITE_BRAVE_API_KEY;
      if (!braveKey) return { success: false, error: 'Brave API key not configured' };

      const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`, {
        headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': braveKey },
      });
      if (!resp.ok) return { success: false, error: `Search failed: ${resp.status}` };
      const data = await resp.json();
      const results = (data.web?.results || []).map(r => `**${r.title}**\n${r.url}\n${r.description || ''}`).join('\n\n');
      return { success: true, result: results || 'No results found.' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolMemoryStore(input, userId) {
    try {
      const { content, tags, category } = input;
      if (!content) return { success: false, error: 'Content is required' };
      const id = randomUUID();
      const now = Date.now();
      stmts.insertMemory.run(id, content, 'general', category || '', 0.5, 0, JSON.stringify(tags || []), '[]', '[]', '{}', 0, 0, 0, now, now, userId);
      return { success: true, result: `Memory stored (id: ${id.slice(0, 8)})` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolMemoryRecall(input, userId) {
    try {
      const query = input.query || '';
      if (!query) return { success: false, error: 'Query is required' };
      const rows = stmts.listMemories.all(userId);
      const queryLower = query.toLowerCase();
      const matching = rows.filter(r => r.content.toLowerCase().includes(queryLower)).slice(0, 10);
      if (matching.length === 0) return { success: true, result: 'No matching memories found.' };
      return { success: true, result: matching.map(m => `- ${m.content}`).join('\n') };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // --- Template library tools ---
  async function toolListTemplates() {
    try {
      const manifest = await cfR2.getTemplateManifest();
      if (!manifest.templates || manifest.templates.length === 0) {
        return { success: true, templates: [], message: 'No templates available. Build from scratch using design standards.' };
      }
      // Return summary (don't include file contents, just metadata)
      const templates = manifest.templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        pages: t.pages,
        components: t.components,
        tags: t.tags,
        tier: t.tier,
      }));
      return { success: true, templates };
    } catch (err) {
      return { success: false, error: `Failed to list templates: ${err.message}` };
    }
  }

  async function toolGetTemplate(input) {
    const templateId = input.template_id || input.templateId || input.id;
    if (!templateId) return { success: false, error: 'template_id is required' };

    try {
      const result = await cfR2.getTemplate(templateId);
      if (!result) {
        return { success: false, error: `Template "${templateId}" not found. Use list_templates to see available options.` };
      }
      return {
        success: true,
        template: result.template,
        files: result.files,
        instructions: 'Replace ALL {{VARIABLE}} placeholders with real content. Customize colors in CSS :root variables. Adapt copy to match the user\'s brand voice. Add/remove sections as needed. NEVER deploy with placeholder variables still present.',
      };
    } catch (err) {
      return { success: false, error: `Failed to fetch template: ${err.message}` };
    }
  }

  // --- Video URL parser (supports YouTube, Vimeo, Loom, Twitch, Dailymotion) ---
  function parseVideoUrl(url) {
    try {
      const u = new URL(url);

      // === YouTube ===
      if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
        let videoId = null;
        let timestamp = 0;
        if (u.hostname.includes('youtu.be')) {
          videoId = u.pathname.slice(1).split('/')[0];
        } else if (u.pathname.startsWith('/watch')) {
          videoId = u.searchParams.get('v');
        } else if (u.pathname.startsWith('/embed/')) {
          videoId = u.pathname.split('/embed/')[1]?.split(/[?/]/)[0];
        } else if (u.pathname.startsWith('/shorts/')) {
          videoId = u.pathname.split('/shorts/')[1]?.split(/[?/]/)[0];
        } else if (u.pathname.startsWith('/live/')) {
          videoId = u.pathname.split('/live/')[1]?.split(/[?/]/)[0];
        }
        const tParam = u.searchParams.get('t');
        if (tParam) {
          const match = tParam.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
          if (match) {
            timestamp = (parseInt(match[1] || '0') * 3600) + (parseInt(match[2] || '0') * 60) + parseInt(match[3] || tParam || '0');
          }
        }
        if (!videoId) return null;
        let embedUrl = `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1`;
        if (timestamp > 0) embedUrl += `&start=${timestamp}`;
        return { platform: 'youtube', videoId, embedUrl, thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, timestamp };
      }

      // === Vimeo ===
      if (u.hostname.includes('vimeo.com')) {
        const match = u.pathname.match(/\/(?:video\/)?(\d+)/);
        if (!match) return null;
        return { platform: 'vimeo', videoId: match[1], embedUrl: `https://player.vimeo.com/video/${match[1]}?byline=0&portrait=0`, thumbnail: null, timestamp: 0 };
      }

      // === Loom ===
      if (u.hostname.includes('loom.com')) {
        const match = u.pathname.match(/\/(?:share|embed)\/([a-f0-9]+)/);
        if (!match) return null;
        return { platform: 'loom', videoId: match[1], embedUrl: `https://www.loom.com/embed/${match[1]}`, thumbnail: `https://cdn.loom.com/sessions/thumbnails/${match[1]}-00001.jpg`, timestamp: 0 };
      }

      // === Twitch ===
      if (u.hostname.includes('twitch.tv')) {
        const videoMatch = u.pathname.match(/\/videos\/(\d+)/);
        if (videoMatch) {
          return { platform: 'twitch', videoId: videoMatch[1], embedUrl: `https://player.twitch.tv/?video=${videoMatch[1]}&parent=${process.env.ALIN_SITES_DOMAIN || 'alinai.dev'}&autoplay=false`, thumbnail: null, timestamp: 0 };
        }
        const clipMatch = u.pathname.match(/\/([^/]+)\/clip\/([^/?]+)/);
        if (clipMatch) {
          return { platform: 'twitch', videoId: clipMatch[2], embedUrl: `https://clips.twitch.tv/embed?clip=${clipMatch[2]}&parent=${process.env.ALIN_SITES_DOMAIN || 'alinai.dev'}&autoplay=false`, thumbnail: null, timestamp: 0 };
        }
        return null;
      }

      // === Dailymotion ===
      if (u.hostname.includes('dailymotion.com') || u.hostname.includes('dai.ly')) {
        let videoId = null;
        if (u.hostname.includes('dai.ly')) { videoId = u.pathname.slice(1); }
        else { const match = u.pathname.match(/\/video\/([a-z0-9]+)/i); if (match) videoId = match[1]; }
        if (!videoId) return null;
        return { platform: 'dailymotion', videoId, embedUrl: `https://www.dailymotion.com/embed/video/${videoId}`, thumbnail: `https://www.dailymotion.com/thumbnail/video/${videoId}`, timestamp: 0 };
      }

      return null;
    } catch { return null; }
  }

  // --- Main tool dispatcher ---
  async function executeToolServerSide(toolName, toolInput, workspacePath, userId) {
    switch (toolName) {
      case 'file_read': return toolFileRead(toolInput, workspacePath);
      case 'file_write': return toolFileWrite(toolInput, workspacePath);
      case 'file_list': return toolFileList(toolInput, workspacePath);
      case 'scan_directory': return toolScanDirectory(toolInput, workspacePath);
      case 'code_search': return toolCodeSearch(toolInput, workspacePath);
      case 'edit_file': return toolEditFile(toolInput, workspacePath);
      case 'run_command': return toolRunCommand(toolInput, workspacePath);
      case 'execute_code': return toolExecuteCode(toolInput);
      case 'git': return toolGit(toolInput, workspacePath);
      case 'web_search': return toolWebSearch(toolInput);
      case 'web_fetch': return toolWebFetch(toolInput);
      case 'memory_store': return toolMemoryStore(toolInput, userId);
      case 'memory_recall': return toolMemoryRecall(toolInput, userId);
      case 'spawn_scan_agent': return runScanAgent(toolInput.task || toolInput.query || '', workspacePath, userId);
      case 'list_templates': return toolListTemplates();
      case 'get_template': return toolGetTemplate(toolInput);
      case 'generate_image': return toolGenerateImage(toolInput, userId);
      case 'edit_image': return toolEditImage(toolInput, userId);
      case 'generate_video': return toolGenerateVideo(toolInput);
      case 'embed_video': {
        const parsed = parseVideoUrl(toolInput.url);
        if (!parsed) return { success: false, error: `Could not parse video URL: ${toolInput.url}. Supported: YouTube, Vimeo, Loom, Twitch, Dailymotion.` };
        return { success: true, message: `Video embedded: ${toolInput.title || toolInput.url}`, platform: parsed.platform, embed_url: parsed.embedUrl, video_embed: { url: toolInput.url, embed_url: parsed.embedUrl, platform: parsed.platform, title: toolInput.title || '', context: toolInput.context || '', thumbnail: parsed.thumbnail || '', timestamp: parsed.timestamp || 0 } };
      }
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  }

  // --- Coding mode tool definitions (sent to Claude) ---
  const CODING_TOOLS = [
    { name: 'file_read', description: 'Read a file from the workspace', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path within workspace' } }, required: ['path'] } },
    { name: 'file_write', description: 'Write/create a file in the workspace', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path' }, content: { type: 'string', description: 'File content' } }, required: ['path', 'content'] } },
    { name: 'file_list', description: 'List files in a directory', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory path (default: .)' } } } },
    { name: 'scan_directory', description: 'Recursively scan a directory tree and read all file contents in one call. Use this FIRST to understand a codebase.', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'Relative path (default: .)' }, depth: { type: 'number', description: 'Max depth (default: 3)' }, maxFiles: { type: 'number', description: 'Max files to read (default: 50)' } } } },
    { name: 'code_search', description: 'Search for text/regex patterns across files (like grep/ripgrep)', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Search pattern (supports regex)' }, path: { type: 'string', description: 'Directory to search (default: .)' } }, required: ['query'] } },
    { name: 'edit_file', description: 'Find-and-replace edit. old_str must be unique in the file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string', description: 'Exact text to find (must be unique)' }, new_str: { type: 'string', description: 'Replacement text' } }, required: ['path', 'old_str', 'new_str'] } },
    { name: 'run_command', description: 'Execute a shell command in the workspace (npm test, npm run build, etc.)', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
    { name: 'execute_code', description: 'Execute Python or JavaScript code', input_schema: { type: 'object', properties: { language: { type: 'string', enum: ['python', 'javascript'] }, code: { type: 'string' } }, required: ['language', 'code'] } },
    { name: 'git', description: 'Execute git operations (status, diff, log, add, commit, etc.)', input_schema: { type: 'object', properties: { operation: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['operation'] } },
    { name: 'web_search', description: 'Search the web for information', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'web_fetch', description: 'Fetch the contents of a URL directly. Returns the text/HTML content of any publicly accessible web page.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Full URL to fetch (must start with http:// or https://)' } }, required: ['url'] } },
    { name: 'memory_store', description: 'Store information for later recall', input_schema: { type: 'object', properties: { content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string' } }, required: ['content'] } },
    { name: 'memory_recall', description: 'Search stored memories', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'spawn_scan_agent', description: 'Spawn a fast read-only subagent (Haiku) to explore and analyze the codebase. Returns a summary. Use for large-scale code understanding without consuming main context.', input_schema: { type: 'object', properties: { task: { type: 'string', description: 'What to explore/analyze (e.g., "Find all React components that use useState")' } }, required: ['task'] } },
    { name: 'list_templates', description: 'List all available website templates from the ALIN template library. Returns template IDs, names, descriptions, categories, and which components each includes. Use this FIRST when a user wants to build a website — check if a template matches before building from scratch.', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_template', description: 'Fetch a specific website template by ID. Returns all template files (HTML, CSS, JS) with {{VARIABLE}} placeholders. Adapt the template to the user\'s needs by replacing all variables with real content, adjusting colors/fonts, and customizing copy. NEVER deploy a raw template — always customize it.', input_schema: { type: 'object', properties: { template_id: { type: 'string', description: 'Template ID from list_templates (e.g., "saas-landing", "portfolio", "restaurant")' } }, required: ['template_id'] } },
    { name: 'generate_image', description: 'Generate a new image using one of multiple AI providers.\n\nBEFORE GENERATING — ALWAYS ask the user which provider they want:\n- **FLUX.2 [max]** — Best for: logos, typography, text in images, hex color precision, brand consistency.\n- **DALL-E 3** — Best for: creative illustrations, artistic styles, conceptual art, stylized content.\n- **Imagen 4.0** — Best for: photorealistic people, natural scenes, product photography.\n- **Imagen 4.0 Fast** — Best for: quick drafts when iterating rapidly.\n- **Imagen 4.0 Ultra** — Best for: highest possible photorealistic quality.\n\nIf the user says "just pick" or "whatever works best," auto-select based on prompt content:\n- Text/logo/brand/typography → flux2-max\n- People/portrait/photo/lifestyle → imagen-4\n- Artistic/illustration/creative/fantasy → dall-e-3\n- "quick"/"draft"/"iterate" → imagen-4-fast\n- Maximum quality requested → imagen-4-ultra\n\nNEVER override user-provided images without explicit permission.', input_schema: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed image description.' }, provider: { type: 'string', enum: ['flux2-max', 'dall-e-3', 'imagen-4', 'imagen-4-fast', 'imagen-4-ultra'], description: 'Which provider to use. User must choose or say just pick.' }, width: { type: 'integer', description: 'Image width in pixels. Default 1024.' }, height: { type: 'integer', description: 'Image height in pixels. Default 1024.' }, reference_images: { type: 'array', items: { type: 'string' }, description: 'Reference image URLs for consistency' }, purpose: { type: 'string', enum: ['hero', 'background', 'logo', 'product', 'portrait', 'illustration', 'icon', 'card', 'decorative', 'other'], description: 'Intended use of this image.' } }, required: ['prompt', 'provider'] } },
    { name: 'edit_image', description: 'Edit an existing image using AI. Use when a user uploads/sends a picture and asks for modifications.\n\nTwo editing providers:\n- **Nano Banana Pro** (Google) — Handles the widest range of edits: remove/add objects, change backgrounds, style transfer, color grading, text overlay. Default choice.\n- **FLUX.2 [max]** (BFL) — Better for: retexturing, material changes, precise brand color adjustments.\n\nDefault to Nano Banana Pro unless the edit is specifically about retexturing or brand color precision.', input_schema: { type: 'object', properties: { prompt: { type: 'string', description: 'What to change.' }, source_image_base64: { type: 'string', description: 'Base64-encoded image data from user upload.' }, source_image_url: { type: 'string', description: 'URL of image to edit (alternative to base64).' }, provider: { type: 'string', enum: ['nano-banana', 'flux2-max'], description: 'Default: nano-banana' } }, required: ['prompt'] } },
    { name: 'generate_video', description: 'Generate a short AI video from a text prompt. When a user asks for video, ALWAYS ask quality preference:\n- **Full quality** (Veo 3.1) — Best results, takes ~30-90 seconds. For final deliverables.\n- **Fast draft** (Veo 3.1 Fast) — Quick preview, ~10-20 seconds. For iteration.\n\nVideos are 4-8 seconds long. Elite plan only.\nInclude in prompt: subject, action/movement, camera motion, lighting, style.', input_schema: { type: 'object', properties: { prompt: { type: 'string', description: 'Detailed video description with subject, action, camera, lighting, style.' }, provider: { type: 'string', enum: ['veo-3.1', 'veo-3.1-fast'], description: 'User must choose quality tier.' }, duration_seconds: { type: 'integer', enum: [4, 6, 8], description: 'Video duration. Default 4.' }, aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '16:9 landscape, 9:16 portrait, 1:1 square.' } }, required: ['prompt', 'provider'] } },
    { name: 'embed_video', description: 'Embed a video player directly in the chat. Use proactively when a video would help the user understand better than text alone. WHEN TO USE: user asks "how do I..." for anything visual, asks about a product/app/service, is debugging something with video walkthroughs, asks about a concept with famous explanations, mentions music/movies/trailers, or struggles with something that has great tutorials. You do NOT need the user to ask for a video — if a great video exists for the topic, embed it alongside your text.', input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Video URL (YouTube, Vimeo, Loom, Twitch, Dailymotion). Must be a real, valid URL.' }, title: { type: 'string', description: 'Brief title/description (e.g., "Fireship: React in 100 Seconds")' }, context: { type: 'string', description: 'One sentence explaining why this video is relevant.' } }, required: ['url'] } },
  ];

  // DEPRECATED: Coding mode prompt now served by server/prompts/codingMode.js
  // Kept as fallback — will be removed in a future cleanup pass.
  const CODING_SERVER_SYSTEM_PROMPT = `You are ALIN in coding mode — an expert autonomous software engineer. You solve coding tasks by working through them methodically: reading, understanding, planning, implementing, and verifying.

  CORE PRINCIPLES:
  1. Read before writing. Always call scan_directory or file_read first.
  2. Verify after changing. Run tests or check for errors after every edit.
  3. Fix your own mistakes. If something breaks, fix it yourself.
  4. Minimize user interruption. Complete the task autonomously.
  5. Work in tight loops. Think → Act → Observe → Repeat.

  WORKFLOW:
  1. scan_directory → understand project structure in ONE call
  2. code_search → find definitions, imports, usages
  3. edit_file or file_write → implement changes
  4. run_command → verify (npm test, tsc --noEmit, etc.)
  5. Repeat until complete

  Use spawn_scan_agent for large-scale codebase exploration — it uses a fast model to scan and summarize without consuming your context.

  All file paths are relative to the workspace root. Never use absolute paths.`;

  // --- Scan subagent (Haiku-powered read-only codebase explorer) ---
  async function runScanAgent(task, workspacePath, userId) {
    if (!task) return { success: false, error: 'Task is required' };

    const scanTools = CODING_TOOLS.filter(t => ['file_read', 'file_list', 'scan_directory', 'code_search'].includes(t.name));
    const scanSystem = `You are a fast, read-only code scanner. Your job is to explore a codebase and provide a clear, structured summary.

  You have these read-only tools: file_read, file_list, scan_directory, code_search.
  Use scan_directory first to get an overview, then drill into specific files as needed.
  All paths are relative to the workspace root.

  Be thorough but concise. Return a structured summary answering the user's question.`;

    let messages = [{ role: 'user', content: task }];
    const MAX_SCAN_ITERATIONS = 10;

    for (let i = 0; i < MAX_SCAN_ITERATIONS; i++) {
      const response = await callClaudeSync({
        model: DEFAULT_MODELS.claudeHaiku,
        messages,
        system: scanSystem,
        tools: scanTools,
        maxTokens: 16384,
      });

      // Extract text
      const textBlocks = (response.content || []).filter(b => b.type === 'text');
      const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        // Done — return final text
        const summary = textBlocks.map(b => b.text).join('\n');
        return { success: true, result: summary || 'Scan completed but no summary was generated.' };
      }

      // Execute tools and continue
      messages.push({ role: 'assistant', content: response.content });

      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        const result = await executeToolServerSide(toolUse.name, toolUse.input, workspacePath, userId);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: compressToolResult(result.success ? (result.result || 'Done') : `Error: ${result.error}`),
          is_error: !result.success,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return { success: true, result: 'Scan agent reached maximum iterations.' };
  }

  // --- Main coding tool loop endpoint ---
  app.post('/api/coding/stream', requireAuth, checkPlanLimits, async (req, res) => {
    const { messages, workspaceId, model, system } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array required' });
    }

    const userId = req.user.id;
    const wsId = workspaceId || userId;
    const workspacePath = getUserWorkspacePath(wsId);

    // Ensure workspace exists
    try { await fs.mkdir(workspacePath, { recursive: true }); } catch {}

    // Update workspace registry
    userWorkspaces.set(userId, {
      path: workspacePath,
      createdAt: userWorkspaces.get(userId)?.createdAt || Date.now(),
      lastAccessed: Date.now(),
    });

    setupSSE(res);
    sendSSE(res, 'start', { model: model || DEFAULT_MODELS.claudeSonnet, provider: 'anthropic' });

    const MAX_ITERATIONS = 25;
    const MAX_DURATION_MS = 5 * 60 * 1000; // 5-minute time budget
    const streamStartTime = Date.now();
    const systemPrompt = (system && system !== '[DEPRECATED]')
        ? system
        : assemblePrompt('coding', { additionalContext: req.body.additionalContext || '' });
    const selectedModel = model || DEFAULT_MODELS.claudeSonnet;
    let conversationMessages = [...messages];

    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        // Time budget enforcement
        if (Date.now() - streamStartTime > MAX_DURATION_MS) {
          sendSSE(res, 'text_delta', { text: '\n\n*Time budget exceeded (5 minutes). Stopping execution.*' });
          sendSSE(res, 'done', { stopReason: 'time_budget', model: selectedModel, iterations: iteration });
          res.end();
          return;
        }
        // Call Claude (non-streaming)
        const response = await callClaudeSync({
          model: selectedModel,
          messages: conversationMessages,
          system: systemPrompt,
          tools: CODING_TOOLS,
          maxTokens: 16384,
        });

        const contentBlocks = response.content || [];
        const textBlocks = contentBlocks.filter(b => b.type === 'text');
        const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');

        // Send text to client
        for (const tb of textBlocks) {
          if (tb.text) sendSSE(res, 'text_delta', { text: tb.text });
        }

        // If no tool calls, we're done
        if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
          sendSSE(res, 'done', {
            stopReason: response.stop_reason || 'end_turn',
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0,
            model: selectedModel,
            iterations: iteration + 1,
          });
          res.end();
          return;
        }

        // Execute each tool
        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          const activityId = randomUUID();
          sendSSE(res, 'tool_start', {
            activityId,
            toolName: toolUse.name,
            toolInput: toolUse.input,
          });

          const result = await executeToolServerSide(toolUse.name, toolUse.input, workspacePath, userId);

          // If tool returned video_embed data, send it as a special SSE event for inline rendering
          if (result.video_embed) {
            sendSSE(res, 'video_embed', result.video_embed);
          }

          const rawResult = result.success ? (result.result || result.message || 'Done') : `Error: ${result.error}`;
          sendSSE(res, 'tool_result', {
            activityId,
            toolName: toolUse.name,
            success: result.success,
            result: typeof rawResult === 'string' ? rawResult.slice(0, 2000) : JSON.stringify(rawResult).slice(0, 2000),
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: compressToolResult(rawResult),
            is_error: !result.success,
          });
        }

        // Append to conversation for next iteration
        conversationMessages.push({ role: 'assistant', content: contentBlocks });
        conversationMessages.push({ role: 'user', content: toolResults });
      }

      // Reached max iterations
      sendSSE(res, 'text_delta', { text: '\n\n*Reached maximum tool iterations (25). You can continue by sending another message.*' });
      sendSSE(res, 'done', { stopReason: 'max_iterations', model: selectedModel, iterations: MAX_ITERATIONS });
      res.end();
    } catch (error) {
      console.error('[CodingLoop] Error:', error.message);
      try { sendSSE(res, 'error', { error: error.message }); } catch {}
      try { res.end(); } catch {}
    }
  });

  // --- Scan agent endpoint (client-initiated) ---
  app.post('/api/coding/scan-agent', requireAuth, async (req, res) => {
    try {
      const { task, workspaceId } = req.body;
      if (!task) return res.status(400).json({ error: 'task is required' });

      const userId = req.user.id;
      const wsId = workspaceId || userId;
      const workspacePath = getUserWorkspacePath(wsId);

      const result = await runScanAgent(task, workspacePath, userId);
      res.json(result);
    } catch (error) {
      console.error('[ScanAgent] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  // POST /api/workspace/init — Create/get workspace
  app.post('/api/workspace/init', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(userId);
      await fs.mkdir(workspacePath, { recursive: true });

      userWorkspaces.set(userId, {
        path: workspacePath,
        createdAt: userWorkspaces.get(userId)?.createdAt || Date.now(),
        lastAccessed: Date.now(),
      });

      console.log(`[Workspace] Initialized user workspace: ${workspacePath}`);
      res.json({ success: true, workspaceId: userId, workspacePath });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // POST /api/workspace/upload — Upload files (with zip auto-extraction)
  app.post('/api/workspace/upload', requireAuth, upload.array('files', 50), async (req, res) => {
    try {
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(userId);
      await fs.mkdir(workspacePath, { recursive: true });

      const uploadedFiles = [];

      for (const file of (req.files || [])) {
        const targetDir = req.body.targetDir ? sanitizePath(req.body.targetDir) : '';
        const destDir = path.join(workspacePath, targetDir);

        if (!isWithinDirectory(destDir, workspacePath)) {
          continue; // skip path traversal attempts
        }

        // Check if zip file — auto-extract
        if (file.originalname.toLowerCase().endsWith('.zip')) {
          try {
            const zipData = await fs.readFile(file.path);
            const zip = await JSZip.loadAsync(zipData);
            const entries = Object.entries(zip.files);

            for (const [entryName, zipEntry] of entries) {
              if (zipEntry.dir) continue;
              const safeName = sanitizePath(entryName);
              const entryDest = path.join(destDir, safeName);
              if (!isWithinDirectory(entryDest, workspacePath)) continue;

              await fs.mkdir(path.dirname(entryDest), { recursive: true });
              const content = await zipEntry.async('nodebuffer');
              await fs.writeFile(entryDest, content);
              uploadedFiles.push(path.relative(workspacePath, entryDest).replace(/\\/g, '/'));
            }
          } catch (zipErr) {
            console.error('[Workspace] Zip extraction error:', zipErr.message);
          }
        } else {
          // Regular file — copy to workspace
          const safeName = sanitizePath(file.originalname);
          const dest = path.join(destDir, safeName);
          if (!isWithinDirectory(dest, workspacePath)) continue;

          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(file.path, dest);
          uploadedFiles.push(path.relative(workspacePath, dest).replace(/\\/g, '/'));
        }

        // Clean up temp file
        try { await fs.unlink(file.path); } catch {}
      }

      // Update workspace registry
      userWorkspaces.set(userId, {
        path: workspacePath,
        createdAt: userWorkspaces.get(userId)?.createdAt || Date.now(),
        lastAccessed: Date.now(),
      });

      console.log(`[Workspace] Uploaded ${uploadedFiles.length} files for user ${userId}`);
      res.json({ success: true, files: uploadedFiles, count: uploadedFiles.length });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // GET /api/workspace/tree — Recursive directory tree
  app.get('/api/workspace/tree', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(userId);

      async function buildTree(dir, depth = 0, maxDepth = 5) {
        if (depth > maxDepth) return [];
        let entries;
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }

        const result = [];
        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (const entry of entries) {
          if (SCAN_DEFAULTS.defaultExclude.includes(entry.name)) continue;
          const relativePath = path.relative(workspacePath, path.join(dir, entry.name)).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            const children = await buildTree(path.join(dir, entry.name), depth + 1, maxDepth);
            result.push({ name: entry.name, type: 'directory', path: relativePath, children });
          } else {
            try {
              const stat = await fs.stat(path.join(dir, entry.name));
              result.push({ name: entry.name, type: 'file', path: relativePath, size: stat.size });
            } catch {
              result.push({ name: entry.name, type: 'file', path: relativePath });
            }
          }
        }
        return result;
      }

      const tree = await buildTree(workspacePath);
      res.json({ success: true, files: tree });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // GET /api/workspace/file?path=... — Download single file
  app.get('/api/workspace/file', requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(userId);
      const filePath = req.query.path;
      if (!filePath) return res.status(400).json({ error: 'path query param required' });

      const relativePath = sanitizePath(filePath);
      const fullPath = path.join(workspacePath, relativePath);
      if (!isWithinDirectory(fullPath, workspacePath)) {
        return res.status(403).json({ error: 'Path traversal detected' });
      }

      const filename = path.basename(relativePath);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(path.resolve(fullPath));
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // GET /api/workspace/zip — Download all as zip
  app.get('/api/workspace/zip', requireAuthOrToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(userId);

      const zip = new JSZip();

      async function addDir(dirPath, zipFolder) {
        let entries;
        try { entries = await fs.readdir(dirPath, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (SCAN_DEFAULTS.defaultExclude.includes(entry.name)) continue;
          const entryPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await addDir(entryPath, zipFolder.folder(entry.name));
          } else {
            const content = await fs.readFile(entryPath);
            zipFolder.file(entry.name, content);
          }
        }
      }

      await addDir(workspacePath, zip);

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="workspace-${userId.slice(0, 8)}.zip"`);
      zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE' }).pipe(res);
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // DELETE /api/workspace — Delete workspace
  app.delete('/api/workspace', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(userId);
      try { await fs.rm(workspacePath, { recursive: true, force: true }); } catch {}
      userWorkspaces.delete(userId);
      console.log(`[Workspace] Deleted user workspace: ${userId}`);
      res.json({ success: true });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // --- Workspace TTL cleanup (every 6 hours) + LRU eviction ---
  setInterval(() => {
    const now = Date.now();
    for (const [userId, ws] of userWorkspaces) {
      if (now - ws.lastAccessed > WORKSPACE_TTL) {
        fs.rm(ws.path, { recursive: true, force: true }).catch(() => {});
        userWorkspaces.delete(userId);
        console.log(`[Workspace] Cleaned up stale workspace: ${userId}`);
      }
    }
    evictStaleWorkspaces();
  }, 6 * 60 * 60 * 1000);

  async function toolWebFetch(input) {
    try {
      const url = input.url;
      if (!url) return { success: false, error: 'URL is required' };
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: 'URL must start with http:// or https://' };
      }
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'ALIN/1.0 (AI Assistant)' },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      if (!resp.ok) return { success: false, error: `HTTP ${resp.status}: ${resp.statusText}` };
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('image') || contentType.includes('audio') || contentType.includes('video')) {
        return { success: true, result: `[Binary content: ${contentType}]` };
      }
      let result = await resp.text();
      if (contentType.includes('html')) {
        result = result.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
      }
      return { success: true, result: result.slice(0, 100000) };
    } catch (error) { return { success: false, error: error.message }; }
  }

  // ============================================================================
  // TOOL HANDLERS — GPU, WEBCAM, BLENDER (for unified executor)
  // ============================================================================

  async function toolGpuCompute(input) {
    try {
      const { script, framework, timeout } = input;
      if (!script) return { success: false, error: 'Script is required' };
      const pyCmd = getPythonCommand();
      const tempFile = path.join(os.tmpdir(), `alin-gpu-${Date.now()}.py`);
      await fs.writeFile(tempFile, script);
      const result = await executeWithTimeout(pyCmd, [tempFile], timeout || 120000);
      try { await fs.unlink(tempFile); } catch {}
      let output = result.stdout.slice(0, 100000);
      if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 20000);
      return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
    } catch (error) { return { success: false, error: error.message }; }
  }

  async function toolWebcamCapture(input) {
    try {
      const device = input.device ?? 0;
      const pyCmd = getPythonCommand();
      const outFile = path.join(os.tmpdir(), `alin_webcam_${Date.now()}.jpg`);
      const pyScript = `import cv2, base64, sys\ncap=cv2.VideoCapture(${device})\nret,frame=cap.read()\ncap.release()\nif not ret: sys.exit(1)\ncv2.imwrite("${outFile.replace(/\\/g, '/')}",frame)\nwith open("${outFile.replace(/\\/g, '/')}","rb") as f: print(base64.b64encode(f.read()).decode())`;
      const tempPy = path.join(os.tmpdir(), `alin_webcam_${Date.now()}.py`);
      await fs.writeFile(tempPy, pyScript);
      const result = await executeWithTimeout(pyCmd, [tempPy], 15000);
      try { await fs.unlink(tempPy); } catch {}
      try { await fs.unlink(outFile); } catch {}
      if (result.exitCode !== 0) return { success: false, error: result.stderr || 'Webcam capture failed (is OpenCV installed?)' };
      return { success: true, result: `data:image/jpeg;base64,${result.stdout.trim()}` };
    } catch (error) { return { success: false, error: error.message }; }
  }

  async function toolBlenderExecute(input) {
    try {
      const { script, blendFile, timeout } = input;
      if (!script) return { success: false, error: 'Script is required' };
      const tempScript = path.join(os.tmpdir(), `alin-blender-${Date.now()}.py`);
      await fs.writeFile(tempScript, script);
      const args = ['--background'];
      if (blendFile) args.push(blendFile);
      args.push('--python', tempScript);
      const result = await executeWithTimeout('blender', args, timeout || 120000);
      try { await fs.unlink(tempScript); } catch {}
      let output = result.stdout.slice(0, 100000);
      if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 20000);
      return { success: result.exitCode === 0, result: output, error: result.exitCode !== 0 ? output : undefined };
    } catch (error) { return { success: false, error: error.message }; }
  }

  async function toolBlenderRender(input) {
    try {
      const { blendFile, outputPath, engine, format, frame } = input;
      if (!blendFile) return { success: false, error: 'blendFile is required' };
      if (!outputPath) return { success: false, error: 'outputPath is required' };
      const args = ['--background', blendFile, '--render-output', outputPath];
      if (engine) args.push('--engine', engine);
      if (format) args.push('--render-format', format);
      args.push('--render-frame', String(frame || 1));
      const result = await executeWithTimeout('blender', args, 300000);
      let output = result.stdout.slice(0, 50000);
      if (result.stderr) output += '\n--- stderr ---\n' + result.stderr.slice(0, 10000);
      return { success: result.exitCode === 0, result: output || `Rendered to ${outputPath}`, error: result.exitCode !== 0 ? output : undefined };
    } catch (error) { return { success: false, error: error.message }; }
  }

  async function toolGenerateImage(input, userId = 'system') {
    try {
      const { prompt, provider, width, height, size, quality, style, reference_images, purpose } = input;
      if (!prompt) return { success: false, error: 'Prompt is required' };

      const selectedProvider = provider || 'dall-e-3';
      console.log(`[Image Gen] Provider: ${selectedProvider} | Prompt: "${prompt.slice(0, 80)}..." | User: ${userId}`);

      switch (selectedProvider) {

        // DALL-E 3 (OpenAI)
        case 'dall-e-3': {
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not configured' };

          // Map width/height to DALL-E 3 supported sizes: 1024x1024, 1792x1024, 1024x1792
          let dalleSize = size || '1024x1024';
          if (!size && width && height) {
            if (width > height * 1.2) dalleSize = '1792x1024';      // landscape
            else if (height > width * 1.2) dalleSize = '1024x1792';  // portrait
            else dalleSize = '1024x1024';                             // square
          }

          const resp = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: 'dall-e-3', prompt, n: 1,
              size: dalleSize, quality: quality || 'hd', style: style || 'vivid',
            }),
          });
          if (!resp.ok) { const t = await resp.text(); return { success: false, error: `DALL-E error ${resp.status}: ${t}` }; }
          const data = await resp.json();
          const img = data.data?.[0];
          const [w, h] = dalleSize.split('x').map(Number);
          return { success: true, result: JSON.stringify({ url: img?.url, revised_prompt: img?.revised_prompt, provider: 'dall-e-3', width: w, height: h }) };
        }

        // FLUX.2 [max] (BFL)
        case 'flux2-max': {
          const bflKey = process.env.BFL_API_KEY;
          if (!bflKey) return { success: false, error: 'BFL_API_KEY not configured for FLUX.2' };

          try {
            const result = await bflGenerateImage(
              prompt,
              { width: width || 1024, height: height || 1024, reference_images: reference_images || [] },
              userId,
              cfR2
            );
            return { success: true, result: JSON.stringify({ url: result.url, width: result.width, height: result.height, provider: 'flux2-max' }) };
          } catch (bflErr) {
            // Fallback: call BFL API directly
            console.log('[Image Gen] bflGenerateImage failed, calling BFL API directly:', bflErr.message);
            const createResp = await fetch('https://api.bfl.ai/v1/flux-2-max', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-key': bflKey },
              body: JSON.stringify({ prompt, width: width || 1024, height: height || 1024 }),
            });
            if (!createResp.ok) { const t = await createResp.text(); return { success: false, error: `FLUX.2 error ${createResp.status}: ${t}` }; }
            const createData = await createResp.json();
            const pollingUrl = createData.polling_url || `https://api.bfl.ai/v1/get_result?id=${createData.id}`;
            for (let i = 0; i < 60; i++) {
              await new Promise(r => setTimeout(r, 2000));
              const pollResp = await fetch(pollingUrl, { headers: { 'x-key': bflKey } });
              if (!pollResp.ok) continue;
              const pollData = await pollResp.json();
              if (pollData.status === 'Ready' && pollData.result?.sample) {
                return { success: true, result: JSON.stringify({ url: pollData.result.sample, provider: 'flux2-max' }) };
              }
              if (pollData.status === 'Error') return { success: false, error: `FLUX.2 generation failed: ${pollData.error || 'unknown'}` };
            }
            return { success: false, error: 'FLUX.2 generation timed out' };
          }
        }

        // Imagen 4.0 / 4.0 Fast / 4.0 Ultra (Google — via Vertex AI for GCP credits)
        case 'imagen-4':
        case 'imagen-4-fast':
        case 'imagen-4-ultra': {
          const modelMap = {
            'imagen-4': 'imagen-4.0-generate-001',
            'imagen-4-fast': 'imagen-4.0-fast-generate-001',
            'imagen-4-ultra': 'imagen-4.0-ultra-generate-001',
          };

          let vertexResult;
          try {
            // Primary: Vertex AI (uses GCP $300 credits)
            vertexResult = await generateImageVertex({
              prompt,
              model: modelMap[selectedProvider],
              width: width || 1024,
              height: height || 1024,
            });
          } catch (vertexErr) {
            // Fallback: AI Studio (uses GEMINI_API_KEY)
            console.warn(`[Image Gen] Vertex AI failed, falling back to AI Studio: ${vertexErr.message}`);
            const geminiKey = process.env.GEMINI_API_KEY;
            if (!geminiKey) return { success: false, error: `Imagen generation failed: ${vertexErr.message}` };

            let aspectRatio = '1:1';
            if (width && height) {
              if (width > height * 1.3) aspectRatio = '16:9';
              else if (height > width * 1.3) aspectRatio = '9:16';
            }

            const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelMap[selectedProvider]}:predict?key=${geminiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { sampleCount: 1, aspectRatio },
              }),
            });

            if (!resp.ok) {
              const errText = await resp.text();
              return { success: false, error: `Imagen error ${resp.status}: ${errText}` };
            }

            const data = await resp.json();
            const prediction = data.predictions?.[0];
            if (!prediction?.bytesBase64Encoded) {
              return { success: false, error: 'Imagen returned no image data' };
            }
            vertexResult = { images: [{ base64: prediction.bytesBase64Encoded, mimeType: 'image/png' }] };
          }

          const imageData = vertexResult.images?.[0];
          if (!imageData?.base64) {
            return { success: false, error: 'Imagen returned no image data' };
          }

          // Store the image (R2 → local disk → data URI fallback)
          let resultUrl;
          const imagenFilename = `imagen_${Date.now()}.png`;
          const buffer = Buffer.from(imageData.base64, 'base64');
          try {
            if (cfR2 && cfR2.isConfigured) {
              await cfR2.uploadAsset('system', imagenFilename, buffer, 'image/png');
              resultUrl = `/api/assets/${imagenFilename}`;
            } else {
              const assetsDir = path.join(__dirname, 'data', 'assets', 'system');
              fsSync.mkdirSync(assetsDir, { recursive: true });
              fsSync.writeFileSync(path.join(assetsDir, imagenFilename), buffer);
              resultUrl = `/api/assets/${imagenFilename}`;
            }
          } catch {
            resultUrl = `data:image/png;base64,${imageData.base64}`;
          }

          return { success: true, result: JSON.stringify({ url: resultUrl, provider: selectedProvider }) };
        }

        default:
          return { success: false, error: `Unknown image provider: ${selectedProvider}. Use: flux2-max, dall-e-3, imagen-4, imagen-4-fast, imagen-4-ultra` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolEditImage(input, userId = 'system') {
    try {
      const { prompt, source_image_base64, source_image_url, source_image, provider, reference_images, width, height } = input;
      if (!prompt) return { success: false, error: 'Edit prompt is required' };

      const selectedProvider = provider || 'nano-banana';

      switch (selectedProvider) {

        // Nano Banana Pro (Gemini image editing)
        case 'nano-banana': {
          const geminiKey = process.env.GEMINI_API_KEY;
          if (!geminiKey) return { success: false, error: 'GEMINI_API_KEY not configured' };

          const parts = [];

          // Add source image
          if (source_image_base64) {
            let mimeType = 'image/png';
            if (source_image_base64.startsWith('/9j/')) mimeType = 'image/jpeg';
            else if (source_image_base64.startsWith('iVBOR')) mimeType = 'image/png';
            parts.push({ inlineData: { mimeType, data: source_image_base64 } });
          } else if (source_image_url || source_image) {
            let imgUrl = source_image_url || source_image;
            let imgBuffer, mimeType;

            // For /api/assets/ URLs, read directly from R2/disk instead of HTTP self-fetch
            const assetMatch = imgUrl.match(/^\/api\/assets\/(.+)$/);
            if (assetMatch) {
              const assetId = assetMatch[1];
              // Try local disk first
              const localPath = path.join(__dirname, 'data', 'assets', 'system', assetId);
              if (fsSync.existsSync(localPath)) {
                imgBuffer = fsSync.readFileSync(localPath);
              } else if (cfR2 && cfR2.isConfigured) {
                const r2Result = await cfR2.getAsset('system', assetId) || await cfR2.getAsset(userId, assetId);
                if (r2Result) imgBuffer = r2Result.buffer;
              }
              if (!imgBuffer) return { success: false, error: `Source image not found: ${assetId}` };
              const ext = path.extname(assetId).toLowerCase();
              mimeType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/png';
            } else {
              // External URL — fetch normally
              if (imgUrl.startsWith('/')) imgUrl = `http://localhost:${PORT}${imgUrl}`;
              const imgResp = await fetch(imgUrl);
              if (!imgResp.ok) return { success: false, error: `Failed to fetch source image: ${imgResp.status}` };
              imgBuffer = Buffer.from(await imgResp.arrayBuffer());
              mimeType = imgResp.headers.get('content-type') || 'image/png';
            }

            parts.push({ inlineData: { mimeType, data: imgBuffer.toString('base64') } });
          } else {
            return { success: false, error: 'No source image. Provide source_image_base64 or source_image_url.' };
          }

          parts.push({ text: prompt });

          const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            }),
          });

          if (!resp.ok) {
            const errText = await resp.text();
            return { success: false, error: `Nano Banana error ${resp.status}: ${errText}` };
          }

          const data = await resp.json();
          let editedImageBase64 = null;
          let textResponse = '';

          for (const candidate of (data.candidates || [])) {
            for (const part of (candidate.content?.parts || [])) {
              if (part.inlineData?.data) editedImageBase64 = part.inlineData.data;
              if (part.text) textResponse += part.text;
            }
          }

          if (!editedImageBase64) {
            return { success: false, error: `Nano Banana returned no image. Response: ${textResponse || 'empty'}` };
          }

          let resultUrl;
          const editFilename = `edited_${Date.now()}.png`;
          const editBuffer = Buffer.from(editedImageBase64, 'base64');
          try {
            if (cfR2 && cfR2.isConfigured) {
              await cfR2.uploadAsset('system', editFilename, editBuffer, 'image/png');
            } else {
              const editDir = path.join(__dirname, 'data', 'assets', 'system');
              fsSync.mkdirSync(editDir, { recursive: true });
              fsSync.writeFileSync(path.join(editDir, editFilename), editBuffer);
            }
            resultUrl = `/api/assets/${editFilename}`;
          } catch {
            resultUrl = `data:image/png;base64,${editedImageBase64}`;
          }

          return { success: true, result: JSON.stringify({ url: resultUrl, provider: 'nano-banana', description: textResponse }) };
        }

        // FLUX.2 [max] Edit
        case 'flux2-max': {
          const bflKey = process.env.BFL_API_KEY;
          if (!bflKey) return { success: false, error: 'BFL_API_KEY not configured' };
          const editUrl = source_image_url || source_image;
          if (!editUrl) {
            return { success: false, error: 'FLUX.2 edit requires source_image_url. Use Nano Banana Pro for base64 edits.' };
          }
          try {
            const result = await bflEditImage(prompt, editUrl, {
              reference_images: reference_images || [],
              width: width || 1024,
              height: height || 1024,
            }, userId, cfR2);
            return { success: true, result: JSON.stringify({ url: result.url, provider: 'flux2-max' }) };
          } catch (err) {
            return { success: false, error: `FLUX.2 edit error: ${err.message}` };
          }
        }

        default:
          return { success: false, error: `Unknown edit provider: ${selectedProvider}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolGenerateVideo(input) {
    try {
      const { prompt, provider, duration_seconds, aspect_ratio } = input;
      if (!prompt) return { success: false, error: 'Video prompt is required' };

      const modelMap = {
        'veo-3.1': 'veo-3.1-generate-preview',
        'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
      };
      const veoModel = modelMap[provider || 'veo-3.1-fast'];

      console.log(`[Video Gen] Model: ${veoModel} | Prompt: "${prompt.slice(0, 80)}..."`);

      // Submit video generation via Vertex AI
      const { operationName } = await generateVideoVertex({
        prompt,
        model: veoModel,
        aspectRatio: aspect_ratio || '16:9',
        durationSeconds: duration_seconds || 4,
        count: 1,
      });

      if (!operationName) return { success: false, error: 'Veo returned no operation name for polling' };

      console.log(`[Video Gen] Operation submitted: ${operationName}`);

      // Poll for completion (up to 5 minutes)
      const { rawResponse } = await pollVeoOperation(operationName, 300000, 3000);

      if (!rawResponse) {
        return { success: false, error: 'Veo completed but returned no response' };
      }

      // Try all known response formats to find video data
      // Format 1: response.videos[].gcsUri (with storageUri)
      // Format 2: response.videos[].encodedVideo (without storageUri)
      // Format 3: response.generateVideoResponse.generatedSamples[].video.bytesBase64Encoded
      // Format 4: response.predictions[].bytesBase64Encoded
      const responseVideos = rawResponse.videos
        || rawResponse.generateVideoResponse?.generatedSamples?.map(s => s.video)
        || rawResponse.generated_videos?.map(s => s.video)
        || rawResponse.predictions
        || [];

      if (responseVideos.length === 0) {
        // Dump the actual keys so we can see what Vertex AI returned
        return { success: false, error: `Veo response keys: ${JSON.stringify(Object.keys(rawResponse))}. Full: ${JSON.stringify(rawResponse).slice(0, 500)}` };
      }

      const video = responseVideos[0];

      // Try every possible field name for video data
      const base64Data = video.bytesBase64Encoded || video.encodedVideo || video.videoBytes || null;
      const gcsUri = video.gcsUri || video.uri || null;

      let videoBuffer;

      if (base64Data) {
        videoBuffer = Buffer.from(base64Data, 'base64');
      } else if (gcsUri) {
        // Download from GCS: gs://bucket/path → GCS JSON API
        const gcsMatch = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
        if (!gcsMatch) {
          return { success: false, error: `Invalid GCS URI: ${gcsUri}` };
        }
        const [, gcsBucket, gcsObject] = gcsMatch;
        const gcpToken = await getGCPAccessToken();
        const gcsResp = await fetch(
          `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodeURIComponent(gcsObject)}?alt=media`,
          { headers: { 'Authorization': `Bearer ${gcpToken}` } }
        );
        if (!gcsResp.ok) {
          return { success: false, error: `GCS download failed: ${gcsResp.status}` };
        }
        videoBuffer = Buffer.from(await gcsResp.arrayBuffer());
      } else {
        // Dump the actual video object keys so we can see what's there
        return { success: false, error: `Video object keys: ${JSON.stringify(Object.keys(video))}. Full: ${JSON.stringify(video).slice(0, 500)}` };
      }

      const videoFilename = `video_${Date.now()}.mp4`;
      let videoUrl;

      try {
        if (cfR2 && cfR2.isConfigured) {
          await cfR2.uploadAsset('system', videoFilename, videoBuffer, 'video/mp4');
        } else {
          const videoDir = path.join(__dirname, 'data', 'assets', 'system');
          fsSync.mkdirSync(videoDir, { recursive: true });
          fsSync.writeFileSync(path.join(videoDir, videoFilename), videoBuffer);
        }
        videoUrl = `/api/assets/${videoFilename}`;
      } catch {
        videoUrl = `data:video/mp4;base64,${videoBuffer.toString('base64')}`;
      }

      return { success: true, result: JSON.stringify({ url: videoUrl, provider: provider || 'veo-3.1-fast', duration: duration_seconds || 4 }) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async function toolSystemStatus() {
    try {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();
      const now = new Date();
      return {
        success: true,
        result: JSON.stringify({
          currentDateTime: now.toISOString(),
          localTime: now.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' }),
          timestamp: now.getTime(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
          memory: { heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB', heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB', rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB' },
          platform: process.platform, nodeVersion: process.version,
        }),
      };
    } catch (error) { return { success: false, error: error.message }; }
  }

  // ============================================================================
  // UNIFIED TOOL EXECUTOR — /api/tools/execute
  // ============================================================================

  app.post('/api/tools/execute', requireAuth, checkPlanLimits, async (req, res) => {
    try {
      const { toolName, toolInput, workspaceId } = req.body;
      if (!toolName) return res.status(400).json({ error: 'toolName required' });
      const userId = req.user.id;
      const workspacePath = getUserWorkspacePath(workspaceId || userId);
      try { await fs.mkdir(workspacePath, { recursive: true }); } catch {}
      const startTime = Date.now();
      let result;
      switch (toolName) {
        case 'file_read': result = await toolFileRead(toolInput, workspacePath); break;
        case 'file_write': result = await toolFileWrite(toolInput, workspacePath); break;
        case 'file_list': result = await toolFileList(toolInput, workspacePath); break;
        case 'scan_directory': result = await toolScanDirectory(toolInput, workspacePath); break;
        case 'code_search': result = await toolCodeSearch(toolInput, workspacePath); break;
        case 'edit_file': result = await toolEditFile(toolInput, workspacePath); break;
        case 'run_command': result = await toolRunCommand(toolInput, workspacePath); break;
        case 'execute_code': result = await toolExecuteCode(toolInput); break;
        case 'git': result = await toolGit(toolInput, workspacePath); break;
        case 'web_search': result = await toolWebSearch(toolInput); break;
        case 'web_fetch': result = await toolWebFetch(toolInput); break;
        case 'memory_store': result = await toolMemoryStore(toolInput, userId); break;
        case 'memory_recall': result = await toolMemoryRecall(toolInput, userId); break;
        case 'spawn_scan_agent': result = await runScanAgent(toolInput.task || toolInput.query || '', workspacePath, userId); break;
        case 'list_templates': result = await toolListTemplates(); break;
        case 'get_template': result = await toolGetTemplate(toolInput); break;
        case 'gpu_compute': result = await toolGpuCompute(toolInput); break;
        case 'webcam_capture': result = await toolWebcamCapture(toolInput); break;
        case 'blender_execute': result = await toolBlenderExecute(toolInput); break;
        case 'blender_render': result = await toolBlenderRender(toolInput); break;
        case 'generate_image': result = await toolGenerateImage(toolInput, userId); break;
        case 'edit_image': result = await toolEditImage(toolInput, userId); break;
        case 'generate_video': result = await toolGenerateVideo(toolInput); break;
        case 'system_status': result = await toolSystemStatus(toolInput); break;
        case 'embed_video': {
          const parsed = parseVideoUrl(toolInput.url);
          if (!parsed) { result = { success: false, error: `Could not parse video URL: ${toolInput.url}` }; }
          else { result = { success: true, message: `Video embedded: ${toolInput.title || toolInput.url}`, platform: parsed.platform, embed_url: parsed.embedUrl, video_embed: { url: toolInput.url, embed_url: parsed.embedUrl, platform: parsed.platform, title: toolInput.title || '', context: toolInput.context || '', thumbnail: parsed.thumbnail || '', timestamp: parsed.timestamp || 0 } }; }
          break;
        }
        default: result = { success: false, error: `Unknown tool: ${toolName}` };
      }
      const durationMs = Date.now() - startTime;
      try {
        db.prepare('INSERT INTO telemetry_tool_usage (id, user_id, session_id, conversation_id, tool_name, success, duration_ms, error_message, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), userId, '', req.body.conversationId || '', toolName, result.success ? 1 : 0, durationMs, result.error || null, Date.now());
      } catch {}
      res.json(result);
    } catch (error) {
      console.error('[ToolExecutor] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });



  // Attach shared functions to ctx for other modules
  ctx.callClaudeSync = callClaudeSync;
  ctx.toolGenerateImage = toolGenerateImage;
  ctx.toolEditImage = toolEditImage;
  ctx.getUserWorkspacePath = getUserWorkspacePath;
  ctx.executeToolServerSide = executeToolServerSide;
  ctx.CODING_TOOLS = CODING_TOOLS;
}
