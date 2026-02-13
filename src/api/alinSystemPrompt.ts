/**
 * ALIN System Prompt and Tools Configuration
 *
 * This file defines what Claude knows about its capabilities within ALIN
 * and the tools it can use to interact with the system.
 */

import type { ClaudeTool } from './claudeClient';
// NOTE: getAPIService is imported dynamically to avoid circular dep (apiService ↔ alinSystemPrompt)
import { useMemoryStore } from '../store/memoryStore';
import { MemoryLayer } from '../types/memory';
import { memoryService } from '../services/memoryService';
import { useTBWOStore } from '../store/tbwoStore';
import { TBWOType, QualityTarget } from '../types/tbwo';
import { useAuthStore } from '../store/authStore';
import { useImageStore } from '../store/imageStore';

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

// DEPRECATED: System prompt is now assembled server-side by server/prompts/.
// This marker tells the server to use modular prompt assembly.
// ALIN_TOOLS, executeAlinTool, and all tool implementations below remain active.
export const ALIN_SYSTEM_PROMPT = '[DEPRECATED]';


// ============================================================================
// DIRECT MODE SYSTEM PROMPT ADDITION
// ============================================================================

// DEPRECATED: Direct mode prompt is now part of server/prompts/chatMode.js
export const DIRECT_MODE_SYSTEM_PROMPT = '';

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export const ALIN_TOOLS: ClaudeTool[] = [
  // Web Search
  {
    name: 'web_search',
    description: 'Search the internet for current information. IMPORTANT: After receiving search results, immediately use them to respond to the user. Do NOT search again unless the results were completely empty.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up',
        },
        count: {
          type: 'number',
          description: 'Number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },

  // Web Fetch — fetch any URL directly
  {
    name: 'web_fetch',
    description: 'Fetch the full contents of a web page by URL. Use this when you need to read a specific webpage, not just search. Returns the text/HTML content.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL to fetch (must start with http:// or https://)',
        },
      },
      required: ['url'],
    },
  },

  // Memory Store
  {
    name: 'memory_store',
    description: 'Store important information in long-term memory for future recall. Use for user preferences, important facts, and context that should persist.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The information to store',
        },
        category: {
          type: 'string',
          description: 'Category: "preference", "fact", "context", "procedure", or "episode"',
        },
        importance: {
          type: 'number',
          description: 'Importance level 1-10 (higher = more likely to be recalled)',
        },
        tags: {
          type: 'array',
          description: 'Tags for easier retrieval',
          items: { type: 'string' },
        },
      },
      required: ['content', 'category'],
    },
  },

  // Memory Recall
  {
    name: 'memory_recall',
    description: 'Retrieve information from long-term memory. Use to recall user preferences, past conversations, or stored facts.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in memory',
        },
        category: {
          type: 'string',
          description: 'Optional: filter by category',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },

  // Code Execution
  {
    name: 'execute_code',
    description: 'Execute code in a sandboxed environment. Supports Python and JavaScript. Code runs server-side with a 30-second timeout.',
    input_schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          description: 'Programming language: "python" or "javascript"',
        },
        code: {
          type: 'string',
          description: 'The code to execute',
        },
        timeout: {
          type: 'number',
          description: 'Execution timeout in seconds (default: 30, max: 300)',
        },
      },
      required: ['language', 'code'],
    },
  },

  // File Read
  {
    name: 'file_read',
    description: 'Read the contents of a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or relative path to the file',
        },
        encoding: {
          type: 'string',
          description: 'File encoding (default: "utf-8")',
        },
      },
      required: ['path'],
    },
  },

  // File Write
  {
    name: 'file_write',
    description: 'Write content to a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path where the file should be written',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
        append: {
          type: 'boolean',
          description: 'If true, append to existing file instead of overwriting',
        },
      },
      required: ['path', 'content'],
    },
  },

  // File List
  {
    name: 'file_list',
    description: 'List files and directories in a given path.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, list recursively',
        },
        pattern: {
          type: 'string',
          description: 'Optional glob pattern to filter files',
        },
      },
      required: ['path'],
    },
  },

  // TBWO Create
  {
    name: 'tbwo_create',
    description: 'Create a new Thinking-Based Workflow Orchestration for complex multi-step tasks. Use when a task requires multiple parallel operations or careful coordination.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the workflow',
        },
        description: {
          type: 'string',
          description: 'Description of what the workflow accomplishes',
        },
        tasks: {
          type: 'array',
          description: 'Array of task objects with name, description, and dependencies',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Task name' },
              description: { type: 'string', description: 'What the task accomplishes' },
              dependencies: { type: 'array', items: { type: 'string' }, description: 'Names of tasks this depends on' },
            },
            required: ['name', 'description'],
          },
        },
      },
      required: ['name', 'description', 'tasks'],
    },
  },

  // System Status
  {
    name: 'system_status',
    description: 'Get current system resource usage (CPU, memory). Only available on local desktop sessions.',
    input_schema: {
      type: 'object',
      properties: {
        detailed: {
          type: 'boolean',
          description: 'If true, return detailed metrics',
        },
      },
    },
  },

  // Image Generation (FLUX.2 [max])
  {
    name: 'generate_image',
    description: 'Generate a new image using FLUX.2 [max]. Supports photorealistic photos, logos with text, illustrations, product shots. Include "Search the internet" in prompt for web-grounded context. Use hex codes for precise brand colors. Never replace user-provided images — only generate when no user asset exists.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed image description. Be specific about subject, composition, lighting, style, mood. For brand colors use hex codes like #10b981. For logos include exact text to render.',
        },
        width: {
          type: 'integer',
          description: 'Image width in pixels (256-2048). Common: 1920 (hero), 1024 (general), 800 (card), 512 (icon). Default: 1024.',
        },
        height: {
          type: 'integer',
          description: 'Image height in pixels (256-2048). Common: 1080 (hero 16:9), 1024 (square), 600 (card). Default: 1024.',
        },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 10 reference image URLs for style/identity consistency across generations.',
        },
        purpose: {
          type: 'string',
          enum: ['hero', 'background', 'logo', 'product', 'portrait', 'illustration', 'icon', 'card', 'decorative', 'other'],
          description: 'Intended use of this image.',
        },
      },
      required: ['prompt'],
    },
  },

  // Scan Directory (batch read entire codebase)
  {
    name: 'scan_directory',
    description: 'Recursively scan a directory and return its file tree plus contents of all text files in ONE call. MUCH more efficient than multiple file_read calls. Use this when exploring codebases or reading multiple files. Automatically skips node_modules, .git, binary files, etc.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the directory to scan',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to scan subdirectories (default: true)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum recursion depth (default: 10)',
        },
        includeContents: {
          type: 'boolean',
          description: 'Whether to include file contents (default: true). Set false for tree-only view.',
        },
        filePatterns: {
          type: 'array',
          description: 'File patterns to include, e.g. ["*.ts", "*.tsx"]. Empty means all files.',
          items: { type: 'string' },
        },
        excludePatterns: {
          type: 'array',
          description: 'Additional directory/file names to exclude beyond defaults',
          items: { type: 'string' },
        },
      },
      required: ['path'],
    },
  },

  // Code Search (grep across files)
  {
    name: 'code_search',
    description: 'Search for text or regex patterns across all files in a directory. Like grep/ripgrep. Returns matching lines with file paths, line numbers, and context.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The text or regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (absolute path)',
        },
        regex: {
          type: 'boolean',
          description: 'Treat query as regex (default: false, uses literal match)',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)',
        },
        filePatterns: {
          type: 'array',
          description: 'File patterns to search, e.g. ["*.ts", "*.tsx"]. Empty means all text files.',
          items: { type: 'string' },
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matches to return (default: 100)',
        },
      },
      required: ['query', 'path'],
    },
  },

  // Run Command (shell/terminal)
  {
    name: 'run_command',
    description: 'Execute a shell command (npm test, npm run build, tsc, eslint, etc). Returns stdout, stderr, and exit code. Dangerous commands are blocked for safety.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        workingDirectory: {
          type: 'string',
          description: 'Working directory for the command (default: ALIN project root)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 60000, max: 60000)',
        },
      },
      required: ['command'],
    },
  },

  // Git (version control)
  {
    name: 'git',
    description: 'Execute git operations. Supports: status, diff, log, show, branch, tag, remote, blame, add, commit, checkout, stash, merge, pull, fetch. Force push, reset --hard, and clean -f are blocked for safety.',
    input_schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Git operation: status, diff, log, show, branch, add, commit, checkout, stash, merge, pull, fetch, etc.',
        },
        args: {
          type: 'array',
          description: 'Additional arguments for the git command',
          items: { type: 'string' },
        },
        repoPath: {
          type: 'string',
          description: 'Path to the git repository (default: ALIN project root)',
        },
      },
      required: ['operation'],
    },
  },

  // Edit File (surgical find-replace)
  {
    name: 'edit_file',
    description: 'Make a surgical edit to a file by finding unique text and replacing it. The old_text must be unique in the file. For creating new files, use file_write instead.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to edit',
        },
        old_text: {
          type: 'string',
          description: 'The exact text to find (must be unique in the file)',
        },
        new_text: {
          type: 'string',
          description: 'The replacement text',
        },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },

  // GPU Compute
  {
    name: 'gpu_compute',
    description: 'Run a Python script with GPU acceleration. Supports PyTorch, TensorFlow, and CUDA. Use for ML inference, training, or GPU-accelerated computation. Only available on local desktop sessions with a compatible GPU.',
    input_schema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Python script to execute on the GPU',
        },
        framework: {
          type: 'string',
          description: 'Framework: "pytorch", "tensorflow", or "python" (default: "python")',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000, max: 300000)',
        },
      },
      required: ['script'],
    },
  },

  // Webcam Capture
  {
    name: 'webcam_capture',
    description: 'Capture a frame from the webcam. Returns a base64-encoded JPEG image. Requires OpenCV (cv2) installed.',
    input_schema: {
      type: 'object',
      properties: {
        device: {
          type: 'number',
          description: 'Camera device index (default: 0)',
        },
      },
      required: [],
    },
  },

  // Blender Execute
  {
    name: 'blender_execute',
    description: 'Execute a Python script in Blender headless mode (bpy). Use for 3D modeling, scene creation, procedural generation, and asset manipulation.',
    input_schema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Python script using bpy (Blender Python API)',
        },
        blendFile: {
          type: 'string',
          description: 'Optional .blend file to load before executing the script',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
      },
      required: ['script'],
    },
  },

  // Blender Render
  {
    name: 'blender_render',
    description: 'Render a .blend file to an image. Supports Cycles and EEVEE engines, PNG/EXR/JPEG output formats.',
    input_schema: {
      type: 'object',
      properties: {
        blendFile: {
          type: 'string',
          description: 'Path to the .blend file to render',
        },
        outputPath: {
          type: 'string',
          description: 'Output file path for the rendered image',
        },
        engine: {
          type: 'string',
          description: 'Render engine: "CYCLES" or "BLENDER_EEVEE" (default: "CYCLES")',
        },
        format: {
          type: 'string',
          description: 'Output format: "PNG", "JPEG", "OPEN_EXR" (default: "PNG")',
        },
        frame: {
          type: 'number',
          description: 'Frame number to render (default: 1)',
        },
      },
      required: ['blendFile', 'outputPath'],
    },
  },
];

