/**
 * Button - Reusable Button Component
 * 
 * Features:
 * - Multiple variants (primary, secondary, ghost, danger)
 * - Multiple sizes (sm, md, lg)
 * - Loading state
 * - Disabled state
 * - Icon support (left/right)
 * - Full width option
 * - Keyboard accessible
 */

import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@utils/cn';

// ============================================================================
// BUTTON VARIANTS
// ============================================================================

const buttonVariants = cva(
  // Base styles
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background-primary disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-primary text-white hover:bg-brand-primary-hover active:bg-brand-primary-active shadow-sm hover:shadow',
        secondary:
          'bg-background-elevated text-text-primary hover:bg-background-hover active:bg-background-active border border-border-primary',
        ghost:
          'text-text-primary hover:bg-background-hover active:bg-background-active',
        danger:
          'bg-semantic-error text-white hover:bg-semantic-error/90 active:bg-semantic-error/80 shadow-sm',
        success:
          'bg-semantic-success text-white hover:bg-semantic-success/90 active:bg-semantic-success/80 shadow-sm',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
      },
      fullWidth: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

// ============================================================================
// BUTTON COMPONENT
// ============================================================================

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      fullWidth,
      leftIcon,
      rightIcon,
      loading,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <motion.button
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth, className }))}
        disabled={disabled || loading}
        whileTap={{ scale: 0.98 }}
        {...(props as any)}
      >
        {/* Loading Spinner */}
        {loading && (
          <svg
            className="h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        
        {/* Left Icon */}
        {!loading && leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
        
        {/* Children */}
        {children}
        
        {/* Right Icon */}
        {!loading && rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
