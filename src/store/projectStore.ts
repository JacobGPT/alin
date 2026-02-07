/**
 * projectStore.ts — Persistent Project Context
 *
 * Remembers entire codebases across sessions. Stores project structure,
 * key files, tech stack, and conventions so the AI always has full context.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ============================================================================
// TYPES
// ============================================================================

export interface ProjectContext {
  id: string;
  name: string;
  rootPath: string;
  lastScanned: number;

  // Detected tech stack
  techStack: string[];       // e.g. ['react', 'typescript', 'node', 'sqlite']
  packageManager: string;    // 'npm' | 'yarn' | 'pnpm'
  framework: string;         // 'react' | 'next' | 'vue' | etc.

  // Structure summary (not full tree — just key directories)
  structure: string;         // human-readable tree summary

  // Key files content (cached for system prompt injection)
  keyFiles: Array<{
    path: string;
    summary: string;         // first ~500 chars or AI summary
    size: number;
  }>;

  // Conventions detected
  conventions: string[];     // e.g. ['uses zustand for state', 'BEM CSS naming']

  // Stats
  totalFiles: number;
  totalSize: number;         // bytes
}

interface ProjectStore {
  // State
  projects: Map<string, ProjectContext>;
  activeProjectId: string | null;

  // Actions
  setActiveProject: (id: string) => void;
  updateProject: (id: string, updates: Partial<ProjectContext>) => void;
  removeProject: (id: string) => void;
  getActiveProject: () => ProjectContext | null;

  // Scanning
  scanProject: (rootPath: string) => Promise<ProjectContext | null>;
}

// ============================================================================
// STORE
// ============================================================================

export const useProjectStore = create<ProjectStore>()(
  persist(
    immer((set, get) => ({
      projects: new Map(),
      activeProjectId: null,

      setActiveProject: (id) => {
        set((state) => { state.activeProjectId = id; });
      },

      updateProject: (id, updates) => {
        set((state) => {
          const project = state.projects.get(id);
          if (project) {
            Object.assign(project, updates);
          }
        });
      },

      removeProject: (id) => {
        set((state) => {
          state.projects.delete(id);
          if (state.activeProjectId === id) {
            state.activeProjectId = null;
          }
        });
      },

      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        if (!activeProjectId) return null;
        return projects.get(activeProjectId) || null;
      },

      scanProject: async (rootPath: string) => {
        try {
          // Call backend scan endpoint
          const resp = await fetch('/api/files/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: rootPath, maxDepth: 3, maxFiles: 50 }),
          });

          if (!resp.ok) return null;
          const data = await resp.json();

          // Detect tech stack from file list
          const fileNames = (data.files || []).map((f: any) => f.path || f.name || '');
          const techStack = detectTechStack(fileNames);
          const packageManager = fileNames.some((f: string) => f.includes('yarn.lock')) ? 'yarn'
            : fileNames.some((f: string) => f.includes('pnpm-lock')) ? 'pnpm' : 'npm';
          const framework = detectFramework(fileNames, data.files || []);

          // Extract key files (config files, entry points, READMEs)
          const keyFiles = extractKeyFiles(data.files || []);

          // Detect conventions from file patterns
          const conventions = detectConventions(fileNames, data.files || []);

          const projectId = rootPath.replace(/[^a-zA-Z0-9]/g, '_');
          const project: ProjectContext = {
            id: projectId,
            name: rootPath.split('/').pop() || rootPath.split('\\').pop() || 'project',
            rootPath,
            lastScanned: Date.now(),
            techStack,
            packageManager,
            framework,
            structure: data.tree || '',
            keyFiles,
            conventions,
            totalFiles: data.files?.length || 0,
            totalSize: data.totalSize || 0,
          };

          set((state) => {
            state.projects.set(projectId, project);
            state.activeProjectId = projectId;
          });

          console.log(`[ProjectStore] Scanned project: ${project.name} (${project.totalFiles} files, ${techStack.join(', ')})`);
          return project;
        } catch (err) {
          console.warn('[ProjectStore] Scan failed:', err);
          return null;
        }
      },
    })),
    {
      name: 'alin-project-storage',
      partialize: (state) => ({
        projects: Array.from(state.projects.entries()),
        activeProjectId: state.activeProjectId,
      }),
      merge: (persisted: any, current: any) => {
        const projects = new Map<string, any>(persisted?.projects || []);
        return { ...current, projects, activeProjectId: persisted?.activeProjectId || null };
      },
    }
  )
);

// ============================================================================
// DETECTION HELPERS
// ============================================================================

function detectTechStack(files: string[]): string[] {
  const stack: string[] = [];
  const joined = files.join(' ').toLowerCase();

  if (joined.includes('tsconfig') || joined.includes('.ts')) stack.push('typescript');
  else if (joined.includes('.js') || joined.includes('.jsx')) stack.push('javascript');
  if (joined.includes('package.json')) stack.push('node');
  if (joined.includes('.py') || joined.includes('requirements.txt') || joined.includes('pyproject.toml')) stack.push('python');
  if (joined.includes('.rs') || joined.includes('cargo.toml')) stack.push('rust');
  if (joined.includes('.go') || joined.includes('go.mod')) stack.push('go');
  if (joined.includes('vite.config')) stack.push('vite');
  if (joined.includes('webpack')) stack.push('webpack');
  if (joined.includes('tailwind')) stack.push('tailwind');
  if (joined.includes('.scss') || joined.includes('.sass')) stack.push('sass');
  if (joined.includes('docker')) stack.push('docker');
  if (joined.includes('.sql') || joined.includes('sqlite') || joined.includes('prisma')) stack.push('database');
  if (joined.includes('.test.') || joined.includes('.spec.') || joined.includes('jest') || joined.includes('vitest')) stack.push('testing');

  return stack;
}

function detectFramework(files: string[], fileData: any[]): string {
  const joined = files.join(' ').toLowerCase();
  const contents = fileData.map((f: any) => (f.content || '')).join(' ').toLowerCase();

  if (joined.includes('next.config') || contents.includes('next/')) return 'next';
  if (contents.includes('from \'react\'') || contents.includes('from "react"')) return 'react';
  if (contents.includes('from \'vue\'') || joined.includes('vue.config')) return 'vue';
  if (contents.includes('from \'svelte\'') || joined.includes('svelte.config')) return 'svelte';
  if (contents.includes('from \'@angular\'')) return 'angular';
  if (contents.includes('fastapi') || contents.includes('FastAPI')) return 'fastapi';
  if (contents.includes('from django') || contents.includes('from \'django\'')) return 'django';
  if (contents.includes('express')) return 'express';
  return 'unknown';
}

function extractKeyFiles(fileData: any[]): ProjectContext['keyFiles'] {
  const KEY_PATTERNS = [
    /package\.json$/i, /tsconfig/i, /readme/i,
    /\.env\.example$/i, /vite\.config/i, /next\.config/i,
    /src\/app\.(tsx?|jsx?)$/i, /src\/main\.(tsx?|jsx?)$/i, /src\/index\.(tsx?|jsx?)$/i,
    /server\.(js|ts)$/i, /docker/i, /\.github/i,
  ];

  return fileData
    .filter((f: any) => {
      const path = f.path || f.name || '';
      return KEY_PATTERNS.some((p) => p.test(path));
    })
    .slice(0, 15)
    .map((f: any) => ({
      path: f.path || f.name,
      summary: typeof f.content === 'string' ? f.content.slice(0, 500) : '',
      size: f.size || (typeof f.content === 'string' ? f.content.length : 0),
    }));
}

function detectConventions(files: string[], fileData: any[]): string[] {
  const conventions: string[] = [];
  const joined = files.join(' ').toLowerCase();
  const contents = fileData.map((f: any) => (f.content || '')).join(' ');

  if (joined.includes('store') && contents.includes('zustand')) conventions.push('Uses Zustand for state management');
  if (contents.includes('immer')) conventions.push('Uses Immer for immutable updates');
  if (joined.includes('.module.css') || joined.includes('.module.scss')) conventions.push('CSS Modules for styling');
  if (contents.includes('tailwind') || joined.includes('tailwind')) conventions.push('Tailwind CSS for styling');
  if (contents.includes('BEM') || /class="[a-z]+__[a-z]+/.test(contents)) conventions.push('BEM CSS naming');
  if (joined.includes('.test.ts') || joined.includes('.spec.ts')) conventions.push('Co-located test files');
  if (joined.includes('__tests__')) conventions.push('__tests__ directory for tests');
  if (/src\/components\//.test(joined)) conventions.push('Components in src/components/');
  if (/src\/store\//.test(joined)) conventions.push('Stores in src/store/');
  if (/src\/api\//.test(joined)) conventions.push('API layer in src/api/');

  return conventions;
}

/**
 * Get a compact project context string for system prompt injection.
 * ~1-2K chars summarizing the active project.
 */
