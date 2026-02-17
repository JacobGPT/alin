/**
 * Cloudflare Workers KV Adapter
 *
 * REST API client for Workers KV namespace.
 * Manages domain routing (subdomain → site mapping) and active version tracking.
 * When credentials are absent, uses an in-memory Map as stub.
 */

const CF_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareKV {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.namespaceId = process.env.KV_NAMESPACE_ID || '';
    this._stubStore = new Map(); // In-memory fallback
  }

  get isConfigured() {
    return !!(this.accountId && this.apiToken && this.namespaceId);
  }

  // --------------------------------------------------------------------------
  // Generic KV operations
  // --------------------------------------------------------------------------

  async put(key, value, expirationTtl) {
    if (!this.isConfigured) {
      this._stubStore.set(key, value);
      return { stub: true };
    }

    const params = new URLSearchParams();
    if (expirationTtl) params.set('expiration_ttl', String(expirationTtl));

    await this._kvFetch(`/values/${encodeURIComponent(key)}?${params}`, {
      method: 'PUT',
      body: typeof value === 'string' ? value : JSON.stringify(value),
      rawBody: true,
    });
    return { success: true };
  }

  async get(key) {
    if (!this.isConfigured) {
      const val = this._stubStore.get(key);
      return val !== undefined ? val : null;
    }

    try {
      const resp = await this._kvFetchRaw(`/values/${encodeURIComponent(key)}`);
      if (!resp.ok) return null;
      const text = await resp.text();
      try { return JSON.parse(text); } catch { return text; }
    } catch {
      return null;
    }
  }

  async delete(key) {
    if (!this.isConfigured) {
      this._stubStore.delete(key);
      return { stub: true };
    }

    await this._kvFetch(`/values/${encodeURIComponent(key)}`, { method: 'DELETE' });
    return { success: true };
  }

  async list(prefix, limit = 1000, cursor) {
    if (!this.isConfigured) {
      const keys = [];
      for (const [k] of this._stubStore) {
        if (!prefix || k.startsWith(prefix)) keys.push({ name: k });
      }
      return { keys: keys.slice(0, limit), complete: true };
    }

    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (limit) params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);

    const data = await this._kvFetch(`/keys?${params}`);
    return {
      keys: data.result || [],
      cursor: data.result_info?.cursor,
      complete: !data.result_info?.cursor,
    };
  }

  // --------------------------------------------------------------------------
  // Domain routing
  // --------------------------------------------------------------------------

  async registerDomain(subdomain, userId, siteId, version) {
    const key = `domain:${subdomain}.alinai.dev`;
    const value = JSON.stringify({
      siteId,
      userId,
      activeVersion: version,
      subdomain,
      registeredAt: new Date().toISOString(),
    });
    return this.put(key, value);
  }

  async lookupDomain(subdomain) {
    return this.get(`domain:${subdomain}.alinai.dev`);
  }

  async unregisterDomain(subdomain) {
    return this.delete(`domain:${subdomain}.alinai.dev`);
  }

  // --------------------------------------------------------------------------
  // Version tracking
  // --------------------------------------------------------------------------

  async setActiveVersion(siteId, version, deploymentId) {
    const key = `version:${siteId}`;
    const value = JSON.stringify({
      activeVersion: version,
      deploymentId,
      updatedAt: new Date().toISOString(),
    });
    return this.put(key, value);
  }

  async getVersionInfo(siteId) {
    return this.get(`version:${siteId}`);
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  async _kvFetch(urlPath, opts = {}) {
    const basePath = `/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}`;
    const url = `${CF_BASE}${basePath}${urlPath}`;

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

  async _kvFetchRaw(urlPath) {
    const basePath = `/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}`;
    const url = `${CF_BASE}${basePath}${urlPath}`;
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.apiToken}` },
    });
  }
}
