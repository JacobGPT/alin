/**
 * TBWO Prompt Builder — Pure functions extracted from ExecutionEngine
 *
 * These functions build prompts, select artifacts, and define tool schemas
 * for TBWO pod execution. They read from Zustand stores but do not mutate
 * engine state, making them safe to call from any context.
 */

import type {
  TBWO,
  Phase,
  Task,
  AgentPod,
  Artifact,
} from '../../types/tbwo';
import {
  TBWOType,
  PodRole,
  QUALITY_DISPLAY_NAMES,
} from '../../types/tbwo';
import { useTBWOStore } from '../../store/tbwoStore';
import { useAuthStore } from '../../store/authStore';
import { getDomainPodPrompt } from './domainPrompts';
import { getExpectedFiles } from './templates/websiteSprint';
import { assertTokenBudget, compactBrief, estimateTokens } from '../../api/tokenBudget';
import type { BusMessage } from './messagebus';

// ============================================================================
// TYPES — minimal interface covering the ExecutionState fields these
// functions actually read.  The full ExecutionState lives in executionEngine.ts.
// ============================================================================

export interface PromptBuilderState {
  tbwoId: string;
  currentPhaseIndex: number;
  activePods: Map<string, { role: string; name: string }>;
  artifacts: Map<string, Artifact>;
  completedTaskIds: Set<string>;
  podInboxes: Map<string, BusMessage[]>;
  workspaceId: string | null;
  workspaceFiles: Array<{ relativePath: string; size: number; downloadUrl: string }>;
  filesWrittenInExecution: Map<string, string>;
  errors: Array<{ phase: string; task: string; error: string; timestamp: number }>;
}

// ============================================================================
// AUTH HELPER
// ============================================================================

/**
 * Build auth headers for backend fetch calls.
 * Mirrors ExecutionEngine.getAuthHeaders().
 */
export function getAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...useAuthStore.getState().getAuthHeader(),
  };
}

// ============================================================================
// buildPodSystemPrompt
// ============================================================================

/**
 * Build the system prompt for a pod, including domain-specific context
 * and the Pause-and-Ask protocol.
 */
export function buildPodSystemPrompt(pod: AgentPod): string {
  // Fetch the TBWO for full context
  const tbwo = useTBWOStore.getState().getTBWOById(pod.tbwoId);
  if (!tbwo) {
    // Fallback if TBWO not found (shouldn't happen in normal flow)
    return [
      `You are an agent with the role: ${pod.role}.`,
      `Pod ID: ${pod.id}`,
      `TBWO ID: ${pod.tbwoId}`,
      'Complete your assigned tasks efficiently.',
      pod.modelConfig.systemPrompt || '',
    ].filter(Boolean).join('\n');
  }

  const basePrompt = getDomainPodPrompt(pod, tbwo);

  // Append Pause-and-Ask protocol to all pod system prompts
  return basePrompt + `

## Pause-and-Ask Protocol
You can hard-pause execution to ask the user a question using the \`request_pause_and_ask\` tool.
Use this for critical unknowns that would make or break the output quality.
The user WANTS to be asked rather than receive wrong content.`;
}

// ============================================================================
// buildProjectReadme
// ============================================================================

/**
 * Build a README.md string summarizing the sprint project for pod reference.
 * Produces a comprehensive ~4000-6000 char structured reference document.
 */
