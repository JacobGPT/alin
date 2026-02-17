/**
 * Sandbox Pipeline — Server-side orchestrator for site generation lifecycle.
 *
 * Stages: init → plan → generate → validate → repair → package → deploy
 *
 * The workspace directory is source of truth. Every stage writes artifacts
 * back to the workspace and logs progress for the frontend to poll.
 */

import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

// ============================================================================
// TRUST PATTERNS (ported from client-side truthGuard.ts)
// ============================================================================

const TRUST_PATTERNS = {
  NUMERIC_CLAIM: [
    /\b\d[\d,]*\+?\s*(?:users?|customers?|clients?|companies|businesses|teams?|projects?|people)\b/gi,
    /\b\d[\d,]*\+?\s*(?:countries|cities|locations)\b/gi,
    /\$\d[\d,.]*[KkMmBb]?\b/g,
    /\b\d+(?:\.\d+)?%\b/g,
    /\b\d+[KkMmBb]\+?\b/g,
  ],
  TRUST_SIGNAL: [
    /\btrusted by\b/gi,
    /\bused by\b/gi,
    /\bcustomers worldwide\b/gi,
    /\baward[- ]winning\b/gi,
    /\b#1\b/gi,
    /\bmarket lead(?:er|ing)\b/gi,
    /\bindustry lead(?:er|ing)\b/gi,
    /\bbest[- ]in[- ]class\b/gi,
    /\bas seen (?:on|in)\b/gi,
    /\bfeatured (?:on|in|by)\b/gi,
  ],
  SECURITY_CLAIM: [
    /\bSOC\s*2\b/gi,
    /\bSOC\s*II\b/gi,
    /\bbank[- ]level\b/gi,
    /\benterprise[- ]grade\s*(?:security|encryption)\b/gi,
    /\b(?:military|bank)[- ]grade\b/gi,
    /\b256[- ]?bit\s*(?:encryption|SSL|AES)\b/gi,
    /\b99\.9+%\s*(?:uptime|availability|SLA)\b/gi,
    /\bGDPR\s*compliant\b/gi,
    /\bHIPAA\s*compliant\b/gi,
    /\bISO\s*27001\b/gi,
    /\bPCI[- ]DSS\b/gi,
    /\bend[- ]to[- ]end\s*encrypt(?:ed|ion)\b/gi,
  ],
  TESTIMONIAL: [
    /["\u201C\u201D].{20,200}["\u201C\u201D]\s*[-\u2014\u2013]\s*[A-Z][a-z]+/g,
  ],
  DOLLAR_CLAIM: [
    /\$[\d,]+(?:\.\d+)?(?:\s*(?:processed|saved|revenue|ARR|MRR|raised|in funding))/gi,
  ],
};

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/gi,
  /example\.com/gi,
  /\[PLACEHOLDER\]/gi,
  /\[TODO\]/gi,
  /\[INSERT\s/gi,
  /Acme\s*Corp/gi,
  /your-?(?:company|brand|name|email)/gi,
  /placeholder\s*(?:text|image|content)/gi,
];

const NEUTRAL_REPLACEMENTS = {
  NUMERIC_CLAIM: 'Join our growing community',
  TRUST_SIGNAL: 'Designed for your needs',
  SECURITY_CLAIM: '', // Remove entirely
  TESTIMONIAL: '', // Remove entirely
  DOLLAR_CLAIM: '', // Remove entirely
};

// ============================================================================
// HELPERS
// ============================================================================

async function walkDir(dirPath) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.html', '.htm', '.css', '.js', '.json', '.md', '.txt', '.svg'].includes(ext);
}

function scanContentForPattern(content, patterns) {
  const matches = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      matches.push({
        text: match[0],
        index: match.index,
        line: (content.slice(0, match.index).match(/\n/g) || []).length + 1,
      });
    }
  }
  return matches;
}

// ============================================================================
// SANDBOX PIPELINE CLASS
// ============================================================================

