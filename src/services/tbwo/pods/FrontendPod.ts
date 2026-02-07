/**
 * FrontendPod - Frontend development specialist for TBWO execution
 *
 * Responsible for implementing web interfaces: HTML, CSS, JavaScript/TypeScript,
 * component architectures, responsive layouts, and integration of design tokens
 * and animation specs from sibling pods. Tracks all created files and can inject
 * design context into task prompts.
 */

import { BasePod } from './BasePod';
import type { Task, Artifact, ArtifactType } from '../../../types/tbwo';
import { ArtifactType as ArtifactTypeEnum } from '../../../types/tbwo';
import { nanoid } from 'nanoid';
import { FRONTEND_SYSTEM_PROMPT } from '../prompts/frontend';

// ============================================================================
// FRONTEND POD
// ============================================================================

export class FrontendPod extends BasePod {
  /** Target framework: 'static', 'react', 'vue', 'svelte', etc. */
  private framework: string = 'static';

  /** Design tokens CSS received from the DesignPod. */
  private designTokens: string = '';

  /** Copy content received from the CopyPod, keyed by section name. */
  private copyContent: Map<string, string> = new Map();

  /** Animation CSS received from the MotionPod. */
  private animationCSS: string = '';

  /** Running list of all files created by this pod. */
  private createdFiles: string[] = [];

  // ==========================================================================
  // ABSTRACT METHOD IMPLEMENTATIONS
  // ==========================================================================

  getSystemPrompt(): string {
    return FRONTEND_SYSTEM_PROMPT;
  }

