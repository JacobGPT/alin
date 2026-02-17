/**
 * Input Compressor — Chunks and summarizes long user input before extraction.
 *
 * Uses regex-based signal extraction (no AI). Chunking is semantic —
 * splits on paragraph boundaries, not mid-sentence.
 *
 * Pure logic — no side-effects.
 */

import type { CompressedInput } from './types';

const DEFAULT_MAX_CHUNK_SIZE = 15_000;

/**
 * Compress long input text into manageable chunks.
 * Splits on paragraph boundaries to preserve semantic coherence.
 */
export function compressInput(
  sourceText: string,
  maxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE,
): CompressedInput {
  const trimmed = sourceText.trim();
  if (trimmed.length <= maxChunkSize) {
    return {
      chunks: [trimmed],
      totalChars: trimmed.length,
      chunkCount: 1,
    };
  }

  const chunks: string[] = [];
  // Split on double newlines (paragraphs) first
  const paragraphs = trimmed.split(/\n\s*\n/);
  let currentChunk = '';

  for (const para of paragraphs) {
    if (currentChunk.length + para.length + 2 > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    // If a single paragraph exceeds max, split by sentences
    if (para.length > maxChunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length + 1 > maxChunkSize && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return {
    chunks,
    totalChars: trimmed.length,
    chunkCount: chunks.length,
  };
}

/**
 * Extract key signals from text using regex patterns (no AI).
 * Used for cross-chunk dedup and to highlight important data.
 */
export function extractKeySignals(text: string): {
  productNames: string[];
  urls: string[];
  prices: string[];
  stats: string[];
  emails: string[];
} {
  // Product names: capitalized multi-word sequences or camelCase
  const nameMatches = text.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/g) || [];
  const camelCaseMatches = text.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]+\b/g) || [];
  const productNames = [...new Set([...nameMatches, ...camelCaseMatches])].slice(0, 10);

  // URLs
  const urlMatches = text.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi) || [];
  const urls = [...new Set(urlMatches)].slice(0, 10);

  // Prices
  const priceMatches = text.match(/\$\d[\d,.]*(?:\/(?:mo|month|yr|year|user|seat))?/gi) || [];
  const prices = [...new Set(priceMatches)].slice(0, 10);

  // Stats / numbers with context
  const statMatches = text.match(/\b\d[\d,]*\+?\s*(?:users?|customers?|clients?|countries|teams?|companies|projects?|downloads?|stars?|reviews?)/gi) || [];
  const percentMatches = text.match(/\b\d+(?:\.\d+)?%\s*\w+/gi) || [];
  const stats = [...new Set([...statMatches, ...percentMatches])].slice(0, 10);

  // Emails
  const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  const emails = [...new Set(emailMatches)].slice(0, 5);

  return { productNames, urls, prices, stats, emails };
}
