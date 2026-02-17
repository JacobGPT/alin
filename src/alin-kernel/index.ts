/**
 * ALIN Kernel — Infrastructure & Capability Adapters
 *
 * The kernel contains ONLY:
 * - Storage adapters (raw DB access)
 * - LLM client adapters
 * - Transport primitives
 * - Context window management (mechanical token budgeting)
 * - File sandbox
 * - Search adapters
 *
 * The kernel NEVER contains:
 * - Zustand stores (those live in executive/surface)
 * - Decision logic (that lives in executive)
 * - React components (those live in surface)
 */

// Storage adapter (raw DB access — user-data meaning lives in executive/memory)
export * as dbService from '../api/dbService';

// LLM client adapters
export { CLAUDE_PRICING } from '../api/claudeClient';
export type { ClaudeConfig, ClaudeStreamChunk, ClaudeResponse, ClaudeTool, ClaudeToolDefinition, ToolResult, StreamCallbacks } from '../api/claudeClient';
export { createOpenAIClient } from '../api/openaiClient';
export type { OpenAIConfig, OpenAIStreamChunk, OpenAIResponse, OpenAITool } from '../api/openaiClient';

// Transport primitives
export { streamFromServer } from '../api/serverStreamClient';
export type { ServerStreamCallbacks, ServerStreamParams, ServerStreamResult } from '../api/serverStreamClient';

// Context window management (mechanical token budgeting, NOT decision logic)
export { compressToolResultContent, prepareMessages } from '../api/contextManager';
