/**
 * TBWO Update Service - Real-time execution state updates for the UI
 *
 * Pure in-memory event system that pushes live TBWO execution updates
 * to the TBWODashboard and other UI consumers. Named "websocketService"
 * aspirationally - currently uses in-memory pub/sub, but the interface
 * is designed so a real WebSocket transport can be swapped in later.
 *
 * Features:
 * - Per-TBWO subscriptions and global subscriptions
 * - Capped update history per TBWO (default 200 entries)
 * - Convenience emitters for all common execution events
 * - Subscribe returns an unsubscribe function for easy cleanup
 */

import { nanoid } from 'nanoid';

// ============================================================================
// TYPES
// ============================================================================

export type UpdateType =
  | 'phase_start'
  | 'phase_complete'
  | 'task_start'
  | 'task_complete'
  | 'task_failed'
  | 'pod_message'
  | 'artifact_created'
  | 'checkpoint_reached'
  | 'progress_update'
  | 'error'
  | 'execution_complete';

export interface TBWOUpdate {
  id: string;
  tbwoId: string;
  type: UpdateType;
  data: unknown;
  timestamp: number;
}

export type UpdateListener = (update: TBWOUpdate) => void;

// ============================================================================
// TBWO UPDATE SERVICE
// ============================================================================

export class TBWOUpdateService {
  /** Per-TBWO listeners: tbwoId -> Set of listener functions */
  private listeners = new Map<string, Set<UpdateListener>>();

  /** Global listeners that receive updates for all TBWOs */
  private globalListeners = new Set<UpdateListener>();

  /** Per-TBWO update history: tbwoId -> array of updates */
  private updateHistory = new Map<string, TBWOUpdate[]>();

  /** Maximum number of updates to retain per TBWO */
  private maxHistoryPerTBWO = 200;

  // ==========================================================================
  // SUBSCRIPTIONS
  // ==========================================================================

  /**
   * Subscribe to updates for a specific TBWO.
   * Returns an unsubscribe function that removes this listener.
   */
  subscribe(tbwoId: string, listener: UpdateListener): () => void {
    if (!this.listeners.has(tbwoId)) {
      this.listeners.set(tbwoId, new Set());
    }
    this.listeners.get(tbwoId)!.add(listener);

    return () => {
      const tbwoListeners = this.listeners.get(tbwoId);
      if (tbwoListeners) {
        tbwoListeners.delete(listener);
        if (tbwoListeners.size === 0) {
          this.listeners.delete(tbwoId);
        }
      }
    };
  }

  /**
   * Subscribe to updates for ALL TBWOs.
   * Returns an unsubscribe function that removes this listener.
   */
  subscribeAll(listener: UpdateListener): () => void {
    this.globalListeners.add(listener);

    return () => {
      this.globalListeners.delete(listener);
    };
  }

  // ==========================================================================
  // CORE EMIT
  // ==========================================================================

  /**
   * Emit an update. Automatically assigns an id and timestamp.
   * Stores the update in history and notifies all matching listeners.
   */
  emit(update: Omit<TBWOUpdate, 'id' | 'timestamp'>): void {
    const fullUpdate: TBWOUpdate = {
      ...update,
      id: nanoid(),
      timestamp: Date.now(),
    };

    // Store in history
    if (!this.updateHistory.has(fullUpdate.tbwoId)) {
      this.updateHistory.set(fullUpdate.tbwoId, []);
    }
    const history = this.updateHistory.get(fullUpdate.tbwoId)!;
    history.push(fullUpdate);

    // Cap history size
    if (history.length > this.maxHistoryPerTBWO) {
      history.splice(0, history.length - this.maxHistoryPerTBWO);
    }

    // Notify per-TBWO listeners
    const tbwoListeners = this.listeners.get(fullUpdate.tbwoId);
    if (tbwoListeners) {
      tbwoListeners.forEach((listener) => {
        try {
          listener(fullUpdate);
        } catch (err) {
          console.error('[TBWOUpdateService] Listener error:', err);
        }
      });
    }

    // Notify global listeners
    this.globalListeners.forEach((listener) => {
      try {
        listener(fullUpdate);
      } catch (err) {
        console.error('[TBWOUpdateService] Global listener error:', err);
      }
    });
  }

  // ==========================================================================
  // CONVENIENCE EMITTERS
  // ==========================================================================

  /**
   * Emit when a phase starts executing.
   */
  phaseStarted(tbwoId: string, phaseName: string, phaseIndex: number): void {
    this.emit({
      tbwoId,
      type: 'phase_start',
      data: { phaseName, phaseIndex },
    });
  }

  /**
   * Emit when a phase completes (success or failure).
   */
  phaseCompleted(
    tbwoId: string,
    phaseName: string,
    result: { success: boolean; duration: number }
  ): void {
    this.emit({
      tbwoId,
      type: 'phase_complete',
      data: { phaseName, ...result },
    });
  }

  /**
   * Emit when a task starts executing in a pod.
   */
  taskStarted(tbwoId: string, taskName: string, podId: string): void {
    this.emit({
      tbwoId,
      type: 'task_start',
      data: { taskName, podId },
    });
  }

  /**
   * Emit when a task completes successfully.
   */
  taskCompleted(
    tbwoId: string,
    taskName: string,
    result: { success: boolean; output?: string }
  ): void {
    this.emit({
      tbwoId,
      type: 'task_complete',
      data: { taskName, ...result },
    });
  }

  /**
   * Emit when a task fails.
   */
  taskFailed(tbwoId: string, taskName: string, error: string): void {
    this.emit({
      tbwoId,
      type: 'task_failed',
      data: { taskName, error },
    });
  }

  /**
   * Emit when a new artifact is created.
   */
  artifactCreated(tbwoId: string, artifactName: string, type: string): void {
    this.emit({
      tbwoId,
      type: 'artifact_created',
      data: { artifactName, artifactType: type },
    });
  }

  /**
   * Emit when a checkpoint is reached.
   */
  checkpointReached(tbwoId: string, checkpointName: string): void {
    this.emit({
      tbwoId,
      type: 'checkpoint_reached',
      data: { checkpointName },
    });
  }

  /**
   * Emit a progress update (0-100 with optional message).
   */
  progressUpdate(tbwoId: string, progress: number, message: string): void {
    this.emit({
      tbwoId,
      type: 'progress_update',
      data: { progress, message },
    });
  }

  /**
   * Emit an execution error.
   */
  executionError(tbwoId: string, error: string): void {
    this.emit({
      tbwoId,
      type: 'error',
      data: { error },
    });
  }

  /**
   * Emit when the entire TBWO execution completes.
   */
  executionComplete(tbwoId: string, success: boolean): void {
    this.emit({
      tbwoId,
      type: 'execution_complete',
      data: { success },
    });
  }

  // ==========================================================================
  // HISTORY
  // ==========================================================================

  /**
   * Get the update history for a specific TBWO.
   * Returns an empty array if no history exists.
   */
  getHistory(tbwoId: string): TBWOUpdate[] {
    return this.updateHistory.get(tbwoId) || [];
  }

  /**
   * Clear the update history for a specific TBWO.
   */
  clearHistory(tbwoId: string): void {
    this.updateHistory.delete(tbwoId);
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  /**
   * Destroy the service, clearing all listeners and history.
   * Call this when the application is shutting down or
   * when you need a full reset.
   */
  destroy(): void {
    this.listeners.clear();
    this.globalListeners.clear();
    this.updateHistory.clear();
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const tbwoUpdateService = new TBWOUpdateService();