export class SandboxPipeline {
  constructor(tbwoId, userId, options = {}) {
    this.tbwoId = tbwoId;
    this.userId = userId;
    this.workspacePath = null;
    this.stage = 'pending';
    this.stageLog = [];
    this.artifacts = new Map();
    this.maxRepairAttempts = options.maxRepairAttempts || 2;
    this.brief = options.brief || null;
    this.expectedPages = options.expectedPages || [];
    this.approvedClaims = options.approvedClaims || [];
    this.error = null;
  }

  // --- Stage runners ---

  async init(workspacePath) {
    const start = Date.now();
    this.stage = 'init';
    this.workspacePath = workspacePath;

    try {
      // Write brief as first artifact
      if (this.brief) {
        const briefPath = path.join(workspacePath, 'brief.json');
        await fs.writeFile(briefPath, JSON.stringify(this.brief, null, 2));
        this.artifacts.set('brief.json', {
          type: 'sites/brief@v1',
          path: 'brief.json',
          size: (await fs.stat(briefPath)).size,
          hash: fileHash(JSON.stringify(this.brief)),
        });
      }

      this._logStage('init', 'completed', Date.now() - start, ['brief.json']);
    } catch (err) {
      this._logStage('init', 'failed', Date.now() - start, [], [err.message]);
      throw err;
    }
  }

  async validate() {
    const start = Date.now();
    this.stage = 'validate';

    try {
      if (!this.workspacePath) throw new Error('No workspace path set');

      const allFiles = await walkDir(this.workspacePath);
      const violations = [];
      const placeholders = [];
      let totalFiles = 0;

      for (const filePath of allFiles) {
        if (!isTextFile(filePath)) continue;
        totalFiles++;

        const content = await fs.readFile(filePath, 'utf-8');
        const relativePath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');

        // Skip artifact metadata files
        if (['brief.json', 'provenance.json', 'plan.json', 'fileTree.json',
             'preview-info.json', 'validation-report.json', 'repair-log.json'].includes(relativePath)) {
          continue;
        }

        // Trust pattern scan
        for (const [type, patterns] of Object.entries(TRUST_PATTERNS)) {
          const matches = scanContentForPattern(content, patterns);
          for (const match of matches) {
            // Cross-check against approved claims
            const isApproved = this.approvedClaims.some(
              claim => match.text.toLowerCase().includes(claim.toLowerCase()),
            );
            if (!isApproved) {
              violations.push({
                type,
                file: relativePath,
                line: match.line,
                text: match.text,
                critical: type !== 'TESTIMONIAL',
              });
            }
          }
        }

        // Placeholder scan
        const placeholderMatches = scanContentForPattern(content, PLACEHOLDER_PATTERNS);
        for (const match of placeholderMatches) {
          placeholders.push({
            file: relativePath,
            line: match.line,
            text: match.text,
          });
        }
      }

      // Completeness check
      const htmlFiles = allFiles
        .filter(f => f.endsWith('.html'))
        .map(f => path.relative(this.workspacePath, f).replace(/\\/g, '/'));

      const hasIndex = htmlFiles.some(f => f === 'index.html');
      const missingPages = this.expectedPages.filter(page => {
        const expected = page.toLowerCase() === 'home'
          ? 'index.html'
          : `${page.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html`;
        return !htmlFiles.some(f => f.toLowerCase() === expected);
      });

      const criticalViolations = violations.filter(v => v.critical);
      const canDeploy = criticalViolations.length === 0 && hasIndex && missingPages.length === 0 && placeholders.length === 0;

      // Quality score: 100 base, -10 per critical, -5 per non-critical, -15 per missing page, -5 per placeholder
      let score = 100;
      score -= criticalViolations.length * 10;
      score -= (violations.length - criticalViolations.length) * 5;
      score -= missingPages.length * 15;
      score -= placeholders.length * 5;
      score = Math.max(0, Math.min(100, score));

      const blockers = [];
      if (!hasIndex) blockers.push('Missing index.html');
      if (missingPages.length > 0) blockers.push(`Missing pages: ${missingPages.join(', ')}`);
      if (criticalViolations.length > 0) blockers.push(`${criticalViolations.length} trust violations`);
      if (placeholders.length > 0) blockers.push(`${placeholders.length} placeholder(s) found`);

      const result = {
        passed: canDeploy,
        score,
        violations,
        completeness: { hasIndex, missingPages, totalFiles, htmlFiles: htmlFiles.length },
        placeholders,
        canDeploy,
        blockers,
      };

      // Write validation report as artifact
      const reportPath = path.join(this.workspacePath, 'validation-report.json');
      await fs.writeFile(reportPath, JSON.stringify(result, null, 2));
      this.artifacts.set('validation-report.json', {
        type: 'sites/validation@v1',
        path: 'validation-report.json',
        size: (await fs.stat(reportPath)).size,
        hash: fileHash(JSON.stringify(result)),
      });

      this._logStage('validate', 'completed', Date.now() - start, ['validation-report.json']);
      return result;
    } catch (err) {
      this._logStage('validate', 'failed', Date.now() - start, [], [err.message]);
      throw err;
    }
  }

