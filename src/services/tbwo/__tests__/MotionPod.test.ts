import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MotionPod } from '../pods/MotionPod';
import { PodRole } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: '```css\n@keyframes fadeIn {\n  from { opacity: 0; transform: translateY(20px); }\n  to { opacity: 1; transform: translateY(0); }\n}\n\n.hero { animation: fadeIn 0.6s ease-out; }\n```\n\nDuration: 600ms, Easing: ease-out',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 25 },
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

describe('MotionPod', () => {
  let pod: MotionPod;

  beforeEach(() => {
    pod = new MotionPod({
      id: 'motion-1', role: PodRole.MOTION, name: 'Motion Pod', tbwoId: 'tbwo-1',
    });
  });

  describe('getSystemPrompt', () => {
    it('should return motion-specific prompt', () => {
      const prompt = pod.getSystemPrompt();
      expect(prompt).toContain('Animation');
    });
  });

  describe('executeTask', () => {
    it('should extract CSS animations from response', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Create entrance animations', status: 'pending' as const, estimatedDuration: 4 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('getAnimationSpecs', () => {
    it('should start empty', () => {
      expect(pod.getAnimationSpecs().size).toBe(0);
    });
  });

  describe('getAllAnimationCSS', () => {
    it('should return empty string initially', () => {
      expect(pod.getAllAnimationCSS()).toBe('');
    });
  });
});
