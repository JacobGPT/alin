/**
 * bflClient.js — FLUX.2 [max] API Client for ALIN
 *
 * Handles text-to-image generation, image editing, and grounded generation
 * via the Black Forest Labs API. All generated images are uploaded to
 * Cloudflare R2 for CDN delivery.
 *
 * API Docs: https://docs.bfl.ml
 * Model: FLUX.2 [max] — highest quality, supports grounded generation
 */

const BFL_BASE_URL = 'https://api.bfl.ai/v1';
const BFL_API_KEY = process.env.BFL_API_KEY;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90;
const GENERATION_TIMEOUT_MS = 180000;

/**
 * Core request helper
 */
async function bflRequest(endpoint, body) {
  if (!BFL_API_KEY) {
    throw new Error('BFL_API_KEY is not configured. Add it to your environment variables.');
  }

  const res = await fetch(`${BFL_BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${BFL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'Unknown error');
    const status = res.status;

    if (status === 402) throw new Error('BFL account has insufficient credits. Please top up at dashboard.bfl.ai');
    if (status === 429) throw new Error('BFL rate limit exceeded. Please wait a moment and try again.');
    if (status === 422) throw new Error(`BFL rejected the request: ${errorBody}`);
    throw new Error(`BFL API error (${status}): ${errorBody}`);
  }

  return res.json();
}

/**
 * Poll for task completion with timeout
 * BFL API is async: submit → get task ID → poll until Ready
 */
async function pollForResult(taskId) {
  const startTime = Date.now();

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (Date.now() - startTime > GENERATION_TIMEOUT_MS) {
      throw new Error(`Image generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s (task: ${taskId})`);
    }

    const res = await fetch(`${BFL_BASE_URL}/get_result?id=${taskId}`, {
      headers: { 'Authorization': `Bearer ${BFL_API_KEY}` },
    });

    if (!res.ok) {
      throw new Error(`BFL polling error (${res.status}): ${await res.text().catch(() => 'Unknown')}`);
    }

    const data = await res.json();

    if (data.status === 'Ready') {
      return data.result;
    }

    if (data.status === 'Error' || data.status === 'Failed') {
      throw new Error(`BFL generation failed: ${data.error || data.message || 'Unknown error'}`);
    }

    // Status is 'Pending' or 'Processing' — wait and retry
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`BFL polling exceeded ${MAX_POLL_ATTEMPTS} attempts (task: ${taskId})`);
}

/**
 * Download image from BFL result URL and upload to R2.
 * @param {string} imageUrl - BFL-provided image URL
 * @param {string} userId - For R2 storage path
 * @param {object} r2Client - CloudflareR2 instance (passed from server.js)
 * @param {object} metadata - Extra metadata for tracking
 * @returns {{ url: string, r2Key: string, width: number, height: number, provider: string, cost_credits: number }}
 */
async function downloadAndStoreImage(imageUrl, userId, r2Client, metadata = {}) {
  // Download the generated image
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Failed to download generated image: ${imageRes.status}`);

  const imageBuffer = Buffer.from(await imageRes.arrayBuffer());
  const contentType = imageRes.headers.get('content-type') || 'image/png';
  const extension = contentType.includes('jpeg') ? 'jpg' : 'png';

  // Generate a unique filename
  const timestamp = Date.now();
  const filename = `flux2_${timestamp}.${extension}`;

  let publicUrl;
  let r2Key;

  if (r2Client && r2Client.isConfigured) {
    // Upload to R2
    const r2Result = await r2Client.uploadAsset(userId, filename, imageBuffer, contentType);
    r2Key = r2Result.key;
    // Serve through our API endpoint
    publicUrl = `/api/assets/${filename}`;
  } else {
    // Fallback: save to local data/assets directory
    const fs = require('fs');
    const path = require('path');
    const assetsDir = path.join(__dirname, '..', 'data', 'assets', userId);
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, filename), imageBuffer);
    r2Key = `local/${userId}/${filename}`;
    publicUrl = `/api/assets/${filename}`;
  }

  return {
    url: publicUrl,
    r2Key: r2Key || `uploads/${userId}/${filename}`,
    width: metadata.width || 1024,
    height: metadata.height || 1024,
    provider: 'flux2-max',
    cost_credits: calculateCost(metadata.width || 1024, metadata.height || 1024, (metadata.reference_images || []).length),
  };
}

