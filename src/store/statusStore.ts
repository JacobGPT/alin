/**
 * Status Store - Real-time task progress tracking
 *
 * Tracks what ALIN is currently doing and shows dynamic progress
 * Includes detailed tool activity for Claude-style collapsible UI
 */

import { create } from 'zustand';

// ============================================================================
// TYPES
// ============================================================================

export type TaskPhase =
  | 'idle'
  | 'understanding'
  | 'thinking'
  | 'searching'
  | 'remembering'
  | 'executing'
  | 'coding'
  | 'writing'
  | 'reading'
  | 'analyzing'
  | 'responding'
  | 'tool_use'
  | 'error';

export interface StatusStep {
  id: string;
  phase: TaskPhase;
  message: string;
  detail?: string;
  timestamp: number;
  completed: boolean;
  error?: string;
}

export interface ActiveTool {
  name: string;
  input?: Record<string, unknown>;
  startTime: number;
}

// ============================================================================
// TOOL ACTIVITY TRACKING (Claude-style)
// ============================================================================

export type ToolActivityType =
  | 'web_search'
  | 'memory_recall'
  | 'memory_store'
  | 'code_execute'
  | 'file_read'
  | 'file_write'
  | 'image_generate'
  | 'directory_scan'
  | 'code_search'
  | 'terminal_command'
  | 'git_operation'
  | 'file_edit'
  | 'other';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface MemoryResult {
  id: string;
  content: string;
  type: string;
  relevance?: number;
}

export interface ToolActivity {
  id: string;
  type: ToolActivityType;
  label: string;           // e.g., "Searched the web", "Accessed memory"
  status: 'pending' | 'running' | 'completed' | 'error';
  startTime: number;
  endTime?: number;

  // Detailed results for collapsible view
  query?: string;          // For searches
  resultCount?: number;
  results?: WebSearchResult[] | MemoryResult[] | any[];
  error?: string;

  // Raw input/output for debugging
  input?: Record<string, unknown>;
  output?: unknown;
}

interface StatusState {
  // Current status
  isProcessing: boolean;
  currentPhase: TaskPhase;
  currentMessage: string;

  // Step history for current task
  steps: StatusStep[];

  // Active tool being used
  activeTool: ActiveTool | null;

  // Model being used
  activeModel: string;

  // Tool activities for current response (Claude-style tracking)
  toolActivities: ToolActivity[];

  // Current message being streamed (for scoping tool activities)
  currentMessageId: string | null;

  // Actions
  startProcessing: (initialMessage?: string) => void;
  setCurrentMessageId: (id: string | null) => void;
  setPhase: (phase: TaskPhase, message: string, detail?: string) => void;
  addStep: (phase: TaskPhase, message: string, detail?: string) => void;
  completeStep: (stepId: string) => void;
  errorStep: (stepId: string, error: string) => void;
  setActiveTool: (tool: ActiveTool | null) => void;
  setActiveModel: (model: string) => void;
  completeProcessing: () => void;
  reset: () => void;

  // Tool activity actions (Claude-style)
  startToolActivity: (type: ToolActivityType, label: string, input?: Record<string, unknown>) => string;
  updateToolActivity: (id: string, updates: Partial<ToolActivity>) => void;
  completeToolActivity: (id: string, results?: any[], resultCount?: number, output?: unknown) => void;
  failToolActivity: (id: string, error: string) => void;
  clearToolActivities: () => void;
}

// ============================================================================
// PHASE MESSAGES
// ============================================================================

export const PHASE_MESSAGES: Record<TaskPhase, string> = {
  idle: 'Ready',
  understanding: 'Understanding your request...',
  thinking: 'Thinking about the best approach...',
  searching: 'Searching the web...',
  remembering: 'Checking memory for relevant context...',
  executing: 'Executing task...',
  coding: 'Writing and running code...',
  writing: 'Writing to file...',
  reading: 'Reading file contents...',
  analyzing: 'Analyzing information...',
  responding: 'Composing response...',
  tool_use: 'Using tool...',
  error: 'An error occurred',
};

