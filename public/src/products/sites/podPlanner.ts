/**
 * Pod Planner — Heuristic pod allocation for Website Sprint TBWOs.
 *
 * Determines which pods to spawn based on the SiteBrief contents.
 * No LLM call — pure rule-based logic.
 */

import { nanoid } from 'nanoid';
import type { AgentPod, WebsiteSprintConfig } from '../../types/tbwo';
import { PodRole, PodStatus } from '../../types/tbwo';
import type { SiteBrief } from '../../api/dbService';

// ============================================================================
// TYPES
// ============================================================================

export interface PodSpec {
  role: PodRole;
  name: string;
  tools: string[];
  reason: string;
}

// ============================================================================
// POD PLANNING
// ============================================================================

const FRONTEND_TOOLS = [
  'file_write', 'file_read', 'execute_code', 'file_list',
  'edit_file', 'scan_directory', 'memory_store', 'memory_recall',
  'request_context_snippet', 'request_pause_and_ask',
];

const QA_TOOLS = [
  'file_read', 'execute_code', 'file_list', 'scan_directory',
  'edit_file', 'request_context_snippet', 'request_pause_and_ask',
];

const COPY_TOOLS = [
  'file_write', 'file_read', 'edit_file', 'file_list',
  'request_context_snippet', 'request_pause_and_ask',
];

const DEPLOY_TOOLS = [
  'file_write', 'file_read', 'file_list', 'scan_directory',
];

const ANIMATION_TOOLS = [
  'file_write', 'file_read', 'file_list', 'edit_file',
  'scan_directory', 'request_context_snippet',
];

const THREE_D_TOOLS = [
  'file_write', 'file_read', 'file_list', 'edit_file',
  'scan_directory', 'request_context_snippet', 'request_pause_and_ask',
];

/**
 * Determine which pods are needed based on brief contents.
 * Max 6 pods. Always includes FrontendBuilder + QA + Deploy.
 */
export function planPods(brief: SiteBrief, _config: WebsiteSprintConfig): PodSpec[] {
  const specs: PodSpec[] = [];

  // Always: FrontendBuilder
  specs.push({
    role: PodRole.FRONTEND,
    name: 'Frontend Pod',
    tools: FRONTEND_TOOLS,
    reason: 'Core page builder — always required',
  });

  // If pricing tiers exist OR >5 features → Copywriter
  const hasPricing = brief.pricing?.tiers?.length > 0;
  const manyFeatures = brief.features?.length > 5;
  if (hasPricing || manyFeatures) {
    specs.push({
      role: PodRole.COPY,
      name: 'Copy Pod',
      tools: COPY_TOOLS,
      reason: hasPricing
        ? 'Pricing tiers need dedicated copy review'
        : 'Many features need structured copywriting',
    });
  }

  // If >3 navPages → IA Planner
  const navPages = brief.navPages?.length || brief.pages?.length || 0;
  if (navPages > 3) {
    specs.push({
      role: PodRole.DESIGN,
      name: 'IA Pod',
      tools: ['file_write', 'file_read', 'file_list', 'request_pause_and_ask'],
      reason: `${navPages} pages need information architecture planning`,
    });
  }

  // If features include "blog" → SEO/Research pod
  const hasBlog = brief.features?.some(
    f => f.toLowerCase().includes('blog'),
  ) || brief.navPages?.some(
    p => p.toLowerCase().includes('blog'),
  );
  if (hasBlog) {
    specs.push({
      role: PodRole.RESEARCH,
      name: 'SEO Pod',
      tools: ['file_write', 'file_read', 'file_list', 'request_context_snippet'],
      reason: 'Blog content needs SEO outlines + starter post',
    });
  }

  // If pages include privacy/terms/legal → Legal copy pod
  const hasLegal = brief.navPages?.some(
    p => /privacy|terms|legal|cookie/i.test(p),
  ) || brief.pages?.some(
    p => /privacy|terms|legal|cookie/i.test(p),
  );
  if (hasLegal && !specs.some(s => s.role === PodRole.COPY)) {
    specs.push({
      role: PodRole.COPY,
      name: 'Legal Pod',
      tools: COPY_TOOLS,
      reason: 'Legal pages need specialized copy',
    });
  }

  // Always: Animation Pod — handles scroll animations, parallax, counters, choreographed sequences
  specs.push({
    role: PodRole.ANIMATION,
    name: 'Animation Pod',
    tools: ANIMATION_TOOLS,
    reason: 'Scroll animations, parallax, counters, choreographed entrance sequences',
  });

  // Always: 3D Scene Pod — handles Three.js hero scenes, particle systems, interactive 3D
  specs.push({
    role: PodRole.THREE_D,
    name: '3D Pod',
    tools: THREE_D_TOOLS,
    reason: 'Interactive 3D hero scenes, particle systems, WebGL effects',
  });

  // Always: QA
  specs.push({
    role: PodRole.QA,
    name: 'QA Pod',
    tools: QA_TOOLS,
    reason: 'Quality assurance + truth guard — always required',
  });

  // Always last: Deploy
  specs.push({
    role: PodRole.DEPLOYMENT,
    name: 'Delivery Pod',
    tools: DEPLOY_TOOLS,
    reason: 'Package + manifest generation — always required',
  });

  // Cap at 8 (Frontend, Copy, Design, Research, Animation, 3D, QA, Deploy)
  return specs.slice(0, 8);
}

/**
 * Convert PodSpec[] → Map<string, AgentPod> for the TBWO engine.
 */
export function specsToAgentPods(
  specs: PodSpec[],
  tbwoId: string,
): Map<string, AgentPod> {
  const pods = new Map<string, AgentPod>();

  for (const spec of specs) {
    const id = nanoid();
    const pod: AgentPod = {
      id,
      role: spec.role,
      name: spec.name,
      status: PodStatus.INITIALIZING,
      health: {
        status: 'healthy',
        lastHeartbeat: Date.now(),
        errorCount: 0,
        consecutiveFailures: 0,
        warnings: [],
      },
      modelConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.7,
        maxTokens: 4096,
      },
      toolWhitelist: spec.tools,
      memoryScope: [],
      taskQueue: [],
      completedTasks: [],
      outputs: [],
      resourceUsage: {
        cpuPercent: 0,
        memoryMB: 0,
        tokensUsed: 0,
        apiCalls: 0,
        executionTime: 0,
      },
      messageLog: [],
      createdAt: Date.now(),
      tbwoId,
    };
    pods.set(id, pod);
  }

  return pods;
}
