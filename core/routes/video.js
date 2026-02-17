/**
 * Video Generation endpoints — Vertex AI Veo
 * /api/video/generate, /api/video/status/*
 */
import { generateVideoVertex } from '../services/vertexMedia.js';
import { getGCPAccessToken } from '../services/gcpAuth.js';

export function registerVideoRoutes(ctx) {
  const { app, requireAuth, sendError } = ctx;

  app.post('/api/video/generate', requireAuth, async (req, res) => {
    try {
      const { prompt, model, aspectRatio, durationSeconds } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt required' });

      const result = await generateVideoVertex({ prompt, model, aspectRatio, durationSeconds });
      res.json(result);
    } catch (error) {
      console.error('[Video Gen] Error:', error.message);
      sendError(res, 500, error.message);
    }
  });

  app.get('/api/video/status/*', requireAuth, async (req, res) => {
    try {
      const operationName = req.params[0];
      if (!operationName) return res.status(400).json({ error: 'operationName required' });

      const token = await getGCPAccessToken();
      const location = process.env.GCP_LOCATION || 'us-central1';

      const opsIndex = operationName.indexOf('/operations/');
      if (opsIndex === -1) return res.status(400).json({ error: 'Invalid operation name format' });
      const modelResource = operationName.slice(0, opsIndex);

      const resp = await fetch(
        `https://${location}-aiplatform.googleapis.com/v1/${modelResource}:fetchPredictOperation`,
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
        throw new Error(`Poll ${resp.status}: ${err}`);
      }

      const data = await resp.json();

      if (data.done) {
        if (data.error) {
          return res.json({ done: true, error: data.error });
        }
        const videos = (data.response?.videos || []).map(v => ({
          gcsUri: v.gcsUri,
          mimeType: v.mimeType || 'video/mp4',
        }));
        return res.json({ done: true, videos });
      }

      res.json({ done: false, progress: data.metadata?.partialResult ? 'generating' : 'queued' });
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}
