/**
 * Video Analysis endpoints — Gemini File API + Streaming Analysis
 * POST /api/video/upload    — upload video to Gemini File API, poll until ACTIVE
 * POST /api/video/analyze   — stream video analysis via Gemini 2.5 Pro (SSE)
 * DELETE /api/video/file/:name — manually delete a Gemini file
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import multer from 'multer';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com';
const SUPPORTED_VIDEO_MIMES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  'video/x-matroska', 'video/mpeg', 'video/ogg', 'video/3gpp',
]);
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB (Gemini limit)
const WARN_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1GB warning threshold
const PROCESSING_TIMEOUT_MS = 2 * 60 * 1000;   // 2 minutes
const POLL_INTERVAL_MS = 3000;                  // 3 seconds

// ============================================================================
// GEMINI FILE API HELPERS (raw fetch — matches codebase pattern)
// ============================================================================

async function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  return key;
}

/**
 * Upload a file to Gemini File API using resumable upload protocol.
 * Returns the file metadata including name, uri, state, mimeType.
 */
async function uploadToGemini(filePath, mimeType, displayName) {
  const apiKey = await getApiKey();
  const fileBuffer = await fs.readFile(filePath);
  const fileSize = fileBuffer.length;

  // Step 1: Initiate resumable upload
  const initResp = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(fileSize),
      'X-Goog-Upload-Header-Content-Type': mimeType,
    },
    body: JSON.stringify({ file: { displayName } }),
  });

  if (!initResp.ok) {
    const errText = await initResp.text();
    throw new Error(`Gemini upload init failed (${initResp.status}): ${errText.slice(0, 300)}`);
  }

  const uploadUrl = initResp.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Gemini did not return an upload URL');

  // Step 2: Upload the file bytes
  const uploadResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileSize),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: fileBuffer,
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`Gemini upload failed (${uploadResp.status}): ${errText.slice(0, 300)}`);
  }

  const result = await uploadResp.json();
  console.log(`[Video Upload] Uploaded to Gemini: ${result.file?.name} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
  return result.file;
}

/**
 * Poll Gemini File API until file state is ACTIVE or timeout.
 */
async function pollUntilActive(fileName) {
  const apiKey = await getApiKey();
  const startTime = Date.now();

  while (Date.now() - startTime < PROCESSING_TIMEOUT_MS) {
    const resp = await fetch(`${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`);
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini file status check failed (${resp.status}): ${errText.slice(0, 300)}`);
    }

    const file = await resp.json();

    if (file.state === 'ACTIVE') {
      console.log(`[Video Upload] File ${fileName} is ACTIVE`);
      return file;
    }

    if (file.state === 'FAILED') {
      throw new Error(`Gemini file processing failed: ${file.error?.message || 'unknown error'}`);
    }

    // Still PROCESSING — wait and poll again
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Gemini file processing timed out after ${PROCESSING_TIMEOUT_MS / 1000}s`);
}

/**
 * Delete a file from Gemini File API.
 */
async function deleteGeminiFile(fileName) {
  try {
    const apiKey = await getApiKey();
    const resp = await fetch(`${GEMINI_API_BASE}/v1beta/${fileName}?key=${apiKey}`, {
      method: 'DELETE',
    });
    if (resp.ok) {
      console.log(`[Video Cleanup] Deleted Gemini file: ${fileName}`);
    } else {
      console.warn(`[Video Cleanup] Failed to delete ${fileName}: ${resp.status}`);
    }
  } catch (err) {
    console.warn(`[Video Cleanup] Error deleting ${fileName}:`, err.message);
  }
}

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

export function registerVideoAnalysisRoutes(ctx) {
  const { app, requireAuth, setupSSE, sendSSE, sendError, rootDir } = ctx;

  const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: MAX_FILE_SIZE },
  });

  // --------------------------------------------------------------------------
  // POST /api/video/upload — Upload video to Gemini File API
  // --------------------------------------------------------------------------
  app.post('/api/video/upload', requireAuth, upload.single('file'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const mimeType = req.file.mimetype || 'video/mp4';
      if (!SUPPORTED_VIDEO_MIMES.has(mimeType)) {
        return res.status(400).json({
          error: `Unsupported video format: ${mimeType}. Supported: mp4, mov, webm, avi, mkv, mpeg, ogg, 3gpp`,
        });
      }

      if (req.file.size > MAX_FILE_SIZE) {
        return res.status(413).json({ error: `File too large. Maximum size is 2GB.` });
      }

      const sizeWarning = req.file.size > WARN_FILE_SIZE
        ? 'File is over 1GB — upload and processing may take a while.'
        : null;

      console.log(`[Video Upload] Uploading ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB, ${mimeType})`);

      // Upload to Gemini
      const geminiFile = await uploadToGemini(tmpPath, mimeType, req.file.originalname);

      // Poll until ACTIVE
      const activeFile = await pollUntilActive(geminiFile.name);

      res.json({
        success: true,
        fileUri: activeFile.uri,
        fileName: activeFile.name,
        displayName: activeFile.displayName,
        mimeType: activeFile.mimeType,
        sizeBytes: activeFile.sizeBytes,
        state: activeFile.state,
        sizeWarning,
      });
    } catch (error) {
      console.error('[Video Upload] Error:', error.message);
      if (error.message.includes('timed out')) {
        return sendError(res, 408, error.message);
      }
      sendError(res, 500, error.message);
    } finally {
      // Clean up local temp file
      if (tmpPath) {
        fs.unlink(tmpPath).catch(() => {});
      }
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/video/analyze — Analyze video with Gemini 2.5 Pro (SSE)
  // --------------------------------------------------------------------------
  app.post('/api/video/analyze', requireAuth, async (req, res) => {
    let { fileUri, mimeType, prompt, conversationHistory, geminiFileName } = req.body;

    if (!fileUri) return res.status(400).json({ error: 'fileUri is required' });
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    setupSSE(res);

    try {
      // If fileUri is a local ALIN asset, upload to Gemini first
      if (fileUri.startsWith('/api/assets/') || fileUri.startsWith('http://127.0.0.1') || fileUri.startsWith('http://localhost')) {
        let localAssetPath = null;

        // Extract the asset path segment (e.g., "/api/assets/video_xxx.mp4")
        let assetSegment = fileUri;
        if (fileUri.startsWith('http')) {
          try { assetSegment = new URL(fileUri).pathname; } catch { /* use as-is */ }
        }

        if (assetSegment.startsWith('/api/assets/')) {
          const assetId = assetSegment.replace('/api/assets/', '');
          const assetsBase = path.join(rootDir, 'data', 'assets');

          // Search all user directories for the asset (mirrors assets.js serving logic)
          const fsSync = await import('node:fs');
          if (fsSync.default.existsSync(assetsBase)) {
            const userDirs = fsSync.default.readdirSync(assetsBase, { withFileTypes: true })
              .filter(d => d.isDirectory()).map(d => d.name);
            for (const dir of userDirs) {
              const tryPath = path.join(assetsBase, dir, assetId);
              if (fsSync.default.existsSync(tryPath)) {
                localAssetPath = tryPath;
                break;
              }
            }
            // Also try direct (non-user-scoped) path
            if (!localAssetPath) {
              const directPath = path.join(assetsBase, assetId);
              if (fsSync.default.existsSync(directPath)) {
                localAssetPath = directPath;
              }
            }
          }
        }

        if (localAssetPath) {
          console.log(`[Video Analyze] Local asset detected, uploading to Gemini: ${localAssetPath}`);
          const geminiFile = await uploadToGemini(localAssetPath, mimeType || 'video/mp4', path.basename(localAssetPath));
          const activeFile = await pollUntilActive(geminiFile.name);
          fileUri = activeFile.uri;
          geminiFileName = activeFile.name;
          console.log(`[Video Analyze] Local asset uploaded to Gemini: ${activeFile.uri}`);
        } else {
          console.warn(`[Video Analyze] Local asset path could not be resolved: ${fileUri}`);
        }
      }
      // Build the request for Gemini with the video file
      const userParts = [
        { fileData: { mimeType: mimeType || 'video/mp4', fileUri } },
        { text: prompt },
      ];

      // Build contents array — include conversation history for follow-ups
      const contents = [];
      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory) {
          if (!msg.role || !msg.text) continue;
          const role = msg.role === 'assistant' ? 'model' : 'user';
          // For the first user message in history, include the video reference
          if (role === 'user' && contents.length === 0) {
            contents.push({
              role: 'user',
              parts: [
                { fileData: { mimeType: mimeType || 'video/mp4', fileUri } },
                { text: msg.text },
              ],
            });
          } else {
            contents.push({ role, parts: [{ text: msg.text }] });
          }
        }
        // Add the current prompt (without video ref since it's in history)
        contents.push({ role: 'user', parts: [{ text: prompt }] });
      } else {
        // No history — first message with video
        contents.push({ role: 'user', parts: userParts });
      }

      const model = 'gemini-2.5-pro';
      const url = `${GEMINI_API_BASE}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

      const body = {
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 16384,
        },
        systemInstruction: {
          parts: [{
            text: 'You are a video analysis expert. Provide detailed, structured analysis of video content. Describe scenes, actions, text, audio elements, technical aspects (resolution, frame rate, editing), and any notable details. Be thorough but organized.',
          }],
        },
      };

      console.log(`[Video Analyze] Model: ${model}, fileUri: ${fileUri.slice(-30)}, prompt: ${prompt.slice(0, 80)}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[Video Analyze] Gemini ${response.status}:`, errText.slice(0, 300));
        sendSSE(res, 'error', { error: `Gemini ${response.status}`, details: errText });
        return res.end();
      }

      // Stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let inputTokens = 0;
      let outputTokens = 0;

      sendSSE(res, 'start', { model, provider: 'gemini' });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          try {
            const ev = JSON.parse(raw);
            const candidate = ev.candidates?.[0];
            if (!candidate) continue;

            const parts = candidate.content?.parts || [];
            for (const part of parts) {
              if (part.text != null && !part.thought) {
                sendSSE(res, 'text_delta', { text: part.text });
              }
              if (part.thought && part.text) {
                sendSSE(res, 'thinking_delta', { thinking: part.text });
              }
            }

            // Track usage
            if (ev.usageMetadata) {
              inputTokens = ev.usageMetadata.promptTokenCount || inputTokens;
              outputTokens = ev.usageMetadata.candidatesTokenCount || outputTokens;
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }

      sendSSE(res, 'done', { model, stopReason: 'end_turn', inputTokens, outputTokens });
      res.end();

      // NOTE: Do NOT auto-delete Gemini files here — the videoContext on the
      // conversation references this fileUri for follow-up questions. Cleanup
      // is handled explicitly via POST /api/video/cleanup or DELETE /api/video/file/:name
      // when the user starts a new conversation or clears video context.
    } catch (error) {
      console.error('[Video Analyze] Error:', error.message);
      try { sendSSE(res, 'error', { error: error.message }); } catch {}
      try { res.end(); } catch {}
    }
  });

  // --------------------------------------------------------------------------
  // DELETE /api/video/file/:name — Manually delete a Gemini file
  // --------------------------------------------------------------------------
  app.delete('/api/video/file/:name', requireAuth, async (req, res) => {
    try {
      const fileName = `files/${req.params.name}`;
      await deleteGeminiFile(fileName);
      res.json({ success: true });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/video/cleanup — Clean up a Gemini file by fileName
  // --------------------------------------------------------------------------
  app.post('/api/video/cleanup', requireAuth, async (req, res) => {
    const { geminiFileName } = req.body;
    if (!geminiFileName) return res.status(400).json({ error: 'geminiFileName required' });
    await deleteGeminiFile(geminiFileName);
    res.json({ success: true });
  });
}
