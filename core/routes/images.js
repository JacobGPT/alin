/**
 * Image Generation endpoints (FLUX.2 / DALL-E / Vertex)
 * /api/images/generate, /api/images/edit, /api/images/health
 */
import { checkBFLHealth } from '../services/bflClient.js';

export function registerImageRoutes(ctx) {
  const { app, requireAuth, sendError, PLAN_LIMITS, getQuotaCount, incrementQuota } = ctx;

  app.post('/api/images/generate', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = req.user.plan || 'free';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

      if (limits.maxCfImages >= 0) {
        const used = getQuotaCount(userId, 'image_generations');
        if (used >= limits.maxCfImages) {
          return res.status(429).json({
            error: 'Monthly image generation limit reached',
            quota: { used, max: limits.maxCfImages, plan },
            code: 'IMAGE_QUOTA_EXCEEDED',
          });
        }
      }

      const { prompt, provider: requestedProvider, width, height, size, quality, style, reference_images, purpose } = req.body;

      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ success: false, error: 'prompt is required' });
      }

      // toolGenerateImage is set on ctx by coding.js
      const toolGenerateImage = ctx.toolGenerateImage;
      if (!toolGenerateImage) return res.status(501).json({ error: 'Image generation not available' });

      const result = await toolGenerateImage({
        prompt: prompt.trim(),
        provider: requestedProvider || 'dall-e-3',
        width: width ? Math.min(Math.max(parseInt(width) || 1024, 256), 2048) : undefined,
        height: height ? Math.min(Math.max(parseInt(height) || 1024, 256), 2048) : undefined,
        size, quality, style,
        reference_images: Array.isArray(reference_images) ? reference_images.slice(0, 10) : [],
        purpose,
      }, userId);

      if (result.success) {
        incrementQuota(userId, 'image_generations');
        const parsed = JSON.parse(result.result);
        res.json({
          success: true,
          url: parsed.url,
          ...parsed,
          quota: { used: getQuotaCount(userId, 'image_generations'), max: limits.maxCfImages },
        });
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error('[Image Gen] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/images/edit', requireAuth, async (req, res) => {
    try {
      const userId = req.user.id;
      const plan = req.user.plan || 'free';
      const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

      if (limits.maxCfImages >= 0) {
        const used = getQuotaCount(userId, 'image_generations');
        if (used >= limits.maxCfImages) {
          return res.status(429).json({
            error: 'Monthly image generation limit reached',
            quota: { used, max: limits.maxCfImages, plan },
          });
        }
      }

      const { prompt, source_image, source_image_base64, source_image_url, provider, reference_images, width, height } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: 'prompt is required' });
      }

      // toolEditImage is set on ctx by coding.js
      const toolEditImage = ctx.toolEditImage;
      if (!toolEditImage) return res.status(501).json({ error: 'Image editing not available' });

      const result = await toolEditImage({
        prompt: prompt.trim(),
        source_image_base64,
        source_image_url: source_image_url || source_image,
        source_image,
        provider: provider || 'nano-banana',
        reference_images: Array.isArray(reference_images) ? reference_images.slice(0, 9) : [],
        width, height,
      }, userId);

      if (result.success) {
        incrementQuota(userId, 'image_generations');
        const parsed = JSON.parse(result.result);
        res.json({
          success: true,
          url: parsed.url,
          ...parsed,
          quota: { used: getQuotaCount(userId, 'image_generations'), max: limits.maxCfImages },
        });
      } else {
        res.status(500).json(result);
      }
    } catch (error) {
      console.error('[Image Edit] Error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/images/health', requireAuth, async (req, res) => {
    const health = await checkBFLHealth();
    res.json(health);
  });
}