// ============================================================================
// STORE
// ============================================================================

export const useStatusStore = create<StatusState>((set, get) => ({
  isProcessing: false,
  currentPhase: 'idle',
  currentMessage: 'Ready',
  steps: [],
  activeTool: null,
  activeModel: 'claude-sonnet-4',
  toolActivities: [],
  currentMessageId: null,

  setCurrentMessageId: (id) => {
    set({ currentMessageId: id });
  },

  startProcessing: (initialMessage) => {
    const message = initialMessage || 'Processing your request...';
    set({
      isProcessing: true,
      currentPhase: 'understanding',
      currentMessage: message,
      steps: [{
        id: crypto.randomUUID(),
        phase: 'understanding',
        message,
        timestamp: Date.now(),
        completed: false,
      }],
      activeTool: null,
      toolActivities: [], // Clear previous activities
      currentMessageId: null,
    });
  },

  setPhase: (phase, message, detail) => {
    set({
      currentPhase: phase,
      currentMessage: message,
    });

    // Also add as a step
    get().addStep(phase, message, detail);
  },

  addStep: (phase, message, detail) => {
    const step: StatusStep = {
      id: crypto.randomUUID(),
      phase,
      message,
      detail,
      timestamp: Date.now(),
      completed: false,
    };

    set((state) => ({
      steps: [...state.steps, step],
      currentPhase: phase,
      currentMessage: message,
    }));

    return step.id;
  },

  completeStep: (stepId) => {
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, completed: true } : s
      ),
    }));
  },

  errorStep: (stepId, error) => {
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, completed: true, error } : s
      ),
      currentPhase: 'error',
      currentMessage: error,
    }));
  },

  setActiveTool: (tool) => {
    set({ activeTool: tool });

    if (tool) {
      get().addStep('tool_use', `Using ${tool.name}...`, JSON.stringify(tool.input));
    }
  },

  setActiveModel: (model) => {
    set({ activeModel: model });
  },

  completeProcessing: () => {
    // Mark all steps as completed and clear activities
    set((state) => ({
      isProcessing: false,
      currentPhase: 'idle',
      currentMessage: 'Ready',
      steps: state.steps.map((s) => ({ ...s, completed: true })),
      activeTool: null,
      toolActivities: [], // Clear so they don't bleed into next message
      currentMessageId: null,
    }));
  },

  reset: () => {
    set({
      isProcessing: false,
      currentPhase: 'idle',
      currentMessage: 'Ready',
      steps: [],
      activeTool: null,
      toolActivities: [],
      currentMessageId: null,
    });
  },

  // ========================================================================
  // TOOL ACTIVITY METHODS (Claude-style tracking)
  // ========================================================================

  startToolActivity: (type, label, input) => {
    const id = crypto.randomUUID();
    const activity: ToolActivity = {
      id,
      type,
      label,
      status: 'running',
      startTime: Date.now(),
      input,
      query: input?.query as string,
    };

    set((state) => ({
      toolActivities: [...state.toolActivities, activity],
      currentPhase: 'tool_use',
      currentMessage: label,
    }));

    return id;
  },

  updateToolActivity: (id, updates) => {
    set((state) => ({
      toolActivities: state.toolActivities.map((a) =>
        a.id === id ? { ...a, ...updates } : a
      ),
    }));
  },

  completeToolActivity: (id, results, resultCount, output) => {
    set((state) => ({
      toolActivities: state.toolActivities.map((a) =>
        a.id === id
          ? {
              ...a,
              status: 'completed' as const,
              endTime: Date.now(),
              results,
              resultCount: resultCount ?? results?.length ?? 0,
              output,
            }
          : a
      ),
    }));
  },

  failToolActivity: (id, error) => {
    set((state) => ({
      toolActivities: state.toolActivities.map((a) =>
        a.id === id
          ? {
              ...a,
              status: 'error' as const,
              endTime: Date.now(),
              error,
            }
          : a
      ),
    }));
  },

  clearToolActivities: () => {
    set({ toolActivities: [] });
  },
}));
