/**
 * visionStore.ts — Vision / Screen Sharing State
 *
 * Manages screenshots, screen captures, and vision-related state.
 * Screenshots are stored as base64 data URLs for display in chat and panels.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';

export interface Screenshot {
  id: string;
  dataUrl: string;         // base64 data URL
  timestamp: number;
  width?: number;
  height?: number;
  source: 'manual' | 'auto' | 'tool';
}

interface VisionStore {
  screenshots: Screenshot[];
  isCapturing: boolean;
  lastScreenshot: Screenshot | null;

  // Actions
  captureScreenshot: () => Promise<Screenshot | null>;
  addScreenshot: (dataUrl: string, source?: Screenshot['source']) => Screenshot;
  removeScreenshot: (id: string) => void;
  clearScreenshots: () => void;
}

export const useVisionStore = create<VisionStore>()(
  immer((set, get) => ({
    screenshots: [],
    isCapturing: false,
    lastScreenshot: null,

    captureScreenshot: async () => {
      set((s) => { s.isCapturing = true; });
      try {
        const resp = await fetch('/api/computer/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'screenshot' }),
        });

        if (!resp.ok) throw new Error('Screenshot failed');
        const data = await resp.json();
        if (!data.image) throw new Error('No image data');

        const screenshot = get().addScreenshot(
          `data:image/png;base64,${data.image}`,
          'manual'
        );
        return screenshot;
      } catch (err) {
        console.warn('[Vision] Screenshot failed:', err);
        return null;
      } finally {
        set((s) => { s.isCapturing = false; });
      }
    },

    addScreenshot: (dataUrl, source = 'tool') => {
      const screenshot: Screenshot = {
        id: nanoid(),
        dataUrl,
        timestamp: Date.now(),
        source,
      };
      set((s) => {
        s.screenshots.unshift(screenshot);
        s.lastScreenshot = screenshot;
        // Keep last 20 screenshots
        if (s.screenshots.length > 20) {
          s.screenshots = s.screenshots.slice(0, 20);
        }
      });
      return screenshot;
    },

    removeScreenshot: (id) => {
      set((s) => {
        s.screenshots = s.screenshots.filter((ss) => ss.id !== id);
        if (s.lastScreenshot?.id === id) s.lastScreenshot = s.screenshots[0] || null;
      });
    },

    clearScreenshots: () => {
      set((s) => {
        s.screenshots = [];
        s.lastScreenshot = null;
      });
    },
  }))
);
