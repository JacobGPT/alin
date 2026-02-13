/**
 * Sites Dashboard — Deploy + manage ALIN-generated sites.
 *
 * Tabbed layout: Overview | Files | Versions | Media | Settings
 * Shows: site name, live URL, deploy status, R2 files, version history,
 * media gallery, domain settings, and Request Change operator loop.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GlobeAltIcon,
  RocketLaunchIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  PencilSquareIcon,
  DocumentDuplicateIcon,
  FolderIcon,
  PhotoIcon,
  Cog6ToothIcon,
  DevicePhoneMobileIcon,
  ComputerDesktopIcon,
  DeviceTabletIcon,
} from '@heroicons/react/24/outline';
import { useSitesStore } from '@store/sitesStore';
import type { DeployProgressEvent } from '../../api/dbService';
import { useCapabilities } from '../../hooks/useCapabilities';
import { PatchPlanView } from './PatchPlanView';
import { SiteFileBrowser } from './SiteFileBrowser';
import { SiteVersionHistory } from './SiteVersionHistory';
import { SiteMediaGallery } from './SiteMediaGallery';
import { SiteDomainSettings } from './SiteDomainSettings';

type TabId = 'overview' | 'files' | 'versions' | 'media' | 'settings';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

function SiteDashboard() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const caps = useCapabilities();

  const {
    currentSite,
    deployments,
    loading,
    deploying,
    error,
    loadSite,
    loadDeployments,
    deploySite,
    deploySiteR2,
    loadSites,
    sites,
    clearError,
    files,
    images,
    // Patch state
    currentPatch,
    patchLoading,
    patchError,
    requestChange,
    approvePatch,
    rejectPatch,
    clearPatch,
    // Deploy progress
    deployProgress,
  } = useSitesStore();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [changeRequest, setChangeRequest] = useState('');
  const [previewWidth, setPreviewWidth] = useState<'375px' | '768px' | '100%'>('100%');

  // Load site and deployments
  useEffect(() => {
    if (siteId) {
      loadSite(siteId);
      loadDeployments(siteId);
    } else {
      loadSites();
    }
  }, [siteId]);

  // If no siteId, show sites list
  if (!siteId) {
    return <SitesList sites={sites} loading={loading} onSelect={(id) => navigate(`/sites/${id}`)} />;
  }

  if (loading && !currentSite) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
      </div>
    );
  }

  if (!currentSite) {
    return (
      <div className="flex h-full items-center justify-center text-text-secondary">
        Site not found
      </div>
    );
  }

  const latestDeploy = deployments[0];
  const liveUrl = currentSite.domain || latestDeploy?.url;
  const isDeployed = currentSite.status === 'deployed' && liveUrl;
  const previewUrl = `/api/preview/${currentSite.id}/index.html`;

  const handleDeploy = async () => {
    clearError();
    await deploySite(currentSite.id);
  };

  const handleDeployR2 = async () => {
    clearError();
    await deploySiteR2(currentSite.id);
  };

  const handleChangeRequest = () => {
    if (!changeRequest.trim() || !currentSite) return;
    requestChange(currentSite.id, changeRequest.trim());
    setChangeRequest('');
  };

  const tabs: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number; show?: boolean }> = [
    { id: 'overview', label: 'Overview', icon: GlobeAltIcon },
    { id: 'files', label: 'Files', icon: FolderIcon, badge: files.length, show: !!isDeployed },
    { id: 'versions', label: 'Versions', icon: DocumentDuplicateIcon, show: !!isDeployed },
    { id: 'media', label: 'Media', icon: PhotoIcon, badge: images.length, show: caps.canCfImages || caps.canCfStream },
    { id: 'settings', label: 'Settings', icon: Cog6ToothIcon },
  ];

  const visibleTabs = tabs.filter(t => t.show !== false);

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10">
            <GlobeAltIcon className="h-6 w-6 text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">{currentSite.name}</h1>
            <p className="text-sm text-text-tertiary">
              {isDeployed ? 'Deployed' : 'Draft'} &middot; Created {formatDate(currentSite.created_at)}
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/sites')}
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          All Sites
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <ExclamationTriangleIcon className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={clearError} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border-primary">
        {visibleTabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-brand-primary text-brand-primary'
                : 'border-transparent text-text-tertiary hover:text-text-secondary'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="ml-1 rounded-full bg-brand-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-primary">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Live URL card */}
          {isDeployed && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon className="h-5 w-5 text-green-500" />
                  <span className="text-sm font-medium text-green-400">Live</span>
                </div>
                <a
                  href={liveUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-brand-primary hover:underline"
                >
                  {liveUrl}
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}

          {/* Preview iframe with mobile/desktop toggle */}
          {isDeployed && (
            <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
              <div className="flex items-center justify-between border-b border-border-primary px-4 py-2">
                <p className="text-xs text-text-tertiary">Preview</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPreviewWidth('375px')}
                    className={`rounded p-1 ${previewWidth === '375px' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-quaternary hover:text-text-secondary'}`}
                    title="Mobile"
                  >
                    <DevicePhoneMobileIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPreviewWidth('768px')}
                    className={`rounded p-1 ${previewWidth === '768px' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-quaternary hover:text-text-secondary'}`}
                    title="Tablet"
                  >
                    <DeviceTabletIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPreviewWidth('100%')}
                    className={`rounded p-1 ${previewWidth === '100%' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-quaternary hover:text-text-secondary'}`}
                    title="Desktop"
                  >
                    <ComputerDesktopIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex justify-center bg-bg-primary p-4">
                <iframe
                  src={previewUrl}
                  className="rounded-lg border border-border-primary bg-white"
                  style={{ width: previewWidth, height: '400px' }}
                  title="Site preview"
                />
              </div>
            </div>
          )}

          {/* Deploy actions */}
          <div className="flex gap-3">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border-primary bg-bg-secondary px-4 py-2 text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
            >
              <GlobeAltIcon className="h-4 w-4" />
              Preview
            </a>
            <button
              onClick={handleDeploy}
              disabled={deploying}
              className="flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
            >
              {deploying ? (
                <>
                  <ArrowPathIcon className="h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : isDeployed ? (
                <>
                  <ArrowPathIcon className="h-4 w-4" />
                  Redeploy
                </>
              ) : (
                <>
                  <RocketLaunchIcon className="h-4 w-4" />
                  Deploy
                </>
              )}
            </button>
          </div>

          {/* Deploy Progress Feed */}
          {deployProgress.length > 0 && <DeployProgressFeed events={deployProgress} />}

          {/* Deployment History */}
          <div className="rounded-lg border border-border-primary bg-bg-secondary">
            <div className="border-b border-border-primary p-4">
              <h2 className="text-sm font-medium text-text-primary">Deployment History</h2>
            </div>
            {deployments.length === 0 ? (
              <div className="p-4 text-sm text-text-tertiary">No deployments yet</div>
            ) : (
              <div className="divide-y divide-border-primary">
                {deployments.map((d) => (
                  <div key={d.id} className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <DeployStatusIcon status={d.status} />
                      <div>
                        <p className="text-sm text-text-primary capitalize">{d.status}</p>
                        <p className="text-xs text-text-tertiary">{formatDate(d.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {d.url && (
                        <a
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-primary hover:underline flex items-center gap-1"
                        >
                          {(() => { try { return new URL(d.url).hostname; } catch { return d.url; } })()}
                          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                        </a>
                      )}
                      {d.error && (
                        <span className="text-xs text-red-400 max-w-[200px] truncate" title={d.error}>
                          {d.error}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Request Change */}
          <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <PencilSquareIcon className="h-5 w-5 text-text-secondary" />
                <h2 className="text-sm font-medium text-text-primary">Request Change</h2>
              </div>
              {currentPatch && (
                <button onClick={clearPatch} className="text-xs text-text-tertiary hover:text-text-secondary">
                  Clear
                </button>
              )}
            </div>

            {patchError && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
                <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
                <span>{patchError}</span>
              </div>
            )}

            {patchLoading && !currentPatch && (
              <div className="flex items-center gap-3 py-4">
                <ArrowPathIcon className="h-5 w-5 animate-spin text-brand-primary" />
                <div>
                  <p className="text-sm text-text-primary">Planning changes...</p>
                  <p className="text-xs text-text-tertiary">AI is analyzing your site and creating a patch plan</p>
                </div>
              </div>
            )}

            {currentPatch && currentPatch.plan && (
              <PatchPlanView
                patch={currentPatch}
                loading={patchLoading}
                onApprove={(replacements) => approvePatch(currentSite.id, currentPatch.id, replacements)}
                onReject={() => rejectPatch(currentSite.id, currentPatch.id)}
                onFollowUp={(msg) => {
                  clearPatch();
                  requestChange(currentSite.id, msg);
                }}
              />
            )}

            {!patchLoading && (!currentPatch || currentPatch.status === 'applied' || currentPatch.status === 'rejected') && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={changeRequest}
                  onChange={(e) => setChangeRequest(e.target.value)}
                  placeholder="Describe the change you want..."
                  className="flex-1 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-brand-primary focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleChangeRequest()}
                />
                <button
                  onClick={handleChangeRequest}
                  disabled={!changeRequest.trim()}
                  className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
                >
                  Submit
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'files' && <SiteFileBrowser siteId={currentSite.id} />}
      {activeTab === 'versions' && <SiteVersionHistory siteId={currentSite.id} />}
      {activeTab === 'media' && <SiteMediaGallery siteId={currentSite.id} />}
      {activeTab === 'settings' && (
        <SiteDomainSettings
          siteName={currentSite.name}
          domain={currentSite.domain}
          cfProjectName={currentSite.cloudflare_project_name}
          siteId={currentSite.id}
        />
      )}
    </div>
  );
}

// ============================================================================
// SITES LIST VIEW
// ============================================================================

function SitesList({
  sites,
  loading,
  onSelect,
}: {
  sites: { id: string; name: string; status: string; domain: string | null; updated_at: number }[];
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">Sites</h1>
      {sites.length === 0 ? (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-8 text-center text-text-tertiary">
          <GlobeAltIcon className="mx-auto h-12 w-12 mb-3 opacity-50" />
          <p>No sites yet. Create one from a completed Website Sprint.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sites.map((site) => (
            <button
              key={site.id}
              onClick={() => onSelect(site.id)}
              className="w-full flex items-center justify-between rounded-lg border border-border-primary bg-bg-secondary p-4 text-left hover:bg-bg-tertiary transition-colors"
            >
              <div className="flex items-center gap-3">
                <GlobeAltIcon className="h-5 w-5 text-text-secondary" />
                <div>
                  <p className="text-sm font-medium text-text-primary">{site.name}</p>
                  <p className="text-xs text-text-tertiary">{formatDate(site.updated_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {site.domain && (
                  <span className="text-xs text-brand-primary">{site.domain}</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  site.status === 'deployed'
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-yellow-500/10 text-yellow-400'
                }`}>
                  {site.status}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DEPLOY PROGRESS FEED
// ============================================================================

const STEP_ICONS: Record<string, string> = {
  building: '\u{1F528}',
  installing: '\u{1F4E6}',
  compiling: '\u2699\uFE0F',
  built: '\u2705',
  uploading: '\u2601\uFE0F',
  registering: '\u{1F310}',
  success: '\u2705',
};

function DeployProgressFeed({ events }: { events: DeployProgressEvent[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const startTime = events[0]?.timestamp || Date.now();
  const isDone = events.some(e => e.event === 'done');
  const hasError = events.some(e => e.event === 'error');

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events.length]);

  // Filter to status/error events for display (skip 'done' and 'progress' which are internal)
  const displayEvents = events.filter(e => e.event === 'status' || e.event === 'error');

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
      <div className="border-b border-border-primary px-4 py-2 flex items-center justify-between">
        <p className="text-xs font-medium text-text-secondary">Deploy Progress</p>
        {!isDone && (
          <ArrowPathIcon className="h-3.5 w-3.5 text-brand-primary animate-spin" />
        )}
        {isDone && !hasError && (
          <CheckCircleIcon className="h-3.5 w-3.5 text-green-500" />
        )}
        {hasError && (
          <XCircleIcon className="h-3.5 w-3.5 text-red-500" />
        )}
      </div>
      <div ref={feedRef} className="max-h-[240px] overflow-auto">
        {displayEvents.map((evt, i) => {
          const elapsed = Math.round((evt.timestamp - startTime) / 1000);
          const isLast = i === displayEvents.length - 1 && !isDone;
          const icon = evt.event === 'error' ? '\u274C' : STEP_ICONS[evt.step || ''] || '\u{1F4CB}';
          const isSuccess = evt.step === 'success';

          return (
            <div
              key={i}
              className={`flex items-start gap-3 px-4 py-2 text-sm ${
                isLast ? 'bg-brand-primary/5' : ''
              } ${i > 0 ? 'border-t border-border-primary/50' : ''}`}
            >
              <span className="flex-shrink-0 text-base leading-5">{icon}</span>
              <span className={`flex-1 ${
                evt.event === 'error' ? 'text-red-400' :
                isSuccess ? 'text-green-400 font-medium' :
                'text-text-primary'
              }`}>
                {isSuccess && evt.url ? (
                  <a
                    href={evt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-400 hover:underline"
                  >
                    {evt.message}
                    <ArrowTopRightOnSquareIcon className="inline h-3.5 w-3.5 ml-1" />
                  </a>
                ) : (
                  evt.message
                )}
              </span>
              <span className="flex-shrink-0 text-xs text-text-quaternary tabular-nums">
                {elapsed}s
              </span>
              {isLast && !isDone && (
                <span className="flex-shrink-0 h-2 w-2 rounded-full bg-brand-primary animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function DeployStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
    case 'failed':
      return <XCircleIcon className="h-5 w-5 text-red-500" />;
    case 'queued':
    case 'building':
    case 'deploying':
      return <ClockIcon className="h-5 w-5 text-yellow-500 animate-pulse" />;
    default:
      return <ClockIcon className="h-5 w-5 text-text-tertiary" />;
  }
}

function formatDate(ts: number): string {
  if (!ts || isNaN(ts) || ts <= 0) return 'Unknown';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export default SiteDashboard;