// ============================================================================
// TOOL EXECUTOR
// ============================================================================

export interface ToolExecutionResult {
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * Execute a tool call and return the result
 */
export async function executeAlinTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolExecutionResult> {
  console.log(`[ALIN] Executing tool: ${toolName}`, toolInput);

  try {
    switch (toolName) {
      case 'web_search':
        return await executeWebSearch(toolInput);

      case 'web_fetch':
        return await executeWebFetch(toolInput);

      case 'memory_store':
        return await executeMemoryStore(toolInput);

      case 'memory_recall':
        return await executeMemoryRecall(toolInput);

      case 'execute_code':
        return await executeCode(toolInput);

      case 'file_read':
        return await executeFileRead(toolInput);

      case 'file_write':
        return await executeFileWrite(toolInput);

      case 'file_list':
        return await executeFileList(toolInput);

      case 'tbwo_create':
        return await executeTbwoCreate(toolInput);

      case 'system_status':
        return await executeSystemStatus(toolInput);

      case 'computer':
        return await executeComputerUse(toolInput);

      case 'str_replace_editor':
        return await executeTextEditor(toolInput);

      case 'generate_image':
        return await executeGenerateImage(toolInput);

      case 'scan_directory':
        return await executeScanDirectory(toolInput);

      case 'code_search':
        return await executeCodeSearch(toolInput);

      case 'run_command':
        return await executeRunCommand(toolInput);

      case 'git':
        return await executeGit(toolInput);

      case 'edit_file':
        return await executeEditFile(toolInput);

      case 'gpu_compute':
        return await executeGpuCompute(toolInput);

      case 'webcam_capture':
        return await executeWebcamCapture(toolInput);

      case 'blender_execute':
        return await executeBlenderScript(toolInput);

      case 'blender_render':
        return await executeBlenderRender(toolInput);

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Tool execution failed',
    };
  }
}

// ============================================================================
// TOOL IMPLEMENTATIONS
// ============================================================================

async function executeWebFetch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const url = input.url as string;
  if (!url) return { success: false, error: 'URL is required' };
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, error: 'URL must start with http:// or https://' };
  }

  console.log(`[ALIN] Fetching URL: ${url}`);

  try {
    const response = await fetch('/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useAuthStore.getState().token || ''}`,
      },
      body: JSON.stringify({ toolName: 'web_fetch', toolInput: { url } }),
    });

    if (!response.ok) {
      return { success: false, error: `Fetch failed: HTTP ${response.status}` };
    }

    const data = await response.json();
    return data;
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function executeWebSearch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const query = input.query as string;
  const count = (input.count as number) || 5;

  console.log(`[ALIN] Web search for: "${query}"`);

  try {
    // Always use server proxy — API key is server-side only
    const response = await fetch('/api/search/brave', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useAuthStore.getState().token || ''}`,
      },
      body: JSON.stringify({ query, count }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ALIN] Brave search proxy error:', response.status, errText);
      return await fallbackWebSearch(query, count);
    }

    const data = await response.json();
    if (data.results && data.results.length > 0) {
      let resultText = `Search Results for "${query}":\n\n`;
      data.results.forEach((r: any, i: number) => {
        resultText += `${i + 1}. **${r.title || 'Untitled'}**\n`;
        if (r.url) resultText += `   URL: ${r.url}\n`;
        if (r.description) resultText += `   ${r.description}\n`;
        resultText += '\n';
      });
      console.log(`[ALIN] Brave search returned ${data.results.length} results`);
      return { success: true, result: resultText };
    }

    return { success: true, result: `Search for "${query}" returned no results.` };
  } catch (error: any) {
    console.error('[ALIN] Brave search failed:', error);
    return await fallbackWebSearch(query, count);
  }
}

/**
 * Fallback when web search APIs are unavailable (CORS restrictions in browser)
 * Uses AllOrigins CORS proxy for DuckDuckGo, or provides helpful context
 */
async function fallbackWebSearch(query: string, count: number): Promise<ToolExecutionResult> {
  try {
    // Try using a CORS proxy for DuckDuckGo (AllOrigins is a public CORS proxy)
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(ddgUrl)}`;

    const response = await fetch(proxyUrl);

    if (response.ok) {
      const proxyData = await response.json();
      if (proxyData.contents) {
        const data = JSON.parse(proxyData.contents);

        let resultText = `Search Results for "${query}":\n\n`;

        // Abstract (main answer)
        if (data.Abstract) {
          resultText += `**Summary:** ${data.Abstract}\n`;
          if (data.AbstractSource) {
            resultText += `Source: ${data.AbstractSource} - ${data.AbstractURL}\n\n`;
          }
        }

        // Related topics
        if (data.RelatedTopics && data.RelatedTopics.length > 0) {
          resultText += `**Related Information:**\n`;
          const topics = data.RelatedTopics.slice(0, count);
          topics.forEach((topic: any, index: number) => {
            if (topic.Text) {
              resultText += `${index + 1}. ${topic.Text}\n`;
              if (topic.FirstURL) {
                resultText += `   URL: ${topic.FirstURL}\n`;
              }
            }
          });
        }

        // Infobox data
        if (data.Infobox && data.Infobox.content) {
          resultText += `\n**Quick Facts:**\n`;
          data.Infobox.content.slice(0, 5).forEach((item: any) => {
            if (item.label && item.value) {
              resultText += `- ${item.label}: ${item.value}\n`;
            }
          });
        }

        // Check if we got useful results
        if (data.Abstract || (data.RelatedTopics && data.RelatedTopics.length > 0)) {
          return {
            success: true,
            result: resultText,
          };
        }
      }
    }
  } catch (proxyError) {
    console.log('[ALIN] Proxy search failed, using fallback:', proxyError);
  }

  // If proxy fails, return a concise message and let Claude use its knowledge
  // Don't clutter the response with configuration instructions
  return {
    success: true,
    result: `Web search unavailable for "${query}". Please provide your response based on your training knowledge (up to early 2025). If the user asks about recent events after this date, acknowledge the limitation.`,
  };
}

