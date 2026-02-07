/**
 * Progress - Professional Progress Indicator Components
 *
 * Features:
 * - Linear progress bar
 * - Circular progress
 * - Multiple variants (default, success, warning, error)
 * - Animated
 * - Labels
 * - Indeterminate state
 */

import { forwardRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@utils/cn';

// ============================================================================
// PROGRESS BAR
// ============================================================================

const progressBarVariants = cva(
  'h-full rounded-full transition-all',
  {
    variants: {
      variant: {
        default: 'bg-brand-primary',
        success: 'bg-green-500',
        warning: 'bg-yellow-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        gradient: 'bg-gradient-to-r from-brand-primary to-brand-secondary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

interface ProgressBarProps extends VariantProps<typeof progressBarVariants> {
  value: number;
  max?: number;
  showValue?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  indeterminate?: boolean;
  label?: string;
  className?: string;
  animate?: boolean;
  glow?: boolean;
}

const sizeMap = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
};

export function ProgressBar({
  value,
  max = 100,
  showValue = false,
  size = 'md',
  variant = 'default',
  indeterminate = false,
  label,
  className,
  animate = true,
  glow = false,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={cn('w-full', className)}>
      {/* Label and Value */}
      {(label || showValue) && (
        <div className="mb-1.5 flex items-center justify-between text-sm">
          {label && <span className="text-text-secondary">{label}</span>}
          {showValue && (
            <span className="font-medium text-text-primary">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      )}

      {/* Bar */}
      <div
        className={cn(
          'overflow-hidden rounded-full bg-background-tertiary',
          sizeMap[size]
        )}
      >
        {indeterminate ? (
          <motion.div
            className={cn(progressBarVariants({ variant }), 'w-1/3')}
            animate={{
              x: ['-100%', '400%'],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ) : animate ? (
          <motion.div
            className={cn(
              progressBarVariants({ variant }),
              glow && 'shadow-glow'
            )}
            initial={{ width: 0 }}
            animate={{ width: `${percentage}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        ) : (
          <div
            className={cn(progressBarVariants({ variant }))}
            style={{ width: `${percentage}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CIRCULAR PROGRESS
// ============================================================================

interface CircularProgressProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  showValue?: boolean;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  label?: string;
  className?: string;
}

const circularVariantColors: Record<string, string> = {
  default: 'stroke-brand-primary',
  success: 'stroke-green-500',
  warning: 'stroke-yellow-500',
  error: 'stroke-red-500',
  info: 'stroke-blue-500',
};

export function CircularProgress({
  value,
  max = 100,
  size = 48,
  strokeWidth = 4,
  showValue = true,
  variant = 'default',
  label,
  className,
}: CircularProgressProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className={cn('relative inline-flex flex-col items-center', className)}>
      <svg
        width={size}
        height={size}
        className="-rotate-90"
      >
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-background-tertiary"
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={circularVariantColors[variant]}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{
            strokeDasharray: circumference,
          }}
        />
      </svg>

      {/* Center Value */}
      {showValue && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-semibold text-text-primary">
            {Math.round(percentage)}%
          </span>
        </div>
      )}

      {/* Label */}
      {label && (
        <span className="mt-2 text-xs text-text-tertiary">{label}</span>
      )}
    </div>
  );
}

// ============================================================================
// STEP PROGRESS
// ============================================================================

interface Step {
  id: string;
  label: string;
  description?: string;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
  variant?: 'default' | 'success' | 'error';
  className?: string;
}

export function StepProgress({
  steps,
  currentStep,
  variant = 'default',
  className,
}: StepProgressProps) {
  const variantColor = variant === 'success' ? 'bg-green-500' : variant === 'error' ? 'bg-red-500' : 'bg-brand-primary';

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-center">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          const isLast = index === steps.length - 1;

          return (
            <div key={step.id} className="flex flex-1 items-center">
              {/* Step Indicator */}
              <div className="flex flex-col items-center">
                <motion.div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors',
                    isCompleted
                      ? `${variantColor} text-white`
                      : isCurrent
                        ? 'border-2 border-brand-primary bg-brand-primary/10 text-brand-primary'
                        : 'border-2 border-border-primary bg-background-tertiary text-text-tertiary'
                  )}
                  initial={false}
                  animate={isCompleted ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.3 }}
                >
                  {isCompleted ? (
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </motion.div>
                <span className={cn(
                  'mt-2 text-xs font-medium',
                  isCompleted || isCurrent ? 'text-text-primary' : 'text-text-tertiary'
                )}>
                  {step.label}
                </span>
                {step.description && (
                  <span className="text-xs text-text-quaternary">{step.description}</span>
                )}
              </div>

              {/* Connector Line */}
              {!isLast && (
                <div className="mx-2 h-0.5 flex-1 bg-background-tertiary">
                  <motion.div
                    className={cn('h-full', variantColor)}
                    initial={{ width: 0 }}
                    animate={{ width: isCompleted ? '100%' : '0%' }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// MULTI-SEGMENT PROGRESS
// ============================================================================

interface Segment {
  value: number;
  color: string;
  label?: string;
}

interface MultiProgressProps {
  segments: Segment[];
  total?: number;
  size?: 'sm' | 'md' | 'lg';
  showLegend?: boolean;
  className?: string;
}

export function MultiProgress({
  segments,
  total,
  size = 'md',
  showLegend = false,
  className,
}: MultiProgressProps) {
  const computedTotal = total || segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className={cn('w-full', className)}>
      {/* Bar */}
      <div className={cn('flex overflow-hidden rounded-full bg-background-tertiary', sizeMap[size])}>
        {segments.map((segment, index) => {
          const width = (segment.value / computedTotal) * 100;
          return (
            <motion.div
              key={index}
              className="h-full"
              style={{ backgroundColor: segment.color }}
              initial={{ width: 0 }}
              animate={{ width: `${width}%` }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            />
          );
        })}
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="mt-3 flex flex-wrap gap-4">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-xs text-text-secondary">
                {segment.label || `Segment ${index + 1}`}
              </span>
              <span className="text-xs font-medium text-text-primary">
                {Math.round((segment.value / computedTotal) * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SKELETON LOADER
// ============================================================================

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

const roundedMap = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export function Skeleton({
  className,
  width,
  height,
  rounded = 'md',
}: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse bg-background-tertiary',
        roundedMap[rounded],
        className
      )}
      style={{ width, height }}
    />
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={16}
          className={cn(i === lines - 1 && 'w-3/4')}
        />
      ))}
    </div>
  );
}
