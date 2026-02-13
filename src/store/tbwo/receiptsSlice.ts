/**
 * TBWO Receipts Slice — Receipt generation (AI-powered + fallback)
 */

import { receiptGenerator } from '../../services/receiptGenerator';
import type { TBWOReceipts, Artifact } from '../../types/tbwo';

export function createReceiptsSlice(_set: any, get: any) {
  return {
    generateReceipts: async (tbwoId: string): Promise<TBWOReceipts> => {
      const tbwo = get().tbwos.get(tbwoId);
      if (!tbwo) throw new Error('TBWO not found');

      try {
        // Build execution context from the TBWO's pod data
        const podMetrics = new Map<string, {
          podId: string; role: string; tasksCompleted: number; tasksFailed: number;
          tokensUsed: number; executionTime: number; successRate: number;
          artifacts: string[]; warnings: string[];
        }>();

        tbwo.pods.forEach((pod: any) => {
          podMetrics.set(pod.id, {
            podId: pod.id,
            role: pod.role,
            tasksCompleted: pod.completedTasks.length,
            tasksFailed: 0,
            tokensUsed: pod.resourceUsage.tokensUsed,
            executionTime: pod.resourceUsage.executionTime,
            successRate: pod.completedTasks.length > 0 ? 1 : 0,
            artifacts: pod.outputs.map((o: any) => typeof o === 'string' ? o : String(o)),
            warnings: pod.health.warnings,
          });
        });

        const context = {
          startTime: tbwo.startedAt || tbwo.createdAt,
          totalPauseDuration: 0,
          sharedArtifacts: new Map<string, Artifact>(tbwo.artifacts.map((a: any) => [a.id, a])),
          podMetrics,
          decisionTrail: [],
          qualityScore: (() => {
            const completed = tbwo.plan?.phases.reduce((sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status === 'complete').length, 0) || 0;
            const total = tbwo.plan?.phases.reduce((sum: number, p: any) => sum + p.tasks.length, 0) || 1;
            return Math.round((completed / total) * 100);
          })(),
          qualityChecks: [],
        };

        const receipts = await receiptGenerator.generateReceipts(tbwo, context);
        get().updateTBWO(tbwoId, { receipts });
        return receipts;
      } catch (error: any) {
        console.error('[TBWO] Receipt generation failed, using fallback:', error);
        // Fallback: basic receipt without AI summary
        const now = Date.now();
        const receipts: TBWOReceipts = {
          tbwoId,
          executive: {
            summary: `Completed ${tbwo.type} in ${Math.round(tbwo.timeBudget.elapsed)} minutes`,
            accomplishments: tbwo.artifacts.map((a: any) => `Created: ${a.name}`).slice(0, 10),
            filesCreated: tbwo.artifacts.filter((a: any) => a.path).length,
            filesModified: 0,
            linesOfCode: tbwo.artifacts.reduce((sum: number, a: any) => sum + (typeof a.content === 'string' ? a.content.split('\n').length : 0), 0),
            simplifications: [],
            unfinishedItems: [],
            qualityScore: (() => {
              const completed = tbwo.plan?.phases.reduce((sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status === 'complete').length, 0) || 0;
              const total = tbwo.plan?.phases.reduce((sum: number, p: any) => sum + p.tasks.length, 0) || 1;
              return Math.round((completed / total) * 100);
            })(),
            qualityNotes: ['Execution completed'],
          },
          technical: {
            buildStatus: 'success',
            dependencies: [],
            performanceMetrics: {},
            ...(tbwo.metadata?.truthGuardResult ? {
              truthGuard: {
                passed: (tbwo.metadata.truthGuardResult as any).passed,
                violationCount: (tbwo.metadata.truthGuardResult as any).violationCount || 0,
                criticalCount: (tbwo.metadata.truthGuardResult as any).criticalCount || 0,
                summary: (tbwo.metadata.truthGuardResult as any).summary || '',
                ranAt: (tbwo.metadata.truthGuardResult as any).ranAt || Date.now(),
              },
            } : {}),
          },
          podReceipts: new Map(),
          rollback: {
            canRollback: true,
            rollbackInstructions: [],
            limitations: [],
          },
          pauseEvents: [],
          generatedAt: now,
        };

        tbwo.pods.forEach((pod: any) => {
          receipts.podReceipts.set(pod.id, {
            podId: pod.id,
            role: pod.role,
            tasksCompleted: pod.completedTasks.length,
            tasksSkipped: 0,
            tasksFailed: 0,
            artifactsProduced: [],
            timeUsed: pod.resourceUsage.executionTime,
            timeAllocated: 0,
            confidenceNotes: [],
            warnings: pod.health.warnings,
          });
        });

        get().updateTBWO(tbwoId, { receipts });
        return receipts;
      }
    },
  };
}
