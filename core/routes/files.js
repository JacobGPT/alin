/**
 * File System Operations
 * /api/files/read, /api/files/write, /api/files/list — basic file ops
 * /api/files/scan — recursive directory scan with tree + contents
 * /api/files/search — text/regex code search across files
 */
import fs from 'fs/promises';
import path from 'path';

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
