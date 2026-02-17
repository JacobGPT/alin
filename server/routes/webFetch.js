/**
 * Web Fetch + Image Search endpoints
 * /api/web/fetch — Fetch URL content as text
 * /api/images/search — Unsplash or picsum fallback
 */

export function registerWebFetchRoutes(ctx) {
  const { app, requireAuth } = ctx;

  /**
   * POST /api/web/fetch
   */
  app.post('/api/web/fetch', requireAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
      }

      console.log(`[Web Fetch] Fetching: ${url.slice(0, 100)}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'ALIN/1.0 (Web Fetch)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return res.status(502).json({ success: false, error: `Upstream returned ${response.status}` });
      }

      let html = await response.text();

      // Strip scripts and styles
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
      // Strip HTML tags, keep text
      let text = html.replace(/<[^>]+>/g, ' ');
      // Collapse whitespace
      text = text.replace(/\s+/g, ' ').trim();
      // Cap at 50K chars
      text = text.slice(0, 50_000);

      res.json({ success: true, content: text, url });
    } catch (error) {
      if (error.name === 'AbortError') {
        return res.status(504).json({ success: false, error: 'Request timed out (15s)' });
      }
      console.error('[Web Fetch] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/images/search — Unsplash or picsum fallback
   */
  app.post('/api/images/search', requireAuth, async (req, res) => {
    try {
      const { query, count = 5, orientation } = req.body;
      if (!query) {
        return res.status(400).json({ success: false, error: 'Query is required' });
      }

      const unsplashKey = process.env.UNSPLASH_ACCESS_KEY;
      let images = [];

      if (unsplashKey) {
        const params = new URLSearchParams({
          query,
          per_page: String(Math.min(count, 30)),
          ...(orientation ? { orientation } : {}),
        });
        const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
          headers: { Authorization: `Client-ID ${unsplashKey}` },
        });
        if (!response.ok) {
          throw new Error(`Unsplash API returned ${response.status}`);
        }
        const data = await response.json();
        images = (data.results || []).map(img => ({
          url: img.urls?.regular || img.urls?.small,
          alt: img.alt_description || img.description || query,
          attribution: `Photo by ${img.user?.name || 'Unknown'} on Unsplash`,
          width: img.width,
          height: img.height,
        }));
      } else {
        console.log(`[Image Search] No UNSPLASH_ACCESS_KEY set, using picsum placeholders for "${query}"`);
        const baseW = orientation === 'portrait' ? 600 : orientation === 'landscape' ? 1200 : 800;
        const baseH = orientation === 'portrait' ? 900 : orientation === 'landscape' ? 800 : 800;
        for (let i = 0; i < Math.min(count, 10); i++) {
          const seed = Math.floor(Math.random() * 1000);
          images.push({
            url: `https://picsum.photos/seed/${seed}/${baseW}/${baseH}`,
            alt: `${query} placeholder image ${i + 1}`,
            attribution: 'Via picsum.photos (placeholder)',
            width: baseW,
            height: baseH,
          });
        }
      }

      res.json({ success: true, images });
    } catch (error) {
      console.error('[Image Search] Error:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}
