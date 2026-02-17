import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageBus } from '../messagebus';

// Mock nanoid to produce predictable IDs
vi.mock('nanoid', () => {
  let counter = 0;
  return {
    nanoid: () => `id-${++counter}`,
  };
});

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('subscribe/publish', () => {
    it('should deliver messages to subscribers', () => {
      const handler = vi.fn();
      bus.subscribe('pod-1', handler);
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: { status: 'ready' }, priority: 'normal' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        from: 'pod-2',
        to: 'pod-1',
        type: 'status_update',
      }));
    });

    it('should not deliver messages to wrong pod', () => {
      const handler = vi.fn();
      bus.subscribe('pod-1', handler);
      bus.publish({ from: 'pod-2', to: 'pod-3', type: 'status_update', payload: {}, priority: 'normal' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should deliver broadcast messages to all subscribers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.subscribe('pod-1', handler1);
      bus.subscribe('pod-2', handler2);
      bus.broadcast('system', 'broadcast', { message: 'hello all' });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should support unsubscribe', () => {
      const handler = vi.fn();
      const unsub = bus.subscribe('pod-1', handler);
      unsub();
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return a message ID from publish', () => {
      const id = bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should queue messages for pods not yet subscribed', () => {
      // Publish before anyone subscribes
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: { data: 'queued' }, priority: 'normal' });
      const pending = bus.getPendingDelivery('pod-1');
      expect(pending.length).toBe(1);

      // Now subscribe and receive the pending message
      const handler = vi.fn();
      bus.subscribe('pod-1', handler);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('acknowledge', () => {
    it('should mark messages as acknowledged', () => {
      const handler = vi.fn();
      bus.subscribe('pod-1', handler);
      const id = bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      bus.acknowledge(id);
      expect(bus.getUnacknowledged('pod-1')).toHaveLength(0);
    });

    it('should handle acknowledging non-existent messages gracefully', () => {
      // Should not throw
      bus.acknowledge('nonexistent-id');
    });
  });

  describe('filter', () => {
    it('should filter by message type', () => {
      const handler = vi.fn();
      bus.subscribe('pod-1', handler, { types: ['task_assignment'] });
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'task_assignment', payload: {}, priority: 'normal' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'task_assignment' }));
    });

    it('should filter by sender', () => {
      const handler = vi.fn();
      bus.subscribe('pod-1', handler, { from: ['pod-3'] });
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      bus.publish({ from: 'pod-3', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ from: 'pod-3' }));
    });
  });

  describe('request/respond', () => {
    it('should support request/response pattern', async () => {
      bus.subscribe('pod-1', (msg) => {
        if (msg.type === 'question') {
          bus.respond(msg.id, 'pod-1', { answer: 42 });
        }
      });
      const response = await bus.request('pod-2', 'pod-1', { question: 'what is the answer?' }, 1000);
      expect(response).toBeDefined();
      expect((response?.payload as any)?.answer).toBe(42);
    });

    it('should return null on timeout', async () => {
      // No subscriber to respond
      const response = await bus.request('pod-2', 'pod-1', { question: 'hello?' }, 50);
      expect(response).toBeNull();
    });
  });

  describe('getMessagesForPod', () => {
    it('should return messages for a specific pod', () => {
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      bus.publish({ from: 'pod-3', to: 'pod-1', type: 'result', payload: {}, priority: 'normal' });
      bus.publish({ from: 'pod-2', to: 'pod-3', type: 'status_update', payload: {}, priority: 'normal' });
      const messages = bus.getMessagesForPod('pod-1');
      expect(messages).toHaveLength(2);
    });

    it('should include broadcast messages', () => {
      bus.broadcast('system', 'broadcast', {});
      const messages = bus.getMessagesForPod('any-pod');
      expect(messages).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('should return stats', () => {
      bus.subscribe('pod-1', vi.fn());
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      const stats = bus.getStats();
      expect(stats.totalMessages).toBe(1);
      expect(stats.subscriptions).toBe(1);
    });

    it('should count unacknowledged messages', () => {
      bus.subscribe('pod-1', vi.fn());
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      const stats = bus.getStats();
      expect(stats.unacknowledgedCount).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all messages', () => {
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      bus.clear();
      expect(bus.getStats().totalMessages).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should clear subscriptions and messages', () => {
      bus.subscribe('pod-1', vi.fn());
      bus.publish({ from: 'pod-2', to: 'pod-1', type: 'status_update', payload: {}, priority: 'normal' });
      bus.destroy();
      expect(bus.getStats().totalMessages).toBe(0);
      expect(bus.getStats().subscriptions).toBe(0);
    });
  });

  describe('getDetailedStats', () => {
    it('should return type and priority breakdowns', () => {
      bus.publish({ from: 'pod-1', to: 'pod-2', type: 'status_update', payload: {}, priority: 'normal' });
      bus.publish({ from: 'pod-1', to: 'pod-2', type: 'task_assignment', payload: {}, priority: 'high' });
      const stats = bus.getDetailedStats();
      expect(stats.byType['status_update']).toBe(1);
      expect(stats.byType['task_assignment']).toBe(1);
      expect(stats.byPriority['normal']).toBe(1);
      expect(stats.byPriority['high']).toBe(1);
      expect(stats.activePods).toContain('pod-1');
    });
  });
});
