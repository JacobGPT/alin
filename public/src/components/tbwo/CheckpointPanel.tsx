/**
 * Checkpoint Panel - TBWO Checkpoint Approval Interface
 *
 * Displays when a TBWO reaches a checkpoint and requires user approval.
 * Provides options to continue, pause, cancel, or provide feedback.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  XCircleIcon,
  ChevronRightIcon,
  EyeIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';

// Store
import { useTBWOStore } from '@store/tbwoStore';

// Components
import { Button } from '@components/ui/Button';

// Types
import type { TBWO, Checkpoint, CheckpointDecision } from '../../types/tbwo';

// ============================================================================
// CHECKPOINT PANEL COMPONENT
// ============================================================================

interface CheckpointPanelProps {
  tbwo: TBWO;
}

export function CheckpointPanel({ tbwo }: CheckpointPanelProps) {
  const [feedback, setFeedback] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const respondToCheckpoint = useTBWOStore((state) => state.respondToCheckpoint);

  // Find the active checkpoint
  const activeCheckpoint = tbwo.checkpoints.find(
    (c) => c.status === 'reached' && !c.decidedAt
  );

  // Browser notification when checkpoint is reached
  useEffect(() => {
    if (activeCheckpoint && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('ALIN - Checkpoint Reached', {
          body: `${activeCheckpoint.name}: ${activeCheckpoint.description}`,
          icon: '/favicon.ico',
        });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, [activeCheckpoint?.id]);

  if (!activeCheckpoint) {
    return null;
  }

  const handleDecision = async (action: CheckpointDecision['action']) => {
    setIsSubmitting(true);

    const decision: CheckpointDecision = {
      action,
      feedback: feedback.trim() || undefined,
      decidedBy: 'user',
      timestamp: Date.now(),
    };

    respondToCheckpoint(activeCheckpoint.id, decision);
    setIsSubmitting(false);
    setFeedback('');
  };

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="border-t border-semantic-warning bg-semantic-warning/5"
    >
      {/* Warning Banner */}
      <div className="flex items-center gap-3 border-b border-semantic-warning/20 bg-semantic-warning/10 px-6 py-3">
        <ExclamationTriangleIcon className="h-5 w-5 text-semantic-warning" />
        <span className="font-medium text-semantic-warning">
          Checkpoint Reached - Your Approval Required
        </span>
      </div>

      {/* Main Content */}
      <div className="p-6">
        <div className="flex gap-6">
          {/* Left - Checkpoint Info */}
          <div className="flex-1">
            <h3 className="mb-2 text-lg font-bold text-text-primary">
              {activeCheckpoint.name}
            </h3>
            <p className="mb-4 text-text-secondary">
              {activeCheckpoint.description}
            </p>

            {/* What was accomplished */}
            <div className="mb-4">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-2 text-sm font-medium text-brand-primary hover:underline"
              >
                <EyeIcon className="h-4 w-4" />
                {showDetails ? 'Hide' : 'View'} what was completed
                <ChevronRightIcon
                  className={`h-4 w-4 transition-transform ${showDetails ? 'rotate-90' : ''}`}
                />
              </button>

              {showDetails && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="mt-3 rounded-lg bg-background-secondary p-4"
                >
                  <h4 className="mb-2 text-sm font-semibold text-text-primary">
                    Completed Items:
                  </h4>
                  <ul className="space-y-1 text-sm text-text-secondary">
                    {activeCheckpoint.outputs?.map((output, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircleIcon className="h-4 w-4 text-semantic-success" />
                        {output}
                      </li>
                    )) || <li>No specific outputs recorded</li>}
                  </ul>

                  {/* Artifacts preview */}
                  {tbwo.artifacts.length > 0 && (
                    <div className="mt-4">
                      <h4 className="mb-2 text-sm font-semibold text-text-primary">
                        Artifacts Created:
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {tbwo.artifacts.slice(0, 5).map((artifact) => (
                          <span
                            key={artifact.id}
                            className="rounded-full bg-background-tertiary px-3 py-1 text-xs text-text-secondary"
                          >
                            {artifact.name}
                          </span>
                        ))}
                        {tbwo.artifacts.length > 5 && (
                          <span className="text-xs text-text-tertiary">
                            +{tbwo.artifacts.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>

            {/* Feedback Input */}
            <div className="mb-4">
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
                <ChatBubbleLeftRightIcon className="h-4 w-4" />
                Feedback (optional)
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Provide feedback, adjustments, or concerns..."
                className="h-24 w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-3 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
              />
            </div>

            {/* Progress Info */}
            <div className="flex items-center gap-6 text-sm text-text-tertiary">
              <div>
                <span className="font-medium text-text-primary">{Math.round(tbwo.progress)}%</span>
                {' '}complete
              </div>
              <div>
                <span className="font-medium text-text-primary">{Math.round(tbwo.timeBudget.remaining)}</span>
                {' '}min remaining
              </div>
              <div>
                <span className="font-medium text-text-primary">{tbwo.pods.size}</span>
                {' '}active pods
              </div>
            </div>
          </div>

          {/* Right - Decision Buttons */}
          <div className="flex w-64 flex-col gap-3">
            <Button
              variant="primary"
              fullWidth
              loading={isSubmitting}
              onClick={() => handleDecision('continue')}
              leftIcon={<CheckCircleIcon className="h-5 w-5" />}
            >
              Continue Execution
            </Button>

            <Button
              variant="secondary"
              fullWidth
              disabled={isSubmitting}
              onClick={() => handleDecision('continue_with_changes')}
              leftIcon={<ChevronRightIcon className="h-5 w-5" />}
            >
              Continue with Feedback
            </Button>

            <Button
              variant="ghost"
              fullWidth
              disabled={isSubmitting}
              onClick={() => handleDecision('pause')}
              leftIcon={<PauseCircleIcon className="h-5 w-5" />}
            >
              Pause for Review
            </Button>

            <div className="my-2 border-t border-border-primary" />

            <Button
              variant="danger"
              fullWidth
              disabled={isSubmitting}
              onClick={() => handleDecision('cancel')}
              leftIcon={<XCircleIcon className="h-5 w-5" />}
            >
              Cancel TBWO
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// CHECKPOINT BADGE (for use in other components)
// ============================================================================

export function CheckpointBadge({ checkpoint }: { checkpoint: Checkpoint }) {
  const statusColors = {
    pending: 'bg-background-tertiary text-text-tertiary',
    reached: 'bg-semantic-warning/10 text-semantic-warning',
    approved: 'bg-semantic-success/10 text-semantic-success',
    rejected: 'bg-semantic-error/10 text-semantic-error',
    skipped: 'bg-text-tertiary/10 text-text-tertiary',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[checkpoint.status]}`}>
      {checkpoint.status === 'reached' && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-semantic-warning opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-semantic-warning" />
        </span>
      )}
      {checkpoint.name}
    </span>
  );
}

export default CheckpointPanel;
