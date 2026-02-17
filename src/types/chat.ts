/**
 * Chat Types - Comprehensive type definitions for the chat system
 * 
 * This file defines all types related to chat functionality including:
 * - Messages (user, assistant, system)
 * - Conversations
 * - Streaming states
 * - Code blocks
 * - File attachments
 */

// ============================================================================
// MESSAGE TYPES
// ============================================================================

/**
 * Message role enum
 */
export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  SYSTEM = 'system',
  THINKING = 'thinking', // For visible AI reasoning
}

/**
 * Content block types for structured messages
 */
export type ContentBlock =
  | TextBlock
  | CodeBlock
  | ImageBlock
  | FileBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ToolActivityBlock
  | VideoEmbedBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface CodeBlock {
  type: 'code';
  language: string;
  code: string;
  filename?: string;
  executionResult?: CodeExecutionResult;
}

export interface ImageBlock {
  type: 'image';
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface FileBlock {
  type: 'file';
  fileId: string;
  filename: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  content: string;
  signature?: string; // Required for API round-trips with tool use
  collapsed?: boolean;
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string; // Opaque encrypted data
}

export interface ToolUseBlock {
  type: 'tool_use';
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  result: unknown;
  isError?: boolean;
}

/**
 * Tool activity block for inline display of tool usage (Claude-style)
 */
export interface ToolActivityBlock {
  type: 'tool_activity';
  activities: ToolActivitySummary[];
}

export interface VideoEmbedBlock {
  type: 'video_embed';
  url: string;
  embed_url: string;
  platform: 'youtube' | 'vimeo' | 'loom' | 'twitch' | 'dailymotion' | 'unknown';
  title?: string;
  thumbnail?: string;
  timestamp?: number;
}

/**
 * Code execution result
 */
export interface CodeExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime: number;
  exitCode?: number;
  securityLevel: 'safe' | 'warning' | 'blocked';
  warnings?: string[];
}

/**
 * Main message type
 */
export interface Message {
  id: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  conversationId: string;
  
  // Metadata
  model?: string;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost?: number;
  
  // UI state
  isStreaming?: boolean;
  isRegenerating?: boolean;
  isPinned?: boolean;
  
  // Branching
  parentId?: string;
  branches?: string[]; // IDs of alternative responses
  
  // Annotations
  annotations?: MessageAnnotation[];
  reactions?: MessageReaction[];
  
  // Edit history
  editHistory?: EditHistoryEntry[];
  isEdited?: boolean;

  // Tool activities (Claude-style tracking)
  toolActivities?: ToolActivitySummary[];

  // Confidence / Uncertainty awareness
  confidence?: number; // 0-1 score derived from response signals
  confidenceSignals?: ConfidenceSignals;

  // User feedback (thumbs up/down)
  feedback?: 'positive' | 'negative';
  feedbackNote?: string;

  // Stop reason from API (e.g., 'end_turn', 'max_tokens', 'tool_use')
  stopReason?: string;

  // Both/Hybrid mode labels
  modelLabel?: string;        // e.g., "Claude Sonnet 4.5", "GPT-5"
  hybridPhase?: 'planner' | 'executor';
}

export interface ConfidenceSignals {
  hasHedging: boolean;      // "I think", "probably", "might be"
  hasToolUse: boolean;      // Used tools to verify (higher confidence)
  hasCodeOutput: boolean;   // Produced concrete code (higher confidence)
  responseLength: number;   // Very short responses may indicate uncertainty
  stopReason: string;       // 'end_turn' vs 'max_tokens'
}

/**
 * Tool activity summary for message display
 */
export interface ToolActivitySummary {
  id: string;
  type: 'web_search' | 'web_fetch' | 'image_search' | 'memory_recall' | 'memory_store' | 'code_execute' | 'file_read' | 'file_write' | 'image_generate' | 'image_edit' | 'video_generate' | 'directory_scan' | 'code_search' | 'terminal_command' | 'git_operation' | 'file_edit' | 'site_validate' | 'conversion_audit' | 'site_improve' | 'video_analyze' | 'motion_validate' | 'scene_validate' | 'output_guard' | 'other';
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  query?: string;
  resultCount?: number;
  results?: any[];
  error?: string;
  // Rich data for expandable tool activity views
  input?: Record<string, unknown>;
  output?: unknown;
  startTime?: number;
  endTime?: number;
}

export interface MessageAnnotation {
  id: string;
  content: string;
  timestamp: number;
  userId?: string;
}

export interface MessageReaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface EditHistoryEntry {
  content: ContentBlock[];
  timestamp: number;
  editedBy?: string;
}