async function executeMemoryStore(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  console.log('[ALIN] executeMemoryStore called with:', input);

  try {

    console.log('[ALIN] Imports successful, getting store state...');
    const store = useMemoryStore.getState();

    const content = input.content as string;
    const category = (input.category as string) || 'semantic';
    const importance = (input.importance as number) || 5;
    const tags = (input.tags as string[]) || [];

    if (!content) {
      return {
        success: false,
        error: 'No content provided to store in memory.',
      };
    }

    // Map category to MemoryLayer
    const layerMap: Record<string, any> = {
      preference: MemoryLayer.SEMANTIC,
      fact: MemoryLayer.SEMANTIC,
      context: MemoryLayer.SHORT_TERM,
      procedure: MemoryLayer.PROCEDURAL,
      episode: MemoryLayer.EPISODIC,
      semantic: MemoryLayer.SEMANTIC,
    };

    const layer = layerMap[category] || MemoryLayer.SEMANTIC;
    console.log('[ALIN] Storing memory with layer:', layer);

    // Store directly to memory store (client-side, no backend needed)
    const memoryId = store.addMemory({
      layer,
      content,
      salience: importance / 10, // Convert 1-10 to 0-1
      decayRate: 0.01,
      tags: [...tags, category, 'user-stored'],
      relatedMemories: [],
    });

    // Index in memory service so semantic search can find it
    memoryService.indexMemory(memoryId, content);

    console.log('[ALIN] Memory stored and indexed with ID:', memoryId);

    return {
      success: true,
      result: `Memory stored successfully with ID: ${memoryId}. Category: ${category}, Importance: ${importance}/10. This memory is now saved locally and will persist across sessions.`,
    };
  } catch (error: any) {
    console.error('[ALIN] Memory store error:', error);
    return {
      success: false,
      error: `Failed to store memory (client-side error, not backend): ${error.message}`,
    };
  }
}

