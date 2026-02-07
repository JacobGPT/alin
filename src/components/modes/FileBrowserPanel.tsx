/**
 * FileBrowserPanel - File tree browser for Coding Mode
 */

import { useState, useEffect } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  DocumentIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileEntry[];
}

export function FileBrowserPanel() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRootDirectory();
  }, []);

  const loadRootDirectory = async () => {
    try {
      const response = await fetch('/api/files/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      });
      const data = await response.json();
      if (data.success && data.entries) {
        setFiles(data.entries.map((entry: any) => ({
          name: entry.name,
          type: entry.type === 'directory' ? 'directory' : 'file',
          path: entry.name,
        })));
      }
    } catch {
      // Backend might not be running
    } finally {
      setLoading(false);
    }
  };

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderEntry = (entry: FileEntry, depth = 0) => {
    const isExpanded = expandedDirs.has(entry.path);
    const isDir = entry.type === 'directory';

    return (
      <div key={entry.path}>
        <button
          onClick={() => isDir && toggleDir(entry.path)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-xs hover:bg-background-hover rounded transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isDir ? (
            <>
              {isExpanded ? (
                <ChevronDownIcon className="h-3 w-3 text-text-quaternary flex-shrink-0" />
              ) : (
                <ChevronRightIcon className="h-3 w-3 text-text-quaternary flex-shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpenIcon className="h-4 w-4 text-amber-400 flex-shrink-0" />
              ) : (
                <FolderIcon className="h-4 w-4 text-amber-400 flex-shrink-0" />
              )}
            </>
          ) : (
            <>
              <span className="w-3" />
              <DocumentIcon className="h-4 w-4 text-text-tertiary flex-shrink-0" />
            </>
          )}
          <span className="text-text-secondary truncate">{entry.name}</span>
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-text-tertiary">Loading files...</div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 border-b border-border-primary">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          File Browser
        </h3>
      </div>
      <div className="py-1">
        {files.map((entry) => renderEntry(entry))}
        {files.length === 0 && (
          <p className="px-4 py-2 text-xs text-text-quaternary">
            No files found. Start the backend server.
          </p>
        )}
      </div>
    </div>
  );
}
