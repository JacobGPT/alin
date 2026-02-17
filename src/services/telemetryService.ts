/**
 * Telemetry Service — Lightweight data collection for model training
 *
 * Tracks: message sends, tool usage, feedback, model selection,
 * mode changes, session duration, errors
 *
 * All data is anonymizable for model training.
 * Telemetry should never break the app — all calls fail silently.
 */

import { useAuthStore } from '../store/authStore';

const SESSION_ID = crypto.randomUUID();

// Track whether telemetry endpoint exists to avoid 404 spam
let _telemetryAvailable: boolean | null = null;

async function send(endpoint: string, data: Record<string, unknown>): Promise<void> {
  // Skip if we already know the endpoint doesn't exist
  if (_telemetryAvailable === false) return;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...useAuthStore.getState().getAuthHeader(),
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...data, sessionId: SESSION_ID }),
    });
    if (res.status === 404) {
      _telemetryAvailable = false; // Endpoint doesn't exist — stop trying
    } else {
      _telemetryAvailable = true;
    }
  } catch {
    // Telemetry should never break the app — fail silently
  }
}

export const telemetry = {
  /** User sent a message */
  messageSent(conversationId: string, model: string, mode: string) {
    send('/api/telemetry/event', {
      eventType: 'message_sent',
      eventData: { conversationId, model, mode },
    });
  },

  /** AI response received */
  responseReceived(conversationId: string, model: string, tokens: { input: number; output: number }) {
    send('/api/telemetry/event', {
      eventType: 'response_received',
      eventData: { conversationId, model, ...tokens },
    });
  },

  /** Tool was used */
  toolUsed(conversationId: string, toolName: string, success: boolean, durationMs: number, error?: string) {
    send('/api/telemetry/tool', {
      conversationId, toolName, success, durationMs, errorMessage: error,
    });
  },

  /** User gave feedback (thumbs up/down, regenerate, correction) */
  feedback(conversationId: string, messageId: string, type: 'thumbs_up' | 'thumbs_down' | 'regenerate' | 'correction', original?: string, corrected?: string) {
    send('/api/telemetry/feedback', {
      conversationId, messageId, feedbackType: type,
      originalResponse: original, correctedResponse: corrected,
    });
  },

  /** Mode changed */
  modeChanged(from: string, to: string) {
    send('/api/telemetry/event', {
      eventType: 'mode_change',
      eventData: { from, to },
    });
  },

  /** Model changed */
  modelChanged(from: string, to: string) {
    send('/api/telemetry/event', {
      eventType: 'model_change',
      eventData: { from, to },
    });
  },

  /** Session started */
  sessionStarted() {
    send('/api/telemetry/event', {
      eventType: 'session_start',
      eventData: {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      },
    });
  },

  /** Error occurred */
  error(context: string, message: string) {
    send('/api/telemetry/event', {
      eventType: 'error',
      eventData: { context, message },
    });
  },

  /** Conversation ended (summary stats) */
  conversationEnded(data: {
    conversationId: string;
    model: string;
    mode: string;
    messageCount: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    duration: number;
  }) {
    send('/api/telemetry/conversation', data);
  },
};