async function executeMemoryRecall(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  console.log('[ALIN] executeMemoryRecall called with:', input);

  try {

    const query = input.query as string;
    const limit = (input.limit as number) || 5;

    if (!query) {
      return {
        success: false,
        error: 'No query provided for memory recall.',
      };
    }

    // First check if there are ANY memories in the store
    const store = useMemoryStore.getState();
    const totalMemories = store.memories.size;
    console.log('[ALIN] Total memories in store:', totalMemories);

    if (totalMemories === 0) {
      return {
        success: true,
        result: `Memory system is active but empty. No memories have been stored yet. Use memory_store to save information I should remember.`,
      };
    }

    // Use semantic search from memory service (client-side, no backend needed)
    console.log('[ALIN] Searching memories for:', query);
    let results = memoryService.semanticSearch(query, {
      limit,
      minSimilarity: 0.1,
      useActivation: true,
      boostRecent: true,
    });

    console.log('[ALIN] Semantic search returned', results.length, 'results');

    // Fallback: if semantic search finds nothing, do a basic text match
    if (results.length === 0) {
      const queryLower = query.toLowerCase();
      const textMatches: Array<{ memory: any; similarity: number }> = [];
      store.memories.forEach((memory) => {
        if (memory.isArchived) return;
        const contentLower = memory.content.toLowerCase();
        const tagsLower = memory.tags.map((t: string) => t.toLowerCase()).join(' ');
        if (contentLower.includes(queryLower) || tagsLower.includes(queryLower)) {
          textMatches.push({ memory, similarity: 0.5 });
        }
      });
      if (textMatches.length > 0) {
        results = textMatches.slice(0, limit);
        console.log('[ALIN] Text fallback found', results.length, 'results');
      }
    }

    // If still nothing, return all memories as context
    if (results.length === 0 && totalMemories <= 20) {
      const allMemories: Array<{ memory: any; similarity: number }> = [];
      store.memories.forEach((memory) => {
        if (!memory.isArchived) {
          allMemories.push({ memory, similarity: 0.3 });
        }
      });
      if (allMemories.length > 0) {
        results = allMemories.slice(0, limit);
        console.log('[ALIN] Returning all', results.length, 'memories as fallback');
      }
    }

    if (results.length === 0) {
      return {
        success: true,
        result: `No memories found matching "${query}". There are ${totalMemories} memories stored, but none matched this query. Try a different search term.`,
      };
    }

    const formatted = results
      .map((r, i) => {
        const mem = r.memory;
        const similarity = Math.round(r.similarity * 100);
        const date = new Date(mem.createdAt).toLocaleDateString();
        return `${i + 1}. [${mem.layer}] (${similarity}% match, ${date})\n   ${mem.content}`;
      })
      .join('\n\n');

    return {
      success: true,
      result: `Found ${results.length} relevant memories (out of ${totalMemories} total):\n\n${formatted}`,
    };
  } catch (error: any) {
    console.error('[ALIN] Memory recall error:', error);
    return {
      success: false,
      error: `Failed to recall memory (client-side error, not backend): ${error.message}`,
    };
  }
}