export function getProjectContextForPrompt(): string {
  const project = useProjectStore.getState().getActiveProject();
  if (!project) return '';

  const age = Date.now() - project.lastScanned;
  const ageStr = age < 3600000 ? `${Math.round(age / 60000)}m ago` : `${Math.round(age / 3600000)}h ago`;

  const lines: string[] = [
    `\n\n## ACTIVE PROJECT CONTEXT`,
    `**Project:** ${project.name} (${project.rootPath})`,
    `**Last scanned:** ${ageStr} | ${project.totalFiles} files`,
    `**Tech stack:** ${project.techStack.join(', ')}`,
    `**Framework:** ${project.framework}`,
    `**Package manager:** ${project.packageManager}`,
  ];

  if (project.conventions.length > 0) {
    lines.push(`**Conventions:** ${project.conventions.join('; ')}`);
  }

  if (project.keyFiles.length > 0) {
    lines.push(`**Key files:** ${project.keyFiles.map((f) => f.path).join(', ')}`);
  }

  if (project.structure) {
    // Truncate structure to ~500 chars
    const struct = project.structure.length > 500
      ? project.structure.slice(0, 500) + '\n...'
      : project.structure;
    lines.push(`\n**Directory structure:**\n\`\`\`\n${struct}\n\`\`\``);
  }

  lines.push('\nUse scan_directory or file_read to explore files in detail.');

  return lines.join('\n');
}
