/**
 * Audit Types - Receipt and usage tracking for ALIN
 *
 * Tracks:
 * - Per-message API costs
 * - Per-conversation totals
 * - Daily/monthly usage
 * - Tool usage frequency
 * - Model usage breakdown
 */

// ============================================================================
// AUDIT ENTRY
// ============================================================================

export interface AuditEntry {
  id: string;
  timestamp: number;
  conversationId: string;
  messageId: string;

  // Model info
  provider: 'anthropic' | 'openai';
  model: string;

  // Token usage
  tokens: {
    prompt: number;
    completion: number;
    total: number;
    cacheCreation?: number;
    cacheRead?: number;
  };

  // Cost
  cost: number; // USD

  // Tool usage in this message
  toolsUsed: ToolUsageEntry[];

  // Memory injections from proactive memory
  memoryInjections?: MemoryInjectionEntry[];

  // Duration
  durationMs: number;
}

export interface MemoryInjectionEntry {
  id: string;
  similarity: number;
  salience: number;
  score: number;
  layer: string;
  preview: string;
}

export interface ToolUsageEntry {
  toolName: string;
  success: boolean;
  durationMs?: number;
}

// ============================================================================
// CONVERSATION RECEIPT
// ============================================================================

export interface ConversationReceipt {
  conversationId: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;

  // Totals
  totalMessages: number;
  totalTokens: number;
  totalCost: number;

  // Breakdown
  modelBreakdown: Record<string, {
    messages: number;
    tokens: number;
    cost: number;
  }>;

  toolBreakdown: Record<string, {
    calls: number;
    successes: number;
    failures: number;
  }>;
}

// ============================================================================
// USAGE SUMMARY
// ============================================================================

export interface UsageSummary {
  period: 'today' | 'week' | 'month' | 'all';
  startDate: number;
  endDate: number;

  // Totals
  totalMessages: number;
  totalConversations: number;
  totalTokens: number;
  totalCost: number;

  // Per-model breakdown
  byModel: Record<string, {
    messages: number;
    tokens: number;
    cost: number;
  }>;

  // Per-day breakdown (for charts)
  dailyCosts: Array<{
    date: string; // YYYY-MM-DD
    cost: number;
    tokens: number;
    messages: number;
  }>;

  // Most used tools
  topTools: Array<{
    name: string;
    count: number;
  }>;
}
