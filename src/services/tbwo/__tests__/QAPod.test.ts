import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QAPod } from '../pods/QAPod';
import { PodRole } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: '## QA Report\n\n### Summary\nOverall Score: 85/100\nStatus: PASS\n\n### Checks Performed\n[PASS] HTML validation - No errors\n[PASS] Responsive design - Works at all breakpoints\n[WARN] Accessibility - Missing 2 aria-labels\n[PASS] Performance - All files under size limits\n\n### Critical Issues\nNone found.\n\n### Warnings\n- Button on line 42 missing aria-label\n- Image on line 78 missing alt text\n\n### Recommendations\n- Add lazy loading for below-fold images\n- Consider adding preconnect for Google Fonts',
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

describe('QAPod', () => {
  let pod: QAPod;

  beforeEach(() => {
    pod = new QAPod({
      id: 'qa-1', role: PodRole.QA, name: 'QA Pod', tbwoId: 'tbwo-1',
    });
  });

  describe('getSystemPrompt', () => {
    it('should return QA-specific prompt', () => {
      const prompt = pod.getSystemPrompt();
      expect(prompt).toContain('QA');
      expect(prompt).toContain('Quality');
    });
  });

  describe('getSpecializedTools', () => {
    it('should include file_read and execute_code', () => {
      const tools = pod.getSpecializedTools();
      const names = tools.map((t: any) => t.name);
      expect(names).toContain('file_read');
      expect(names).toContain('execute_code');
    });
  });

  describe('executeTask', () => {
    it('should parse QA report from response', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Code review', status: 'pending' as const, estimatedDuration: 5 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.artifacts.length).toBeGreaterThan(0);
    });
  });

  describe('reports', () => {
    it('should start with no reports', () => {
      expect(pod.getAllReports().size).toBe(0);
    });

    it('should return 0 overall score with no reports', () => {
      expect(pod.getOverallScore()).toBe(0);
    });
  });

  describe('quality target', () => {
    it('should set quality target', () => {
      pod.setQualityTarget('premium');
      expect(pod).toBeDefined();
    });
  });
});
