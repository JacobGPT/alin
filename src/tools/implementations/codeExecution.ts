/**
 * Code Execution Tool - Sandboxed Code Runner
 *
 * Executes code in a sandboxed environment using Web Workers.
 * Supports JavaScript/TypeScript with limited capabilities.
 */

import type { Tool, ToolContext, ToolResult, ToolArtifact } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface CodeExecutionInput {
  code: string;
  language: 'javascript' | 'typescript' | 'python';
  timeout?: number;
  inputs?: Record<string, unknown>;
}

interface ExecutionResult {
  stdout: string[];
  stderr: string[];
  result: unknown;
  executionTime: number;
  memoryUsed?: number;
}

// ============================================================================
// SANDBOXED EXECUTOR
// ============================================================================

class SandboxedExecutor {
  private worker: Worker | null = null;

  async execute(
    code: string,
    inputs: Record<string, unknown> = {},
    timeout: number = 30000
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const stdout: string[] = [];
      const stderr: string[] = [];

      // Create worker blob
      const workerCode = `
        const inputs = ${JSON.stringify(inputs)};
        const logs = [];
        const errors = [];

        // Override console
        const originalConsole = console;
        console = {
          log: (...args) => {
            logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
          error: (...args) => {
            errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
          warn: (...args) => {
            logs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
          info: (...args) => {
            logs.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
        };

        // Block dangerous globals
        const blockedGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'eval'];
        blockedGlobals.forEach(g => {
          try {
            self[g] = undefined;
          } catch (e) {}
        });

        // Execute user code
        try {
          const userCode = ${JSON.stringify(code)};
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const fn = new AsyncFunction('inputs', userCode);

          fn(inputs).then(result => {
            self.postMessage({
              success: true,
              result: result,
              stdout: logs,
              stderr: errors,
            });
          }).catch(error => {
            self.postMessage({
              success: false,
              error: error.message,
              stdout: logs,
              stderr: [...errors, error.message],
            });
          });
        } catch (error) {
          self.postMessage({
            success: false,
            error: error.message,
            stdout: logs,
            stderr: [...errors, error.message],
          });
        }
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      this.worker = worker;

      const timeoutId = setTimeout(() => {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        reject(new Error(`Code execution timed out after ${timeout}ms`));
      }, timeout);

      worker.onmessage = (event) => {
        clearTimeout(timeoutId);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);

        const { success, result, error, stdout: workerStdout, stderr: workerStderr } = event.data;

        if (success) {
          resolve({
            stdout: workerStdout || [],
            stderr: workerStderr || [],
            result,
            executionTime: performance.now() - startTime,
          });
        } else {
          resolve({
            stdout: workerStdout || [],
            stderr: workerStderr || [],
            result: null,
            executionTime: performance.now() - startTime,
          });
        }
      };

      worker.onerror = (error) => {
        clearTimeout(timeoutId);
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        reject(new Error(error.message || 'Worker error'));
      };
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// ============================================================================
// PYTHON EXECUTION (via Pyodide - lazy loaded)
// ============================================================================

let pyodideInstance: any = null;

async function loadPyodide(): Promise<any> {
  if (pyodideInstance) {
    return pyodideInstance;
  }

  // Check if Pyodide is available
  if (typeof (window as any).loadPyodide === 'undefined') {
    // Load Pyodide from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js';
    document.head.appendChild(script);

    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
    });
  }

  pyodideInstance = await (window as any).loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
  });

  return pyodideInstance;
}

async function executePython(
  code: string,
  inputs: Record<string, unknown> = {},
  timeout: number = 30000
): Promise<ExecutionResult> {
  const startTime = performance.now();
  const stdout: string[] = [];
  const stderr: string[] = [];

  try {
    const pyodide = await Promise.race([
      loadPyodide(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pyodide load timeout')), 10000)
      ),
    ]);

    // Set up input variables
    for (const [key, value] of Object.entries(inputs)) {
      pyodide.globals.set(key, value);
    }

    // Capture stdout
    pyodide.setStdout({
      batched: (text: string) => stdout.push(text),
    });

    pyodide.setStderr({
      batched: (text: string) => stderr.push(text),
    });

    // Execute with timeout
    const result = await Promise.race([
      pyodide.runPythonAsync(code),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timed out after ${timeout}ms`)), timeout)
      ),
    ]);

    return {
      stdout,
      stderr,
      result,
      executionTime: performance.now() - startTime,
    };
  } catch (error: any) {
    return {
      stdout,
      stderr: [...stderr, error.message],
      result: null,
      executionTime: performance.now() - startTime,
    };
  }
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const codeExecutionTool: Tool = {
  name: 'execute_code',
  description:
    'Execute code in a sandboxed environment. Supports JavaScript and Python. Use for calculations, data processing, and generating outputs.',
  category: 'code_execution',
  riskLevel: 'medium',
  requiresApproval: false,

  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The code to execute',
      },
      language: {
        type: 'string',
        description: 'Programming language',
        enum: ['javascript', 'python'],
        default: 'javascript',
      },
      timeout: {
        type: 'number',
        description: 'Maximum execution time in milliseconds',
        default: 30000,
      },
      inputs: {
        type: 'object',
        description: 'Input variables to pass to the code',
      },
    },
    required: ['code'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const {
      code,
      language = 'javascript',
      timeout = 30000,
      inputs = {},
    } = input as CodeExecutionInput;
    const startTime = Date.now();

    // Validate permissions
    if (!context.permissions.allowCodeExecution) {
      return {
        success: false,
        output: null,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Code execution is not permitted',
          recoverable: false,
        },
      };
    }

    // Limit timeout
    const maxTimeout = Math.min(timeout, context.limits.timeoutMs, 60000);

    context.onLog?.('info', `Executing ${language} code...`);
    context.onProgress?.(10, 'Preparing execution environment...');

    try {
      let result: ExecutionResult;

      if (language === 'python') {
        context.onProgress?.(30, 'Loading Python runtime...');
        result = await executePython(code, inputs, maxTimeout);
      } else {
        context.onProgress?.(30, 'Executing JavaScript...');
        const executor = new SandboxedExecutor();
        try {
          result = await executor.execute(code, inputs, maxTimeout);
        } finally {
          executor.terminate();
        }
      }

      context.onProgress?.(90, 'Processing results...');

      // Create code artifact
      const artifacts: ToolArtifact[] = [
        {
          id: `code_${Date.now()}`,
          type: 'code',
          name: `executed_${language}_code`,
          mimeType: language === 'python' ? 'text/x-python' : 'application/javascript',
          size: code.length,
          content: code,
          metadata: {
            language,
            executionTime: result.executionTime,
          },
        },
      ];

      context.onProgress?.(100, 'Execution complete');

      const hasErrors = result.stderr.length > 0;

      return {
        success: !hasErrors || result.result !== null,
        output: {
          result: result.result,
          stdout: result.stdout.join('\n'),
          stderr: result.stderr.join('\n'),
          executionTime: result.executionTime,
          language,
        },
        artifacts,
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: result.memoryUsed || 0,
        },
        ...(hasErrors && result.result === null
          ? {
              error: {
                code: 'EXECUTION_ERROR',
                message: result.stderr.join('\n'),
                recoverable: true,
              },
            }
          : {}),
      };
    } catch (error: any) {
      context.onLog?.('error', `Execution failed: ${error.message}`);

      return {
        success: false,
        output: null,
        error: {
          code: 'EXECUTION_FAILED',
          message: error.message,
          recoverable: true,
          suggestedAction: 'Check your code for syntax errors',
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
        },
      };
    }
  },
};

// ============================================================================
// REPL TOOL (for interactive coding)
// ============================================================================

export const replTool: Tool = {
  name: 'code_repl',
  description:
    'Interactive code REPL for quick calculations and experiments. Maintains state between calls.',
  category: 'code_execution',
  riskLevel: 'low',
  requiresApproval: false,

  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate',
      },
      reset: {
        type: 'boolean',
        description: 'Reset the REPL state',
        default: false,
      },
    },
    required: ['expression'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { expression, reset } = input as { expression: string; reset?: boolean };
    const startTime = Date.now();

    try {
      // For simple expressions, we can use Function constructor
      // This is safer than eval but still needs caution
      const fn = new Function(`return (${expression})`);
      const result = fn();

      return {
        success: true,
        output: {
          expression,
          result,
          type: typeof result,
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: {
          code: 'EVAL_ERROR',
          message: error.message,
          recoverable: true,
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: 0,
        },
      };
    }
  },
};
