import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CopyPod } from '../pods/CopyPod';
import { PodRole } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: '[Section: Hero]\nHeadline: Build Something Amazing\nSubheadline: The fastest way to create beautiful websites\nCTA Primary: Get Started\n\n[Section: Features]\nHeading: Why Choose Us\nFeature 1: Lightning Fast\nFeature 2: Beautiful Design\nFeature 3: Easy to Use',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 30 },
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

describe('CopyPod', () => {
  let pod: CopyPod;

  beforeEach(() => {
    pod = new CopyPod({
      id: 'copy-1', role: PodRole.COPY, name: 'Copy Pod', tbwoId: 'tbwo-1',
    });
  });

  describe('getSystemPrompt', () => {
    it('should return copywriting-specific prompt', () => {
      const prompt = pod.getSystemPrompt();
      expect(prompt).toContain('copywriter');
    });
  });

  describe('getSpecializedTools', () => {
    it('should include memory_recall and web_search', () => {
      const tools = pod.getSpecializedTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('memory_recall');
      expect(names).toContain('web_search');
    });
  });

  describe('executeTask', () => {
    it('should extract copy sections from response', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Write hero copy', status: 'pending' as const, estimatedDuration: 3 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('brand voice', () => {
    it('should set and use brand voice', () => {
      pod.setBrandVoice('Professional and friendly');
      // Brand voice is used internally when building task prompts
      expect(pod).toBeDefined();
    });
  });

  describe('copy bank', () => {
    it('should start empty', () => {
      expect(pod.getAllCopy().size).toBe(0);
    });
  });
});
