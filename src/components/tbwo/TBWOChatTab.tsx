/**
 * TBWOChatTab - Live execution chat view within TBWO Dashboard
 *
 * Shows execution events as messages, allows user interaction during/after execution.
 * After execution, enables normal AI chat for iteration and refinement.
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PaperAirplaneIcon,
  CodeBracketIcon,
  CpuChipIcon,
  ArrowDownIcon,
  DocumentDuplicateIcon,
  LightBulbIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import ReactMarkdown from 'react-markdown';

import { useChatStore } from '../../store/chatStore';
import { useTBWOStore } from '../../store/tbwoStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getAPIService, isAPIServiceInitialized } from '../../api/apiService';
import { ToolActivityPanel } from '../chat/ToolActivityPanel';
import type { TBWO } from '../../types/tbwo';
import type { ContentBlock } from '../../types/chat';
import { MessageRole, ModelProvider } from '../../types/chat';

// ============================================================================
// TYPES
// ============================================================================

interface TBWOChatTabProps {
  tbwo: TBWO;
}

// ============================================================================
// TBWO CHAT TAB COMPONENT
// ============================================================================

export function TBWOChatTab({ tbwo }: TBWOChatTabProps) {
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get or create linked conversation
  const chatConvId = tbwo.chatConversationId;
  const conversation = useChatStore((s) =>
    chatConvId ? s.conversations.get(chatConvId) : undefined
  );
  const messages = conversation?.messages || [];
  const addMessage = useChatStore((s) => s.addMessage);
  const createConversation = useChatStore((s) => s.createConversation);
  const updateTBWO = useTBWOStore((s) => s.updateTBWO);

  // Create chat conversation if it doesn't exist yet
  useEffect(() => {
    if (!chatConvId) {
      const convId = createConversation({
        title: `TBWO: ${tbwo.objective.slice(0, 50)}`,
      });
      updateTBWO(tbwo.id, { chatConversationId: convId });
    }
  }, [chatConvId, tbwo.id, tbwo.objective, createConversation, updateTBWO]);

  // Compute a scroll trigger that changes when messages update (not just count)
  const lastMsg = messages[messages.length - 1];
  const scrollTrigger = messages.length + (
    lastMsg?.isStreaming ? (lastMsg.content?.[0] as any)?.text?.length || 0 : 0
  );

  // Auto-scroll to bottom on new messages OR streaming content updates
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scrollTrigger, autoScroll]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isNearBottom);
  };

  // Send user message
  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isSending) return;

    const convId = tbwo.chatConversationId;
    if (!convId) return;

    setInputValue('');
    setIsSending(true);
    setAutoScroll(true);

    // Add user message
    addMessage(convId, {
      role: MessageRole.USER,
      content: [{ type: 'text', text }],
    });

    // If TBWO is completed, send through normal AI flow for iteration
    const tbwoComplete = ['completed', 'failed', 'cancelled'].includes(tbwo.status);
    if (tbwoComplete && isAPIServiceInitialized()) {
      try {
        const allMessages = useChatStore.getState().conversations.get(convId)?.messages || [];
        const settings = useSettingsStore.getState();
        const provider = settings.modelMode === 'gpt' ? ModelProvider.OPENAI : ModelProvider.ANTHROPIC;

        // Add placeholder assistant message
        const assistantMsgId = addMessage(convId, {
          role: MessageRole.ASSISTANT,
          content: [{ type: 'text', text: '' }],
          isStreaming: true,
        });

        let fullText = '';

        await getAPIService().sendMessageStream(
          allMessages,
          provider,
          {
            onChunk: (chunk: string) => {
              fullText += chunk;
              useChatStore.getState().updateMessage(assistantMsgId, {
                content: [{ type: 'text', text: fullText }],
                isStreaming: true,
              });
            },
            onComplete: () => {
              useChatStore.getState().updateMessage(assistantMsgId, {
                content: [{ type: 'text', text: fullText }],
                isStreaming: false,
              });
            },
            onError: (error: Error) => {
              useChatStore.getState().updateMessage(assistantMsgId, {
                content: [{ type: 'text', text: fullText || `Error: ${error.message}` }],
                isStreaming: false,
              });
            },
          }
        );
      } catch (error) {
        console.error('[TBWOChat] Send failed:', error);
      }
    }

    setIsSending(false);
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isExecuting = tbwo.status === 'executing' || tbwo.status === 'checkpoint';
  const isComplete = ['completed', 'failed', 'cancelled'].includes(tbwo.status);

  return (
    <div className="relative flex h-[calc(100vh-280px)] flex-col rounded-xl border border-border-primary bg-background-secondary">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-border-primary px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${
            isExecuting ? 'bg-brand-primary animate-pulse' :
            isComplete ? 'bg-semantic-success' : 'bg-text-quaternary'
          }`} />
          <span className="text-sm font-medium text-text-primary">
            {isExecuting ? 'Live Execution' : isComplete ? 'Execution Complete' : 'Waiting to Start'}
          </span>
        </div>
        <span className="text-xs text-text-tertiary">
          {messages.length} messages
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <CpuChipIcon className="h-10 w-10 text-text-quaternary mb-3" />
            <p className="text-sm text-text-tertiary">
              {isExecuting
                ? 'Execution updates will appear here...'
                : isComplete
                ? 'Chat with ALIN about the completed work order'
                : 'Chat will begin when execution starts'}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {!autoScroll && messages.length > 5 && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => {
              setAutoScroll(true);
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-background-elevated px-3 py-1.5 text-xs text-text-secondary shadow-lg hover:bg-background-hover transition-colors z-10"
          >
            <ArrowDownIcon className="h-3 w-3" />
            Scroll to bottom
          </motion.button>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="border-t border-border-primary p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isExecuting
                ? 'Add context for the running process...'
                : isComplete
                ? 'Ask ALIN to iterate, modify, or explain...'
                : 'Chat will be available when execution starts...'
            }
            disabled={!chatConvId || (!isExecuting && !isComplete && tbwo.status !== 'awaiting_approval' && tbwo.status !== 'draft')}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none disabled:opacity-50"
            style={{ minHeight: '36px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-primary text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <PaperAirplaneIcon className="h-4 w-4" />
          </button>
        </div>
        {isExecuting && (
          <p className="mt-1.5 text-xs text-text-quaternary">
            Messages during execution are added as context. ALIN will see them.
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CHAT MESSAGE COMPONENT
// ============================================================================

function ChatMessage({ message }: { message: { id: string; role: MessageRole; content: ContentBlock[]; timestamp: number; model?: string; isStreaming?: boolean } }) {
  const isUser = message.role === MessageRole.USER;

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`max-w-[85%] flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        {!isUser && (
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-accent to-brand-secondary mt-0.5">
            <CpuChipIcon className="h-4 w-4 text-white" />
          </div>
        )}

        <div className={`flex-1 min-w-0 ${isUser ? 'rounded-xl bg-background-tertiary px-3.5 py-2.5' : ''}`}>
          {/* Execution engine label */}
          {!isUser && message.model && (
            <div className="mb-1 flex items-center gap-1.5 text-xs text-text-quaternary">
              <span className="font-medium">{message.model}</span>
            </div>
          )}

          {/* Content blocks */}
          <div className="space-y-1">
            {message.content.map((block, i) => (
              <ContentBlockRenderer key={i} block={block} isUser={isUser} isStreaming={message.isStreaming} />
            ))}
          </div>

          {/* Streaming indicator */}
          {message.isStreaming && (
            <span className="inline-block ml-1 animate-pulse text-text-quaternary">|</span>
          )}

          {/* Timestamp */}
          <div className={`mt-1.5 text-[10px] ${isUser ? 'text-text-quaternary text-right' : 'text-text-quaternary'}`}>
            {formatTime(message.timestamp)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// XML TAG STRIPPING
// ============================================================================

/**
 * Strip XML-like tool call markup that Claude generates when it doesn't have
 * structured tool definitions. Converts raw XML into readable text or extracts
 * embedded code blocks.
 */
function stripXMLToolCalls(text: string): { cleanText: string; extractedCode: Array<{ filename: string; code: string; language: string }> } {
  const extractedCode: Array<{ filename: string; code: string; language: string }> = [];

  // Remove common XML wrapper tags
  let cleaned = text
    .replace(/<\/?anythingllm-function-calls?>/gi, '')
    .replace(/<\/?invoke>/gi, '')
    .replace(/<\/?tool_call>/gi, '')
    .replace(/<\/?function_calls?>/gi, '')
    .replace(/<\/?result>/gi, '')
    .replace(/<\/?results?>/gi, '');

  // Extract file_write blocks and convert to readable format
  const fileWriteRegex = /<file_write[^>]*>[\s\S]*?<path>([\s\S]*?)<\/path>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/file_write>/gi;
  let match;
  while ((match = fileWriteRegex.exec(cleaned)) !== null) {
    const filePath = match[1]?.trim() || 'file';
    const content = match[2]?.trim() || '';
    const ext = filePath.split('.').pop() || 'text';
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown',
      rs: 'rust', go: 'go', java: 'java', cpp: 'cpp', c: 'c', sh: 'bash',
    };
    extractedCode.push({ filename: filePath, code: content, language: langMap[ext] || ext });
  }
  cleaned = cleaned.replace(fileWriteRegex, '');

  // Extract execute_code blocks
  const execCodeRegex = /<execute_code[^>]*>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/execute_code>/gi;
  while ((match = execCodeRegex.exec(cleaned)) !== null) {
    const code = match[1]?.trim() || '';
    extractedCode.push({ filename: 'executed code', code, language: 'javascript' });
  }
  cleaned = cleaned.replace(execCodeRegex, '');

  // Strip remaining XML-like tags (tool calls without content we care about)
  cleaned = cleaned
    .replace(/<tool_name>[^<]*<\/tool_name>/gi, '')
    .replace(/<\/?parameters?>/gi, '')
    .replace(/<\/?command>/gi, '')
    .replace(/<\/?language>/gi, '')
    .replace(/<\/?path>/gi, '')
    .replace(/<\/?content>/gi, '')
    .replace(/<\/?code>/gi, '')
    .replace(/<\/?file_read[^>]*>/gi, '')
    .replace(/<\/?file_write[^>]*>/gi, '')
    .replace(/<\/?file_list[^>]*>/gi, '')
    .replace(/<\/?execute_code[^>]*>/gi, '')
    .replace(/<\/?run_command[^>]*>/gi, '')
    .replace(/<\/?scan_directory[^>]*>/gi, '')
    .replace(/<\/?edit_file[^>]*>/gi, '')
    .replace(/<\/?web_search[^>]*>/gi, '')
    .replace(/<\/?git[^>]*>/gi, '')
    .replace(/<\/?memory_store[^>]*>/gi, '')
    .replace(/<\/?memory_recall[^>]*>/gi, '')
    .replace(/<\/?system_status[^>]*>/gi, '');

  // Clean up excess whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return { cleanText: cleaned, extractedCode };
}