// ============================================================================
// CONVERSATION TYPES
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  
  // Metadata
  tags?: string[];
  folder?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  
  // Model configuration
  model: ModelConfig;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  
  // TBWO association
  tbwoId?: string;
  
  // Branching
  currentBranchId?: string;
  branches?: ConversationBranch[];
  
  // Memory context
  memoryContext?: MemoryContext;
}

export interface ConversationBranch {
  id: string;
  name: string;
  parentMessageId: string;
  messages: string[]; // Message IDs
  createdAt: number;
}

export interface MemoryContext {
  activeLayers: string[];
  relevantMemories: string[];
  contextUsage: {
    used: number;
    total: number;
  };
}

/**
 * Conversation summary for display in sidebar
 */
export interface ConversationSummary {
  id: string;
  title: string;
  preview: string; // First few words of last message
  updatedAt: number;
  messageCount: number;
  isFavorite?: boolean;
  isPinned?: boolean;
  unreadCount?: number;
  tags?: string[];
}

// ============================================================================
// MODEL TYPES
// ============================================================================

export enum ModelProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic',
  LOCAL = 'local',
}

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  name: string;
  
  // Capabilities
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  maxContextTokens: number;
  
  // Cost
  costPer1kPromptTokens?: number;
  costPer1kCompletionTokens?: number;
}

// ============================================================================
// STREAMING TYPES
// ============================================================================

export enum StreamEventType {
  MESSAGE_START = 'message_start',
  CONTENT_BLOCK_START = 'content_block_start',
  CONTENT_BLOCK_DELTA = 'content_block_delta',
  CONTENT_BLOCK_STOP = 'content_block_stop',
  MESSAGE_DELTA = 'message_delta',
  MESSAGE_STOP = 'message_stop',
  ERROR = 'error',
  PING = 'ping',
}

export interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

export interface StreamState {
  isStreaming: boolean;
  currentMessageId?: string;
  buffers: Map<string, string>; // Block ID -> accumulated content
  error?: string;
}

// ============================================================================
// CHAT UI STATE
// ============================================================================

export interface ChatUIState {
  // Input
  inputValue: string;
  isComposing: boolean;
  
  // Files
  attachedFiles: File[];
  isDraggingFiles: boolean;
  
  // Voice
  isRecording: boolean;
  recordingDuration: number;
  
  // Scroll
  shouldAutoScroll: boolean;
  userScrolled: boolean;
  
  // Selection
  selectedMessages: Set<string>;
  
  // Modals
  showSettings: boolean;
  showMemory: boolean;
  showTBWO: boolean;
  
  // Command palette
  showCommandPalette: boolean;
  commandPaletteQuery: string;
}

// ============================================================================
// EXPORT & IMPORT TYPES
// ============================================================================

export enum ExportFormat {
  PDF = 'pdf',
  MARKDOWN = 'markdown',
  JSON = 'json',
  HTML = 'html',
  TXT = 'txt',
}

export interface ExportOptions {
  format: ExportFormat;
  includeMetadata: boolean;
  includeSystemMessages: boolean;
  includeThinking: boolean;
  includeCodeBlocks: boolean;
  includeImages: boolean;
  startMessageId?: string;
  endMessageId?: string;
}

export interface ImportedConversation {
  format: string;
  version: string;
  conversation: Conversation;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// SEARCH & FILTER TYPES
// ============================================================================

export interface ChatSearchQuery {
  query: string;
  conversationId?: string;
  role?: MessageRole;
  startDate?: number;
  endDate?: number;
  tags?: string[];
  hasCode?: boolean;
  hasImages?: boolean;
}

export interface ChatSearchResult {
  message: Message;
  conversation: ConversationSummary;
  highlights: SearchHighlight[];
  score: number;
}

export interface SearchHighlight {
  type: 'text' | 'code';
  start: number;
  end: number;
  snippet: string;
}

// ============================================================================
// TEMPLATE TYPES
// ============================================================================

export interface ChatTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  systemPrompt: string;
  starterMessages?: Message[];
  modelConfig?: Partial<ModelConfig>;
  tags?: string[];
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export class ChatError extends Error {
  constructor(
    message: string,
    public code: ChatErrorCode,
    public retryable: boolean = false,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

export enum ChatErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_ERROR = 'API_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  INVALID_REQUEST = 'INVALID_REQUEST',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  MODEL_OVERLOADED = 'MODEL_OVERLOADED',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  CONTENT_FILTER = 'CONTENT_FILTER',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
