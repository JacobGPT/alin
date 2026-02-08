/**
 * InputArea - Message Input Component
 * 
 * Features:
 * - Multi-line input with auto-resize
 * - File upload (drag & drop + click)
 * - Image paste from clipboard
 * - Voice input button
 * - @ mentions (future)
 * - Slash commands (future)
 * - Character counter
 * - Send button with loading state
 * - Keyboard shortcuts (Cmd+Enter)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PaperAirplaneIcon,
  PaperClipIcon,
  PhotoIcon,
  XMarkIcon,
  MicrophoneIcon,
  StopIcon,
  LightBulbIcon,
  ComputerDesktopIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline';

// Store
import { useChatStore } from '@store/chatStore';
import { useSettingsStore } from '@store/settingsStore';
import { useStatusStore } from '@store/statusStore';
import { useAuditStore } from '@store/auditStore';
import { useModeStore } from '@store/modeStore';
import { useUIStore } from '@store/uiStore';

// Components
import { Button } from '@components/ui/Button';
import { ProactiveSuggestions } from './ProactiveSuggestions';

// formatFileSize is defined locally at the bottom of this file

import { getAPIService, initializeAPIService } from '@api/apiService';
import { ModelProvider, MessageRole } from '../../types/chat';
import type { ContentBlock } from '../../types/chat';
import { useArtifactStore, type ArtifactType } from '../../store/artifactStore';
import { RightPanelContent } from '../../types/ui';
import { nanoid } from 'nanoid';
import { proactiveService } from '../../services/proactiveService';
import { telemetry } from '../../services/telemetryService';
import { useCapabilities } from '../../hooks/useCapabilities';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getModeConfig } from '../../config/modes';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';



// ============================================================================
// AUTO-ARTIFACT DETECTION
// ============================================================================

interface DetectedArtifact {
  type: ArtifactType;
  language: string;
  content: string;
  title: string;
}

const ARTIFACT_LANG_MAP: Record<string, ArtifactType> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'react',
  tsx: 'react',
  react: 'react',
  chart: 'chart',
  markdown: 'markdown',
  md: 'markdown',
};

function detectArtifact(text: string): DetectedArtifact | null {
  // Match completed code fences: ```lang\n...\n```
  const fenceRegex = /```(\w+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let lastArtifact: DetectedArtifact | null = null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const codeContent = (match[2] || '').trim();

    // Skip small snippets
    if (codeContent.length < 100) continue;

    // Direct language match
    if (ARTIFACT_LANG_MAP[lang]) {
      lastArtifact = {
        type: ARTIFACT_LANG_MAP[lang],
        language: lang,
        content: codeContent,
        title: getTitleFromContent(ARTIFACT_LANG_MAP[lang], codeContent, lang),
      };
      continue;
    }

    // Check if JSON content looks like a chart spec
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(codeContent);
        if (parsed.type && parsed.data && Array.isArray(parsed.data)) {
          lastArtifact = {
            type: 'chart',
            language: 'chart',
            content: codeContent,
            title: parsed.title || 'Chart',
          };
          continue;
        }
      } catch { /* not chart JSON */ }
    }
  }

  return lastArtifact;
}

function getTitleFromContent(type: ArtifactType, content: string, lang: string): string {
  switch (type) {
    case 'html': {
      const titleMatch = content.match(/<title>(.*?)<\/title>/i);
      return titleMatch?.[1] || 'HTML App';
    }
    case 'mermaid': return 'Mermaid Diagram';
    case 'react': return 'React Component';
    case 'svg': return 'SVG Graphic';
    case 'markdown': return 'Document';
    case 'chart': return 'Chart';
    default: return `${lang.toUpperCase()} Artifact`;
  }
}

// ============================================================================
// ERROR CATEGORIZATION
// ============================================================================

