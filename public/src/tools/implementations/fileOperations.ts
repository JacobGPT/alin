/**
 * File Operations Tools
 *
 * Tools for reading, writing, and managing files.
 * Uses the browser's File System Access API when available,
 * falls back to IndexedDB-based virtual filesystem.
 */

import type { Tool, ToolContext, ToolResult, ToolArtifact } from '../types';
import { openDB, IDBPDatabase } from 'idb';

// ============================================================================
// VIRTUAL FILE SYSTEM (IndexedDB-backed)
// ============================================================================

interface VirtualFile {
  path: string;
  name: string;
  content: string | ArrayBuffer;
  mimeType: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  isDirectory: boolean;
}

class VirtualFileSystem {
  private db: IDBPDatabase | null = null;
  private dbName = 'alin-filesystem';

  async init(): Promise<void> {
    if (this.db) return;

    this.db = await openDB(this.dbName, 1, {
      upgrade(db) {
        const store = db.createObjectStore('files', { keyPath: 'path' });
        store.createIndex('parent', 'parent');
        store.createIndex('name', 'name');
      },
    });
  }

  async readFile(path: string): Promise<VirtualFile | null> {
    await this.init();
    return this.db!.get('files', path);
  }

  async writeFile(
    path: string,
    content: string | ArrayBuffer,
    mimeType: string = 'text/plain'
  ): Promise<VirtualFile> {
    await this.init();

    const name = path.split('/').pop() || path;
    const parent = path.split('/').slice(0, -1).join('/') || '/';

    const file: VirtualFile = {
      path,
      name,
      content,
      mimeType,
      size: typeof content === 'string' ? content.length : content.byteLength,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDirectory: false,
    };

    // Ensure parent directories exist
    await this.ensureDirectory(parent);

    await this.db!.put('files', file);
    return file;
  }

  async deleteFile(path: string): Promise<boolean> {
    await this.init();
    await this.db!.delete('files', path);
    return true;
  }

  async listDirectory(path: string): Promise<VirtualFile[]> {
    await this.init();

    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const allFiles = await this.db!.getAll('files');

    return allFiles.filter((file) => {
      const parent = file.path.split('/').slice(0, -1).join('/') || '/';
      return parent === normalizedPath;
    });
  }

  async exists(path: string): Promise<boolean> {
    const file = await this.readFile(path);
    return file !== null;
  }

  private async ensureDirectory(path: string): Promise<void> {
    if (!path || path === '/') return;

    const exists = await this.exists(path);
    if (!exists) {
      const name = path.split('/').pop() || path;
      const dir: VirtualFile = {
        path,
        name,
        content: '',
        mimeType: 'inode/directory',
        size: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        isDirectory: true,
      };
      await this.db!.put('files', dir);

      // Recursively create parent
      const parent = path.split('/').slice(0, -1).join('/');
      if (parent) {
        await this.ensureDirectory(parent);
      }
    }
  }

  async clear(): Promise<void> {
    await this.init();
    await this.db!.clear('files');
  }
}

const vfs = new VirtualFileSystem();

