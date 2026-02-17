/**
 * PatchPlanView — Shows a patch plan with file diffs, approve/reject/follow-up.
 *
 * Renders:
 * - Plan summary with change counts
 * - Diff View / Preview toggle
 * - Per-file diffs via react-diff-viewer-continued (split view, syntax highlighting)
 * - Live "After" preview iframe with mobile/desktop toggle
 * - Placeholder resolution inputs
 * - Approve / Reject / Follow-up buttons
 * - Warnings
 */

import { useState, useMemo } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import {
  CheckCircleIcon,
  XCircleIcon,
  DocumentPlusIcon,
  DocumentMinusIcon,
  PencilIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  CodeBracketIcon,
  DevicePhoneMobileIcon,
  DeviceTabletIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';
import type { DbSitePatch, PatchChange } from '../../api/dbService';

interface PatchPlanViewProps {
  patch: DbSitePatch;
  onApprove: (replacements: Record<string, string>) => void;
  onReject: () => void;
  onFollowUp: (message: string) => void;
  loading: boolean;
}

type ViewMode = 'diff' | 'preview';

// Dark theme styles for react-diff-viewer matching ALIN design
const diffStyles = {
  variables: {
    dark: {
      diffViewerBackground: 'rgb(15, 15, 20)',
      diffViewerColor: 'rgb(200, 200, 210)',
      addedBackground: 'rgba(34, 197, 94, 0.08)',
      addedColor: 'rgb(134, 239, 172)',
      removedBackground: 'rgba(239, 68, 68, 0.08)',
      removedColor: 'rgb(252, 165, 165)',
      wordAddedBackground: 'rgba(34, 197, 94, 0.25)',
      wordRemovedBackground: 'rgba(239, 68, 68, 0.25)',
      addedGutterBackground: 'rgba(34, 197, 94, 0.12)',
      removedGutterBackground: 'rgba(239, 68, 68, 0.12)',
      gutterBackground: 'rgb(20, 20, 28)',
      gutterBackgroundDark: 'rgb(15, 15, 20)',
      highlightBackground: 'rgba(139, 92, 246, 0.1)',
      highlightGutterBackground: 'rgba(139, 92, 246, 0.15)',
      codeFoldGutterBackground: 'rgb(25, 25, 35)',
      codeFoldBackground: 'rgb(20, 20, 30)',
      emptyLineBackground: 'rgb(18, 18, 25)',
      codeFoldContentColor: 'rgb(120, 120, 140)',
    },
  },
  line: {
    fontSize: '12px',
  },
  contentText: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '12px',
    lineHeight: '1.6',
  },
};

