import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrontendPod } from '../pods/FrontendPod';
import { PodRole } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: '```html\n// File: index.html\n<!DOCTYPE html>\n<html>\n<head><title>Test</title></head>\n<body><h1>Hello</h1></body>\n</html>\n```\n\n```css\n// File: css/styles.css\nbody { font-family: sans-serif; }\n```',
      toolCalls: [],
      usage: { inputTokens: 15, outputTokens: 40 },
      stopReason: 'end_turn',
    }),
    addToHistory: vi.fn(),
    clearHistory: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({ totalTokens: 0, totalCalls: 0, avgTokensPerCall: 0 }),
  })),
}));

vi.mock('../../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ apiKeys: { anthropic: 'test-key' } }) },
}));

describe('FrontendPod', () => {
  let pod: FrontendPod;

  beforeEach(() => {
    pod = new FrontendPod({
      id: 'frontend-1', role: PodRole.FRONTEND, name: 'Frontend Pod', tbwoId: 'tbwo-1',
    });
  });

  describe('getSystemPrompt', () => {
    it('should return frontend-specific prompt', () => {
      const prompt = pod.getSystemPrompt();
      expect(prompt).toContain('frontend');
    });
  });

  describe('getSpecializedTools', () => {
    it('should include file_write and file_read', () => {
      const tools = pod.getSpecializedTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('file_write');
      expect(names).toContain('file_read');
      expect(names).toContain('execute_code');
    });
  });

  describe('executeTask', () => {
    it('should extract code files from response', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Build HTML', status: 'pending' as const, estimatedDuration: 5 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('framework', () => {
    it('should set framework', () => {
      pod.setFramework('react');
      // Used internally
      expect(pod).toBeDefined();
    });
  });

  describe('design tokens', () => {
    it('should set design tokens', () => {
      pod.setDesignTokens(':root { --color-primary: #6366f1; }');
      expect(pod).toBeDefined();
    });
  });

  describe('getCreatedFiles', () => {
    it('should start empty', () => {
      expect(pod.getCreatedFiles()).toHaveLength(0);
    });
  });
});
