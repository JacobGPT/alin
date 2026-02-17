/**
 * Receipt Generator - AI-generated executive summaries, technical analysis, and rollback maps
 */

import { nanoid } from 'nanoid';
import { streamFromServer } from '../api/serverStreamClient';
import { ContentTag } from '../types/tbwo';
import type { TBWO, TBWOReceipts, Artifact, RollbackInstruction } from '../types/tbwo';

interface PodMetricsInput {
  podId: string;
  role: string;
  tasksCompleted: number;
  tasksFailed: number;
  tokensUsed: number;
  executionTime: number;
  successRate: number;
  artifacts: string[];
  warnings: string[];
}

interface ExecutionContext {
  startTime: number;
  totalPauseDuration: number;
  sharedArtifacts: Map<string, Artifact>;
  podMetrics: Map<string, PodMetricsInput>;
  decisionTrail: Array<{
    id: string;
    timestamp: number;
    context: string;
    options: Array<{ label: string; rationale: string }>;
    chosen: number;
    confidence: number;
    outcome?: string;
  }>;
  qualityScore: number;
  qualityChecks: Array<{ name: string; passed: boolean; score: number; details: string }>;
}

class ReceiptGenerator {
  /**
   * Generate comprehensive receipts with AI-written summaries
   */
  async generateReceipts(tbwo: TBWO, context: ExecutionContext): Promise<TBWOReceipts> {
    const podReceipts = this.buildPodReceipts(tbwo, context);
    const technical = this.buildTechnicalReceipt(tbwo, context);
    const rollback = this.buildRollbackReceipt(context);

    let executive: TBWOReceipts['executive'];
    try {
      executive = await this.generateExecutiveSummary(tbwo, context, podReceipts);
    } catch {
      executive = this.buildFallbackExecutiveSummary(tbwo, context);
    }

    return {
      tbwoId: tbwo.id,
      executive,
      technical,
      podReceipts,
      rollback,
      pauseEvents: (tbwo.pauseRequests || [])
        .filter(pr => pr.status !== 'pending')
        .map(pr => ({
          pauseId: pr.id,
          reason: pr.reason,
          question: pr.question,
          userResponse: pr.userResponse,
          inferredValues: pr.inferredValues,
          contentTag: pr.contentTag || ContentTag.PLACEHOLDER,
          durationMs: pr.resolvedAt && pr.createdAt ? pr.resolvedAt - pr.createdAt : 0,
          timestamp: pr.createdAt,
        })),
      generatedAt: Date.now(),
    };
  }

  /**
   * AI-generated executive summary via server streaming proxy
   */
  private async generateExecutiveSummary(
    tbwo: TBWO,
    context: ExecutionContext,
    _podReceipts: Map<string, any>
  ): Promise<TBWOReceipts['executive']> {
    const totalTime = (Date.now() - context.startTime - context.totalPauseDuration) / 60000;
    const totalTokens = Array.from(context.podMetrics.values())
      .reduce((sum, pm) => sum + pm.tokensUsed, 0);
    const totalTasks = Array.from(context.podMetrics.values())
      .reduce((sum, pm) => sum + pm.tasksCompleted, 0);
    const totalFailed = Array.from(context.podMetrics.values())
      .reduce((sum, pm) => sum + pm.tasksFailed, 0);
    const artifactCount = context.sharedArtifacts.size;

    const prompt = `Generate a brief executive summary for a completed project execution.

## Project
- Objective: ${tbwo.objective}
- Type: ${tbwo.type}
- Quality Target: ${tbwo.qualityTarget}

## Results
- Total time: ${totalTime.toFixed(1)} minutes (budget: ${tbwo.timeBudget.total} min)
- Tasks completed: ${totalTasks}, failed: ${totalFailed}
- Artifacts produced: ${artifactCount}
- Total tokens used: ${totalTokens}
- Quality score: ${context.qualityScore}/100
- Pods used: ${context.podMetrics.size}

## Phases
${tbwo.plan?.phases.map(p => `- ${p.name}: ${p.status} (${p.progress}%)`).join('\n') || 'N/A'}

Write a JSON response:
{
  "summary": "2-3 sentence executive summary",
  "accomplishments": ["list of key accomplishments"],
  "unfinishedItems": ["items not completed, if any"],
  "qualityNotes": ["quality observations"]
}`;

    // Route through the same server streaming proxy as chat — no client API keys needed
    let responseText = '';
    const result = await streamFromServer({
      endpoint: '/api/chat/stream',
      body: {
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        system: 'Return only valid JSON. No markdown, no explanation.',
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1024,
      },
      callbacks: {
        onText: (text) => { responseText += text; },
      },
    });

    // Also collect from content blocks in case onText wasn't called
    if (!responseText && result.content.length > 0) {
      responseText = result.content
        .filter(b => b.type === 'text')
        .map(b => (b as any).text || '')
        .join('');
    }

    let data: any;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      data = JSON.parse(jsonMatch[0]);
    } else {
      return this.buildFallbackExecutiveSummary(tbwo, context);
    }

