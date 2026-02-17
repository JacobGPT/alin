/**
 * Intelligent Context Manager
 *
 * Intercepts conversation messages before they hit the API.
 * Scores, compresses, and prunes old messages to fit within
 * Claude's 200K token limit while preserving relevance.
 *
 * Works like human memory — not dumb truncation.
 */

import type { Message, ContentBlock } from '../types/chat';
import { MessageRole } from '../types/chat';

// ============================================================================
// TOKEN BUDGET CONSTANTS
// ============================================================================

const MAX_CONTEXT_TOKENS = 200_000;
const SYSTEM_PROMPT_RESERVE = 15_000;   // System prompt + tools definition
const RESPONSE_BUFFER = 25_000;          // Room for Claude's response + thinking
const COMPRESSION_TRIGGER = 150_000;     // Start compressing above this
const PROTECTED_PAIRS = 4;              // Last N user+assistant pairs always kept
const MIN_PROTECTED_PAIRS = 2;          // Fallback if protected alone exceeds budget

// Max chars a single tool result can consume (~25K chars ≈ 7K tokens)
// Kept small to avoid burning through tokens-per-minute rate limits
const MAX_TOOL_RESULT_CHARS = 25_000;

// ============================================================================
// STOPWORDS (for keyword extraction)
// ============================================================================

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'it', 'to', 'in', 'of', 'and', 'or', 'for',
  'on', 'at', 'by', 'be', 'as', 'do', 'if', 'my', 'no', 'so', 'up',
  'he', 'we', 'am', 'me', 'us', 'was', 'are', 'has', 'had', 'did',
  'not', 'but', 'can', 'all', 'her', 'his', 'its', 'our', 'out', 'who',
  'how', 'may', 'got', 'let', 'say', 'she', 'too', 'use', 'way', 'own',
  'boy', 'did', 'get', 'him', 'hit', 'man', 'new', 'now', 'old', 'see',
  'try', 'ask', 'big', 'few', 'run', 'why', 'far', 'put', 'set',
  'that', 'this', 'with', 'have', 'from', 'they', 'been', 'will',
  'what', 'when', 'make', 'like', 'just', 'over', 'also', 'into',
  'some', 'than', 'them', 'very', 'most', 'more', 'here', 'there',
  'could', 'would', 'should', 'about', 'which', 'their', 'these',
  'those', 'other', 'after', 'first', 'think', 'going', 'being',
  'please', 'thanks', 'thank', 'want', 'need',
  'know', 'well', 'good', 'look', 'come', 'take', 'give', 'tell',
  'help', 'show', 'sure', 'yeah', 'okay', 'right', 'much', 'even',
  'still', 'while', 'where', 'thing', 'point', 'great', 'really',
]);

// ============================================================================
// TOKEN ESTIMATION
// ============================================================================

/** Estimate token count from text. ~3.5 chars per token for English. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

/** Extract all text from a content block for token estimation. */
function getBlockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text || '';
    case 'code':
      return (block.code || '') + (block.language || '') + (block.filename || '');
    case 'thinking':
      return block.content || '';
    case 'redacted_thinking':
      return block.data || '';
    case 'tool_use':
      return JSON.stringify(block.toolInput || {});
    case 'tool_result':
      return typeof block.result === 'string' ? block.result : JSON.stringify(block.result || '');
    case 'image':
      return block.alt || block.caption || '';
    case 'file':
      return block.filename || '';
    case 'tool_activity':
      return block.activities?.map(a => a.label || '').join(' ') || '';
    default:
      return '';
  }
}

/** Estimate total tokens for a single message. */
function estimateMessageTokens(message: Message): number {
  if (!message.content || !Array.isArray(message.content)) return 0;
  let total = 0;
  for (const block of message.content) {
    total += estimateTokens(getBlockText(block));
  }
  // Add overhead for message structure (role, id, etc.)
  total += 10;
  return total;
}

// ============================================================================
// KEYWORD EXTRACTION
// ============================================================================

/** Extract meaningful keywords from text. */
function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./\\]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

