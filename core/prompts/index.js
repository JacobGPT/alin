/**
 * ALIN Server Prompts — Central Re-exports
 *
 * Import everything from here:
 *   import { assemblePrompt, detectMode } from './server/prompts/index.js';
 */

export { assemblePrompt, getAvailableModes } from './assembler.js';
export { detectMode } from './modeDetector.js';
export { getBasePrompt } from './base.js';
export { getChatModePrompt } from './chatMode.js';
export { getWebsiteModePrompt } from './websiteMode.js';
export { getCodingModePrompt } from './codingMode.js';
export { getResearchModePrompt } from './researchMode.js';
export { getImageModePrompt } from './imageMode.js';
export { getVoiceModePrompt } from './voiceMode.js';
