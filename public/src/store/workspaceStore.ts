/**
 * Workspace Store — Manages user workspace for coding mode
 *
 * Handles file upload, workspace initialization, and tree state.
 * One workspace per user (persists across conversations).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './authStore';

export interface WorkspaceFile {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  children?: WorkspaceFile[];
}

interface WorkspaceState {
  workspaceId: string | null;
  isInitialized: boolean;
  files: WorkspaceFile[];
  isLoading: boolean;
  error: string | null;

  initWorkspace: () => Promise<void>;
  uploadFiles: (files: File[], targetDir?: string) => Promise<number>;
  refreshTree: () => Promise<void>;
  deleteWorkspace: () => Promise<void>;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaceId: null,
      isInitialized: false,
      files: [],
      isLoading: false,
      error: null,

      initWorkspace: async () => {
        if (get().isInitialized && get().workspaceId) return;
        set({ isLoading: true, error: null });
        try {
          const resp = await fetch('/api/workspace/init', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...useAuthStore.getState().getAuthHeader(),
            },
          });
          const data = await resp.json();
          if (data.success) {
            set({ workspaceId: data.workspaceId, isInitialized: true, isLoading: false });
            // Load initial tree
            get().refreshTree();
          } else {
            set({ error: data.error || 'Init failed', isLoading: false });
          }
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
        }
      },

      uploadFiles: async (files: File[], targetDir?: string) => {
        if (!get().isInitialized) await get().initWorkspace();
        set({ isLoading: true, error: null });
        try {
          const formData = new FormData();
          for (const file of files) {
            formData.append('files', file);
          }
          if (targetDir) formData.append('targetDir', targetDir);

          const resp = await fetch('/api/workspace/upload', {
            method: 'POST',
            headers: useAuthStore.getState().getAuthHeader(),
            body: formData,
          });
          const data = await resp.json();
          if (data.success) {
            set({ isLoading: false });
            // Refresh tree after upload
            await get().refreshTree();
            return data.count || 0;
          } else {
            set({ error: data.error || 'Upload failed', isLoading: false });
            return 0;
          }
        } catch (error: any) {
          set({ error: error.message, isLoading: false });
          return 0;
        }
      },

      refreshTree: async () => {
        try {
          const resp = await fetch('/api/workspace/tree', {
            headers: useAuthStore.getState().getAuthHeader(),
          });
          const data = await resp.json();
          if (data.success) {
            set({ files: data.files || [] });
          }
        } catch {
          // Silently fail — workspace might not exist yet
        }
      },

      deleteWorkspace: async () => {
        try {
          await fetch('/api/workspace', {
            method: 'DELETE',
            headers: useAuthStore.getState().getAuthHeader(),
          });
        } catch {}
        set({ workspaceId: null, isInitialized: false, files: [], error: null });
      },

      reset: () => {
        set({ workspaceId: null, isInitialized: false, files: [], isLoading: false, error: null });
      },
    }),
    {
      name: 'alin-workspace',
      partialize: (state) => ({
        workspaceId: state.workspaceId,
        isInitialized: state.isInitialized,
      }),
    }
  )
);