/** Get all text from a message for keyword analysis. */
function getMessageText(message: Message): string {
  if (!message.content || !Array.isArray(message.content)) return '';
  return message.content.map(getBlockText).join(' ');
}

// ============================================================================
// RELEVANCE SCORING
// ============================================================================

interface ScoredMessage {
  message: Message;
  index: number;
  score: number;
  tokens: number;
}

/**
 * Score a message's relevance (0-1).
 * Higher = more relevant = keep longer.
 */
function scoreMessage(
  message: Message,
  index: number,
  protectedBoundary: number,
  totalCompressible: number,
  currentKeywords: Set<string>
): number {
  let score = 0;

  // Recency (0-0.3): linear decay from protected boundary
  const distanceFromProtected = protectedBoundary - index;
  if (totalCompressible > 0) {
    const recency = 1 - (distanceFromProtected / totalCompressible);
    score += Math.max(0, Math.min(0.3, recency * 0.3));
  }

  // Role weight (0-0.2): user messages are more important (intentional, short)
  if (message.role === MessageRole.USER) {
    score += 0.2;
  } else if (message.role === MessageRole.ASSISTANT) {
    score += 0.1;
  }

  // Topic overlap (0-0.5): keyword overlap with current user message
  if (currentKeywords.size > 0) {
    const messageText = getMessageText(message);
    const messageKeywords = extractKeywords(messageText);
    let matchCount = 0;
    for (const keyword of currentKeywords) {
      if (messageKeywords.has(keyword)) {
        matchCount++;
      }
    }
    score += (matchCount / currentKeywords.size) * 0.5;
  }

  return Math.min(1, score);
}

// ============================================================================
// COMPRESSION
// ============================================================================

/**
 * Compress a tool result text based on known patterns.
 * Returns compressed text or null if no pattern matched.
 */