async function executeCode(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const language = input.language as string;
  const code = input.code as string;
  const timeout = (input.timeout as number) || 30000;

  if (!code) {
    return { success: false, error: 'No code provided to execute.' };
  }

  if (!language) {
    return { success: false, error: 'No language specified. Use "python" or "javascript".' };
  }

  console.log(`[ALIN] Executing ${language} code via backend...`);

  try {
    const response = await fetch('/api/code/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useAuthStore.getState().token || ''}`,
      },
      body: JSON.stringify({ language, code, timeout }),
    });

    // Check for HTML response (backend not running)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return {
        success: false,
        error: 'Code execution backend not available. Make sure server.js is running.',
      };
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Code execution failed: ${response.status}`,
      };
    }

    // Format the output nicely
    let result = `**${language.toUpperCase()} Execution Result:**\n\n`;

    if (data.stdout) {
      result += `**Output:**\n\`\`\`\n${data.stdout}\n\`\`\`\n\n`;
    }

    if (data.stderr) {
      result += `**Errors/Warnings:**\n\`\`\`\n${data.stderr}\n\`\`\`\n\n`;
    }

    result += `Exit code: ${data.exitCode}`;

    return {
      success: data.exitCode === 0,
      result,
    };
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return {
        success: false,
        error: 'Cannot connect to code execution backend. Start it with: node server.js',
      };
    }
    return {
      success: false,
      error: `Code execution failed: ${error.message}`,
    };
  }
}

async function executeFileRead(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const filePath = input.path as string;

  // Security check
  if (filePath.includes('..')) {
    return {
      success: false,
      error: 'Path traversal not allowed for security reasons.',
    };
  }

  try {
    const response = await fetch('/api/files/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({ path: filePath }),
    });

    // Check if we got HTML instead of JSON (backend not running properly)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return {
        success: false,
        error: 'Backend server returned HTML instead of JSON. Make sure the ALIN backend is running on port 3002 (node server.js).',
      };
    }

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Failed to read file: ${response.status}`,
      };
    }

    return {
      success: true,
      result: `File: ${filePath}\n\n${data.content}`,
    };
  } catch (error: any) {
    // Check for JSON parse errors (likely got HTML)
    if (error.message?.includes('Unexpected token') || error.message?.includes('JSON')) {
      return {
        success: false,
        error: 'Backend server not responding correctly. Make sure ALIN backend is running: node server.js',
      };
    }
    // Backend not running
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return {
        success: false,
        error: 'Cannot connect to backend server. Start it with: node server.js',
      };
    }
    return {
      success: false,
      error: `File read failed: ${error.message}`,
    };
  }
}

async function executeFileWrite(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const filePath = input.path as string;
  const content = input.content as string;

  // Security check
  if (filePath.includes('..')) {
    return {
      success: false,
      error: 'Path traversal not allowed for security reasons.',
    };
  }

  try {
    const response = await fetch('/api/files/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({ path: filePath, content }),
    });

    // Check for HTML response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return {
        success: false,
        error: 'Backend server returned HTML. Make sure ALIN backend is running: node server.js',
      };
    }

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Failed to write file: ${response.status}`,
      };
    }

    return {
      success: true,
      result: `Successfully wrote ${data.bytesWritten} bytes to: ${filePath}`,
    };
  } catch (error: any) {
    if (error.message?.includes('Unexpected token') || error.message?.includes('JSON')) {
      return {
        success: false,
        error: 'Backend not responding correctly. Start ALIN backend: node server.js',
      };
    }
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return {
        success: false,
        error: 'Cannot connect to backend. Start it with: node server.js',
      };
    }
    return {
      success: false,
      error: `File write failed: ${error.message}`,
    };
  }
}

async function executeFileList(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const dirPath = input.path as string;

  // Security check
  if (dirPath.includes('..')) {
    return {
      success: false,
      error: 'Path traversal not allowed for security reasons.',
    };
  }

  try {
    const response = await fetch('/api/files/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({ path: dirPath }),
    });

    // Check for HTML response
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return {
        success: false,
        error: 'Backend server returned HTML. Make sure ALIN backend is running: node server.js',
      };
    }

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Failed to list directory: ${response.status}`,
      };
    }

    // Format the file list nicely
    const fileList = data.files
      .map((f: { name: string; isDirectory: boolean }) =>
        `${f.isDirectory ? '[DIR]' : '[FILE]'} ${f.name}`
      )
      .join('\n');

    return {
      success: true,
      result: `Directory: ${dirPath}\n\n${fileList}\n\nTotal: ${data.files.length} items`,
    };
  } catch (error: any) {
    if (error.message?.includes('Unexpected token') || error.message?.includes('JSON')) {
      return {
        success: false,
        error: 'Backend not responding correctly. Start ALIN backend: node server.js',
      };
    }
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return {
        success: false,
        error: 'Cannot connect to backend. Start it with: node server.js',
      };
    }
    return {
      success: false,
      error: `Directory listing failed: ${error.message}`,
    };
  }
}

async function executeTbwoCreate(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  try {

    const name = (input['name'] as string) || 'Untitled TBWO';
    const description = (input['description'] as string) || '';
    const timeBudget = (input['time_budget'] as number) || 60;

    // Determine TBWO type from name/description
    const lowerName = (name + ' ' + description).toLowerCase();
    let type: string = TBWOType.CUSTOM;
    if (lowerName.includes('website') || lowerName.includes('landing page') || lowerName.includes('web page')) {
      type = TBWOType.WEBSITE_SPRINT;
    } else if (lowerName.includes('app') || lowerName.includes('application') || lowerName.includes('code') || lowerName.includes('project')) {
      type = TBWOType.CODE_PROJECT;
    } else if (lowerName.includes('research') || lowerName.includes('report') || lowerName.includes('analysis')) {
      type = TBWOType.RESEARCH_REPORT;
    } else if (lowerName.includes('design') || lowerName.includes('ui') || lowerName.includes('ux')) {
      type = TBWOType.DESIGN_SYSTEM;
    }

    // Create TBWO via store
    const tbwoId = useTBWOStore.getState().createTBWO({
      type: type as any,
      objective: description || name,
      timeBudgetMinutes: timeBudget,
      qualityTarget: QualityTarget.STANDARD,
    });

    // Auto-generate execution plan
    await useTBWOStore.getState().generateExecutionPlan(tbwoId);

    const tbwo = useTBWOStore.getState().getTBWOById(tbwoId);
    const phaseCount = tbwo?.plan?.phases?.length || 0;

    return {
      success: true,
      result: `TBWO Work Order created successfully!\nID: ${tbwoId}\nObjective: ${description || name}\nType: ${type}\nTime Budget: ${timeBudget} min\nPhases: ${phaseCount}\n\nThe work order is now awaiting approval. The user can view it in the TBWO Dashboard (right panel in TBWO Mode) and approve the execution plan to begin.`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Failed to create workflow: ${error.message}`,
    };
  }
}

