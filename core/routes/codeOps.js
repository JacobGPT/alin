/**
 * Code Operation endpoints
 * /api/command/execute — shell command execution
 * /api/git/execute — git operations
 * /api/code/execute — sandboxed Python/JavaScript execution
 */
import path from 'path';
import fs from 'fs/promises';
import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';

export const DANGEROUS_COMMANDS = [
  'rm -rf /', 'rm -rf ~', 'rm -rf *', 'rm -rf .',
  'format c:', 'format d:', 'del /f /s /q c:',
  'shutdown', 'reboot', 'halt', 'poweroff',
  ':(){:|:&};:', ':(){ :|:& };:',  // fork bombs
  'mkfs', 'dd if=', 'wipefs',
  'chmod -R 777 /', 'chown -R',
  'reg delete', 'net user',
];

export const GIT_READ_OPS = ['status', 'diff', 'log', 'show', 'branch', 'tag', 'remote', 'blame', 'shortlog', 'stash list'];
export const GIT_WRITE_OPS = ['add', 'commit', 'checkout', 'stash', 'merge', 'pull', 'fetch', 'switch', 'restore'];
export const GIT_BLOCKED_PATTERNS = ['push --force', 'push -f', 'reset --hard', 'clean -f', 'clean -fd', 'branch -D', 'branch --delete --force'];

// Detect available Python command
let _pythonCmd = null;
export function getPythonCommand() {
  if (_pythonCmd) return _pythonCmd;
  for (const cmd of ['python3', 'python']) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 });
      _pythonCmd = cmd;
      console.log(`[Code] Using Python command: ${cmd}`);
      return cmd;
    } catch {}
  }
  _pythonCmd = 'python3';
  return _pythonCmd;
}

export function executeWithTimeout(command, args, timeout) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      timeout: timeout + 1000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      if (stdout.length < 1024 * 1024) stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      if (stderr.length < 256 * 1024) stderr += data.toString();
    });
    child.on('close', (exitCode) => {
      if (!settled) { settled = true; resolve({ stdout, stderr, exitCode }); }
    });
    child.on('error', (error) => {
      if (!settled) { settled = true; reject(error); }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGTERM'); } catch {}
        resolve({ stdout, stderr: stderr + `\n[Execution timed out after ${timeout}ms]`, exitCode: 124 });
      }
    }, timeout);
  });
}