// ============================================================================
// READ FILE TOOL
// ============================================================================

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read the contents of a file. Returns the file content as text or base64 for binary files.',
  category: 'file_operations',
  riskLevel: 'safe',
  requiresApproval: false,

  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'Text encoding (utf-8 for text, base64 for binary)',
        enum: ['utf-8', 'base64'],
        default: 'utf-8',
      },
    },
    required: ['path'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path, encoding = 'utf-8' } = input as { path: string; encoding?: string };
    const startTime = Date.now();

    // Check permissions
    if (!context.permissions.allowFileRead) {
      return {
        success: false,
        output: null,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'File read permission denied',
          recoverable: false,
        },
      };
    }

    // Check forbidden paths
    if (context.permissions.forbiddenPaths?.some((fp) => path.startsWith(fp))) {
      return {
        success: false,
        output: null,
        error: {
          code: 'FORBIDDEN_PATH',
          message: `Access to path "${path}" is forbidden`,
          recoverable: false,
        },
      };
    }

    try {
      context.onLog?.('info', `Reading file: ${path}`);

      const file = await vfs.readFile(path);

      if (!file) {
        return {
          success: false,
          output: null,
          error: {
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${path}`,
            recoverable: false,
          },
        };
      }

      let content: string;
      if (typeof file.content === 'string') {
        content = file.content;
      } else {
        // Convert ArrayBuffer to base64
        const bytes = new Uint8Array(file.content);
        content = btoa(String.fromCharCode(...bytes));
      }

      return {
        success: true,
        output: {
          path,
          content,
          encoding: typeof file.content === 'string' ? 'utf-8' : 'base64',
          mimeType: file.mimeType,
          size: file.size,
        },
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: file.size / (1024 * 1024),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: {
          code: 'READ_ERROR',
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

// ============================================================================
// WRITE FILE TOOL
// ============================================================================

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
  category: 'file_operations',
  riskLevel: 'low',
  requiresApproval: false,

  inputSchema: {
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
      mimeType: {
        type: 'string',
        description: 'MIME type of the file',
        default: 'text/plain',
      },
      append: {
        type: 'boolean',
        description: 'Append to existing file instead of overwriting',
        default: false,
      },
    },
    required: ['path', 'content'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const {
      path,
      content,
      mimeType = 'text/plain',
      append = false,
    } = input as {
      path: string;
      content: string;
      mimeType?: string;
      append?: boolean;
    };
    const startTime = Date.now();

    // Check permissions
    if (!context.permissions.allowFileWrite) {
      return {
        success: false,
        output: null,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'File write permission denied',
          recoverable: false,
        },
      };
    }

    // Check file size limit
    if (content.length > context.permissions.maxFileSize) {
      return {
        success: false,
        output: null,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File exceeds maximum size of ${context.permissions.maxFileSize} bytes`,
          recoverable: false,
        },
      };
    }

    // Check forbidden paths
    if (context.permissions.forbiddenPaths?.some((fp) => path.startsWith(fp))) {
      return {
        success: false,
        output: null,
        error: {
          code: 'FORBIDDEN_PATH',
          message: `Writing to path "${path}" is forbidden`,
          recoverable: false,
        },
      };
    }

    try {
      context.onLog?.('info', `Writing file: ${path}`);

      let finalContent = content;

      if (append) {
        const existing = await vfs.readFile(path);
        if (existing && typeof existing.content === 'string') {
          finalContent = existing.content + content;
        }
      }

      const file = await vfs.writeFile(path, finalContent, mimeType);

      // Create artifact
      const artifact: ToolArtifact = {
        id: `file_${Date.now()}`,
        type: 'file',
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        path: file.path,
        content: finalContent,
      };

      context.onArtifact?.(artifact);

      return {
        success: true,
        output: {
          path: file.path,
          size: file.size,
          mimeType: file.mimeType,
          created: !append,
        },
        artifacts: [artifact],
        usage: {
          executionTimeMs: Date.now() - startTime,
          memoryUsedMB: file.size / (1024 * 1024),
        },
      };
    } catch (error: any) {
      return {
        success: false,
        output: null,
        error: {
          code: 'WRITE_ERROR',
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

// ============================================================================
// LIST FILES TOOL
// ============================================================================

export const listFilesTool: Tool = {
  name: 'list_files',
  description: 'List files and directories in a given path.',
  category: 'file_operations',
  riskLevel: 'safe',
  requiresApproval: false,

  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list',
        default: '/',
      },
      recursive: {
        type: 'boolean',
        description: 'List files recursively',
        default: false,
      },
    },
    required: [],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path = '/', recursive = false } = input as { path?: string; recursive?: boolean };
    const startTime = Date.now();

    if (!context.permissions.allowFileRead) {
      return {
        success: false,
        output: null,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'File read permission denied',
          recoverable: false,
        },
      };
    }

    try {
      context.onLog?.('info', `Listing directory: ${path}`);

      const files = await vfs.listDirectory(path);

      const listing = files.map((f) => ({
        name: f.name,
        path: f.path,
        isDirectory: f.isDirectory,
        size: f.size,
        mimeType: f.mimeType,
        updatedAt: f.updatedAt,
      }));

      return {
        success: true,
        output: {
          path,
          count: listing.length,
          files: listing,
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
          code: 'LIST_ERROR',
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

// ============================================================================
// DELETE FILE TOOL
// ============================================================================

export const deleteFileTool: Tool = {
  name: 'delete_file',
  description: 'Delete a file or empty directory.',
  category: 'file_operations',
  riskLevel: 'medium',
  requiresApproval: true,

  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to delete',
      },
    },
    required: ['path'],
  },

  async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
    const { path } = input as { path: string };
    const startTime = Date.now();

    if (!context.permissions.allowFileDelete) {
      return {
        success: false,
        output: null,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'File delete permission denied',
          recoverable: false,
        },
      };
    }

    if (context.permissions.forbiddenPaths?.some((fp) => path.startsWith(fp))) {
      return {
        success: false,
        output: null,
        error: {
          code: 'FORBIDDEN_PATH',
          message: `Deleting from path "${path}" is forbidden`,
          recoverable: false,
        },
      };
    }

    try {
      context.onLog?.('info', `Deleting file: ${path}`);

      const exists = await vfs.exists(path);
      if (!exists) {
        return {
          success: false,
          output: null,
          error: {
            code: 'FILE_NOT_FOUND',
            message: `File not found: ${path}`,
            recoverable: false,
          },
        };
      }

      await vfs.deleteFile(path);

      return {
        success: true,
        output: {
          path,
          deleted: true,
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
          code: 'DELETE_ERROR',
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

// ============================================================================
// EXPORT VIRTUAL FILE SYSTEM
// ============================================================================

export { vfs as virtualFileSystem };
