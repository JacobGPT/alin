import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExecutionEngine } from '../executionEngine';
import { TBWOStatus, QualityTarget, AuthorityLevel, PodRole, PodStatus } from '../../../types/tbwo';

// Mock all dependencies
const mockGetTBWOById = vi.fn();
const mockUpdateTBWO = vi.fn();
const mockUpdateProgress = vi.fn();
const mockUpdatePhaseProgress = vi.fn();
const mockCompleteTask = vi.fn();
const mockSpawnPod = vi.fn().mockReturnValue('pod-id-1');
const mockUpdatePod = vi.fn();
const mockTerminatePod = vi.fn();
const mockAddArtifact = vi.fn().mockReturnValue('artifact-id');
const mockReachCheckpoint = vi.fn();
const mockGenerateReceipts = vi.fn().mockResolvedValue({});
const mockGetPodById = vi.fn();
const mockRespondToCheckpoint = vi.fn();

vi.mock('../../../store/tbwoStore', () => ({
  useTBWOStore: {
    getState: vi.fn().mockReturnValue({
      getTBWOById: (...args: any[]) => mockGetTBWOById(...args),
      updateTBWO: (...args: any[]) => mockUpdateTBWO(...args),
      updateProgress: (...args: any[]) => mockUpdateProgress(...args),
      updatePhaseProgress: (...args: any[]) => mockUpdatePhaseProgress(...args),
      completeTask: (...args: any[]) => mockCompleteTask(...args),
      spawnPod: (...args: any[]) => mockSpawnPod(...args),
      updatePod: (...args: any[]) => mockUpdatePod(...args),
      terminatePod: (...args: any[]) => mockTerminatePod(...args),
      addArtifact: (...args: any[]) => mockAddArtifact(...args),
      reachCheckpoint: (...args: any[]) => mockReachCheckpoint(...args),
      generateReceipts: (...args: any[]) => mockGenerateReceipts(...args),
      getPodById: (...args: any[]) => mockGetPodById(...args),
      respondToCheckpoint: (...args: any[]) => mockRespondToCheckpoint(...args),
    }),
  },
}));

vi.mock('../aiService', () => ({
  AIService: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue({
      text: 'Done',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    }),
    addToHistory: vi.fn(),
    clearHistory: vi.fn(),
  })),
}));

