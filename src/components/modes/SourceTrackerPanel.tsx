/**
 * SourceTrackerPanel - Research sources/citations for Research Mode
 */

import { useState } from 'react';
import {
  LinkIcon,
  ClipboardDocumentIcon,
  TrashIcon,
  GlobeAltIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

interface Source {
  id: string;
  url: string;
  title: string;
  snippet?: string;
  timestamp: number;
  cited: boolean;
}

export function SourceTrackerPanel() {
  const [sources, setSources] = useState<Source[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const removeSource = (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
  };

  const copyUrl = (source: Source) => {
    navigator.clipboard.writeText(source.url);
    setCopiedId(source.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const citedSources = sources.filter((s) => s.cited);
  const uncitedSources = sources.filter((s) => !s.cited);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 border-b border-border-primary">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          Source Tracker
        </h3>
        {sources.length > 0 && (
          <p className="text-xs text-text-quaternary mt-0.5">
            {sources.length} source{sources.length !== 1 ? 's' : ''} found
          </p>
        )}
      </div>

      {sources.length > 0 ? (
        <div className="py-1">
          {/* Cited sources */}
          {citedSources.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-text-tertiary mb-2">
                Cited ({citedSources.length})
              </p>
              {citedSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  copiedId={copiedId}
                  onCopy={copyUrl}
                  onRemove={removeSource}
                />
              ))}
            </div>
          )}

          {/* Uncited sources */}
          {uncitedSources.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-text-tertiary mb-2">
                References ({uncitedSources.length})
              </p>
              {uncitedSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  copiedId={copiedId}
                  onCopy={copyUrl}
                  onRemove={removeSource}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center px-3">
          <GlobeAltIcon className="h-10 w-10 text-text-quaternary mb-2" />
          <p className="text-xs text-text-quaternary">
            No sources tracked yet.
          </p>
          <p className="text-xs text-text-quaternary mt-1">
            Sources from web searches will appear here.
          </p>
        </div>
      )}
    </div>
  );
}

function SourceCard({
  source,
  copiedId,
  onCopy,
  onRemove,
}: {
  source: Source;
  copiedId: string | null;
  onCopy: (source: Source) => void;
  onRemove: (id: string) => void;
}) {
  const domain = (() => {
    try {
      return new URL(source.url).hostname.replace('www.', '');
    } catch {
      return source.url;
    }
  })();

  return (
    <div className="mb-2 rounded-lg border border-border-primary bg-background-primary p-2 group">
      <div className="flex items-start gap-2">
        <LinkIcon className="h-3.5 w-3.5 text-text-quaternary flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-brand-primary hover:underline truncate block"
          >
            {source.title}
          </a>
          <p className="text-xs text-text-quaternary truncate">{domain}</p>
          {source.snippet && (
            <p className="text-xs text-text-tertiary mt-1 line-clamp-2">
              {source.snippet}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onCopy(source)}
          className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-text-quaternary hover:text-text-primary bg-background-hover rounded transition-colors"
        >
          {copiedId === source.id ? (
            <CheckIcon className="h-3 w-3 text-green-400" />
          ) : (
            <ClipboardDocumentIcon className="h-3 w-3" />
          )}
          {copiedId === source.id ? 'Copied' : 'Copy URL'}
        </button>
        <button
          onClick={() => onRemove(source.id)}
          className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-text-quaternary hover:text-red-400 bg-background-hover rounded transition-colors"
        >
          <TrashIcon className="h-3 w-3" />
          Remove
        </button>
      </div>
    </div>
  );
}
