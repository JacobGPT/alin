/**
 * TBWO Message Bus - Event-Driven Inter-Pod Communication
 *
 * A standalone, improved message bus extracted from the inline MessageBus class
 * in tbwoExecutor.ts. Provides reliable inter-pod communication with:
 *
 * - Pub/sub messaging with targeted and broadcast delivery
 * - Request/response pattern with timeout support
 * - Message filtering by type and sender
 * - Pending delivery queue for offline pods
 * - Message acknowledgment tracking
 * - Priority levels (low, normal, high, critical)
 * - Message expiration
 * - Correlation IDs for request/response pairing
 * - Comprehensive statistics
 * - Singleton instance for global coordination
 */

import { nanoid } from 'nanoid';
// Types are defined locally in this module

// ============================================================================
// TYPES
// ============================================================================

export type MessageType =
  | 'task_assignment'
  | 'status_update'
  | 'question'
  | 'result'
  | 'error'
  | 'broadcast'
  | 'heartbeat'
  | 'artifact_ready'
  | 'clarification_request';

export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

export interface BusMessage {
  id: string;
  from: string;            // Pod ID or 'system'
  to: string;              // Pod ID or '*' for broadcast
  type: MessageType;
  payload: unknown;
  timestamp: number;
  correlationId?: string;  // For request/response pairing
  priority: MessagePriority;
  acknowledged: boolean;
  expiresAt?: number;      // Unix timestamp for message expiration
}

export type MessageHandler = (message: BusMessage) => void;

export interface SubscriptionFilter {
  types?: MessageType[];
  from?: string[];
}

interface Subscription {
  id: string;
  podId: string;
  handler: MessageHandler;
  filter?: SubscriptionFilter;
}

interface PendingRequest {
  resolve: (message: BusMessage | null) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface MessageBusStats {
  totalMessages: number;
  pending: number;
  subscriptions: number;
  unacknowledgedCount: number;
}

// ============================================================================
// MESSAGE BUS CLASS
// ============================================================================

export class MessageBus {
  private subscriptions = new Map<string, Subscription>();
  private messageHistory: BusMessage[] = [];
  private pendingDelivery = new Map<string, BusMessage[]>();
  private requestCallbacks = new Map<string, PendingRequest>();
  private maxHistory = 1000;

  // ==========================================================================
  // SUBSCRIBE / UNSUBSCRIBE
  // ==========================================================================

  /**
   * Subscribe a pod to receive messages. Returns an unsubscribe function.
   *
   * @param podId - The pod ID to subscribe
   * @param handler - Callback invoked when a matching message arrives
   * @param filter - Optional filter to receive only certain message types or senders
   * @returns Unsubscribe function
   */
  subscribe(
    podId: string,
    handler: MessageHandler,
    filter?: SubscriptionFilter,
  ): () => void {
    const subscriptionId = nanoid();

    const subscription: Subscription = {
      id: subscriptionId,
      podId,
      handler,
      filter,
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Deliver any pending messages for this pod
    const pending = this.pendingDelivery.get(podId);
    if (pending && pending.length > 0) {
      const toDeliver = [...pending];
      this.pendingDelivery.delete(podId);

      for (const message of toDeliver) {
        if (this.matchesFilter(message, filter)) {
          try {
            handler(message);
          } catch (error) {
            console.error(`[MessageBus] Error delivering pending message to ${podId}:`, error);
          }
        }
      }
    }

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscriptionId);
    };
  }

  // ==========================================================================
  // PUBLISHING
  // ==========================================================================

  /**
   * Publish a message to the bus. Delivers to matching subscribers immediately,
   * or queues for later delivery if the target pod has no active subscription.
   *
   * @param message - Message without id, timestamp, or acknowledged fields (auto-generated)
   * @returns The generated message ID
   */
  publish(
    message: Omit<BusMessage, 'id' | 'timestamp' | 'acknowledged'>,
  ): string {
    const fullMessage: BusMessage = {
      ...message,
      id: nanoid(),
      timestamp: Date.now(),
      acknowledged: false,
    };

    // Add to history
    this.messageHistory.push(fullMessage);
    this.trimHistory();

    // Check if message has expired before delivery
    if (fullMessage.expiresAt && fullMessage.expiresAt < Date.now()) {
      return fullMessage.id;
    }

    if (fullMessage.to === '*') {
      // Broadcast: deliver to all subscribers
      this.deliverBroadcast(fullMessage);
    } else {
      // Targeted: deliver to specific pod
      this.deliverTargeted(fullMessage);
    }

    // Check if this message is a response to a pending request
    if (fullMessage.correlationId) {
      const pendingRequest = this.requestCallbacks.get(fullMessage.correlationId);
      if (pendingRequest) {
        clearTimeout(pendingRequest.timeout);
        this.requestCallbacks.delete(fullMessage.correlationId);
        pendingRequest.resolve(fullMessage);
      }
    }

    return fullMessage.id;
  }

