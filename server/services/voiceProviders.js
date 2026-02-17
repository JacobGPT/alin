/**
 * Tri-Provider Voice System
 *
 * TTS (Text-to-Speech) Providers:
 *   1. ElevenLabs — Best quality, most expressive, many voices (paid per character)
 *   2. Google Cloud TTS — Good quality, many languages, uses GCP credits
 *   3. OpenAI TTS — Good quality, simple API (uses OpenAI credits)
 *
 * STT (Speech-to-Text) Providers:
 *   1. OpenAI Whisper — Best accuracy, supports 97 languages
 *   2. Google Cloud STT — Good accuracy, real-time streaming, uses GCP credits
 *
 * The user selects their preferred provider in the UI.
 * Each response includes which provider was used.
 */

import { getGCPAccessToken } from './gcpAuth.js';

// ═══════════════════════════════════════════════════════════════
// TEXT-TO-SPEECH
// ═══════════════════════════════════════════════════════════════

/**
 * Convert text to speech using any provider.
 *
 * @param {Object} params
 * @param {string} params.text - Text to speak
 * @param {string} params.provider - 'elevenlabs' | 'google' | 'openai'
 * @param {string} params.voiceId - Provider-specific voice ID
 * @param {string} params.model - Provider-specific model (optional)
 * @returns {Promise<{audio: Buffer, mimeType: string, provider: string, voiceId: string}>}
 */
export async function textToSpeech({ text, provider = 'elevenlabs', voiceId, model }) {
  switch (provider) {
    case 'elevenlabs':
      return ttsElevenLabs({ text, voiceId, model });
    case 'google':
      return ttsGoogle({ text, voiceId, model });
    case 'openai':
      return ttsOpenAI({ text, voiceId, model });
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

/**
 * ElevenLabs Text-to-Speech
 */
async function ttsElevenLabs({ text, voiceId = '21m00Tcm4TlvDq8ikWAM', model = 'eleven_flash_v2_5' }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`ElevenLabs TTS ${resp.status}: ${err}`);
  }

  const audioBuffer = Buffer.from(await resp.arrayBuffer());
  return { audio: audioBuffer, mimeType: 'audio/mpeg', provider: 'elevenlabs', voiceId, model };
}

/**
 * Google Cloud Text-to-Speech
 */
async function ttsGoogle({ text, voiceId = 'en-US-Journey-D', model }) {
  const token = await getGCPAccessToken();

  // Parse voiceId format: "languageCode-Name" e.g. "en-US-Journey-D"
  const langMatch = voiceId.match(/^([a-z]{2}-[A-Z]{2})-(.+)$/);
  const languageCode = langMatch ? langMatch[1] : 'en-US';
  const voiceName = voiceId;

  const resp = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
        effectsProfileId: ['large-home-entertainment-class-device'],
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google TTS ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const audioBuffer = Buffer.from(data.audioContent, 'base64');
  return { audio: audioBuffer, mimeType: 'audio/mpeg', provider: 'google', voiceId, model: 'google-tts' };
}

/**
 * OpenAI Text-to-Speech
 */
