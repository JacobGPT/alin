/**
 * File System Operations
 * /api/files/read, /api/files/write, /api/files/list — basic file ops
 * /api/files/scan — recursive directory scan with tree + contents
 * /api/files/search — text/regex code search across files
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import multer from 'multer';
import JSZip from 'jszip';

const SCAN_DEFAULTS = {
  maxDepth: 10,
  maxFileSize: 100 * 1024,      // 100 KB per file
  maxTotalSize: 2 * 1024 * 1024, // 2 MB total
  maxFiles: 200,
  defaultExclude: [
    'node_modules', '.git', 'dist', 'build', '__pycache__', '.env',
    '.next', 'coverage', '.cache', '.vscode', '.idea', 'vendor',
    '.DS_Store', 'Thumbs.db',
  ],
  binaryExtensions: new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.lock', '.map',
  ]),
};

export { SCAN_DEFAULTS };

export function registerFileRoutes(ctx) {
  const { app, requireAuth, sendError, scanLimiter, isPathAllowed } = ctx;

  /**
   * POST /api/files/read
   */
  app.post('/api/files/read', requireAuth, async (req, res) => {
    try {
      const { path: filePath } = req.body;
      if (!filePath) return res.status(400).json({ error: 'Path is required' });
      if (!isPathAllowed(filePath)) {
        return res.status(403).json({
          error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
        });
      }
      const content = await fs.readFile(filePath, 'utf-8');
      console.log(`[File] Read: ${filePath}`);
      res.json({ success: true, content, path: filePath });
    } catch (error) {
      console.error('[File] Read error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/files/write
   */
  app.post('/api/files/write', requireAuth, async (req, res) => {
    try {
      const { path: filePath, content } = req.body;
      if (!filePath || content === undefined) {
        return res.status(400).json({ error: 'Path and content are required' });
      }
      if (!isPathAllowed(filePath)) {
        return res.status(403).json({
          error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
        });
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
      console.log(`[File] Written: ${filePath} (${content.length} bytes)`);
      res.json({ success: true, path: filePath, bytesWritten: content.length });
    } catch (error) {
      console.error('[File] Write error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/files/list
   */
  app.post('/api/files/list', requireAuth, async (req, res) => {
    try {
      const { path: dirPath } = req.body;
      if (!dirPath) return res.status(400).json({ error: 'Path is required' });
      if (!isPathAllowed(dirPath)) {
        return res.status(403).json({
          error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
        });
      }
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files = entries.map(entry => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        path: path.join(dirPath, entry.name),
      }));
      console.log(`[File] Listed: ${dirPath} (${files.length} items)`);
      res.json({ success: true, path: dirPath, files });
    } catch (error) {
      console.error('[File] List error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/files/scan — Recursively scan a directory
   */
  app.post('/api/files/scan', requireAuth, scanLimiter, async (req, res) => {
    try {
      const {
        path: scanPath,
        recursive = true,
        maxDepth = SCAN_DEFAULTS.maxDepth,
        includeContents = true,
        filePatterns = [],
        excludePatterns = [],
      } = req.body;

      if (!scanPath) return res.status(400).json({ error: 'Path is required' });
      if (!isPathAllowed(scanPath)) {
        return res.status(403).json({
          error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
        });
      }

      const resolvedRoot = path.resolve(scanPath);
      const excludeSet = new Set([...SCAN_DEFAULTS.defaultExclude, ...excludePatterns]);
      const files = [];
      let totalSize = 0;
      const treeLines = [];
      const languageStats = {};

      function matchesPattern(filename, patterns) {
        if (!patterns || patterns.length === 0) return true;
        return patterns.some((pat) => {
          const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
          return re.test(filename);
        });
      }

      async function walk(dir, depth, prefix) {
        if (depth > maxDepth) return;
        if (files.length >= SCAN_DEFAULTS.maxFiles) return;
        if (totalSize >= SCAN_DEFAULTS.maxTotalSize) return;

        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        entries.sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1;
          if (!a.isDirectory() && b.isDirectory()) return 1;
          return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < entries.length; i++) {
          if (files.length >= SCAN_DEFAULTS.maxFiles) break;
          if (totalSize >= SCAN_DEFAULTS.maxTotalSize) break;

          const entry = entries[i];
          const isLast = i === entries.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const childPrefix = prefix + (isLast ? '    ' : '│   ');

          if (excludeSet.has(entry.name)) continue;

          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            treeLines.push(`${prefix}${connector}${entry.name}/`);
            if (recursive) {
              await walk(fullPath, depth + 1, childPrefix);
            }
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
            if (filePatterns.length > 0 && !matchesPattern(entry.name, filePatterns)) continue;

            treeLines.push(`${prefix}${connector}${entry.name}`);

            const lang = ext.replace('.', '') || 'unknown';
            languageStats[lang] = (languageStats[lang] || 0) + 1;

            if (includeContents) {
              try {
                const stat = await fs.stat(fullPath);
                if (stat.size <= SCAN_DEFAULTS.maxFileSize && totalSize + stat.size <= SCAN_DEFAULTS.maxTotalSize) {
                  const content = await fs.readFile(fullPath, 'utf-8');
                  const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
                  files.push({ path: relativePath, size: stat.size, content });
                  totalSize += stat.size;
                } else {
                  const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
                  files.push({ path: relativePath, size: stat.size, content: '[file too large or total limit reached]' });
                }
              } catch {
                // Can't read file, skip
              }
            }
          }
        }
      }

      const rootName = path.basename(resolvedRoot);
      treeLines.push(`${rootName}/`);
      await walk(resolvedRoot, 0, '');

      console.log(`[Scan] Scanned: ${scanPath} (${files.length} files, ${Math.round(totalSize / 1024)}KB)`);

      res.json({
        success: true,
        tree: treeLines.join('\n'),
        files,
        summary: {
          totalFiles: files.length,
          totalSize,
          languages: languageStats,
          truncated: files.length >= SCAN_DEFAULTS.maxFiles || totalSize >= SCAN_DEFAULTS.maxTotalSize,
        },
      });
    } catch (error) {
      console.error('[Scan] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/files/extract-zip — Extract and return contents of a ZIP file
   */
  const zipUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.post('/api/files/extract-zip', requireAuth, zipUpload.single('file'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const MAX_PER_FILE = 500 * 1024;   // 500KB per file
      const MAX_TOTAL = 10 * 1024 * 1024; // 10MB total extracted text

      const buffer = await fs.readFile(tmpPath);
      const zip = await JSZip.loadAsync(buffer);

      const TEXT_EXTS = new Set([
        'txt', 'md', 'py', 'js', 'ts', 'jsx', 'tsx', 'json', 'csv', 'html', 'css',
        'xml', 'yaml', 'yml', 'toml', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb',
        'php', 'sh', 'bat', 'sql', 'r', 'swift', 'kt', 'scala', 'lua', 'zig',
        'env', 'cfg', 'ini', 'conf', 'log', 'gitignore', 'dockerfile', 'svg',
      ]);

      const files = [];
      let totalExtracted = 0;

      for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        // Skip macOS resource forks and hidden entries
        if (zipPath.startsWith('__MACOSX/') || zipPath.includes('/.')) continue;

        const name = path.basename(zipPath);
        const ext = name.split('.').pop()?.toLowerCase() || '';
        const isText = TEXT_EXTS.has(ext);
        const size = zipEntry._data?.uncompressedSize || 0;

        const fileInfo = { name, path: zipPath, size, isText, content: null };

        if (isText && totalExtracted < MAX_TOTAL) {
          try {
            let content = await zipEntry.async('string');
            if (content.length > MAX_PER_FILE) {
              content = content.slice(0, MAX_PER_FILE) + `\n... (truncated, ${content.length - MAX_PER_FILE} more chars)`;
            }
            fileInfo.content = content;
            totalExtracted += content.length;
          } catch {
            // Binary disguised as text, skip content
          }
        }

        files.push(fileInfo);
      }

      console.log(`[ZIP] Extracted ${req.file.originalname}: ${files.length} files, ${Math.round(totalExtracted / 1024)}KB text`);
      res.json({ success: true, files });
    } catch (error) {
      console.error('[ZIP] Extract error:', error.message);
      sendError(res, 500, error.message);
    } finally {
      // Clean up temp file
      if (tmpPath) {
        fs.unlink(tmpPath).catch(() => {});
      }
    }
  });

  // ── Attachment storage for large file references ──
  const ATTACHMENTS_DIR = path.join(process.cwd(), 'data', 'attachments');
  const attachmentUpload = multer({ dest: os.tmpdir(), limits: { fileSize: 256 * 1024 * 1024 } });

  const TEXT_EXTS_ATTACH = new Set([
    'txt', 'md', 'py', 'js', 'ts', 'jsx', 'tsx', 'json', 'csv', 'html', 'css',
    'xml', 'yaml', 'yml', 'toml', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb',
    'php', 'sh', 'bat', 'sql', 'r', 'swift', 'kt', 'scala', 'lua', 'zig',
    'env', 'cfg', 'ini', 'conf', 'log', 'gitignore', 'dockerfile', 'svg',
  ]);

  /**
   * POST /api/files/upload-attachment — Store file for on-demand reading
   * Returns { fileId, filename, size, mimeType, preview, isZip, zipFiles? }
   */
  app.post('/api/files/upload-attachment', requireAuth, attachmentUpload.single('file'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const fileId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const destDir = path.join(ATTACHMENTS_DIR, fileId);
      await fs.mkdir(destDir, { recursive: true });

      const filename = req.file.originalname;
      const destPath = path.join(destDir, filename);
      await fs.rename(tmpPath, destPath);

      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const isZip = ext === 'zip';
      const size = req.file.size;
      const mimeType = req.file.mimetype || 'application/octet-stream';
      let preview = '';
      let zipFiles = undefined;

      if (isZip) {
        // Extract file listing (names + sizes) without full content
        try {
          const buffer = await fs.readFile(destPath);
          const zip = await JSZip.loadAsync(buffer);
          zipFiles = [];
          for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
            if (zipEntry.dir) continue;
            if (zipPath.startsWith('__MACOSX/') || zipPath.includes('/.')) continue;
            zipFiles.push({
              name: path.basename(zipPath),
              path: zipPath,
              size: zipEntry._data?.uncompressedSize || 0,
            });
          }
          preview = `ZIP archive with ${zipFiles.length} files:\n` +
            zipFiles.slice(0, 50).map(f => `  ${f.path} (${f.size} bytes)`).join('\n') +
            (zipFiles.length > 50 ? `\n  ... and ${zipFiles.length - 50} more files` : '');
        } catch (e) {
          preview = `ZIP archive (could not read listing: ${e.message})`;
        }
      } else if (TEXT_EXTS_ATTACH.has(ext)) {
        // Generate text preview (first 4KB)
        try {
          const content = await fs.readFile(destPath, 'utf-8');
          preview = content.slice(0, 4096);
          if (content.length > 4096) preview += `\n... (${content.length} total chars)`;
        } catch {
          preview = '(could not read preview)';
        }
      }

      console.log(`[Attachment] Stored ${filename} (${(size / 1024).toFixed(1)}KB) as ${fileId}`);
      res.json({ fileId, filename, size, mimeType, preview, isZip, zipFiles });
    } catch (error) {
      console.error('[Attachment] Upload error:', error.message);
      sendError(res, 500, error.message);
    } finally {
      // Clean up tmp file if rename failed
      if (tmpPath) fs.unlink(tmpPath).catch(() => {});
    }
  });

  /**
   * POST /api/files/read-attachment — Read content from a stored attachment
   * Input: { fileId, path?, offset?, limit? }
   * For ZIPs: path specifies a file inside the archive
   */
  app.post('/api/files/read-attachment', requireAuth, async (req, res) => {
    try {
      const { fileId, path: innerPath, offset = 0, limit = 16384 } = req.body;
      if (!fileId) return res.status(400).json({ error: 'fileId is required' });

      const cappedLimit = Math.min(limit, 65536);
      const attachDir = path.join(ATTACHMENTS_DIR, fileId);

      // Check attachment exists
      try {
        await fs.access(attachDir);
      } catch {
        return res.status(404).json({ error: 'Attachment not found or expired' });
      }

      // Find the stored file
      const entries = await fs.readdir(attachDir);
      if (entries.length === 0) return res.status(404).json({ error: 'Attachment file missing' });
      const storedFile = entries[0];
      const filePath = path.join(attachDir, storedFile);
      const ext = storedFile.split('.').pop()?.toLowerCase() || '';

      if (ext === 'zip' && innerPath) {
        // Read specific file from ZIP
        const buffer = await fs.readFile(filePath);
        const zip = await JSZip.loadAsync(buffer);
        let entry = zip.file(innerPath);
        // Fallback: try matching by filename if full path doesn't match
        if (!entry) {
          const basename = innerPath.split('/').pop();
          const allFiles = Object.keys(zip.files).filter(p => !zip.files[p].dir);
          const match = allFiles.find(p => p.endsWith('/' + basename) || p === basename);
          if (match) entry = zip.file(match);
          if (!entry) return res.status(404).json({ error: `File not found in ZIP: ${innerPath}`, availableFiles: allFiles.slice(0, 50) });
        }
        const content = await entry.async('string');
        const sliced = content.slice(offset, offset + cappedLimit);
        res.json({
          success: true,
          content: sliced,
          totalSize: content.length,
          truncated: content.length > offset + cappedLimit,
        });
      } else {
        // Read regular file
        const stat = await fs.stat(filePath);
        const fd = await fs.open(filePath, 'r');
        const buf = Buffer.alloc(cappedLimit);
        const { bytesRead } = await fd.read(buf, 0, cappedLimit, offset);
        await fd.close();
        const content = buf.slice(0, bytesRead).toString('utf-8');
        res.json({
          success: true,
          content,
          totalSize: stat.size,
          truncated: stat.size > offset + cappedLimit,
        });
      }
    } catch (error) {
      console.error('[Attachment] Read error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * GET /api/files/attachment-info/:fileId — Get attachment metadata + ZIP listing
   */
  app.get('/api/files/attachment-info/:fileId', requireAuth, async (req, res) => {
    try {
      const attachDir = path.join(ATTACHMENTS_DIR, req.params.fileId);
      try { await fs.access(attachDir); } catch {
        return res.status(404).json({ error: 'Attachment not found or expired' });
      }
      const entries = await fs.readdir(attachDir);
      if (entries.length === 0) return res.status(404).json({ error: 'Attachment file missing' });
      const storedFile = entries[0];
      const filePath = path.join(attachDir, storedFile);
      const stat = await fs.stat(filePath);
      const ext = storedFile.split('.').pop()?.toLowerCase() || '';
      const result = { fileId: req.params.fileId, filename: storedFile, size: stat.size, isZip: ext === 'zip' };
      if (ext === 'zip') {
        const buffer = await fs.readFile(filePath);
        const zip = await JSZip.loadAsync(buffer);
        result.zipFiles = [];
        for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir || zipPath.startsWith('__MACOSX/') || zipPath.includes('/.')) continue;
          result.zipFiles.push({ path: zipPath, name: path.basename(zipPath), size: zipEntry._data?.uncompressedSize || 0 });
        }
      }
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/files/search — Search for text/regex patterns across files
   */
  app.post('/api/files/search', requireAuth, async (req, res) => {
    try {
      const {
        query,
        path: searchPath,
        regex = false,
        caseSensitive = false,
        filePatterns = [],
        maxResults = 100,
      } = req.body;

      if (!query) return res.status(400).json({ error: 'Query is required' });
      if (!searchPath) return res.status(400).json({ error: 'Path is required' });
      if (!isPathAllowed(searchPath)) {
        return res.status(403).json({
          error: 'Access denied. File operations are restricted to Downloads, Documents, Desktop, and ALIN project folder.',
        });
      }

      const resolvedRoot = path.resolve(searchPath);
      const excludeSet = new Set(SCAN_DEFAULTS.defaultExclude);
      const matches = [];
      let filesSearched = 0;

      let searchRegex;
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        searchRegex = regex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      } catch (e) {
        return res.status(400).json({ error: `Invalid regex: ${e.message}` });
      }

      function matchesFilePattern(filename) {
        if (!filePatterns || filePatterns.length === 0) return true;
        return filePatterns.some((pat) => {
          const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i');
          return re.test(filename);
        });
      }

      async function searchDir(dir) {
        if (matches.length >= maxResults) return;

        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (matches.length >= maxResults) break;
          if (excludeSet.has(entry.name)) continue;
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            await searchDir(fullPath);
          } else {
            const ext = path.extname(entry.name).toLowerCase();
            if (SCAN_DEFAULTS.binaryExtensions.has(ext)) continue;
            if (!matchesFilePattern(entry.name)) continue;

            try {
              const stat = await fs.stat(fullPath);
              if (stat.size > SCAN_DEFAULTS.maxFileSize) continue;

              const content = await fs.readFile(fullPath, 'utf-8');
              filesSearched++;
              const lines = content.split('\n');

              for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                if (matches.length >= maxResults) break;
                const line = lines[lineNum];
                searchRegex.lastIndex = 0;
                let match;
                while ((match = searchRegex.exec(line)) !== null) {
                  if (matches.length >= maxResults) break;
                  const relativePath = path.relative(resolvedRoot, fullPath).replace(/\\/g, '/');
                  const contextBefore = lineNum > 0 ? lines[lineNum - 1] : '';
                  const contextAfter = lineNum < lines.length - 1 ? lines[lineNum + 1] : '';
                  matches.push({
                    file: relativePath,
                    line: lineNum + 1,
                    column: match.index + 1,
                    text: line.trim(),
                    context: [contextBefore, line, contextAfter].filter(Boolean).join('\n'),
                  });
                  if (!regex) break;
                }
              }
            } catch {
              // Can't read, skip
            }
          }
        }
      }

      await searchDir(resolvedRoot);

      console.log(`[Search] "${query}" in ${searchPath}: ${matches.length} matches in ${filesSearched} files`);

      res.json({
        success: true,
        matches,
        totalMatches: matches.length,
        filesSearched,
      });
    } catch (error) {
      console.error('[Search] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });
}
