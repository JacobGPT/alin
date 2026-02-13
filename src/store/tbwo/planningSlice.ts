/**
 * TBWO Planning Slice — Plan generation, approval, rejection
 */

import { nanoid } from 'nanoid';
import { productRegistry } from '../../alin-executive/productRegistry';
import {
  TBWOStatus,
  TBWOType,
  PodRole,
} from '../../types/tbwo';
import type { ExecutionPlan } from '../../types/tbwo';

export function createPlanningSlice(set: any, get: any) {
  return {
    generateExecutionPlan: async (tbwoId: string) => {
      const tbwo = get().tbwos.get(tbwoId);
      if (!tbwo) {
        console.warn('[TBWO] generateExecutionPlan: TBWO not found:', tbwoId);
        return;
      }

      console.log('[TBWO] generateExecutionPlan: starting for', tbwoId, 'type:', tbwo.type);

      // Mark as planning
      get().updateTBWO(tbwoId, { status: TBWOStatus.PLANNING });

      try {
        const totalTime = tbwo.timeBudget.total;

        // === Website Sprint: use domain-specific factory ===
        if (tbwo.type === TBWOType.WEBSITE_SPRINT) {
          console.log('[TBWO] Using website sprint factory for plan generation');
          const sitesProduct = productRegistry.get(TBWOType.WEBSITE_SPRINT);
          if (!sitesProduct?.podsFactory || !sitesProduct?.planFactory || !sitesProduct?.defaultConfig) {
            console.error('[TBWO] Website Sprint product not registered');
            return;
          }
          const sprintConfig = (tbwo.metadata?.websiteSprintConfig as Record<string, unknown>) || sitesProduct.defaultConfig;
          const brief = tbwo.metadata?.siteBrief as any | undefined;
          const pods = sitesProduct.podsFactory(tbwoId, brief, sprintConfig);
          const plan = sitesProduct.planFactory(tbwoId, sprintConfig, pods, tbwo.objective, brief);

          // Scale plan durations to match the TBWO's time budget
          const scaleFactor = totalTime / plan.estimatedDuration;
          plan.estimatedDuration = totalTime;
          for (const phase of plan.phases) {
            phase.estimatedDuration = Math.round(phase.estimatedDuration * scaleFactor);
            for (const task of phase.tasks) {
              task.estimatedDuration = Math.round(task.estimatedDuration * scaleFactor);
            }
          }

          get().updateTBWO(tbwoId, {
            plan,
            pods,
            status: TBWOStatus.AWAITING_APPROVAL,
          });

          console.log('[TBWO] generateExecutionPlan: website sprint plan created with', pods.size, 'pods and', plan.phases.length, 'phases');
          return;
        }

        // === Generic plan for other TBWO types ===
        const plan: ExecutionPlan = {
          id: nanoid(),
          tbwoId,
          summary: `Execution plan for ${tbwo.type}: ${tbwo.objective}`,
          estimatedDuration: totalTime,
          confidence: 0.85,
          phases: [
            {
              id: nanoid(),
              name: 'Analysis & Planning',
              description: 'Analyze requirements, plan approach, identify dependencies',
              order: 1,
              estimatedDuration: totalTime * 0.15,
              dependsOn: [],
              tasks: [
                { id: nanoid(), name: 'Analyze requirements', description: 'Break down objective into actionable tasks', status: 'pending', estimatedDuration: totalTime * 0.05 },
                { id: nanoid(), name: 'Plan approach', description: 'Determine tools, patterns, and architecture', status: 'pending', estimatedDuration: totalTime * 0.05 },
                { id: nanoid(), name: 'Identify dependencies', description: 'Map dependencies and potential risks', status: 'pending', estimatedDuration: totalTime * 0.05 },
              ],
              assignedPods: [PodRole.ORCHESTRATOR],
              status: 'pending',
              progress: 0,
            },
            {
              id: nanoid(),
              name: 'Core Implementation',
              description: 'Build the primary deliverables',
              order: 2,
              estimatedDuration: totalTime * 0.5,
              dependsOn: [],
              tasks: [
                { id: nanoid(), name: 'Implement core structure', description: 'Build the foundational structure and layout', status: 'pending', estimatedDuration: totalTime * 0.2 },
                { id: nanoid(), name: 'Add content and logic', description: 'Populate with content, business logic, and styling', status: 'pending', estimatedDuration: totalTime * 0.2 },
                { id: nanoid(), name: 'Polish and refine', description: 'Refine details, add finishing touches', status: 'pending', estimatedDuration: totalTime * 0.1 },
              ],
              assignedPods: [PodRole.FRONTEND, PodRole.DESIGN],
              status: 'pending',
              progress: 0,
            },
            {
              id: nanoid(),
              name: 'Quality Assurance',
              description: 'Test, validate, and ensure quality standards',
              order: 3,
              estimatedDuration: totalTime * 0.2,
              dependsOn: [],
              tasks: [
                { id: nanoid(), name: 'Run quality checks', description: 'Validate output against requirements', status: 'pending', estimatedDuration: totalTime * 0.1 },
                { id: nanoid(), name: 'Fix issues', description: 'Address any issues found during QA', status: 'pending', estimatedDuration: totalTime * 0.1 },
              ],
              assignedPods: [PodRole.QA],
              status: 'pending',
              progress: 0,
            },
            {
              id: nanoid(),
              name: 'Delivery',
              description: 'Package output and generate receipts',
              order: 4,
              estimatedDuration: totalTime * 0.15,
              dependsOn: [],
              tasks: [
                { id: nanoid(), name: 'Package artifacts', description: 'Organize and package all generated files', status: 'pending', estimatedDuration: totalTime * 0.1 },
                { id: nanoid(), name: 'Generate receipt', description: 'Create execution receipt with summary', status: 'pending', estimatedDuration: totalTime * 0.05 },
              ],
              assignedPods: [PodRole.ORCHESTRATOR],
              status: 'pending',
              progress: 0,
            },
          ],
          podStrategy: {
            mode: 'parallel',
            maxConcurrent: 5,
            priorityOrder: [PodRole.ORCHESTRATOR, PodRole.DESIGN, PodRole.FRONTEND, PodRole.COPY, PodRole.QA],
            dependencies: new Map(),
          },
          risks: [
            { description: 'Time budget may be insufficient for requested quality', severity: 'medium', mitigation: 'Reduce scope or extend time budget' },
          ],
          assumptions: ['User has necessary permissions', 'APIs are available'],
          deliverables: [
            { name: 'Final Artifacts', description: 'All generated files and assets', type: 'artifact', required: true },
          ],
          requiresApproval: true,
        };

        console.log('[TBWO] generateExecutionPlan: plan created, updating store...');

        get().updateTBWO(tbwoId, {
          plan,
          status: TBWOStatus.AWAITING_APPROVAL,
        });

        console.log('[TBWO] generateExecutionPlan: done, status set to AWAITING_APPROVAL');
      } catch (error: any) {
        console.error('[TBWO] Plan generation failed:', error);
        try {
          get().updateTBWO(tbwoId, { status: TBWOStatus.DRAFT });
        } catch (e2) {
          console.error('[TBWO] Failed to reset status after error:', e2);
        }
      }
    },

    approvePlan: (tbwoId: string) => {
      const now = Date.now();

      set((state: any) => {
        const tbwo = state.tbwos.get(tbwoId);
        if (tbwo?.plan) {
          tbwo.plan.approvedAt = now;
          tbwo.plan.approvedBy = 'current-user'; // TODO: Get from auth
          state.lastUpdate = now;
        }
      });
    },

    rejectPlan: (tbwoId: string, feedback: string) => {
      get().updateTBWO(tbwoId, {
        status: TBWOStatus.DRAFT,
        plan: undefined,
      });

      // Store feedback for plan regeneration
      console.log('Plan rejected:', feedback);
    },
  };
}
