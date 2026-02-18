/**
 * sitePatchPlanner.js — Uses Claude to produce a structured patch plan
 * from a site workspace + user change request.
 *
 * Input: site storage directory path + change request text
 * Output: structured patch plan with file diffs (before/after)
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Scan a site workspace and return its file contents (text files only).
 * Caps at 50 files and 200KB total to fit Claude context.
 */
async function scanWorkspace(siteDir) {
  const files = {};
  let totalSize = 0;
  const MAX_FILES = 50;
  const MAX_TOTAL = 200_000;
  const TEXT_EXTS = new Set([
    '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.json',
    '.md', '.txt', '.svg', '.xml', '.yaml', '.yml', '.toml',
  ]);

  async function walk(dir, prefix = '') {
    if (Object.keys(files).length >= MAX_FILES || totalSize >= MAX_TOTAL) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (Object.keys(files).length >= MAX_FILES || totalSize >= MAX_TOTAL) break;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) continue;
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) continue;
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          if (totalSize + content.length > MAX_TOTAL) continue;
          files[relPath] = content;
          totalSize += content.length;
        } catch { /* skip unreadable */ }
      }
    }
  }

  await walk(siteDir);
  return files;
}

/**
 * Build the Claude prompt for patch planning.
 */
function buildPlannerPrompt(files, changeRequest) {
  const fileList = Object.entries(files)
    .map(([name, content]) => `--- FILE: ${name} ---\n${content}\n--- END FILE ---`)
    .join('\n\n');

  return `You are a site patch planner for ALIN. You analyze a static website's current files and a user's change request, then produce a structured JSON patch plan.

IMPORTANT RULES:
1. Only output valid JSON — no markdown, no code fences, no explanation text.
2. Each file change must include the full "before" content (current) and "after" content (proposed).
3. For new files, "before" should be null.
4. For deleted files, "after" should be null.
5. Include a human-readable "summary" describing the overall change.
6. Include a "changes" array with one entry per file affected.
7. Tag any content you inferred (not explicitly stated by user) with provenance "INFERRED".
8. Tag content the user explicitly requested with provenance "USER_PROVIDED".
9. If you need information the user didn't provide (like specific prices, phone numbers, etc.), use "PLACEHOLDER" text like "PLACEHOLDER: [your company phone number]" and tag provenance as "PLACEHOLDER".

OUTPUT FORMAT (strict JSON):
{
  "summary": "Brief description of the change",
  "changes": [
    {
      "file": "relative/path/to/file.html",
      "action": "modify" | "create" | "delete",
      "summary": "What changed in this file",
      "provenance": "USER_PROVIDED" | "INFERRED" | "PLACEHOLDER",
      "before": "full file content before (null for create)",
      "after": "full file content after (null for delete)"
    }
  ],
  "warnings": ["any warnings about the change"],
  "placeholders": ["list of PLACEHOLDER values that need user input before deploy"]
}

CURRENT SITE FILES:
${fileList}

USER'S CHANGE REQUEST:
${changeRequest}

Produce the JSON patch plan now.`;
}

/**
 * Call Claude to generate a patch plan.
 * @param {Function} callClaude - The callClaudeSync function from server.js
 * @param {string} siteDir - Path to the site's persistent storage
 * @param {string} changeRequest - User's change request text
 * @returns {Object} Parsed patch plan
 */
export async function generatePatchPlan(callClaude, siteDir, changeRequest) {
  // 1. Scan workspace files
  const files = await scanWorkspace(siteDir);
  if (Object.keys(files).length === 0) {
    throw new Error('No site files found in workspace');
  }

  // 2. Build prompt
  const prompt = buildPlannerPrompt(files, changeRequest);

  // 3. Call Claude
  const response = await callClaude({
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: prompt }],
    system: 'You are a precise site modification planner. Output ONLY valid JSON. No markdown fences, no explanation.',
    maxTokens: 16384,
  });

  // 4. Extract text content
  const textBlock = response.content?.find(b => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('No text response from Claude');
  }

  // 5. Parse JSON (strip any accidental markdown fences)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const plan = JSON.parse(jsonStr);
    // Validate structure
    if (!plan.summary || !Array.isArray(plan.changes)) {
      throw new Error('Invalid patch plan structure');
    }
    return plan;
  } catch (parseErr) {
    throw new Error(`Failed to parse patch plan JSON: ${parseErr.message}\nRaw: ${jsonStr.slice(0, 500)}`);
  }
}

/**
 * Apply a patch plan to the site workspace.
 * @param {string} siteDir - Path to the site's persistent storage
 * @param {Object} plan - The patch plan object
 * @returns {Object} Result with applied/failed counts
 */
export async function applyPatchPlan(siteDir, plan) {
  const results = { applied: 0, failed: 0, errors: [] };

  // Check for site/ subdirectory (ALIN Website Sprint layout)
  let baseDir = siteDir;
  try {
    await fs.access(path.join(siteDir, 'site'));
    baseDir = path.join(siteDir, 'site');
  } catch { /* use siteDir directly */ }

  for (const change of plan.changes) {
    try {
      const filePath = path.join(baseDir, change.file);
      // Prevent path traversal
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(baseDir))) {
        results.failed++;
        results.errors.push(`Path traversal blocked: ${change.file}`);
        continue;
      }

      if (change.action === 'delete') {
        await fs.unlink(filePath);
      } else if (change.action === 'create' || change.action === 'modify') {
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, change.after, 'utf-8');
      }
      results.applied++;
    } catch (err) {
      results.failed++;
      results.errors.push(`${change.file}: ${err.message}`);
    }
  }

  return results;
}
