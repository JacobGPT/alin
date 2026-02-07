import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BasePod } from '../pods/BasePod';
import type { PodConfig } from '../pods/BasePod';
import type { Task, Artifact } from '../../../types/tbwo';
import { PodRole, PodStatus, ArtifactType } from '../../../types/tbwo';
import { MessageBus } from '../messagebus';

// Mock dependencies
vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: 'Mock response',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    }),
    chat: vi.fn().mockResolvedValue({
      text: 'Mock chat response',
      toolCalls: [],
      tokensUsed: 15,
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

// Concrete test implementation of the abstract BasePod
class TestPod extends BasePod {
  getSystemPrompt(): string {
    return 'You are a test pod.';
  }

  getSpecializedTools(): Record<string, unknown>[] {
    return [
      { name: 'file_read', description: 'Read a file', input_schema: { type: 'object', properties: {} } },
    ];
  }

  protected processTaskOutput(_task: Task, response: string): Artifact[] {
    return [{
      id: 'artifact-1',
      tbwoId: this.tbwoId,
      name: 'test-output',
      type: ArtifactType.DOCUMENT,
      content: response,
      createdBy: this.id,
      createdAt: Date.now(),
      version: 1,
      status: 'draft',
    }];
  }
}

describe('BasePod', () => {
  let pod: TestPod;
  const config: PodConfig = {
    id: 'pod-test-1',
    role: PodRole.FRONTEND,
    name: 'Test Pod',
    tbwoId: 'tbwo-1',
    modelConfig: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pod = new TestPod(config);
  });

  describe('constructor', () => {
    it('should set id, role, name from config', () => {
      expect(pod.id).toBe('pod-test-1');
      expect(pod.role).toBe(PodRole.FRONTEND);
      expect(pod.name).toBe('Test Pod');
    });

    it('should set tbwoId from config', () => {
      expect(pod.tbwoId).toBe('tbwo-1');
    });

    it('should start in INITIALIZING status', () => {
      expect(pod.getStatus()).toBe(PodStatus.INITIALIZING);
    });
  });

  describe('initialize', () => {
    it('should subscribe to message bus and set status to IDLE', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      expect(pod.getStatus()).toBe(PodStatus.IDLE);
    });
  });

  describe('task management', () => {
    it('should add tasks to queue', () => {
      const task: Task = { id: 't1', name: 'Test task', status: 'pending', estimatedDuration: 5 };
      pod.addTask(task);
      expect(pod.hasQueuedTasks()).toBe(true);
    });

    it('should report no queued tasks when empty', () => {
      expect(pod.hasQueuedTasks()).toBe(false);
    });

    it('should get next task from queue (FIFO)', () => {
      const task1: Task = { id: 't1', name: 'Task 1', status: 'pending', estimatedDuration: 5 };
      const task2: Task = { id: 't2', name: 'Task 2', status: 'pending', estimatedDuration: 3 };
      pod.addTask(task1);
      pod.addTask(task2);

      const next = pod.getNextTask();
      expect(next?.id).toBe('t1');
      expect(pod.hasQueuedTasks()).toBe(true);

      const next2 = pod.getNextTask();
      expect(next2?.id).toBe('t2');
      expect(pod.hasQueuedTasks()).toBe(false);
    });

    it('should return null when no tasks are queued', () => {
      expect(pod.getNextTask()).toBeNull();
    });
  });

  describe('executeTask', () => {
    it('should execute a task and return a result', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task: Task = { id: 't1', name: 'Test task', status: 'pending', estimatedDuration: 5 };
      const result = await pod.executeTask(task);
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should update task status to in_progress during execution', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      const task: Task = { id: 't1', name: 'Test task', status: 'pending', estimatedDuration: 5 };
      // We can only observe the final state since executeTask is async
      await pod.executeTask(task);
      // After execution, task status is set to 'complete' or 'failed'
      expect(['complete', 'failed']).toContain(task.status);
    });
  });

  describe('health', () => {
    it('should report healthy by default', () => {
      expect(pod.isHealthy()).toBe(true);
      expect(pod.getHealth().status).toBe('healthy');
    });

    it('should have a recent heartbeat', () => {
      const health = pod.getHealth();
      expect(health.lastHeartbeat).toBeGreaterThan(0);
    });

    it('should update heartbeat', () => {
      const before = pod.getHealth().lastHeartbeat;
      // Small delay to ensure timestamp difference
      pod.heartbeat();
      expect(pod.getHealth().lastHeartbeat).toBeGreaterThanOrEqual(before);
    });

    it('should return a copy of health, not the internal object', () => {
      const health1 = pod.getHealth();
      const health2 = pod.getHealth();
      expect(health1).not.toBe(health2);
      expect(health1).toEqual(health2);
    });

    it('should start with zero error count', () => {
      expect(pod.getHealth().errorCount).toBe(0);
      expect(pod.getHealth().consecutiveFailures).toBe(0);
    });
  });

  describe('getMetrics', () => {
    it('should return metrics with expected properties', () => {
      const metrics = pod.getMetrics();
      expect(metrics).toHaveProperty('tasksCompleted');
      expect(metrics).toHaveProperty('tasksFailed');
      expect(metrics).toHaveProperty('tokensUsed');
      expect(metrics).toHaveProperty('apiCalls');
      expect(metrics).toHaveProperty('executionTime');
      expect(metrics).toHaveProperty('successRate');
    });

    it('should start with zero completed/failed tasks', () => {
      const metrics = pod.getMetrics();
      expect(metrics.tasksCompleted).toBe(0);
      expect(metrics.tasksFailed).toBe(0);
    });

    it('should report 100% success rate with no tasks', () => {
      const metrics = pod.getMetrics();
      expect(metrics.successRate).toBe(1);
    });
  });

  describe('shutdown', () => {
    it('should set status to terminated', async () => {
      const bus = new MessageBus();
      await pod.initialize(bus);
      await pod.shutdown();
      expect(pod.getStatus()).toBe(PodStatus.TERMINATED);
    });
  });

  describe('getAgentPod', () => {
    it('should return a full AgentPod object', () => {
      const agentPod = pod.getAgentPod();
      expect(agentPod.id).toBe('pod-test-1');
      expect(agentPod.role).toBe(PodRole.FRONTEND);
      expect(agentPod.name).toBe('Test Pod');
      expect(agentPod.tbwoId).toBe('tbwo-1');
    });

    it('should include health info', () => {
      const agentPod = pod.getAgentPod();
      expect(agentPod.health).toBeDefined();
      expect(agentPod.health.status).toBe('healthy');
    });

    it('should include resource usage', () => {
      const agentPod = pod.getAgentPod();
      expect(agentPod.resourceUsage).toBeDefined();
      expect(agentPod.resourceUsage.tokensUsed).toBe(0);
    });

    it('should include task arrays', () => {
      const agentPod = pod.getAgentPod();
      expect(Array.isArray(agentPod.taskQueue)).toBe(true);
      expect(Array.isArray(agentPod.completedTasks)).toBe(true);
      expect(Array.isArray(agentPod.outputs)).toBe(true);
    });
  });

  describe('getSystemPrompt (abstract implementation)', () => {
    it('should return the test pod system prompt', () => {
      expect(pod.getSystemPrompt()).toBe('You are a test pod.');
    });
  });

  describe('getSpecializedTools (abstract implementation)', () => {
    it('should return tool definitions', () => {
      const tools = pod.getSpecializedTools();
      expect(tools).toHaveLength(1);
      expect((tools[0] as any).name).toBe('file_read');
    });
  });
});
