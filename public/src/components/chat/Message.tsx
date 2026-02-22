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

import { useState, useEffect, memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { VideoEmbed } from './VideoEmbed';

// Types
import { MessageRole } from '../../types/chat';
import type { Message, ContentBlock } from '../../types/chat';

// Store
import { useChatStore } from '@store/chatStore';
import { useSettingsStore } from '@store/settingsStore';
import { useMemoryStore } from '@store/memoryStore';
import { telemetry } from '../../services/telemetryService';
import { onUserCorrection } from '../../services/selfModelService';
import { useTrustStore } from '../../store/trustStore';
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
// AUTHENTICATED IMAGE — fetches /api/ URLs with auth header
// ============================================================================

function useAuthToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    import('@store/authStore').then(({ useAuthStore }) => {
      setToken(useAuthStore.getState().token);
    });
  }, []);
  return token;
}

function AuthenticatedImage({ url, alt, className, style }: { url: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const token = useAuthToken();
  const needsAuth = url.startsWith('/api/') && !url.startsWith('/api/assets/');

  useEffect(() => {
    if (!needsAuth) return;
    // Reset state on each attempt (fixes race condition when token arrives late)
    setError(false);
    setBlobUrl(null);
    // Wait for token before fetching auth-protected URLs
    if (!token) return;
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (cancelled) return;
        if (!res.ok) { setError(true); return; }
        const blob = await res.blob();
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        setBlobUrl(revoke);
      } catch { if (!cancelled) setError(true); }
    })();
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [url, token, needsAuth]);

  if (error) return <div className="text-sm text-text-tertiary italic">Failed to load image</div>;
  const src = needsAuth ? blobUrl : url;
  if (needsAuth && !blobUrl) {
    return <div className="animate-pulse bg-background-tertiary rounded-lg" style={{ width: 300, height: 200, ...style }} />;
  }
  return <img src={src!} alt={alt} className={className} style={style} />;
}

// ============================================================================
// MEDIA LIGHTBOX — fullscreen overlay for images & videos
// ============================================================================

