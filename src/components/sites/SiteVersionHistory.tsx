/**
 * SiteVersionHistory — Timeline of R2 deployment versions.
 * Shows version number, timestamp, file count, size, and rollback controls.
 */

import { useState, useEffect } from 'react';
import {
  ClockIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';
import { useSitesStore } from '@store/sitesStore';

function formatDate(ts: number): string {
  if (!ts || isNaN(ts) || ts <= 0) return 'Unknown';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SiteVersionHistory({ siteId }: { siteId: string }) {
  const { versions, deploying, loadSiteVersions, rollbackSite } = useSitesStore();
  const [confirmRollback, setConfirmRollback] = useState<number | null>(null);

  useEffect(() => {
    loadSiteVersions(siteId);
  }, [siteId]);

  const handleRollback = async (version: number) => {
    await rollbackSite(siteId, version);
    setConfirmRollback(null);
    loadSiteVersions(siteId);
  };

  if (versions.length === 0) {
    return (
      <div className="text-center py-12 text-text-tertiary text-sm">
        No versions yet. Deploy your site to see version history.
      </div>
    );
  }

  const activeVersion = versions[0]?.version;

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
      <div className="border-b border-border-primary px-4 py-3">
        <h3 className="text-sm font-medium text-text-primary">
          Version History <span className="text-text-quaternary ml-1">({versions.length})</span>
        </h3>
      </div>
      <div className="divide-y divide-border-primary">
        {versions.map((v) => {
          const isActive = v.version === activeVersion;
          return (
            <div key={v.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                  isActive ? 'bg-brand-primary/10 text-brand-primary' : 'bg-bg-tertiary text-text-tertiary'
                }`}>
                  v{v.version}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-text-primary">
                      {v.file_count} files
                      <span className="text-text-quaternary ml-1">({formatSize(v.total_bytes)})</span>
                    </p>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                        <CheckCircleIcon className="h-3 w-3" />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-tertiary flex items-center gap-1">
                    <ClockIcon className="h-3 w-3" />
                    {formatDate(v.created_at)}
                  </p>
                </div>
              </div>

              {!isActive && (
                <div>
                  {confirmRollback === v.version ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-tertiary">Rollback?</span>
                      <button
                        onClick={() => handleRollback(v.version)}
                        disabled={deploying}
                        className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmRollback(null)}
                        className="text-xs text-text-tertiary hover:text-text-secondary"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRollback(v.version)}
                      className="flex items-center gap-1 rounded-md border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary transition-colors"
                    >
                      <ArrowPathIcon className="h-3 w-3" />
                      Rollback
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
