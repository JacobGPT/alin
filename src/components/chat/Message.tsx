/**
 * Message - Individual Message Component
 * 
 * Features:
 * - Multiple content types (text, code, images, files, thinking)
 * - Streaming display
 * - Markdown rendering
 * - Code syntax highlighting
 * - Copy functionality
 * - Edit/delete
 * - Reactions
 * - Annotations
 */

import { useState, memo } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import {
  SparklesIcon,
  PencilIcon,
  TrashIcon,
  ClipboardIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  SpeakerWaveIcon,
  StopIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
} from '@heroicons/react/24/outline';
import { HandThumbUpIcon as HandThumbUpSolid, HandThumbDownIcon as HandThumbDownSolid } from '@heroicons/react/24/solid';
import 'katex/dist/katex.min.css';

// Types
import { MessageRole } from '../../types/chat';
import type { Message, ContentBlock } from '../../types/chat';

// Store
import { useChatStore } from '@store/chatStore';
import { useSettingsStore } from '@store/settingsStore';
import { useMemoryStore } from '@store/memoryStore';
import { telemetry } from '../../services/telemetryService';
// Components
import { CodeBlock } from './CodeBlock';
import { ToolActivityPanel } from './ToolActivityPanel';
import { cn } from '@utils/cn';
import { copyToClipboard } from '@utils/cn';

// ============================================================================
// THINKING BLOCK DISPLAY
// ============================================================================

