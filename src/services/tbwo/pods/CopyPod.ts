/**
 * CopyPod - Content writing specialist for TBWO execution
 *
 * Responsible for all written content: headlines, body copy, CTAs, microcopy,
 * brand voice, and SEO text. Maintains a running copy bank organized by
 * section/component name for easy retrieval by other pods.
 */

import { BasePod } from './BasePod';
import type { Task, Artifact } from '../../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../../types/tbwo';
import { nanoid } from 'nanoid';
import { COPY_SYSTEM_PROMPT } from '../prompts/copy';

// ============================================================================
// COPY POD
// ============================================================================

export class CopyPod extends BasePod {
  /** The brand voice description used to guide all copy generation. */
  private brandVoice: string = '';

  /** Accumulated copy organized by section/component name. */
  private copyBank: Map<string, string> = new Map();

  /** Target audience description for copy tone calibration. */
  private targetAudience: string = '';

  // ==========================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ==========================================================================

  getSystemPrompt(): string {
    return COPY_SYSTEM_PROMPT;
  }

  getSpecializedTools(): any[] {
    return [
      {
        name: 'memory_recall',
        description: 'Recall previously stored brand guidelines, copy decisions, or audience research',
        input_schema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key to recall' },
          },
          required: ['key'],
        },
      },
      {
        name: 'web_search',
        description: 'Research competitors, industry language, or audience preferences',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_store',
        description: 'Store brand voice decisions or finalized copy for later reference',
        input_schema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key identifier' },
            value: { type: 'string', description: 'Value to store' },
          },
          required: ['key', 'value'],
        },
      },
    ];
  }

  protected processTaskOutput(task: Task, response: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // ---- Extract structured copy sections ----
    // Matches [Section: Name] or [Component: Name] blocks
    const sectionMatches = response.matchAll(
      /\[(?:Section|Component):\s*([^\]]+)\]([\s\S]*?)(?=\[(?:Section|Component):|$)/g
    );
    for (const match of sectionMatches) {
      const sectionName = match[1];
      const sectionContent = match[2];
      if (sectionName && sectionContent) {
        this.copyBank.set(sectionName.trim(), sectionContent.trim());
      }
    }

    // ---- Extract headline options ----
    const headlineMatches = response.matchAll(/Headline(?:\s*\d*)?:\s*(.+)/gi);
    const headlines: string[] = [];
    for (const match of headlineMatches) {
      if (match[1]) {
        headlines.push(match[1].trim());
      }
    }

    // ---- Extract CTA options ----
    const ctaMatches = response.matchAll(/CTA(?:\s+\w+)?:\s*(.+)/gi);
    const ctas: string[] = [];
    for (const match of ctaMatches) {
      if (match[1]) {
        ctas.push(match[1].trim());
      }
    }

    // Always create a document artifact with the full copy
    artifacts.push({
      id: nanoid(),
      tbwoId: this.tbwoId,
      name: `copy-${task.name}`,
      type: ArtifactTypeEnum.DOCUMENT,
      description: `Copy content for: ${task.name}`,
      content: response,
      createdBy: this.id,
      createdAt: Date.now(),
      version: 1,
      status: 'draft',
    });

    // If we extracted structured sections, also create a JSON data artifact
    if (this.copyBank.size > 0) {
      const copyData: Record<string, string> = {};
      for (const [key, value] of this.copyBank) {
        copyData[key] = value;
      }

      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `copy-data-${task.name}`,
        type: ArtifactTypeEnum.DATA,
        description: `Structured copy data for: ${task.name}`,
        content: JSON.stringify({ sections: copyData, headlines, ctas }, null, 2),
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    return artifacts;
  }

  // ==========================================================================
  // COPY-SPECIFIC: STATE MANAGEMENT
  // ==========================================================================

  /** Set the brand voice description that guides all copy generation. */
  setBrandVoice(voice: string): void {
    this.brandVoice = voice;
  }

  /** Get the current brand voice. */
  getBrandVoice(): string {
    return this.brandVoice;
  }

  /** Set the target audience description. */
  setTargetAudience(audience: string): void {
    this.targetAudience = audience;
  }

  /** Get copy for a specific section or component. */
  getCopyForSection(section: string): string | undefined {
    return this.copyBank.get(section);
  }

  /** Get all accumulated copy organized by section. */
  getAllCopy(): Map<string, string> {
    return new Map(this.copyBank);
  }

  /** Get the number of sections in the copy bank. */
  getCopySectionCount(): number {
    return this.copyBank.size;
  }

  /** Manually add or override a copy section. */
  setCopyForSection(section: string, content: string): void {
    this.copyBank.set(section, content);
  }

  // ==========================================================================
  // CONTEXT BUILDING OVERRIDE
  // ==========================================================================

  /**
   * Override buildTaskPrompt to inject brand voice, target audience,
   * and existing copy bank so the AI maintains consistency.
   */
  protected override buildTaskPrompt(task: Task): string {
    let prompt = super.buildTaskPrompt(task);

    if (this.brandVoice) {
      prompt += `\n\n### Brand Voice\n${this.brandVoice}`;
    }

    if (this.targetAudience) {
      prompt += `\n\n### Target Audience\n${this.targetAudience}`;
    }

    // Include existing copy bank for consistency
    if (this.copyBank.size > 0) {
      prompt += '\n\n### Existing Copy (maintain consistent voice)';
      for (const [section, content] of this.copyBank) {
        // Only include a preview to avoid bloating the prompt
        const preview = content.length > 300 ? content.slice(0, 300) + '...' : content;
        prompt += `\n\n**${section}:**\n${preview}`;
      }
    }

    return prompt;
  }
}
