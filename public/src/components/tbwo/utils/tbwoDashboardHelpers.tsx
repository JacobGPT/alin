import React from 'react';
import { motion } from 'framer-motion';
import {
  PlusIcon,
  RocketLaunchIcon,
  SparklesIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@components/ui/Button';
import type { TBWO } from '../../../types/tbwo';

export type TabId = 'overview' | 'plan' | 'pods' | 'activity' | 'pause_ask' |
  'artifacts' | 'report' | 'preview' | 'conversion' | 'improve' | 'motion' |
  'scene3d' | 'cognitive' | 'receipts';

export function EmptyDetailView({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary"
      >
        <RocketLaunchIcon className="h-12 w-12 text-white" />
      </motion.div>
      <h2 className="mb-2 text-2xl font-bold text-text-primary">
        Select a Work Order
      </h2>
      <p className="mb-6 max-w-md text-text-tertiary">
        Choose a TBWO from the list to view details, monitor progress, and manage execution.
        Or create a new one to get started.
      </p>
      <Button variant="primary" onClick={onCreateNew} leftIcon={<PlusIcon className="h-4 w-4" />}>
        Create New TBWO
      </Button>
    </div>
  );
}

export function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
        danger
          ? 'text-semantic-error hover:bg-semantic-error/10'
          : 'text-text-primary hover:bg-background-hover'
      }`}
    >
      <span className="h-4 w-4">{icon}</span>
      {label}
    </button>
  );
}

export function QuickStat({
  label,
  value,
  color = 'text-text-primary',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-text-tertiary">{label}</p>
    </div>
  );
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SEOPreviewCard({ tbwo }: { tbwo: TBWO }) {
  const artifacts = tbwo.artifacts || [];
  const htmlArtifacts = artifacts.filter(a => (a.path || '').endsWith('.html'));

  if (htmlArtifacts.length === 0) return null;

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
      <h3 className="mb-4 font-semibold text-text-primary">SEO Preview</h3>
      <div className="space-y-4">
        {htmlArtifacts.slice(0, 5).map((art) => {
          const content = typeof art.content === 'string' ? art.content : '';
          const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const metaMatch = content.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i);
          const title = titleMatch ? titleMatch[1].trim() : 'Untitled';
          const description = metaMatch ? metaMatch[1] : 'No meta description set';
          const pageName = (art.path || '').split('/').pop() || 'page';
          const url = `https://example.com/${pageName === 'index.html' ? '' : pageName.replace('.html', '')}`;

          const titleTooLong = title.length > 60;
          const descTooLong = description.length > 160;

          return (
            <div key={art.id} className="rounded-lg border border-border-primary p-3">
              {/* Google-style preview */}
              <div className="space-y-0.5">
                <p className="text-xs text-green-500 font-mono">{url}</p>
                <p className={`text-base ${titleTooLong ? 'text-red-400' : 'text-blue-400'}`}>
                  {title}{titleTooLong && <span className="text-xs text-red-400 ml-1">({title.length}/60)</span>}
                </p>
                <p className={`text-sm ${descTooLong ? 'text-red-300' : 'text-text-tertiary'}`}>
                  {description.slice(0, 160)}{descTooLong && '...'}
                  {descTooLong && <span className="text-xs text-red-400 ml-1">({description.length}/160)</span>}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MotionBadge({ motionValidation, onNavigate }: { motionValidation: { score: number; passed: boolean; reducedMotionCompliant: boolean }; onNavigate?: (tab: TabId) => void }) {
  const mv = motionValidation;
  const scoreColor = mv.score >= 80 ? 'text-green-400' : mv.score >= 60 ? 'text-yellow-400' : 'text-red-400';
  const bgColor = mv.score >= 80 ? 'bg-green-400/10 border-green-400/30' : mv.score >= 60 ? 'bg-yellow-400/10 border-yellow-400/30' : 'bg-red-400/10 border-red-400/30';
  return (
    <div className={`mt-3 flex items-center gap-3 rounded-lg border p-3 ${bgColor}`}>
      <SparklesIcon className={`h-5 w-5 ${scoreColor}`} />
      <div>
        <p className={`text-sm font-semibold ${scoreColor}`}>Motion Score: {mv.score}/100</p>
        <p className="text-xs text-text-tertiary">
          {mv.passed ? 'Passed' : 'Failed'}
          {mv.reducedMotionCompliant && ' \u00b7 Reduced motion compliant'}
        </p>
      </div>
      {onNavigate && (
        <button onClick={() => onNavigate('motion')} className="ml-auto text-xs font-medium text-brand-primary hover:underline">
          View Report
        </button>
      )}
    </div>
  );
}

export function SceneBadge({ sceneValidation, onNavigate }: { sceneValidation: { score: number; passed: boolean; reducedMotionCompliant: boolean }; onNavigate?: (tab: TabId) => void }) {
  const sv = sceneValidation;
  const scoreColor = sv.score >= 80 ? 'text-green-400' : sv.score >= 60 ? 'text-yellow-400' : 'text-red-400';
  const bgColor = sv.score >= 80 ? 'bg-green-400/10 border-green-400/30' : sv.score >= 60 ? 'bg-yellow-400/10 border-yellow-400/30' : 'bg-red-400/10 border-red-400/30';
  return (
    <div className={`mt-3 flex items-center gap-3 rounded-lg border p-3 ${bgColor}`}>
      <CpuChipIcon className={`h-5 w-5 ${scoreColor}`} />
      <div>
        <p className={`text-sm font-semibold ${scoreColor}`}>3D Scene Score: {sv.score}/100</p>
        <p className="text-xs text-text-tertiary">
          {sv.passed ? 'Passed' : 'Failed'}
          {sv.reducedMotionCompliant && ' \u00b7 Reduced motion compliant'}
        </p>
      </div>
      {onNavigate && (
        <button onClick={() => onNavigate('scene3d')} className="ml-auto text-xs font-medium text-brand-primary hover:underline">
          View Report
        </button>
      )}
    </div>
  );
}