    // Count lines of code
    let linesOfCode = 0;
    const isCodeOrFile = (type: string) => ['file', 'code', 'FILE', 'CODE'].includes(type);
    context.sharedArtifacts.forEach(artifact => {
      if (isCodeOrFile(artifact.type) && typeof artifact.content === 'string') {
        linesOfCode += artifact.content.split('\n').length;
      }
    });

    return {
      summary: data.summary || `Completed ${tbwo.type}: ${tbwo.objective}`,
      accomplishments: data.accomplishments || [],
      filesCreated: Array.from(context.sharedArtifacts.values())
        .filter(a => isCodeOrFile(a.type)).length,
      filesModified: 0,
      linesOfCode,
      simplifications: [],
      unfinishedItems: data.unfinishedItems || [],
      qualityScore: context.qualityScore,
      qualityNotes: data.qualityNotes || [],
    };
  }

  /**
   * Fallback executive summary when AI call fails
   */
  private buildFallbackExecutiveSummary(
    tbwo: TBWO,
    context: ExecutionContext
  ): TBWOReceipts['executive'] {
    let linesOfCode = 0;
    context.sharedArtifacts.forEach(artifact => {
      if (typeof artifact.content === 'string') {
        linesOfCode += artifact.content.split('\n').length;
      }
    });

    return {
      summary: `Completed ${tbwo.type}: ${tbwo.objective}`,
      accomplishments: tbwo.plan?.phases
        .filter(p => p.status === 'complete')
        .map(p => `Completed phase: ${p.name}`) || [],
      filesCreated: Array.from(context.sharedArtifacts.values())
        .filter(a => ['file', 'code', 'FILE', 'CODE'].includes(a.type)).length,
      filesModified: 0,
      linesOfCode,
      simplifications: [],
      unfinishedItems: tbwo.plan?.phases
        .filter(p => p.status !== 'complete')
        .map(p => p.name) || [],
      qualityScore: context.qualityScore,
      qualityNotes: [`Quality target: ${tbwo.qualityTarget}`],
    };
  }

  /**
   * Build pod-level receipts
   */
  private buildPodReceipts(tbwo: TBWO, context: ExecutionContext): Map<string, any> {
    const podReceipts = new Map();

    context.podMetrics.forEach((metrics, podId) => {
      podReceipts.set(podId, {
        podId,
        role: metrics.role,
        tasksCompleted: metrics.tasksCompleted,
        tasksSkipped: 0,
        tasksFailed: metrics.tasksFailed,
        artifactsProduced: metrics.artifacts,
        timeUsed: metrics.executionTime / 1000 / 60,
        timeAllocated: tbwo.timeBudget.total / context.podMetrics.size,
        confidenceNotes: [`Success rate: ${(metrics.successRate * 100).toFixed(1)}%`],
        warnings: metrics.warnings,
      });
    });

    return podReceipts;
  }

  /**
   * Build technical receipt
   */
  private buildTechnicalReceipt(tbwo: TBWO, context: ExecutionContext): TBWOReceipts['technical'] {
    const totalTime = (Date.now() - context.startTime - context.totalPauseDuration) / 1000 / 60;
    const totalTokens = Array.from(context.podMetrics.values())
      .reduce((sum, pm) => sum + pm.tokensUsed, 0);

    const result: TBWOReceipts['technical'] = {
      buildStatus: context.qualityScore >= 70 ? 'success' as const : 'partial' as const,
      dependencies: [],
      performanceMetrics: {
        buildTime: totalTime,
        memoryUsage: totalTokens,
      },
    };

    // Include Truth Guard results if available (Website Sprint)
    const tgResult = tbwo.metadata?.truthGuardResult as Record<string, unknown> | undefined;
    if (tgResult) {
      result.truthGuard = {
        passed: tgResult.passed as boolean,
        violationCount: (tgResult.violationCount as number) || 0,
        criticalCount: (tgResult.criticalCount as number) || 0,
        summary: (tgResult.summary as string) || '',
        ranAt: (tgResult.ranAt as number) || Date.now(),
      };
    }

    return result;
  }

  /**
   * Build rollback receipt with per-file instructions
   */
  private buildRollbackReceipt(context: ExecutionContext): TBWOReceipts['rollback'] {
    const instructions: RollbackInstruction[] = [];
    let step = 1;

    context.sharedArtifacts.forEach(artifact => {
      if (artifact.path) {
        if (artifact.previousVersion) {
          instructions.push({ step: step++, action: 'revert', target: artifact.path, command: `git checkout ${artifact.previousVersion} -- ${artifact.path}` });
        } else {
          instructions.push({ step: step++, action: 'delete', target: artifact.path, command: `rm ${artifact.path}` });
        }
      }
    });

    if (instructions.length === 0) {
      instructions.push({ step: 1, action: 'none', target: 'No file changes to rollback' });
    }

    return {
      canRollback: instructions.length > 0,
      rollbackInstructions: instructions,
      limitations: [
        'External API calls cannot be undone',
        'Side effects from code execution may persist',
      ],
    };
  }
}

export const receiptGenerator = new ReceiptGenerator();
