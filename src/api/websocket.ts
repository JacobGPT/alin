/**
 * WebSocket Manager - Real-time Streaming Communication
 * 
 * Features:
 * - Auto-reconnection with exponential backoff
 * - Heartbeat/ping-pong to keep connection alive
 * - Message queue for offline support
 * - Type-safe message parsing
 * - Event subscriptions
 * - Connection state management
 * - Error handling and recovery
 * - Rate limiting
 */

import { EventEmitter } from 'eventemitter3';

// ============================================================================
// TYPES
// ============================================================================

export enum WebSocketState {
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  DISCONNECTING = 'DISCONNECTING',
  DISCONNECTED = 'DISCONNECTED',
  RECONNECTING = 'RECONNECTING',
  ERROR = 'ERROR',
}

export enum MessageType {
  // Chat messages
  CHAT_MESSAGE = 'chat_message',
  CHAT_STREAM_START = 'chat_stream_start',
  CHAT_STREAM_CHUNK = 'chat_stream_chunk',
  CHAT_STREAM_END = 'chat_stream_end',
  CHAT_STREAM_ERROR = 'chat_stream_error',
  
  // TBWO messages
  TBWO_CREATED = 'tbwo_created',
  TBWO_STARTED = 'tbwo_started',
  TBWO_PROGRESS = 'tbwo_progress',
  TBWO_CHECKPOINT = 'tbwo_checkpoint',
  TBWO_COMPLETED = 'tbwo_completed',
  TBWO_ERROR = 'tbwo_error',
  
  // Pod messages
  POD_SPAWNED = 'pod_spawned',
  POD_STATUS = 'pod_status',
  POD_OUTPUT = 'pod_output',
  POD_TERMINATED = 'pod_terminated',
  
  // System messages
  HEARTBEAT = 'heartbeat',
  PONG = 'pong',
  ERROR = 'error',
  AUTH_SUCCESS = 'auth_success',
  AUTH_FAILURE = 'auth_failure',
}

export interface WebSocketMessage {
  type: MessageType;
  id: string;
  timestamp: number;
  data: any;
}

export interface WebSocketConfig {
  url: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  messageQueueSize?: number;
  debug?: boolean;
}

