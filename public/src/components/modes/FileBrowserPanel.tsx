/**
 * FileBrowserPanel - File tree browser for Coding Mode
 *
 * Connects to workspace store when server-side tool loop is active,
 * falls back to /api/files/list for regular file browsing.
 */

import { useState, useEffect, useRef } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  DocumentIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ArrowUpTrayIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { useWorkspaceStore, type WorkspaceFile } from '../../store/workspaceStore';
import { useModeStore } from '../../store/modeStore';
import { getModeConfig } from '../../config/modes';
import { useAuthStore } from '../../store/authStore';

export function FileBrowserPanel() {
  const [localFiles, setLocalFiles] = useState<WorkspaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentMode = useModeStore((s) => s.currentMode);
  const modeConfig = getModeConfig(currentMode);
  const useWorkspace = modeConfig.features.useServerSideToolLoop;

  const workspaceFiles = useWorkspaceStore((s) => s.files);
  const isInitialized = useWorkspaceStore((s) => s.isInitialized);
  const wsLoading = useWorkspaceStore((s) => s.isLoading);

  const files = useWorkspace ? workspaceFiles : localFiles;

  useEffect(() => {
    if (useWorkspace) {
      if (!isInitialized) {
        useWorkspaceStore.getState().initWorkspace();
      } else {
        useWorkspaceStore.getState().refreshTree();
      }
      setLoading(false);
    } else {
      loadRootDirectory();
    }
  }, [useWorkspace, isInitialized]);

  const loadRootDirectory = async () => {
    try {
      const response = await fetch('/api/files/list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...useAuthStore.getState().getAuthHeader(),
        },
        body: JSON.stringify({ path: '.' }),
      });
      const data = await response.json();
      if (data.success && (data.entries || data.files)) {
        const entries = data.entries || data.files || [];
        setLocalFiles(entries.map((entry: any) => ({
          name: entry.name,
          type: entry.isDirectory || entry.type === 'directory' ? 'directory' : 'file',
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
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;
    await useWorkspaceStore.getState().uploadFiles(selectedFiles);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRefresh = () => {
    if (useWorkspace) {
      useWorkspaceStore.getState().refreshTree();
    } else {
      setLoading(true);
      loadRootDirectory();
    }
  };

  const handleDownloadZip = () => {
    const authHeader = useAuthStore.getState().getAuthHeader();
    const token = authHeader?.Authorization?.replace('Bearer ', '') || '';
    window.open(`/api/workspace/zip?token=${encodeURIComponent(token)}`, '_blank');
  };

  const renderEntry = (entry: WorkspaceFile, depth = 0) => {
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
          {!isDir && entry.size !== undefined && (
            <span className="text-text-quaternary ml-auto text-[10px]">
              {entry.size < 1024 ? `${entry.size}B` : `${Math.round(entry.size / 1024)}K`}
            </span>
          )}
        </button>
        {isDir && isExpanded && entry.children && (
          <div>
            {entry.children.map((child) => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading || wsLoading) {
    return (
      <div className="p-4 text-sm text-text-tertiary">Loading files...</div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 border-b border-border-primary flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          {useWorkspace ? 'Workspace' : 'File Browser'}
        </h3>
        <div className="flex items-center gap-1">
          {useWorkspace && (
            <>
              <button
                onClick={handleUpload}
                className="p-1 rounded hover:bg-background-hover text-text-tertiary hover:text-text-primary transition-colors"
                title="Upload files"
              >
                <ArrowUpTrayIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDownloadZip}
                className="p-1 rounded hover:bg-background-hover text-text-tertiary hover:text-text-primary transition-colors"
                title="Download all as zip"
              >
                <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-background-hover text-text-tertiary hover:text-text-primary transition-colors"
            title="Refresh"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="py-1">
        {files.map((entry) => renderEntry(entry))}
        {files.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-text-quaternary mb-2">
              {useWorkspace
                ? 'Workspace is empty. Upload files or ask ALIN to create some.'
                : 'No files found. Start the backend server.'}
            </p>
            {useWorkspace && (
              <button
                onClick={handleUpload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
              >
                <ArrowUpTrayIcon className="h-3.5 w-3.5" />
                Upload Files
              </button>
            )}
          </div>
        )}
      </div>

      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