function ThinkingBlockDisplay({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className={`my-3${isStreaming ? ' thinking-shimmer animate-float-subtle' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left rounded-t-xl px-4 py-3 bg-background-tertiary/40 border border-border-primary/30 hover:bg-background-tertiary/60 transition-colors"
        style={{ borderRadius: isExpanded ? '0.75rem 0.75rem 0 0' : '0.75rem' }}
      >
        <SparklesIcon className="h-4 w-4 text-brand-primary/60 flex-shrink-0" />
        <span className="text-sm font-medium text-text-tertiary">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        {isStreaming && (
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-brand-primary/60 animate-pulse" />
        )}
        <span className="ml-auto">
          {isExpanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5 text-text-quaternary" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5 text-text-quaternary" />
          )}
        </span>
      </button>
      {isExpanded && (
        <div className="px-4 py-3 bg-background-tertiary/20 border border-t-0 border-border-primary/30 rounded-b-xl">
          <div className="text-sm text-text-tertiary/80 leading-relaxed prose prose-sm prose-invert max-w-none prose-p:text-text-tertiary/80 prose-li:text-text-tertiary/80 prose-strong:text-text-tertiary">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MESSAGE COMPONENT
// ============================================================================

interface MessageComponentProps {
  message: Message;
  showAvatar: boolean;
  showTimestamp: boolean;
  conversationId: string;
}

export const MessageComponent = memo(function MessageComponent({
  message,
  showAvatar,
  showTimestamp,
  conversationId,
}: MessageComponentProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Store
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const startEditMessage = useChatStore((state) => state.startEditMessage);
  const retryFromMessage = useChatStore((state) => state.retryFromMessage);
  const chatPreferences = useSettingsStore((state) => state.chat);
  const voicePreferences = useSettingsStore((state) => state.voice);
  
  const isUser = message.role === MessageRole.USER;
  const isThinking = message.role === MessageRole.THINKING;
  
  // ========================================================================
  // HANDLERS
  // ========================================================================
  
  const handleCopy = async () => {
    const textContent = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n\n');
    
    const success = await copyToClipboard(textContent);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const handleEdit = () => {
    startEditMessage(message.id);
  };

  const handleRetry = () => {
    const text = retryFromMessage(conversationId, message.id);
    if (text) {
      useChatStore.getState().setInputValue(text);
    }
  };
  
  const handleDelete = () => {
    if (confirm('Delete this message?')) {
      deleteMessage(message.id);
    }
  };
  
  const handleReaction = (emoji: string) => {
    // TODO: Implement reactions
    console.log('Add reaction:', emoji);
  };

  const handleFeedback = (type: 'positive' | 'negative') => {
    const updateMessage = useChatStore.getState().updateMessage;
    const current = message.feedback;
    const newFeedback = current === type ? undefined : type; // toggle off if same
    updateMessage(message.id, { feedback: newFeedback } as any);

    // Track feedback via telemetry
    if (newFeedback) {
      telemetry.feedback(conversationId, message.id, newFeedback === 'positive' ? 'thumbs_up' : 'thumbs_down');
    }

    // Store feedback as a high-salience memory for adaptive learning
    if (newFeedback) {
      const textContent = message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as any).text)
        .join(' ')
        .slice(0, 200);
      useMemoryStore.getState().addMemory({
        layer: 'procedural' as any,
        content: `User gave ${newFeedback} feedback on response: "${textContent}..."`,
        salience: newFeedback === 'negative' ? 0.9 : 0.7,
        decayRate: 0.005,
        tags: ['user-feedback', newFeedback, message.model || 'unknown-model'],
        relatedMemories: [],
        isConsolidated: false,
        isArchived: false,
        isPinned: false,
        userModified: true,
      });
    }
  };

  const handleSpeak = () => {
    if (isSpeaking) {
      speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const textContent = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n\n');

    if (!textContent.trim()) return;

    const utterance = new SpeechSynthesisUtterance(textContent);
    utterance.rate = voicePreferences.speed || 1;
    utterance.pitch = 1;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    speechSynthesis.speak(utterance);
    setIsSpeaking(true);
  };
  
  // ========================================================================
  // RENDER CONTENT BLOCKS
  // ========================================================================
  
  // Close unclosed code fences during streaming so partial code renders in a code block
  const closeUnfinishedCodeFences = (text: string): string => {
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

  const renderContentBlock = (block: ContentBlock, index: number) => {
    switch (block.type) {
      case 'text':
        if (!chatPreferences.markdownRendering) {
          return (
            <div key={index} className="whitespace-pre-wrap text-sm text-text-primary">
              {block.text}
            </div>
          );
        }
        // During streaming, close unclosed code fences so code renders live in a block
        const displayText = message.isStreaming ? closeUnfinishedCodeFences(block.text || '') : (block.text || '');
        return (
          <div key={index} className="markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeRaw]}
              components={{
                code: ({ className, children, ...props }: any) => {
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';

                  if (language) {
                    return (
                      <CodeBlock
                        code={String(children).replace(/\n$/, '')}
                        language={language}
                      />
                    );
                  }

                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {displayText}
            </ReactMarkdown>
          </div>
        );
      
      case 'code':
        return (
          <CodeBlock
            key={index}
            code={block.code}
            language={block.language}
            filename={block.filename}
          />
        );
      
      case 'image':
        return (
          <div key={index} className="my-4 group/img relative inline-block">
            <img
              src={block.url}
              alt={block.alt || 'Generated image'}
              className="max-w-full rounded-lg border border-border-primary"
              style={{ maxHeight: '500px' }}
            />
            {/* Download button overlay */}
            <a
              href={block.url}
              download={`alin-image-${Date.now()}.png`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-2 right-2 rounded-lg bg-background-primary/80 p-2 opacity-0 group-hover/img:opacity-100 transition-opacity backdrop-blur-sm border border-border-primary hover:bg-background-elevated"
              title="Download image"
              onClick={(e) => {
                e.stopPropagation();
                // Fetch and download since DALL-E URLs are cross-origin
                fetch(block.url)
                  .then(res => res.blob())
                  .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `alin-image-${Date.now()}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => {
                    // Fallback: open in new tab
                    window.open(block.url, '_blank');
                  });
                e.preventDefault();
              }}
            >
              <ArrowDownTrayIcon className="h-5 w-5 text-text-primary" />
            </a>
            {block.caption && (
              <p className="mt-2 text-sm text-text-tertiary">{block.caption}</p>
            )}
          </div>
        );
      
      case 'file':
        return (
          <div
            key={index}
            className="my-2 flex items-center gap-3 rounded-lg border border-border-primary bg-background-tertiary p-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background-elevated">
              <ClipboardIcon className="h-5 w-5 text-text-tertiary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {block.filename}
              </p>
              <p className="text-xs text-text-tertiary">
                {formatFileSize(block.size)}
              </p>
            </div>
            {block.url && (
              <a
                href={block.url}
                download={block.filename}
                className="text-sm text-brand-primary hover:underline"
              >
                Download
              </a>
            )}
          </div>
        );
      
      case 'thinking':
        if (!chatPreferences.showThinking) return null;
        return (
          <ThinkingBlockDisplay
            key={index}
            content={block.content}
            isStreaming={message.isStreaming}
          />
        );

      case 'tool_activity':
        return (
          <ToolActivityPanel
            key={index}
            activities={(block as any).activities}
            isProcessing={message.isStreaming}
          />
        );

      default:
        return null;
    }
  };
  
  // ========================================================================
  // RENDER
  // ========================================================================
  
  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group relative rounded-lg transition-colors',
        isUser && 'ml-auto max-w-[80%]',
        isThinking && 'opacity-80',
        message.isPinned && 'ring-2 ring-brand-accent'
      )}
    >
      <div className={cn(
        'flex gap-4 p-4',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}>
        {/* Avatar - assistant only */}
        {showAvatar && !isUser && (
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-accent to-brand-secondary">
            <SparklesIcon className="h-5 w-5 text-white" />
          </div>
        )}

        {/* Content */}
        <div className={cn(
          'min-w-0 space-y-2',
          isUser ? 'rounded-xl bg-background-tertiary px-4 py-3 w-fit max-w-full' : 'flex-1'
        )}>
          {/* Role Badge - assistant/system only */}
          {showAvatar && !isUser && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                {message.role === MessageRole.ASSISTANT && 'ALIN'}
                {message.role === MessageRole.SYSTEM && 'System'}
                {message.role === MessageRole.THINKING && 'Thinking'}
              </span>
            </div>
          )}
          {isUser && message.isEdited && (
            <span className="text-xs text-text-quaternary text-right">(edited - branched)</span>
          )}

          {/* Message Content */}
          <div className={cn(
            'prose prose-invert max-w-none',
            isUser && 'text-right'
          )}>
            {message.content.map((block, index) => renderContentBlock(block, index))}
          </div>
          
          {/* Metadata */}
          {(showTimestamp || message.tokens) && (
            <div className={cn(
              'flex items-center gap-3 text-xs text-text-quaternary',
              isUser && 'justify-end'
            )}>
              {showTimestamp && chatPreferences.showTimestamps && (
                <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
              )}
              {message.tokens && chatPreferences.showTokenCount && (
                <span>
                  {(message.tokens.total ?? ((message.tokens.prompt || 0) + (message.tokens.completion || 0))).toLocaleString()} tokens
                </span>
              )}
              {message.cost && (
                <span>
                  ${message.cost.toFixed(4)}
                </span>
              )}
            </div>
          )}

          {/* Feedback buttons (thumbs up/down) — assistant messages only */}
          {!isUser && !message.isStreaming && (
            <div className="flex items-center gap-1 mt-1">
              <button
                onClick={() => handleFeedback('positive')}
                className={cn(
                  'p-1 rounded transition-colors',
                  message.feedback === 'positive'
                    ? 'text-green-400 bg-green-500/15'
                    : 'text-text-quaternary hover:text-green-400 hover:bg-green-500/10'
                )}
                title="Good response"
              >
                {message.feedback === 'positive'
                  ? <HandThumbUpSolid className="w-3.5 h-3.5" />
                  : <HandThumbUpIcon className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => handleFeedback('negative')}
                className={cn(
                  'p-1 rounded transition-colors',
                  message.feedback === 'negative'
                    ? 'text-red-400 bg-red-500/15'
                    : 'text-text-quaternary hover:text-red-400 hover:bg-red-500/10'
                )}
                title="Bad response"
              >
                {message.feedback === 'negative'
                  ? <HandThumbDownSolid className="w-3.5 h-3.5" />
                  : <HandThumbDownIcon className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}

          {/* Reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.reactions.map((reaction, index) => (
                <button
                  key={index}
                  onClick={() => handleReaction(reaction.emoji)}
                  className="inline-flex items-center gap-1 rounded-full bg-background-elevated px-2 py-1 text-xs hover:bg-background-hover"
                >
                  <span>{reaction.emoji}</span>
                  <span className="text-text-tertiary">{reaction.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Actions */}
        {isHovered && !message.isStreaming && (
          <div className={cn(
            'flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity',
            isUser && 'order-first'
          )}>
            {isUser ? (
              <>
                <button
                  onClick={handleCopy}
                  className="rounded p-1 text-text-tertiary hover:bg-background-hover hover:text-text-primary"
                  title="Copy"
                >
                  {copied ? <CheckIcon className="h-4 w-4 text-semantic-success" /> : <ClipboardIcon className="h-4 w-4" />}
                </button>
                <button
                  onClick={handleEdit}
                  className="rounded p-1 text-text-tertiary hover:bg-background-hover hover:text-text-primary"
                  title="Edit"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={handleRetry}
                  className="rounded p-1 text-text-tertiary hover:bg-background-hover hover:text-text-primary"
                  title="Retry"
                >
                  <ArrowPathIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={handleDelete}
                  className="rounded p-1 text-text-tertiary hover:bg-semantic-error-bg hover:text-semantic-error"
                  title="Delete"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCopy}
                  className="rounded p-1 text-text-tertiary hover:bg-background-hover hover:text-text-primary"
                  title="Copy"
                >
                  {copied ? <CheckIcon className="h-4 w-4 text-semantic-success" /> : <ClipboardIcon className="h-4 w-4" />}
                </button>
                <button
                  onClick={handleSpeak}
                  className={`rounded p-1 transition-colors ${
                    isSpeaking
                      ? 'text-brand-primary hover:bg-background-hover'
                      : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
                  }`}
                  title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
                >
                  {isSpeaking ? <StopIcon className="h-4 w-4" /> : <SpeakerWaveIcon className="h-4 w-4" />}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      
      {/* Streaming Indicator */}
      {message.isStreaming && (
        <div className="flex items-center gap-2 px-4 pb-4 text-text-tertiary">
          <div className="flex gap-1">
            <div className="h-2 w-2 rounded-full bg-current animate-pulse" />
            <div className="h-2 w-2 rounded-full bg-current animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="h-2 w-2 rounded-full bg-current animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
          <span className="text-xs">Generating...</span>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