  getSpecializedTools(): any[] {
    return [
      {
        name: 'file_write',
        description: 'Create or update a file in the project',
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
        description: 'Read an existing file to reference or modify',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to read' },
          },
          required: ['path'],
        },
      },
      {
        name: 'execute_code',
        description: 'Execute code for testing, validation, or build steps',
        input_schema: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              enum: ['javascript', 'typescript'],
              description: 'Programming language',
            },
            code: { type: 'string', description: 'Code to execute' },
          },
          required: ['language', 'code'],
        },
      },
      {
        name: 'file_list',
        description: 'List the contents of a directory to understand project structure',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list' },
          },
          required: ['path'],
        },
      },
      {
        name: 'edit_file',
        description: 'Make a targeted edit to an existing file using string replacement',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to edit' },
            old_text: { type: 'string', description: 'Existing text to find' },
            new_text: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
      {
        name: 'scan_directory',
        description: 'Scan a directory tree to understand file structure and dependencies',
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

    // ---- Extract code blocks with file paths ----
    // Pattern: ```lang\n// File: path/to/file\n...code...```
    const fileBlockRegex = /```(?:html|css|javascript|typescript|jsx|tsx|json)?\s*\n\/\/\s*(?:File|Path):\s*(.+)\n([\s\S]*?)```/gi;
    let match;
    while ((match = fileBlockRegex.exec(response)) !== null) {
      if (!match[1] || !match[2]) continue;
      const filePath = match[1].trim();
      const content = match[2].trim();

      // Track the file
      if (!this.createdFiles.includes(filePath)) {
        this.createdFiles.push(filePath);
      }

      // Determine artifact type from file extension
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      let type: ArtifactType;
      if (['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'json'].includes(ext)) {
        type = ArtifactTypeEnum.CODE;
      } else {
        type = ArtifactTypeEnum.FILE;
      }

      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: filePath.split('/').pop() || filePath,
        type,
        description: `Frontend code: ${filePath}`,
        content,
        path: filePath,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    // ---- Extract standalone code blocks without file paths ----
    // Only if no file-path blocks were found
    if (artifacts.length === 0) {
      const codeBlockRegex = /```(html|css|javascript|typescript|jsx|tsx)\n([\s\S]*?)```/gi;
      const codeBlocks: Array<{ lang: string; content: string }> = [];
      let codeMatch;
      while ((codeMatch = codeBlockRegex.exec(response)) !== null) {
        if (!codeMatch[1] || !codeMatch[2]) continue;
        codeBlocks.push({
          lang: codeMatch[1].toLowerCase(),
          content: codeMatch[2].trim(),
        });
      }

      // Group by language and create artifacts
      for (const block of codeBlocks) {
        const ext = block.lang === 'javascript' ? 'js'
          : block.lang === 'typescript' ? 'ts'
          : block.lang;

        artifacts.push({
          id: nanoid(),
          tbwoId: this.tbwoId,
          name: `${task.name.replace(/\s+/g, '-').toLowerCase()}.${ext}`,
          type: ArtifactTypeEnum.CODE,
          description: `Frontend ${block.lang} for: ${task.name}`,
          content: block.content,
          createdBy: this.id,
          createdAt: Date.now(),
          version: 1,
          status: 'draft',
        });
      }
    }

    // ---- Fallback: if response contains HTML/code but nothing was extracted ----
    if (artifacts.length === 0 && (response.includes('```') || response.includes('<html'))) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `frontend-${task.name}`,
        type: ArtifactTypeEnum.CODE,
        description: `Frontend implementation for: ${task.name}`,
        content: response,
        createdBy: this.id,
        createdAt: Date.now(),
        version: 1,
        status: 'draft',
      });
    }

    // ---- Always produce a document artifact for the full response if substantial ----
    if (response.length > 200 && artifacts.every(a => a.type !== ArtifactTypeEnum.DOCUMENT)) {
      artifacts.push({
        id: nanoid(),
        tbwoId: this.tbwoId,
        name: `frontend-spec-${task.name}`,
        type: ArtifactTypeEnum.DOCUMENT,
        description: `Frontend implementation notes for: ${task.name}`,
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
  // FRONTEND-SPECIFIC: STATE MANAGEMENT
  // ==========================================================================

  /** Set the target framework (e.g. 'static', 'react', 'vue'). */
  setFramework(framework: string): void {
    this.framework = framework;
  }

  /** Get the current target framework. */
  getFramework(): string {
    return this.framework;
  }

  /** Set design tokens CSS received from the DesignPod. */
  setDesignTokens(tokens: string): void {
    this.designTokens = tokens;
  }

  /** Set animation CSS received from the MotionPod. */
  setAnimationCSS(css: string): void {
    this.animationCSS = css;
  }

  /** Set copy content for a section, received from the CopyPod. */
  setCopyContent(section: string, content: string): void {
    this.copyContent.set(section, content);
  }

  /** Set multiple copy sections at once. */
  setCopyContentBatch(copyMap: Map<string, string>): void {
    for (const [section, content] of copyMap) {
      this.copyContent.set(section, content);
    }
  }

  /** Get the list of all files created by this pod. */
  getCreatedFiles(): string[] {
    return [...this.createdFiles];
  }

  /** Get the count of created files. */
  getCreatedFileCount(): number {
    return this.createdFiles.length;
  }

  // ==========================================================================
  // CONTEXT BUILDING OVERRIDE
  // ==========================================================================

  /**
   * Override buildTaskPrompt to inject framework, design tokens, copy content,
   * animation CSS, and the list of already-created files.
   */
  protected override buildTaskPrompt(task: Task): string {
    let prompt = super.buildTaskPrompt(task);

    prompt += `\n\n### Framework: ${this.framework}`;

    if (this.designTokens) {
      prompt += `\n\n### Design Tokens (from Design Pod)\n\`\`\`css\n${this.designTokens}\n\`\`\``;
    }

    if (this.animationCSS) {
      prompt += `\n\n### Animation CSS (from Motion Pod)\n\`\`\`css\n${this.animationCSS}\n\`\`\``;
    }

    if (this.copyContent.size > 0) {
      prompt += '\n\n### Copy Content (from Copy Pod)';
      for (const [section, content] of this.copyContent) {
        const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
        prompt += `\n\n**[${section}]:**\n${preview}`;
      }
    }

    if (this.createdFiles.length > 0) {
      prompt += `\n\n### Files Already Created\n${this.createdFiles.map(f => `- ${f}`).join('\n')}`;
    }

    return prompt;
  }
}
