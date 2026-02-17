/**
 * Cloudflare Pages Deploy Adapter
 *
 * Creates/reuses a Cloudflare Pages project and uploads static site files.
 * When CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set, uses real API.
 * Otherwise returns stub responses so the pipeline still works end-to-end.
 *
 * Static-first only. No SSR, no server functions.
 */

import fs from 'fs/promises';
import path from 'path';
import { createReadStream } from 'node:fs';

const CF_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflarePagesDeploy {
  constructor() {
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  }

  /** True when real Cloudflare credentials are configured */
  get isConfigured() {
    return !!(this.apiToken && this.accountId);
  }

  // --------------------------------------------------------------------------
  // Project management
  // --------------------------------------------------------------------------

  /**
   * Create a Cloudflare Pages project (or return existing one).
   * @param {string} projectName — must be lowercase, alphanumeric + hyphens
   * @returns {{ name: string, subdomain: string, stub?: boolean }}
   */
  async ensureProject(projectName) {
    const safeName = projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 58);

    if (!this.isConfigured) {
      return {
        name: safeName,
        subdomain: `${safeName}.pages.dev`,
        stub: true,
      };
    }

    // Try to get existing project first
    try {
      const existing = await this._cfFetch(`/accounts/${this.accountId}/pages/projects/${safeName}`);
      if (existing.success && existing.result) {
        return {
          name: existing.result.name,
          subdomain: `${existing.result.subdomain || safeName}.pages.dev`,
        };
      }
    } catch { /* project doesn't exist yet */ }

    // Create new project
    const resp = await this._cfFetch(`/accounts/${this.accountId}/pages/projects`, {
      method: 'POST',
      body: JSON.stringify({
        name: safeName,
        production_branch: 'main',
      }),
    });

    if (resp.success) {
      return {
        name: resp.result.name,
        subdomain: `${resp.result.subdomain || safeName}.pages.dev`,
      };
    }

    // 8000007 = project already exists (race condition)
    if (resp.errors?.some(e => e.code === 8000007)) {
      const existing = await this._cfFetch(`/accounts/${this.accountId}/pages/projects/${safeName}`);
      return {
        name: existing.result.name,
        subdomain: `${existing.result.subdomain || safeName}.pages.dev`,
      };
    }

    throw new Error(`CF Pages: failed to create project: ${JSON.stringify(resp.errors)}`);
  }

  // --------------------------------------------------------------------------
  // Deploy
  // --------------------------------------------------------------------------

  /**
   * Deploy a static site directory to Cloudflare Pages.
   * @param {string} projectName
   * @param {string} outputDir — absolute path to the built static files
   * @returns {{ id: string, url: string, status: string, stub?: boolean }}
   */
  async deploy(projectName, outputDir) {
    const safeName = projectName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 58);

    if (!this.isConfigured) {
      // Stub: record the intent but don't actually deploy
      return {
        id: `stub-${Date.now()}`,
        url: `https://${safeName}.pages.dev`,
        status: 'success',
        stub: true,
      };
    }

    // Collect all files from outputDir
    const files = await this._collectFiles(outputDir);
    if (files.length === 0) {
      throw new Error('No files found in output directory');
    }

    // Create deployment via Direct Upload
    const formData = await this._buildFormData(files, outputDir);
    const resp = await this._cfFetchRaw(
      `${CF_BASE}/accounts/${this.accountId}/pages/projects/${safeName}/deployments`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiToken}` },
        body: formData,
      }
    );

    const data = await resp.json();
    if (!data.success) {
      throw new Error(`CF Pages deploy failed: ${JSON.stringify(data.errors)}`);
    }

    return {
      id: data.result.id,
      url: data.result.url || `https://${safeName}.pages.dev`,
      status: 'success',
    };
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  async _cfFetch(urlPath, opts = {}) {
    const url = urlPath.startsWith('http') ? urlPath : `${CF_BASE}${urlPath}`;
    const resp = await fetch(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    return resp.json();
  }

  async _cfFetchRaw(url, opts) {
    return fetch(url, opts);
  }

  /** Recursively collect all files relative to root */
  async _collectFiles(dir, root = dir) {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await this._collectFiles(full, root));
      } else {
        const rel = '/' + path.relative(root, full).replace(/\\/g, '/');
        results.push({ relativePath: rel, absolutePath: full });
      }
    }
    return results;
  }

  /** Build FormData for Pages Direct Upload API */
  async _buildFormData(files, _outputDir) {
    // Node 18+ has global FormData
    const formData = new FormData();
    for (const file of files) {
      const content = await fs.readFile(file.absolutePath);
      const blob = new Blob([content]);
      formData.append(file.relativePath, blob, file.relativePath);
    }
    return formData;
  }
}
