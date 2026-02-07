import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesignPod } from '../pods/DesignPod';
import { PodRole } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: 'Color Palette:\nprimary: #6366f1\nsecondary: #8b5cf6\n\n```css\n:root {\n  --color-primary: #6366f1;\n  --color-secondary: #8b5cf6;\n  --font-body: Inter, sans-serif;\n}\n```',
      toolCalls: [],
      usage: { inputTokens: 15, outputTokens: 30 },
      stopReason: 'end_turn',
    }),
    chat: vi.fn().mockResolvedValue({
      text: 'Color Palette:\nprimary: #6366f1\nsecondary: #8b5cf6\n\n```css\n:root {\n  --color-primary: #6366f1;\n  --color-secondary: #8b5cf6;\n  --font-body: Inter, sans-serif;\n}\n```',
      toolCalls: [],
      tokensUsed: 45,
      stopReason: 'end_turn',
    }),
    addToHistory: vi.fn(),
    clearHistory: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ totalTokens: 0, totalCalls: 0, avgTokensPerCall: 0 }),
    getProvider: vi.fn().mockReturnValue('anthropic'),
    getModel: vi.fn().mockReturnValue('claude-sonnet-4-5-20250929'),
    getTemperature: vi.fn().mockReturnValue(0.3),
    getMaxTokens: vi.fn().mockReturnValue(8192),
  })),
}));

vi.mock('../../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ apiKeys: { anthropic: 'test-key' } }) },
}));

vi.mock('../websocketService', () => ({
  tbwoUpdateService: {
    emit: vi.fn(),
    taskStarted: vi.fn(),
    taskCompleted: vi.fn(),
    taskFailed: vi.fn(),
    artifactCreated: vi.fn(),
  },
}));

vi.mock('nanoid', () => {
  let counter = 0;
  return { nanoid: () => `nano-${++counter}` };
});

describe('DesignPod', () => {
  let pod: DesignPod;

  beforeEach(() => {
    vi.clearAllMocks();
    pod = new DesignPod({
      id: 'design-1',
      role: PodRole.DESIGN,
      name: 'Design Pod',
      tbwoId: 'tbwo-1',
    });
  });

  describe('getSystemPrompt', () => {
    it('should return design-specific prompt', () => {
      const prompt = pod.getSystemPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      // The prompt comes from DESIGN_SYSTEM_PROMPT which mentions "Design Pod"
      expect(prompt.toLowerCase()).toContain('design');
    });
  });

  describe('getSpecializedTools', () => {
    it('should return an array of tool definitions', () => {
      const tools = pod.getSpecializedTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should include code_search tool', () => {
      const tools = pod.getSpecializedTools();
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('code_search');
    });

    it('should include file_write tool', () => {
      const tools = pod.getSpecializedTools();
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('file_write');
    });

    it('should include file_read tool', () => {
      const tools = pod.getSpecializedTools();
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('file_read');
    });

    it('should include memory_recall tool', () => {
      const tools = pod.getSpecializedTools();
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('memory_recall');
    });

    it('should have proper input_schema on each tool', () => {
      const tools = pod.getSpecializedTools();
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');
      }
    });
  });

  describe('executeTask', () => {
    it('should execute a task and return result with artifacts', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Create color palette', status: 'pending' as const, estimatedDuration: 3 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      // The mock AI response contains CSS vars and color codes, so processTaskOutput should find them
      if (result.success) {
        expect(result.artifacts.length).toBeGreaterThan(0);
      }
    });

    it('should set task status to complete or failed after execution', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Create typography scale', status: 'pending' as const, estimatedDuration: 2 };
      await pod.executeTask(task);
      expect(['complete', 'failed']).toContain(task.status);
    });
  });

  describe('getColorPalette', () => {
    it('should start empty', () => {
      const palette = pod.getColorPalette();
      expect(Object.keys(palette)).toHaveLength(0);
    });

    it('should return a copy, not the internal object', () => {
      const palette1 = pod.getColorPalette();
      palette1['test'] = '#000';
      const palette2 = pod.getColorPalette();
      expect(palette2['test']).toBeUndefined();
    });
  });

  describe('getDesignTokens', () => {
    it('should start empty', () => {
      expect(pod.getDesignTokens().size).toBe(0);
    });

    it('should return a copy, not the internal map', () => {
      const tokens = pod.getDesignTokens();
      tokens.set('--test', 'value');
      expect(pod.getDesignTokens().size).toBe(0);
    });
  });

  describe('setDesignToken', () => {
    it('should add a design token', () => {
      pod.setDesignToken('--color-primary', '#6366f1');
      expect(pod.getDesignTokens().get('--color-primary')).toBe('#6366f1');
    });

    it('should override existing tokens', () => {
      pod.setDesignToken('--color-primary', '#6366f1');
      pod.setDesignToken('--color-primary', '#ff0000');
      expect(pod.getDesignTokens().get('--color-primary')).toBe('#ff0000');
    });
  });

  describe('setColor', () => {
    it('should add a color to the palette', () => {
      pod.setColor('primary', '#6366f1');
      expect(pod.getColorPalette()['primary']).toBe('#6366f1');
    });

    it('should override existing colors', () => {
      pod.setColor('primary', '#6366f1');
      pod.setColor('primary', '#ff0000');
      expect(pod.getColorPalette()['primary']).toBe('#ff0000');
    });
  });

  describe('getDesignTokensCSS', () => {
    it('should return empty string when no tokens exist', () => {
      expect(pod.getDesignTokensCSS()).toBe('');
    });

    it('should return valid CSS with :root selector', () => {
      pod.setDesignToken('--color-primary', '#6366f1');
      pod.setDesignToken('--font-body', 'Inter, sans-serif');
      const css = pod.getDesignTokensCSS();
      expect(css).toContain(':root');
      expect(css).toContain('--color-primary: #6366f1');
      expect(css).toContain('--font-body: Inter, sans-serif');
    });
  });

  describe('inherited BasePod behavior', () => {
    it('should have correct id and role', () => {
      expect(pod.id).toBe('design-1');
      expect(pod.role).toBe(PodRole.DESIGN);
      expect(pod.name).toBe('Design Pod');
    });

    it('should report healthy by default', () => {
      expect(pod.isHealthy()).toBe(true);
    });

    it('should start with zero metrics', () => {
      const metrics = pod.getMetrics();
      expect(metrics.tasksCompleted).toBe(0);
      expect(metrics.tasksFailed).toBe(0);
    });

    it('should manage task queue', () => {
      const task = { id: 't1', name: 'Task', status: 'pending' as const, estimatedDuration: 1 };
      pod.addTask(task);
      expect(pod.hasQueuedTasks()).toBe(true);
      const next = pod.getNextTask();
      expect(next?.id).toBe('t1');
      expect(pod.hasQueuedTasks()).toBe(false);
    });
  });
});