  /**
   * Broadcast a message to all subscribed pods.
   * Convenience wrapper around publish() with to='*'.
   *
   * @param from - Sender pod ID or 'system'
   * @param type - Message type
   * @param payload - Message payload
   * @param priority - Optional priority (defaults to 'normal')
   * @returns The generated message ID
   */
  broadcast(
    from: string,
    type: MessageType,
    payload: unknown,
    priority: MessagePriority = 'normal',
  ): string {
    return this.publish({
      from,
      to: '*',
      type,
      payload,
      priority,
    });
  }

  // ==========================================================================
  // REQUEST / RESPONSE PATTERN
  // ==========================================================================

  /**
   * Send a request to a specific pod and await a correlated response.
   * Returns null if the request times out.
   *
   * @param fromPod - Sender pod ID
   * @param toPod - Target pod ID
   * @param payload - Request payload
   * @param timeoutMs - Timeout in milliseconds (default 30000)
   * @returns The response BusMessage, or null on timeout
   */
  async request(
    fromPod: string,
    toPod: string,
    payload: unknown,
    timeoutMs: number = 30000,
  ): Promise<BusMessage | null> {
    const correlationId = nanoid();

    // Publish the request message with correlationId
    this.publish({
      from: fromPod,
      to: toPod,
      type: 'question',
      payload,
      priority: 'normal',
      correlationId,
    });

    // Wait for a response with the same correlationId
    return new Promise<BusMessage | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestCallbacks.delete(correlationId);
        resolve(null);
      }, timeoutMs);

      this.requestCallbacks.set(correlationId, {
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Send a response to a previously received request message.
   * Uses the original message's correlationId (or its id) for correlation.
   *
   * @param originalMessageId - The id of the original request message
   * @param fromPod - The responding pod's ID
   * @param payload - The response payload
   */
  respond(originalMessageId: string, fromPod: string, payload: unknown): void {
    // Find the original message to get its correlationId and sender
    const originalMessage = this.messageHistory.find((m) => m.id === originalMessageId);
    if (!originalMessage) {
      console.warn(`[MessageBus] Cannot respond: original message ${originalMessageId} not found`);
      return;
    }

    // Use the original message's correlationId if it has one, otherwise use its id
    const correlationId = originalMessage.correlationId || originalMessage.id;

    this.publish({
      from: fromPod,
      to: originalMessage.from,
      type: 'result',
      payload,
      priority: originalMessage.priority,
      correlationId,
    });
  }

  // ==========================================================================
  // MESSAGE MANAGEMENT
  // ==========================================================================

  /**
   * Mark a message as acknowledged.
   */
  acknowledge(messageId: string): void {
    const message = this.messageHistory.find((m) => m.id === messageId);
    if (message) {
      message.acknowledged = true;
    }
  }

  /**
   * Get all messages addressed to a specific pod, optionally filtered by time.
   *
   * @param podId - Target pod ID
   * @param since - Optional timestamp; only return messages after this time
   * @returns Array of matching messages
   */
  getMessagesForPod(podId: string, since?: number): BusMessage[] {
    return this.messageHistory.filter(
      (m) =>
        (m.to === podId || m.to === '*') &&
        (!since || m.timestamp > since) &&
        !this.isExpired(m),
    );
  }

  /**
   * Get all unacknowledged messages for a specific pod.
   */
  getUnacknowledged(podId: string): BusMessage[] {
    return this.messageHistory.filter(
      (m) =>
        (m.to === podId || m.to === '*') &&
        !m.acknowledged &&
        !this.isExpired(m),
    );
  }

  /**
   * Get messages that are queued for delivery (target pod not yet subscribed).
   */
  getPendingDelivery(podId: string): BusMessage[] {
    return this.pendingDelivery.get(podId) || [];
  }

  /**
   * Get a specific message by ID.
   */
  getMessage(messageId: string): BusMessage | undefined {
    return this.messageHistory.find((m) => m.id === messageId);
  }

  /**
   * Get messages filtered by type.
   */
  getMessagesByType(type: MessageType, limit?: number): BusMessage[] {
    const filtered = this.messageHistory.filter(
      (m) => m.type === type && !this.isExpired(m),
    );
    return limit ? filtered.slice(-limit) : filtered;
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Clear all message history and pending deliveries.
   * Does not affect active subscriptions.
   */
  clear(): void {
    this.messageHistory = [];
    this.pendingDelivery.clear();

    // Clear pending request timeouts
    for (const [, pending] of this.requestCallbacks) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.requestCallbacks.clear();
  }

  /**
   * Fully destroy the message bus. Clears all subscriptions, pending messages,
   * request callbacks, and message history.
   */
  destroy(): void {
    // Clear all pending request timeouts
    for (const [, pending] of this.requestCallbacks) {
      clearTimeout(pending.timeout);
      pending.resolve(null);
    }
    this.requestCallbacks.clear();

    // Clear all state
    this.subscriptions.clear();
    this.messageHistory = [];
    this.pendingDelivery.clear();
  }

  // ==========================================================================
  // STATISTICS
  // ==========================================================================

  /**
   * Get current bus statistics.
   */
  getStats(): MessageBusStats {
    let pendingCount = 0;
    for (const [, messages] of this.pendingDelivery) {
      pendingCount += messages.length;
    }

    const unacknowledgedCount = this.messageHistory.filter(
      (m) => !m.acknowledged && !this.isExpired(m),
    ).length;

    return {
      totalMessages: this.messageHistory.length,
      pending: pendingCount,
      subscriptions: this.subscriptions.size,
      unacknowledgedCount,
    };
  }

  /**
   * Get detailed statistics broken down by message type and priority.
   */
  getDetailedStats(): {
    totalMessages: number;
    pending: number;
    subscriptions: number;
    unacknowledgedCount: number;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
    activePods: string[];
  } {
    const basic = this.getStats();
    const byType: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const podSet = new Set<string>();

    for (const message of this.messageHistory) {
      byType[message.type] = (byType[message.type] || 0) + 1;
      byPriority[message.priority] = (byPriority[message.priority] || 0) + 1;
      podSet.add(message.from);
      if (message.to !== '*') {
        podSet.add(message.to);
      }
    }

    return {
      ...basic,
      byType,
      byPriority,
      activePods: Array.from(podSet),
    };
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  /**
   * Deliver a broadcast message to all active subscribers.
   */
  private deliverBroadcast(message: BusMessage): void {
    for (const [, subscription] of this.subscriptions) {
      if (this.matchesFilter(message, subscription.filter)) {
        try {
          subscription.handler(message);
        } catch (error) {
          console.error(
            `[MessageBus] Error delivering broadcast to pod ${subscription.podId}:`,
            error,
          );
        }
      }
    }
  }

  /**
   * Deliver a targeted message to a specific pod's subscribers.
   * If no active subscription exists, queue in pendingDelivery.
   */
  private deliverTargeted(message: BusMessage): void {
    let delivered = false;

    for (const [, subscription] of this.subscriptions) {
      if (
        subscription.podId === message.to &&
        this.matchesFilter(message, subscription.filter)
      ) {
        try {
          subscription.handler(message);
          delivered = true;
        } catch (error) {
          console.error(
            `[MessageBus] Error delivering message to pod ${message.to}:`,
            error,
          );
        }
      }
    }

    // If no subscriber was found, queue for later delivery
    if (!delivered) {
      if (!this.pendingDelivery.has(message.to)) {
        this.pendingDelivery.set(message.to, []);
      }
      this.pendingDelivery.get(message.to)!.push(message);
    }
  }

  /**
   * Check if a message matches a subscription filter.
   * Returns true if there is no filter (all messages match).
   */
  private matchesFilter(
    message: BusMessage,
    filter?: SubscriptionFilter,
  ): boolean {
    if (!filter) return true;

    // Check type filter
    if (filter.types && filter.types.length > 0) {
      if (!filter.types.includes(message.type)) {
        return false;
      }
    }

    // Check sender filter
    if (filter.from && filter.from.length > 0) {
      if (!filter.from.includes(message.from)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a message has expired.
   */
  private isExpired(message: BusMessage): boolean {
    if (!message.expiresAt) return false;
    return message.expiresAt < Date.now();
  }

  /**
   * Trim message history when it exceeds maxHistory.
   * Removes oldest messages first.
   */
  private trimHistory(): void {
    if (this.messageHistory.length > this.maxHistory) {
      const overflow = this.messageHistory.length - this.maxHistory;
      this.messageHistory.splice(0, overflow);
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Global message bus singleton for inter-pod communication.
 * All TBWO pods and the orchestrator share this single instance.
 */
export const messageBus = new MessageBus();
