import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrchestratorPod } from '../pods/OrchestratorPod';
import { PodRole } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: '## Plan\n1. Design\n2. Build\n3. Test',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 20 },
      stopReason: 'end_turn',
    }),
    chat: vi.fn().mockResolvedValue({
      text: '## Plan\n1. Design\n2. Build\n3. Test',
      toolCalls: [],
      tokensUsed: 30,
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

describe('OrchestratorPod', () => {
  let pod: OrchestratorPod;

  beforeEach(() => {
    vi.clearAllMocks();
    pod = new OrchestratorPod({
      id: 'orch-1',
      role: PodRole.ORCHESTRATOR,
      name: 'Orchestrator',
      tbwoId: 'tbwo-1',
    });
  });

  describe('getSystemPrompt', () => {
    it('should return orchestrator system prompt', () => {
      const prompt = pod.getSystemPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      // The prompt comes from the imported ORCHESTRATOR_SYSTEM_PROMPT
      expect(prompt).toContain('Orchestrator');
    });
  });

  describe('getSpecializedTools', () => {
    it('should return an array of tool definitions', () => {
      const tools = pod.getSpecializedTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should include scan_directory tool', () => {
      const tools = pod.getSpecializedTools();
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('scan_directory');
    });

    it('should include memory tools', () => {
      const tools = pod.getSpecializedTools();
      const toolNames = tools.map((t: any) => t.name);
      expect(toolNames).toContain('memory_store');
      expect(toolNames).toContain('memory_recall');
    });
  });

  describe('pod registry', () => {
    it('should register pods', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      pod.registerPod('pod-2', 'DESIGN');
      const registered = pod.getRegisteredPods();
      expect(registered.size).toBe(2);
    });

    it('should unregister pods', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      pod.unregisterPod('pod-1');
      expect(pod.getRegisteredPods().size).toBe(0);
    });

    it('should update pod status', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      pod.updatePodStatus('pod-1', 'busy');
      const registered = pod.getRegisteredPods();
      expect(registered.get('pod-1')?.status).toBe('busy');
    });

    it('should find pods by role', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      pod.registerPod('pod-2', 'FRONTEND');
      pod.registerPod('pod-3', 'DESIGN');
      const frontendPods = pod.findPodsByRole('FRONTEND');
      expect(frontendPods).toHaveLength(2);
      expect(frontendPods).toContain('pod-1');
      expect(frontendPods).toContain('pod-2');
    });

    it('should count active pods', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      pod.registerPod('pod-2', 'DESIGN');
      expect(pod.getActivePodCount()).toBe(2);
    });

    it('should not count inactive pods', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      pod.updatePodStatus('pod-1', 'terminated');
      // findPodsByRole only returns 'active' status pods
      expect(pod.findPodsByRole('FRONTEND')).toHaveLength(0);
    });

    it('should return a copy of registered pods', () => {
      pod.registerPod('pod-1', 'FRONTEND');
      const copy = pod.getRegisteredPods();
      copy.delete('pod-1'); // Modifying the copy
      expect(pod.getRegisteredPods().size).toBe(1); // Original not affected
    });
  });

  describe('delegateTask', () => {
    it('should publish task to message bus', async () => {
      const bus = new MessageBus();
      const publishSpy = vi.spyOn(bus, 'publish');
      await pod.initialize(bus);

      const task = { id: 't1', name: 'Test', status: 'pending' as const, estimatedDuration: 5 };
      await pod.delegateTask(task, 'pod-2');

      expect(publishSpy).toHaveBeenCalledWith(expect.objectContaining({
        from: 'orch-1',
        to: 'pod-2',
        type: 'task_assignment',
        priority: 'high',
      }));
    });

    it('should not throw if message bus is not initialized', async () => {
      const task = { id: 't1', name: 'Test', status: 'pending' as const, estimatedDuration: 5 };
      await expect(pod.delegateTask(task, 'pod-2')).resolves.not.toThrow();
    });
  });

  describe('delegateTaskBatch', () => {
    it('should delegate multiple tasks', async () => {
      const bus = new MessageBus();
      const publishSpy = vi.spyOn(bus, 'publish');
      await pod.initialize(bus);

      const assignments = [
        { podId: 'pod-2', task: { id: 't1', name: 'Task 1', status: 'pending' as const, estimatedDuration: 3 } },
        { podId: 'pod-3', task: { id: 't2', name: 'Task 2', status: 'pending' as const, estimatedDuration: 4 } },
      ];
      await pod.delegateTaskBatch(assignments);

      expect(publishSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('requestStatusFromAll', () => {
    it('should broadcast a question to all pods', async () => {
      const bus = new MessageBus();
      const broadcastSpy = vi.spyOn(bus, 'broadcast');
      await pod.initialize(bus);

      await pod.requestStatusFromAll();
      expect(broadcastSpy).toHaveBeenCalledWith(
        'orch-1',
        'question',
        expect.objectContaining({ question: expect.any(String) }),
      );
    });
  });

  describe('broadcastUpdate', () => {
    it('should broadcast a status_update', async () => {
      const bus = new MessageBus();
      const broadcastSpy = vi.spyOn(bus, 'broadcast');
      await pod.initialize(bus);

      await pod.broadcastUpdate({ type: 'phase_change', message: 'Moving to phase 2' });
      expect(broadcastSpy).toHaveBeenCalledWith(
        'orch-1',
        'status_update',
        expect.objectContaining({ type: 'phase_change', message: 'Moving to phase 2' }),
      );
    });
  });

  describe('executeTask', () => {
    it('should process orchestrator tasks and return result', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task = { id: 't1', name: 'Plan execution', status: 'pending' as const, estimatedDuration: 5 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
    });
  });
});
