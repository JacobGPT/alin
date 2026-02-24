import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FolderIcon,
  FolderOpenIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';

import type { TBWO, Artifact } from '../../../types/tbwo';
import { inlineAssetsIntoHtml } from '../utils/assetInliner';
import { downloadTBWOZip } from '../../../services/tbwo/zipService';

export function ArtifactsTab({ tbwo }: { tbwo: TBWO }) {
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const artifacts = tbwo.artifacts || [];

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    try {
      await downloadTBWOZip(tbwo, tbwo.receipts);
    } catch (e) {
      console.error('[TBWO] ZIP download failed:', e);
    } finally {
      setIsDownloading(false);
    }
  };

  // Build file tree structure
  const fileTree = useMemo(() => {
    const tree: Record<string, Artifact[]> = {};
    for (const a of artifacts) {
      const path = a.path || a.name || 'unnamed';
      const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.';
      if (!tree[dir]) tree[dir] = [];
      tree[dir].push(a);
    }
    return tree;
  }, [artifacts]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FolderIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Artifacts Yet</h3>
        <p className="text-sm text-text-tertiary">
          Files and outputs will appear here as pods create them
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-340px)]">
      {/* File Tree */}
      <div className="w-72 flex-shrink-0 overflow-y-auto rounded-xl border border-border-primary bg-background-secondary p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-text-primary text-sm">{artifacts.length} files</h3>
          <button
            onClick={handleDownloadZip}
            disabled={isDownloading}
            className="text-xs text-brand-primary hover:underline disabled:opacity-50"
          >
            {isDownloading ? 'Zipping...' : 'Download All'}
          </button>
        </div>
        {Object.entries(fileTree).sort().map(([dir, files]) => (
          <div key={dir} className="mb-2">
            {dir !== '.' && (
              <div className="flex items-center gap-1.5 px-1 py-1 text-xs text-text-tertiary">
                <FolderOpenIcon className="h-3.5 w-3.5" />
                <span className="truncate">{dir}</span>
              </div>
            )}
            {files.map((artifact) => {
              const fileName = (artifact.path || artifact.name || 'unnamed').split('/').pop() || 'unnamed';
              const ext = fileName.split('.').pop()?.toLowerCase() || '';
              const isSelected = selectedArtifact?.id === artifact.id;
              // File type icon colors
              const iconColor = ext === 'html' ? 'text-orange-400'
                : ext === 'css' ? 'text-blue-400'
                : ext === 'js' || ext === 'ts' ? 'text-yellow-400'
                : ext === 'json' ? 'text-green-400'
                : ext === 'md' ? 'text-text-tertiary'
                : ext === 'svg' ? 'text-pink-400'
                : '';
              return (
                <button
                  key={artifact.id}
                  onClick={() => setSelectedArtifact(artifact)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-left transition-colors ${
                    isSelected ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-background-hover'
                  }`}
                >
                  {ext === 'md' ? (
                    <DocumentTextIcon className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? '' : iconColor}`} />
                  ) : (
                    <CodeBracketIcon className={`h-3.5 w-3.5 flex-shrink-0 ${isSelected ? '' : iconColor}`} />
                  )}
                  <span className="truncate">{fileName}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* File Preview */}
      <div className="flex-1 overflow-hidden rounded-xl border border-border-primary bg-background-secondary">
        {selectedArtifact ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border-primary px-4 py-3">
              <div className="flex items-center gap-2">
                <CodeBracketIcon className="h-4 w-4 text-text-tertiary" />
                <span className="text-sm font-medium text-text-primary">{selectedArtifact.path || selectedArtifact.name}</span>
                <span className="text-xs text-text-quaternary">({selectedArtifact.type})</span>
              </div>
              <button
                onClick={() => {
                  const content = typeof selectedArtifact.content === 'string' ? selectedArtifact.content : JSON.stringify(selectedArtifact.content, null, 2);
                  navigator.clipboard.writeText(content);
                }}
                className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
              >
                <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {(selectedArtifact.path || '').endsWith('.html') && typeof selectedArtifact.content === 'string' ? (
                <iframe
                  srcDoc={inlineAssetsIntoHtml(selectedArtifact.content, artifacts)}
                  className="h-full w-full border-0"
                  sandbox="allow-scripts"
                  title={selectedArtifact.name}
                />
              ) : (selectedArtifact.path || '').endsWith('.md') && typeof selectedArtifact.content === 'string' ? (
                <div className="p-6 prose prose-invert prose-sm max-w-none overflow-y-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedArtifact.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <pre className="p-4 text-xs text-text-secondary whitespace-pre-wrap overflow-x-auto">
                  <code>
                    {typeof selectedArtifact.content === 'string'
                      ? selectedArtifact.content
                      : JSON.stringify(selectedArtifact.content, null, 2)}
                  </code>
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}
