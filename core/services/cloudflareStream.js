/**
 * Cloudflare Stream Adapter
 *
 * Manages video uploads, direct upload URLs, and embed codes via the CF Stream API.
 * When credentials are absent, returns stub responses.
 */

const CF_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareStream {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.customerCode = process.env.CF_STREAM_CUSTOMER_CODE || '';
  }

  get isConfigured() {
    return !!(this.accountId && this.apiToken);
  }

  // --------------------------------------------------------------------------
  // Upload
  // --------------------------------------------------------------------------

  /**
   * Get a direct upload URL (TUS protocol).
   * Client can upload directly to this URL.
   */
  async getDirectUploadUrl(maxDurationSeconds = 3600, metadata = {}) {
    if (!this.isConfigured) {
      return {
        uploadUrl: null,
        uid: `stub-${Date.now()}`,
        stub: true,
      };
    }

    const data = await this._cfFetch('/stream/direct_upload', {
      method: 'POST',
      body: JSON.stringify({
        maxDurationSeconds,
        meta: metadata,
      }),
    });

    if (!data.success) {
      throw new Error(`CF Stream direct upload failed: ${JSON.stringify(data.errors)}`);
    }

    return {
      uploadUrl: data.result.uploadURL,
      uid: data.result.uid,
    };
  }

  /**
   * Upload a video from a URL.
   */
  async uploadFromUrl(sourceUrl, metadata = {}) {
    if (!this.isConfigured) {
      return {
        uid: `stub-${Date.now()}`,
        status: 'queued',
        stub: true,
      };
    }

    const data = await this._cfFetch('/stream/copy', {
      method: 'POST',
      body: JSON.stringify({
        url: sourceUrl,
        meta: metadata,
      }),
    });

    if (!data.success) {
      throw new Error(`CF Stream URL upload failed: ${JSON.stringify(data.errors)}`);
    }

    return {
      uid: data.result.uid,
      status: data.result.status?.state || 'queued',
      thumbnail: data.result.thumbnail,
      preview: data.result.preview,
      duration: data.result.duration,
    };
  }

  /**
   * Get video details.
   */
  async getVideo(uid) {
    if (!this.isConfigured) return null;

    const data = await this._cfFetch(`/stream/${uid}`);
    if (!data.success) return null;

    return {
      uid: data.result.uid,
      status: data.result.status?.state || 'unknown',
      thumbnail: data.result.thumbnail,
      preview: data.result.preview,
      duration: data.result.duration,
      size: data.result.size,
      meta: data.result.meta,
      readyToStream: data.result.readyToStream,
      created: data.result.created,
    };
  }

  /**
   * Delete a video.
   */
  async delete(uid) {
    if (!this.isConfigured) return { stub: true };

    const data = await this._cfFetch(`/stream/${uid}`, { method: 'DELETE' });
    return { success: data.success !== false };
  }

  /**
   * List videos.
   */
  async list(limit = 50) {
    if (!this.isConfigured) return [];

    const data = await this._cfFetch(`/stream?limit=${limit}`);
    return (data.result || []).map(v => ({
      uid: v.uid,
      status: v.status?.state || 'unknown',
      thumbnail: v.thumbnail,
      duration: v.duration,
      created: v.created,
    }));
  }

  // --------------------------------------------------------------------------
  // Embed
  // --------------------------------------------------------------------------

  getEmbedUrl(uid) {
    if (!this.customerCode) return null;
    return `https://customer-${this.customerCode}.cloudflarestream.com/${uid}/iframe`;
  }

  getEmbedHtml(uid, width = '100%', height = '100%') {
    const url = this.getEmbedUrl(uid);
    if (!url) return null;
    return `<iframe src="${url}" style="border:none;width:${width};height:${height}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  async _cfFetch(urlPath, opts = {}) {
    const url = `${CF_BASE}/accounts/${this.accountId}${urlPath}`;
    const resp = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      ...(opts.body ? { body: opts.body } : {}),
    });
    return resp.json();
  }
}
