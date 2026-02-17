/**
 * Cloudflare Vectorize Adapter
 *
 * Manages vector embeddings via CF Vectorize indexes.
 * Uses OpenAI text-embedding-3-small (1536 dimensions) for embedding.
 * Provides chunking, embedding, and semantic search for threads and memory.
 * When credentials are absent, returns empty results.
 */

const CF_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareVectorize {
  constructor() {
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN || '';
    this.memoryIndex = process.env.VECTORIZE_INDEX_MEMORY || 'alin-memory';
    this.contentIndex = process.env.VECTORIZE_INDEX_CONTENT || 'alin-content';
    this.openaiKey = process.env.OPENAI_API_KEY || '';
  }

  get isConfigured() {
    return !!(this.accountId && this.apiToken && this.openaiKey);
  }

  // --------------------------------------------------------------------------
  // Vectorize CRUD
  // --------------------------------------------------------------------------

  /**
   * Upsert vectors into a Vectorize index.
   * @param {string} indexName
   * @param {Array<{id: string, values: number[], namespace?: string, metadata?: object}>} vectors
   */
  async upsert(indexName, vectors) {
    if (!this.isConfigured) {
      console.warn('[Vectorize] Not configured — upsert skipped');
      return { count: 0, stub: true };
    }

    // Vectorize expects NDJSON format
    const ndjson = vectors.map(v => JSON.stringify({
      id: v.id,
      values: v.values,
      namespace: v.namespace || 'default',
      metadata: v.metadata || {},
    })).join('\n');

    const url = `${CF_BASE}/accounts/${this.accountId}/vectorize/v2/indexes/${indexName}/upsert`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    });
    const data = await resp.json();

    if (!data.success) {
      const errCode = data.errors?.[0]?.code;
      const errMsg = data.errors?.[0]?.message || 'Unknown error';
      if (errCode === 10000 || errMsg.toLowerCase().includes('authentication')) {
        throw new Error(
          'Vectorize authentication failed. Your Cloudflare API token may not have Vectorize permissions, ' +
          'or the index may not exist. Create it with: wrangler vectorize create ' + indexName + ' --dimensions 1536 --metric cosine'
        );
      }
      throw new Error(`Vectorize upsert failed: ${JSON.stringify(data.errors)}`);
    }

    return { count: vectors.length };
  }

  /**
   * Query a Vectorize index.
   * @param {string} indexName
   * @param {number[]} vector - Query embedding
   * @param {number} topK
   * @param {string} namespace
   * @returns {Array<{id: string, score: number, metadata: object}>}
   */
  async query(indexName, vector, topK = 10, namespace) {
    if (!this.isConfigured) return [];

    const body = {
      vector,
      topK,
      returnMetadata: 'all',
    };
    if (namespace) body.filter = { namespace };

    const url = `${CF_BASE}/accounts/${this.accountId}/vectorize/v2/indexes/${indexName}/query`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    if (!data.success) return [];
    return (data.result?.matches || []).map(m => ({
      id: m.id,
      score: m.score,
      metadata: m.metadata || {},
    }));
  }

  /**
   * Delete vectors by IDs.
   */
  async delete(indexName, ids) {
    if (!this.isConfigured) return { stub: true };

    const url = `${CF_BASE}/accounts/${this.accountId}/vectorize/v2/indexes/${indexName}/delete-by-ids`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ids }),
    });
    return resp.json();
  }

  // --------------------------------------------------------------------------
  // Embedding
  // --------------------------------------------------------------------------

  /**
   * Embed text using OpenAI text-embedding-3-small (1536d).
   * @param {string} text
   * @returns {number[]} 1536-dimensional vector
   */
  async embedText(text) {
    if (!this.openaiKey) throw new Error('OPENAI_API_KEY required for embeddings');

    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000), // Cap input length
      }),
    });

    const data = await resp.json();
    if (data.error) throw new Error(`Embedding failed: ${data.error.message}`);
    return data.data[0].embedding;
  }

  // --------------------------------------------------------------------------
  // Chunking
  // --------------------------------------------------------------------------

  /**
   * Split text into overlapping chunks for embedding.
   * @param {string} text
   * @param {number} chunkSize - Approximate tokens per chunk
   * @param {number} overlap - Overlap tokens between chunks
   * @returns {string[]}
   */
  chunkText(text, chunkSize = 500, overlap = 50) {
    // Split by paragraphs first, then by sentences if too long
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    const chunks = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      // Rough token estimate: ~4 chars per token
      const paraTokens = Math.ceil(para.length / 4);

      if (paraTokens > chunkSize) {
        // Split long paragraphs by sentences
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        const sentences = para.split(/(?<=[.!?])\s+/);
        let sentenceChunk = '';
        for (const sentence of sentences) {
          const sentTokens = Math.ceil(sentence.length / 4);
          if (Math.ceil(sentenceChunk.length / 4) + sentTokens > chunkSize && sentenceChunk) {
            chunks.push(sentenceChunk.trim());
            // Keep overlap
            const words = sentenceChunk.split(/\s+/);
            const overlapWords = Math.ceil(overlap * 4 / 5); // ~5 chars per word
            sentenceChunk = words.slice(-overlapWords).join(' ') + ' ' + sentence;
          } else {
            sentenceChunk += (sentenceChunk ? ' ' : '') + sentence;
          }
        }
        if (sentenceChunk) chunks.push(sentenceChunk.trim());
      } else if (Math.ceil(currentChunk.length / 4) + paraTokens > chunkSize) {
        // Current chunk is full — push it and start new one with overlap
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          const words = currentChunk.split(/\s+/);
          const overlapWords = Math.ceil(overlap * 4 / 5);
          currentChunk = words.slice(-overlapWords).join(' ') + '\n\n' + para;
        } else {
          currentChunk = para;
        }
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
  }

  /**
   * Chunk text and embed each chunk.
   * @returns {Array<{chunk: string, vector: number[], index: number}>}
   */
  async chunkAndEmbed(text, metadata = {}) {
    const chunks = this.chunkText(text);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const vector = await this.embedText(chunks[i]);
      results.push({ chunk: chunks[i], vector, index: i, ...metadata });
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // High-level: Thread ingestion + search
  // --------------------------------------------------------------------------

  /**
   * Ingest a thread: chunk → embed → upsert to CONTENT index.
   */
  async ingestThread(threadId, text, userId) {
    const embedded = await this.chunkAndEmbed(text);

    const vectors = embedded.map((e, i) => ({
      id: `${threadId}-chunk-${i}`,
      values: e.vector,
      namespace: userId,
      metadata: {
        threadId,
        userId,
        chunkIndex: i,
        tokenCount: Math.ceil(e.chunk.length / 4),
        preview: e.chunk.slice(0, 200),
      },
    }));

    await this.upsert(this.contentIndex, vectors);
    return {
      threadId,
      chunkCount: embedded.length,
      chunks: embedded.map((e, i) => ({
        index: i,
        content: e.chunk,
        tokenCount: Math.ceil(e.chunk.length / 4),
      })),
    };
  }

  /**
   * Search the MEMORY index.
   */
  async searchMemory(query, userId, topK = 10) {
    const vector = await this.embedText(query);
    return this.query(this.memoryIndex, vector, topK, userId);
  }

  /**
   * Search the CONTENT index.
   */
  async searchContent(query, userId, topK = 10) {
    const vector = await this.embedText(query);
    return this.query(this.contentIndex, vector, topK, userId);
  }
}
