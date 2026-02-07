/**
 * ALIN Mode Configurations
 *
 * Defines the available ALIN modes and their settings.
 * Each mode customizes: tools, system prompt additions, UI panels.
 */

import { RightPanelContent } from '../types/ui';

// ============================================================================
// MODE TYPES
// ============================================================================

export type ALINMode = 'regular' | 'coding' | 'image' | 'tbwo' | 'research';

export interface ModeConfig {
  id: ALINMode;
  name: string;
  description: string;
  icon: string; // heroicon name reference
  color: string; // accent color class
  enabledTools: string[]; // additional tool names to enable
  disabledTools?: string[]; // tools to disable in this mode
  systemPromptAddition: string;
  rightPanelContent: RightPanelContent;
  features: {
    autoEnableTextEditor?: boolean;
    autoEnableComputerUse?: boolean;
    emphasizeWebSearch?: boolean;
    showFileTree?: boolean;
    showImageGallery?: boolean;
    showProgressTracker?: boolean;
    showSourceTracker?: boolean;
  };
}

// ============================================================================
// MODE CONFIGURATIONS
// ============================================================================

export const MODE_CONFIGS: Record<ALINMode, ModeConfig> = {
  regular: {
    id: 'regular',
    name: 'Regular',
    description: 'Standard chat mode with all tools available',
    icon: 'ChatBubbleLeftRight',
    color: 'text-brand-primary',
    enabledTools: [],
    systemPromptAddition: '',
    rightPanelContent: RightPanelContent.NONE,
    features: {},
  },

  coding: {
    id: 'coding',
    name: 'Coding',
    description: 'Code editing with file browser and text editor',
    icon: 'CodeBracket',
    color: 'text-green-400',
    enabledTools: ['str_replace_editor'],
    systemPromptAddition: `
## Coding Mode Active
You are in coding mode. Focus on:
- Writing clean, well-structured code
- Using the text editor tool for file modifications (str_replace_editor)
- Reading files before editing to understand context
- Using file_list to explore project structure
- Suggesting best practices and patterns
- Running code when appropriate to verify changes
When editing files, prefer str_replace_editor over file_write for precision edits.`,
    rightPanelContent: RightPanelContent.FILE_BROWSER,
    features: {
      autoEnableTextEditor: true,
      showFileTree: true,
    },
  },

  image: {
    id: 'image',
    name: 'Image',
    description: 'Image generation and manipulation',
    icon: 'Photo',
    color: 'text-purple-400',
    enabledTools: ['generate_image'],
    systemPromptAddition: `
## Image Generation Mode Active
You are in image generation mode. You have access to DALL-E 3 image generation via the generate_image tool. Focus on:
- Use generate_image tool to create images from user descriptions
- Create detailed, vivid prompts that include style, composition, colors, and subject matter
- Offer size options: 1024x1024 (square), 1792x1024 (landscape), 1024x1792 (portrait)
- Offer quality options: "standard" or "hd" (more detailed)
- Offer style options: "vivid" (hyper-real/dramatic) or "natural" (realistic)
- Iterate on image concepts based on user feedback
- When the user asks for an image, ALWAYS use the generate_image tool - don't just describe it
- Generated images appear in the Image Gallery panel on the right`,
    rightPanelContent: RightPanelContent.IMAGE_GALLERY,
    features: {
      showImageGallery: true,
    },
  },

  tbwo: {
    id: 'tbwo',
    name: 'TBWO',
    description: 'Time-Budget Workflow Orchestration',
    icon: 'Clock',
    color: 'text-amber-400',
    enabledTools: ['tbwo_create'],
    systemPromptAddition: `
## TBWO Mode Active
You are in Time-Budget Workflow Orchestration mode. Focus on:
- Breaking complex tasks into structured phases and pods
- Setting realistic time budgets for each phase
- Creating comprehensive project plans with checkpoints
- Tracking progress and adjusting timelines
- Producing quality-tiered deliverables (draft, standard, premium, apple_level)
Use the tbwo_create tool to initialize new TBWO projects.`,
    rightPanelContent: RightPanelContent.TBWO,
    features: {
      showProgressTracker: true,
    },
  },

  research: {
    id: 'research',
    name: 'Research',
    description: 'Deep research with source tracking',
    icon: 'MagnifyingGlass',
    color: 'text-blue-400',
    enabledTools: ['web_search'],
    systemPromptAddition: `
## Research Mode Active
You are in research mode. Focus on:
- Conducting thorough web searches for comprehensive information
- Citing sources with URLs for every factual claim
- Cross-referencing multiple sources for accuracy
- Organizing findings into clear, structured summaries
- Identifying knowledge gaps and suggesting further research
- Using memory_store to save important findings for later recall
Always include source URLs when presenting research findings.`,
    rightPanelContent: RightPanelContent.SOURCE_TRACKER,
    features: {
      emphasizeWebSearch: true,
      showSourceTracker: true,
    },
  },
};

// ============================================================================
// HELPERS
// ============================================================================

export function getModeConfig(mode: ALINMode): ModeConfig {
  return MODE_CONFIGS[mode] || MODE_CONFIGS.regular;
}

export function getAllModes(): ModeConfig[] {
  return Object.values(MODE_CONFIGS);
}
