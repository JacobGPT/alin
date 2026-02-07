/**
 * DesignPod - UI/UX design specialist for TBWO execution
 *
 * Responsible for creating visual designs, color palettes, typography scales,
 * design tokens (CSS custom properties), layout specifications, and component
 * designs. Extracts structured design data from AI responses and maintains
 * running state of the project's design system.
 */

import { BasePod } from './BasePod';
import type { Task, Artifact } from '../../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../../types/tbwo';
import { nanoid } from 'nanoid';
import { DESIGN_SYSTEM_PROMPT } from '../prompts/design';

// ============================================================================
// DESIGN POD
// ============================================================================

export class DesignPod extends BasePod {
  /** Accumulated design tokens extracted from AI responses (name -> value). */
  private designTokens: Map<string, string> = new Map();

  /** Color palette accumulated across tasks. */
  private colorPalette: Record<string, string> = {};

  // ==========================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ==========================================================================

  getSystemPrompt(): string {
    return DESIGN_SYSTEM_PROMPT;
  }

  getSpecializedTools(): any[] {
    return [
      {
        name: 'code_search',
        description: 'Search existing code for design patterns, existing styles, or component structures',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (regex or text)' },
            path: { type: 'string', description: 'Optional path to scope the search' },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_recall',
        description: 'Recall previously stored design decisions, brand guidelines, or references',
        input_schema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key to recall' },
          },
          required: ['key'],
        },
      },
      {
        name: 'file_write',
        description: 'Write design specification files (CSS, JSON tokens, markdown specs)',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to project root' },
            content: { type: 'string', description: 'File content' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'file_read',
        description: 'Read existing design files or stylesheets for reference',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
          },
          required: ['path'],
        },
      },
    ];
  }

  protected processTaskOutput(task: Task, response: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // ---- Extract CSS custom properties / design tokens ----
    const cssVarMatches = response.matchAll(/--[\w-]+:\s*[^;]+;/g);
    const tokens: string[] = [];
    for (const match of cssVarMatches) {
      tokens.push(match[0]);

      // Also store in the running designTokens map
      const parts = match[0].split(':');
      if (parts.length >= 2 && parts[0] !== undefined) {
        const name = parts[0].trim();
        const value = parts.slice(1).join(':').replace(';', '').trim();
        this.designTokens.set(name, value);
      }
    }

    if (tokens.length > 0) {
      const tokenContent = `:root {\n  ${tokens.join('\n  ')}\n}`;
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: 'design-tokens.css',
        type: ArtifactTypeEnum.DESIGN,
        description: 'Design tokens / CSS custom properties',
        content: tokenContent,
        path: 'css/variables.css',
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    // ---- Extract color palette entries ----
    const colorMatches = response.matchAll(/([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g);
    for (const match of colorMatches) {
      const colorName = match[1];
      const colorValue = match[2];
      if (colorName && colorValue) {
        this.colorPalette[colorName] = colorValue;
      }
    }

    // ---- Extract complete CSS blocks ----
    const cssBlockMatches = response.matchAll(/```css\n([\s\S]*?)```/g);
    const cssBlocks: string[] = [];
    for (const match of cssBlockMatches) {
      if (match[1]) {
        cssBlocks.push(match[1].trim());
      }
    }

    if (cssBlocks.length > 0) {
      const combined = cssBlocks.join('\n\n');
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `design-styles-${task.name.replace(/\s+/g, '-').toLowerCase()}.css`,
        type: ArtifactTypeEnum.CODE,
        description: `Design styles for: ${task.name}`,
        content: combined,
        path: `css/design-${task.name.replace(/\s+/g, '-').toLowerCase()}.css`,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    // ---- Full design spec as document artifact ----
    if (response.length > 100) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `design-spec-${task.name}`,
        type: ArtifactTypeEnum.DESIGN,
        description: `Design specification for: ${task.name}`,
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
  // DESIGN-SPECIFIC: STATE ACCESSORS
  // ==========================================================================

  /** Get all accumulated design tokens. */
  getDesignTokens(): Map<string, string> {
    return new Map(this.designTokens);
  }

  /** Get design tokens as a CSS string suitable for inclusion in a stylesheet. */
  getDesignTokensCSS(): string {
    if (this.designTokens.size === 0) return '';
    const lines: string[] = [];
    for (const [name, value] of this.designTokens) {
      lines.push(`  ${name}: ${value};`);
    }
    return `:root {\n${lines.join('\n')}\n}`;
  }

  /** Get the accumulated color palette. */
  getColorPalette(): Record<string, string> {
    return { ...this.colorPalette };
  }

  /** Manually set or override a design token. */
  setDesignToken(name: string, value: string): void {
    this.designTokens.set(name, value);
  }

  /** Manually set or override a color in the palette. */
  setColor(name: string, hex: string): void {
    this.colorPalette[name] = hex;
  }

  // ==========================================================================
  // CONTEXT BUILDING OVERRIDE
  // ==========================================================================

  /**
   * Override buildTaskPrompt to inject accumulated design context
   * (color palette, existing tokens) so the AI builds on previous decisions.
   */
  protected override buildTaskPrompt(task: Task): string {
    let prompt = super.buildTaskPrompt(task);

    if (Object.keys(this.colorPalette).length > 0) {
      prompt += `\n\n### Established Color Palette\n${JSON.stringify(this.colorPalette, null, 2)}`;
    }

    if (this.designTokens.size > 0) {
      prompt += `\n\n### Existing Design Tokens\n`;
      for (const [name, value] of this.designTokens) {
        prompt += `${name}: ${value}\n`;
      }
    }

    return prompt;
  }
}