export function buildProjectReadme(state: PromptBuilderState, tbwo: TBWO): string {
  const brief = tbwo.metadata?.siteBrief as Record<string, unknown> | undefined;
  const sprintConfig = tbwo.metadata?.sprintConfig as any;
  const colorScheme = sprintConfig?.colorScheme;
  const typography = sprintConfig?.typography;

  const expectedFiles = sprintConfig ? getExpectedFiles(sprintConfig) : [];

  const sections: string[] = [];

  // Header
  const projectName = (brief?.productName as string) || tbwo.objective.slice(0, 60);
  sections.push(`# ${projectName} — Website Sprint\n`);

  // 1. Project Overview
  const totalBudget = tbwo.timeBudget?.total ?? 60;
  sections.push(`## 1. Project Overview`);
  sections.push(`- Objective: ${tbwo.objective}`);
  if (brief?.tagline) sections.push(`- Tagline: ${brief.tagline}`);
  if (brief?.oneLinerPositioning) sections.push(`- Positioning: ${brief.oneLinerPositioning}`);
  if (brief?.businessType) sections.push(`- Business Type: ${brief.businessType}`);
  sections.push(`- Quality Target: ${QUALITY_DISPLAY_NAMES[tbwo.qualityTarget] || 'Standard'}`);
  sections.push(`- Time Budget: ${totalBudget} minutes`);
  sections.push('');

  // 2. Brand Identity
  if (brief) {
    sections.push(`## 2. Brand Identity`);
    if (brief.coreProblem) sections.push(`- Core Problem: ${brief.coreProblem}`);
    if (brief.targetAudience) sections.push(`- Target Audience: ${brief.targetAudience}`);
    if (brief.primaryPain) sections.push(`- Primary Pain: ${brief.primaryPain}`);
    if (brief.primaryCTA) sections.push(`- Primary CTA: ${brief.primaryCTA}`);
    const differentiators = brief.differentiators as string[] | undefined;
    if (differentiators?.length) sections.push(`- Differentiators: ${differentiators.join(', ')}`);
    const features = brief.features as string[] | undefined;
    if (features?.length) sections.push(`- Features: ${features.join(', ')}`);
    sections.push('');
  }

  // 3. Content Guidelines
  if (brief) {
    const tone = (brief.toneStyle as string) || (brief.tone as string) || '';
    sections.push(`## 3. Content Guidelines`);
    if (tone) sections.push(`- Tone & Style: ${tone}`);
    sections.push(`- Voice Rules:`);
    sections.push(`  - Write as ${projectName}, not "we" or generic brand`);
    sections.push(`  - No Lorem ipsum, no placeholder text in final output`);
    sections.push(`  - Headlines: benefit-driven, concise, active voice`);
    sections.push(`  - Body: scannable, short paragraphs`);
    sections.push(`  - CTAs: specific action ("Order Beans" not "Submit")`);
    sections.push('');
  }

  // 4. Contact Information
  if (brief) {
    const contactEmail = brief.contactEmail as string || '';
    const contactPhone = brief.contactPhone as string || '';
    const contactAddress = brief.contactAddress as string || '';
    const operatingHours = brief.operatingHours as string || '';
    const socialLinks = brief.socialLinks as Record<string, string> | undefined;

    if (contactEmail || contactPhone || contactAddress) {
      sections.push(`## 4. Contact Information (USE EXACTLY)`);
      if (contactEmail) sections.push(`- Email: ${contactEmail}`);
      if (contactPhone) sections.push(`- Phone: ${contactPhone}`);
      if (contactAddress) sections.push(`- Address: ${contactAddress}`);
      if (operatingHours) sections.push(`- Hours: ${operatingHours}`);
      if (socialLinks && Object.keys(socialLinks).length > 0) {
        sections.push(`- Social: ${Object.entries(socialLinks).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
      }
      sections.push(`CRITICAL: Use these EXACT contact details. Never substitute with example.com or (555) numbers.`);
      sections.push('');
    }
  }

  // 5. Design System
  if (colorScheme || typography) {
    sections.push(`## 5. Design System`);
    if (colorScheme) {
      sections.push(`### Colors`);
      for (const [role, hex] of Object.entries(colorScheme)) {
        sections.push(`- ${role}: ${hex}`);
      }
    }
    if (typography) {
      sections.push(`### Typography`);
      sections.push(`- Heading: ${typography.headingFont || 'System default'}`);
      sections.push(`- Body: ${typography.bodyFont || 'System default'}`);
      sections.push(`- Scale: ${typography.scale || 'medium'}`);
    }
    if (sprintConfig?.aesthetic) {
      sections.push(`### Aesthetic`);
      sections.push(`- ${sprintConfig.aesthetic}`);
    }
    sections.push('');
  }

  // 6. File Manifest
  sections.push(`## 6. File Manifest`);
  sections.push(`Every file this project must produce:\n`);
  for (const f of expectedFiles) {
    sections.push(`- [ ] ${f.path} — ${f.description}`);
  }
  sections.push('');

  // 7. Page Specifications
  const pages = sprintConfig?.pages || [];
  if (pages.length > 0) {
    sections.push(`## 7. Page Specifications\n`);
    for (const page of pages) {
      let filename = page.path;
      if (!filename) {
        const pageName = (page.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        filename = pageName === 'home' ? 'index.html' : `${pageName || 'page'}.html`;
      } else if (filename.startsWith('/')) {
        filename = filename.slice(1);
      }
      if (!filename.endsWith('.html')) filename += '.html';
      sections.push(`### ${page.name} (${filename})`);
      if (page.sections?.length) {
        sections.push('Sections:');
        for (const sec of page.sections) {
          const sectionLabel = (sec.heading || sec.type || 'Section').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
          const details: string[] = [];
          if (sec.heading) details.push(`heading: "${sec.heading}"`);
          if (sec.cta) details.push(`CTA: "${sec.cta}"`);
          sections.push(`- ${sectionLabel}${details.length ? ` (${details.join(', ')})` : ''}`);
        }
      }
      sections.push('');
    }
  }

  // 8. Technical Requirements
  sections.push(`## 8. Technical Requirements`);
  sections.push(`- Mobile-first responsive (320px → 1200px)`);
  sections.push(`- Semantic HTML5 (nav, main, section, footer)`);
  sections.push(`- WCAG AA accessibility`);
  sections.push(`- All images: alt text, lazy loading`);
  if (sprintConfig?.includeAnimations) sections.push(`- Animations: ${sprintConfig.motionIntensity || 'standard'} (respect prefers-reduced-motion)`);
  if (sprintConfig?.scene3DEnabled || sprintConfig?.renderMode === 'enhanced' || sprintConfig?.renderMode === 'immersive') sections.push(`- 3D: enabled`);
  if (sprintConfig?.seoOptimized !== false) sections.push(`- SEO: meta title, description, Open Graph on every page`);
  if (sprintConfig?.includeContactForm) sections.push(`- Contact form with validation`);
  sections.push('');

  // 9. Constraints
  sections.push(`## 9. Constraints`);
  sections.push(`- NO fabricated stats, testimonials, or team bios unless provided`);
  sections.push(`- NO renaming the product`);
  sections.push(`- NO security/compliance claims unless explicitly stated`);
  sections.push(`- NO placeholder contact info — use the real data from Section 4`);
  sections.push('');

  // 10. Pod Instructions
  sections.push(`## 10. Pod Instructions`);
  sections.push(`This document is the single source of truth.`);
  sections.push(`When unsure about any requirement, run: file_read README.md`);

  return sections.join('\n');
}

// ============================================================================
// selectRelevantArtifacts
// ============================================================================

/**
 * Select which artifacts to inject based on phase position and pod role.
 *
 * Rules:
 * - Same phase  -> all artifacts from completed tasks in this phase
 * - Later phase -> final artifacts from the previous phase
 * - QA pod      -> ALL artifacts (QA needs to see everything)
 *
 * Artifacts are sorted newest-first so the most recent context appears first.
 *
 * When the QA pod is selected, artifacts exceeding the char budget are returned
 * separately via the `qaManifestOut` array (if provided) so the caller can list
 * them as a manifest without injecting their full content.
 */
export function selectRelevantArtifacts(
  state: PromptBuilderState,
  phases: Phase[],
  currentPhaseIdx: number,
  _task: Task,
  pod: AgentPod,
  qaManifestOut?: Artifact[],
): Artifact[] {
  const allArtifacts = Array.from(state.artifacts.values());
  if (allArtifacts.length === 0) return [];

  // QA pods see everything, but capped at 30K chars to prevent token overflow.
  // Remaining artifacts are listed as a manifest (QA can use file_read/request_context_snippet).
  if (pod.role === PodRole.QA) {
    const QA_CHAR_BUDGET = 30_000;
    const sorted = allArtifacts.sort((a, b) => b.createdAt - a.createdAt);
    const capped: Artifact[] = [];
    let totalChars = 0;
    for (const a of sorted) {
      const contentLen = typeof a.content === 'string' ? a.content.length : JSON.stringify(a.content || '').length;
      if (totalChars + contentLen > QA_CHAR_BUDGET && capped.length > 0) {
        // Don't add more artifacts with full content; the rest will be listed as manifest
        break;
      }
      totalChars += contentLen;
      capped.push(a);
    }
    // Tag remaining artifacts so buildTaskPrompt can list them as a manifest
    if (qaManifestOut) {
      qaManifestOut.push(...sorted.slice(capped.length));
    }
    return capped;
  }

  // Build a set of pod IDs that belong to each phase
  const phasePodsMap = new Map<number, Set<string>>();
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i]!;
    const podIds = new Set<string>();
    for (const assignedId of phase.assignedPods || []) {
      podIds.add(assignedId);
    }
    // Also include pods that completed tasks in this phase
    for (const t of phase.tasks || []) {
      if (t.assignedPod) podIds.add(t.assignedPod);
    }
    phasePodsMap.set(i, podIds);
  }

  const selected: Artifact[] = [];
  const currentPhasePods = phasePodsMap.get(currentPhaseIdx) || new Set();
  const previousPhasePods = currentPhaseIdx > 0
    ? (phasePodsMap.get(currentPhaseIdx - 1) || new Set())
    : new Set();

  for (const artifact of allArtifacts) {
    const creatorId = artifact.createdBy;

    // Same phase: include artifacts from other pods in this phase
    if (currentPhasePods.has(creatorId) && creatorId !== pod.id) {
      selected.push(artifact);
      continue;
    }

    // Previous phase: include all artifacts from previous phase pods
    if (previousPhasePods.has(creatorId)) {
      selected.push(artifact);
      continue;
    }

    // For phase index > 1, also include Orchestrator artifacts from any phase
    // (orchestrator decisions are always relevant)
    const creatorPod = state.activePods.get(creatorId);
    if (creatorPod && creatorPod.role === PodRole.ORCHESTRATOR) {
      selected.push(artifact);
    }
  }

  // Sort newest-first so most recent work appears at the top
  return selected.sort((a, b) => b.createdAt - a.createdAt);
}

// ============================================================================
// buildTaskPrompt
// ============================================================================

/**
 * Build the full task prompt injected as the user message when a pod starts
 * working on a task.  Includes: objective, brief, sprint config, prior
 * artifacts, inbox messages, pause-and-ask instructions, and narration rules.
 *
 * Budget enforcement: if the assembled prompt exceeds 25K tokens it is
 * progressively compacted (strip code blocks -> remove inbox -> compact brief).
 */
export async function buildTaskPrompt(state: PromptBuilderState, task: Task, pod: AgentPod): Promise<string> {
  const tbwo = useTBWOStore.getState().getTBWOById(state.tbwoId);
  const phases = tbwo?.plan?.phases || [];
  const currentPhase = phases[state.currentPhaseIndex];

  const contextParts: string[] = [
    `## Task: ${task.name}`,
  ];

  if (task.description) {
    contextParts.push(`\n**Description:** ${task.description}`);
  }

  if (tbwo) {
    contextParts.push(`\n**TBWO Objective:** ${tbwo.objective}`);
    contextParts.push(`**Quality Target:** ${tbwo.qualityTarget}`);
    const totalBudget = tbwo.timeBudget.total ?? 60;
    const remaining = Math.max(0, totalBudget - (tbwo.timeBudget.elapsed || 0));
    contextParts.push(`**Time Budget:** ${totalBudget} minutes total, ${remaining.toFixed(1)} minutes remaining`);
    contextParts.push(`**CRITICAL:** You MUST complete this task within ${Math.min(remaining, totalBudget / (tbwo.plan?.phases.reduce((s, p) => s + p.tasks.length, 0) || 1)).toFixed(1)} minutes. Do NOT plan for more time than the budget allows. Work efficiently.`);

    // ====================================================================
    // SITE BRIEF INJECTION — canonical context for Sites product
    // ====================================================================
    const siteBrief = tbwo.metadata?.siteBrief as Record<string, unknown> | undefined;
    if (siteBrief) {
      contextParts.push('\n## Approved Site Brief (CANONICAL — use this as source of truth)');
      const productName = siteBrief.productName as string || '';
      const tagline = siteBrief.tagline as string || '';
      const positioning = siteBrief.oneLinerPositioning as string || '';
      const audience = siteBrief.targetAudience as string || siteBrief.icpGuess as string || '';
      const pain = siteBrief.primaryPain as string || '';
      const cta = siteBrief.primaryCTA as string || '';
      const tone = siteBrief.toneStyle as string || siteBrief.tone as string || '';

      if (productName) contextParts.push(`**Product Name:** ${productName} (NEVER rename — use this EXACTLY)`);
      if (tagline) contextParts.push(`**Tagline:** ${tagline}`);
      if (positioning) contextParts.push(`**Positioning:** ${positioning}`);
      if (audience) contextParts.push(`**Target Audience:** ${audience}`);
      if (pain) contextParts.push(`**Primary Pain:** ${pain}`);
      if (cta) contextParts.push(`**Primary CTA:** ${cta}`);
      if (tone) contextParts.push(`**Tone:** ${tone}`);

      const features = siteBrief.features as string[] | undefined;
      if (features?.length) contextParts.push(`**Features:** ${features.join(', ')}`);

      const integrations = siteBrief.integrations as string[] | undefined;
      if (integrations?.length) contextParts.push(`**Integrations:** ${integrations.join(', ')}`);

      // Pricing context
      const pricing = siteBrief.pricing as Record<string, unknown> | undefined;
      if (pricing) {
        const tiers = pricing.tiers as Array<Record<string, unknown>> | undefined;
        if (tiers?.length) {
          contextParts.push('**Pricing Tiers:**');
          for (const tier of tiers) {
            const popular = tier.isMostPopular ? ' (Most Popular)' : '';
            contextParts.push(`  - ${tier.name}: $${tier.priceMonthly}/mo — ${tier.limitLabel}${popular}`);
          }
        }
        if (pricing.hasFreePlan) contextParts.push('**Free plan:** Yes');
        const trial = pricing.trial as Record<string, unknown> | undefined;
        if (trial?.enabled) contextParts.push(`**Trial:** ${trial.days} days${trial.requiresCard ? ' (card required)' : ''}`);
      }

      // Contact information
      const contactEmail = siteBrief.contactEmail as string || '';
      const contactPhone = siteBrief.contactPhone as string || '';
      const contactAddress = siteBrief.contactAddress as string || '';
      const socialLinks = siteBrief.socialLinks as Record<string, string> | undefined;
      const operatingHours = siteBrief.operatingHours as string || '';

      if (contactEmail || contactPhone || contactAddress) {
        contextParts.push(`\n## CONTACT INFORMATION (USE EXACTLY — DO NOT CHANGE)`);
        if (contactEmail) contextParts.push(`- Email: ${contactEmail}`);
        if (contactPhone) contextParts.push(`- Phone: ${contactPhone}`);
        if (contactAddress) contextParts.push(`- Address: ${contactAddress}`);
        if (operatingHours) contextParts.push(`- Hours: ${operatingHours}`);
        if (socialLinks && Object.keys(socialLinks).length > 0) {
          contextParts.push(`- Social: ${Object.entries(socialLinks).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
        }
        contextParts.push(`\nIMPORTANT: Use these EXACT contact details everywhere they appear. Never substitute with placeholder or example data.`);
      }

      // Trust constraints
      contextParts.push(`
## TRUST RULES (MANDATORY)
- **NEVER fabricate stats, numbers, or user counts** unless explicitly provided above
- **NEVER rename the product** — use "${productName || 'the product name from the brief'}" exactly
- **NEVER claim security certifications** (SOC 2, HIPAA, etc.) unless explicitly provided
- **NEVER fabricate testimonials** — use real quotes only if provided, otherwise use "Early Access" or "Built with" sections
- If you need information not in this brief, use request_pause_and_ask. Do NOT guess.
- If the about page has no team info, write in first-person founder voice: "I built this because..."
- Replace fake stats with honest alternatives: "Built for independent creatives", "Designed to replace 5+ tools"`);

      // Provenance
      const provenance = tbwo.metadata?.provenance as Record<string, string> | undefined;
      if (provenance && Object.keys(provenance).length > 0) {
        contextParts.push('\n**User-Edited Fields:** ' + Object.keys(provenance).join(', '));
      }
    }

    // ====================================================================
    // SPRINT CONFIG INJECTION — user's design/media/animation choices
    // ====================================================================
    const sprintConfig = tbwo.metadata?.sprintConfig as Record<string, unknown> | undefined;
    if (sprintConfig) {
      const configParts: string[] = [];

      // Color scheme
      const cs = sprintConfig.colorScheme as Record<string, string> | undefined;
      if (cs?.primary) {
        configParts.push(`**Color Scheme:** primary=${cs.primary}, secondary=${cs.secondary}, accent=${cs.accent || 'auto'}, bg=${cs.background}, text=${cs.text}`);
      }

      // Typography
      const tp = sprintConfig.typography as Record<string, string> | undefined;
      if (tp?.headingFont) {
        configParts.push(`**Typography:** headings="${tp.headingFont}", body="${tp.bodyFont}", scale=${tp.scale || 'medium'}`);
      }

      // Aesthetic
      if (sprintConfig.aesthetic) {
        configParts.push(`**Visual Style:** ${sprintConfig.aesthetic}`);
      }

      // Motion intensity
      if (sprintConfig.motionIntensity) {
        configParts.push(`**Motion Intensity:** ${sprintConfig.motionIntensity}`);
      }

      // Animation styles
      const animStyles = sprintConfig.animationStyles as string[] | undefined;
      if (animStyles?.length) {
        configParts.push(`**Animation Styles:** ${animStyles.join(', ')}`);
      }

      // 3D
      if (sprintConfig.scene3DEnabled) {
        configParts.push(`**3D Elements:** enabled${sprintConfig.scene3DAssetId ? `, asset=${sprintConfig.scene3DAssetId}` : ''}`);
      }

      // Brand assets
      const brandAssets = sprintConfig.brandAssets as Record<string, string> | undefined;
      if (brandAssets?.logoUrl) {
        configParts.push(`**Logo URL:** ${brandAssets.logoUrl} (use this in the nav/header)`);
      }
      if (brandAssets?.brandGuidelinesText) {
        configParts.push(`**Brand Notes:** ${brandAssets.brandGuidelinesText}`);
      }

      // Page media
      const pageMedia = sprintConfig.pageMedia as Array<Record<string, unknown>> | undefined;
      if (pageMedia?.length) {
        configParts.push('**User-Uploaded Media:**');
        for (const m of pageMedia) {
          if (m.url) {
            configParts.push(`  - Page ${m.pageIndex}: ${m.type} at ${m.placement}${m.placementHint ? ` (${m.placementHint})` : ''} — ${m.url}`);
          }
        }
      }

      // Accepted suggestions
      const accepted = sprintConfig.acceptedSuggestions as string[] | undefined;
      if (accepted?.length) {
        configParts.push(`**Accepted ALIN Suggestions:** ${accepted.join(', ')}`);
        configParts.push('Implement these suggestions in the relevant pages/sections.');
      }

      if (configParts.length > 0) {
        contextParts.push('\n## User Design & Animation Preferences (MANDATORY)');
        contextParts.push('The user specified these preferences in the wizard. Apply them to your output.\n');
        contextParts.push(configParts.join('\n'));
      }
    }
  }

  // ====================================================================
  // ROLE-SPECIFIC TASK PROMPT ENRICHMENT (Products/Sites subsystem prompts)
  // Only for website_sprint TBWOs — dynamic import with fallback
  // ====================================================================
  if (tbwo?.type === TBWOType.WEBSITE_SPRINT && task.description) {
    try {
      const sprintCfg = tbwo.metadata?.sprintConfig as Record<string, unknown> | undefined;
      const siteBrief = tbwo.metadata?.siteBrief as Record<string, unknown> | undefined;
      const aesthetic = (sprintCfg?.aesthetic as string) || 'modern';
      const framework = (sprintCfg?.framework as string) || 'static';
      const tone = (siteBrief?.toneStyle as string) || (siteBrief?.tone as string) || 'professional';
      const qualityLabel = tbwo.qualityTarget || 'standard';
      const animStyle = (sprintCfg?.motionIntensity as string) || 'standard';
      const totalBudget = tbwo.timeBudget.total ?? 60;
      const remaining = Math.max(0, totalBudget - (tbwo.timeBudget.elapsed || 0));

      const enrichmentMap: Partial<Record<PodRole, () => Promise<string>>> = {
        [PodRole.DESIGN]: async () => {
          const m = await import('../../products/sites/prompts/design');
          const cs = sprintCfg?.colorScheme as Record<string, string> | undefined;
          return m.getDesignPromptForTask(task.description || task.name, aesthetic, cs);
        },
        [PodRole.FRONTEND]: async () => {
          const m = await import('../../products/sites/prompts/frontend');
          const tokens = Array.from(state.artifacts.values())
            .find(a => (a.path || a.name || '').includes('variables.css'));
          const tokenStr = tokens ? (typeof tokens.content === 'string' ? tokens.content : '') : undefined;
          return m.getFrontendPromptForTask(task.description || task.name, framework, tokenStr);
        },
        [PodRole.QA]: async () => {
          const m = await import('../../products/sites/prompts/qa');
          return m.getQAPromptForTask(task.description || task.name, qualityLabel);
        },
        [PodRole.COPY]: async () => {
          const m = await import('../../products/sites/prompts/copy');
          return m.getCopyPromptForTask(task.description || task.name, tone);
        },
        [PodRole.MOTION]: async () => {
          const m = await import('../../products/sites/prompts/motion');
          return m.getMotionPromptForTask(task.description || task.name, animStyle);
        },
        [PodRole.ORCHESTRATOR]: async () => {
          const m = await import('../../products/sites/prompts/orchestrator');
          return m.getOrchestratorPromptForTask(task.description || task.name, remaining);
        },
      };

      const enrichFn = enrichmentMap[pod.role as PodRole];
      if (enrichFn) {
        const enrichment = await enrichFn();
        if (enrichment) {
          contextParts.push('\n## Role-Specific Task Guidance');
          contextParts.push(enrichment);
        }
      }
    } catch {
      // Dynamic import failed — silently fall through
    }
  }

  // ====================================================================
  // MOTION SPEC INJECTION — inject MotionSpec for motion/animation/frontend pods
  // ====================================================================
  if (tbwo?.type === TBWOType.WEBSITE_SPRINT) {
    const motionSpec = tbwo.metadata?.motionSpec;
    if (motionSpec && [PodRole.MOTION, PodRole.ANIMATION, PodRole.FRONTEND].includes(pod.role as PodRole)) {
      const specStr = typeof motionSpec === 'string' ? motionSpec : JSON.stringify(motionSpec, null, 2);
      if (specStr.length <= 8_000) {
        contextParts.push('\n## MotionSpec (design intent — follow this specification)');
        contextParts.push('```json\n' + specStr + '\n```');
      }
    }
  }

  // ====================================================================
  // 3D SCENE SPEC INJECTION — inject SceneSpec for 3D-related tasks
  // ====================================================================
  if (tbwo?.type === TBWOType.WEBSITE_SPRINT) {
    const is3DTask = (task.name || '').toLowerCase().match(/3d|scene/) ||
      pod.role === PodRole.THREE_D;
    const sprintCfg = tbwo.metadata?.sprintConfig as Record<string, unknown> | undefined;
    const renderMode = sprintCfg?.renderMode as string | undefined;
    if (is3DTask && renderMode && renderMode !== 'standard') {
      try {
        const { createDefaultSceneSpec } = await import('../../products/sites/3d/sceneDefaults');
        const { getPerformanceBudget } = await import('../../products/sites/3d/performanceManager');
        const defaultSpec = createDefaultSceneSpec(renderMode as any, 'hero', [], 'free');
        const budget = getPerformanceBudget('free');
        if (defaultSpec) {
          contextParts.push('\n## 3D SceneSpec (default template — customize per brief)');
          const specStr = JSON.stringify(defaultSpec, null, 2);
          if (specStr.length <= 6_000) {
            contextParts.push('```json\n' + specStr + '\n```');
          }
          contextParts.push(`\n**Performance Budget:** max polycount=${budget.maxPolycount}, max texture=${budget.maxTextureResolution}, target FPS=${budget.targetFPS}`);
        }
      } catch {
        // 3D subsystem unavailable — silently fall through
      }
    }
  }

  if (currentPhase) {
    contextParts.push(`\n**Current Phase:** ${currentPhase.name} - ${currentPhase.description}`);
  }

  // ========================================================================
  // PRE-EXECUTION ANSWERS — inject user clarifications so pods have full context
  // ========================================================================
  const preExecAnswers = tbwo?.metadata?.preExecutionAnswers as string | undefined;
  if (preExecAnswers) {
    contextParts.push(`
## User-Provided Details (MANDATORY — USE THESE EXACTLY)
The user provided these specific details during pre-execution. You MUST use these values
exactly as given. Do NOT fabricate alternatives or ignore them.

${preExecAnswers}

Use these values in your output wherever relevant (e.g., contact info in footer/contact pages,
company name in headers/about pages, etc.).`);
  }

  // Also inject answered requiredUnknowns directly from the brief
  const briefUnknowns = (tbwo?.metadata?.siteBrief as Record<string, unknown>)?.requiredUnknowns as Array<{
    field: string; question: string; answer?: string;
  }> | undefined;
  if (briefUnknowns?.some(u => u.answer)) {
    // Guard filter — only include entries that have both field AND answer
    const answeredFields = briefUnknowns.filter(u => u.answer && u.field);
    if (answeredFields.length > 0) {
      if (!preExecAnswers) {
        // Only add header if preExecAnswers wasn't already shown
        contextParts.push('\n## User-Provided Details (MANDATORY — USE THESE EXACTLY)');
      }
      for (const u of answeredFields) {
        // Re-inject as top-level context so pods don't miss it
        const fieldLabel = (u.field || 'Unknown').replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase()).trim();
        contextParts.push(`- **${fieldLabel}:** ${u.answer}`);
      }
    }
  }

  // ========================================================================
  // ARTIFACT INJECTION — pass prior pod outputs so this pod can build on them
  // Budget-aware: page-building tasks get minimal injection (tokens are precious).
  // ========================================================================
  // Collect QA manifest artifacts here (passed out via the closure-free approach)
  const qaManifestArtifacts: Artifact[] = [];

  if (state.artifacts.size > 0) {
    const isWebsiteSprint = tbwo?.type === TBWOType.WEBSITE_SPRINT;
    const isPageBuildTask = isWebsiteSprint && currentPhase &&
      (currentPhase.name.toLowerCase().includes('page') || task.name.toLowerCase().startsWith('build page'));

    if (isPageBuildTask) {
      // PAGE TASKS: only inject variables.css (design tokens). Other artifacts
      // are available on-demand via request_context_snippet.
      const allArtifacts = Array.from(state.artifacts.values());
      const designTokens = allArtifacts.find(a =>
        (a.path || a.name || '').toLowerCase().includes('variables.css')
      );

      if (designTokens) {
        const tokenContent = typeof designTokens.content === 'string'
          ? designTokens.content
          : JSON.stringify(designTokens.content, null, 2);
        contextParts.push('\n## Design Tokens (variables.css)');
        contextParts.push('Use these CSS custom properties in your HTML.\n');
        contextParts.push('```css\n' + tokenContent.slice(0, 8_000) + '\n```');
      }

      // List other artifacts as names only — use request_context_snippet to read
      const others = allArtifacts.filter(a => a !== designTokens);
      if (others.length > 0) {
        contextParts.push('\n**Other artifacts available** (use `request_context_snippet` tool to read if needed):');
        for (const a of others.slice(0, 15)) {
          contextParts.push(`  - \`${a.path || a.name || 'unnamed'}\` (${a.type})`);
        }
        if (others.length > 15) {
          contextParts.push(`  ... and ${others.length - 15} more`);
        }
      }
    } else {
      // NON-PAGE TASKS: inject artifact content with budget
      const relevantArtifacts = selectRelevantArtifacts(
        state, phases, state.currentPhaseIndex, task, pod, qaManifestArtifacts
      );

      if (relevantArtifacts.length > 0) {
        contextParts.push('\n## Artifacts from Prior Work');
        contextParts.push('These were produced by other pods. Use them as input for your task.\n');

        const ARTIFACT_CHAR_BUDGET = 30_000;
        let charsUsed = 0;

        for (const artifact of relevantArtifacts) {
          const contentStr = typeof artifact.content === 'string'
            ? artifact.content
            : JSON.stringify(artifact.content, null, 2);
          const header = `### ${artifact.name} (${artifact.type})${artifact.path ? ` — ${artifact.path}` : ''}`;

          if (charsUsed + header.length + contentStr.length + 10 > ARTIFACT_CHAR_BUDGET) {
            const remaining = ARTIFACT_CHAR_BUDGET - charsUsed - header.length - 50;
            if (remaining > 200) {
              contextParts.push(header);
              contextParts.push('```\n' + contentStr.slice(0, remaining) + '\n... (truncated)\n```');
            } else {
              contextParts.push(`*(${relevantArtifacts.length - relevantArtifacts.indexOf(artifact)} more artifacts omitted for space)*`);
            }
            break;
          }

          contextParts.push(header);
          contextParts.push('```\n' + contentStr + '\n```');
          charsUsed += header.length + contentStr.length + 10;
        }
      } else {
        // Still list artifact names even if no content is injected
        contextParts.push('\n**Available Artifacts (no content injected):**');
        let count = 0;
        for (const [, artifact] of state.artifacts) {
          if (count >= 10) {
            contextParts.push(`  ... and ${state.artifacts.size - 10} more`);
            break;
          }
          contextParts.push(`  - ${artifact.name} (${artifact.type})${artifact.path ? ` at ${artifact.path}` : ''}`);
          count++;
        }
      }
    }

    // QA manifest: list artifacts that were omitted from full injection due to budget
    if (qaManifestArtifacts.length > 0 && pod.role === PodRole.QA) {
      contextParts.push('\n### Additional Files (not included above — use `file_read` or `request_context_snippet` to inspect)');
      for (const a of qaManifestArtifacts.slice(0, 20)) {
        const size = typeof a.content === 'string' ? a.content.length : 0;
        contextParts.push(`  - \`${a.path || a.name}\` (${a.type}, ~${Math.round(size / 1024)}KB)`);
      }
      if (qaManifestArtifacts.length > 20) {
        contextParts.push(`  ... and ${qaManifestArtifacts.length - 20} more files`);
      }
    }
  }

  // Include recent errors as warnings
  const recentErrors = state.errors.slice(-3);
  if (recentErrors.length > 0) {
    contextParts.push('\n**Recent Errors (for awareness):**');
    for (const err of recentErrors) {
      contextParts.push(`  - [${err.phase}/${err.task}]: ${err.error}`);
    }
  }

  // ========================================================================
  // INBOX INJECTION — show messages from other pods
  // ========================================================================
  const inbox = state.podInboxes.get(pod.id) || [];
  if (inbox.length > 0) {
    // Cap at 20 most recent messages
    const recentMessages = inbox.slice(-20);
    contextParts.push('\n## Messages from Other Pods');
    contextParts.push('These messages arrived from other pods while you were idle or working. Use this context to coordinate.\n');

    for (const msg of recentMessages) {
      const senderPod = state.activePods.get(msg.from);
      const senderName = senderPod ? `${senderPod.name} (${senderPod.role})` : msg.from;
      const payload = msg.payload as Record<string, unknown>;

      switch (msg.type) {
        case 'artifact_ready':
          contextParts.push(`- **${senderName}** created artifact: \`${payload['name'] || payload['path'] || 'unknown'}\` (${payload['type'] || 'file'})${payload['preview'] ? `\n  Preview: ${String(payload['preview']).slice(0, 200)}...` : ''}`);
          break;
        case 'question':
          contextParts.push(`- **${senderName}** asks: ${payload['question'] || JSON.stringify(payload)}`);
          break;
        case 'result':
          contextParts.push(`- **${senderName}** completed: ${payload['task'] || ''} — ${payload['outputPreview'] || payload['status'] || 'done'}`);
          break;
        case 'error':
          contextParts.push(`- **${senderName}** error: ${payload['task'] || ''} — ${payload['error'] || 'unknown error'}`);
          break;
        case 'status_update':
          contextParts.push(`- **${senderName}** status: ${payload['task'] || ''} ${payload['status'] || ''}`);
          break;
        case 'clarification_request':
          contextParts.push(`- **${senderName}** needs clarification: ${payload['question'] || JSON.stringify(payload)}`);
          break;
        default:
          contextParts.push(`- **${senderName}** [${msg.type}]: ${JSON.stringify(payload).slice(0, 200)}`);
      }
    }

    // Drain inbox after injection
    state.podInboxes.set(pod.id, []);
  }

  contextParts.push('\nPlease complete this task. Use the available tools to produce concrete outputs (files, code, etc). Be thorough but efficient.');

  // Pause-and-Ask instructions — appended to every task prompt
  contextParts.push(`
## When to Ask the User (IMPORTANT)

You have a \`request_pause_and_ask\` tool. Use it when you encounter ANY of these:

1. **Business-specific content you can't know**: Company name, product names, team members, pricing, phone numbers, addresses, specific services offered
2. **Brand preferences**: Color scheme not specified, logo requirements, specific imagery style
3. **Content decisions**: Which features to highlight, what the value proposition is, target audience details
4. **Technical choices**: Contact form destination, analytics IDs, third-party integrations

Do NOT guess business content. Do NOT use placeholder company names like "Acme Corp".
If the objective says "Build a SaaS platform for freelance client management" but doesn't specify pricing tiers, ASK.
If it says "creative agency website" but doesn't specify the agency name, ASK.

When calling request_pause_and_ask:
- reason: 'MISSING_CRITICAL_FACT' for business content, 'REQUIRES_USER_PREFERENCE' for design choices
- question: Be specific about what you need and WHY you need it
- required_fields: List the exact fields you need filled in
- can_infer_from_vague_answer: true (let the system extract structured data from casual responses)

GOOD question examples:
- "What is the name of your company/product? I need it for the header, footer, and meta tags."
- "You mentioned pricing — what are your pricing tiers? I need: tier name, price, billing interval, and feature list for each."
- "What email address should the contact form submit to?"
- "What is your primary call-to-action? (e.g., 'Start Free Trial', 'Book a Demo', 'Get Started')"

BAD question examples (DO NOT ask these):
- "What should I put here?" (too vague — say WHERE and WHAT you need)
- "Do you have pricing?" (yes/no questions waste time — ask for the actual data)
- "What would you like?" (be specific about the options)

You may use generic placeholder text ONLY for:
- Lorem-style body copy that clearly needs replacement (mark with [PLACEHOLDER])
- Sample testimonial quotes
- Stock image alt text descriptions`);

  // Narration: pods explain their work in real-time
  contextParts.push(`\n## WORK NARRATION
As you work, narrate your actions concisely. Explain what you're doing and why:
- "Starting with the HTML structure for the hero section..."
- "Adding responsive breakpoints for mobile..."
- "Checking design tokens for color consistency..."
Keep narration brief but informative — the user is watching you work.`);

  // ========================================================================
  // PROMPT BUDGET ENFORCEMENT — 25K token hard gate via tokenBudget.ts
  // ========================================================================
  let prompt = contextParts.join('\n');
  const { ok, tokens } = assertTokenBudget(prompt, `Task: ${task.name}`);

  if (!ok) {
    // Emergency compaction: strip artifact content, compact brief, remove inbox
    console.warn(
      `[PromptBuilder] Prompt for "${task.name}" is ${tokens} tokens (${prompt.length} chars). Compacting...`
    );

    // Step 1: Strip artifact code blocks but keep headers
    prompt = prompt.replace(/```[\s\S]*?```/g, '*(content omitted — use request_context_snippet to retrieve)*');

    // Step 2: Remove inbox messages section entirely
    const inboxIdx = prompt.indexOf('## Messages from Other Pods');
    if (inboxIdx > 0) {
      const nextSection = prompt.indexOf('\n## ', inboxIdx + 10);
      if (nextSection > 0) {
        prompt = prompt.slice(0, inboxIdx) + prompt.slice(nextSection);
      } else {
        prompt = prompt.slice(0, inboxIdx);
      }
    }

    // Step 3: If still over budget, rebuild with compact brief
    const { ok: ok2 } = assertTokenBudget(prompt, `Task: ${task.name} (after strip)`);
    if (!ok2) {
      const siteBrief = tbwo?.metadata?.siteBrief as Record<string, unknown> | undefined;
      const compacted = [
        `## Task: ${task.name}`,
        task.description ? `\n**Description:** ${task.description}` : '',
        tbwo ? `\n**TBWO Objective:** ${tbwo.objective}` : '',
        tbwo ? `**Quality Target:** ${tbwo.qualityTarget}` : '',
        siteBrief ? `\n## Site Brief (Compacted)\n${compactBrief(siteBrief)}` : '',
        `\n## TRUST RULES (MANDATORY)`,
        `- NEVER fabricate stats, numbers, or user counts`,
        `- NEVER rename the product — use the name from the brief exactly`,
        `- NEVER claim security certifications unless explicitly provided`,
        `- NEVER fabricate testimonials`,
        `- If you need information not in this brief, use request_pause_and_ask`,
      ].filter(Boolean).join('\n');

      console.warn(
        `[PromptBuilder] Full compact: ${estimateTokens(prompt)} → ~${estimateTokens(compacted)} tokens`
      );
      prompt = compacted;
    }
  }

  return prompt;
}

// ============================================================================
// buildToolDefinitions
// ============================================================================

/**
 * Build the array of tool definition objects for a pod based on its whitelist.
 * If the whitelist is empty, ALL tools are returned (pods need tools to function).
 */
export function buildToolDefinitions(whitelist: string[]): any[] {
  const allTools: Record<string, any> = {
    file_write: {
      name: 'file_write',
      description: 'Create a file artifact. The file will be stored as a downloadable artifact — it is NOT written to the local filesystem. Use a simple relative filename (e.g. "index.html", "styles/main.css").',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative filename for the artifact (e.g. "index.html", "src/App.tsx")' },
          content: { type: 'string', description: 'Content to write to the file' },
        },
        required: ['path', 'content'],
      },
    },
    file_read: {
      name: 'file_read',
      description: 'Read the contents of a file.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' },
        },
        required: ['path'],
      },
    },
    file_list: {
      name: 'file_list',
      description: 'List files and directories at a given path.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
        },
        required: ['path'],
      },
    },
    scan_directory: {
      name: 'scan_directory',
      description: 'Recursively scan a directory tree and return its structure.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Root directory to scan' },
          max_depth: { type: 'number', description: 'Maximum depth to scan (default: 3)' },
        },
        required: ['path'],
      },
    },
    code_search: {
      name: 'code_search',
      description: 'Search for text/code patterns in files.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query or regex pattern' },
          path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['query'],
      },
    },
    execute_code: {
      name: 'execute_code',
      description: 'Execute code in a sandboxed environment.',
      input_schema: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Programming language (javascript, python, etc)' },
          code: { type: 'string', description: 'Code to execute' },
        },
        required: ['language', 'code'],
      },
    },
    edit_file: {
      name: 'edit_file',
      description: 'Edit a file by replacing old text with new text.',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to edit' },
          old_text: { type: 'string', description: 'Text to find and replace' },
          new_text: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_text', 'new_text'],
      },
    },
    web_search: {
      name: 'web_search',
      description: 'Search the web for information.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results (default: 5)' },
        },
        required: ['query'],
      },
    },
    memory_store: {
      name: 'memory_store',
      description: 'Store information in memory for later recall.',
      input_schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Content to remember' },
          category: { type: 'string', description: 'Category for the memory' },
        },
        required: ['content'],
      },
    },
    memory_recall: {
      name: 'memory_recall',
      description: 'Recall stored information from memory.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for in memory' },
        },
        required: ['query'],
      },
    },
    run_command: {
      name: 'run_command',
      description: 'Run a shell command.',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to execute' },
        },
        required: ['command'],
      },
    },
    git: {
      name: 'git',
      description: 'Execute git operations.',
      input_schema: {
        type: 'object',
        properties: {
          operation: { type: 'string', description: 'Git operation (status, log, diff, etc)' },
          args: { type: 'string', description: 'Additional arguments' },
        },
        required: ['operation'],
      },
    },
    system_status: {
      name: 'system_status',
      description: 'Get current system/TBWO execution status.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    web_fetch: {
      name: 'web_fetch',
      description: 'Fetch full page content from a URL. Strips scripts/styles, returns text (max 15K chars).',
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
        },
        required: ['url'],
      },
    },
    search_images: {
      name: 'search_images',
      description: 'Search for stock photos. Returns URLs and attribution. Use for real images in websites.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Image search query' },
          count: { type: 'number', description: 'Number of results (default 5)' },
          orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'], description: 'Image orientation' },
        },
        required: ['query'],
      },
    },
    site_validate: {
      name: 'site_validate',
      description: 'Run automated site validation. Checks for missing pages, broken links, placeholder content.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    conversion_audit: {
      name: 'conversion_audit',
      description: 'Run conversion intelligence audit. Scores hero clarity, CTA placement, pricing psychology, trust signals, visual hierarchy.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    site_improve: {
      name: 'site_improve',
      description: 'Run comprehensive 6-audit site improvement analysis. Returns scored report with actionable improvements for SEO, clarity, trust, CTA, messaging, and conversion.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    motion_validate: {
      name: 'motion_validate',
      description: 'Validate motion system quality. Checks reduced-motion compliance, performance budget, animation properties, bundle size, FOUC prevention, and accessibility.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    scene_validate: {
      name: 'scene_validate',
      description: 'Validate 3D scene system. Checks WebGL fallback, reduced-motion, performance budget, accessibility, bundle size, CDN loading, and IntersectionObserver pause.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    output_guard: {
      name: 'output_guard',
      description: 'Scan generated site files for generic/placeholder content. Returns violations with suggestions. Detects: Lorem ipsum, "Your Company", generic headlines, lazy CTAs, missing product name references.',
      input_schema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    generate_image: {
      name: 'generate_image',
      description: 'Generate an image using DALL-E 3.',
      input_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image generation prompt' },
          size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792'], description: 'Image size' },
          quality: { type: 'string', enum: ['standard', 'hd'], description: 'Image quality' },
        },
        required: ['prompt'],
      },
    },
    request_clarification: {
      name: 'request_clarification',
      description: 'Ask for clarification when facing genuine ambiguity that blocks your work. Use this ONLY when you cannot make a reasonable decision yourself — e.g., conflicting requirements, missing critical information, or multiple equally valid approaches. Do NOT use for trivial decisions.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The specific question you need answered to proceed' },
          context: { type: 'string', description: 'Brief context explaining why this is blocking your work' },
          options: { type: 'array', items: { type: 'string' }, description: 'Optional list of choices you see (2-4 options)' },
        },
        required: ['question'],
      },
    },
    request_context_snippet: {
      name: 'request_context_snippet',
      description: 'Retrieve a snippet from a stored artifact produced earlier in this TBWO. Use this to read styles.css, script.js, other HTML pages, or any artifact without carrying their full content in every prompt. Much cheaper than re-generating.',
      input_schema: {
        type: 'object',
        properties: {
          artifact_name: { type: 'string', description: 'Name or path of the artifact (e.g. "styles.css", "index.html", "script.js")' },
          query: { type: 'string', description: 'Optional search string to find a specific section. If omitted, returns from the start of the file.' },
          max_chars: { type: 'number', description: 'Maximum characters to return (default: 5000, max: 10000)' },
        },
        required: ['artifact_name'],
      },
    },
    request_pause_and_ask: {
      name: 'request_pause_and_ask',
      description: 'HARD PAUSE the entire TBWO execution and ask the user a critical question. This stops ALL pods until the user responds. Use this when: (1) a critical fact is missing and cannot be inferred (e.g., pricing, API credentials, brand colors), (2) content confidence is too low to proceed, (3) the user must choose between fundamentally different approaches, or (4) an external dependency is needed. Do NOT use for minor decisions — use request_clarification instead.',
      input_schema: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['MISSING_CRITICAL_FACT', 'UNCERTAIN_CONTENT', 'REQUIRES_USER_PREFERENCE', 'EXTERNAL_DEPENDENCY'],
            description: 'Why the pause is needed',
          },
          question: { type: 'string', description: 'Clear, specific question for the user' },
          context_path: { type: 'string', description: 'Where in the output this matters (e.g., "pages.pricing.tiers")' },
          required_fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific data fields needed from the user (e.g., ["price", "currency", "interval"])',
          },
          can_infer_from_vague_answer: {
            type: 'boolean',
            description: 'If true, AI can derive structured values from a vague/partial user response. Set to true for subjective questions, false for factual ones.',
          },
        },
        required: ['reason', 'question', 'context_path'],
      },
    },
  };

  // If whitelist is empty, return ALL tools (pods need tools to function)
  if (!whitelist || whitelist.length === 0) {
    return Object.values(allTools);
  }

  // Return only the tools in the pod's whitelist
  return whitelist
    .map((name) => allTools[name])
    .filter((tool): tool is NonNullable<typeof tool> => tool != null);
}