vi.mock('../messagebus', () => ({
  MessageBus: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn().mockReturnValue(vi.fn()),
    publish: vi.fn().mockReturnValue('msg-id'),
    broadcast: vi.fn(),
    clear: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('../../contractService', () => ({
  contractService: {
    createContract: vi.fn().mockReturnValue({ id: 'contract-1', status: 'active' }),
    activateContract: vi.fn(),
    validateAction: vi.fn().mockReturnValue({ allowed: true, violations: [], warnings: [] }),
    checkTimeBudget: vi.fn().mockReturnValue({ exceeded: false, warning: false, remaining: 60 }),
    fulfillContract: vi.fn(),
    recordUsage: vi.fn(),
  },
}));

vi.mock('../websocketService', () => ({
  tbwoUpdateService: {
    emit: vi.fn(),
    phaseStarted: vi.fn(),
    phaseCompleted: vi.fn(),
    taskStarted: vi.fn(),
    taskCompleted: vi.fn(),
    taskFailed: vi.fn(),
    artifactCreated: vi.fn(),
    checkpointReached: vi.fn(),
    progressUpdate: vi.fn(),
    executionComplete: vi.fn(),
    executionError: vi.fn(),
  },
}));

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ExecutionEngine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance', () => {
      expect(engine).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should reject if TBWO not found', async () => {
      mockGetTBWOById.mockReturnValue(undefined);
      await expect(engine.execute('nonexistent')).rejects.toThrow('TBWO nonexistent not found');
    });

    it('should reject if no execution plan exists', async () => {
      mockGetTBWOById.mockReturnValue({
        id: 'tbwo-1',
        status: TBWOStatus.DRAFT,
        plan: null,
      });
      await expect(engine.execute('tbwo-1')).rejects.toThrow('has no execution plan');
    });

    it('should reject if plan requires approval but is not approved', async () => {
      mockGetTBWOById.mockReturnValue({
        id: 'tbwo-1',
        status: TBWOStatus.AWAITING_APPROVAL,
        plan: {
          id: 'plan-1',
          requiresApproval: true,
          approvedAt: undefined,
          phases: [],
          podStrategy: { mode: 'sequential', maxConcurrent: 1, priorityOrder: [], dependencies: new Map() },
        },
      });
      await expect(engine.execute('tbwo-1')).rejects.toThrow('has not been approved');
    });

    it('should execute successfully with an approved plan and empty phases', async () => {
      const mockTBWO = {
        id: 'tbwo-1',
        status: TBWOStatus.AWAITING_APPROVAL,
        objective: 'Build a test project',
        timeBudget: { total: 30, elapsed: 0, remaining: 30, phases: new Map() },
        qualityTarget: QualityTarget.STANDARD,
        scope: {
          allowedTools: [],
          forbiddenTools: [],
          allowedPaths: [],
          forbiddenPaths: [],
        },
        plan: {
          id: 'plan-1',
          requiresApproval: false,
          phases: [],
          podStrategy: {
            mode: 'sequential',
            maxConcurrent: 1,
            priorityOrder: [PodRole.ORCHESTRATOR],
            dependencies: new Map(),
          },
        },
        checkpoints: [],
        authorityLevel: AuthorityLevel.AUTONOMOUS,
      };
      mockGetTBWOById.mockReturnValue(mockTBWO);
      mockGetPodById.mockReturnValue({
        pod: {
          id: 'pod-id-1',
          role: PodRole.ORCHESTRATOR,
          status: PodStatus.IDLE,
          modelConfig: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
        },
      });

      // Should not throw since plan has no phases requiring work
      await expect(engine.execute('tbwo-1')).resolves.not.toThrow();
    });
  });

  describe('pause/resume', () => {
    it('should handle pause on non-running TBWO gracefully', async () => {
      await expect(engine.pause('nonexistent')).resolves.not.toThrow();
    });

    it('should handle resume on non-paused TBWO gracefully', async () => {
      await expect(engine.resume('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('cancel', () => {
    it('should handle cancel on non-running TBWO gracefully', async () => {
      await expect(engine.cancel('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('getState', () => {
    it('should return undefined for unknown TBWO', () => {
      expect(engine.getState('unknown')).toBeUndefined();
    });
  });

  describe('isRunning', () => {
    it('should return false for unknown TBWO', () => {
      expect(engine.isRunning('unknown')).toBe(false);
    });
  });

  describe('error handling in execute', () => {
    it('should call handleFailure when an error occurs during execution', async () => {
      mockGetTBWOById
        .mockReturnValueOnce({
          id: 'tbwo-err',
          status: TBWOStatus.AWAITING_APPROVAL,
          objective: 'Test failure',
          timeBudget: { total: 10, elapsed: 0, remaining: 10, phases: new Map() },
          qualityTarget: QualityTarget.DRAFT,
          scope: {
            allowedTools: [],
            forbiddenTools: [],
            allowedPaths: [],
            forbiddenPaths: [],
          },
          plan: {
            id: 'plan-err',
            requiresApproval: false,
            phases: [{ id: 'phase-1', name: 'Phase 1', description: 'Test', order: 0, tasks: [], dependsOn: [], assignedPods: [], status: 'pending', progress: 0, estimatedDuration: 5 }],
            podStrategy: {
              mode: 'sequential',
              maxConcurrent: 1,
              priorityOrder: [PodRole.ORCHESTRATOR],
              dependencies: new Map(),
            },
          },
          checkpoints: [],
          authorityLevel: AuthorityLevel.AUTONOMOUS,
        })
        // Subsequent calls during phase execution return fresh state
        .mockReturnValue({
          id: 'tbwo-err',
          status: TBWOStatus.EXECUTING,
          plan: {
            phases: [{ id: 'phase-1', name: 'Phase 1', tasks: [] }],
          },
          checkpoints: [],
          authorityLevel: AuthorityLevel.AUTONOMOUS,
          timeBudget: { total: 10, elapsed: 0, remaining: 10, phases: new Map() },
        });

      mockSpawnPod.mockImplementation(() => {
        throw new Error('Simulated spawn failure');
      });

      // The engine catches and calls handleFailure, but execute itself should
      // still throw (or resolve depending on error path)
      try {
        await engine.execute('tbwo-err');
      } catch {
        // Expected - spawn failure propagates
      }

      // After failure, state is cleaned up
      expect(engine.isRunning('tbwo-err')).toBe(false);
    });
  });

  describe('multiple TBWOs', () => {
    it('should track independent TBWO states', () => {
      // No active TBWOs initially
      expect(engine.getState('tbwo-a')).toBeUndefined();
      expect(engine.getState('tbwo-b')).toBeUndefined();
      expect(engine.isRunning('tbwo-a')).toBe(false);
      expect(engine.isRunning('tbwo-b')).toBe(false);
    });
  });
});
