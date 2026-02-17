/**
 * Computer Use + Text Editor endpoints
 * /api/computer/action — screenshot, mouse, keyboard simulation
 * /api/editor/execute — view, create, str_replace, insert, undo_edit
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export function registerComputerUseRoutes(ctx) {
  const { app, requireAuth, editHistory, isPathAllowed } = ctx;

  const EDIT_HISTORY_MAX_FILES = 1000;

  function editHistorySet(filePath, content) {
    if (!editHistory.has(filePath)) editHistory.set(filePath, []);
    editHistory.get(filePath).push(content);
    if (editHistory.size > EDIT_HISTORY_MAX_FILES) {
      const oldestKey = editHistory.keys().next().value;
      editHistory.delete(oldestKey);
    }
  }

  /**
   * POST /api/computer/action
   */
  app.post('/api/computer/action', requireAuth, async (req, res) => {
    try {
      const { action, coordinate, text } = req.body;

      switch (action) {
        case 'screenshot': {
          try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);

            if (process.platform === 'win32') {
              const tempPath = path.join(os.tmpdir(), `alin-screenshot-${Date.now()}.png`);
              await execAsync(`powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object { $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height); $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size); $bitmap.Save('${tempPath.replace(/\\/g, '\\\\')}'); }"`);
              const imageData = await fs.readFile(tempPath, { encoding: 'base64' });
              await fs.unlink(tempPath).catch(() => {});
              return res.json({ success: true, image: imageData });
            }

            return res.json({ success: false, message: 'Screenshot not supported on this platform yet' });
          } catch (err) {
            return res.json({ success: false, message: `Screenshot failed: ${err.message}` });
          }
        }

        case 'mouse_move':
        case 'left_click':
        case 'right_click':
        case 'double_click':
        case 'scroll':
          return res.json({
            success: true,
            message: `Mouse action '${action}' at (${coordinate?.[0]}, ${coordinate?.[1]}) - simulated`,
          });

        case 'type':
          return res.json({
            success: true,
            message: `Typed text: "${text?.slice(0, 50)}${text?.length > 50 ? '...' : ''}" - simulated`,
          });

        case 'key':
          return res.json({
            success: true,
            message: `Key press: ${text} - simulated`,
          });

        default:
          return res.status(400).json({ success: false, message: `Unknown computer action: ${action}` });
      }
    } catch (error) {
      console.error('[Computer Use] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/editor/execute
   */
  app.post('/api/editor/execute', requireAuth, async (req, res) => {
    try {
      const { command, path: filePath, file_text, old_str, new_str, insert_line, view_range } = req.body;

      if (!filePath && command !== 'undo_edit') {
        return res.status(400).json({ success: false, error: 'Path is required' });
      }

      const resolvedPath = filePath ? path.resolve(filePath) : '';

      if (resolvedPath && !isPathAllowed(resolvedPath)) {
        return res.status(403).json({
          success: false,
          error: 'Access denied. Editor operations are restricted to allowed directories.',
          code: 'PATH_DENIED',
        });
      }

      switch (command) {
        case 'view': {
          try {
            const content = await fs.readFile(resolvedPath, 'utf-8');
            const lines = content.split('\n');

            if (view_range) {
              const [start, end] = view_range;
              const sliced = lines.slice(start - 1, end);
              const numbered = sliced.map((line, i) => `${start + i}\t${line}`).join('\n');
              return res.json({ success: true, content: numbered });
            }

            const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join('\n');
            return res.json({ success: true, content: numbered });
          } catch (err) {
            return res.json({ success: false, error: `Cannot read file: ${err.message}` });
          }
        }

        case 'create': {
          if (!file_text) {
            return res.status(400).json({ success: false, error: 'file_text is required for create' });
          }
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, file_text, 'utf-8');
          return res.json({ success: true, message: `Created ${filePath}` });
        }

        case 'str_replace': {
          if (!old_str) {
            return res.status(400).json({ success: false, error: 'old_str is required for str_replace' });
          }
          const content = await fs.readFile(resolvedPath, 'utf-8');
          editHistorySet(resolvedPath, content);

          const occurrences = content.split(old_str).length - 1;
          if (occurrences === 0) {
            return res.json({ success: false, error: 'old_str not found in file' });
          }
          if (occurrences > 1) {
            return res.json({ success: false, error: `old_str found ${occurrences} times - must be unique. Add more context.` });
          }

          const newContent = content.replace(old_str, new_str || '');
          await fs.writeFile(resolvedPath, newContent, 'utf-8');
          return res.json({ success: true, message: `Replaced in ${filePath}` });
        }

        case 'insert': {
          if (insert_line === undefined) {
            return res.status(400).json({ success: false, error: 'insert_line is required for insert' });
          }
          const content = await fs.readFile(resolvedPath, 'utf-8');
          editHistorySet(resolvedPath, content);

          const lines = content.split('\n');
          lines.splice(insert_line, 0, new_str || '');
          await fs.writeFile(resolvedPath, lines.join('\n'), 'utf-8');
          return res.json({ success: true, message: `Inserted at line ${insert_line} in ${filePath}` });
        }

        case 'undo_edit': {
          if (!editHistory.has(resolvedPath) || editHistory.get(resolvedPath).length === 0) {
            return res.json({ success: false, error: 'No edit history to undo' });
          }
          const previousContent = editHistory.get(resolvedPath).pop();
          await fs.writeFile(resolvedPath, previousContent, 'utf-8');
          return res.json({ success: true, message: `Undid last edit to ${filePath}` });
        }

        default:
          return res.status(400).json({ success: false, error: `Unknown editor command: ${command}` });
      }
    } catch (error) {
      console.error('[Text Editor] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}
