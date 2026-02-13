/**
 * ALIN Site Server — Cloudflare Worker
 *
 * Serves static sites from R2 with custom subdomain routing via KV.
 *
 * Flow:
 * 1. Extract hostname → derive subdomain (e.g. "my-site" from "my-site.alinai.dev")
 * 2. KV lookup: domain:{subdomain}.alinai.dev → { siteId, activeVersion }
 * 3. R2 key: sites/{siteId}/v{activeVersion}/{pathname}
 * 4. Get object from R2, SPA fallback (no extension → try index.html)
 * 5. Return with Content-Type + Cache-Control
 * 6. 404 for unknown domains
 */

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
};

function getContentType(pathname) {
  const ext = pathname.includes('.') ? '.' + pathname.split('.').pop().toLowerCase() : '';
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Extract subdomain (e.g. "my-site" from "my-site.alinai.dev")
    const parts = hostname.split('.');
    if (parts.length < 3) {
      return new Response('Not found', { status: 404 });
    }
    const subdomain = parts.slice(0, -2).join('.');

    // Look up domain in KV
    const domainKey = `domain:${subdomain}.alinai.dev`;
    const domainData = await env.DOMAIN_KV.get(domainKey, 'json');

    if (!domainData) {
      return new Response(`Site not found: ${subdomain}.alinai.dev`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const { siteId, activeVersion } = domainData;
    let pathname = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');

    // Try to get the object from R2
    const r2Key = `sites/${siteId}/v${activeVersion}/${pathname}`;
    let object = await env.SITES_BUCKET.get(r2Key);

    // SPA fallback: if no extension and object not found, try index.html
    if (!object && !pathname.includes('.')) {
      const fallbackKey = `sites/${siteId}/v${activeVersion}/index.html`;
      object = await env.SITES_BUCKET.get(fallbackKey);
      pathname = 'index.html';
    }

    if (!object) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    const contentType = object.httpMetadata?.contentType || getContentType(pathname);

    return new Response(object.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'X-ALIN-Site': siteId,
        'X-ALIN-Version': String(activeVersion),
      },
    });
  },
};
