/**
 * SiteDomainSettings — Domain info card with copy-to-clipboard and visit link.
 * Shows {subdomain}.alinai.dev prominently + custom domain instructions.
 */

import {
  GlobeAltIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  TrashIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { useState, useEffect } from 'react';
import * as dbService from '../../api/dbService';

interface Props {
  siteName: string;
  domain: string | null;
  cfProjectName: string | null;
  siteId: string;
  onDelete?: () => void;
}

export function SiteDomainSettings({ siteName, domain, cfProjectName, siteId, onDelete }: Props) {
  const [copied, setCopied] = useState(false);
  const [versionInfo, setVersionInfo] = useState<Record<string, unknown> | null>(null);
  const [domainCheck, setDomainCheck] = useState('');
  const [domainAvailable, setDomainAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    dbService.getSiteVersionInfo(siteId).then((info) => {
      if (info) setVersionInfo(info as Record<string, unknown>);
    }).catch(() => {});
  }, [siteId]);

  const handleDomainCheck = async () => {
    if (!domainCheck.trim()) return;
    setChecking(true);
    try {
      const result = await dbService.lookupDomain(domainCheck.trim());
      setDomainAvailable(result.available);
    } catch {
      setDomainAvailable(null);
    }
    setChecking(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete?.();
  };

  const subdomain = cfProjectName || siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 58);
  const displayDomain = domain || `${subdomain}.alinai.dev`;
  const fullUrl = domain || `https://${subdomain}.alinai.dev`;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Primary domain card */}
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-500/10">
            <GlobeAltIcon className="h-5 w-5 text-teal-400" />
          </div>
          <div>
            <p className="text-xs text-text-tertiary">Live URL</p>
            <p className="text-lg font-semibold text-text-primary">{displayDomain}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-border-primary px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary transition-colors"
          >
            {copied ? (
              <>
                <CheckIcon className="h-4 w-4 text-green-400" />
                Copied!
              </>
            ) : (
              <>
                <ClipboardDocumentIcon className="h-4 w-4" />
                Copy URL
              </>
            )}
          </button>
          <a
            href={fullUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-2 text-sm font-medium text-white hover:bg-brand-primary-hover transition-colors"
          >
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            Visit Site
          </a>
        </div>
      </div>

      {/* Site info */}
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-2 text-xs text-text-tertiary">
        <p><span className="text-text-secondary">Site ID:</span> {siteId}</p>
        <p><span className="text-text-secondary">Subdomain:</span> {subdomain}</p>
        {cfProjectName && <p><span className="text-text-secondary">CF Project:</span> {cfProjectName}</p>}
      </div>

      {/* Version info */}
      {versionInfo && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-2 text-xs text-text-tertiary">
          <h4 className="text-sm font-medium text-text-primary mb-2">Active Version</h4>
          <p><span className="text-text-secondary">Version:</span> {String(versionInfo.version || 'unknown')}</p>
          {versionInfo.deploymentId ? <p><span className="text-text-secondary">Deployment:</span> {String(versionInfo.deploymentId)}</p> : null}
        </div>
      )}

      {/* Domain availability checker */}
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
        <h4 className="text-sm font-medium text-text-primary mb-2">Check Domain Availability</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={domainCheck}
            onChange={(e) => { setDomainCheck(e.target.value); setDomainAvailable(null); }}
            placeholder="my-project"
            className="flex-1 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder-text-quaternary"
          />
          <button
            onClick={handleDomainCheck}
            disabled={checking || !domainCheck.trim()}
            className="flex items-center gap-1 rounded-lg bg-brand-primary px-3 py-2 text-sm text-white hover:bg-brand-primary-hover disabled:opacity-50"
          >
            <MagnifyingGlassIcon className="h-4 w-4" />
            {checking ? '...' : 'Check'}
          </button>
        </div>
        {domainAvailable !== null && (
          <p className={`mt-2 text-xs ${domainAvailable ? 'text-green-400' : 'text-red-400'}`}>
            {domainCheck}.alinai.dev is {domainAvailable ? 'available' : 'taken'}
          </p>
        )}
      </div>

      {/* Custom domain instructions */}
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
        <h4 className="text-sm font-medium text-text-primary mb-2">Custom Domain</h4>
        <p className="text-xs text-text-tertiary mb-3">
          To use your own domain, add a CNAME record pointing to your site:
        </p>
        <div className="rounded-md bg-bg-primary p-3 font-mono text-xs text-text-secondary">
          <p>Type: <span className="text-brand-primary">CNAME</span></p>
          <p>Name: <span className="text-brand-primary">your-subdomain</span></p>
          <p>Target: <span className="text-brand-primary">{subdomain}.alinai.dev</span></p>
        </div>
        <p className="text-[10px] text-text-quaternary mt-2">
          Custom domain support with automatic SSL is coming soon.
        </p>
      </div>

      {/* Danger zone */}
      {onDelete && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4">
          <h4 className="text-sm font-medium text-red-400 mb-2">Danger Zone</h4>
          <p className="text-xs text-text-tertiary mb-3">
            {confirmDelete
              ? 'Are you sure? This cannot be undone.'
              : 'Permanently delete this site and all its deployments.'}
          </p>
          <button
            onClick={handleDelete}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
            }`}
          >
            <TrashIcon className="h-4 w-4" />
            {confirmDelete ? 'Yes, Delete Site' : 'Delete Site'}
          </button>
        </div>
      )}
    </div>
  );
}