async function executeSystemStatus(_input: Record<string, unknown>): Promise<ToolExecutionResult> {
  // Browser-based metrics (limited)
  const memory = (performance as any).memory;

  const status = {
    timestamp: new Date().toISOString(),
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      onLine: navigator.onLine,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
    memory: memory ? {
      usedJSHeapSize: Math.round(memory.usedJSHeapSize / 1024 / 1024) + ' MB',
      totalJSHeapSize: Math.round(memory.totalJSHeapSize / 1024 / 1024) + ' MB',
    } : 'Not available in this browser',
  };

  return {
    success: true,
    result: `System Status:\n${JSON.stringify(status, null, 2)}`,
  };
}

// ============================================================================
// COMPUTER USE TOOL
// ============================================================================

async function executeComputerUse(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const action = input['action'] as string;

  try {
    const response = await fetch('/api/computer/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Computer use failed: ${response.statusText}`);
    }

    const result = await response.json();

    // If action was screenshot, return the base64 image data
    if (action === 'screenshot' && result.image) {
      return {
        success: true,
        result: JSON.stringify({
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: result.image },
        }),
      };
    }

    return {
      success: true,
      result: result.message || `Computer action '${action}' completed`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Computer use error: ${error.message}`,
    };
  }
}

// ============================================================================
// TEXT EDITOR TOOL
// ============================================================================

async function executeTextEditor(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const command = input['command'] as string;
  const path = input['path'] as string;

  try {
    const response = await fetch('/api/editor/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`Text editor failed: ${response.statusText}`);
    }

    const result = await response.json();
    return {
      success: true,
      result: result.content || result.message || `Editor command '${command}' on '${path}' completed`,
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Text editor error: ${error.message}`,
    };
  }
}

// ============================================================================
// IMAGE GENERATION TOOL (FLUX.2 [max])
// ============================================================================

async function executeGenerateImage(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const prompt = input['prompt'] as string;
  const width = (input['width'] as number) || 1024;
  const height = (input['height'] as number) || 1024;
  const reference_images = (input['reference_images'] as string[]) || [];
  const purpose = (input['purpose'] as string) || 'general';

  // Backward compat: if old "size" param passed (e.g. "1024x1024"), parse it
  if (input['size'] && typeof input['size'] === 'string' && !input['width']) {
    const parts = (input['size'] as string).split('x').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
      return executeGenerateImageViaBackend(prompt, parts[0], parts[1], reference_images, purpose);
    }
  }

  if (!prompt) {
    return { success: false, error: 'Image prompt is required' };
  }

  console.log(`[ALIN] Generating image: "${prompt.slice(0, 80)}..." (${width}x${height}, purpose: ${purpose})`);

  try {
    return await executeGenerateImageViaBackend(prompt, width, height, reference_images, purpose);
  } catch (outerError: any) {
    console.error('[ALIN] Image generation failed:', outerError);
    return { success: false, error: outerError.message || 'Image generation failed' };
  }
}

async function executeGenerateImageViaBackend(
  prompt: string,
  width: number,
  height: number,
  reference_images: string[],
  purpose: string
): Promise<ToolExecutionResult> {
  try {
    const response = await fetch('/api/images/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...useAuthStore.getState().getAuthHeader() },
      body: JSON.stringify({ prompt, width, height, reference_images, purpose }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error || 'Image generation failed' };
    }

    const data = await response.json();
    const imageUrl = data.url || data.image?.url;

    // Store in image gallery
    useImageStore.getState().addImage({
      url: imageUrl,
      prompt,
      revisedPrompt: '',
      model: 'flux2-max',
      size: `${width}x${height}`,
      quality: 'max',
      style: purpose,
    });

    return {
      success: true,
      result: JSON.stringify({
        url: imageUrl,
        width: data.image?.width || width,
        height: data.image?.height || height,
        provider: 'flux2-max',
        message: `Image generated successfully (${width}×${height}). The image has been added to your Image Gallery.`,
      }),
    };
  } catch (error: any) {
    return {
      success: false,
      error: `Backend image generation failed: ${error.message}`,
    };
  }
}

// ============================================================================
// SCAN DIRECTORY TOOL
// ============================================================================

