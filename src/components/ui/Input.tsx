/**
 * Input - Reusable Input Component
 * 
 * Features:
 * - Multiple variants
 * - Icon support (left/right)
 * - Error state
 * - Disabled state
 * - Full width option
 * - Character counter
 */

import { InputHTMLAttributes, ReactNode, forwardRef, useState } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@utils/cn';

// ============================================================================
// INPUT VARIANTS
// ============================================================================

const inputVariants = cva(
  'w-full rounded-lg border bg-background-tertiary px-3 py-2 text-sm text-text-primary placeholder:text-text-quaternary transition-colors focus:border-brand-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-border-primary',
        error: 'border-semantic-error focus:border-semantic-error',
      },
      size: {
        sm: 'h-8 text-xs',
        md: 'h-10 text-sm',
        lg: 'h-12 text-base',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

// ============================================================================
// INPUT COMPONENT
// ============================================================================

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: string;
  helperText?: string;
  label?: string;
  showCharacterCount?: boolean;
  maxLength?: number;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      variant,
      size,
      leftIcon,
      rightIcon,
      error,
      helperText,
      label,
      showCharacterCount,
      maxLength,
      value,
      ...props
    },
    ref
  ) => {
    const [characterCount, setCharacterCount] = useState(
      value ? String(value).length : 0
    );
    
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setCharacterCount(e.target.value.length);
      props.onChange?.(e);
    };
    
    return (
      <div className="w-full">
        {/* Label */}
        {label && (
          <label className="mb-1.5 block text-sm font-medium text-text-primary">
            {label}
          </label>
        )}
        
        {/* Input Container */}
        <div className="relative">
          {/* Left Icon */}
          {leftIcon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              {leftIcon}
            </div>
          )}
          
          {/* Input */}
          <input
            ref={ref}
            className={cn(
              inputVariants({ variant: error ? 'error' : variant, size }),
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className
            )}
            value={value}
            maxLength={maxLength}
            onChange={handleChange}
            {...props}
          />
          
          {/* Right Icon */}
          {rightIcon && (
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              {rightIcon}
            </div>
          )}
        </div>
        
        {/* Helper Text / Error / Character Count */}
        {(error || helperText || (showCharacterCount && maxLength)) && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {/* Error or Helper Text */}
            {error ? (
              <p className="text-xs text-semantic-error">{error}</p>
            ) : helperText ? (
              <p className="text-xs text-text-tertiary">{helperText}</p>
            ) : (
              <div />
            )}
            
            {/* Character Count */}
            {showCharacterCount && maxLength && (
              <p className={cn(
                'text-xs',
                characterCount > maxLength ? 'text-semantic-error' : 'text-text-quaternary'
              )}>
                {characterCount}/{maxLength}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
