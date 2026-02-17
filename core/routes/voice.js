/**
 * Voice endpoints — TTS + STT (ElevenLabs, Google Cloud, OpenAI)
 * /api/voices, /api/tts, /api/stt, /api/voice/*
 */
import multer from 'multer';
import express from 'express';
import { textToSpeech, speechToText, getAvailableVoices } from '../services/voiceProviders.js';

export function registerVoiceRoutes(ctx) {
  const { app, requireAuth, sendError } = ctx;

  const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

  app.get('/api/voices', requireAuth, async (req, res) => {
    try {
      const voices = await getAvailableVoices();
      res.json({ voices });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // Backward-compat alias
  app.get('/api/voice/voices', requireAuth, async (req, res) => {
    try {
      const voices = await getAvailableVoices();
      res.json({ voices });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  app.post('/api/tts', requireAuth, async (req, res) => {
    try {
      const { text, provider = 'elevenlabs', voiceId, model } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });
      if (text.length > 5000) return res.status(400).json({ error: 'Text too long (max 5000 chars)' });

      const result = await textToSpeech({ text, provider, voiceId, model });

      res.set({
        'Content-Type': result.mimeType,
        'X-Voice-Provider': result.provider,
        'X-Voice-Id': result.voiceId,
        'X-Voice-Model': result.model || 'default',
      });
      res.send(result.audio);

    } catch (error) {
      console.error('[TTS] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  // Backward-compat: POST /api/voice/tts
  app.post('/api/voice/tts', requireAuth, express.json(), async (req, res) => {
    try {
      const { text, voice, provider: reqProvider } = req.body;
      if (!text) return res.status(400).json({ error: 'text required' });

      const elevenLabsVoices = {
        rachel: '21m00Tcm4TlvDq8ikWAM', drew: '29vD33N1CtxCmqQRPOHJ',
        clyde: '2EiwWnXFnvU5JabPnv8n', domi: 'AZnzlk1XvdvUeBnXmlld',
        bella: 'EXAVITQu4vr4xnSDxMaL', antoni: 'ErXwobaYiN019PkySvjV',
        elli: 'MF3mGyEYCl7XYWbV9V6O', josh: 'TxGEqnHWrfWFTfGW9XjX',
        arnold: 'VR6AewLTigWG4xSOukaG', adam: 'pNInz6obpgDQGcFmaJgB',
        sam: 'yoZ06aMxZJJ28mfd3POQ',
        nova: 'EXAVITQu4vr4xnSDxMaL', alloy: '21m00Tcm4TlvDq8ikWAM',
        echo: 'TxGEqnHWrfWFTfGW9XjX', fable: 'ErXwobaYiN019PkySvjV',
        onyx: 'pNInz6obpgDQGcFmaJgB', shimmer: 'MF3mGyEYCl7XYWbV9V6O',
      };
      const voiceId = elevenLabsVoices[voice] || voice || '21m00Tcm4TlvDq8ikWAM';
      const provider = reqProvider || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'openai');

      const result = await textToSpeech({ text: text.slice(0, 4096), provider, voiceId });

      res.set({ 'Content-Type': result.mimeType, 'X-TTS-Provider': result.provider });
      res.send(result.audio);
    } catch (err) {
      console.error('[TTS] Error:', err.message);
      try {
        const fallback = await textToSpeech({ text: req.body.text?.slice(0, 4096), provider: 'openai', voiceId: 'nova' });
        res.set({ 'Content-Type': fallback.mimeType, 'X-TTS-Provider': 'openai-fallback' });
        return res.send(fallback.audio);
      } catch { /* both failed */ }
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/voice/preview', requireAuth, express.json(), async (req, res) => {
    try {
      const { voice, text, provider: reqProvider } = req.body;
      const voiceName = voice || 'nova';
      const sampleText = (text || `Hi, I'm ${voiceName}. This is what I sound like.`).slice(0, 500);
      const provider = reqProvider || (process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'openai');

      const result = await textToSpeech({ text: sampleText, provider, voiceId: voiceName });

      res.set({ 'Content-Type': result.mimeType, 'X-TTS-Provider': result.provider });
      res.send(result.audio);
    } catch (err) {
      console.error('[Voice Preview] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/stt', requireAuth, voiceUpload.single('audio'), async (req, res) => {
    try {
      const audioBuffer = req.file?.buffer;
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      const provider = req.query.provider || req.body.provider || 'whisper';
      const language = req.query.language || req.body.language;
      const mimeType = req.file.mimetype || 'audio/webm';

      const result = await speechToText({
        audio: audioBuffer,
        mimeType,
        provider,
        language,
      });

      res.json(result);
    } catch (error) {
      console.error('[STT] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  // Backward-compat: POST /api/voice/transcribe
  app.post('/api/voice/transcribe', requireAuth, voiceUpload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

      const provider = req.body.provider || 'whisper';
      const language = req.body.language || 'en';

      const result = await speechToText({
        audio: req.file.buffer,
        mimeType: req.file.mimetype || 'audio/webm',
        provider,
        language,
      });

      res.json({ text: result.text, provider: result.provider });
    } catch (err) {
      console.error('[Voice] Transcription error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}
