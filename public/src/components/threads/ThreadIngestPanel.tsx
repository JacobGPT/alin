/**
 * ThreadIngestPanel — Paste text threads to chunk, summarize, and embed via Vectorize.
 * Shows progress, chunk results, and previously ingested threads.
 */

import { useState, useEffect } from 'react';
import {
  DocumentTextIcon,
  SparklesIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  MagnifyingGlassIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import * as dbService from '../../api/dbService';
import type { ThreadSummary } from '../../api/dbService';

type IngestStatus = 'idle' | 'chunking' | 'summarizing' | 'embedding' | 'done' | 'error';

interface ChunkResult {
  index: number;
  tokenCount: number;
  preview: string;
}

export default function ThreadIngestPanel() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<IngestStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<ChunkResult[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null);

  // Rough token count
  const tokenCount = Math.ceil(text.length / 4);
  const charCount = text.length;

  useEffect(() => {
    loadThreads();
  }, []);

  const loadThreads = async () => {
    try {
      const list = await dbService.listThreads();
      setThreads(list);
    } catch {
      // ignore
    }
  };

  const handleIngest = async () => {
    if (!text.trim()) return;
    setError(null);
    setChunks([]);
    setStatus('chunking');

    try {
      // Simulate progress stages (actual work is server-side)
      setTimeout(() => setStatus('summarizing'), 500);
      setTimeout(() => setStatus('embedding'), 1500);

      const result = await dbService.ingestThread(text.trim());
      setThreadId(result.threadId);
      setChunks(result.chunks);
      setStatus('done');
      setText('');
      loadThreads();
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  };

  const statusLabels: Record<IngestStatus, string> = {
    idle: '',
    chunking: 'Splitting text into chunks...',
    summarizing: 'Generating summaries...',
    embedding: 'Creating embeddings...',
    done: 'Ingestion complete!',
    error: 'Ingestion failed',
  };

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/10">
          <DocumentTextIcon className="h-6 w-6 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Thread Ingestion</h1>
          <p className="text-sm text-text-tertiary">Chunk, embed, and index text for semantic search</p>
        </div>
      </div>

      {/* Input area */}
      <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your thread, document, or conversation here..."
          className="w-full min-h-[200px] resize-y bg-transparent p-4 text-sm text-text-primary placeholder-text-tertiary focus:outline-none"
          disabled={status !== 'idle' && status !== 'done' && status !== 'error'}
        />
        <div className="flex items-center justify-between border-t border-border-primary px-4 py-2">
          <div className="flex items-center gap-3 text-xs text-text-quaternary">
            <span>{charCount.toLocaleString()} chars</span>
            <span>~{tokenCount.toLocaleString()} tokens</span>
          </div>
          <button
            onClick={handleIngest}
            disabled={!text.trim() || (status !== 'idle' && status !== 'done' && status !== 'error')}
            className="flex items-center gap-1.5 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
          >
            {status !== 'idle' && status !== 'done' && status !== 'error' ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <SparklesIcon className="h-4 w-4" />
                Ingest &amp; Chunk
              </>
            )}
          </button>
        </div>
      </div>

      {/* Progress */}
      {status !== 'idle' && (
        <div className={`flex items-center gap-3 rounded-lg border p-3 ${
          status === 'error'
            ? 'border-red-500/30 bg-red-500/5 text-red-400'
            : status === 'done'
            ? 'border-green-500/30 bg-green-500/5 text-green-400'
            : 'border-brand-primary/30 bg-brand-primary/5 text-brand-primary'
        }`}>
          {status !== 'done' && status !== 'error' && (
            <ArrowPathIcon className="h-4 w-4 animate-spin flex-shrink-0" />
          )}
          <span className="text-sm">{statusLabels[status]}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Chunk results */}
      {chunks.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
          <div className="border-b border-border-primary px-4 py-3">
            <h3 className="text-sm font-medium text-text-primary">
              Chunks ({chunks.length})
              {threadId && <span className="ml-2 text-xs text-text-quaternary font-mono">{threadId}</span>}
            </h3>
          </div>
          <div className="divide-y divide-border-primary max-h-[400px] overflow-y-auto">
            {chunks.map((chunk) => (
              <div key={chunk.index} className="px-4 py-3">
                <button
                  onClick={() => setExpandedChunk(expandedChunk === chunk.index ? null : chunk.index)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded bg-bg-tertiary text-[10px] font-bold text-text-tertiary">
                      {chunk.index + 1}
                    </span>
                    <span className="text-xs text-text-secondary truncate max-w-[300px]">{chunk.preview}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-quaternary">{chunk.tokenCount} tokens</span>
                    {expandedChunk === chunk.index ? (
                      <ChevronUpIcon className="h-3 w-3 text-text-tertiary" />
                    ) : (
                      <ChevronDownIcon className="h-3 w-3 text-text-tertiary" />
                    )}
                  </div>
                </button>
                {expandedChunk === chunk.index && (
                  <div className="mt-2 rounded-md bg-bg-primary p-3 text-xs text-text-secondary whitespace-pre-wrap">
                    {chunk.preview}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Previously ingested threads */}
      {threads.length > 0 && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
          <div className="border-b border-border-primary px-4 py-3">
            <h3 className="text-sm font-medium text-text-primary">Ingested Threads ({threads.length})</h3>
          </div>
          <div className="divide-y divide-border-primary">
            {threads.map((t) => (
              <div key={t.thread_id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <DocumentTextIcon className="h-4 w-4 text-text-tertiary" />
                  <div>
                    <p className="text-xs font-mono text-text-secondary">{t.thread_id.slice(0, 12)}...</p>
                    <p className="text-[10px] text-text-quaternary flex items-center gap-1">
                      <ClockIcon className="h-3 w-3" />
                      {new Date(t.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs text-text-tertiary">
                  <p>{t.chunk_count} chunks</p>
                  <p>~{t.total_tokens?.toLocaleString()} tokens</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