/**
 * Calculate approximate cost in cents for logging/tracking
 * Output: $0.07 first MP, $0.03 per additional MP
 * Input refs: $0.03 per MP
 */
function calculateCost(width, height, numReferenceImages = 0) {
  const outputMP = (width * height) / 1_000_000;
  let cost = 7; // First MP = 7 cents
  if (outputMP > 1) cost += Math.ceil(outputMP - 1) * 3;
  cost += numReferenceImages * 3; // ~1MP per ref image assumed
  return cost; // in cents
}

/**
 * Generate an image from a text prompt
 *
 * @param {string} prompt - Detailed image description
 * @param {object} options
 * @param {number} options.width - Image width (default 1024, max 2048)
 * @param {number} options.height - Image height (default 1024, max 2048)
 * @param {string[]} options.reference_images - URLs of reference images (max 10)
 * @param {number} options.seed - Optional seed for reproducibility
 * @param {string} options.output_format - 'png' or 'jpeg' (default 'png')
 * @param {string} userId - For R2 storage path and quota tracking
 * @param {object} r2Client - CloudflareR2 instance
 */
async function generateImage(prompt, options = {}, userId = 'system', r2Client = null) {
  const {
    width = 1024,
    height = 1024,
    reference_images = [],
    seed,
    output_format = 'png',
  } = options;

  // Validate dimensions
  const clampedWidth = Math.min(Math.max(width, 256), 2048);
  const clampedHeight = Math.min(Math.max(height, 256), 2048);

  // Build request body
  const body = {
    prompt,
    width: clampedWidth,
    height: clampedHeight,
    output_format,
  };

  // Add reference images if provided (for character/style consistency)
  if (reference_images.length > 0) {
    body.input_images = reference_images.slice(0, 10);
  }

  if (seed !== undefined) {
    body.seed = seed;
  }

  // Submit generation task
  const task = await bflRequest('flux-2-max', body);

  if (!task.id) {
    throw new Error('BFL did not return a task ID');
  }

  // Poll for completion
  const result = await pollForResult(task.id);

  // Download and store in R2
  const imageUrl = result.sample || result.url || result.image;
  if (!imageUrl) {
    throw new Error('BFL result did not contain an image URL');
  }

  return downloadAndStoreImage(imageUrl, userId, r2Client, {
    width: clampedWidth,
    height: clampedHeight,
    prompt: prompt.substring(0, 500),
    reference_images,
    seed: seed || null,
  });
}

/**
 * Edit an existing image with a text prompt
 *
 * @param {string} prompt - Description of the edit
 * @param {string} sourceImageUrl - URL of image to edit
 * @param {object} options
 * @param {string} userId - For R2 storage and quota
 * @param {object} r2Client - CloudflareR2 instance
 */
async function editImage(prompt, sourceImageUrl, options = {}, userId = 'system', r2Client = null) {
  const {
    reference_images = [],
    width = 1024,
    height = 1024,
    output_format = 'png',
  } = options;

  const body = {
    prompt,
    input_images: [sourceImageUrl, ...reference_images.slice(0, 9)],
    width,
    height,
    output_format,
  };

  const task = await bflRequest('flux-2-max', body);
  if (!task.id) throw new Error('BFL did not return a task ID');

  const result = await pollForResult(task.id);
  const imageUrl = result.sample || result.url || result.image;
  if (!imageUrl) throw new Error('BFL edit result did not contain an image URL');

  return downloadAndStoreImage(imageUrl, userId, r2Client, {
    width,
    height,
    prompt: prompt.substring(0, 500),
    reference_images: [sourceImageUrl, ...reference_images],
    edit: true,
  });
}

/**
 * Health check — verify BFL API key and credits
 */
async function checkBFLHealth() {
  if (!BFL_API_KEY) return { ok: false, error: 'BFL_API_KEY not configured' };
  try {
    const res = await fetch(`${BFL_BASE_URL}/credits`, {
      headers: { 'Authorization': `Bearer ${BFL_API_KEY}` },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, credits: data.credits || data.balance || 'unknown' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { generateImage, editImage, checkBFLHealth, calculateCost };
