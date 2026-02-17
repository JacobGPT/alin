/**
 * Card - Professional Card Component
 *
 * Features:
 * - Multiple variants (default, elevated, outlined, ghost)
 * - Hover effects
 * - Clickable state
 * - Header/content/footer sections
 * - Gradient borders
 */

import { HTMLAttributes, ReactNode, forwardRef } from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@utils/cn';

// ============================================================================
// CARD VARIANTS
// ============================================================================

const cardVariants = cva(
  'rounded-xl transition-all duration-200',
  {
    variants: {
      variant: {
        default: 'bg-background-secondary border border-border-primary',
        elevated: 'bg-background-elevated shadow-lg border border-border-primary',
        outlined: 'bg-transparent border-2 border-border-primary',
        ghost: 'bg-transparent',
        gradient: 'bg-background-secondary border border-transparent bg-gradient-to-br from-background-secondary to-background-tertiary',
        glass: 'bg-background-secondary/80 backdrop-blur-xl border border-border-primary/50',
      },
      padding: {
        none: 'p-0',
        sm: 'p-3',
        md: 'p-4',
        lg: 'p-6',
        xl: 'p-8',
      },
      interactive: {
        true: 'cursor-pointer hover:border-border-secondary hover:shadow-md active:scale-[0.99]',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      padding: 'md',
      interactive: false,
    },
  }
);

// ============================================================================
// CARD COMPONENT
// ============================================================================

export interface CardProps
  extends HTMLMotionProps<'div'>,
    VariantProps<typeof cardVariants> {
  children: ReactNode;
  glow?: boolean;
  glowColor?: string;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, interactive, glow, glowColor, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          cardVariants({ variant, padding, interactive }),
          glow && 'shadow-glow',
          className
        )}
        style={glow && glowColor ? { boxShadow: `0 0 30px ${glowColor}20` } : undefined}
        whileHover={interactive ? { y: -2 } : undefined}
        whileTap={interactive ? { scale: 0.99 } : undefined}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

// ============================================================================
// CARD HEADER
// ============================================================================

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export function CardHeader({ title, subtitle, action, icon, className, children, ...props }: CardHeaderProps) {
  if (children) {
    return (
      <div className={cn('mb-4', className)} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn('mb-4 flex items-start justify-between gap-4', className)} {...props}>
      <div className="flex items-start gap-3">
        {icon && (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
            {icon}
          </div>
        )}
        <div>
          {title && <h3 className="font-semibold text-text-primary">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-sm text-text-tertiary">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

// ============================================================================
// CARD CONTENT
// ============================================================================

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn('', className)} {...props}>
      {children}
    </div>
  );
}

// ============================================================================
// CARD FOOTER
// ============================================================================

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
  bordered?: boolean;
}

export function CardFooter({ className, bordered, children, ...props }: CardFooterProps) {
  return (
    <div
      className={cn(
        'mt-4 flex items-center justify-end gap-2',
        bordered && 'border-t border-border-primary pt-4',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ============================================================================
// STAT CARD
// ============================================================================

interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

export function StatCard({ label, value, change, changeLabel, icon, trend, className }: StatCardProps) {
  const trendColor = trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-text-tertiary';
  const trendBg = trend === 'up' ? 'bg-green-500/10' : trend === 'down' ? 'bg-red-500/10' : 'bg-background-tertiary';

  return (
    <Card className={className}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-text-tertiary">{label}</p>
          <p className="mt-1 text-2xl font-bold text-text-primary">{value}</p>
          {change !== undefined && (
            <div className="mt-2 flex items-center gap-1">
              <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-medium', trendBg, trendColor)}>
                {trend === 'up' && '+'}{change}%
              </span>
              {changeLabel && <span className="text-xs text-text-quaternary">{changeLabel}</span>}
            </div>
          )}
        </div>
        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// FEATURE CARD
// ============================================================================

interface FeatureCardProps {
  title: string;
  description: string;
  icon: ReactNode;
  badge?: string;
  onClick?: () => void;
  className?: string;
}

export function FeatureCard({ title, description, icon, badge, onClick, className }: FeatureCardProps) {
  return (
    <Card
      variant="default"
      interactive={!!onClick}
      onClick={onClick}
      className={cn('group', className)}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-primary to-brand-secondary text-white transition-transform group-hover:scale-110">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-text-primary">{title}</h4>
            {badge && (
              <span className="rounded-full bg-brand-primary/10 px-2 py-0.5 text-xs font-medium text-brand-primary">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-tertiary line-clamp-2">{description}</p>
        </div>
      </div>
    </Card>
  );
}