function categorizeError(error: any): string {
  const msg = error?.message || String(error);
  const status = error?.status || error?.response?.status;

  if (status === 401 || msg.includes('401') || msg.includes('Unauthorized') || msg.includes('Invalid or expired token'))
    return 'Session expired. Please log in again.';
  if (status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit'))
    return 'Rate limit reached. Please wait a moment before sending another message.';
  if (status === 403 || msg.includes('403') || msg.includes('Forbidden'))
    return 'Access denied. This feature may not be available on your plan.';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION'))
    return "Can't reach the server. Check your connection and make sure the backend is running.";
  if (msg.includes('API key') || msg.includes('api_key') || msg.includes('invalid_api_key'))
    return 'API key error. Please check your API key configuration in Settings.';
  if (status === 413 || msg.includes('too large') || msg.includes('payload'))
    return 'Message too large. Try shortening your message or reducing attachments.';
  if (msg.includes('timeout') || msg.includes('Timeout'))
    return 'Request timed out. The server may be busy — try again.';

  return `Error: ${msg}`;
}

// ============================================================================
// INPUTAREA COMPONENT
// ============================================================================

interface InputAreaProps {
  conversationId: string;
}

export function InputArea({ conversationId }: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Store state
  const inputValue = useChatStore((state) => state.inputValue);
  const attachedFiles = useChatStore((state) => state.attachedFiles);
  const isSendingMessage = useChatStore((state) => state.isSendingMessage);
  const streamState = useChatStore((state) => state.streamState);
  const editingMessageId = useChatStore((state) => state.editingMessageId);

  // Store actions
  const setInputValue = useChatStore((state) => state.setInputValue);
  const attachFile = useChatStore((state) => state.attachFile);
  const removeFile = useChatStore((state) => state.removeFile);
  const clearInput = useChatStore((state) => state.clearInput);
  const addMessage = useChatStore((state) => state.addMessage);
  const cancelEditMessage = useChatStore((state) => state.cancelEditMessage);
  
  const enableThinking = useSettingsStore((state) => state.enableThinking);
  const toggleThinking = useSettingsStore((state) => state.toggleThinking);
  const modelMode = useSettingsStore((state) => state.modelMode);
  const selectedModelVersions = useSettingsStore((state) => state.selectedModelVersions);
  const thinkingBudget = useSettingsStore((state) => state.thinkingBudget);
  const reasoningEffort = useSettingsStore((state) => state.reasoningEffort);
  const setThinkingBudget = useSettingsStore((state) => state.setThinkingBudget);
  const setReasoningEffort = useSettingsStore((state) => state.setReasoningEffort);
  const enableComputerUse = useSettingsStore((state) => state.enableComputerUse);
  const enableTextEditor = useSettingsStore((state) => state.enableTextEditor);
  const caps = useCapabilities();
  const toggleComputerUse = useSettingsStore((state) => state.toggleComputerUse);
  const toggleTextEditor = useSettingsStore((state) => state.toggleTextEditor);

  // Derived state for UI controls
  const isGPTMode = modelMode === 'gpt';
  const selectedGPTModel = selectedModelVersions?.gpt || 'gpt-4o';
  const isOSeriesModel = selectedGPTModel.startsWith('o1') || selectedGPTModel.startsWith('o3');

  // ========================================================================
  // VOICE INPUT (Web Speech API)
  // ========================================================================

  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Voice] SpeechRecognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';
    let lastProcessedIndex = -1;
    // Capture the input value at start so we have a stable base
    const baseInputAtStart = useChatStore.getState().inputValue;

    recognition.onresult = (event: any) => {
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          // Only add genuinely new final results
          if (i > lastProcessedIndex) {
            finalTranscript += transcript + ' ';
            lastProcessedIndex = i;
          }
        } else {
          interimTranscript = transcript;
        }
      }
      // Update input: stable base + accumulated finals + current interim
      if (interimTranscript) {
        setInputValue(baseInputAtStart + finalTranscript + interimTranscript);
      } else {
        setInputValue(baseInputAtStart + finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[Voice] Recognition error:', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Set final clean value
      setInputValue(baseInputAtStart + finalTranscript.trimEnd());
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [setInputValue]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // ========================================================================
  // AUTO-RESIZE TEXTAREA
  // ========================================================================
  
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    }
  }, [inputValue]);
  
  // ========================================================================
  // HANDLERS
  // ========================================================================
  
  const handleSend = async () => {
    if (!inputValue.trim() && attachedFiles.length === 0) return;
    if (isSendingMessage) return;

    // If streaming, interrupt current response and then send new message
    if (useChatStore.getState().streamState.isStreaming) {
      const chatStoreSnap = useChatStore.getState();
      chatStoreSnap.completeStreaming();
      useStatusStore.getState().completeProcessing();
      // Server-side streaming — abort handled by the server proxy
      // Just let the UI state settle before sending new message
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const statusStore = useStatusStore.getState();

    // Build content blocks
    const content: any[] = [];

    // Add text
    if (inputValue.trim()) {
      content.push({
        type: 'text',
        text: inputValue.trim(),
      });
    }

    // Add files - images as base64, text files as content blocks
    const TEXT_FILE_EXTENSIONS = new Set([
      'txt', 'md', 'py', 'js', 'ts', 'jsx', 'tsx', 'json', 'csv', 'html', 'css',
      'xml', 'yaml', 'yml', 'toml', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb',
      'php', 'sh', 'bat', 'sql', 'r', 'swift', 'kt', 'scala', 'lua', 'zig',
      'env', 'cfg', 'ini', 'conf', 'log', 'gitignore', 'dockerfile',
    ]);

    for (const file of attachedFiles) {
      if (file.type.startsWith('image/')) {
        try {
          const base64Url = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          content.push({
            type: 'image',
            url: base64Url,
            alt: file.name,
          });
        } catch (err) {
          console.error('[ALIN] Failed to convert image to base64:', err);
        }
      } else {
        // Check if it's a text-based file we can read
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isTextFile = TEXT_FILE_EXTENSIONS.has(ext) || file.type.startsWith('text/');

        if (isTextFile) {
          try {
            const fileContent = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsText(file);
            });
            // Add as file block for UI display
            content.push({
              type: 'file',
              fileId: crypto.randomUUID(),
              filename: file.name,
              mimeType: file.type || 'text/plain',
              size: file.size,
            });
            // Add file content as text so the AI can read it
            content.push({
              type: 'text',
              text: `\`\`\`${ext || 'text'}\n// File: ${file.name}\n${fileContent}\n\`\`\``,
            });
          } catch (err) {
            console.error('[ALIN] Failed to read text file:', err);
            content.push({
              type: 'file',
              fileId: crypto.randomUUID(),
              filename: file.name,
              mimeType: file.type,
              size: file.size,
            });
          }
        } else {
          content.push({
            type: 'file',
            fileId: crypto.randomUUID(),
            filename: file.name,
            mimeType: file.type,
            size: file.size,
          });
        }
      }
    }

    // Handle edit mode: create a branch with edited message
    const currentEditingId = useChatStore.getState().editingMessageId;
    if (currentEditingId) {
      const chatStoreNow = useChatStore.getState();
      // Use branching: preserves original conversation as a branch
      const textContent = content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n\n');
      chatStoreNow.editMessageAndBranch(conversationId, currentEditingId, textContent);
      useChatStore.setState({ editingMessageId: null });
    } else {
      // Normal: add new user message
      addMessage(conversationId, {
        role: MessageRole.USER,
        content,
      });
    }

    // Clear input
    clearInput();

    // Proactive analysis of user message (fire-and-forget)
    const messageText = content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join(' ');
    if (messageText) {
      proactiveService.analyzeMessage(messageText);
    }

    // Start status tracking
    statusStore.startProcessing('Understanding your message...');

    // Send to actual API
    let safetyTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      let api;
      try {
        api = getAPIService();
      } catch {
        // API service routes through server proxy — no client-side keys needed
        console.log('[ALIN] API service not initialized, attempting on-demand initialization...');
        try {
          initializeAPIService({
            anthropicApiKey: 'server-proxy',
            openaiApiKey: 'server-proxy',
            braveApiKey: '',
          });
          api = getAPIService();
          console.log('[ALIN] API service initialized (server proxy mode)');
        } catch (initError: any) {
          console.error('[ALIN] On-demand initialization failed:', initError);
          statusStore.setPhase('error', 'API service not initialized');
          statusStore.completeProcessing();

          const diagnostics = [
            'API calls route through server proxy at /api/chat/stream',
            'Ensure the ALIN backend server is running on port 3002',
            'API keys are configured in the server .env file, not the browser',
          ].join('\n');

          addMessage(conversationId, {
            role: MessageRole.ASSISTANT,
            content: [
              {
                type: 'text',
                text: `API service could not be initialized.\n\n**Diagnostics:**\n${diagnostics}\n\n**How to fix:**\n1. Make sure your .env.local file is in the project root folder\n2. Restart the dev server after adding keys\n3. Or enter keys in Settings > API Keys\n\nError: ${initError.message}`,
              },
            ],
          });
          return;
        }
      }
      const chatStore = useChatStore.getState();
      const conversation = chatStore.getConversationById(conversationId);

      if (!conversation) {
        console.error('Conversation not found');
        statusStore.completeProcessing();
        return;
      }

      // Apply selected model version and determine provider before sending
      const settings = useSettingsStore.getState();
      const isGPT = settings.modelMode === 'gpt';
      const selectedModel = settings.selectedModelVersions[isGPT ? 'gpt' : 'claude'];
      const provider = isGPT ? ModelProvider.OPENAI : ModelProvider.ANTHROPIC;

      // Model version and thinking config are now read from settingsStore
      // by apiService at send time and passed to the server proxy.
      // No client-side SDK configuration needed.
      if (selectedModel) {
        console.log(`[ALIN] Using ${isGPT ? 'GPT' : 'Claude'} model: ${selectedModel}`);
      }
      console.log('[ALIN] Extended thinking:', settings.enableThinking ? `enabled (budget: ${settings.thinkingBudget})` : 'disabled');

      // Capture thinking toggle at send-time so mid-stream toggle won't break rendering
      const thinkingEnabledForThisMessage = settings.enableThinking;

      // Create placeholder assistant message for streaming
      const assistantMessageId = addMessage(conversationId, {
        role: MessageRole.ASSISTANT,
        content: [{ type: 'text', text: '' }],
        isStreaming: true,
      });

      // Start streaming state
      chatStore.startStreaming(assistantMessageId);
      statusStore.setPhase('thinking', 'Analyzing request and selecting approach...');

      // Safety timeout: auto-reset if streaming hangs for 3 minutes
      safetyTimeout = setTimeout(() => {
        const currentStream = useChatStore.getState().streamState;
        if (currentStream.isStreaming && currentStream.currentMessageId === assistantMessageId) {
          console.warn('[ALIN] Safety timeout: auto-resetting stuck streaming state');
          useChatStore.getState().updateMessage(assistantMessageId, { isStreaming: false });
          useChatStore.getState().completeStreaming();
          useStatusStore.getState().completeProcessing();
        }
      }, 180_000);

      // Set current message ID for scoping tool activities
      statusStore.setCurrentMessageId(assistantMessageId);

      // Get the conversation messages for context
      const messages = conversation.messages || [];

      // Content segment tracking for interleaved tool activities, thinking, and images
      interface ContentSegment {
        type: 'text' | 'tool_activity' | 'thinking' | 'image' | 'file';
        text?: string;
        activityIds?: string[];
        thinkingContent?: string;
        imageUrl?: string;
        imageAlt?: string;
        imageCaption?: string;
        fileName?: string;
        fileContent?: string;
        fileLanguage?: string;
      }
      const segments: ContentSegment[] = [];
      let currentTextSegment: ContentSegment | null = null;
      let currentThinkingSegment: ContentSegment | null = null;
      let autoArtifactOpened = false;

      function ensureTextSegment() {
        if (!currentTextSegment || currentTextSegment.type !== 'text') {
          currentTextSegment = { type: 'text', text: '' };
          segments.push(currentTextSegment);
          currentThinkingSegment = null;
        }
      }

      function addThinkingChunk(chunk: string) {
        if (!currentThinkingSegment || currentThinkingSegment.type !== 'thinking') {
          currentThinkingSegment = { type: 'thinking', thinkingContent: '' };
          segments.push(currentThinkingSegment);
          currentTextSegment = null;
        }
        currentThinkingSegment.thinkingContent! += chunk;
      }

      function addToolActivitySegment(activityId: string) {
        const lastSegment = segments[segments.length - 1];
        if (lastSegment?.type === 'tool_activity') {
          lastSegment.activityIds!.push(activityId);
        } else {
          segments.push({ type: 'tool_activity', activityIds: [activityId] });
        }
        currentTextSegment = null;
        currentThinkingSegment = null;
      }

      function addImageSegment(url: string, alt: string, caption?: string) {
        segments.push({ type: 'image', imageUrl: url, imageAlt: alt, imageCaption: caption });
        currentTextSegment = null;
        currentThinkingSegment = null;
      }

      function addFileSegment(filename: string, content: string, language: string) {
        segments.push({ type: 'file', fileName: filename, fileContent: content, fileLanguage: language });
        currentTextSegment = null;
        currentThinkingSegment = null;
      }

      function buildContentBlocks(): ContentBlock[] {
        const blocks: ContentBlock[] = [];
        const activities = useStatusStore.getState().toolActivities;
        for (const segment of segments) {
          if (segment.type === 'text' && segment.text) {
            blocks.push({ type: 'text', text: segment.text });
          } else if (segment.type === 'tool_activity' && segment.activityIds) {
            const segActivities = segment.activityIds
              .map(id => activities.find(a => a.id === id))
              .filter(Boolean)
              .map(a => ({
                id: a!.id,
                type: a!.type,
                label: a!.label,
                status: a!.status,
                query: a!.query,
                resultCount: a!.resultCount,
                results: a!.results,
                error: a!.error,
                input: a!.input,
                output: a!.output,
                startTime: a!.startTime,
                endTime: a!.endTime,
              }));
            if (segActivities.length > 0) {
              blocks.push({ type: 'tool_activity', activities: segActivities } as any);
            }
          } else if (segment.type === 'thinking' && segment.thinkingContent) {
            blocks.push({ type: 'thinking', content: segment.thinkingContent } as any);
          } else if (segment.type === 'image' && segment.imageUrl) {
            blocks.push({ type: 'image', url: segment.imageUrl, alt: segment.imageAlt || 'Generated image', caption: segment.imageCaption } as any);
          } else if (segment.type === 'file' && segment.fileContent) {
            // Compute file metadata for downloadable pill
            const ext = (segment.fileName || '').split('.').pop()?.toLowerCase() || '';
            const mimeMap: Record<string, string> = {
              html: 'text/html', css: 'text/css', js: 'application/javascript',
              ts: 'application/typescript', tsx: 'application/typescript',
              json: 'application/json', md: 'text/markdown', py: 'text/x-python',
              svg: 'image/svg+xml', txt: 'text/plain',
            };
            const mimeType = mimeMap[ext] || 'text/plain';
            const sizeBytes = new Blob([segment.fileContent]).size;
            const dataUrl = `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(segment.fileContent)))}`;

            // FileBlock pill — clickable, downloadable (matches Claude/ChatGPT UX)
            blocks.push({
              type: 'file', fileId: `file-${Date.now()}`, filename: segment.fileName || 'file',
              mimeType, size: sizeBytes, url: dataUrl,
            } as any);

            // Code preview underneath (truncated for large files)
            blocks.push({
              type: 'code', language: segment.fileLanguage || 'text',
              code: segment.fileContent.length > 5000
                ? segment.fileContent.slice(0, 5000) + `\n\n/* ... ${segment.fileContent.length} chars total */`
                : segment.fileContent,
              filename: segment.fileName,
            } as any);
          }
        }
        // Ensure at least one text block
        if (blocks.length === 0) {
          blocks.push({ type: 'text', text: '' });
        }
        return blocks;
      }

      // Track message send via telemetry
      telemetry.messageSent(conversationId, selectedModel || 'unknown', useModeStore.getState().currentMode);

      // Route: coding mode with server-side tool loop → sendCodingStream
      const currentMode = useModeStore.getState().currentMode;
      const currentModeConfig = getModeConfig(currentMode);
      const useCodingLoop = currentModeConfig.features.useServerSideToolLoop;

      const streamCallbacks: import('@api/apiService').StreamCallback = {
          onStart: () => {
            console.log('[ALIN] Starting stream...');
            statusStore.setPhase('responding', 'Generating response...');
          },
          onThinking: (thinking: string) => {
            // Add thinking content as a separate segment
            // Uses captured value for graceful degradation (mid-stream toggle won't break)
            if (thinkingEnabledForThisMessage) {
              addThinkingChunk(thinking);
              chatStore.updateMessage(assistantMessageId, {
                content: buildContentBlocks(),
              });
            }
          },
          onChunk: (chunk: string) => {
            // Segment-based: append to current text segment
            ensureTextSegment();
            currentTextSegment!.text! += chunk;

            // Auto-detect artifact when a code fence closes (check for ```)
            if (!autoArtifactOpened && chunk.includes('```')) {
              const fullText = segments
                .filter(s => s.type === 'text' && s.text)
                .map(s => s.text)
                .join('');
              const detected = detectArtifact(fullText);
              if (detected) {
                autoArtifactOpened = true;
                useArtifactStore.getState().openArtifact({
                  id: nanoid(),
                  title: detected.title,
                  type: detected.type,
                  language: detected.language,
                  content: detected.content,
                });
                useUIStore.getState().setRightPanel(RightPanelContent.ARTIFACT, true);
              }
            }

            // Build interleaved content blocks for live update
            chatStore.updateMessage(assistantMessageId, {
              content: buildContentBlocks(),
            });
          },
          onToolStart: (activityId: string, _toolName: string) => {
            // Insert a tool activity segment at the current position in the content
            addToolActivitySegment(activityId);

            // Live update with the new tool activity block
            chatStore.updateMessage(assistantMessageId, {
              content: buildContentBlocks(),
            });
          },
          onImageGenerated: (url: string, prompt: string, revisedPrompt?: string) => {
            // Insert generated image inline in the message
            addImageSegment(url, prompt, revisedPrompt || prompt);
            chatStore.updateMessage(assistantMessageId, {
              content: buildContentBlocks(),
            });
          },
          onFileGenerated: (filename: string, content: string, language: string) => {
            // Insert generated file inline in the message as a code block
            addFileSegment(filename, content, language);
            chatStore.updateMessage(assistantMessageId, {
              content: buildContentBlocks(),
            });
          },
          onComplete: (response: any) => {
            console.log('[ALIN] Stream complete, segments:', segments.length);
            const completedAt = Date.now();

            // Final artifact detection pass
            if (!autoArtifactOpened) {
              const fullText = segments
                .filter(s => s.type === 'text' && s.text)
                .map(s => s.text)
                .join('');
              const detected = detectArtifact(fullText);
              if (detected) {
                autoArtifactOpened = true;
                useArtifactStore.getState().openArtifact({
                  id: nanoid(),
                  title: detected.title,
                  type: detected.type,
                  language: detected.language,
                  content: detected.content,
                });
                useUIStore.getState().setRightPanel(RightPanelContent.ARTIFACT, true);
              }
            }

            // Build final interleaved content blocks with completed activity data
            const finalContent = buildContentBlocks();

            chatStore.updateMessage(assistantMessageId, {
              content: finalContent,
              isStreaming: false,
              tokens: response?.usage
                ? {
                    prompt: response.usage.inputTokens || response.usage.promptTokens || 0,
                    completion: response.usage.outputTokens || response.usage.completionTokens || 0,
                    total: response.usage.totalTokens || 0,
                  }
                : undefined,
              cost: response?.cost,
              confidence: (response as any)?.confidence,
              confidenceSignals: (response as any)?.confidenceSignals,
            });
            chatStore.completeStreaming();
            clearTimeout(safetyTimeout);

            // Record audit entry
            if (response?.usage) {
              const toolsUsed = useStatusStore.getState().toolActivities.map((a) => ({
                toolName: a.label,
                success: a.status === 'completed',
                durationMs: a.endTime && a.startTime ? a.endTime - a.startTime : undefined,
              }));

              useAuditStore.getState().addEntry({
                timestamp: completedAt,
                conversationId,
                messageId: assistantMessageId,
                provider: isGPT ? 'openai' : 'anthropic',
                model: selectedModel || 'unknown',
                tokens: {
                  prompt: response.usage.inputTokens || response.usage.promptTokens || 0,
                  completion: response.usage.outputTokens || response.usage.completionTokens || 0,
                  total: response.usage.totalTokens || 0,
                  cacheCreation: response.usage.cacheCreationTokens,
                  cacheRead: response.usage.cacheReadTokens,
                },
                cost: response.cost || 0,
                toolsUsed,
                durationMs: completedAt - (useStatusStore.getState().steps[0]?.timestamp || completedAt),
              });
            }
            // Track response via telemetry
            if (response?.usage) {
              telemetry.responseReceived(conversationId, selectedModel || 'unknown', {
                input: response.usage.inputTokens || response.usage.promptTokens || 0,
                output: response.usage.outputTokens || response.usage.completionTokens || 0,
              });
            }

            statusStore.completeProcessing();

            // Generate smart title after first exchange
            const convNow = useChatStore.getState().getConversationById(conversationId);
            if (convNow && convNow.messages && convNow.messages.length <= 3) {
              const firstUserMsg = convNow.messages.find((m) => m.role === MessageRole.USER);
              if (firstUserMsg) {
                const userText = firstUserMsg.content
                  .filter((b) => b.type === 'text')
                  .map((b) => (b as any).text)
                  .join(' ');
                if (userText) {
                  import('@api/apiService').then(({ generateChatTitle }) => {
                    generateChatTitle(userText).then((title) => {
                      if (title && title.length > 0) {
                        useChatStore.getState().updateConversation(conversationId, { title });
                      }
                    });
                  });
                }
              }
            }
          },
          onError: (error: Error) => {
            // Guard: if a new streaming session has started, don't touch it
            const currentStreamId = useChatStore.getState().streamState.currentMessageId;
            const isStale = currentStreamId !== undefined && currentStreamId !== assistantMessageId;

            const isCancellation = error.message === 'Request cancelled' || error.message?.includes('aborted');
            if (isCancellation) {
              // Preserve whatever was already streamed
              const finalContent = buildContentBlocks();
              const hasContent = finalContent.some(b =>
                (b.type === 'text' && (b as any).text?.trim()) ||
                b.type === 'tool_activity' || b.type === 'thinking' || b.type === 'image'
              );
              if (hasContent) {
                chatStore.updateMessage(assistantMessageId, { content: finalContent, isStreaming: false });
              } else {
                chatStore.deleteMessage(assistantMessageId);
              }
              if (!isStale) {
                chatStore.completeStreaming();
                statusStore.completeProcessing();
              }
              clearTimeout(safetyTimeout);
              return;
            }
            // Real error — categorize for user-friendly messages
            console.error('[ALIN] Stream error:', error);
            telemetry.error('stream', error.message || 'Unknown stream error');
            const errorMsg = categorizeError(error);
            chatStore.updateMessage(assistantMessageId, {
              content: [
                {
                  type: 'text',
                  text: errorMsg,
                },
              ],
              isStreaming: false,
            });
            if (!isStale) {
              chatStore.completeStreaming();
              statusStore.setPhase('error', error.message);
              statusStore.completeProcessing();
            }
            clearTimeout(safetyTimeout);
          },
        };

      // Route to server-side coding loop or client-side tool loop
      if (useCodingLoop) {
        const wsStore = useWorkspaceStore.getState();
        if (!wsStore.isInitialized) await wsStore.initWorkspace();
        await api.sendCodingStream(messages, wsStore.workspaceId || '', streamCallbacks);
        // Refresh workspace tree after coding loop completes
        wsStore.refreshTree();
      } else {
        await api.sendMessageStream(messages, provider, streamCallbacks);
      }
    } catch (error: any) {
      const isCancellation = error.message === 'Request cancelled' || error.message?.includes('aborted');
      if (isCancellation) {
        // Cancellation already handled in onError callback — don't double-clean
        return;
      }
      console.error('[ALIN] Failed to send message:', error);
      telemetry.error('message_send', error.message || 'Failed to send message');
      const errorMsg = categorizeError(error);
      statusStore.setPhase('error', errorMsg);
      statusStore.completeProcessing();
      useChatStore.getState().completeStreaming();
      clearTimeout(safetyTimeout);
      // Show error message
      addMessage(conversationId, {
        role: MessageRole.ASSISTANT,
        content: [
          {
            type: 'text',
            text: errorMsg,
          },
        ],
      });
    }
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
    
    // Enter to send (if not shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => attachFile(file));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const currentMode = useModeStore.getState().currentMode;
    const modeConfig = getModeConfig(currentMode);

    // In coding mode with server-side tool loop, upload to workspace
    if (modeConfig.features.useServerSideToolLoop && files.length > 0) {
      const wsStore = useWorkspaceStore.getState();
      if (!wsStore.isInitialized) await wsStore.initWorkspace();
      const count = await wsStore.uploadFiles(files);
      if (count > 0) {
        console.log(`[ALIN] Uploaded ${count} files to workspace`);
      }
      return;
    }

    files.forEach((file) => attachFile(file));
  };
  
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    items.forEach((item) => {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          attachFile(file);
        }
      }
    });
  };

  const handleStop = () => {
    const chatStore = useChatStore.getState();

    // Clear streaming on the current message
    const streamingMsgId = chatStore.streamState.currentMessageId;
    if (streamingMsgId) {
      chatStore.updateMessage(streamingMsgId, { isStreaming: false });
    }

    chatStore.completeStreaming();
    useStatusStore.getState().completeProcessing();

    // Also force-clear any stale isStreaming flags on recent messages
    const convId = chatStore.currentConversationId;
    if (convId) {
      const conv = chatStore.conversations.get(convId);
      if (conv?.messages) {
        for (const msg of conv.messages) {
          if (msg.isStreaming) {
            chatStore.updateMessage(msg.id, { isStreaming: false });
          }
        }
      }
    }

    // Server-side streaming — abort handled by the server proxy
    // UI state is already cleaned up above
  };

  // ========================================================================
  // RENDER
  // ========================================================================
  
  const canSend = (inputValue.trim() || attachedFiles.length > 0) && !isSendingMessage;
  
  return (
    <div className="border-t border-border-primary bg-background-secondary">
      {/* Proactive Suggestions */}
      <ProactiveSuggestions
        onAction={(handler, params) => {
          if (handler === 'switchMode' && params?.['mode']) {
            useModeStore.getState().setMode(params['mode'] as any);
          } else if (handler === 'openModal' && params?.['type']) {
            useUIStore.getState().openModal({ type: params['type'] as any });
          }
        }}
      />

      {/* Editing Banner */}
      {editingMessageId && (
        <div className="flex items-center justify-between px-4 py-2 bg-brand-primary/10 border-b border-brand-primary/20">
          <span className="text-xs font-medium text-brand-primary">Editing message</span>
          <button
            onClick={cancelEditMessage}
            className="text-xs text-text-tertiary hover:text-text-primary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Attached Files */}
      <AnimatePresence>
        {attachedFiles.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-b border-border-primary"
          >
            <div className="flex flex-wrap gap-2 p-4">
              {attachedFiles.map((file, index) => (
                <div
                  key={index}
                  className="group relative flex items-center gap-2 rounded-lg border border-border-primary bg-background-tertiary p-2 pr-8"
                >
                  {/* File Icon/Preview */}
                  {file.type.startsWith('image/') ? (
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="h-12 w-12 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-background-elevated">
                      <PaperClipIcon className="h-6 w-6 text-text-tertiary" />
                    </div>
                  )}
                  
                  {/* File Info */}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary" style={{ maxWidth: '150px' }}>
                      {file.name}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  
                  {/* Remove Button */}
                  <button
                    onClick={() => removeFile(index)}
                    className="absolute right-1 top-1 rounded bg-background-primary p-1 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <XMarkIcon className="h-4 w-4 text-text-tertiary" />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Input Container */}
      <div className="p-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`relative rounded-lg border transition-colors ${
            isDragging
              ? 'border-brand-primary bg-brand-primary/5'
              : 'border-border-primary bg-background-tertiary'
          }`}
        >
          {/* Drag Overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-brand-primary/10 backdrop-blur-sm">
              <div className="text-center">
                {getModeConfig(useModeStore.getState().currentMode).features.useServerSideToolLoop ? (
                  <>
                    <ArrowUpTrayIcon className="mx-auto mb-2 h-12 w-12 text-green-400" />
                    <p className="text-sm font-medium text-green-400">
                      Drop files to upload to workspace
                    </p>
                  </>
                ) : (
                  <>
                    <PhotoIcon className="mx-auto mb-2 h-12 w-12 text-brand-primary" />
                    <p className="text-sm font-medium text-brand-primary">
                      Drop files to attach
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
          
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Send a message... (Shift+Enter for new line)"
            disabled={isSendingMessage}
            className="w-full resize-none bg-transparent px-4 py-3 text-base text-text-primary placeholder:text-text-quaternary focus:outline-none disabled:opacity-50 overflow-y-auto"
            rows={1}
            style={{ minHeight: '44px', maxHeight: '144px' }}
          />
          
          {/* Bottom Bar */}
          <div className="flex items-center justify-between border-t border-border-primary px-4 py-2">
            <div className="flex items-center gap-2">
              {/* File Upload */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                accept="image/*,video/*,.pdf,.doc,.docx,.txt,.md,.py,.js,.ts,.jsx,.tsx,.json,.csv,.html,.css,.xml,.yaml,.yml,.toml,.rs,.go,.java,.c,.cpp,.h,.rb,.php,.sh,.bat,.sql,.swift,.kt,.lua,.r,.cfg,.ini,.conf,.log,.env"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-primary"
                title="Attach file"
              >
                <PaperClipIcon className="h-5 w-5" />
              </button>

              {/* Thinking Toggle */}
              <button
                onClick={toggleThinking}
                className={`rounded p-1.5 transition-colors ${
                  enableThinking
                    ? 'text-brand-primary bg-brand-primary/10 hover:bg-brand-primary/20'
                    : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
                }`}
                title={enableThinking ? 'Thinking enabled - click to disable' : 'Thinking disabled - click to enable'}
              >
                <LightBulbIcon className="h-5 w-5" />
              </button>

              {/* Adaptive Thinking Controls - shown when thinking is enabled */}
              {enableThinking && !isGPTMode && (
                <select
                  value={thinkingBudget}
                  onChange={(e) => setThinkingBudget(Number(e.target.value))}
                  className="h-7 rounded bg-background-elevated border border-border-primary px-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  title="Thinking budget (tokens)"
                >
                  <option value={1000}>1K</option>
                  <option value={5000}>5K</option>
                  <option value={10000}>10K</option>
                  <option value={25000}>25K</option>
                  <option value={50000}>50K</option>
                </select>
              )}

              {enableThinking && isGPTMode && isOSeriesModel && (
                <select
                  value={reasoningEffort}
                  onChange={(e) => setReasoningEffort(e.target.value as 'low' | 'medium' | 'high')}
                  className="h-7 rounded bg-background-elevated border border-border-primary px-1.5 text-xs text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand-primary"
                  title="Reasoning effort"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              )}

              {/* Computer Use Toggle - Claude only, requires backend + plan */}
              {!isGPTMode && caps.canComputerUse && (
                <button
                  onClick={toggleComputerUse}
                  className={`rounded p-1.5 transition-colors ${
                    enableComputerUse
                      ? 'text-brand-primary bg-brand-primary/10 hover:bg-brand-primary/20'
                      : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
                  }`}
                  title={enableComputerUse ? 'Computer use enabled' : 'Enable computer use'}
                >
                  <ComputerDesktopIcon className="h-5 w-5" />
                </button>
              )}

              {/* Text Editor Toggle - Claude only, requires backend */}
              {!isGPTMode && caps.isApp && (
                <button
                  onClick={toggleTextEditor}
                  className={`rounded p-1.5 transition-colors ${
                    enableTextEditor
                      ? 'text-brand-primary bg-brand-primary/10 hover:bg-background-hover hover:text-text-primary'
                      : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
                  }`}
                  title={enableTextEditor ? 'Text editor enabled' : 'Enable text editor'}
                >
                  <CodeBracketIcon className="h-5 w-5" />
                </button>
              )}

              {/* Voice Input - requires browser SpeechRecognition */}
              {caps.canVoiceInput && (
                <button
                  onClick={isListening ? stopListening : startListening}
                  className={`rounded p-1.5 transition-colors ${
                    isListening
                      ? 'text-red-400 bg-red-400/10 hover:bg-red-400/20 animate-pulse'
                      : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
                  }`}
                  title={isListening ? 'Stop listening' : 'Voice input'}
                >
                  <MicrophoneIcon className="h-5 w-5" />
                </button>
              )}
            </div>
            
            {/* Send/Stop Button */}
            {streamState.isStreaming ? (
              <div className="flex items-center gap-1">
                {inputValue.trim() && (
                  <Button
                    onClick={handleSend}
                    size="sm"
                    title="Send (interrupts current response)"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  onClick={handleStop}
                  size="sm"
                  variant="danger"
                  title="Stop generating"
                >
                  <StopIcon className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                onClick={handleSend}
                disabled={!canSend}
                size="sm"
                loading={isSendingMessage}
              >
                <PaperAirplaneIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        
        {/* Helper Text */}
        <p className="mt-2 text-xs text-text-quaternary">
          Press <kbd className="rounded bg-background-elevated px-1.5 py-0.5 font-mono">Enter</kbd> to send,{' '}
          <kbd className="rounded bg-background-elevated px-1.5 py-0.5 font-mono">Shift+Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}

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
