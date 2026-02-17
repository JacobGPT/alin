/**
 * Artifact Store - Tracks artifacts (code, HTML, documents) for the preview panel
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import * as dbService from '../api/dbService';

export type ArtifactType = 'code' | 'html' | 'markdown' | 'svg' | 'mermaid' | 'chart' | 'react';

export interface Artifact {
  id: string;
  title: string;
  type: ArtifactType;
  language?: string;
  content: string;
  timestamp: number;
  editable?: boolean;
}

interface ArtifactState {
  artifacts: Artifact[];
  activeArtifactId: string | null;
}

interface ArtifactActions {
  openArtifact: (artifact: Omit<Artifact, 'timestamp'>) => void;
  closeArtifact: () => void;
  removeArtifact: (id: string) => void;
  getActiveArtifact: () => Artifact | null;
  updateArtifactContent: (id: string, content: string) => void;
}

// Debounced artifact content update
const _artifactUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
function _debouncedArtifactUpdate(id: string, content: string) {
  const existing = _artifactUpdateTimers.get(id);
  if (existing) clearTimeout(existing);
  _artifactUpdateTimers.set(id, setTimeout(() => {
    _artifactUpdateTimers.delete(id);
    dbService.updateArtifact(id, { content }).catch(e => console.warn('[artifactStore] DB updateArtifact failed:', e));
  }, 1000));
}

export const useArtifactStore = create<ArtifactState & ArtifactActions>()(
  immer((set, get) => ({
    artifacts: [],
    activeArtifactId: null,

    openArtifact: (artifact) => {
      const now = Date.now();
      set((state) => {
        const existing = state.artifacts.findIndex((a) => a.id === artifact.id);
        const fullArtifact = { ...artifact, timestamp: now };
        if (existing >= 0) {
          state.artifacts[existing] = fullArtifact;
        } else {
          state.artifacts.unshift(fullArtifact);
          if (state.artifacts.length > 20) {
            state.artifacts = state.artifacts.slice(0, 20);
          }
        }
        state.activeArtifactId = artifact.id;
      });

      dbService.createArtifact({
        id: artifact.id,
        title: artifact.title,
        type: artifact.type,
        language: artifact.language,
        content: artifact.content,
        editable: artifact.editable !== false,
        createdAt: now,
        updatedAt: now,
      }).catch(e => console.warn('[artifactStore] DB createArtifact failed:', e));
    },

    closeArtifact: () => {
      set((state) => {
        state.activeArtifactId = null;
      });
    },

    removeArtifact: (id) => {
      set((state) => {
        const index = state.artifacts.findIndex((a) => a.id === id);
        if (index !== -1) {
          state.artifacts.splice(index, 1);
        }
        if (state.activeArtifactId === id) {
          state.activeArtifactId = null;
        }
      });
      dbService.deleteArtifact(id).catch(e => console.warn('[artifactStore] DB deleteArtifact failed:', e));
    },

    getActiveArtifact: () => {
      const state = get();
      if (!state.activeArtifactId) return null;
      return state.artifacts.find((a) => a.id === state.activeArtifactId) || null;
    },

    updateArtifactContent: (id, content) => {
      set((state) => {
        const artifact = state.artifacts.find((a) => a.id === id);
        if (artifact) {
          artifact.content = content;
        }
      });
      _debouncedArtifactUpdate(id, content);
    },
  }))
);