// ============================================================================
// CONTENT BLOCK RENDERER
// ============================================================================

function ContentBlockRenderer({ block, isUser, isStreaming }: { block: ContentBlock; isUser: boolean; isStreaming?: boolean }) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);

  // Close unclosed code fences during streaming so code renders live
  const closeUnfinishedFences = (text: string): string => {
    const fencePattern = /^(`{3,})(\w*)/gm;
    let openFence: string | null = null;
    let match: RegExpExecArray | null;
    while ((match = fencePattern.exec(text)) !== null) {
      const backticks = match[1] || '';
      if (!openFence) {
        openFence = backticks;
      } else if (backticks.length >= openFence.length) {
        openFence = null;
      }
    }
    return openFence ? text + '\n' + openFence : text;
  };

  switch (block.type) {
    case 'text': {
      // Strip XML tool call markup from text
      const { cleanText: rawCleanText, extractedCode } = stripXMLToolCalls(block.text || '');
      const cleanText = isStreaming ? closeUnfinishedFences(rawCleanText) : rawCleanText;

      if (!cleanText && extractedCode.length === 0) return null;

      return (
        <>
          {cleanText && (
            <div className={`text-sm break-words prose prose-sm max-w-none ${
              isUser
                ? 'prose-invert text-white'
                : 'prose-invert text-text-primary'
            }`}>
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p className="my-1">{children}</p>,
                  code: ({ children, className }) => {
                    const isInline = !className;
                    return isInline ? (
                      <code className="bg-background-elevated px-1 py-0.5 rounded text-xs">{children}</code>
                    ) : (
                      <code className={className}>{children}</code>
                    );
                  },
                  pre: ({ children }) => (
                    <pre className="bg-[#1e1e2e] p-3 rounded-lg text-xs overflow-x-auto my-2">{children}</pre>
                  ),
                  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                  em: ({ children }) => <em className="italic">{children}</em>,
                  ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
                  li: ({ children }) => <li className="my-0.5">{children}</li>,
                }}
              >
                {cleanText}
              </ReactMarkdown>
            </div>
          )}
          {/* Render extracted code blocks from XML tool calls */}
          {extractedCode.map((ec, idx) => (
            <ExtractedCodeBlock key={idx} filename={ec.filename} code={ec.code} language={ec.language} />
          ))}
        </>
      );
    }

    case 'code': {
      const lineCount = (block.code || '').split('\n').length;
      const isLong = lineCount > 30;

      return (
        <div className="mt-2 mb-1 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between bg-background-elevated px-3 py-1.5 text-xs">
            <div className="flex items-center gap-1.5 text-text-tertiary">
              <CodeBracketIcon className="h-3 w-3" />
              <span>{block.filename || block.language}</span>
              {isLong && <span className="text-text-quaternary">({lineCount} lines)</span>}
            </div>
            <div className="flex items-center gap-2">
              {isLong && (
                <button
                  onClick={() => setCodeExpanded(!codeExpanded)}
                  className="text-text-quaternary hover:text-text-secondary transition-colors text-xs"
                >
                  {codeExpanded ? 'Collapse' : 'Expand'}
                </button>
              )}
              <button
                onClick={() => navigator.clipboard.writeText(block.code)}
                className="text-text-quaternary hover:text-text-secondary transition-colors"
                title="Copy"
              >
                <DocumentDuplicateIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <pre className={`bg-[#1e1e2e] p-3 text-xs overflow-x-auto overflow-y-auto ${isLong && !codeExpanded ? 'max-h-[300px]' : ''}`}>
            <code className="text-green-400">{block.code}</code>
          </pre>
        </div>
      );
    }

    case 'thinking':
      return (
        <div className="my-1 rounded-lg border border-brand-primary/20 bg-brand-primary/5 overflow-hidden">
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-brand-primary hover:bg-brand-primary/10 transition-colors"
          >
            <LightBulbIcon className="h-3 w-3" />
            <span>Thinking</span>
            <ChevronDownIcon className={`h-3 w-3 ml-auto transition-transform ${thinkingExpanded ? 'rotate-180' : ''}`} />
          </button>
          {thinkingExpanded && (
            <div className="px-3 pb-2 text-xs text-text-tertiary whitespace-pre-wrap border-t border-brand-primary/10">
              {block.content}
            </div>
          )}
        </div>
      );

    case 'tool_activity':
      return (
        <ToolActivityPanel
          activities={(block as any).activities || []}
          isProcessing={false}
        />
      );

    case 'image':
      return (
        <div className="my-4">
          <img src={(block as any).url} alt={(block as any).alt || 'Generated image'} className="max-w-full rounded-lg border border-border-primary" style={{ maxHeight: '400px' }} />
          {(block as any).caption && <p className="mt-1 text-xs text-text-tertiary">{(block as any).caption}</p>}
        </div>
      );

    case 'file':
      return (
        <div className="my-2 flex items-center gap-3 rounded-lg border border-border-primary bg-background-tertiary p-3">
          <CodeBracketIcon className="h-4 w-4 text-text-tertiary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{(block as any).filename || 'file'}</p>
          </div>
          {(block as any).url && <a href={(block as any).url} download={(block as any).filename} className="text-sm text-brand-primary hover:underline">Download</a>}
        </div>
      );

    default:
      return null;
  }
}