function MediaLightbox({
  src,
  alt,
  type,
  onClose,
}: {
  src: string;
  alt: string;
  type: 'image' | 'video';
  onClose: () => void;
}) {
  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm cursor-zoom-out"
        onClick={onClose}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Media content */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="max-w-[90vw] max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {type === 'image' ? (
            <img
              src={src}
              alt={alt}
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
          ) : (
            <video
              src={src}
              controls
              autoPlay
              className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
            />
          )}
        </motion.div>

        {/* Caption */}
        {alt && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-lg text-center">
            <span className="text-sm text-white/70 bg-black/50 px-4 py-2 rounded-full">{alt}</span>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

async function fetchWithAuth(url: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  if (url.startsWith('/api/')) {
    try {
      const { useAuthStore } = await import('@store/authStore');
      const token = useAuthStore.getState().token;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {}
  }
  const res = await fetch(url, { headers });
  return res.blob();
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
  // isHovered state removed — using CSS group-hover:opacity-100 instead to prevent layout shift
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string; type: 'image' | 'video' } | null>(null);

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

      // Record feedback in trust system (invisible to user, powers intelligence)
      useTrustStore.getState().recordFeedback(newFeedback);

      // Record negative feedback as a user correction for self-model learning
      if (newFeedback === 'negative') {
        onUserCorrection(
          textContent,
          'User indicated this response was unhelpful',
          message.model || 'general',
        ).catch(() => {});
      }

      // Consequence Engine: resolve recent prediction based on user feedback (fire-and-forget)
      import('../../services/consequenceService').then(({ resolveRecentPrediction }) => {
        resolveRecentPrediction(
          conversationId,
          newFeedback === 'positive' ? 'correct' : 'wrong',
          'user_feedback',
          `User gave ${newFeedback} feedback on response`,
        ).catch(() => {});
      }).catch(() => {});
    }
  };

  const handleSpeak = async () => {
    if (isSpeaking) {
      // Stop any playing audio or Web Speech
      speechSynthesis.cancel();
      const existing = document.querySelector(`audio[data-msg-id="${message.id}"]`) as HTMLAudioElement;
      if (existing) { existing.pause(); existing.remove(); }
      setIsSpeaking(false);
      return;
    }

    const rawText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('\n\n');

    if (!rawText.trim()) return;

    // Clean markdown for speech
    const cleanText = rawText
      .replace(/```[\s\S]*?```/g, ' code block omitted ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#{1,6}\s/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, 'image: $1')
      .replace(/[-*+]\s/g, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .trim();

    setIsSpeaking(true);

    // Try server TTS (ElevenLabs primary, OpenAI fallback)
    try {
      const token = (await import('@store/authStore')).useAuthStore.getState().token;
      const ttsRes = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: cleanText, voice: voicePreferences.voice || 'nova' }),
      });

      if (ttsRes.ok && ttsRes.headers.get('content-type')?.includes('audio')) {
        const blob = await ttsRes.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audio.setAttribute('data-msg-id', message.id);
        audio.playbackRate = voicePreferences.speed || 1;
        audio.onended = () => { setIsSpeaking(false); URL.revokeObjectURL(audioUrl); audio.remove(); };
        audio.onerror = () => { setIsSpeaking(false); URL.revokeObjectURL(audioUrl); audio.remove(); };
        document.body.appendChild(audio);
        await audio.play();
        return;
      }
    } catch { /* fall through to Web Speech API */ }

    // Fallback: Web Speech API
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = voicePreferences.speed || 1;
      utterance.pitch = 1;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      speechSynthesis.speak(utterance);
    } else {
      setIsSpeaking(false);
    }
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

  // Convert LaTeX delimiters \[...\] and \(...\) to $$...$$ and $...$
  // so remark-math can parse them for KaTeX rendering.
  // Also escape currency $signs so remark-math doesn't treat "$50" as math.
  const convertLatexDelimiters = (text: string): string => {
    // Don't convert inside code blocks
    const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
    return parts.map((part, i) => {
      // Odd indices are code blocks — leave them alone
      if (i % 2 === 1) return part;
      // Convert display math: \[...\] → $$...$$
      let converted = part.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`);
      // Convert inline math: \(...\) → $...$
      converted = converted.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`);
      // Escape currency $ signs — "$" followed by a digit is money, not math.
      // Replace "$123" with "\$123" so remark-math ignores it.
      converted = converted.replace(/\$(\d)/g, '\\$$1');
      return converted;
    }).join('');
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
        const rawText = message.isStreaming ? closeUnfinishedCodeFences(block.text || '') : (block.text || '');
        const displayText = convertLatexDelimiters(rawText);
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
                a: ({ href, children, ...props }: any) => {
                  if (href?.startsWith('/api/')) {
                    // Internal API link — suppress navigation
                    return <span className="text-brand-primary cursor-default" {...props}>{children}</span>;
                  }
                  // External link — open in new tab
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline" {...props}>
                      {children}
                    </a>
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
          <div key={index} className="my-1 group/img relative inline-block">
            {/* Click to enlarge */}
            <div
              className="cursor-zoom-in"
              onClick={() => setLightbox({ src: block.url, alt: block.alt || 'Generated image', type: 'image' })}
            >
              <AuthenticatedImage
                url={block.url}
                alt={block.alt || 'Generated image'}
                className="max-w-full rounded-lg border border-border-primary hover:border-brand-primary/50 transition-colors"
                style={{ maxHeight: '500px' }}
              />
            </div>
            {/* Download button overlay */}
            <button
              className="absolute top-2 right-2 rounded-lg bg-background-primary/80 p-2 opacity-0 group-hover/img:opacity-100 transition-opacity backdrop-blur-sm border border-border-primary hover:bg-background-elevated"
              title="Download image"
              onClick={(e) => {
                e.stopPropagation();
                fetchWithAuth(block.url)
                  .then(blob => {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `alin-image-${Date.now()}.png`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                  .catch(() => {
                    window.open(block.url, '_blank');
                  });
              }}
            >
              <ArrowDownTrayIcon className="h-5 w-5 text-text-primary" />
            </button>
            {block.caption && (
              <p className="mt-2 text-sm text-text-tertiary">{block.caption}</p>
            )}
          </div>
        );
      
      case 'file':
        return (
          <div
            key={index}
            className="my-1 flex items-center gap-2 rounded-lg border border-border-primary bg-background-tertiary p-2"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background-elevated">
              <ClipboardIcon className="h-4 w-4 text-text-tertiary" />
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

      case 'video_embed':
        return (
          <VideoEmbed
            key={index}
            url={(block as any).url}
            embed_url={(block as any).embed_url}
            platform={(block as any).platform}
            title={(block as any).title}
            thumbnail={(block as any).thumbnail}
            timestamp={(block as any).timestamp}
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
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 shadow-sm shadow-indigo-500/20">
            <SparklesIcon className="h-4 w-4 text-white" />
          </div>
        )}

        {/* Content */}
        <div className={cn(
          'min-w-0',
          isUser ? 'flex flex-col items-end gap-2' : 'flex-1 space-y-2'
        )}>
          {/* Role Badge - assistant/system only */}
          {showAvatar && !isUser && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                {message.role === MessageRole.ASSISTANT && 'ALIN'}
                {message.role === MessageRole.SYSTEM && 'System'}
                {message.role === MessageRole.THINKING && 'Thinking'}
              </span>
              {/* Model badge for Both/Hybrid mode */}
              {message.modelLabel && (
                <span className={cn(
                  'text-xs font-medium px-1.5 py-0.5 rounded',
                  message.modelLabel.toLowerCase().includes('claude')
                    ? 'bg-orange-500/15 text-orange-400'
                    : message.modelLabel.toLowerCase().includes('gemini')
                    ? 'bg-blue-500/15 text-blue-400'
                    : message.modelLabel.toLowerCase().includes('deepseek')
                    ? 'bg-cyan-500/15 text-cyan-400'
                    : 'bg-green-500/15 text-green-400'
                )}>
                  {message.modelLabel}
                </span>
              )}
              {/* Hybrid phase badge */}
              {message.hybridPhase && (
                <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
                  {message.hybridPhase === 'planner' ? 'Planner' : 'Executor'}
                </span>
              )}
            </div>
          )}

          {/* Message Content — for user messages, attachments float ABOVE the text bubble (like Claude/ChatGPT) */}
          {isUser ? (() => {
            const attachmentBlocks = message.content.filter(b => b.type === 'image' || b.type === 'file');
            const otherBlocks = message.content.filter(b => b.type !== 'image' && b.type !== 'file');

            return (
              <>
                {/* Attachments — separate row above text, no bubble background */}
                {attachmentBlocks.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-end">
                    {attachmentBlocks.map((block, index) => renderContentBlock(block, index))}
                  </div>
                )}
                {/* Text bubble — compact, separate from attachments */}
                {otherBlocks.length > 0 && (
                  <div className="rounded-2xl bg-background-tertiary/80 px-4 py-2.5 w-fit max-w-full border border-border-primary/30">
                    {message.isEdited && (
                      <span className="text-xs text-text-quaternary block text-right mb-1">(edited - branched)</span>
                    )}
                    <div className="prose prose-invert max-w-none text-right">
                      {otherBlocks.map((block, index) => renderContentBlock(block, attachmentBlocks.length + index))}
                    </div>
                  </div>
                )}
              </>
            );
          })() : (
            <div className="prose prose-invert max-w-none">
              {message.content.map((block, index) => renderContentBlock(block, index))}
            </div>
          )}
          
          {/* Metadata — only timestamp, no internal metrics */}
          {showTimestamp && chatPreferences.showTimestamps && (
            <div className={cn(
              'flex items-center gap-3 text-xs text-text-quaternary',
              isUser && 'justify-end'
            )}>
              <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
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
        
        {/* Actions — always rendered, opacity-only transition to prevent layout shift */}
        {!message.isStreaming && (
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
                <button
                  onClick={() => handleFeedback('positive')}
                  className={cn(
                    'rounded p-1 transition-colors',
                    message.feedback === 'positive'
                      ? 'text-green-400 bg-green-500/15'
                      : 'text-text-tertiary hover:text-green-400 hover:bg-green-500/10'
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
                    'rounded p-1 transition-colors',
                    message.feedback === 'negative'
                      ? 'text-red-400 bg-red-500/15'
                      : 'text-text-tertiary hover:text-red-400 hover:bg-red-500/10'
                  )}
                  title="Bad response"
                >
                  {message.feedback === 'negative'
                    ? <HandThumbDownSolid className="w-3.5 h-3.5" />
                    : <HandThumbDownIcon className="w-3.5 h-3.5" />}
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

      {/* Truncation Indicator — shown when response was cut off and no auto-continuation */}
      {!message.isStreaming && message.stopReason === 'max_tokens' && (
        <div className="flex items-center gap-2 px-4 pb-3 text-amber-400/80">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="text-xs">Response was truncated due to length limits. Try increasing Max Tokens in Settings.</span>
        </div>
      )}

      {/* Lightbox for enlarged images/videos */}
      {lightbox && (
        <MediaLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          type={lightbox.type}
          onClose={() => setLightbox(null)}
        />
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
