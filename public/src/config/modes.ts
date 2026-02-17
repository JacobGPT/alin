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

export type ALINMode = 'regular' | 'coding' | 'image' | 'tbwo' | 'research' | 'voice';

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
    useServerSideToolLoop?: boolean;
  };
}

// ============================================================================
// MODE CONFIGURATIONS
// Prompt content now served by server/prompts/. systemPromptAddition kept empty for backward compat.
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
    description: 'Autonomous code editing with file browser and text editor',
    icon: 'CodeBracket',
    color: 'text-green-400',
    enabledTools: ['str_replace_editor'],
    systemPromptAddition: '', // Prompt now served by server/prompts/codingMode.js
    rightPanelContent: RightPanelContent.FILE_BROWSER,
    features: {
      autoEnableTextEditor: true,
      showFileTree: true,
      useServerSideToolLoop: true,
    },
  },

  image: {
    id: 'image',
    name: 'Image',
    description: 'Image generation and manipulation',
    icon: 'Photo',
    color: 'text-purple-400',
    enabledTools: ['generate_image'],
    systemPromptAddition: '', // Prompt now served by server/prompts/imageMode.js
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
    systemPromptAddition: '', // Prompt now served by server/prompts/websiteMode.js
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
    systemPromptAddition: '', // Prompt now served by server/prompts/researchMode.js
    rightPanelContent: RightPanelContent.SOURCE_TRACKER,
    features: {
      emphasizeWebSearch: true,
      showSourceTracker: true,
    },
  },

  voice: {
    id: 'voice',
    name: 'Voice',
    description: 'Voice conversation with spoken responses',
    icon: 'Microphone',
    color: 'text-rose-400',
    enabledTools: ['change_voice'],
    systemPromptAddition: '', // Prompt now served by server/prompts/voiceMode.js
    rightPanelContent: RightPanelContent.NONE,
    features: {},
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
