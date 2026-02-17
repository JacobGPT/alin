/**
 * Vertex AI Media Generation
 *
 * Replaces AI Studio endpoints for Imagen and Veo with Vertex AI equivalents.
 * Uses the $300 GCP trial credits instead of AI Studio rate limits.
 *
 * Key difference: Veo on Vertex AI is a LONG-RUNNING OPERATION.
 * You submit the request, get an operation ID, then poll until done.
 */

import { getGCPAccessToken, getProjectId, getLocation } from './gcpAuth.js';

const VERTEX_BASE = () =>
  `https://${getLocation()}-aiplatform.googleapis.com/v1/projects/${getProjectId()}/locations/${getLocation()}`;

// ═══════════════════════════════════════════════════════════════
// IMAGEN — Image Generation via Vertex AI
// ═══════════════════════════════════════════════════════════════

/**
 * Generate an image using Imagen on Vertex AI.
 *
 * @param {Object} params
 * @param {string} params.prompt - Image description
 * @param {string} params.model - 'imagen-4.0-generate-001' | 'imagen-4.0-fast-generate-001' | 'imagen-4.0-ultra-generate-001'
 * @param {number} params.width - Image width (default 1024)
 * @param {number} params.height - Image height (default 1024)
 * @param {number} params.count - Number of images (1-4, default 1)
 * @returns {Promise<{images: Array<{base64: string, mimeType: string}>}>}
 */
export async function generateImageVertex(params) {
  const {
    prompt,
    model = 'imagen-4.0-generate-001',
    width = 1024,
    height = 1024,
    count = 1,
  } = params;

  const token = await getGCPAccessToken();

  const resp = await fetch(
    `${VERTEX_BASE()}/publishers/google/models/${model}:predict`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          sampleCount: count,
          aspectRatio: getAspectRatio(width, height),
          outputOptions: { mimeType: 'image/png' },
          // Safety settings — Vertex AI requires these
          safetySetting: 'block_medium_and_above',
          personGeneration: 'allow_adult',
        },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vertex Imagen ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const images = (data.predictions || []).map(pred => ({
    base64: pred.bytesBase64Encoded,
    mimeType: pred.mimeType || 'image/png',
  }));

  return { images, model, provider: 'vertex-imagen' };
}


// ═══════════════════════════════════════════════════════════════
// VEO — Video Generation via Vertex AI (Long-Running Operation)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a video using Veo on Vertex AI.
 * This is a LONG-RUNNING OPERATION — submit, then poll.
 *
 * @param {Object} params
 * @param {string} params.prompt - Video description
 * @param {string} params.model - 'veo-3.0-generate-preview' | 'veo-3.1-generate-preview' | 'veo-3.1-fast-generate-preview'
 * @param {string} params.aspectRatio - '16:9' | '9:16' (default '16:9')
 * @param {number} params.durationSeconds - 5-8 for Veo 2, 5-8 for Veo 3 (default 8)
 * @param {number} params.count - Number of videos (1-4, default 1)
 * @returns {Promise<{operationName: string}>} — Use pollVeoOperation() to get result
 */
export async function generateVideoVertex(params) {
  const {
    prompt,
    model = 'veo-3.1-generate-preview',
    aspectRatio = '16:9',
    durationSeconds = 8,
    count = 1,
  } = params;

  const token = await getGCPAccessToken();

  const resp = await fetch(
    `${VERTEX_BASE()}/publishers/google/models/${model}:predictLongRunning`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: {
          aspectRatio,
          durationSeconds,
          sampleCount: count,
        },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vertex Veo ${resp.status}: ${err}`);
  }

  const data = await resp.json();

  // Returns a long-running operation with an operation name
  return {
    operationName: data.name, // e.g. "projects/.../locations/.../operations/12345"
    model,
    provider: 'vertex-veo',
  };
}

/**
 * Poll a Veo long-running operation until complete.
 *
 * Vertex AI predictLongRunning operations must be polled via fetchPredictOperation
 * POST endpoint, NOT a direct GET to the operation URL.
 *
 * operationName format: "projects/.../locations/.../publishers/google/models/{model}/operations/{id}"
 * Poll endpoint:        "projects/.../locations/.../publishers/google/models/{model}:fetchPredictOperation"
 *
 * @param {string} operationName - The operation name from generateVideoVertex()
 * @param {number} maxWaitMs - Maximum wait time (default 5 minutes)
 * @param {number} pollIntervalMs - How often to check (default 5 seconds)
 * @returns {Promise<{videos: Array<{base64: string, mimeType: string}>}>}
 */
export async function pollVeoOperation(operationName, maxWaitMs = 300000, pollIntervalMs = 5000) {
  const startTime = Date.now();

  // Extract model resource path: everything before "/operations/..."
  const opsIndex = operationName.indexOf('/operations/');
  if (opsIndex === -1) {
    throw new Error(`Invalid operation name format: ${operationName}`);
  }
  const modelResource = operationName.slice(0, opsIndex);

  while (Date.now() - startTime < maxWaitMs) {
    // Re-fetch token each iteration in case of long polls
    const token = await getGCPAccessToken();

    const resp = await fetch(
      `https://${getLocation()}-aiplatform.googleapis.com/v1/${modelResource}:fetchPredictOperation`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operationName }),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Veo poll ${resp.status}: ${err}`);
    }

    const data = await resp.json();

    if (data.done) {
      // Log the full response structure so we can parse it correctly
      console.log('[Veo Poll] Done. Full response JSON:', JSON.stringify(data).slice(0, 2000));

      if (data.error) {
        throw new Error(`Veo generation failed: ${JSON.stringify(data.error)}`);
      }

      // Return the raw response so the caller can handle all formats
      return { rawResponse: data.response, operationName };
    }

    // Not done yet — wait and try again
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Veo generation timed out after ${maxWaitMs / 1000}s`);
}


// ═══════════════════════════════════════════════════════════════
// GEMINI on Vertex AI — for when AI Studio rate limits are hit
// ═══════════════════════════════════════════════════════════════

/**
 * Call Gemini via Vertex AI (non-streaming, for TBWO phases).
 * Use this as a fallback when AI Studio rate limits are exceeded.
 *
 * @param {Object} params
 * @param {string} params.model - Gemini model ID
 * @param {string} params.system - System prompt
 * @param {string} params.prompt - User prompt
 * @param {number} params.maxTokens - Max output tokens (default 4096)
 * @param {number} params.temperature - Temperature (default 0.4)
 * @returns {Promise<string>} - Text response
 */
export async function callGeminiVertex({ model, system, prompt, maxTokens = 4096, temperature = 0.4 }) {
  const token = await getGCPAccessToken();

  const resp = await fetch(
    `${VERTEX_BASE()}/publishers/google/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vertex Gemini ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
}

/**
 * Call Gemini via Vertex AI WITH Google Search grounding.
 */
export async function callGeminiVertexWithSearch(prompt, system) {
  const token = await getGCPAccessToken();

  const resp = await fetch(
    `${VERTEX_BASE()}/publishers/google/models/gemini-2.5-pro:generateContent`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        tools: [{ googleSearchRetrieval: {} }],
      }),
    }
  );

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vertex Gemini Search ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
}


// ═══════════════════════════════════════════════════════════════
// HELPER: Aspect ratio from dimensions
// ═══════════════════════════════════════════════════════════════

function getAspectRatio(width, height) {
  const ratio = width / height;
  if (ratio > 1.7) return '16:9';
  if (ratio > 1.3) return '3:2';
  if (ratio > 0.9) return '1:1';
  if (ratio > 0.7) return '2:3';
  return '9:16';
}