function compressToolResult(text: string): string | null {
  if (!text || text.length < 500) return null;

  // Directory scan pattern
  const dirMatch = text.match(/^## Directory Scan:?\s*(.+?)$/m);
  if (dirMatch && dirMatch[1]) {
    const path = dirMatch[1].trim();
    const fileCountMatch = text.match(/(\d+)\s*(?:files?|items?|entries?)/i);
    const fileCount = fileCountMatch?.[1] ?? '?';
    const sizeMatch = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|bytes)/i);
    const size = sizeMatch ? `${sizeMatch[1]}${sizeMatch[2] ?? 'KB'}` : '';
    return `[Scanned directory: ${path}, ${fileCount} files${size ? `, ${size}` : ''}]`;
  }

  // Code search pattern
  const searchMatch = text.match(/^## Code Search:?\s*(.+?)$/m);
  if (searchMatch && searchMatch[1]) {
    const query = searchMatch[1].trim();
    const matchCountMatch = text.match(/(\d+)\s*match/i);
    const fileCountMatch = text.match(/(\d+)\s*file/i);
    const matchCount = matchCountMatch?.[1] ?? '?';
    const fileCount = fileCountMatch?.[1] ?? '?';
    return `[Code search: "${query}", ${matchCount} matches in ${fileCount} files]`;
  }

  // Command execution pattern
  const cmdMatch = text.match(/^## Command:?\s*(.+?)$/m);
  if (cmdMatch && cmdMatch[1]) {
    const cmd = cmdMatch[1].trim();
    const exitCodeMatch = text.match(/exit\s*code:?\s*(\d+)/i);
    const exitCode = exitCodeMatch?.[1] ?? '0';
    return `[Ran: ${cmd}, exit code: ${exitCode}]`;
  }

  // Git pattern
  const gitMatch = text.match(/^## Git:?\s*(.+?)$/m);
  if (gitMatch && gitMatch[1]) {
    const operation = gitMatch[1].trim();
    const exitCodeMatch = text.match(/exit\s*code:?\s*(\d+)/i);
    const exitCode = exitCodeMatch?.[1] ?? '0';
    return `[Git ${operation}: exit code ${exitCode}]`;
  }

  // File read pattern
  const fileMatch = text.match(/^File:\s*(.+?)(?:\n|$)/);
  if (fileMatch && fileMatch[1]) {
    const filePath = fileMatch[1].trim();
    const contentLength = text.length - fileMatch[0].length;
    return `[Read file: ${filePath}, ${contentLength} chars]`;
  }

  return null;
}

/**
 * Compress a single content block.
 * Returns a new block (never mutates the original), or null to remove it.
 */
function compressBlock(block: ContentBlock): ContentBlock | null {
  switch (block.type) {
    case 'thinking':
    case 'redacted_thinking':
      // Remove thinking blocks from compressible messages entirely
      return null;

    case 'text': {
      const text = block.text || '';
      // Try tool result compression first
      const compressed = compressToolResult(text);
      if (compressed) {
        return { type: 'text', text: compressed };
      }
      // Generic long text compression
      if (text.length > 2000) {
        return {
          type: 'text',
          text: text.slice(0, 300) +
            `\n...[compressed: ${text.length} chars]...\n` +
            text.slice(-150),
        };
      }
      return block;
    }

    case 'tool_result': {
      const resultText = typeof block.result === 'string'
        ? block.result
        : JSON.stringify(block.result || '');
      if (resultText.length > 500) {
        const compressed = compressToolResult(resultText);
        if (compressed) {
          return { ...block, result: compressed };
        }
        // Generic compression for long tool results
        return {
          ...block,
          result: resultText.slice(0, 300) +
            `\n...[compressed: ${resultText.length} chars]...\n` +
            resultText.slice(-150),
        };
      }
      return block;
    }

    case 'code': {
      const code = block.code || '';
      if (code.length > 2000) {
        return {
          ...block,
          code: code.slice(0, 300) +
            `\n// ...[compressed: ${code.length} chars]...\n` +
            code.slice(-150),
        };
      }
      return block;
    }

    // Keep these as-is (small)
    case 'image':
    case 'file':
    case 'tool_use':
    case 'tool_activity':
      return block;

    default:
      return block;
  }
}

/**
 * Compress a message's content blocks.
 * Returns a new message with compressed content.
 */
function compressMessage(message: Message): Message {
  if (!message.content || !Array.isArray(message.content)) return message;

  const compressedContent: ContentBlock[] = [];
  for (const block of message.content) {
    const compressed = compressBlock(block);
    if (compressed !== null) {
      compressedContent.push(compressed);
    }
  }

  // If all blocks were removed, add a placeholder
  if (compressedContent.length === 0) {
    compressedContent.push({
      type: 'text',
      text: '[Message content compressed]',
    });
  }

  return { ...message, content: compressedContent };
}

// ============================================================================
// TOOL RESULT COMPRESSION (used during continuation loops)
// ============================================================================

/**
 * Compress a single tool result string to fit within token budget.
 * Called on EVERY tool result before sending it back to the API.
 * This is the primary defense against scan_directory returning 1MB+.
 */
export function compressToolResultContent(content: string, toolName?: string): string {
  if (!content || content.length <= MAX_TOOL_RESULT_CHARS) {
    return content;
  }

  const originalLength = content.length;

  // Try structured compression first (knows about scan/search/command patterns)
  const structured = compressToolResult(content);
  if (structured && structured.length <= MAX_TOOL_RESULT_CHARS) {
    console.log(`[ContextManager] Compressed ${toolName || 'tool'} result: ${originalLength} -> ${structured.length} chars (structured)`);
    return structured;
  }

  // For directory scans: keep the tree structure but truncate file contents
  if (toolName === 'scan_directory' || content.includes('## Directory Scan')) {
    // Extract the tree/summary section (usually first ~2000 chars) and truncate the rest
    const lines = content.split('\n');
    const kept: string[] = [];
    let charCount = 0;
    const limit = MAX_TOOL_RESULT_CHARS - 200; // leave room for truncation notice

    for (const line of lines) {
      if (charCount + line.length > limit) {
        kept.push(`\n...[truncated: ${originalLength} total chars, showing first ${charCount} chars]`);
        break;
      }
      kept.push(line);
      charCount += line.length + 1;
    }

    const result = kept.join('\n');
    console.log(`[ContextManager] Compressed ${toolName || 'scan'} result: ${originalLength} -> ${result.length} chars (line-truncated)`);
    return result;
  }

  // For file reads: keep head and tail
  if (toolName === 'file_read' || content.startsWith('File:')) {
    const headSize = Math.floor(MAX_TOOL_RESULT_CHARS * 0.7);
    const tailSize = Math.floor(MAX_TOOL_RESULT_CHARS * 0.2);
    const result = content.slice(0, headSize) +
      `\n\n...[truncated: ${originalLength} total chars]...\n\n` +
      content.slice(-tailSize);
    console.log(`[ContextManager] Compressed ${toolName || 'file_read'} result: ${originalLength} -> ${result.length} chars (head+tail)`);
    return result;
  }

  // Generic: keep first 70% + last 20% of budget
  const headSize = Math.floor(MAX_TOOL_RESULT_CHARS * 0.7);
  const tailSize = Math.floor(MAX_TOOL_RESULT_CHARS * 0.2);
  const result = content.slice(0, headSize) +
    `\n\n...[truncated: ${originalLength} total chars]...\n\n` +
    content.slice(-tailSize);
  console.log(`[ContextManager] Compressed ${toolName || 'tool'} result: ${originalLength} -> ${result.length} chars (generic)`);
  return result;
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Prepare messages for API submission.
 * Compresses and prunes old messages to fit within token budget.
 * Returns a new array — never mutates originals.
 */
export function prepareMessages(messages: Message[], maxTokens?: number): Message[] {
  if (!messages || messages.length <= 2) {
    return messages; // Nothing to compress
  }

  const budget = (maxTokens || MAX_CONTEXT_TOKENS) - SYSTEM_PROMPT_RESERVE - RESPONSE_BUFFER;

  // Step 1: Estimate total tokens
  let totalTokens = 0;
  const tokenCounts: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const tokens = estimateMessageTokens(messages[i]!);
    tokenCounts.push(tokens);
    totalTokens += tokens;
  }

  // Fast path: if under trigger, return unchanged
  if (totalTokens < COMPRESSION_TRIGGER) {
    return messages;
  }

  console.log(`[ContextManager] Total estimated tokens: ${totalTokens} (trigger: ${COMPRESSION_TRIGGER})`);

  // Step 2: Categorize messages into protected and compressible
  const protectedCount = PROTECTED_PAIRS * 2; // pairs -> individual messages

  // Find the last N user+assistant pairs
  const protectedStartIndex = Math.max(0, messages.length - protectedCount);

  // Separate system messages (always kept) from regular messages
  const systemIndices: number[] = [];
  const regularEntries: Array<{ msg: Message; idx: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === MessageRole.SYSTEM) {
      systemIndices.push(i);
    } else {
      regularEntries.push({ msg, idx: i });
    }
  }

  const protectedEntries = regularEntries.filter(m => m.idx >= protectedStartIndex);
  const compressibleEntries = regularEntries.filter(m => m.idx < protectedStartIndex);

  if (compressibleEntries.length === 0) {
    // Nothing to compress -- all messages are protected or system
    if (protectedCount > MIN_PROTECTED_PAIRS * 2) {
      console.log('[ContextManager] Reducing protected window to minimum');
      return prepareMessagesWithReducedProtection(messages, budget);
    }
    return messages;
  }

  // Step 3: Extract keywords from the last user message for relevance scoring
  let lastUserMessage: Message | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role === MessageRole.USER) {
      lastUserMessage = msg;
      break;
    }
  }
  const currentKeywords = lastUserMessage
    ? extractKeywords(getMessageText(lastUserMessage))
    : new Set<string>();

  // Step 4: Score compressible messages
  const scored: ScoredMessage[] = compressibleEntries.map(({ msg, idx }) => ({
    message: msg,
    index: idx,
    score: scoreMessage(msg, idx, protectedStartIndex, compressibleEntries.length, currentKeywords),
    tokens: tokenCounts[idx] ?? 0,
  }));

  // Step 5: Compress all compressible messages
  const compressedMap = new Map<number, { message: Message; tokens: number; score: number }>();
  for (const s of scored) {
    const compressed = compressMessage(s.message);
    compressedMap.set(s.index, {
      message: compressed,
      tokens: estimateMessageTokens(compressed),
      score: s.score,
    });
  }

  // Recalculate total
  let newTotal = 0;
  for (const sysIdx of systemIndices) newTotal += tokenCounts[sysIdx] ?? 0;
  for (const prot of protectedEntries) newTotal += tokenCounts[prot.idx] ?? 0;
  for (const [, comp] of compressedMap) newTotal += comp.tokens;

  console.log(`[ContextManager] After compression: ${newTotal} tokens (was ${totalTokens})`);

  // Step 6: Prune if still over budget
  if (newTotal > budget) {
    // Sort by score ascending (lowest relevance first)
    const sortedByScore = [...compressedMap.entries()].sort((a, b) => a[1].score - b[1].score);
    const removedIndices = new Set<number>();

    for (const [idx, comp] of sortedByScore) {
      if (newTotal <= budget) break;
      newTotal -= comp.tokens;
      removedIndices.add(idx);
    }

    if (removedIndices.size > 0) {
      console.log(`[ContextManager] Pruned ${removedIndices.size} messages to fit budget`);
    }

    // Build final message array in original order
    const result: Message[] = [];
    let addedPlaceholder = false;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.role === MessageRole.SYSTEM) {
        result.push(msg);
      } else if (i >= protectedStartIndex) {
        result.push(msg);
      } else if (removedIndices.has(i)) {
        // Add a single placeholder for consecutive removed messages
        if (!addedPlaceholder) {
          result.push({
            id: 'context-placeholder',
            role: MessageRole.USER,
            content: [{
              type: 'text',
              text: '[Earlier conversation removed for context management]',
            }],
            timestamp: msg.timestamp,
            conversationId: msg.conversationId,
          });
          addedPlaceholder = true;
        }
      } else {
        // This compressible message survived pruning -- use compressed version
        const compressed = compressedMap.get(i);
        result.push(compressed ? compressed.message : msg);
        addedPlaceholder = false; // Reset so non-consecutive removals get their own placeholder
      }
    }

    console.log(`[ContextManager] Final: ${result.length} messages (from ${messages.length}), ~${newTotal} tokens`);
    return result;
  }

  // No pruning needed, just use compressed messages
  const result: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === MessageRole.SYSTEM) {
      result.push(msg);
    } else if (i >= protectedStartIndex) {
      result.push(msg);
    } else {
      const compressed = compressedMap.get(i);
      result.push(compressed ? compressed.message : msg);
    }
  }

  console.log(`[ContextManager] Final: ${result.length} messages, ~${newTotal} tokens (compressed only, no pruning)`);
  return result;
}

/**
 * Fallback: reduce protected window and compress everything.
 * Used when even the protected messages exceed the budget.
 */
function prepareMessagesWithReducedProtection(messages: Message[], budget: number): Message[] {
  console.log('[ContextManager] Using reduced protection mode');

  const minProtected = MIN_PROTECTED_PAIRS * 2;
  const protectedStartIndex = Math.max(0, messages.length - minProtected);

  // Compress everything before the reduced protected window
  const result: Message[] = [];
  let totalTokens = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (i >= protectedStartIndex) {
      // Protected: keep as-is
      const tokens = estimateMessageTokens(msg);
      result.push(msg);
      totalTokens += tokens;
    } else if (msg.role === MessageRole.SYSTEM) {
      result.push(msg);
      totalTokens += estimateMessageTokens(msg);
    } else {
      // Compress older messages
      const compressed = compressMessage(msg);
      const tokens = estimateMessageTokens(compressed);
      if (totalTokens + tokens < budget) {
        result.push(compressed);
        totalTokens += tokens;
      }
      // If over budget, just skip (prune)
    }
  }

  console.log(`[ContextManager] Reduced protection result: ${result.length} messages, ~${totalTokens} tokens`);
  return result;
}