export function registerCodeOpsRoutes(ctx) {
  const { app, requireAuth, sendError, executionLimiter, isPathAllowed, rootDir } = ctx;

  /**
   * POST /api/command/execute
   */
  app.post('/api/command/execute', requireAuth, executionLimiter, async (req, res) => {
    try {
      const { command, workingDirectory, timeout = 60000 } = req.body;
      if (!command) return res.status(400).json({ error: 'Command is required' });

      const cmdLower = command.toLowerCase().trim();
      for (const dangerous of DANGEROUS_COMMANDS) {
        if (cmdLower.includes(dangerous.toLowerCase())) {
          return res.status(400).json({ error: `Command blocked for safety: contains "${dangerous}"` });
        }
      }

      const cwd = workingDirectory ? path.resolve(workingDirectory) : rootDir;
      if (workingDirectory && !isPathAllowed(cwd)) {
        return res.status(403).json({ error: 'Access denied. Working directory must be within allowed directories.' });
      }

      console.log(`[Command] Executing: ${command} (cwd: ${cwd})`);

      const startTime = Date.now();
      const result = await new Promise((resolve, reject) => {
        const child = spawn(command, {
          shell: true,
          cwd,
          timeout: Math.min(timeout, 60000),
          env: { ...process.env, FORCE_COLOR: '0' },
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
          if (stdout.length > 500000) {
            child.kill('SIGTERM');
            reject(new Error('Output too large (>500KB)'));
          }
        });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (exitCode) => { resolve({ stdout, stderr, exitCode }); });
        child.on('error', (error) => { reject(error); });
      });

      const duration = Date.now() - startTime;
      console.log(`[Command] Completed in ${duration}ms, exit code: ${result.exitCode}`);

      const MAX_STDOUT = 500000;
      const MAX_STDERR = 50000;
      const stdoutTruncated = result.stdout.length > MAX_STDOUT;
      const stderrTruncated = result.stderr.length > MAX_STDERR;

      res.json({
        success: true,
        stdout: stdoutTruncated
          ? result.stdout.slice(0, MAX_STDOUT) + `\n\n[Output truncated. ${(result.stdout.length - MAX_STDOUT).toLocaleString()} bytes omitted.]`
          : result.stdout,
        stderr: stderrTruncated
          ? result.stderr.slice(0, MAX_STDERR) + `\n\n[Stderr truncated. ${(result.stderr.length - MAX_STDERR).toLocaleString()} bytes omitted.]`
          : result.stderr,
        exitCode: result.exitCode,
        duration,
        truncated: stdoutTruncated || stderrTruncated,
      });
    } catch (error) {
      console.error('[Command] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/git/execute
   */
  app.post('/api/git/execute', requireAuth, async (req, res) => {
    try {
      const { operation, args = [], repoPath } = req.body;
      if (!operation) return res.status(400).json({ error: 'Operation is required' });

      const cwd = repoPath ? path.resolve(repoPath) : rootDir;
      if (repoPath && !isPathAllowed(cwd)) {
        return res.status(403).json({ error: 'Access denied. Repository path must be within allowed directories.' });
      }

      const fullCmd = `${operation} ${Array.isArray(args) ? args.join(' ') : args}`.toLowerCase();
      for (const blocked of GIT_BLOCKED_PATTERNS) {
        if (fullCmd.includes(blocked)) {
          return res.status(400).json({ error: `Git operation blocked for safety: "${blocked}" is not allowed.` });
        }
      }

      const allOps = [...GIT_READ_OPS, ...GIT_WRITE_OPS];
      if (!allOps.includes(operation)) {
        return res.status(400).json({ error: `Unknown git operation: "${operation}". Allowed: ${allOps.join(', ')}` });
      }

      const gitArgs = [operation, ...(Array.isArray(args) ? args : [args])];
      console.log(`[Git] git ${gitArgs.join(' ')} (cwd: ${cwd})`);

      const result = await new Promise((resolve, reject) => {
        const child = spawn('git', gitArgs, {
          cwd,
          timeout: 30000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (exitCode) => { resolve({ stdout, stderr, exitCode }); });
        child.on('error', (error) => { reject(error); });
      });

      console.log(`[Git] exit code: ${result.exitCode}`);

      res.json({
        success: true,
        stdout: result.stdout.slice(0, 100000),
        stderr: result.stderr.slice(0, 20000),
        exitCode: result.exitCode,
      });
    } catch (error) {
      console.error('[Git] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  /**
   * POST /api/code/execute — Execute code in a sandboxed environment
   */
  app.post('/api/code/execute', requireAuth, executionLimiter, async (req, res) => {
    try {
      const { language, code, timeout = 30000 } = req.body;
      if (!code) return res.status(400).json({ error: 'Code is required' });
      if (!language) return res.status(400).json({ error: 'Language is required' });

      const dangerousPatterns = [
        'rm -rf /',
        'format c:',
        'del /f /s /q c:',
        'shutdown',
        '__import__("os").system',
        'subprocess.call',
        'subprocess.run',
        'subprocess.Popen',
        'require("child_process")',
        'process.exit',
        'process.kill',
        'os.remove(',
        'shutil.rmtree',
      ];

      const lowerCode = code.toLowerCase();
      for (const pattern of dangerousPatterns) {
        if (lowerCode.includes(pattern.toLowerCase())) {
          return res.status(400).json({ error: `Code blocked for safety: contains "${pattern}"`, success: false });
        }
      }

      let command, args, tempFile;
      const tempDir = tmpdir();

      switch (language.toLowerCase()) {
        case 'python':
        case 'py':
          tempFile = path.join(tempDir, `alin_code_${Date.now()}.py`);
          await fs.writeFile(tempFile, code);
          command = getPythonCommand();
          args = [tempFile];
          break;

        case 'javascript':
        case 'js':
        case 'node':
          tempFile = path.join(tempDir, `alin_code_${Date.now()}.js`);
          await fs.writeFile(tempFile, code);
          command = 'node';
          args = [tempFile];
          break;

        default:
          return res.status(400).json({ error: `Unsupported language: ${language}. Supported: python, javascript`, success: false });
      }

      console.log(`[Code] Executing ${language} code...`);

      const result = await executeWithTimeout(command, args, timeout);

      try { await fs.unlink(tempFile); } catch {}

      console.log(`[Code] Execution completed. Output length: ${result.stdout.length}`);

      res.json({
        success: true,
        language,
        stdout: result.stdout.slice(0, 50000),
        stderr: result.stderr.slice(0, 10000),
        exitCode: result.exitCode,
      });
    } catch (error) {
      console.error('[Code] Execution error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}
