/**
 * Proactive Service - Context monitoring, pattern detection, suggestion generation,
 * and file watching for live code change awareness.
 */

import { useProactiveStore } from '../store/proactiveStore';
import { useChatStore } from '../store/chatStore';

interface ConversationPattern {
  type: string;
  confidence: number;
  suggestion: {
    type: 'action' | 'info' | 'tbwo' | 'memory' | 'tool';
    title: string;
    description: string;
  };
}

interface FileChange {
  type: string; // 'change' | 'rename'
  file: string;
  timestamp: number;
  watchPath?: string;
}

class ProactiveService {
  private analysisInterval: NodeJS.Timeout | null = null;
  private fileWatchInterval: NodeJS.Timeout | null = null;
  private lastMessageCount: number = 0;
  private errorPatterns: Map<string, number> = new Map();
  private lastChangeTimestamp: number = 0;
  private watchingPath: string | null = null;
  private recentFileChanges: FileChange[] = [];

  /**
   * Start background monitoring (conversation analysis + file watching)
   */
  start(): void {
    if (this.analysisInterval) return;

    this.analysisInterval = setInterval(() => {
      if (!useProactiveStore.getState().enabled) return;
      this.analyzeContext();
      useProactiveStore.getState().clearExpired();
    }, 15000); // Check every 15 seconds

    // Start file watching (only on localhost — deployed version doesn't have local files)
    const isLocal = typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    if (isLocal) {
      this.startFileWatcher('.');
    }
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    this.stopFileWatcher();
  }

  // ===========================================================================
  // FILE WATCHING
  // ===========================================================================

