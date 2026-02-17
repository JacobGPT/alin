/**
 * backgroundStore.ts — Background Job Queue & Notifications
 *
 * Tracks long-running background tasks (TBWO execution, file operations,
 * code execution, etc.) and surfaces notifications when they complete.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { nanoid } from 'nanoid';

// ============================================================================
// TYPES
// ============================================================================

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobType = 'tbwo' | 'code_execution' | 'file_operation' | 'search' | 'image_generation' | 'git' | 'custom';

export interface BackgroundJob {
  id: string;
  type: JobType;
  title: string;
  description?: string;
  status: JobStatus;
  progress: number; // 0-100
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface JobNotification {
  id: string;
  jobId: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info';
  read: boolean;
  createdAt: number;
}

interface BackgroundStore {
  jobs: BackgroundJob[];
  notifications: JobNotification[];
  maxJobs: number;

  // Job management
  createJob: (type: JobType, title: string, description?: string, metadata?: Record<string, unknown>) => string;
  updateJobProgress: (jobId: string, progress: number) => void;
  completeJob: (jobId: string, result?: unknown) => void;
  failJob: (jobId: string, error: string) => void;
  cancelJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  clearCompleted: () => void;

  // Notifications
  markNotificationRead: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  getUnreadCount: () => number;

  // Queries
  getActiveJobs: () => BackgroundJob[];
  getJobById: (id: string) => BackgroundJob | undefined;
}

// ============================================================================
// STORE
// ============================================================================

export const useBackgroundStore = create<BackgroundStore>()(
  immer((set, get) => ({
    jobs: [],
    notifications: [],
    maxJobs: 50,

    createJob: (type, title, description, metadata) => {
      const id = nanoid();
      set((state) => {
        state.jobs.unshift({
          id,
          type,
          title,
          description,
          status: 'queued',
          progress: 0,
          createdAt: Date.now(),
          metadata,
        });
        // Trim old completed jobs
        if (state.jobs.length > state.maxJobs) {
          state.jobs = state.jobs.filter(j =>
            j.status === 'running' || j.status === 'queued'
          ).concat(
            state.jobs.filter(j =>
              j.status !== 'running' && j.status !== 'queued'
            ).slice(0, state.maxJobs - 10)
          );
        }
      });

      // Auto-transition to running
      setTimeout(() => {
        const job = get().jobs.find(j => j.id === id);
        if (job && job.status === 'queued') {
          set((state) => {
            const j = state.jobs.find(j => j.id === id);
            if (j) {
              j.status = 'running';
              j.startedAt = Date.now();
            }
          });
        }
      }, 100);

      return id;
    },

    updateJobProgress: (jobId, progress) => {
      set((state) => {
        const job = state.jobs.find(j => j.id === jobId);
        if (job && (job.status === 'running' || job.status === 'queued')) {
          job.progress = Math.min(100, Math.max(0, progress));
          if (job.status === 'queued') {
            job.status = 'running';
            job.startedAt = Date.now();
          }
        }
      });
    },

    completeJob: (jobId, result) => {
      set((state) => {
        const job = state.jobs.find(j => j.id === jobId);
        if (job) {
          job.status = 'completed';
          job.progress = 100;
          job.completedAt = Date.now();
          job.result = result;

          // Create notification
          state.notifications.unshift({
            id: nanoid(),
            jobId: job.id,
            title: job.title,
            message: `Completed successfully`,
            type: 'success',
            read: false,
            createdAt: Date.now(),
          });

          // Browser notification if tab is hidden
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('ALIN - Task Complete', {
              body: job.title,
              icon: '/favicon.ico',
            });
          }
        }
      });
    },

    failJob: (jobId, error) => {
      set((state) => {
        const job = state.jobs.find(j => j.id === jobId);
        if (job) {
          job.status = 'failed';
          job.completedAt = Date.now();
          job.error = error;

          state.notifications.unshift({
            id: nanoid(),
            jobId: job.id,
            title: job.title,
            message: `Failed: ${error}`,
            type: 'error',
            read: false,
            createdAt: Date.now(),
          });

          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('ALIN - Task Failed', {
              body: `${job.title}: ${error}`,
              icon: '/favicon.ico',
            });
          }
        }
      });
    },

    cancelJob: (jobId) => {
      set((state) => {
        const job = state.jobs.find(j => j.id === jobId);
        if (job && (job.status === 'running' || job.status === 'queued')) {
          job.status = 'cancelled';
          job.completedAt = Date.now();
        }
      });
    },

    removeJob: (jobId) => {
      set((state) => {
        state.jobs = state.jobs.filter(j => j.id !== jobId);
      });
    },

    clearCompleted: () => {
      set((state) => {
        state.jobs = state.jobs.filter(j => j.status === 'running' || j.status === 'queued');
      });
    },

    markNotificationRead: (id) => {
      set((state) => {
        const n = state.notifications.find(n => n.id === id);
        if (n) n.read = true;
      });
    },

    markAllRead: () => {
      set((state) => {
        state.notifications.forEach(n => { n.read = true; });
      });
    },

    clearNotifications: () => {
      set((state) => {
        state.notifications = [];
      });
    },

    getUnreadCount: () => {
      return get().notifications.filter(n => !n.read).length;
    },

    getActiveJobs: () => {
      return get().jobs.filter(j => j.status === 'running' || j.status === 'queued');
    },

    getJobById: (id) => {
      return get().jobs.find(j => j.id === id);
    },
  }))
);