async function executeScanDirectory(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const scanPath = input.path as string;

  if (!scanPath) {
    return { success: false, error: 'Path is required for scan_directory.' };
  }

  if (scanPath.includes('..')) {
    return { success: false, error: 'Path traversal not allowed for security reasons.' };
  }

  try {
    const response = await fetch('/api/files/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify(input),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'Backend server not available. Make sure server.js is running.' };
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || `Scan failed: ${response.status}` };
    }

    // Format output for AI consumption
    let result = `## Directory Scan: ${scanPath}\n\n`;
    result += `### File Tree\n\`\`\`\n${data.tree}\n\`\`\`\n\n`;
    result += `### Summary\n`;
    result += `- **Files:** ${data.summary.totalFiles}\n`;
    result += `- **Total Size:** ${Math.round(data.summary.totalSize / 1024)}KB\n`;

    if (data.summary.languages && Object.keys(data.summary.languages).length > 0) {
      result += `- **Languages:** ${Object.entries(data.summary.languages).map(([lang, count]) => `${lang}(${count})`).join(', ')}\n`;
    }

    if (data.summary.truncated) {
      result += `- **Note:** Results were truncated (file/size limit reached)\n`;
    }

    result += `\n### File Contents\n\n`;

    for (const file of data.files) {
      if (file.content && file.content !== '[file too large or total limit reached]') {
        const ext = file.path.split('.').pop() || '';
        result += `#### ${file.path} (${Math.round(file.size / 1024)}KB)\n`;
        result += `\`\`\`${ext}\n${file.content}\n\`\`\`\n\n`;
      } else {
        result += `#### ${file.path} (${Math.round(file.size / 1024)}KB) — skipped (too large)\n\n`;
      }
    }

    return { success: true, result };
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return { success: false, error: 'Cannot connect to backend. Start it with: node server.js' };
    }
    return { success: false, error: `Directory scan failed: ${error.message}` };
  }
}

// ============================================================================
// CODE SEARCH TOOL
// ============================================================================

async function executeCodeSearch(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const query = input.query as string;
  const searchPath = input.path as string;

  if (!query) {
    return { success: false, error: 'Query is required for code_search.' };
  }

  if (!searchPath) {
    return { success: false, error: 'Path is required for code_search.' };
  }

  if (searchPath.includes('..')) {
    return { success: false, error: 'Path traversal not allowed for security reasons.' };
  }

  try {
    const response = await fetch('/api/files/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify(input),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'Backend server not available. Make sure server.js is running.' };
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      return { success: false, error: data.error || `Search failed: ${response.status}` };
    }

    let result = `## Code Search: "${query}"\n\n`;
    result += `**${data.totalMatches} matches** found in **${data.filesSearched} files** searched\n\n`;

    if (data.matches.length === 0) {
      result += `No matches found.\n`;
      return { success: true, result };
    }

    // Group matches by file
    const byFile: Record<string, typeof data.matches> = {};
    for (const match of data.matches) {
      if (!byFile[match.file]) byFile[match.file] = [];
      byFile[match.file].push(match);
    }

    for (const [file, matches] of Object.entries(byFile)) {
      result += `### ${file}\n`;
      for (const match of matches as any[]) {
        result += `- **Line ${match.line}:** \`${match.text}\`\n`;
      }
      result += '\n';
    }

    return { success: true, result };
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return { success: false, error: 'Cannot connect to backend. Start it with: node server.js' };
    }
    return { success: false, error: `Code search failed: ${error.message}` };
  }
}

// ============================================================================
// RUN COMMAND TOOL
// ============================================================================

async function executeRunCommand(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const command = input.command as string;

  if (!command) {
    return { success: false, error: 'Command is required for run_command.' };
  }

  try {
    const response = await fetch('/api/command/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify(input),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'Backend server not available. Make sure server.js is running.' };
    }

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || `Command failed: ${response.status}` };
    }

    let result = `## Command: \`${command}\`\n\n`;
    result += `**Exit code:** ${data.exitCode} | **Duration:** ${data.duration}ms\n\n`;

    if (data.stdout) {
      result += `### Output\n\`\`\`\n${data.stdout}\n\`\`\`\n\n`;
    }

    if (data.stderr) {
      result += `### Stderr\n\`\`\`\n${data.stderr}\n\`\`\`\n\n`;
    }

    return { success: data.exitCode === 0, result };
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return { success: false, error: 'Cannot connect to backend. Start it with: node server.js' };
    }
    return { success: false, error: `Command execution failed: ${error.message}` };
  }
}

// ============================================================================
// GIT TOOL
// ============================================================================

async function executeGit(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const operation = input.operation as string;

  if (!operation) {
    return { success: false, error: 'Operation is required for git.' };
  }

  try {
    const response = await fetch('/api/git/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify(input),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'Backend server not available. Make sure server.js is running.' };
    }

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || `Git operation failed: ${response.status}` };
    }

    let result = `## Git: ${operation}${input.args ? ' ' + (input.args as string[]).join(' ') : ''}\n\n`;

    if (data.stdout) {
      result += `\`\`\`\n${data.stdout}\n\`\`\`\n\n`;
    }

    if (data.stderr) {
      result += `**Stderr:**\n\`\`\`\n${data.stderr}\n\`\`\`\n\n`;
    }

    result += `**Exit code:** ${data.exitCode}\n`;

    return { success: data.exitCode === 0, result };
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return { success: false, error: 'Cannot connect to backend. Start it with: node server.js' };
    }
    return { success: false, error: `Git operation failed: ${error.message}` };
  }
}

// ============================================================================
// EDIT FILE TOOL
// ============================================================================

async function executeEditFile(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const filePath = input.path as string;
  const oldText = input.old_text as string;
  const newText = input.new_text as string;

  if (!filePath) {
    return { success: false, error: 'Path is required for edit_file.' };
  }

  if (!oldText) {
    return { success: false, error: 'old_text is required for edit_file.' };
  }

  if (filePath.includes('..')) {
    return { success: false, error: 'Path traversal not allowed for security reasons.' };
  }

  try {
    const response = await fetch('/api/editor/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({
        command: 'str_replace',
        path: filePath,
        old_str: oldText,
        new_str: newText ?? '',
      }),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'Backend server not available. Make sure server.js is running.' };
    }

    const data = await response.json();

    if (!data.success) {
      return { success: false, error: data.error || 'Edit failed' };
    }

    return {
      success: true,
      result: `Successfully edited ${filePath}: replaced text.`,
    };
  } catch (error: any) {
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      return { success: false, error: 'Cannot connect to backend. Start it with: node server.js' };
    }
    return { success: false, error: `File edit failed: ${error.message}` };
  }
}