  /**
   * Start watching a directory for file changes
   */
  async startFileWatcher(dirPath: string): Promise<void> {
    try {
      // Register watcher with backend
      const resp = await fetch('/api/files/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: dirPath,
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.css', '.json', '.html'],
        }),
      });
      if (!resp.ok) return;

      this.watchingPath = dirPath;
      this.lastChangeTimestamp = Date.now();

      // Poll for changes every 10 seconds
      this.fileWatchInterval = setInterval(() => {
        this.pollFileChanges();
      }, 10000);
    } catch {
      // Backend not available — no file watching
    }
  }

  /**
   * Stop file watching
   */
  stopFileWatcher(): void {
    if (this.fileWatchInterval) {
      clearInterval(this.fileWatchInterval);
      this.fileWatchInterval = null;
    }
    if (this.watchingPath) {
      fetch('/api/files/watch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: this.watchingPath }),
      }).catch(() => {});
      this.watchingPath = null;
    }
  }

  /**
   * Poll backend for file change events
   */
  private async pollFileChanges(): Promise<void> {
    if (!this.watchingPath || !useProactiveStore.getState().enabled) return;

    try {
      const resp = await fetch(
        `/api/files/changes?path=${encodeURIComponent(this.watchingPath)}&since=${this.lastChangeTimestamp}`
      );
      if (!resp.ok) return;

      const data = await resp.json();
      const changes: FileChange[] = data.changes || [];
      if (changes.length === 0) return;

      // Update timestamp to latest
      this.lastChangeTimestamp = Math.max(...changes.map(c => c.timestamp));
      this.recentFileChanges = changes;

      // Analyze change patterns and generate suggestions
      this.analyzeFileChanges(changes);
    } catch {
      // Polling failed — skip
    }
  }

  /**
   * Analyze file changes and generate context-aware suggestions
   */
  private analyzeFileChanges(changes: FileChange[]): void {
    const store = useProactiveStore.getState();
    const uniqueFiles = [...new Set(changes.map(c => c.file))];

    // Detect rapid changes to same file (potential struggle)
    const fileCounts = new Map<string, number>();
    changes.forEach(c => {
      fileCounts.set(c.file, (fileCounts.get(c.file) || 0) + 1);
    });
    const hotFiles = [...fileCounts.entries()].filter(([, count]) => count >= 3);

    if (hotFiles.length > 0) {
      const hotFile = hotFiles[0]![0];
      store.addInsight({
        type: 'repeated_error',
        message: `Rapid edits to ${hotFile} (${hotFiles[0]![1]} changes). Need help debugging?`,
        actionable: true,
      });
      store.addSuggestion({
        type: 'tool',
        title: `Frequent edits: ${hotFile.split(/[/\\]/).pop()}`,
        description: `${hotFile} has been modified ${hotFiles[0]![1]} times recently. Switch to Coding mode for debugging assistance.`,
        confidence: 0.7,
        expiresAt: Date.now() + 60000,
        source: 'pattern',
        action: {
          label: 'Coding Mode',
          handler: 'switchMode',
          params: { mode: 'coding' },
        },
      });
    }

    // Detect config file changes
    const configFiles = uniqueFiles.filter(f =>
      /package\.json|tsconfig|vite\.config|\.env/.test(f)
    );
    if (configFiles.length > 0) {
      store.addSuggestion({
        type: 'info',
        title: 'Config files changed',
        description: `Changed: ${configFiles.join(', ')}. You may need to restart the dev server.`,
        confidence: 0.8,
        expiresAt: Date.now() + 60000,
        source: 'pattern',
      });
    }

    // Detect test file changes → suggest running tests
    const testFiles = uniqueFiles.filter(f => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f));
    if (testFiles.length > 0) {
      store.addSuggestion({
        type: 'action',
        title: 'Tests modified',
        description: `${testFiles.length} test file(s) changed. Consider running tests.`,
        confidence: 0.75,
        expiresAt: Date.now() + 60000,
        source: 'pattern',
      });
    }

    // Detect new files (rename events)
    const newFiles = changes.filter(c => c.type === 'rename');
    if (newFiles.length > 0) {
      store.addInsight({
        type: 'topic_shift',
        message: `New/renamed files detected: ${newFiles.map(f => f.file).join(', ')}`,
        actionable: false,
      });
    }

    // Detect store changes → suggest verifying state management
    const storeChanges = uniqueFiles.filter(f => /store\//.test(f));
    if (storeChanges.length > 0) {
      store.addSuggestion({
        type: 'info',
        title: 'State store changed',
        description: `Modified: ${storeChanges.map(f => f.split(/[/\\]/).pop()).join(', ')}. Verify localStorage persistence is still working.`,
        confidence: 0.65,
        expiresAt: Date.now() + 45000,
        source: 'pattern',
      });
    }
  }

  /**
   * Get recent file changes for context injection
   */
  getRecentChanges(): FileChange[] {
    return this.recentFileChanges;
  }

  // ===========================================================================
  // CONVERSATION ANALYSIS
  // ===========================================================================

  /**
   * Analyze current conversation context for patterns
   */
  analyzeContext(): void {
    const chatState = useChatStore.getState();
    const conversation = chatState.getCurrentConversation();
    if (!conversation || !conversation.messages) return;

    const messages = conversation.messages;
    if (messages.length === this.lastMessageCount) return;
    this.lastMessageCount = messages.length;

    const patterns = this.detectPatterns(messages);
    const store = useProactiveStore.getState();

    patterns.forEach(pattern => {
      if (pattern.confidence >= 0.6) {
        store.addSuggestion({
          type: pattern.suggestion.type,
          title: pattern.suggestion.title,
          description: pattern.suggestion.description,
          confidence: pattern.confidence,
          expiresAt: Date.now() + 30000,
          source: 'pattern',
        });
      }
    });
  }

  /**
   * Analyze a message after it's sent and generate suggestions
   */
  analyzeMessage(messageText: string): void {
    if (!useProactiveStore.getState().enabled) return;
    const store = useProactiveStore.getState();

    // Detect coding-related messages
    if (/\b(bug|error|fix|debug|crash|issue|broken)\b/i.test(messageText)) {
      store.addSuggestion({
        type: 'tool',
        title: 'Enable Coding Mode',
        description: 'Your message mentions debugging. Switch to Coding mode for file access and code execution tools.',
        confidence: 0.7,
        expiresAt: Date.now() + 30000,
        source: 'context',
        action: {
          label: 'Switch to Coding',
          handler: 'switchMode',
          params: { mode: 'coding' },
        },
      });
    }

    // Detect research-related messages
    if (/\b(research|find out|search for|look up|what is|how does)\b/i.test(messageText)) {
      store.addSuggestion({
        type: 'tool',
        title: 'Enable Research Mode',
        description: 'Research mode enhances web search capabilities and tracks sources.',
        confidence: 0.6,
        expiresAt: Date.now() + 30000,
        source: 'context',
        action: {
          label: 'Switch to Research',
          handler: 'switchMode',
          params: { mode: 'research' },
        },
      });
    }

    // Detect multi-step project messages
    if (/\b(build|create|develop|make|design)\b.*\b(website|app|application|system|project)\b/i.test(messageText)) {
      store.addSuggestion({
        type: 'tbwo',
        title: 'Create a TBWO',
        description: 'This sounds like a multi-step project. Use a Time-Budgeted Work Order for structured execution with specialized pods.',
        confidence: 0.75,
        expiresAt: Date.now() + 60000,
        source: 'context',
        action: {
          label: 'Create TBWO',
          handler: 'openModal',
          params: { type: 'new-tbwo' },
        },
      });
    }

    // Track error patterns
    const errorMatch = messageText.match(/error[:\s]+(.{10,50})/i);
    if (errorMatch) {
      const errorKey = errorMatch[1]!.trim().substring(0, 30);
      const count = (this.errorPatterns.get(errorKey) || 0) + 1;
      this.errorPatterns.set(errorKey, count);

      if (count >= 2) {
        store.addInsight({
          type: 'repeated_error',
          message: `Repeated error pattern detected: "${errorKey}" (${count} times)`,
          actionable: true,
        });
      }
    }

    // Detect image generation
    if (/\b(image|picture|photo|illustration|draw|generate.*image)\b/i.test(messageText)) {
      store.addSuggestion({
        type: 'tool',
        title: 'Enable Image Mode',
        description: 'Switch to Image mode for DALL-E image generation and gallery.',
        confidence: 0.65,
        expiresAt: Date.now() + 30000,
        source: 'context',
        action: {
          label: 'Switch to Image',
          handler: 'switchMode',
          params: { mode: 'image' },
        },
      });
    }

    // Inject recent file changes as context
    if (this.recentFileChanges.length > 0) {
      const recentFiles = [...new Set(this.recentFileChanges.map(c => c.file))].slice(0, 5);
      store.addInsight({
        type: 'topic_shift',
        message: `Recently changed files: ${recentFiles.join(', ')}`,
        actionable: false,
      });
    }
  }

  /**
   * Detect conversation patterns
   */
  private detectPatterns(messages: Array<{ content: any[]; role: string }>): ConversationPattern[] {
    const patterns: ConversationPattern[] = [];

    // Long conversation detection
    if (messages.length > 20) {
      patterns.push({
        type: 'long_conversation',
        confidence: 0.8,
        suggestion: {
          type: 'info',
          title: 'Long Conversation',
          description: `This conversation has ${messages.length} messages. Consider starting a new one to keep context focused, or save key information to memory.`,
        },
      });
    }

    // Detect lots of tool errors in recent messages
    const recentMessages = messages.slice(-5);
    const toolErrors = recentMessages.filter(m =>
      m.content?.some?.((b: any) => b.type === 'tool_result' && b.isError)
    );
    if (toolErrors.length >= 2) {
      patterns.push({
        type: 'repeated_errors',
        confidence: 0.85,
        suggestion: {
          type: 'action',
          title: 'Multiple Tool Errors',
          description: 'Several recent tool calls have failed. Consider checking your configuration or trying a different approach.',
        },
      });
    }

    // Detect idle conversation (no messages in last 5 minutes)
    const lastMsg = messages[messages.length - 1];
    const lastMsgContent = lastMsg?.content;
    if (lastMsgContent && Array.isArray(lastMsgContent)) {
      // Check if last assistant message suggests follow-up
      const lastText = lastMsgContent
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');
      if (/would you like|shall I|want me to|let me know/i.test(lastText)) {
        patterns.push({
          type: 'awaiting_response',
          confidence: 0.6,
          suggestion: {
            type: 'info',
            title: 'Follow-up Available',
            description: 'ALIN suggested a follow-up action. Respond to continue or start a new topic.',
          },
        });
      }
    }

    return patterns;
  }
}

export const proactiveService = new ProactiveService();
