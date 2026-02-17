/**
 * Tooltip - Professional Tooltip Component
 *
 * Features:
 * - Multiple positions
 * - Delay options
 * - Custom content
 * - Arrow indicator
 * - Keyboard accessible
 */

import { ReactNode, useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@utils/cn';

// ============================================================================
// TOOLTIP TYPES
// ============================================================================

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: TooltipPosition;
  delay?: number;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  showArrow?: boolean;
}

// ============================================================================
// POSITION STYLES
// ============================================================================

const positionStyles: Record<TooltipPosition, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
};

const arrowStyles: Record<TooltipPosition, string> = {
  top: 'bottom-[-4px] left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-background-elevated',
  bottom: 'top-[-4px] left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-background-elevated',
  left: 'right-[-4px] top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-background-elevated',
  right: 'left-[-4px] top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-background-elevated',
};

const motionVariants: Record<TooltipPosition, { initial: object; animate: object; exit: object }> = {
  top: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
  },
  bottom: {
    initial: { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
  left: {
    initial: { opacity: 0, x: 4 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 4 },
  },
  right: {
    initial: { opacity: 0, x: -4 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -4 },
  },
};

// ============================================================================
// TOOLTIP COMPONENT
// ============================================================================

export function Tooltip({
  content,
  children,
  position = 'top',
  delay = 200,
  className,
  contentClassName,
  disabled = false,
  showArrow = true,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = () => {
    if (disabled) return;
    timeoutRef.current = setTimeout(() => setIsVisible(true), delay);
  };

  const hideTooltip = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn('relative inline-flex', className)}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}

      <AnimatePresence>
        {isVisible && (
          <motion.div
            className={cn(
              'pointer-events-none absolute z-tooltip whitespace-nowrap rounded-lg bg-background-elevated px-3 py-2 text-sm text-text-primary shadow-lg border border-border-primary',
              positionStyles[position],
              contentClassName
            )}
            initial={motionVariants[position].initial}
            animate={motionVariants[position].animate}
            exit={motionVariants[position].exit}
            transition={{ duration: 0.15 }}
          >
            {content}

            {/* Arrow */}
            {showArrow && (
              <div
                className={cn(
                  'absolute h-0 w-0 border-4',
                  arrowStyles[position]
                )}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// SIMPLE TOOLTIP (for inline use)
// ============================================================================

interface SimpleTooltipProps {
  text: string;
  children: ReactNode;
  position?: TooltipPosition;
}

export function SimpleTooltip({ text, children, position = 'top' }: SimpleTooltipProps) {
  return (
    <Tooltip content={text} position={position}>
      {children}
    </Tooltip>
  );
}

// ============================================================================
// INFO TOOLTIP (with icon)
// ============================================================================

interface InfoTooltipProps {
  content: ReactNode;
  position?: TooltipPosition;
  className?: string;
}

export function InfoTooltip({ content, position = 'top', className }: InfoTooltipProps) {
  return (
    <Tooltip content={content} position={position}>
      <button
        type="button"
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded-full bg-background-tertiary text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-secondary',
          className
        )}
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </button>
    </Tooltip>
  );
}

// ============================================================================
// KEYBOARD SHORTCUT TOOLTIP
// ============================================================================

interface ShortcutTooltipProps {
  label: string;
  shortcut: string;
  children: ReactNode;
  position?: TooltipPosition;
}

export function ShortcutTooltip({ label, shortcut, children, position = 'bottom' }: ShortcutTooltipProps) {
  return (
    <Tooltip
      position={position}
      content={
        <div className="flex items-center gap-2">
          <span>{label}</span>
          <kbd className="rounded bg-background-tertiary px-1.5 py-0.5 text-xs font-medium text-text-secondary">
            {shortcut}
          </kbd>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}
