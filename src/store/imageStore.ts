/**
 * Image Store - Tracks generated images for the Image Gallery
 *
 * No localStorage persist — images are stored in SQLite and loaded via dbInit.
 * This prevents localStorage quota overflow from large image URLs/base64 data.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';
import * as dbService from '../api/dbService';

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  revisedPrompt?: string;
  model: string;
  size: string;
  quality: string;
  style: string;
  timestamp: number;
  conversationId?: string;
  messageId?: string;
}

interface ImageState {
  images: GeneratedImage[];
}

interface ImageActions {
  addImage: (image: Omit<GeneratedImage, 'id' | 'timestamp'>) => string;
  removeImage: (id: string) => void;
  clearImages: () => void;
  getImagesByConversation: (conversationId: string) => GeneratedImage[];
}

export const useImageStore = create<ImageState & ImageActions>()(
  immer((set, get) => ({
    images: [],

    addImage: (image) => {
      const id = nanoid();
      const now = Date.now();
      set((state) => {
        state.images.unshift({
          ...image,
          id,
          timestamp: now,
        });
        // Keep last 100 images
        if (state.images.length > 100) {
          state.images = state.images.slice(0, 100);
        }
      });

      dbService.createImage({
        id,
        url: image.url,
        prompt: image.prompt,
        revisedPrompt: image.revisedPrompt,
        model: image.model,
        size: image.size,
        quality: image.quality,
        style: image.style,
        conversationId: image.conversationId,
        messageId: image.messageId,
        createdAt: now,
      }).catch(e => console.warn('[imageStore] DB createImage failed:', e));

      return id;
    },

    removeImage: (id) => {
      set((state) => {
        const index = state.images.findIndex((img) => img.id === id);
        if (index !== -1) {
          state.images.splice(index, 1);
        }
      });
      dbService.deleteImage(id).catch(e => console.warn('[imageStore] DB deleteImage failed:', e));
    },

    clearImages: () => {
      set({ images: [] });
    },

    getImagesByConversation: (conversationId) => {
      return get().images.filter((img) => img.conversationId === conversationId);
    },
  }))
);