async function executeGpuCompute(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const script = input.script as string;
  if (!script) return { success: false, error: 'Script is required for gpu_compute.' };

  try {
    const response = await fetch('/api/hardware/gpu-compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({
        script,
        framework: input.framework || 'python',
        timeout: input.timeout || 120000,
      }),
    });
    const data = await response.json();
    if (!data.success) return { success: false, error: data.error || 'GPU compute failed' };
    return { success: true, result: data.stdout || 'GPU compute completed (no output)' };
  } catch (error: any) {
    return { success: false, error: `GPU compute error: ${error.message}` };
  }
}

async function executeWebcamCapture(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  try {
    const response = await fetch('/api/hardware/webcam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({ device: input.device || 0 }),
    });
    const data = await response.json();
    if (!data.success) return { success: false, error: data.error || 'Webcam capture failed' };
    return { success: true, result: `Webcam frame captured (${data.width}x${data.height}). Base64 image data available.` };
  } catch (error: any) {
    return { success: false, error: `Webcam error: ${error.message}` };
  }
}

async function executeBlenderScript(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const script = input['script'] as string;
  if (!script) return { success: false, error: 'Script is required for blender_execute.' };

  try {
    const response = await fetch('/api/blender/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({
        script,
        blendFile: input['blendFile'],
        autoRender: input['autoRender'] !== false,
        outputFormat: input['format'] || 'PNG',
        timeout: input['timeout'] || 120000,
      }),
    });

    // Handle non-JSON responses (server down, proxy error)
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'BACKEND_DOWN: ALIN backend server is not running. Cannot execute Blender scripts. Start the server with: node server.js' };
    }

    const data = await response.json();

    if (!data.success) {
      // Make error absolutely explicit — prevent hallucination
      const errorMsg = data.error || 'Unknown Blender error';
      if (errorMsg.includes('BLENDER_NOT_FOUND')) {
        return { success: false, error: 'BLENDER NOT INSTALLED: Blender was not found on this system. NO files were created. NO renders were produced. The user needs to install Blender from https://www.blender.org/download/ and either add it to PATH or set BLENDER_PATH environment variable. Do NOT tell the user any files were created — nothing was rendered or saved.' };
      }
      return { success: false, error: `BLENDER FAILED: ${errorMsg}. NO files were created or rendered. Do NOT claim any output files exist.` };
    }

    // Build explicit result with actual file information
    const parts: string[] = [];
    parts.push('Blender script executed successfully.');
    if (data.duration) parts.push(`Duration: ${data.duration}ms`);
    if (data.info) {
      parts.push(`Scene: ${data.info.objects || 0} objects, ${data.info.meshes || 0} meshes, ${data.info.materials || 0} materials`);
      parts.push(`Did render: ${data.info.did_render ? 'YES' : 'NO'}`);
    }
    if (data.rendered && data.outputPath) {
      parts.push(`RENDER FILE SAVED: ${data.outputPath}`);
      if (data.renderImage) parts.push(`Render image available (base64, ${Math.round(data.renderImage.length * 0.75 / 1024)} KB)`);
    } else if (data.info?.did_render === false) {
      parts.push('NOTE: Script ran but NO render was produced. No output image file exists on disk.');
    }
    if (data.output && (data.output.includes('Error') || data.output.includes('ALIN_USER_SCRIPT_ERROR'))) {
      parts.push(`WARNINGS IN OUTPUT: ${data.output.slice(0, 2000)}`);
    }

    return { success: true, result: parts.join('\n') };
  } catch (error: any) {
    return { success: false, error: `BLENDER CONNECTION ERROR: ${error.message}. No files were created. Is the backend server running?` };
  }
}

async function executeBlenderRender(input: Record<string, unknown>): Promise<ToolExecutionResult> {
  const blendFile = input['blendFile'] as string;
  const outputPath = input['outputPath'] as string;
  if (!blendFile) return { success: false, error: 'blendFile is required.' };
  if (!outputPath) return { success: false, error: 'outputPath is required.' };

  try {
    const response = await fetch('/api/blender/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${useAuthStore.getState().token || ''}` },
      body: JSON.stringify({
        blendFile,
        outputPath,
        engine: input['engine'] || 'CYCLES',
        format: input['format'] || 'PNG',
        frame: input['frame'] || 1,
      }),
    });

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/html')) {
      return { success: false, error: 'BACKEND_DOWN: ALIN backend server is not running. Cannot render. Start the server with: node server.js' };
    }

    const data = await response.json();

    if (!data.success) {
      const errorMsg = data.error || 'Unknown render error';
      if (errorMsg.includes('BLENDER_NOT_FOUND')) {
        return { success: false, error: 'BLENDER NOT INSTALLED: Blender was not found on this system. NO render was produced. NO files exist. The user needs to install Blender.' };
      }
      return { success: false, error: `RENDER FAILED: ${errorMsg}. NO output file was created.` };
    }

    if (data.rendered && data.outputPath) {
      return { success: true, result: `Render complete. File saved: ${data.outputPath} (${data.duration}ms, format: ${data.renderFormat})` };
    } else {
      return { success: false, error: `Blender ran but NO output file was produced. The render may have failed silently. Output: ${(data.output || '').slice(0, 1000)}` };
    }
  } catch (error: any) {
    return { success: false, error: `BLENDER CONNECTION ERROR: ${error.message}. No render was produced.` };
  }
}