export function PatchPlanView({ patch, onApprove, onReject, onFollowUp, loading }: PatchPlanViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<number>>(new Set([0]));
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [followUpText, setFollowUpText] = useState('');
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('diff');
  const [previewWidth, setPreviewWidth] = useState<'375px' | '768px' | '100%'>('100%');

  const plan = patch.plan;
  if (!plan) {
    return (
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 text-sm text-text-tertiary">
        No plan data available.
      </div>
    );
  }

  const hasPlaceholders = (plan.placeholders?.length || 0) > 0;
  const unresolvedPlaceholders = (plan.placeholders || []).filter(p => !replacements[p]?.trim());

  const toggleFile = (idx: number) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleApprove = () => {
    onApprove(replacements);
  };

  const handleFollowUp = () => {
    if (!followUpText.trim()) return;
    onFollowUp(followUpText.trim());
    setFollowUpText('');
    setShowFollowUp(false);
  };

  const isApplied = patch.status === 'applied' || patch.status === 'partially_applied';
  const isRejected = patch.status === 'rejected';
  const canApprove = patch.status === 'planned' && unresolvedPlaceholders.length === 0;

  // Count changes by type
  const modifiedCount = plan.changes.filter(c => c.action === 'modify').length;
  const createdCount = plan.changes.filter(c => c.action === 'create').length;
  const deletedCount = plan.changes.filter(c => c.action === 'delete').length;

  // Check if we have HTML content for preview
  const hasHtmlPreview = plan.changes.some(c =>
    c.file.endsWith('.html') && c.after
  );

  return (
    <div className="space-y-4">
      {/* Plan Summary with change counts */}
      <div className="rounded-lg border border-brand-primary/30 bg-brand-primary/5 p-4">
        <h3 className="text-sm font-medium text-text-primary mb-1">Proposed Change</h3>
        <p className="text-sm text-text-secondary">{plan.summary}</p>
        <div className="mt-2 flex items-center gap-3 text-xs text-text-tertiary">
          {modifiedCount > 0 && (
            <span className="flex items-center gap-1">
              <PencilIcon className="h-3.5 w-3.5 text-yellow-400" />
              {modifiedCount} modified
            </span>
          )}
          {createdCount > 0 && (
            <span className="flex items-center gap-1">
              <DocumentPlusIcon className="h-3.5 w-3.5 text-green-400" />
              {createdCount} created
            </span>
          )}
          {deletedCount > 0 && (
            <span className="flex items-center gap-1">
              <DocumentMinusIcon className="h-3.5 w-3.5 text-red-400" />
              {deletedCount} deleted
            </span>
          )}
          {hasPlaceholders && (
            <span className="text-yellow-400">
              {unresolvedPlaceholders.length} placeholder{unresolvedPlaceholders.length !== 1 ? 's' : ''} to fill
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-text-quaternary">
          {plan.changes.map(c => c.file).join(' \u00B7 ')}
        </p>
      </div>

      {/* Status Banner */}
      {isApplied && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
          <CheckCircleIcon className="h-5 w-5" />
          <span>
            Patch applied ({patch.apply_result?.applied || 0} files updated
            {(patch.apply_result?.failed || 0) > 0 && `, ${patch.apply_result?.failed} failed`})
          </span>
        </div>
      )}
      {isRejected && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          <XCircleIcon className="h-5 w-5" />
          <span>Patch rejected</span>
        </div>
      )}

      {/* Warnings */}
      {plan.warnings?.length > 0 && (
        <div className="space-y-1">
          {plan.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
              <ExclamationTriangleIcon className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Placeholder Resolution */}
      {hasPlaceholders && patch.status === 'planned' && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-3">
          <h4 className="text-sm font-medium text-yellow-400">Fill in required values</h4>
          <p className="text-xs text-text-tertiary">
            These placeholders must be filled before the change can be applied.
          </p>
          {plan.placeholders.map((placeholder, i) => (
            <div key={i} className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">{placeholder}</label>
              <input
                type="text"
                value={replacements[placeholder] || ''}
                onChange={(e) => setReplacements(prev => ({ ...prev, [placeholder]: e.target.value }))}
                placeholder={`Enter value for: ${placeholder}`}
                className="rounded border border-border-primary bg-bg-primary px-3 py-1.5 text-sm text-text-primary placeholder-text-tertiary focus:border-brand-primary focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="flex items-center gap-1 rounded-lg border border-border-primary bg-bg-secondary p-1 w-fit">
        <button
          onClick={() => setViewMode('diff')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === 'diff'
              ? 'bg-brand-primary/10 text-brand-primary'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <CodeBracketIcon className="h-3.5 w-3.5" />
          Diff View
        </button>
        <button
          onClick={() => setViewMode('preview')}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            viewMode === 'preview'
              ? 'bg-brand-primary/10 text-brand-primary'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <EyeIcon className="h-3.5 w-3.5" />
          Preview
        </button>
      </div>

      {/* Diff View */}
      {viewMode === 'diff' && (
        <div className="space-y-2">
          {plan.changes.map((change, idx) => (
            <FileDiff
              key={idx}
              change={change}
              expanded={expandedFiles.has(idx)}
              onToggle={() => toggleFile(idx)}
            />
          ))}
        </div>
      )}

      {/* Preview View */}
      {viewMode === 'preview' && (
        <PreviewPanel changes={plan.changes} previewWidth={previewWidth} setPreviewWidth={setPreviewWidth} />
      )}

      {/* Actions */}
      {patch.status === 'planned' && (
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleApprove}
            disabled={!canApprove || loading}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircleIcon className="h-4 w-4" />
            )}
            Approve & Apply
          </button>
          <button
            onClick={onReject}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
          >
            <XCircleIcon className="h-4 w-4" />
            Reject
          </button>
          <button
            onClick={() => setShowFollowUp(!showFollowUp)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border-primary px-4 py-2 text-sm text-text-secondary hover:bg-bg-tertiary disabled:opacity-50 transition-colors"
          >
            <PencilIcon className="h-4 w-4" />
            Follow-up
          </button>
        </div>
      )}

      {/* Follow-up Input */}
      {showFollowUp && (
        <div className="flex gap-2">
          <input
            type="text"
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="Describe what to change about this plan..."
            className="flex-1 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-brand-primary focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleFollowUp()}
          />
          <button
            onClick={handleFollowUp}
            disabled={!followUpText.trim()}
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm text-white hover:bg-brand-primary-hover disabled:opacity-50 transition-colors"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FILE DIFF COMPONENT (react-diff-viewer-continued)
// ============================================================================

function FileDiff({
  change,
  expanded,
  onToggle,
}: {
  change: PatchChange;
  expanded: boolean;
  onToggle: () => void;
}) {
  const actionIcon = {
    create: <DocumentPlusIcon className="h-4 w-4 text-green-400" />,
    delete: <DocumentMinusIcon className="h-4 w-4 text-red-400" />,
    modify: <PencilIcon className="h-4 w-4 text-yellow-400" />,
  };

  const actionColor = {
    create: 'text-green-400',
    delete: 'text-red-400',
    modify: 'text-yellow-400',
  };

  const provenanceLabel: Record<string, { text: string; color: string }> = {
    USER_PROVIDED: { text: 'User', color: 'text-green-400 bg-green-500/10' },
    INFERRED: { text: 'Inferred', color: 'text-blue-400 bg-blue-500/10' },
    PLACEHOLDER: { text: 'Placeholder', color: 'text-yellow-400 bg-yellow-500/10' },
  };

  const prov = provenanceLabel[change.provenance] || provenanceLabel.INFERRED;

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-bg-tertiary transition-colors"
      >
        {expanded ? (
          <ChevronDownIcon className="h-4 w-4 text-text-tertiary" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 text-text-tertiary" />
        )}
        {actionIcon[change.action]}
        <span className="text-sm text-text-primary font-mono flex-1">{change.file}</span>
        <span className={`text-xs capitalize ${actionColor[change.action]}`}>{change.action}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${prov.color}`}>{prov.text}</span>
      </button>

      {/* Diff Content */}
      {expanded && (
        <div className="border-t border-border-primary">
          <p className="px-3 py-2 text-xs text-text-tertiary bg-bg-tertiary">{change.summary}</p>
          <div className="max-h-[500px] overflow-auto text-xs">
            {change.action === 'modify' ? (
              <ReactDiffViewer
                oldValue={change.before || ''}
                newValue={change.after || ''}
                splitView={true}
                useDarkTheme={true}
                compareMethod={DiffMethod.WORDS}
                styles={diffStyles}
                leftTitle="Before"
                rightTitle="After"
              />
            ) : change.action === 'create' ? (
              <ReactDiffViewer
                oldValue=""
                newValue={change.after || ''}
                splitView={false}
                useDarkTheme={true}
                compareMethod={DiffMethod.WORDS}
                styles={diffStyles}
                rightTitle="New File"
              />
            ) : change.action === 'delete' ? (
              <ReactDiffViewer
                oldValue={change.before || ''}
                newValue=""
                splitView={false}
                useDarkTheme={true}
                compareMethod={DiffMethod.WORDS}
                styles={diffStyles}
                leftTitle="Deleted File"
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PREVIEW PANEL
// ============================================================================

function PreviewPanel({
  changes,
  previewWidth,
  setPreviewWidth,
}: {
  changes: PatchChange[];
  previewWidth: string;
  setPreviewWidth: (w: '375px' | '768px' | '100%') => void;
}) {
  // Build preview HTML from the "after" state of changes
  const previewHtml = useMemo(() => {
    const htmlChange = changes.find(c =>
      c.file.endsWith('.html') && c.after
    );
    if (!htmlChange) return null;

    let html = htmlChange.after!;

    // Inline CSS changes into the HTML
    for (const change of changes) {
      if (change.file.endsWith('.css') && change.after) {
        // Try to replace <link> references with inlined <style>
        const linkPattern = new RegExp(
          `<link[^>]*href=["'](?:\.?\\/?)${change.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*/?>`,
          'gi'
        );
        if (linkPattern.test(html)) {
          html = html.replace(linkPattern, `<style>${change.after}</style>`);
        } else {
          // Append before </head> or at start
          const insertPoint = html.indexOf('</head>');
          if (insertPoint > -1) {
            html = html.slice(0, insertPoint) + `<style>${change.after}</style>` + html.slice(insertPoint);
          } else {
            html = `<style>${change.after}</style>` + html;
          }
        }
      }

      // Inline JS changes
      if (change.file.endsWith('.js') && change.after) {
        const scriptPattern = new RegExp(
          `<script[^>]*src=["'](?:\.?\\/?)${change.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
          'gi'
        );
        if (scriptPattern.test(html)) {
          html = html.replace(scriptPattern, `<script>${change.after}</script>`);
        }
      }
    }

    return html;
  }, [changes]);

  if (!previewHtml) {
    return (
      <div className="rounded-lg border border-border-primary bg-bg-secondary p-6 text-center">
        <EyeIcon className="mx-auto h-8 w-8 text-text-quaternary mb-2" />
        <p className="text-sm text-text-secondary">No HTML preview available</p>
        <p className="text-xs text-text-tertiary mt-1">
          CSS/JS changes will be visible after applying the patch.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-primary px-4 py-2">
        <p className="text-xs text-text-tertiary">After Preview</p>
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
          srcDoc={previewHtml}
          className="rounded-lg border border-border-primary bg-white"
          style={{ width: previewWidth, height: '400px' }}
          title="Patch preview"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}

export default PatchPlanView;