  async repair(validationResult) {
    const start = Date.now();
    this.stage = 'repair';
    let repaired = 0;
    const repairLog = [];

    try {
      for (const violation of validationResult.violations) {
        const replacement = NEUTRAL_REPLACEMENTS[violation.type];
        if (replacement === undefined) continue;

        const filePath = path.join(this.workspacePath, violation.file);
        let content;
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          continue;
        }

        // Attempt regex replacement
        const escaped = violation.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'g');

        if (regex.test(content)) {
          const newContent = content.replace(regex, replacement);
          await fs.writeFile(filePath, newContent);
          repaired++;
          repairLog.push({
            file: violation.file,
            type: violation.type,
            original: violation.text,
            replacement: replacement || '(removed)',
          });
        }
      }

      // Write repair log
      const logPath = path.join(this.workspacePath, 'repair-log.json');
      await fs.writeFile(logPath, JSON.stringify({ repaired, log: repairLog }, null, 2));
      this.artifacts.set('repair-log.json', {
        type: 'sites/repair-log@v1',
        path: 'repair-log.json',
        size: (await fs.stat(logPath)).size,
        hash: fileHash(JSON.stringify(repairLog)),
      });

      // Re-validate to get updated score
      const revalidation = await this.validate();

      this._logStage('repair', 'completed', Date.now() - start, ['repair-log.json']);
      return {
        repaired,
        remaining: revalidation.violations.length,
        score: revalidation.score,
        canDeploy: revalidation.canDeploy,
      };
    } catch (err) {
      this._logStage('repair', 'failed', Date.now() - start, [], [err.message]);
      throw err;
    }
  }

  async package() {
    const start = Date.now();
    this.stage = 'package';

    try {
      if (!this.workspacePath) throw new Error('No workspace path set');

      const allFiles = await walkDir(this.workspacePath);
      const manifest = [];
      let totalSize = 0;

      for (const filePath of allFiles) {
        const stat = await fs.stat(filePath);
        const relativePath = path.relative(this.workspacePath, filePath).replace(/\\/g, '/');

        // Skip pipeline metadata files from manifest
        if (relativePath.startsWith('validation-report') || relativePath.startsWith('repair-log')
            || relativePath === 'plan.json' || relativePath === 'provenance.json'
            || relativePath === 'fileTree.json' || relativePath === 'preview-info.json') {
          continue;
        }

        let hash = '';
        if (isTextFile(filePath)) {
          const content = await fs.readFile(filePath, 'utf-8');
          hash = fileHash(content);
        }

        manifest.push({
          type: 'file',
          name: path.basename(filePath),
          path: relativePath,
          size: stat.size,
          hash,
        });
        totalSize += stat.size;
      }

      // Detect routes (all .html files as paths)
      const routes = manifest
        .filter(f => f.path.endsWith('.html'))
        .map(f => '/' + f.path.replace(/index\.html$/, ''));

      const entryPoint = manifest.some(f => f.path === 'index.html') ? 'index.html' : null;

      // Write fileTree.json
      const manifestPath = path.join(this.workspacePath, 'fileTree.json');
      const manifestData = { manifest, totalFiles: manifest.length, totalSize };
      await fs.writeFile(manifestPath, JSON.stringify(manifestData, null, 2));
      this.artifacts.set('fileTree.json', {
        type: 'sites/manifest@v1',
        path: 'fileTree.json',
        size: (await fs.stat(manifestPath)).size,
        hash: fileHash(JSON.stringify(manifestData)),
      });

      // Write preview-info.json
      const previewInfo = { entryPoint, routes, totalFiles: manifest.length, totalSize };
      const previewPath = path.join(this.workspacePath, 'preview-info.json');
      await fs.writeFile(previewPath, JSON.stringify(previewInfo, null, 2));
      this.artifacts.set('preview-info.json', {
        type: 'sites/preview@v1',
        path: 'preview-info.json',
        size: (await fs.stat(previewPath)).size,
        hash: fileHash(JSON.stringify(previewInfo)),
      });

      this._logStage('package', 'completed', Date.now() - start, ['fileTree.json', 'preview-info.json'], [], {
        fileCount: manifest.length,
        totalSize,
      });

      return { manifest, routes, entryPoint, totalFiles: manifest.length, totalSize };
    } catch (err) {
      this._logStage('package', 'failed', Date.now() - start, [], [err.message]);
      throw err;
    }
  }

  // --- Lifecycle ---

  async run(throughStage = 'package') {
    const stages = ['init', 'validate', 'repair', 'package'];
    const targetIdx = stages.indexOf(throughStage);
    if (targetIdx < 0) throw new Error(`Unknown stage: ${throughStage}`);

    // Note: 'generate' stage is handled by the TBWO execution engine externally.
    // This pipeline runs post-generation: validate → repair → package.

    let validationResult = null;

    for (let i = 0; i <= targetIdx; i++) {
      const stageName = stages[i];

      if (stageName === 'init') {
        if (!this.workspacePath) throw new Error('Call init(workspacePath) before run()');
        // init already ran if workspacePath is set
        continue;
      }

      if (stageName === 'validate') {
        validationResult = await this.validate();
      } else if (stageName === 'repair') {
        if (validationResult && !validationResult.canDeploy) {
          let attempts = 0;
          while (attempts < this.maxRepairAttempts) {
            const repairResult = await this.repair(validationResult);
            attempts++;
            if (repairResult.canDeploy) break;
            // Re-validate after repair
            validationResult = await this.validate();
          }
        }
      } else if (stageName === 'package') {
        await this.package();
      }
    }

    this.stage = 'completed';
    return {
      completed: true,
      stage: this.stage,
      stageLog: this.stageLog,
      artifacts: Object.fromEntries(this.artifacts),
    };
  }

  getProgress() {
    const allStages = ['init', 'validate', 'repair', 'package'];
    const completedStages = this.stageLog.filter(l => l.status === 'completed').length;
    const progress = Math.round((completedStages / allStages.length) * 100);

    return {
      currentStage: this.stage,
      stagesCompleted: completedStages,
      totalStages: allStages.length,
      progress,
      stageLog: this.stageLog,
      artifacts: Object.fromEntries(this.artifacts),
      error: this.error,
    };
  }

  // --- Internal ---

  _logStage(stage, status, duration, artifacts = [], errors = [], extra = {}) {
    // Remove existing entry for this stage (repair/validate may run multiple times)
    this.stageLog = this.stageLog.filter(l => l.stage !== stage || l.status === 'completed');

    this.stageLog.push({
      stage,
      status,
      startedAt: Date.now() - duration,
      completedAt: status === 'running' ? undefined : Date.now(),
      duration,
      artifacts,
      errors,
      ...extra,
    });

    if (status === 'failed' && errors.length > 0) {
      this.error = errors[0];
    }
  }
}

// In-memory registry of active pipelines
const activePipelines = new Map();

export function getPipeline(tbwoId) {
  return activePipelines.get(tbwoId);
}

export function setPipeline(tbwoId, pipeline) {
  activePipelines.set(tbwoId, pipeline);
}

export function deletePipeline(tbwoId) {
  activePipelines.delete(tbwoId);
}
