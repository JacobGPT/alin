import React from 'react';
import {
  DocumentDuplicateIcon,
  SparklesIcon,
  ClockIcon,
  PlayCircleIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
  QuestionMarkCircleIcon,
  ArrowPathIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';
import { QualityTarget } from '../../../types/tbwo';

export const POD_ROLE_ICONS: Record<string, React.ReactNode> = {
  orchestrator: <span>🎯</span>,
  design: <span>🎨</span>,
  frontend: <span>💻</span>,
  backend: <span>⚙️</span>,
  motion: <span>✨</span>,
  copy: <span>📝</span>,
  qa: <span>🔍</span>,
  devops: <span>🚀</span>,
  deployment: <span>🚀</span>,
  research: <span>🔬</span>,
};

export const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  draft: {
    color: 'text-text-tertiary',
    bgColor: 'bg-background-tertiary',
    icon: <DocumentDuplicateIcon className="h-4 w-4" />,
    label: 'Draft',
  },
  planning: {
    color: 'text-brand-secondary',
    bgColor: 'bg-brand-secondary/10',
    icon: <SparklesIcon className="h-4 w-4" />,
    label: 'Planning',
  },
  awaiting_approval: {
    color: 'text-semantic-warning',
    bgColor: 'bg-semantic-warning/10',
    icon: <ClockIcon className="h-4 w-4" />,
    label: 'Awaiting Approval',
  },
  executing: {
    color: 'text-brand-primary',
    bgColor: 'bg-brand-primary/10',
    icon: <PlayCircleIcon className="h-4 w-4" />,
    label: 'Executing',
  },
  checkpoint: {
    color: 'text-semantic-warning',
    bgColor: 'bg-semantic-warning/10',
    icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    label: 'Checkpoint',
  },
  paused: {
    color: 'text-text-tertiary',
    bgColor: 'bg-background-tertiary',
    icon: <PauseCircleIcon className="h-4 w-4" />,
    label: 'Paused',
  },
  paused_waiting_for_user: {
    color: 'text-semantic-warning',
    bgColor: 'bg-semantic-warning/10',
    icon: <QuestionMarkCircleIcon className="h-4 w-4" />,
    label: 'Needs Input',
  },
  completing: {
    color: 'text-semantic-success',
    bgColor: 'bg-semantic-success/10',
    icon: <ArrowPathIcon className="h-4 w-4 animate-spin" />,
    label: 'Completing',
  },
  completed: {
    color: 'text-semantic-success',
    bgColor: 'bg-semantic-success/10',
    icon: <CheckCircleSolid className="h-4 w-4" />,
    label: 'Completed',
  },
  cancelled: {
    color: 'text-semantic-error',
    bgColor: 'bg-semantic-error/10',
    icon: <XCircleIcon className="h-4 w-4" />,
    label: 'Cancelled',
  },
  failed: {
    color: 'text-semantic-error',
    bgColor: 'bg-semantic-error/10',
    icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    label: 'Failed',
  },
};

export const QUALITY_BADGES: Record<QualityTarget, { color: string; label: string }> = {
  [QualityTarget.DRAFT]: { color: 'bg-gray-500', label: 'Draft' },
  [QualityTarget.STANDARD]: { color: 'bg-blue-500', label: 'Standard' },
  [QualityTarget.PREMIUM]: { color: 'bg-purple-500', label: 'Premium' },
  [QualityTarget.APPLE_LEVEL]: { color: 'bg-gradient-to-r from-indigo-500 to-violet-500', label: 'Maximum' },
};
