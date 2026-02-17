/**
 * Tool Implementations Index
 *
 * Exports all tool implementations and provides initialization.
 */

// Web Search Tools
export { webSearchTool, newsSearchTool } from './webSearch';

// Code Execution Tools
export { codeExecutionTool, replTool } from './codeExecution';

// File Operation Tools
export {
  readFileTool,
  writeFileTool,
  listFilesTool,
  deleteFileTool,
  virtualFileSystem,
} from './fileOperations';

// ============================================================================
// ALL TOOLS ARRAY
// ============================================================================

import { webSearchTool, newsSearchTool } from './webSearch';
import { codeExecutionTool, replTool } from './codeExecution';
import { readFileTool, writeFileTool, listFilesTool, deleteFileTool } from './fileOperations';
import type { Tool } from '../types';

export const allTools: Tool[] = [
  // Web Search
  webSearchTool,
  newsSearchTool,

  // Code Execution
  codeExecutionTool,
  replTool,

  // File Operations
  readFileTool,
  writeFileTool,
  listFilesTool,
  deleteFileTool,
];

// ============================================================================
// INITIALIZATION
// ============================================================================

import { toolRegistry } from '../registry';

/**
 * Register all built-in tools with the registry
 */
export function registerAllTools(): void {
  for (const tool of allTools) {
    toolRegistry.register(tool);
  }
}

/**
 * Initialize the tool system
 */
export async function initializeTools(): Promise<void> {
  registerAllTools();

  // Perform any async initialization here
  console.log(`[Tools] Registered ${allTools.length} tools`);
}
