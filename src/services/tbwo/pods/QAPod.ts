/**
 * QAPod - Quality assurance specialist for TBWO execution
 *
 * Responsible for testing, validation, and quality review of all deliverables.
 * Parses structured QA reports from AI responses, tracks quality scores,
 * and maintains a history of reports that the OrchestratorPod can use to
 * decide whether work meets the quality target.
 */

import { BasePod } from './BasePod';
import type { Task, Artifact } from '../../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../../types/tbwo';
import { nanoid } from 'nanoid';
import { QA_SYSTEM_PROMPT } from '../prompts/qa';

// ============================================================================
// QA-SPECIFIC TYPES
// ============================================================================

export interface QACheckResult {
  /** Name of the check performed. */
  name: string;
  /** Whether this check passed. */
  passed: boolean;
  /** Numeric score (0-100) for this check. */
  score: number;
  /** Detailed description of the result. */
  details: string;
  /** Severity level if the check failed or warned. */
  severity: 'info' | 'warning' | 'error' | 'critical';
}

export interface QAReport {
  /** Overall quality score (0-100). */
  overallScore: number;
  /** Whether the deliverable passes quality standards. */
  passed: boolean;
  /** Individual check results. */
  checks: QACheckResult[];
  /** Critical issues that must be fixed. */
  criticalIssues: string[];
  /** Warnings that should be addressed. */
  warnings: string[];
  /** Recommendations for improvement (nice-to-have). */
  recommendations: string[];
}

// ============================================================================
// QA POD
// ============================================================================

export class QAPod extends BasePod {
  /** Accumulated QA reports keyed by task name. */
  private reports: Map<string, QAReport> = new Map();

  /** Quality target level: 'draft', 'standard', 'premium', 'apple_level'. */
  private qualityTarget: string = 'standard';

  /** List of files that have been reviewed by this pod. */
  private reviewedFiles: Set<string> = new Set();

  // ==========================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ==========================================================================

  getSystemPrompt(): string {
    return QA_SYSTEM_PROMPT;
  }