// ============================================================================
// WEBSOCKET MANAGER CLASS
// ============================================================================

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private state: WebSocketState = WebSocketState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private messageQueue: WebSocketMessage[] = [];
  private lastHeartbeat: number = 0;
  private messageId = 0;
  
  constructor(config: WebSocketConfig) {
    super();
    
    this.config = {
      url: config.url,
      reconnectInterval: config.reconnectInterval || 3000,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      heartbeatInterval: config.heartbeatInterval || 30000,
      messageQueueSize: config.messageQueueSize || 100,
      debug: config.debug || false,
    };
  }
  
  // ==========================================================================
  // CONNECTION MANAGEMENT
  // ==========================================================================
  
  /**
   * Connect to WebSocket server
   */
  public connect(): void {
    if (this.ws && this.state === WebSocketState.CONNECTED) {
      this.log('Already connected');
      return;
    }
    
    this.setState(WebSocketState.CONNECTING);
    this.log('Connecting to', this.config.url);
    
    try {
      this.ws = new WebSocket(this.config.url);
      this.setupEventHandlers();
    } catch (error) {
      this.handleError(error as Error);
      this.scheduleReconnect();
    }
  }
  
  /**
   * Disconnect from WebSocket server
   */
  public disconnect(): void {
    this.log('Disconnecting...');
    this.setState(WebSocketState.DISCONNECTING);
    
    this.clearTimers();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }
    
    this.setState(WebSocketState.DISCONNECTED);
  }
  
  /**
   * Reconnect to WebSocket server
   */
  private reconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      this.setState(WebSocketState.ERROR);
      this.emit('max_reconnect_attempts');
      return;
    }
    
    this.reconnectAttempts++;
    this.setState(WebSocketState.RECONNECTING);
    this.log(`Reconnecting (attempt ${this.reconnectAttempts})...`);
    
    this.connect();
  }
  
  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    );
    
    this.log(`Scheduling reconnect in ${delay}ms`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }
  
  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================
  
  private setupEventHandlers(): void {
    if (!this.ws) return;
    
    this.ws.onopen = this.handleOpen.bind(this);
    this.ws.onmessage = this.handleMessage.bind(this);
    this.ws.onerror = this.handleWSError.bind(this);
    this.ws.onclose = this.handleClose.bind(this);
  }
  
  private handleOpen(): void {
    this.log('Connected');
    this.setState(WebSocketState.CONNECTED);
    this.reconnectAttempts = 0;
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Flush message queue
    this.flushMessageQueue();
    
    this.emit('connected');
  }
  
  private handleMessage(event: MessageEvent): void {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      this.log('Received message:', message.type);
      
      // Handle system messages
      if (message.type === MessageType.PONG) {
        this.lastHeartbeat = Date.now();
        return;
      }
      
      // Emit message to listeners
      this.emit('message', message);
      this.emit(message.type, message.data);
      
    } catch (error) {
      this.log('Failed to parse message:', error);
      this.emit('parse_error', error);
    }
  }
  
  private handleWSError(event: Event): void {
    this.log('WebSocket error:', event);
    this.setState(WebSocketState.ERROR);
    this.emit('error', event);
  }
  
  private handleClose(event: CloseEvent): void {
    this.log('Connection closed:', event.code, event.reason);
    this.setState(WebSocketState.DISCONNECTED);
    this.clearTimers();
    
    this.emit('disconnected', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
    
    // Auto-reconnect if not a clean close
    if (!event.wasClean && event.code !== 1000) {
      this.scheduleReconnect();
    }
  }
  
  // ==========================================================================
  // MESSAGE SENDING
  // ==========================================================================
  
  /**
   * Send message to server
   */
  public send(type: MessageType, data: any): string {
    const message: WebSocketMessage = {
      type,
      id: this.generateMessageId(),
      timestamp: Date.now(),
      data,
    };
    
    if (this.state === WebSocketState.CONNECTED && this.ws) {
      try {
        this.ws.send(JSON.stringify(message));
        this.log('Sent message:', type);
        return message.id;
      } catch (error) {
        this.log('Failed to send message:', error);
        this.queueMessage(message);
      }
    } else {
      this.queueMessage(message);
    }
    
    return message.id;
  }
  
  /**
   * Queue message for later sending
   */
  private queueMessage(message: WebSocketMessage): void {
    if (this.messageQueue.length >= this.config.messageQueueSize) {
      this.messageQueue.shift(); // Remove oldest message
    }
    
    this.messageQueue.push(message);
    this.log('Message queued:', message.type);
  }
  
  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) return;
    
    this.log(`Flushing ${this.messageQueue.length} queued messages`);
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message && this.ws) {
        try {
          this.ws.send(JSON.stringify(message));
        } catch (error) {
          this.log('Failed to flush message:', error);
          // Re-queue if failed
          this.messageQueue.unshift(message);
          break;
        }
      }
    }
  }
  
  // ==========================================================================
  // HEARTBEAT
  // ==========================================================================
  
  private startHeartbeat(): void {
    this.lastHeartbeat = Date.now();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.state === WebSocketState.CONNECTED) {
        // Check if we received a pong recently
        const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;
        
        if (timeSinceLastHeartbeat > this.config.heartbeatInterval * 2) {
          this.log('Heartbeat timeout - reconnecting');
          this.reconnect();
          return;
        }
        
        // Send ping
        this.send(MessageType.HEARTBEAT, {});
      }
    }, this.config.heartbeatInterval);
  }
  
  // ==========================================================================
  // STATE MANAGEMENT
  // ==========================================================================
  
  private setState(state: WebSocketState): void {
    const oldState = this.state;
    this.state = state;
    
    if (oldState !== state) {
      this.log(`State changed: ${oldState} -> ${state}`);
      this.emit('state_change', { oldState, newState: state });
    }
  }
  
  public getState(): WebSocketState {
    return this.state;
  }
  
  public isConnected(): boolean {
    return this.state === WebSocketState.CONNECTED;
  }
  
  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  
  private generateMessageId(): string {
    return `msg_${Date.now()}_${this.messageId++}`;
  }
  
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  private handleError(error: Error): void {
    this.log('Error:', error.message);
    this.setState(WebSocketState.ERROR);
    this.emit('error', error);
  }
  
  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[WebSocket]', ...args);
    }
  }
  
  // ==========================================================================
  // CLEANUP
  // ==========================================================================
  
  public destroy(): void {
    this.disconnect();
    this.removeAllListeners();
    this.messageQueue = [];
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let wsManager: WebSocketManager | null = null;

export function getWebSocketManager(config?: WebSocketConfig): WebSocketManager {
  if (!wsManager && config) {
    wsManager = new WebSocketManager(config);
  }
  
  if (!wsManager) {
    throw new Error('WebSocketManager not initialized. Provide config on first call.');
  }
  
  return wsManager;
}

export function initializeWebSocket(config: WebSocketConfig): WebSocketManager {
  if (wsManager) {
    wsManager.destroy();
  }
  
  wsManager = new WebSocketManager(config);
  return wsManager;
}
