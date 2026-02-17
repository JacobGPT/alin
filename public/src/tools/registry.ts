/**
 * Tool Registry - Central Tool Management
 *
 * Manages registration, discovery, and access to all available tools.
 * Provides formatted tool definitions for different AI providers.
 */

import type {
  Tool,
  ToolCategory,
  ToolDefinition,
  ToolRegistry as IToolRegistry,
  ToolInputSchema,
} from './types';

// ============================================================================
// TOOL REGISTRY IMPLEMENTATION
// ============================================================================

class ToolRegistryImpl implements IToolRegistry {
  tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" already registered, overwriting...`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getByCategory(category: ToolCategory): Tool[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object' as const,
        properties: tool.inputSchema.properties,
        required: tool.inputSchema.required,
      },
    }));
  }

  getClaudeTools(): Array<{
    name: string;
    description: string;
    input_schema: ToolInputSchema;
  }> {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  getOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: ToolInputSchema;
    };
  }> {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Get tools filtered for a specific execution context
   */
  getToolsForContext(options: {
    categories?: ToolCategory[];
    maxRiskLevel?: Tool['riskLevel'];
    requiresApproval?: boolean;
  }): Tool[] {
    const riskLevels: Tool['riskLevel'][] = ['safe', 'low', 'medium', 'high', 'critical'];
    const maxRiskIndex = options.maxRiskLevel
      ? riskLevels.indexOf(options.maxRiskLevel)
      : riskLevels.length - 1;

    return Array.from(this.tools.values()).filter((tool) => {
      // Filter by category
      if (options.categories && !options.categories.includes(tool.category)) {
        return false;
      }

      // Filter by risk level
      const toolRiskIndex = riskLevels.indexOf(tool.riskLevel);
      if (toolRiskIndex > maxRiskIndex) {
        return false;
      }

      // Filter by approval requirement
      if (options.requiresApproval !== undefined) {
        if (tool.requiresApproval !== options.requiresApproval) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const toolRegistry = new ToolRegistryImpl();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Register a tool with the global registry
 */
export function registerTool(tool: Tool): void {
  toolRegistry.register(tool);
}

/**
 * Get a tool from the global registry
 */
export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

/**
 * Get all Claude-formatted tool definitions
 */
export function getClaudeTools(): ReturnType<typeof toolRegistry.getClaudeTools> {
  return toolRegistry.getClaudeTools();
}

/**
 * Get all OpenAI-formatted tool definitions
 */
export function getOpenAITools(): ReturnType<typeof toolRegistry.getOpenAITools> {
  return toolRegistry.getOpenAITools();
}