  getSpecializedTools(): any[] {
    return [
      {
        name: 'file_read',
        description: 'Read files to review code quality, structure, and correctness',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read and review' },
          },
          required: ['path'],
        },
      },
      {
        name: 'execute_code',
        description: 'Run validation scripts, linters, or test code',
        input_schema: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              enum: ['javascript', 'typescript'],
              description: 'Programming language',
            },
            code: { type: 'string', description: 'Validation/test code to execute' },
          },
          required: ['language', 'code'],
        },
      },
      {
        name: 'file_list',
        description: 'Check file structure completeness and organization',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' },
          },
          required: ['path'],
        },
      },
      {
        name: 'code_search',
        description: 'Search for code patterns, potential issues, or anti-patterns',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search pattern (e.g. "TODO", "console.log", "innerHTML")' },
            path: { type: 'string', description: 'Optional path to scope the search' },
          },
          required: ['query'],
        },
      },
      {
        name: 'scan_directory',
        description: 'Scan the full project tree to verify structure and completeness',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Root path to scan' },
          },
          required: ['path'],
        },
      },
    ];
  }

  protected processTaskOutput(task: Task, response: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // ---- Parse structured QA report from the AI response ----
    const report = this.parseQAReport(response);
    if (report) {
      this.reports.set(task.name, report);
    }

    // ---- Create QA report artifact ----
    artifacts.push({
      id: nanoid(),
      tbwoId: this.tbwoId,
      name: `qa-report-${task.name}`,
      type: ArtifactTypeEnum.DOCUMENT,
      description: `QA report for: ${task.name}`,
      content: response,
      createdBy: this.id,
      createdAt: Date.now(),
      version: 1,
      status: report?.passed ? 'approved' : 'review',
      validationResults: report
        ? [
            {
              validator: 'QAPod',
              passed: report.passed,
              errors: report.criticalIssues,
              warnings: report.warnings,
              score: report.overallScore,
            },
          ]
        : undefined,
    });

    // ---- If there are critical issues, also create a focused issues artifact ----
    if (report && report.criticalIssues.length > 0) {
      const issueContent = [
        `# Critical Issues - ${task.name}`,
        '',
        `Quality Score: ${report.overallScore}/100`,
        `Status: ${report.passed ? 'PASS' : 'FAIL'}`,
        '',
        '## Issues',
        ...report.criticalIssues.map((issue, i) => `${i + 1}. ${issue}`),
        '',
        '## Warnings',
        ...report.warnings.map((warn, i) => `${i + 1}. ${warn}`),
        '',
        '## Recommendations',
        ...report.recommendations.map((rec, i) => `${i + 1}. ${rec}`),
      ].join('\n');

      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `qa-issues-${task.name}`,
        type: ArtifactTypeEnum.DOCUMENT,
        description: `Critical QA issues for: ${task.name}`,
        content: issueContent,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'review',
      });
    }

    return artifacts;
  }

  // ==========================================================================
  // QA-SPECIFIC: REPORT PARSING
  // ==========================================================================

  /**
   * Parse a structured QA report from the AI response text.
   * Extracts score, pass/fail status, individual checks, issues, warnings,
   * and recommendations using pattern matching.
   */
  private parseQAReport(response: string): QAReport | null {
    try {
      // ---- Parse overall score ----
      const scoreMatch = response.match(/(?:Overall\s+)?Score:\s*(\d+)\/100/i);
      const score = scoreMatch && scoreMatch[1] ? parseInt(scoreMatch[1], 10) : 70;

      // ---- Parse pass/fail status ----
      const statusMatch = response.match(/Status:\s*(PASS|FAIL|NEEDS_REVIEW)/i);
      const passed = statusMatch && statusMatch[1]
        ? statusMatch[1].toUpperCase() === 'PASS'
        : score >= 70;

      // ---- Parse individual checks ----
      const checks: QACheckResult[] = [];
      const checkMatches = response.matchAll(
        /\[(PASS|FAIL|WARN)\]\s+(.+?)(?:\s*-\s*(.+))?$/gm
      );
      for (const match of checkMatches) {
        if (!match[1] || !match[2]) continue;
        const status = match[1].toUpperCase();
        checks.push({
          name: match[2].trim(),
          passed: status === 'PASS',
          score: status === 'PASS' ? 100 : status === 'WARN' ? 60 : 0,
          details: match[3]?.trim() || '',
          severity:
            status === 'FAIL'
              ? 'error'
              : status === 'WARN'
              ? 'warning'
              : 'info',
        });
      }

      // ---- Parse critical issues section ----
      const criticalIssues: string[] = [];
      const criticalSection = response.match(
        /###\s*Critical\s*Issues\s*\n([\s\S]*?)(?=###|$)/i
      );
      if (criticalSection && criticalSection[1]) {
        const items = criticalSection[1].matchAll(/[-*]\s+(.+)/g);
        for (const item of items) {
          if (item[1]) criticalIssues.push(item[1].trim());
        }
      }

      // ---- Parse warnings section ----
      const warnings: string[] = [];
      const warningSection = response.match(
        /###\s*Warnings\s*\n([\s\S]*?)(?=###|$)/i
      );
      if (warningSection && warningSection[1]) {
        const items = warningSection[1].matchAll(/[-*]\s+(.+)/g);
        for (const item of items) {
          if (item[1]) warnings.push(item[1].trim());
        }
      }

      // ---- Parse recommendations section ----
      const recommendations: string[] = [];
      const recoSection = response.match(
        /###\s*Recommendations\s*\n([\s\S]*?)(?=###|$)/i
      );
      if (recoSection && recoSection[1]) {
        const items = recoSection[1].matchAll(/[-*]\s+(.+)/g);
        for (const item of items) {
          if (item[1]) recommendations.push(item[1].trim());
        }
      }

      return {
        overallScore: score,
        passed,
        checks,
        criticalIssues,
        warnings,
        recommendations,
      };
    } catch (error) {
      console.error('[QAPod] Failed to parse QA report:', error);
      return null;
    }
  }

  // ==========================================================================
  // QA-SPECIFIC: STATE MANAGEMENT
  // ==========================================================================

  /** Set the quality target level that determines review strictness. */
  setQualityTarget(target: string): void {
    this.qualityTarget = target;
  }

  /** Get the current quality target. */
  getQualityTarget(): string {
    return this.qualityTarget;
  }

  /** Get a QA report by task name. */
  getReport(taskName: string): QAReport | undefined {
    return this.reports.get(taskName);
  }

  /** Get all QA reports. */
  getAllReports(): Map<string, QAReport> {
    return new Map(this.reports);
  }

  /** Get the number of reports generated. */
  getReportCount(): number {
    return this.reports.size;
  }

  /**
   * Calculate the average quality score across all reports.
   * Returns 0 if no reports have been generated.
   */
  getOverallScore(): number {
    if (this.reports.size === 0) return 0;
    let total = 0;
    this.reports.forEach((r) => (total += r.overallScore));
    return Math.round(total / this.reports.size);
  }

  /**
   * Check if all reports pass the quality threshold.
   * Returns true if there are no reports (nothing to fail).
   */
  allReportsPassing(): boolean {
    for (const [, report] of this.reports) {
      if (!report.passed) return false;
    }
    return true;
  }

  /**
   * Get all critical issues across all reports.
   */
  getAllCriticalIssues(): Array<{ taskName: string; issues: string[] }> {
    const results: Array<{ taskName: string; issues: string[] }> = [];
    for (const [taskName, report] of this.reports) {
      if (report.criticalIssues.length > 0) {
        results.push({ taskName, issues: report.criticalIssues });
      }
    }
    return results;
  }

  /** Track that a file has been reviewed. */
  markFileReviewed(filePath: string): void {
    this.reviewedFiles.add(filePath);
  }

  /** Get the set of all reviewed file paths. */
  getReviewedFiles(): Set<string> {
    return new Set(this.reviewedFiles);
  }

  // ==========================================================================
  // CONTEXT BUILDING OVERRIDE
  // ==========================================================================

  /**
   * Override buildTaskPrompt to inject quality target and previous report
   * context so the AI calibrates its review accordingly.
   */
  protected override buildTaskPrompt(task: Task): string {
    let prompt = super.buildTaskPrompt(task);

    prompt += `\n\n### Quality Target: ${this.qualityTarget}`;

    // Include summary of previous reports for context
    if (this.reports.size > 0) {
      prompt += '\n\n### Previous QA Reports Summary';
      for (const [name, report] of this.reports) {
        const status = report.passed ? 'PASS' : 'FAIL';
        prompt += `\n- **${name}**: ${report.overallScore}/100 (${status})`;
        if (report.criticalIssues.length > 0) {
          prompt += ` - ${report.criticalIssues.length} critical issue(s)`;
        }
      }
      prompt += `\n\nOverall average: ${this.getOverallScore()}/100`;
    }

    return prompt;
  }
}
