/**
 * Badge - Professional Badge/Tag Component
 *
 * Features:
 * - Multiple variants (default, success, warning, error, info)
 * - Multiple sizes
 * - Dot indicator
 * - Removable
 * - Icon support
 * - Animated entrance
 */

import { ReactNode, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon } from '@heroicons/react/20/solid';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@utils/cn';

// ============================================================================
// BADGE VARIANTS
// ============================================================================

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-background-tertiary text-text-secondary',
        primary: 'bg-brand-primary/10 text-brand-primary',
        secondary: 'bg-purple-500/10 text-purple-400',
        success: 'bg-green-500/10 text-green-400',
        warning: 'bg-yellow-500/10 text-yellow-400',
        error: 'bg-red-500/10 text-red-400',
        info: 'bg-blue-500/10 text-blue-400',
        neutral: 'bg-gray-500/10 text-gray-400',
      },
      size: {
        xs: 'px-1.5 py-0.5 text-[10px] rounded',
        sm: 'px-2 py-0.5 text-xs rounded-md',
        md: 'px-2.5 py-1 text-xs rounded-lg',
        lg: 'px-3 py-1.5 text-sm rounded-lg',
      },
      outlined: {
        true: 'bg-transparent border',
        false: '',
      },
    },
    compoundVariants: [
      { variant: 'default', outlined: true, className: 'border-border-primary' },
      { variant: 'primary', outlined: true, className: 'border-brand-primary/30' },
      { variant: 'secondary', outlined: true, className: 'border-purple-500/30' },
      { variant: 'success', outlined: true, className: 'border-green-500/30' },
      { variant: 'warning', outlined: true, className: 'border-yellow-500/30' },
      { variant: 'error', outlined: true, className: 'border-red-500/30' },
      { variant: 'info', outlined: true, className: 'border-blue-500/30' },
      { variant: 'neutral', outlined: true, className: 'border-gray-500/30' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'sm',
      outlined: false,
    },
  }
);

// ============================================================================
// BADGE COMPONENT
// ============================================================================

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  dot?: boolean;
  dotColor?: string;
  removable?: boolean;
  onRemove?: () => void;
  animate?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, outlined, children, icon, dot, dotColor, removable, onRemove, animate = false }, ref) => {
    const content = (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, size, outlined }), className)}
      >
        {dot && (
          <span
            className={cn('h-1.5 w-1.5 rounded-full', dotColor || 'bg-current')}
          />
        )}
        {icon && <span className="flex-shrink-0">{icon}</span>}
        {children}
        {removable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.();
            }}
            className="ml-0.5 -mr-0.5 rounded-full p-0.5 transition-colors hover:bg-black/10"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        )}
      </span>
    );

    if (animate) {
      return (
        <motion.span
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          className="inline-flex"
        >
          {content}
        </motion.span>
      );
    }

    return content;
  }
);

Badge.displayName = 'Badge';

// ============================================================================
// STATUS BADGE
// ============================================================================

type StatusType = 'online' | 'offline' | 'busy' | 'away' | 'idle' | 'active' | 'inactive' | 'pending' | 'success' | 'error' | 'warning';

const statusConfig: Record<StatusType, { label: string; variant: BadgeProps['variant']; dotColor: string }> = {
  online: { label: 'Online', variant: 'success', dotColor: 'bg-green-400' },
  offline: { label: 'Offline', variant: 'neutral', dotColor: 'bg-gray-400' },
  busy: { label: 'Busy', variant: 'error', dotColor: 'bg-red-400' },
  away: { label: 'Away', variant: 'warning', dotColor: 'bg-yellow-400' },
  idle: { label: 'Idle', variant: 'neutral', dotColor: 'bg-gray-400' },
  active: { label: 'Active', variant: 'success', dotColor: 'bg-green-400' },
  inactive: { label: 'Inactive', variant: 'neutral', dotColor: 'bg-gray-400' },
  pending: { label: 'Pending', variant: 'warning', dotColor: 'bg-yellow-400' },
  success: { label: 'Success', variant: 'success', dotColor: 'bg-green-400' },
  error: { label: 'Error', variant: 'error', dotColor: 'bg-red-400' },
  warning: { label: 'Warning', variant: 'warning', dotColor: 'bg-yellow-400' },
};

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: BadgeProps['size'];
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({ status, label, size = 'sm', showDot = true, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge
      variant={config.variant}
      size={size}
      dot={showDot}
      dotColor={config.dotColor}
      className={className}
    >
      {label || config.label}
    </Badge>
  );
}

// ============================================================================
// BADGE GROUP
// ============================================================================

interface BadgeGroupProps {
  badges: Array<{ id: string; label: string; variant?: BadgeProps['variant'] }>;
  max?: number;
  size?: BadgeProps['size'];
  onRemove?: (id: string) => void;
  className?: string;
}

export function BadgeGroup({ badges, max = 5, size = 'sm', onRemove, className }: BadgeGroupProps) {
  const visible = badges.slice(0, max);
  const overflow = badges.length - max;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <AnimatePresence mode="popLayout">
        {visible.map((badge) => (
          <Badge
            key={badge.id}
            variant={badge.variant}
            size={size}
            removable={!!onRemove}
            onRemove={() => onRemove?.(badge.id)}
            animate
          >
            {badge.label}
          </Badge>
        ))}
        {overflow > 0 && (
          <Badge variant="neutral" size={size} animate>
            +{overflow} more
          </Badge>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// NUMBER BADGE (for notifications, counts, etc.)
// ============================================================================

interface NumberBadgeProps {
  count: number;
  max?: number;
  variant?: BadgeProps['variant'];
  size?: 'sm' | 'md';
  className?: string;
}

export function NumberBadge({ count, max = 99, variant = 'error', size = 'sm', className }: NumberBadgeProps) {
  if (count <= 0) return null;

  const display = count > max ? `${max}+` : count.toString();
  const sizeClasses = size === 'sm'
    ? 'h-5 min-w-5 text-[10px]'
    : 'h-6 min-w-6 text-xs';

  return (
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className={cn(
        'inline-flex items-center justify-center rounded-full font-bold',
        badgeVariants({ variant }),
        sizeClasses,
        className
      )}
    >
      {display}
    </motion.span>
  );
}