// ============================================================================
// EXTRACTED CODE BLOCK (from XML tool calls)
// ============================================================================

function ExtractedCodeBlock({ filename, code, language: _language }: { filename: string; code: string; language: string }) {
  const [expanded, setExpanded] = useState(false);
  const lineCount = code.split('\n').length;
  const isLong = lineCount > 30;

  return (
    <div className="mt-2 mb-1 rounded-lg overflow-hidden border border-brand-primary/20">
      <div className="flex items-center justify-between bg-background-elevated px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-text-tertiary">
          <CodeBracketIcon className="h-3 w-3 text-brand-primary" />
          <span className="text-brand-primary">{filename}</span>
          {isLong && <span className="text-text-quaternary">({lineCount} lines)</span>}
        </div>
        <div className="flex items-center gap-2">
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-text-quaternary hover:text-text-secondary transition-colors text-xs"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="text-text-quaternary hover:text-text-secondary transition-colors"
            title="Copy"
          >
            <DocumentDuplicateIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <pre className={`bg-[#1e1e2e] p-3 text-xs overflow-x-auto overflow-y-auto ${isLong && !expanded ? 'max-h-[300px]' : ''}`}>
        <code className="text-green-400">{code}</code>
      </pre>
    </div>
  );
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default TBWOChatTab;
