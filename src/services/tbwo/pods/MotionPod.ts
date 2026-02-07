/**
 * MotionPod - Animation and motion design specialist for TBWO execution
 *
 * Responsible for creating CSS animations, transitions, micro-interactions,
 * scroll-based animations, and motion design specifications. Maintains a
 * running collection of animation specs that can be retrieved by the
 * FrontendPod for integration.
 */

import { BasePod } from './BasePod';
import type { Task, Artifact } from '../../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../../types/tbwo';
import { nanoid } from 'nanoid';
import { MOTION_SYSTEM_PROMPT } from '../prompts/motion';

// ============================================================================
// MOTION POD
// ============================================================================

export class MotionPod extends BasePod {
  /** Accumulated animation CSS specs keyed by task name. */
  private animationSpecs: Map<string, string> = new Map();

  /** Project aesthetic preference for motion style calibration. */
  private aesthetic: string = '';

  // ==========================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ==========================================================================

  getSystemPrompt(): string {
    return MOTION_SYSTEM_PROMPT;
  }

  getSpecializedTools(): any[] {
    return [
      {
        name: 'file_write',
        description: 'Write animation CSS files to the project',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to project root' },
            content: { type: 'string', description: 'CSS file content' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'file_read',
        description: 'Read existing CSS files to understand current animations and styles',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
          },
          required: ['path'],
        },
      },
      {
        name: 'code_search',
        description: 'Search for existing animation or transition code in the project',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (e.g. "@keyframes", "transition")' },
            path: { type: 'string', description: 'Optional path to scope the search' },
          },
          required: ['query'],
        },
      },
    ];
  }

  protected processTaskOutput(task: Task, response: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // ---- Extract CSS animation blocks ----
    const cssBlocks = response.matchAll(/```css\n([\s\S]*?)```/g);
    const allCSS: string[] = [];
    for (const match of cssBlocks) {
      if (match[1]) {
        allCSS.push(match[1].trim());
      }
    }

    if (allCSS.length > 0) {
      const combined = allCSS.join('\n\n');

      // Store in the running animation specs
      this.animationSpecs.set(task.name, combined);

      // Create a CSS code artifact
      const safeName = task.name.replace(/\s+/g, '-').toLowerCase();
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `animations-${safeName}.css`,
        type: ArtifactTypeEnum.CODE,
        description: `Animation CSS for: ${task.name}`,
        content: combined,
        path: `css/animations-${safeName}.css`,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    // ---- Extract @keyframes definitions for indexing ----
    const keyframeMatches = response.matchAll(/@keyframes\s+([\w-]+)\s*\{/g);
    const keyframeNames: string[] = [];
    for (const match of keyframeMatches) {
      if (match[1]) {
        keyframeNames.push(match[1]);
      }
    }

    // ---- Extract timing/easing specifications ----
    const timingMatches = response.matchAll(
      /(?:duration|delay|timing):\s*([\d.]+(?:ms|s))\s*(?:\/\*.*?\*\/)?/gi
    );
    const timings: string[] = [];
    for (const match of timingMatches) {
      timings.push(match[0]);
    }

    // ---- Full motion spec as document artifact ----
    if (response.length > 50) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `motion-spec-${task.name}`,
        type: ArtifactTypeEnum.DOCUMENT,
        description: `Motion specification for: ${task.name}`,
        content: response,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    return artifacts;
  }

  // ==========================================================================
  // MOTION-SPECIFIC: STATE ACCESSORS
  // ==========================================================================

  /** Get all accumulated animation specs keyed by task name. */
  getAnimationSpecs(): Map<string, string> {
    return new Map(this.animationSpecs);
  }

  /** Get a single animation spec by task name. */
  getAnimationSpec(taskName: string): string | undefined {
    return this.animationSpecs.get(taskName);
  }

  /**
   * Get all animation CSS combined into a single string.
   * Suitable for passing to the FrontendPod as a complete animation stylesheet.
   */
  getAllAnimationCSS(): string {
    return Array.from(this.animationSpecs.values()).join('\n\n');
  }

  /** Get the count of animation specs. */
  getAnimationSpecCount(): number {
    return this.animationSpecs.size;
  }

  /** Set the project aesthetic preference (e.g. 'minimal', 'bold', 'elegant'). */
  setAesthetic(aesthetic: string): void {
    this.aesthetic = aesthetic;
  }

  /** Get the current aesthetic preference. */
  getAesthetic(): string {
    return this.aesthetic;
  }

  // ==========================================================================
  // CONTEXT BUILDING OVERRIDE
  // ==========================================================================

  /**
   * Override buildTaskPrompt to inject aesthetic preference and existing
   * animation specs so the AI maintains consistency across motion tasks.
   */
  protected override buildTaskPrompt(task: Task): string {
    let prompt = super.buildTaskPrompt(task);

    if (this.aesthetic) {
      prompt += `\n\n### Project Aesthetic: ${this.aesthetic}`;
    }

    // Include existing animation specs for consistency
    if (this.animationSpecs.size > 0) {
      prompt += '\n\n### Existing Animations (maintain consistent timing and style)';
      for (const [name, css] of this.animationSpecs) {
        // Only include a preview to avoid bloating the prompt
        const preview = css.length > 500 ? css.slice(0, 500) + '\n/* ... truncated ... */' : css;
        prompt += `\n\n**${name}:**\n\`\`\`css\n${preview}\n\`\`\``;
      }
    }

    return prompt;
  }
}
