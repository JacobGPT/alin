/**
 * Cloudflare R2 Storage Adapter
 *
 * S3-compatible R2 client via @aws-sdk/client-s3.
 * Manages site deployments (alin-sites bucket) and user asset uploads (alin-uploads bucket).
 * When credentials are absent, returns stub responses.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';

const SITES_BUCKET = 'alin-sites';
const UPLOADS_BUCKET = 'alin-uploads';

export class CloudflareR2 {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
    this.secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
    this._client = null;
  }

  get isConfigured() {
    return !!(this.accountId && this.accessKeyId && this.secretAccessKey);
  }

  // --------------------------------------------------------------------------
  // Site deployment
  // --------------------------------------------------------------------------

  /**
   * Deploy a built site directory to R2.
   * Uploads all files under sites/{siteId}/v{version}/{path}.
   */
  async deploySite(siteId, outputDir, version) {
    if (!this.isConfigured) {
      return { version, fileCount: 0, totalBytes: 0, stub: true };
    }

    const files = await this._collectFiles(outputDir);
    let totalBytes = 0;

    for (const file of files) {
      const buffer = await fs.readFile(file.absolutePath);
      const key = `sites/${siteId}/v${version}/${file.relativePath}`;
      await this._getClient().send(new PutObjectCommand({
        Bucket: SITES_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: this._contentType(file.relativePath),
      }));
      totalBytes += buffer.length;
    }

    // Write manifest
    const manifest = {
      siteId,
      version,
      fileCount: files.length,
      totalBytes,
      deployedAt: new Date().toISOString(),
      files: files.map(f => f.relativePath),
    };
    await this._getClient().send(new PutObjectCommand({
      Bucket: SITES_BUCKET,
      Key: `sites/${siteId}/v${version}/_manifest.json`,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));

    return { version, fileCount: files.length, totalBytes };
  }

  /**
   * List files for a specific site version.
   */
  async listSiteFiles(siteId, version) {
    if (!this.isConfigured) return [];

    const prefix = `sites/${siteId}/v${version}/`;
    const result = await this._getClient().send(new ListObjectsV2Command({
      Bucket: SITES_BUCKET,
      Prefix: prefix,
      MaxKeys: 1000,
    }));

    return (result.Contents || [])
      .filter(obj => !obj.Key.endsWith('_manifest.json'))
      .map(obj => ({
        key: obj.Key,
        path: obj.Key.replace(prefix, ''),
        size: obj.Size,
        lastModified: obj.LastModified?.toISOString(),
      }));
  }

  /**
   * Get a single file from a site version.
   */
  async getSiteFile(siteId, version, filePath) {
    if (!this.isConfigured) return null;

    const key = `sites/${siteId}/v${version}/${filePath}`;
    try {
      const result = await this._getClient().send(new GetObjectCommand({
        Bucket: SITES_BUCKET,
        Key: key,
      }));
      const chunks = [];
      for await (const chunk of result.Body) {
        chunks.push(chunk);
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: result.ContentType || this._contentType(filePath),
      };
    } catch (err) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  /**
   * Delete all files for a specific site version.
   */
  async deleteSiteVersion(siteId, version) {
    if (!this.isConfigured) return;

    const prefix = `sites/${siteId}/v${version}/`;
    const listed = await this._getClient().send(new ListObjectsV2Command({
      Bucket: SITES_BUCKET,
      Prefix: prefix,
      MaxKeys: 1000,
    }));

    const objects = (listed.Contents || []).map(obj => ({ Key: obj.Key }));
    if (objects.length === 0) return;

    await this._getClient().send(new DeleteObjectsCommand({
      Bucket: SITES_BUCKET,
      Delete: { Objects: objects },
    }));
  }

  // --------------------------------------------------------------------------
  // User asset uploads
  // --------------------------------------------------------------------------

  async uploadAsset(userId, filename, buffer, contentType) {
    if (!this.isConfigured) {
      return { stub: true, key: `uploads/${userId}/${filename}` };
    }

    const key = `uploads/${userId}/${filename}`;
    await this._getClient().send(new PutObjectCommand({
      Bucket: UPLOADS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return { key, size: buffer.length };
  }

  async getAsset(userId, filename) {
    if (!this.isConfigured) return null;

    const key = `uploads/${userId}/${filename}`;
    try {
      const result = await this._getClient().send(new GetObjectCommand({
        Bucket: UPLOADS_BUCKET,
        Key: key,
      }));
      const chunks = [];
      for await (const chunk of result.Body) {
        chunks.push(chunk);
      }
      return {
        buffer: Buffer.concat(chunks),
        contentType: result.ContentType,
      };
    } catch {
      return null;
    }
  }

  async listUserAssets(userId, limit = 100) {
    if (!this.isConfigured) return [];

    const result = await this._getClient().send(new ListObjectsV2Command({
      Bucket: UPLOADS_BUCKET,
      Prefix: `uploads/${userId}/`,
      MaxKeys: limit,
    }));

    return (result.Contents || []).map(obj => ({
      key: obj.Key,
      filename: obj.Key.split('/').pop(),
      size: obj.Size,
      lastModified: obj.LastModified?.toISOString(),
    }));
  }

  // --------------------------------------------------------------------------
  // Template library
  // --------------------------------------------------------------------------

  /**
   * Fetch the template manifest (index.json) from R2.
   * Returns parsed JSON with all available templates.
   */
  async getTemplateManifest() {
    if (!this.isConfigured) return { templates: [] };

    try {
      const result = await this._getClient().send(new GetObjectCommand({
        Bucket: SITES_BUCKET,
        Key: 'templates/index.json',
      }));
      const chunks = [];
      for await (const chunk of result.Body) {
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch (err) {
      console.error('[R2] Failed to fetch template manifest:', err.message);
      return { templates: [] };
    }
  }

  /**
   * Fetch all files for a specific template.
   * Returns { template: {metadata}, files: { 'index.html': '...', 'styles/main.css': '...' } }
   */
  async getTemplate(templateId) {
    if (!this.isConfigured) return null;

    // First get manifest to find file list
    const manifest = await this.getTemplateManifest();
    const tmpl = manifest.templates?.find(t => t.id === templateId);
    if (!tmpl) return null;

    const files = {};
    for (const filePath of tmpl.files) {
      const key = `templates/${templateId}/${filePath}`;
      try {
        const result = await this._getClient().send(new GetObjectCommand({
          Bucket: SITES_BUCKET,
          Key: key,
        }));
        const chunks = [];
        for await (const chunk of result.Body) {
          chunks.push(chunk);
        }
        files[filePath] = Buffer.concat(chunks).toString('utf-8');
      } catch (err) {
        console.warn(`[R2] Template file not found: ${key}`);
        files[filePath] = `<!-- Template file not found: ${filePath} -->`;
      }
    }

    return { template: tmpl, files };
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  _getClient() {
    if (!this._client) {
      this._client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
    }
    return this._client;
  }

  async _collectFiles(dir, root = dir) {
    const results = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await this._collectFiles(full, root));
      } else {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        results.push({ relativePath: rel, absolutePath: full });
      }
    }
    return results;
  }

  _contentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.mjs': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
      '.eot': 'application/vnd.ms-fontobject',
      '.webp': 'image/webp',
      '.avif': 'image/avif',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.xml': 'application/xml',
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',
      '.map': 'application/json',
    };
    return map[ext] || 'application/octet-stream';
  }
}
