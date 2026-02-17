import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIService } from '../aiService';

// Mock the claudeClient module
vi.mock('../../../api/claudeClient', () => ({
  createClaudeClient: vi.fn(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Hello world' }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    }),
    streamMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Streamed response' }],
      usage: { inputTokens: 8, outputTokens: 12 },
      stopReason: 'end_turn',
    }),
    continueWithToolResults: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Tool continuation response' }],
      usage: { inputTokens: 20, outputTokens: 15 },
      stopReason: 'end_turn',
    }),
  })),
}));

vi.mock('../../../api/openaiClient', () => ({
  createOpenAIClient: vi.fn(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'OpenAI response' }],
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: 'stop',
    }),
    streamMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'OpenAI streamed' }],
      usage: { promptTokens: 8, completionTokens: 12 },
      finishReason: 'stop',
    }),
  })),
}));

vi.mock('../../../store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      apiKeys: { anthropic: 'test-key', openai: 'test-key' },
      selectedModelVersions: { claude: 'claude-sonnet-4-5-20250929' },
      modelMode: 'claude',
    }),
  },
}));

describe('AIService', () => {
  let service: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIService({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: 'You are a test assistant.',
    });
  });

  describe('constructor', () => {
    it('should create an instance with config', () => {
      expect(service).toBeDefined();
    });

    it('should apply default values for optional config', () => {
      const minimal = new AIService({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' });
      const config = minimal.getConfig();
      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(8192);
      expect(config.systemPrompt).toBe('');
    });

    it('should preserve explicit config values', () => {
      const config = service.getConfig();
      expect(config.provider).toBe('anthropic');
      expect(config.model).toBe('claude-sonnet-4-5-20250929');
      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(4096);
      expect(config.systemPrompt).toBe('You are a test assistant.');
    });
  });

  describe('sendMessage', () => {
    it('should send a message and return response', async () => {
      const response = await service.sendMessage('Hello');
      expect(response).toBeDefined();
      expect(response.text).toBeDefined();
    });

    it('should track token usage after a call', async () => {
      await service.sendMessage('Hello');
      const metrics = service.getMetrics();
      expect(metrics.totalCalls).toBe(1);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should add user message to history', async () => {
      await service.sendMessage('Hello');
      const history = service.getHistory();
      // sendMessage adds user message, and if text is returned, also adds assistant message
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0]!.role).toBe('user');
      expect(history[0]!.content).toBe('Hello');
    });

    it('should return error response when no client is initialized', async () => {
      // Create a service with an unknown provider and no valid keys
      vi.mock('../../../store/settingsStore', () => ({
        useSettingsStore: {
          getState: () => ({
            apiKeys: {},
            selectedModelVersions: {},
            modelMode: 'claude',
          }),
        },
      }));
      const badService = new AIService({ provider: 'nonexistent', model: 'fake' });
      const response = await badService.sendMessage('Hello');
      expect(response.text).toContain('[Error]');
      expect(response.stopReason).toBe('error');
    });
  });

  describe('history management', () => {
    it('should add messages to history', () => {
      service.addToHistory('user', 'Hello');
      service.addToHistory('assistant', 'Hi there');
      expect(service.getHistory()).toHaveLength(2);
    });

    it('should return a copy of history, not the internal array', () => {
      service.addToHistory('user', 'Hello');
      const history = service.getHistory();
      history.push({ role: 'user', content: 'extra' });
      expect(service.getHistory()).toHaveLength(1);
    });

    it('should clear history', () => {
      service.addToHistory('user', 'Hello');
      service.addToHistory('assistant', 'Hi');
      service.clearHistory();
      expect(service.getHistory()).toHaveLength(0);
    });

    it('should trim history to max messages', () => {
      for (let i = 0; i < 20; i++) {
        service.addToHistory('user', `Message ${i}`);
      }
      service.trimHistory(5);
      expect(service.getHistory()).toHaveLength(5);
    });

    it('should not trim when history is already within limit', () => {
      service.addToHistory('user', 'A');
      service.addToHistory('assistant', 'B');
      service.trimHistory(5);
      expect(service.getHistory()).toHaveLength(2);
    });

    it('should report correct history length', () => {
      expect(service.getHistoryLength()).toBe(0);
      service.addToHistory('user', 'Hello');
      expect(service.getHistoryLength()).toBe(1);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics object with expected properties', () => {
      const metrics = service.getMetrics();
      expect(metrics).toHaveProperty('totalTokens');
      expect(metrics).toHaveProperty('totalCalls');
      expect(metrics).toHaveProperty('avgTokensPerCall');
    });

    it('should start with zero metrics', () => {
      const metrics = service.getMetrics();
      expect(metrics.totalTokens).toBe(0);
      expect(metrics.totalCalls).toBe(0);
      expect(metrics.avgTokensPerCall).toBe(0);
    });

    it('should reset metrics', () => {
      service.resetMetrics();
      const metrics = service.getMetrics();
      expect(metrics.totalTokens).toBe(0);
      expect(metrics.totalCalls).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should update system prompt', () => {
      service.setSystemPrompt('New prompt');
      expect(service.getConfig().systemPrompt).toBe('New prompt');
    });

    it('should update config without reinitializing on non-provider change', () => {
      service.updateConfig({ temperature: 0.5 });
      expect(service.getConfig().temperature).toBe(0.5);
    });
  });

  describe('static createForPod', () => {
    it('should create AIService from pod config', () => {
      const pod = {
        id: 'pod-1',
        role: 'frontend',
        name: 'Frontend Pod',
        tbwoId: 'tbwo-1',
        modelConfig: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
        },
      } as any;
      const podService = AIService.createForPod(pod);
      expect(podService).toBeDefined();
      expect(podService).toBeInstanceOf(AIService);
    });
  });

  describe('static createForRole', () => {
    it('should create AIService for a role', () => {
      const roleService = AIService.createForRole('design' as any);
      expect(roleService).toBeDefined();
      expect(roleService).toBeInstanceOf(AIService);
    });
  });

  describe('static getDefaultModel', () => {
    it('should return a model string', () => {
      const model = AIService.getDefaultModel();
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    });
  });

  describe('static getDefaultProvider', () => {
    it('should return a provider string', () => {
      const provider = AIService.getDefaultProvider();
      expect(typeof provider).toBe('string');
      expect(['anthropic', 'openai']).toContain(provider);
    });
  });
});