async function ttsOpenAI({ text, voiceId = 'alloy', model = 'tts-1' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model, // 'tts-1' or 'tts-1-hd'
      input: text,
      voice: voiceId, // alloy, echo, fable, onyx, nova, shimmer
      response_format: 'mp3',
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI TTS ${resp.status}: ${err}`);
  }

  const audioBuffer = Buffer.from(await resp.arrayBuffer());
  return { audio: audioBuffer, mimeType: 'audio/mpeg', provider: 'openai', voiceId, model };
}


// ═══════════════════════════════════════════════════════════════
// SPEECH-TO-TEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Convert speech to text using any provider.
 *
 * @param {Object} params
 * @param {Buffer} params.audio - Audio buffer
 * @param {string} params.mimeType - 'audio/webm', 'audio/mp3', 'audio/wav', etc.
 * @param {string} params.provider - 'whisper' | 'google'
 * @param {string} params.language - Language hint (ISO 639-1, e.g. 'en')
 * @returns {Promise<{text: string, provider: string, language: string}>}
 */
export async function speechToText({ audio, mimeType = 'audio/webm', provider = 'whisper', language }) {
  switch (provider) {
    case 'whisper':
      return sttWhisper({ audio, mimeType, language });
    case 'google':
      return sttGoogle({ audio, mimeType, language });
    default:
      throw new Error(`Unknown STT provider: ${provider}`);
  }
}

/**
 * OpenAI Whisper Speech-to-Text
 */
async function sttWhisper({ audio, mimeType, language }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  // Whisper expects a file upload via FormData
  const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp3') ? 'mp3' : 'wav';
  const formData = new FormData();
  formData.append('file', new Blob([audio], { type: mimeType }), `audio.${ext}`);
  formData.append('model', 'whisper-1');
  if (language) formData.append('language', language);

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Whisper STT ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return { text: data.text, provider: 'whisper', language: language || 'auto' };
}

/**
 * Google Cloud Speech-to-Text
 */
async function sttGoogle({ audio, mimeType, language = 'en-US' }) {
  const token = await getGCPAccessToken();

  // Map mimeType to Google encoding
  const encodingMap = {
    'audio/webm': 'WEBM_OPUS',
    'audio/ogg': 'OGG_OPUS',
    'audio/mp3': 'MP3',
    'audio/mpeg': 'MP3',
    'audio/wav': 'LINEAR16',
    'audio/flac': 'FLAC',
  };

  const resp = await fetch('https://speech.googleapis.com/v1/speech:recognize', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      config: {
        encoding: encodingMap[mimeType] || 'WEBM_OPUS',
        languageCode: language,
        model: 'latest_long',
        enableAutomaticPunctuation: true,
      },
      audio: {
        content: audio.toString('base64'),
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Google STT ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const text = (data.results || [])
    .map(r => r.alternatives?.[0]?.transcript)
    .filter(Boolean)
    .join(' ');

  return { text, provider: 'google', language };
}


// ═══════════════════════════════════════════════════════════════
// VOICE CATALOG — Available voices for the frontend
// ═══════════════════════════════════════════════════════════════

/**
 * Get available voices from all providers.
 * Called by GET /api/voices to populate the voice selector UI.
 */
export async function getAvailableVoices() {
  const voices = [];

  // ElevenLabs voices
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (apiKey) {
      const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': apiKey },
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const v of (data.voices || []).slice(0, 30)) { // Limit to 30
          voices.push({
            id: v.voice_id,
            name: v.name,
            provider: 'elevenlabs',
            category: v.category || 'premade',
            preview: v.preview_url,
            labels: v.labels || {},
          });
        }
      }
    }
  } catch { /* ElevenLabs unavailable, skip */ }

  // Google Cloud TTS voices (hardcoded popular ones — fetching all is slow)
  const googleVoices = [
    { id: 'en-US-Journey-D', name: 'Journey (Male)', language: 'en-US' },
    { id: 'en-US-Journey-F', name: 'Journey (Female)', language: 'en-US' },
    { id: 'en-US-Casual-K', name: 'Casual (Male)', language: 'en-US' },
    { id: 'en-US-Studio-O', name: 'Studio (Male)', language: 'en-US' },
    { id: 'en-US-Studio-Q', name: 'Studio (Female)', language: 'en-US' },
    { id: 'en-US-Neural2-A', name: 'Neural2 A (Male)', language: 'en-US' },
    { id: 'en-US-Neural2-C', name: 'Neural2 C (Female)', language: 'en-US' },
    { id: 'en-GB-Journey-D', name: 'Journey UK (Male)', language: 'en-GB' },
    { id: 'en-GB-Journey-F', name: 'Journey UK (Female)', language: 'en-GB' },
    { id: 'es-US-Journey-D', name: 'Journey Spanish (Male)', language: 'es-US' },
  ];
  for (const v of googleVoices) {
    voices.push({
      id: v.id,
      name: v.name,
      provider: 'google',
      category: 'google-cloud',
      language: v.language,
    });
  }

  // OpenAI TTS voices
  const openaiVoices = [
    { id: 'alloy', name: 'Alloy (Neutral)' },
    { id: 'echo', name: 'Echo (Male)' },
    { id: 'fable', name: 'Fable (British)' },
    { id: 'onyx', name: 'Onyx (Deep Male)' },
    { id: 'nova', name: 'Nova (Female)' },
    { id: 'shimmer', name: 'Shimmer (Warm Female)' },
  ];
  for (const v of openaiVoices) {
    voices.push({
      id: v.id,
      name: v.name,
      provider: 'openai',
      category: 'openai-tts',
    });
  }

  return voices;
}
