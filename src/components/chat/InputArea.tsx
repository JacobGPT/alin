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
import { ProactiveSuggestionPanel } from './ProactiveSuggestionPanel';

import { getAPIService, initializeAPIService } from '@api/apiService';
import { ModelProvider, MessageRole } from '../../types/chat';
import type { ContentBlock } from '../../types/chat';
import { useArtifactStore } from '../../store/artifactStore';
import { RightPanelContent } from '../../types/ui';
import { nanoid } from 'nanoid';
import { proactiveService } from '../../services/proactiveService';
import { telemetry } from '../../services/telemetryService';
import { useCapabilities } from '../../hooks/useCapabilities';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getModeConfig } from '../../config/modes';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';

// Extracted utilities
import { detectArtifact } from './utils/artifactDetector';
import { categorizeError } from './utils/errorCategorizer';
import { formatFileSize } from './utils/contentSegments';

// ============================================================================
// INPUTAREA COMPONENT
// ============================================================================

interface InputAreaProps {
  conversationId: string;
  onOpenVoiceConversation?: () => void;
  sendRef?: React.MutableRefObject<(() => void) | null>;
}

export function InputArea({ conversationId, onOpenVoiceConversation, sendRef }: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  
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
  const caps = useCapabilities();

  // Derived state for UI controls
  const isGPTMode = modelMode === 'gpt';
  const selectedGPTModel = selectedModelVersions?.gpt || 'gpt-4o';
  const isOSeriesModel = selectedGPTModel.startsWith('o1') || selectedGPTModel.startsWith('o3') || selectedGPTModel.startsWith('o4');

  // ========================================================================
  // VOICE INPUT — MediaRecorder → Whisper STT (with Web Speech API live preview)
  // ========================================================================

  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const voiceStartPositionRef = useRef<number>(0);

  const startListening = useCallback(() => {
    const baseInputAtStart = useChatStore.getState().inputValue;
    voiceStartPositionRef.current = baseInputAtStart.length;

    // Start MediaRecorder for Whisper transcription
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.start(250); // collect in 250ms chunks
      mediaRecorderRef.current = recorder;
    }).catch((err) => {
      console.error('[Voice] Microphone access denied:', err);
    });

    // Start Web Speech API for live preview while recording
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      let finalTranscript = '';
      let lastProcessedIndex = -1;

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            if (i > lastProcessedIndex) {
              finalTranscript += transcript + ' ';
              lastProcessedIndex = i;
            }
          } else {
            interimTranscript = transcript;
          }
        }
        if (interimTranscript) {
          setInputValue(baseInputAtStart + finalTranscript + interimTranscript);
        } else {
          setInputValue(baseInputAtStart + finalTranscript);
        }
      };

      recognition.onerror = () => {};
      recognition.onend = () => {};

      recognitionRef.current = recognition;
      try { recognition.start(); } catch {}
    }

    setIsListening(true);
  }, [setInputValue]);

  const stopListening = useCallback(async () => {
    // Stop Web Speech API preview
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);

    // Stop MediaRecorder and send to Whisper
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      setIsTranscribing(true);
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });

      // Stop all mic tracks
      recorder.stream.getTracks().forEach(t => t.stop());
      mediaRecorderRef.current = null;

      if (audioChunksRef.current.length > 0) {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        try {
          const { useAuthStore } = await import('@store/authStore');
          const token = useAuthStore.getState().token;
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const res = await fetch('/api/voice/transcribe', {
            method: 'POST',
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            body: formData,
          });

          if (res.ok) {
            const data = await res.json();
            if (data.text) {
              // Replace only the voice portion, preserving pre-voice typed text
              const preVoiceText = useChatStore.getState().inputValue.slice(0, voiceStartPositionRef.current);
              setInputValue((preVoiceText ? preVoiceText + ' ' : '') + data.text);
            }
          }
        } catch (err) {
          console.error('[Voice] Whisper transcription failed, keeping Web Speech result:', err);
        }
      }
      setIsTranscribing(false);
    }
  }, [setInputValue]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) { recognitionRef.current.stop(); }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
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
  
  // Helper to get a display label for a model ID
  const getModelLabel = (modelId: string | undefined): string => {
    if (!modelId) return 'Unknown Model';
    if (modelId.includes('opus')) return 'Claude Opus 4.6';
    if (modelId.includes('sonnet-4-5')) return 'Claude Sonnet 4.5';
    if (modelId.includes('sonnet-4-2')) return 'Claude Sonnet 4';
    if (modelId.includes('haiku')) return 'Claude Haiku 4.5';
    if (modelId.includes('gpt-5-mini')) return 'GPT-5 Mini';
    if (modelId.includes('gpt-5.2')) return 'GPT-5.2';
    if (modelId.includes('gpt-5.1')) return 'GPT-5.1';
    if (modelId.includes('gpt-5')) return 'GPT-5';
    if (modelId.includes('gpt-4o-mini')) return 'GPT-4o Mini';
    if (modelId.includes('gpt-4o')) return 'GPT-4o';
    if (modelId.includes('o4-mini')) return 'o4-mini';
    if (modelId.includes('o3-mini')) return 'o3-mini';
    if (modelId.includes('gemini-3-pro')) return 'Gemini 3 Pro';
    if (modelId.includes('gemini-3-flash')) return 'Gemini 3 Flash';
    if (modelId.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
    if (modelId.includes('gemini-2.5-flash-lite')) return 'Gemini 2.5 Flash-Lite';
    if (modelId.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash';
    if (modelId === 'deepseek-reasoner') return 'DeepSeek Reasoner';
    if (modelId === 'deepseek-chat') return 'DeepSeek V3.2';
    return modelId;
  };

  const handleSend = async () => {
    // Read inputValue fresh from store (not closure) — critical for voice mode
    // where setInputValue() is called externally just before handleSend()
    const currentInputValue = useChatStore.getState().inputValue || inputValue;
    if (!currentInputValue.trim() && attachedFiles.length === 0) return;
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
    if (currentInputValue.trim()) {
      content.push({
        type: 'text',
        text: currentInputValue.trim(),
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
      const isBothMode = settings.modelMode === 'both';
      const isHybridMode = settings.modelMode === 'hybrid';
      const isGPT = settings.modelMode === 'gpt';
      const isGemini = settings.modelMode === 'gemini';
      const isDeepSeek = settings.modelMode === 'deepseek';
      const selectedModel = isBothMode ? settings.selectedModelVersions.bothClaude
        : isHybridMode ? settings.selectedModelVersions.hybridPlanner
        : isGemini ? settings.selectedModelVersions.gemini
        : isDeepSeek ? settings.selectedModelVersions.deepseek
        : settings.selectedModelVersions[isGPT ? 'gpt' : 'claude'];
      const provider = isGemini ? ('gemini' as any)
        : isDeepSeek ? ('deepseek' as any)
        : isGPT ? ModelProvider.OPENAI : ModelProvider.ANTHROPIC;

      if (selectedModel) {
        console.log(`[ALIN] Using ${isBothMode ? 'Both' : isHybridMode ? 'Hybrid' : isGPT ? 'GPT' : 'Claude'} mode: ${selectedModel}`);
      }
      console.log('[ALIN] Extended thinking:', settings.enableThinking ? `enabled (budget: ${settings.thinkingBudget})` : 'disabled');

      // Capture thinking toggle at send-time so mid-stream toggle won't break rendering
      const thinkingEnabledForThisMessage = settings.enableThinking;

      // Create placeholder assistant message for streaming
      const assistantMessageId = addMessage(conversationId, {
        role: MessageRole.ASSISTANT,
        content: [{ type: 'text', text: '' }],
        isStreaming: true,
        ...(isBothMode ? { modelLabel: getModelLabel(settings.selectedModelVersions.bothClaude) } : {}),
        ...(isHybridMode ? { modelLabel: getModelLabel(settings.selectedModelVersions.hybridPlanner), hybridPhase: 'planner' } : {}),
      } as any);

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
        type: 'text' | 'tool_activity' | 'thinking' | 'image' | 'file' | 'video_embed';
        text?: string;
        activityIds?: string[];
        thinkingContent?: string;
        imageUrl?: string;
        imageAlt?: string;
        imageCaption?: string;
        fileName?: string;
        fileContent?: string;
        fileLanguage?: string;
        videoUrl?: string;
        videoEmbedUrl?: string;
        videoPlatform?: string;
        videoTitle?: string;
        videoThumbnail?: string;
        videoTimestamp?: number;
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

      function addVideoEmbedSegment(video: { url: string; embed_url: string; platform: string; title?: string; thumbnail?: string; timestamp?: number }) {
        segments.push({ type: 'video_embed', videoUrl: video.url, videoEmbedUrl: video.embed_url, videoPlatform: video.platform, videoTitle: video.title, videoThumbnail: video.thumbnail, videoTimestamp: video.timestamp });
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
          } else if (segment.type === 'video_embed' && segment.videoUrl && segment.videoEmbedUrl) {
            blocks.push({
              type: 'video_embed',
              url: segment.videoUrl,
              embed_url: segment.videoEmbedUrl,
              platform: segment.videoPlatform || 'unknown',
              title: segment.videoTitle || '',
              thumbnail: segment.videoThumbnail || '',
              timestamp: segment.videoTimestamp || 0,
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
          onVideoEmbed: (video) => {
            addVideoEmbedSegment(video);
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
              stopReason: response?.stopReason || response?.finishReason,
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
      } else if (isBothMode) {
        // ── BOTH MODE: Run two models in parallel ──
        const claudeModel = settings.selectedModelVersions.bothClaude;
        const gptModel = settings.selectedModelVersions.bothGPT;

        // First message is already created (Claude) — send Claude stream
        const claudePromise = api.sendMessageStream(messages, ModelProvider.ANTHROPIC, streamCallbacks);

        // Create second assistant message for GPT
        const gptMessageId = addMessage(conversationId, {
          role: MessageRole.ASSISTANT,
          content: [{ type: 'text', text: '' }],
          isStreaming: true,
          modelLabel: getModelLabel(gptModel),
        } as any);

        // Build separate segment tracking for GPT message
        const gptSegments: typeof segments extends (infer T)[] ? T[] : never = [];
        let gptTextSegment: any = null;

        const buildGptContentBlocks = (): ContentBlock[] => {
          const blocks: ContentBlock[] = [];
          for (const s of gptSegments) {
            if (s.type === 'text' && s.text) blocks.push({ type: 'text', text: s.text });
            else if (s.type === 'image' && s.imageUrl) blocks.push({ type: 'image', url: s.imageUrl, alt: s.imageAlt || 'Generated image', caption: s.imageCaption } as any);
            else if (s.type === 'video_embed' && s.videoUrl) blocks.push({ type: 'video_embed', url: s.videoUrl, embed_url: s.videoEmbedUrl, platform: s.videoPlatform || 'unknown', title: s.videoTitle, thumbnail: s.videoThumbnail, timestamp: s.videoTimestamp } as any);
          }
          if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
          return blocks;
        };

        const gptCallbacks: typeof streamCallbacks = {
          onStart: () => {},
          onThinking: () => {},
          onChunk: (chunk: string) => {
            if (!gptTextSegment || gptTextSegment.type !== 'text') {
              gptTextSegment = { type: 'text', text: '' };
              gptSegments.push(gptTextSegment);
            }
            gptTextSegment.text += chunk;
            chatStore.updateMessage(gptMessageId, { content: buildGptContentBlocks() });
          },
          onToolStart: () => {},
          onImageGenerated: (url: string, prompt: string, revisedPrompt?: string) => {
            gptSegments.push({ type: 'image', imageUrl: url, imageAlt: prompt, imageCaption: revisedPrompt || prompt });
            gptTextSegment = null;
            chatStore.updateMessage(gptMessageId, { content: buildGptContentBlocks() });
          },
          onFileGenerated: () => {},
          onVideoEmbed: (video) => {
            gptSegments.push({ type: 'video_embed', videoUrl: video.url, videoEmbedUrl: video.embed_url, videoPlatform: video.platform, videoTitle: video.title, videoThumbnail: video.thumbnail, videoTimestamp: video.timestamp });
            gptTextSegment = null;
            chatStore.updateMessage(gptMessageId, { content: buildGptContentBlocks() });
          },
          onComplete: (response: any) => {
            chatStore.updateMessage(gptMessageId, {
              content: buildGptContentBlocks(),
              isStreaming: false,
              tokens: response?.usage ? {
                prompt: response.usage.inputTokens || response.usage.promptTokens || 0,
                completion: response.usage.outputTokens || response.usage.completionTokens || 0,
                total: response.usage.totalTokens || 0,
              } : undefined,
              cost: response?.cost,
              stopReason: response?.stopReason || response?.finishReason,
            });
          },
          onError: (error: Error) => {
            chatStore.updateMessage(gptMessageId, {
              content: [{ type: 'text', text: `GPT Error: ${error.message}` }],
              isStreaming: false,
            });
          },
        };

        const gptPromise = api.sendMessageStream(messages, ModelProvider.OPENAI, gptCallbacks);

        // Wait for both to complete
        await Promise.allSettled([claudePromise, gptPromise]);
      } else if (isHybridMode) {
        // ── HYBRID MODE: Planner → Executor ──
        const plannerModel = settings.selectedModelVersions.hybridPlanner;
        const executorModel = settings.selectedModelVersions.hybridExecutor;
        const plannerProvider = plannerModel.startsWith('gpt') || plannerModel.startsWith('o1') || plannerModel.startsWith('o3') || plannerModel.startsWith('o4')
          ? ModelProvider.OPENAI : ModelProvider.ANTHROPIC;
        const executorProvider = executorModel.startsWith('gpt') || executorModel.startsWith('o1') || executorModel.startsWith('o3') || executorModel.startsWith('o4')
          ? ModelProvider.OPENAI : ModelProvider.ANTHROPIC;

        // Phase 1: Planner — first message already created
        let plannerOutput = '';
        const plannerCallbacks: typeof streamCallbacks = {
          ...streamCallbacks,
          onChunk: (chunk: string) => {
            plannerOutput += chunk;
            streamCallbacks.onChunk?.(chunk);
          },
          onComplete: (response: any) => {
            // Mark planner message as done, then start executor
            streamCallbacks.onComplete?.(response);
          },
        };

        await api.sendMessageStream(messages, plannerProvider, plannerCallbacks);

        // Phase 2: Executor — create new message
        const executorMessageId = addMessage(conversationId, {
          role: MessageRole.ASSISTANT,
          content: [{ type: 'text', text: '' }],
          isStreaming: true,
          modelLabel: getModelLabel(executorModel),
          hybridPhase: 'executor',
        } as any);

        chatStore.startStreaming(executorMessageId);
        statusStore.setCurrentMessageId(executorMessageId);

        const executorSegments: any[] = [];
        let executorTextSegment: any = null;

        const buildExecutorBlocks = (): ContentBlock[] => {
          const blocks: ContentBlock[] = [];
          for (const s of executorSegments) {
            if (s.type === 'text' && s.text) blocks.push({ type: 'text', text: s.text });
            else if (s.type === 'image' && s.imageUrl) blocks.push({ type: 'image', url: s.imageUrl, alt: s.imageAlt || 'Generated image', caption: s.imageCaption } as any);
            else if (s.type === 'video_embed' && s.videoUrl) blocks.push({ type: 'video_embed', url: s.videoUrl, embed_url: s.videoEmbedUrl, platform: s.videoPlatform || 'unknown', title: s.videoTitle, thumbnail: s.videoThumbnail, timestamp: s.videoTimestamp } as any);
          }
          if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
          return blocks;
        };

        const executorCallbacks: typeof streamCallbacks = {
          onStart: () => {
            statusStore.setPhase('responding', 'Executing planned response...');
          },
          onThinking: (thinking: string) => {
            if (thinkingEnabledForThisMessage) {
              const seg = { type: 'thinking', thinkingContent: thinking };
              executorSegments.push(seg);
              const blocks = executorSegments
                .filter((s: any) => s.type === 'text' && s.text)
                .map((s: any) => ({ type: 'text' as const, text: s.text }));
              if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
              chatStore.updateMessage(executorMessageId, { content: blocks });
            }
          },
          onChunk: (chunk: string) => {
            if (!executorTextSegment || executorTextSegment.type !== 'text') {
              executorTextSegment = { type: 'text', text: '' };
              executorSegments.push(executorTextSegment);
            }
            executorTextSegment.text += chunk;
            chatStore.updateMessage(executorMessageId, { content: buildExecutorBlocks() });
          },
          onToolStart: () => {},
          onImageGenerated: (url: string, prompt: string, revisedPrompt?: string) => {
            executorSegments.push({ type: 'image', imageUrl: url, imageAlt: prompt, imageCaption: revisedPrompt || prompt });
            executorTextSegment = null;
            chatStore.updateMessage(executorMessageId, { content: buildExecutorBlocks() });
          },
          onFileGenerated: () => {},
          onVideoEmbed: (video) => {
            executorSegments.push({ type: 'video_embed', videoUrl: video.url, videoEmbedUrl: video.embed_url, videoPlatform: video.platform, videoTitle: video.title, videoThumbnail: video.thumbnail, videoTimestamp: video.timestamp });
            executorTextSegment = null;
            chatStore.updateMessage(executorMessageId, { content: buildExecutorBlocks() });
          },
          onComplete: (response: any) => {
            chatStore.updateMessage(executorMessageId, {
              content: buildExecutorBlocks(),
              isStreaming: false,
              tokens: response?.usage ? {
                prompt: response.usage.inputTokens || response.usage.promptTokens || 0,
                completion: response.usage.outputTokens || response.usage.completionTokens || 0,
                total: response.usage.totalTokens || 0,
              } : undefined,
              cost: response?.cost,
              stopReason: response?.stopReason || response?.finishReason,
            });
            chatStore.completeStreaming();
            statusStore.completeProcessing();
            clearTimeout(safetyTimeout);
          },
          onError: (error: Error) => {
            chatStore.updateMessage(executorMessageId, {
              content: [{ type: 'text', text: `Executor Error: ${error.message}` }],
              isStreaming: false,
            });
            chatStore.completeStreaming();
            statusStore.completeProcessing();
            clearTimeout(safetyTimeout);
          },
        };

        // Send to executor with the planner's output appended as context
        const executorMessages = [
          ...messages,
          {
            id: `planner_${Date.now()}`,
            role: MessageRole.ASSISTANT,
            content: [{ type: 'text' as const, text: plannerOutput }],
            timestamp: Date.now(),
            conversationId,
          },
          {
            id: `planner_directive_${Date.now()}`,
            role: MessageRole.USER,
            content: [{ type: 'text' as const, text: 'Now execute the plan above. Provide the final, polished response to the user.' }],
            timestamp: Date.now(),
            conversationId,
          },
        ];

        await api.sendMessageStream(executorMessages, executorProvider, executorCallbacks);
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
  
  // Expose send function via ref for voice conversation mode
  useEffect(() => {
    if (sendRef) sendRef.current = handleSend;
    return () => { if (sendRef) sendRef.current = null; };
  }, [sendRef, handleSend]);

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
  
  const handleDropFiles = async (files: File[]) => {
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

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounter.current = 0;
    await handleDropFiles(Array.from(e.dataTransfer.files));
  };

  // Full-screen drag-and-drop with counter-based flicker fix
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (dragCounter.current === 1) setIsDragging(true);
    };
    const handleDragLeave = () => {
      dragCounter.current--;
      if (dragCounter.current === 0) setIsDragging(false);
    };
    const handleDragOver = (e: DragEvent) => { e.preventDefault(); };
    const handleWindowDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (e.dataTransfer?.files.length) {
        await handleDropFiles(Array.from(e.dataTransfer.files));
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);
  
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
    // Abort the in-flight fetch/SSE stream
    try {
      getAPIService().cancel();
    } catch (_) { /* service may not be initialized */ }

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
  };

  // ========================================================================
  // RENDER
  // ========================================================================
  
  const canSend = (inputValue.trim() || attachedFiles.length > 0) && !isSendingMessage;
  
  return (
    <div className="bg-transparent">
      {/* Full-Screen Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background-primary/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-brand-primary bg-background-secondary p-12">
            <ArrowUpTrayIcon className="h-16 w-16 text-brand-primary" />
            <p className="text-lg font-semibold text-text-primary">Drop files here</p>
            <p className="text-sm text-text-tertiary">
              {getModeConfig(useModeStore.getState().currentMode).features.useServerSideToolLoop
                ? 'Files will be uploaded to your workspace'
                : 'Files will be attached to your message'}
            </p>
          </div>
        </div>
      )}

      {/* Island Container */}
      <div className="max-w-3xl mx-auto w-full px-4 pb-4 pt-2">
        {/* Proactive Suggestion Panel */}
        <ProactiveSuggestionPanel />

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
          <div className="flex items-center justify-between px-4 py-2 mb-2 rounded-xl bg-brand-primary/10 border border-brand-primary/20">
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
              className="overflow-hidden mb-2"
            >
              <div className="flex flex-wrap gap-2">
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

        {/* Input Box */}
        <div
          className="relative rounded-2xl border transition-colors border-border-primary bg-background-secondary shadow-lg shadow-black/10"
        >

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
          <div className="flex items-center justify-between border-t border-border-primary/50 px-4 py-2">
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

              {/* Voice Input — MediaRecorder + Whisper (with Web Speech preview) */}
              <button
                onClick={isListening ? stopListening : startListening}
                disabled={isTranscribing}
                className={`rounded p-1.5 transition-colors ${
                  isTranscribing
                    ? 'text-amber-400 bg-amber-400/10 cursor-wait'
                    : isListening
                      ? 'text-red-400 bg-red-400/10 hover:bg-red-400/20 animate-pulse'
                      : 'text-text-tertiary hover:bg-background-hover hover:text-text-primary'
                }`}
                title={isTranscribing ? 'Transcribing...' : isListening ? 'Stop listening' : 'Voice input'}
              >
                <MicrophoneIcon className="h-5 w-5" />
              </button>

              {/* Voice Conversation Mode */}
              {onOpenVoiceConversation && (
                <button
                  onClick={onOpenVoiceConversation}
                  className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-primary"
                  title="Voice conversation mode"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="12" cy="12" r="4.5" fill="currentColor" />
                  </svg>
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
      </div>
    </div>
  );
}

