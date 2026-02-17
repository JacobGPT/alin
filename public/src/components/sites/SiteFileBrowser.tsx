/**
 * SiteFileBrowser — Tree view of R2-deployed site files.
 * Shows file size, type icons, and a code preview panel.
 */

import { useState, useEffect } from 'react';
import {
  DocumentTextIcon,
  PhotoIcon,
  CodeBracketIcon,
  FolderIcon,
  FolderOpenIcon,
} from '@heroicons/react/24/outline';
import { useSitesStore } from '@store/sitesStore';

interface FileTreeNode {
  name: string;
  path: string;
  size?: number;
  isDir: boolean;
  children: FileTreeNode[];
}

function buildTree(files: Array<{ path: string; size: number }>): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isDir = i < parts.length - 1;
      let existing = current.find(n => n.name === name && n.isDir === isDir);
      if (!existing) {
        existing = {
          name,
          path: parts.slice(0, i + 1).join('/'),
          size: isDir ? undefined : file.size,
          isDir,
          children: [],
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }
  return root;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'].includes(ext || ''))
    return <PhotoIcon className="h-4 w-4 text-pink-400" />;
  if (['js', 'ts', 'jsx', 'tsx', 'json', 'mjs'].includes(ext || ''))
    return <CodeBracketIcon className="h-4 w-4 text-yellow-400" />;
  return <DocumentTextIcon className="h-4 w-4 text-text-tertiary" />;
}

function TreeNode({ node, depth, selected, onSelect }: {
  node: FileTreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (node.isDir) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary rounded"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {expanded ? (
            <FolderOpenIcon className="h-4 w-4 text-yellow-500" />
          ) : (
            <FolderIcon className="h-4 w-4 text-yellow-500" />
          )}
          <span className="font-medium">{node.name}</span>
        </button>
        {expanded && node.children.map(child => (
          <TreeNode key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const isSelected = selected === node.path;
  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center justify-between gap-2 px-2 py-1 text-xs rounded transition-colors ${
        isSelected ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-secondary hover:bg-bg-tertiary'
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {getFileIcon(node.name)}
        <span className="truncate">{node.name}</span>
      </div>
      {node.size !== undefined && (
        <span className="flex-shrink-0 text-text-quaternary">{formatSize(node.size)}</span>
      )}
    </button>
  );
}

export function SiteFileBrowser({ siteId }: { siteId: string }) {
  const { files, filesLoading, loadSiteFiles } = useSitesStore();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    loadSiteFiles(siteId);
  }, [siteId]);

  if (filesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-primary" />
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center py-12 text-text-tertiary text-sm">
        No files yet. Deploy your site to see files here.
      </div>
    );
  }

  const tree = buildTree(files);

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
      <div className="border-b border-border-primary px-4 py-3">
        <h3 className="text-sm font-medium text-text-primary">
          Files <span className="text-text-quaternary ml-1">({files.length})</span>
        </h3>
      </div>
      <div className="max-h-[500px] overflow-y-auto py-1 font-mono">
        {tree.map(node => (
          <TreeNode key={node.path} node={node} depth={0} selected={selected} onSelect={setSelected} />
        ))}
      </div>
    </div>
  );
}
