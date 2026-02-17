/**
 * VoiceConversation — Floating voice-to-voice overlay
 *
 * State machine: idle → listening → transcribing → sending → speaking
 * Uses MediaRecorder + Whisper STT, silence detection via AnalyserNode,
 * and /api/voice/tts for text-to-speech playback.
 *
 * Uses instance counter pattern to survive React StrictMode double-mount.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '@store/chatStore';
import { useAuthStore } from '@store/authStore';
import { useSettingsStore } from '@store/settingsStore';

type VoiceState = 'idle' | 'listening' | 'transcribing' | 'sending' | 'speaking' | 'error';

const STATE_LABELS: Record<VoiceState, string> = {
  idle: 'Tap to start',
  listening: 'Listening...',
  transcribing: 'Transcribing...',
  sending: 'Thinking...',
  speaking: 'Speaking...',
  error: 'Error — tap to retry',
};

interface VoiceConversationProps {
  onClose: () => void;
  onSend: () => void;
}

export function VoiceConversation({ onClose, onSend }: VoiceConversationProps) {
  const [state, setState] = useState<VoiceState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  // Refs for media resources
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const recordingStartRef = useRef<number>(0);
  const failCountRef = useRef(0);
  const stateRef = useRef<VoiceState>('idle');

  // Instance counter — survives React StrictMode double-mount
  // Each startListeningImpl call increments this. Stale async continuations
  // detect they're outdated by comparing their captured value.
  const instanceRef = useRef(0);

  // Loop control — set to false when user closes voice mode
  const loopActiveRef = useRef(true);

  // Browser SpeechRecognition refs
  const recognitionRef = useRef<any>(null);
  const recognizedTextRef = useRef('');
  const hasInterimResultRef = useRef(false); // true while user is mid-word/sentence

  // Callback refs
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const setInputValue = useChatStore((s) => s.setInputValue);

  const updateState = useCallback((newState: VoiceState) => {
    stateRef.current = newState;
    setState(newState);
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // CLEANUP
  // ──────────────────────────────────────────────────────────────────────────

  const stopAll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    analyserRef.current = null;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    recognizedTextRef.current = '';
    hasInterimResultRef.current = false;
    setAudioLevel(0);
  }, []);

  const handleClose = useCallback(() => {
    loopActiveRef.current = false;
    instanceRef.current++; // Invalidate any pending async work
    stopAll();
    onClose();
  }, [onClose, stopAll]);

  // ──────────────────────────────────────────────────────────────────────────
  // STREAM & SPEAK — sentence-level TTS during AI streaming
  // ──────────────────────────────────────────────────────────────────────────

  const streamAndSpeak = useCallback(async (msgCountBefore: number, myInstance: number) => {
    const isStale = () => myInstance !== instanceRef.current;

    // Wait for streaming to start
    for (let i = 0; i < 75; i++) {
      if (isStale()) return;
      const store = useChatStore.getState();
      const conv = store.getCurrentConversation();
      if (store.streamState.isStreaming || (conv?.messages?.length || 0) > msgCountBefore + 1) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (isStale()) return;
    updateState('speaking');

    const getMessageText = (): string => {
      const conv = useChatStore.getState().getCurrentConversation();
      if (!conv?.messages) return '';
      const last = [...conv.messages].reverse().find(m => m.role === 'assistant');
      if (!last) return '';
      return last.content.filter(b => b.type === 'text').map(b => (b as any).text).join(' ');
    };

    const fetchTTS = (sentence: string): Promise<Blob | null> => {
      const voice = useSettingsStore.getState().voice.voice;
      const token = useAuthStore.getState().token;
      return fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: sentence, voice }),
      }).then(r => r.ok ? r.blob() : null).catch(() => null);
    };

    // Ordered queue of TTS promises — fired concurrently, played sequentially
    const queue: Promise<Blob | null>[] = [];
    let lastPos = 0;
    let detectionDone = false;

    // Sentence detection loop — polls message content for sentence boundaries
    const detect = async () => {
      let lastQueueTime = Date.now();
      while (true) {
        if (isStale()) return;
        const text = getMessageText();
        const remaining = text.slice(lastPos);

        // Match sentence-ending punctuation followed by space or end
        const m = remaining.match(/^([\s\S]*?[.!?])(?:\s|$)/);
        if (m && m[1].trim().length > 2) {
          console.log('[VoiceConv] TTS sentence:', m[1].trim().slice(0, 60));
          queue.push(fetchTTS(m[1].trim()));
          lastPos += m[0].length;
          lastQueueTime = Date.now();
          continue; // Check for more sentences immediately
        }

        // Fallback: if we have 20+ chars but no sentence boundary for 2s, queue what we have
        // This prevents long waits when AI generates text without punctuation
        if (remaining.trim().length > 20 && queue.length === 0 && Date.now() - lastQueueTime > 2000) {
          console.log('[VoiceConv] TTS fallback (no sentence boundary):', remaining.trim().slice(0, 60));
          queue.push(fetchTTS(remaining.trim()));
          lastPos += remaining.length;
          lastQueueTime = Date.now();
          continue;
        }

        if (!useChatStore.getState().streamState.isStreaming) {
          const final = getMessageText().slice(lastPos).trim();
          if (final.length > 0) {
            console.log('[VoiceConv] TTS remainder:', final.slice(0, 60));
            queue.push(fetchTTS(final));
          }
          detectionDone = true;
          return;
        }
        await new Promise(r => setTimeout(r, 120));
      }
    };

    // Sequential playback loop — plays audio in order as TTS responses arrive
    const play = async () => {
      let i = 0;
      while (true) {
        if (isStale()) return;
        if (i < queue.length) {
          const blob = await queue[i];
          i++;
          if (blob && !isStale()) {
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioElementRef.current = audio;
            await new Promise<void>(resolve => {
              audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
              audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
              audio.play().catch(() => resolve());
            });
          }
        } else if (detectionDone) {
          return;
        } else {
          await new Promise(r => setTimeout(r, 50));
        }
      }
    };

    await Promise.all([detect(), play()]);
  }, [updateState]);

  // ──────────────────────────────────────────────────────────────────────────
  // FINISH RECORDING & TRANSCRIBE
  // ──────────────────────────────────────────────────────────────────────────

  const finishRecordingRef = useRef<() => Promise<void>>();

  const finishRecording = useCallback(async () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    setAudioLevel(0);
    const myInstance = instanceRef.current;
    const isStale = () => myInstance !== instanceRef.current;

    console.log('[VoiceConv] finishRecording');

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }

    // Stop mic
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    mediaRecorderRef.current = null;
    analyserRef.current = null;

    // Stop SpeechRecognition
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    const recognizedText = recognizedTextRef.current.trim();
    recognizedTextRef.current = '';

    if (isStale()) return;

    // ── Fast path: browser SpeechRecognition gave us text ──
    if (recognizedText.length > 1) {
      console.log('[VoiceConv] SpeechRecognition text:', recognizedText.slice(0, 80));
      failCountRef.current = 0;
      updateState('sending');

      const conv = useChatStore.getState().getCurrentConversation();
      const msgCountBefore = conv?.messages?.length || 0;

      setInputValue(recognizedText);
      await new Promise(r => setTimeout(r, 100));
      if (isStale()) return;

      onSendRef.current();
      await streamAndSpeak(msgCountBefore, myInstance);
      if (isStale()) return;

      if (loopActiveRef.current) {
        startListeningImpl();
      } else {
        updateState('idle');
      }
      return;
    }

    // ── Slow path: fall back to Whisper STT ──
    updateState('transcribing');

    const recordingDuration = Date.now() - recordingStartRef.current;
    if (recordingDuration < 500 || audioChunksRef.current.length === 0) {
      console.log('[VoiceConv] Recording too short (' + recordingDuration + 'ms), restarting');
      audioChunksRef.current = [];
      if (loopActiveRef.current && !isStale()) {
        await new Promise((r) => setTimeout(r, 300));
        if (!isStale()) startListeningImpl();
      } else {
        updateState('idle');
      }
      return;
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    console.log('[VoiceConv] Whisper fallback:', audioBlob.size, 'bytes,', recordingDuration, 'ms');

    try {
      const token = useAuthStore.getState().token;
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const res = await fetch('/api/voice/transcribe', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (isStale()) return;

      if (!res.ok) {
        console.error('[VoiceConv] Transcription failed:', res.status);
        failCountRef.current++;
        if (failCountRef.current >= 3) {
          updateState('error');
          setErrorMsg(`Transcription failed (${res.status})`);
          return;
        }
        if (loopActiveRef.current && !isStale()) {
          await new Promise((r) => setTimeout(r, 500));
          if (!isStale()) startListeningImpl();
        }
        return;
      }

      const data = await res.json();
      console.log('[VoiceConv] Transcribed:', data.text?.slice(0, 80));

      if (!data.text?.trim()) {
        console.log('[VoiceConv] Empty transcription, restarting');
        if (loopActiveRef.current && !isStale()) startListeningImpl();
        return;
      }

      failCountRef.current = 0;
      updateState('sending');

      const conv = useChatStore.getState().getCurrentConversation();
      const msgCountBefore = conv?.messages?.length || 0;

      setInputValue(data.text);
      await new Promise((r) => setTimeout(r, 150));
      if (isStale()) return;

      console.log('[VoiceConv] Sending message...');
      onSendRef.current();

      await streamAndSpeak(msgCountBefore, myInstance);
      if (isStale()) return;

      if (loopActiveRef.current) {
        startListeningImpl();
      } else {
        updateState('idle');
      }
    } catch (err) {
      console.error('[VoiceConv] Error:', err);
      failCountRef.current++;
      if (failCountRef.current >= 3) {
        updateState('error');
        setErrorMsg('Voice processing failed');
        return;
      }
      if (loopActiveRef.current && !isStale()) {
        await new Promise((r) => setTimeout(r, 500));
        if (!isStale()) startListeningImpl();
      } else {
        updateState('idle');
      }
    }
  }, [setInputValue, streamAndSpeak, updateState]);

  finishRecordingRef.current = finishRecording;

  // ──────────────────────────────────────────────────────────────────────────
  // START LISTENING
  // ──────────────────────────────────────────────────────────────────────────

  const startListeningImpl = useCallback(async () => {
    // Increment instance — any previous async work becomes stale
    const myInstance = ++instanceRef.current;
    loopActiveRef.current = true;

    console.log('[VoiceConv] startListening (instance:', myInstance, ')');
    updateState('listening');
    setErrorMsg('');
    setAudioLevel(0);

    // Stale check helper — returns true if a newer instance has started
    const isStale = () => myInstance !== instanceRef.current;

    try {
      // Check permission
      try {
        const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        console.log('[VoiceConv] Mic permission:', perm.state);
        if (perm.state === 'denied') {
          updateState('error');
          setErrorMsg('Microphone blocked — click the lock icon in address bar');
          return;
        }
      } catch {}

      if (isStale()) { console.log('[VoiceConv] Stale after permission check'); return; }

      console.log('[VoiceConv] Requesting mic...');
      const micPromise = navigator.mediaDevices.getUserMedia({ audio: true });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Mic timed out — check browser permissions')), 10000)
      );
      const stream = await Promise.race([micPromise, timeoutPromise]);

      // CRITICAL: Check if we're still the active instance after await
      if (isStale()) {
        console.log('[VoiceConv] Stale after getUserMedia — discarding stream');
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      console.log('[VoiceConv] Mic:', track?.label, 'enabled:', track?.enabled, 'muted:', track?.muted, 'state:', track?.readyState);

      // AudioContext + AnalyserNode
      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        console.log('[VoiceConv] Resuming AudioContext...');
        await audioCtx.resume();
      }

      if (isStale()) {
        console.log('[VoiceConv] Stale after AudioContext resume');
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
        return;
      }

      console.log('[VoiceConv] AudioContext:', audioCtx.state, audioCtx.sampleRate + 'Hz');
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);

      // Chrome requires audio graph to reach destination to process data
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      analyser.connect(silentGain);
      silentGain.connect(audioCtx.destination);
      analyserRef.current = analyser;
      console.log('[VoiceConv] Audio graph connected (source→analyser→gain(0)→dest)');

      // MediaRecorder
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      console.log('[VoiceConv] Recording started');

      // Browser SpeechRecognition — instant transcription (no upload needed)
      const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        const recognition = new SpeechRecognitionAPI();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        let finalTranscript = '';

        recognition.onresult = (event: any) => {
          let interim = '';
          let hasInterim = false;
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript + ' ';
            } else {
              interim = event.results[i][0].transcript;
              hasInterim = true;
            }
          }
          hasInterimResultRef.current = hasInterim;
          recognizedTextRef.current = (finalTranscript + interim).trim();
        };

        recognition.onerror = () => {};
        recognition.onend = () => {
          // Auto-restart if still listening (browser may stop after silence)
          if (stateRef.current === 'listening' && myInstance === instanceRef.current) {
            try { recognition.start(); } catch {}
          }
        };

        recognitionRef.current = recognition;
        try { recognition.start(); console.log('[VoiceConv] SpeechRecognition started'); } catch {}
      }

      // Silence detection with auto-calibration
      const bufLen = analyser.fftSize;
      const dataArr = new Uint8Array(bufLen);
      let silenceStart: number | null = null;
      let hasDetectedSpeech = false;
      let frameCount = 0;

      const calibSamples: number[] = [];
      let speechThreshold = 0;
      let calibrated = false;
      const CALIB_FRAMES = 60;
      const SILENCE_MS = 2500;
      const MIN_REC_MS = 800;

      const getRMS = (): number => {
        analyser.getByteTimeDomainData(dataArr);
        let sum = 0;
        for (let i = 0; i < bufLen; i++) {
          const n = (dataArr[i]! - 128) / 128;
          sum += n * n;
        }
        return Math.sqrt(sum / bufLen);
      };

      const checkSilence = () => {
        // Use instance check instead of loopActiveRef for the rAF loop
        if (myInstance !== instanceRef.current || stateRef.current !== 'listening') return;

        const rms = getRMS();
        const rmsLevel = rms * 200;
        setAudioLevel(Math.min(1, rms * 8));

        frameCount++;

        // Calibration phase
        if (!calibrated) {
          calibSamples.push(rmsLevel);
          if (frameCount === 1) {
            console.log(`[VoiceConv] Calibrating... rms=${rmsLevel.toFixed(2)}`);
          }
          if (calibSamples.length >= CALIB_FRAMES) {
            const avg = calibSamples.reduce((a, b) => a + b, 0) / calibSamples.length;
            const max = Math.max(...calibSamples);
            speechThreshold = Math.max(0.5, max * 2.5);
            calibrated = true;
            console.log(`[VoiceConv] Calibrated: avg=${avg.toFixed(2)} max=${max.toFixed(2)} threshold=${speechThreshold.toFixed(2)}`);
          }
          rafRef.current = requestAnimationFrame(checkSilence);
          return;
        }

        // Log every ~1s
        if (frameCount % 60 === 0) {
          console.log(`[VoiceConv] rms=${rmsLevel.toFixed(2)} thr=${speechThreshold.toFixed(2)} speech=${hasDetectedSpeech} silence=${silenceStart ? Date.now() - silenceStart : 0}ms`);
        }

        if (rmsLevel >= speechThreshold) {
          hasDetectedSpeech = true;
          silenceStart = null;
        }

        const elapsed = Date.now() - recordingStartRef.current;

        if (rmsLevel < speechThreshold) {
          if (!silenceStart) silenceStart = Date.now();
          const silenceDuration = Date.now() - silenceStart;
          // Don't cut off if SpeechRecognition has active interim results (user mid-sentence)
          const userStillSpeaking = hasInterimResultRef.current && silenceDuration < SILENCE_MS * 2;
          if (
            hasDetectedSpeech &&
            elapsed > MIN_REC_MS &&
            silenceDuration > SILENCE_MS &&
            !userStillSpeaking &&
            audioChunksRef.current.length > 0
          ) {
            console.log(`[VoiceConv] Silence detected after ${elapsed}ms (silence: ${silenceDuration}ms)`);
            finishRecordingRef.current?.();
            return;
          }
        }

        rafRef.current = requestAnimationFrame(checkSilence);
      };

      rafRef.current = requestAnimationFrame(checkSilence);
      console.log('[VoiceConv] Silence detection started');
    } catch (err: any) {
      if (isStale()) return; // Don't show error for stale instances
      const msg = err?.message || String(err);
      console.error('[VoiceConv] Error:', msg);
      updateState('error');
      if (msg.includes('timed out')) {
        setErrorMsg('Mic timed out — allow mic access in browser');
      } else if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setErrorMsg('Mic blocked — click lock icon in address bar');
      } else if (msg.includes('NotFound')) {
        setErrorMsg('No microphone found');
      } else {
        setErrorMsg(`Mic error: ${msg.slice(0, 50)}`);
      }
    }
  }, [updateState]);

  // ──────────────────────────────────────────────────────────────────────────
  // ORB TAP (retry from error/idle)
  // ──────────────────────────────────────────────────────────────────────────

  const handleOrbTap = useCallback(() => {
    if (state === 'idle' || state === 'error') {
      failCountRef.current = 0;
      startListeningImpl();
    }
  }, [state, startListeningImpl]);

  // ──────────────────────────────────────────────────────────────────────────
  // MOUNT / UNMOUNT — single consolidated effect
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!token) {
      updateState('error');
      setErrorMsg('Please log in to use voice mode');
      return;
    }

    // Start voice — startListeningImpl handles its own instance tracking
    startListeningImpl();

    return () => {
      // Invalidate all pending async work from this mount
      instanceRef.current++;
      loopActiveRef.current = false;
      stopAll();
    };
  }, [startListeningImpl, updateState, stopAll]);

  // ──────────────────────────────────────────────────────────────────────────
  // ORB VISUAL STYLES
  // ──────────────────────────────────────────────────────────────────────────

  const getOrbStyles = () => {
    const colors: Record<VoiceState, { bg: string; shadow: string }> = {
      idle:         { bg: '#6b7280', shadow: 'rgba(107,114,128,0.3)' },
      listening:    { bg: '#3b82f6', shadow: 'rgba(59,130,246,0.4)'  },
      transcribing: { bg: '#f59e0b', shadow: 'rgba(245,158,11,0.4)'  },
      sending:      { bg: '#6366f1', shadow: 'rgba(99,102,241,0.4)'  },
      speaking:     { bg: '#22c55e', shadow: 'rgba(34,197,94,0.4)'   },
      error:        { bg: '#ef4444', shadow: 'rgba(239,68,68,0.4)'   },
    };
    const c = colors[state];

    if (state === 'listening') {
      const scale = 1 + audioLevel * 0.35;
      const glow = 8 + audioLevel * 32;
      const opacity = 0.3 + audioLevel * 0.5;
      return {
        background: audioLevel > 0.15 ? `radial-gradient(circle, #60a5fa, ${c.bg})` : c.bg,
        transform: `scale(${scale})`,
        boxShadow: `0 0 ${glow}px rgba(59,130,246,${opacity}), 0 0 ${glow * 2}px rgba(59,130,246,${opacity * 0.5})`,
        transition: 'transform 0.08s ease-out, box-shadow 0.08s ease-out, background 0.15s ease-out',
      };
    }

    return {
      background: c.bg,
      transform: 'scale(1)',
      boxShadow: `0 0 12px ${c.shadow}`,
      transition: 'all 0.3s ease',
    };
  };

  return (
    <div className="fixed bottom-24 right-6 z-40 w-52 rounded-2xl bg-background-secondary/90 backdrop-blur-xl border border-border-primary shadow-2xl shadow-black/20 p-4 flex flex-col items-center gap-3">
      <button
        onClick={handleClose}
        className="absolute top-2 right-2 rounded-full p-1 text-text-tertiary hover:text-text-primary hover:bg-background-hover transition-colors"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>

      <div
        className="relative flex items-center justify-center w-20 h-20 cursor-pointer"
        onClick={handleOrbTap}
      >
        {(state === 'listening' || state === 'speaking') && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: state === 'listening' ? 'rgba(59,130,246,0.3)' : 'rgba(34,197,94,0.3)',
              opacity: state === 'listening' ? 0.15 + audioLevel * 0.4 : 0.2,
              transform: `scale(${state === 'listening' ? 1 + audioLevel * 0.5 : 1})`,
              transition: state === 'listening' ? 'transform 0.1s ease-out, opacity 0.1s ease-out' : undefined,
              animation: state === 'speaking' ? 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite' : undefined,
            }}
          />
        )}

        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={getOrbStyles()}
        >
          {state === 'listening' && (
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 4.93c-3.94-.49-7-3.85-7-7.93h2c0 3.31 2.69 6 6 6s6-2.69 6-6h2c0 4.08-3.06 7.44-7 7.93V20h4v2H8v-2h4v-1.07z" />
            </svg>
          )}
          {state === 'transcribing' && (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {state === 'sending' && (
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {state === 'speaking' && (
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          )}
          {state === 'error' && (
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
          {state === 'idle' && (
            <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            </svg>
          )}
        </div>
      </div>

      {state === 'listening' && (
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${Math.max(2, audioLevel * 100)}%`,
              background: audioLevel > 0.5
                ? 'linear-gradient(90deg, #3b82f6, #60a5fa, #93c5fd)'
                : audioLevel > 0.15
                  ? 'linear-gradient(90deg, #3b82f6, #60a5fa)'
                  : '#3b82f6',
            }}
          />
        </div>
      )}

      <span className="text-xs font-medium text-text-secondary">{STATE_LABELS[state]}</span>
      {errorMsg && <span className="text-[10px] text-red-400 text-center">{errorMsg}</span>}
      <span className="text-[10px] text-text-quaternary">Voice Conversation</span>
    </div>
  );
}
