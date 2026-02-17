/**
 * ThinkingPanel - Real-time AI Reasoning Display
 *
 * Features:
 * - Shows AI's step-by-step thinking
 * - Dynamic progress based on actual task phases
 * - Tool use indicators
 * - Collapsible/expandable
 * - Animated transitions
 */

import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  CpuChipIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  CircleStackIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowPathIcon,
  GlobeAltIcon,
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { useState, useEffect } from 'react';
import { useStatusStore, TaskPhase, PHASE_MESSAGES } from '@store/statusStore';

// ============================================================================
// PHASE ICONS
// ============================================================================

const PHASE_ICONS: Record<TaskPhase, React.ComponentType<{ className?: string }>> = {
  idle: SparklesIcon,
  understanding: LightBulbIcon,
  thinking: CpuChipIcon,
  searching: GlobeAltIcon,
  remembering: CircleStackIcon,
  executing: ArrowPathIcon,
  coding: CodeBracketIcon,
  writing: DocumentTextIcon,
  reading: DocumentTextIcon,
  analyzing: MagnifyingGlassIcon,
  responding: ChatBubbleLeftRightIcon,
  tool_use: CpuChipIcon,
  error: ExclamationCircleIcon,
};

const PHASE_COLORS: Record<TaskPhase, string> = {
  idle: 'text-text-tertiary',
  understanding: 'text-blue-400',
  thinking: 'text-purple-400',
  searching: 'text-green-400',
  remembering: 'text-amber-400',
  executing: 'text-cyan-400',
  coding: 'text-pink-400',
  writing: 'text-orange-400',
  reading: 'text-teal-400',
  analyzing: 'text-indigo-400',
  responding: 'text-brand-primary',
  tool_use: 'text-yellow-400',
  error: 'text-red-400',
};

// ============================================================================
// THINKINGPANEL COMPONENT
// ============================================================================

export function ThinkingPanel() {
  const [isExpanded, setIsExpanded] = useState(true);
  const [shouldShow, setShouldShow] = useState(false);

  const {
    isProcessing,
    currentPhase,
    currentMessage,
    steps,
    activeTool,
    activeModel,
    reset,
  } = useStatusStore();

  // Show panel when processing starts, hide after completion with delay
  useEffect(() => {
    if (isProcessing) {
      setShouldShow(true);
    } else if (shouldShow && !isProcessing) {
      // Auto-hide and clear after 3 seconds when processing completes
      const timer = setTimeout(() => {
        setShouldShow(false);
        reset(); // Clear steps for next time
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isProcessing, shouldShow, reset]);

  // Don't render if shouldn't show
  if (!shouldShow) {
    return null;
  }

  const CurrentIcon = PHASE_ICONS[currentPhase] || SparklesIcon;
  const currentColor = PHASE_COLORS[currentPhase] || 'text-brand-primary';

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="border-t border-border-primary bg-background-elevated"
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-background-hover"
      >
        <div className="flex items-center gap-3">
          <CurrentIcon className={`h-5 w-5 ${currentColor} ${isProcessing ? 'animate-pulse' : ''}`} />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">
              {currentMessage}
            </span>
            {activeTool && (
              <span className="text-xs text-text-tertiary">
                Tool: {activeTool.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-quaternary">
            {activeModel}
          </span>
          {isExpanded ? (
            <ChevronDownIcon className="h-4 w-4 text-text-tertiary" />
          ) : (
            <ChevronUpIcon className="h-4 w-4 text-text-tertiary" />
          )}
        </div>
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && steps.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border-primary px-6 py-4"
          >
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {steps.map((step, index) => {
                const StepIcon = PHASE_ICONS[step.phase] || SparklesIcon;
                const stepColor = PHASE_COLORS[step.phase] || 'text-text-tertiary';

                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex items-start gap-3"
                  >
                    {/* Status indicator */}
                    <div className="mt-0.5 flex-shrink-0">
                      {step.completed ? (
                        step.error ? (
                          <ExclamationCircleIcon className="h-4 w-4 text-red-400" />
                        ) : (
                          <CheckCircleIcon className="h-4 w-4 text-green-400" />
                        )
                      ) : (
                        <StepIcon className={`h-4 w-4 ${stepColor} animate-pulse`} />
                      )}
                    </div>

                    {/* Step content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${step.completed && !step.error ? 'text-text-tertiary' : 'text-text-secondary'}`}>
                        {step.message}
                      </p>
                      {step.detail && (
                        <p className="text-xs text-text-quaternary truncate mt-0.5">
                          {step.detail}
                        </p>
                      )}
                      {step.error && (
                        <p className="text-xs text-red-400 mt-0.5">
                          {step.error}
                        </p>
                      )}
                    </div>

                    {/* Timestamp */}
                    <span className="text-xs text-text-quaternary flex-shrink-0">
                      {formatTime(step.timestamp)}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================================
// COMPACT STATUS INDICATOR (for use in other places)
// ============================================================================

export function StatusIndicator() {
  const { isProcessing, currentPhase, currentMessage } = useStatusStore();

  if (!isProcessing) return null;

  const Icon = PHASE_ICONS[currentPhase] || SparklesIcon;
  const color = PHASE_COLORS[currentPhase] || 'text-brand-primary';

  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`h-4 w-4 ${color} animate-pulse`} />
      <span className="text-text-secondary">{currentMessage}</span>
    </div>
  );
}
