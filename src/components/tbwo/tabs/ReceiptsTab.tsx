import { useState } from 'react';
import {
  DocumentDuplicateIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  RocketLaunchIcon,
  SparklesIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

import type { TBWO } from '../../../types/tbwo';
import { Button } from '@components/ui/Button';
import { useSitesStore } from '@store/sitesStore';
import { downloadTBWOZip, countDownloadableArtifacts } from '../../../services/tbwo/zipService';

export function ReceiptsTab({ tbwo }: { tbwo: TBWO }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const fileCount = countDownloadableArtifacts(tbwo);

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

  if (!tbwo.receipts) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <DocumentDuplicateIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Receipts Yet</h3>
        <p className="text-sm text-text-tertiary">
          Receipts will be generated when the TBWO completes
        </p>
      </div>
    );
  }

  const { executive, technical } = tbwo.receipts;

  return (
    <div className="space-y-6">
      {/* Download All Files */}
      {fileCount > 0 && (
        <div className="rounded-xl border border-brand-primary/30 bg-brand-primary/5 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-primary/20">
                <ArrowDownTrayIcon className="h-5 w-5 text-brand-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Download All Files</h3>
                <p className="text-sm text-text-tertiary">
                  {fileCount} file{fileCount !== 1 ? 's' : ''} ready to download as ZIP
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadZip}
              disabled={isDownloading}
              leftIcon={isDownloading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ArrowDownTrayIcon className="h-4 w-4" />}
            >
              {isDownloading ? 'Zipping...' : 'Download ZIP'}
            </Button>
          </div>
        </div>
      )}

      {/* Create Site from Website Sprint */}
      {tbwo.type === 'website_sprint' && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/20">
                <RocketLaunchIcon className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-text-primary">Deploy as Live Site</h3>
                <p className="text-sm text-text-tertiary">
                  Create a site record and deploy to Cloudflare Pages
                </p>
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<RocketLaunchIcon className="h-4 w-4" />}
              onClick={async () => {
                try {
                  const _briefName = (tbwo.metadata?.siteBrief as Record<string, unknown>)?.productName as string;
                  const site = await useSitesStore.getState().createSite(
                    _briefName || tbwo.objective || 'Untitled Site',
                    tbwo.id,
                  );
                  window.location.href = `/sites/${site.id}`;
                } catch (e) {
                  console.error('[TBWO] Create site failed:', e);
                }
              }}
            >
              Create Site
            </Button>
          </div>
        </div>
      )}

      {/* Executive Summary */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-text-primary">
          <SparklesIcon className="h-5 w-5 text-brand-primary" />
          Executive Summary
        </h3>
        <p className="mb-4 text-text-secondary">{executive.summary}</p>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-background-tertiary p-4">
            <p className="text-2xl font-bold text-text-primary">{executive.filesCreated}</p>
            <p className="text-sm text-text-tertiary">Files Created</p>
          </div>
          <div className="rounded-lg bg-background-tertiary p-4">
            <p className="text-2xl font-bold text-text-primary">{executive.linesOfCode}</p>
            <p className="text-sm text-text-tertiary">Lines of Code</p>
          </div>
        </div>

        {executive.accomplishments.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-medium text-text-primary">Accomplishments</h4>
            <ul className="space-y-1">
              {executive.accomplishments.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                  <CheckCircleSolid className="h-4 w-4 text-semantic-success" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Technical Details */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-text-primary">
          <CpuChipIcon className="h-5 w-5 text-brand-secondary" />
          Technical Details
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-background-tertiary px-4 py-3">
            <span className="text-text-secondary">Build Status</span>
            <span className={`font-medium ${
              technical.buildStatus === 'success'
                ? 'text-semantic-success'
                : technical.buildStatus === 'failed'
                ? 'text-semantic-error'
                : 'text-semantic-warning'
            }`}>
              {technical.buildStatus}
            </span>
          </div>
          {technical.dependencies?.length > 0 && (
            <div className="rounded-lg bg-background-tertiary p-4">
              <p className="mb-2 text-sm font-medium text-text-primary">Dependencies</p>
              <div className="flex flex-wrap gap-2">
                {technical.dependencies.map((dep, i) => (
                  <span key={i} className="rounded-full bg-background-elevated px-3 py-1 text-xs text-text-secondary">
                    {typeof dep === 'string' ? dep : `${dep.name}@${dep.version}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
