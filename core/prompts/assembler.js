/**
 * ALIN Prompt Assembler
 *
 * Assembles the final system prompt from base + mode prompts.
 * Entry point for server-side prompt construction.
 */

import { getBasePrompt } from './base.js';
import { getChatModePrompt } from './chatMode.js';
import { getWebsiteModePrompt } from './websiteMode.js';
import { getCodingModePrompt } from './codingMode.js';
import { getResearchModePrompt } from './researchMode.js';
import { getImageModePrompt } from './imageMode.js';
import { getVoiceModePrompt } from './voiceMode.js';

// Mode name mapping: frontend mode names → prompt module names
const MODE_MAP = {
  regular: 'chat',
  tbwo: 'website',
  chat: 'chat',
  website: 'website',
  coding: 'coding',
  research: 'research',
  image: 'image',
  voice: 'voice',
};

// Mode prompt getters
const MODE_PROMPTS = {
  chat: getChatModePrompt,
  website: getWebsiteModePrompt,
  coding: getCodingModePrompt,
  research: getResearchModePrompt,
  image: getImageModePrompt,
  voice: getVoiceModePrompt,
};

/**
 * Assemble the full system prompt for a given mode.
 *
 * @param {string} mode - The mode name (supports both frontend and prompt names)
 * @param {{ additionalContext?: string, consequenceGuidance?: string, date?: string }} [options]
 * @returns {string}
 */
export function assemblePrompt(mode, options = {}) {
  const { additionalContext = '', consequenceGuidance = '', date } = options;

  // Resolve mode name
  const resolvedMode = MODE_MAP[mode] || 'chat';

  // Get base prompt
  const base = getBasePrompt({ date });

  // Get mode-specific prompt
  const getModePrompt = MODE_PROMPTS[resolvedMode];
  const modePrompt = getModePrompt ? getModePrompt() : getChatModePrompt();

  // Assemble: base + consequence guidance + mode + additional context
  let prompt = base;

  if (consequenceGuidance) {
    prompt += '\n' + consequenceGuidance;
  }

  prompt += '\n' + modePrompt;

  if (additionalContext) {
    prompt += '\n' + additionalContext;
  }

  return prompt;
}

/**
 * Get the list of available modes.
 *
 * @returns {Array<{ id: string, promptName: string }>}
 */
export function getAvailableModes() {
  return Object.entries(MODE_MAP).map(([id, promptName]) => ({ id, promptName }));
}
