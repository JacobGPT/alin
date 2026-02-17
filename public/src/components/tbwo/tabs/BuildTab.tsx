import { useState } from 'react';
import type { TBWO } from '../../../types/tbwo';
import { ArtifactsTab } from './ArtifactsTab';
import { InteractivePreviewTab } from './InteractivePreviewTab';

export function BuildTab({ tbwo, isWebsiteSprint }: { tbwo: TBWO; isWebsiteSprint: boolean }) {
  const isExecuting = ['executing', 'paused', 'paused_waiting_for_user'].includes(tbwo.status);
  // Default to preview for website sprints during/after execution
  const [subView, setSubView] = useState<'files' | 'preview'>(
    isWebsiteSprint && (isExecuting || tbwo.status === 'completed') ? 'preview' : 'files'
  );
  const artifactCount = tbwo.artifacts?.length || 0;
  const htmlArtifacts = (tbwo.artifacts || []).filter(a => (a.path || '').endsWith('.html'));
  const totalExpected = tbwo.plan?.phases?.reduce((sum, p) => sum + (p.tasks?.length || 0), 0) || 0;

  return (
    <div className="space-y-4">
      {/* Sub-view toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSubView('files')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            subView === 'files'
              ? 'bg-brand-primary text-white'
              : 'bg-background-tertiary text-text-secondary hover:text-text-primary'
          }`}
        >
          Files {artifactCount > 0 && `(${artifactCount})`}
        </button>
        {isWebsiteSprint && (
          <button
            onClick={() => setSubView('preview')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              subView === 'preview'
                ? 'bg-brand-primary text-white'
                : 'bg-background-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            Preview {htmlArtifacts.length > 0 && `(${htmlArtifacts.length} pages)`}
          </button>
        )}
        {isExecuting && (
          <div className="ml-auto flex items-center gap-2 text-xs text-text-tertiary">
            <div className="h-2 w-2 animate-pulse rounded-full bg-brand-primary" />
            <span>Building... {artifactCount}/{totalExpected > 0 ? totalExpected : '?'} files</span>
          </div>
        )}
      </div>

      {subView === 'files' ? (
        <ArtifactsTab tbwo={tbwo} />
      ) : (
        htmlArtifacts.length > 0 ? (
          <InteractivePreviewTab tbwo={tbwo} />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-3 text-4xl">
              {isExecuting ? '\uD83D\uDEA7' : '\uD83D\uDCC4'}
            </div>
            <h3 className="text-sm font-medium text-text-primary">
              {isExecuting ? 'Building pages...' : 'No HTML files yet'}
            </h3>
            <p className="mt-1 text-xs text-text-tertiary">
              {isExecuting
                ? 'Preview will appear once pods create HTML files'
                : 'Start execution to generate pages'}
            </p>
          </div>
        )
      )}
    </div>
  );
}
