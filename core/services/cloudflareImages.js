/**
 * Cloudflare Images Adapter
 *
 * Uploads, manages, and serves images via the CF Images API.
 * Returns delivery URLs with variant support (public, thumbnail, hero).
 * When credentials are absent, returns stub responses.
 */

const CF_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareImages {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.accountHash = process.env.CF_IMAGES_ACCOUNT_HASH || '';
  }

  get isConfigured() {
    return !!(this.accountId && this.apiToken && this.accountHash);
  }

  // --------------------------------------------------------------------------
  // Image operations
  // --------------------------------------------------------------------------

  /**
   * Upload an image buffer to CF Images.
   * @param {Buffer} buffer
   * @param {string} filename
   * @param {object} metadata - Optional key-value metadata
   * @returns {{ id, filename, variants, uploadedAt }}
   */
  async upload(buffer, filename, metadata = {}) {
    if (!this.isConfigured) {
      return {
        id: `stub-${Date.now()}`,
        filename,
        variants: [`https://imagedelivery.net/stub/${filename}/public`],
        uploadedAt: new Date().toISOString(),
        stub: true,
      };
    }

    const formData = new FormData();
    formData.append('file', new Blob([buffer]), filename);
    if (Object.keys(metadata).length > 0) {
      formData.append('metadata', JSON.stringify(metadata));
    }

    const data = await this._cfFetch('/images/v1', {
      method: 'POST',
      body: formData,
      rawBody: true,
    });

    if (!data.success) {
      throw new Error(`CF Images upload failed: ${JSON.stringify(data.errors)}`);
    }

    return {
      id: data.result.id,
      filename: data.result.filename || filename,
      variants: data.result.variants || [],
      uploadedAt: data.result.uploaded || new Date().toISOString(),
    };
  }

  /**
   * Upload an image from a URL.
   */
  async uploadFromUrl(url, metadata = {}) {
    if (!this.isConfigured) {
      return {
        id: `stub-${Date.now()}`,
        filename: url.split('/').pop(),
        variants: [],
        stub: true,
      };
    }

    const formData = new FormData();
    formData.append('url', url);
    if (Object.keys(metadata).length > 0) {
      formData.append('metadata', JSON.stringify(metadata));
    }

    const data = await this._cfFetch('/images/v1', {
      method: 'POST',
      body: formData,
      rawBody: true,
    });

    if (!data.success) {
      throw new Error(`CF Images URL upload failed: ${JSON.stringify(data.errors)}`);
    }

    return {
      id: data.result.id,
      filename: data.result.filename,
      variants: data.result.variants || [],
    };
  }

  /**
   * Delete an image by ID.
   */
  async delete(imageId) {
    if (!this.isConfigured) return { stub: true };

    const data = await this._cfFetch(`/images/v1/${imageId}`, { method: 'DELETE' });
    if (!data.success) {
      throw new Error(`CF Images delete failed: ${JSON.stringify(data.errors)}`);
    }
    return { success: true };
  }

  /**
   * List uploaded images.
   */
  async list(page = 1, perPage = 50) {
    if (!this.isConfigured) return { images: [], total: 0 };

    const data = await this._cfFetch(`/images/v1?page=${page}&per_page=${perPage}`);
    return {
      images: data.result?.images || [],
      total: data.result_info?.total_count || 0,
    };
  }

  // --------------------------------------------------------------------------
  // Delivery URLs
  // --------------------------------------------------------------------------

  /**
   * Get a delivery URL for a specific image and variant.
   * @param {string} imageId
   * @param {string} variant - e.g. 'public', 'thumbnail', 'hero'
   */
  getDeliveryUrl(imageId, variant = 'public') {
    if (!this.accountHash) return null;
    return `https://imagedelivery.net/${this.accountHash}/${imageId}/${variant}`;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  async _cfFetch(urlPath, opts = {}) {
    const url = `${CF_BASE}/accounts/${this.accountId}${urlPath}`;
    const headers = {
      Authorization: `Bearer ${this.apiToken}`,
    };
    if (!opts.rawBody) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOpts = {
      method: opts.method || 'GET',
      headers,
    };
    if (opts.body) fetchOpts.body = opts.body;

    const resp = await fetch(url, fetchOpts);
    return resp.json();
  }
}
