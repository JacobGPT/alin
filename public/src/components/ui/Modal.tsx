/**
 * Modal - Professional Modal Dialog Component
 *
 * Features:
 * - Multiple sizes
 * - Accessible (Headless UI)
 * - Animated transitions
 * - Close on overlay click
 * - Close on escape
 * - Header/content/footer sections
 * - Confirm dialog variant
 */

import { Fragment, ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@heroicons/react/24/solid';
import { cn } from '@utils/cn';
import { Button } from './Button';

// ============================================================================
// MODAL TYPES
// ============================================================================

type ModalSize = 'sm' | 'md' | 'lg' | '2xl' | 'xl' | 'full';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  '2xl': 'max-w-2xl',
  xl: 'max-w-xl',
  full: 'max-w-4xl',
};

// ============================================================================
// MODAL COMPONENT
// ============================================================================

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  children: ReactNode;
  className?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  showCloseButton = true,
  closeOnOverlayClick = true,
  children,
  className,
}: ModalProps) {
  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-modal"
        onClose={closeOnOverlayClick ? onClose : () => {}}
      >
        {/* Backdrop */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        {/* Modal Container */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel
                className={cn(
                  'w-full transform overflow-hidden rounded-2xl border border-border-primary bg-background-elevated p-6 shadow-xl transition-all',
                  sizeClasses[size],
                  className
                )}
              >
                {/* Header */}
                {(title || showCloseButton) && (
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      {title && (
                        <DialogTitle className="text-lg font-semibold text-text-primary">
                          {title}
                        </DialogTitle>
                      )}
                      {description && (
                        <p className="mt-1 text-sm text-text-tertiary">{description}</p>
                      )}
                    </div>
                    {showCloseButton && (
                      <button
                        onClick={onClose}
                        className="flex-shrink-0 rounded-lg p-1 text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-primary"
                      >
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Content */}
                {children}
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

// ============================================================================
// MODAL FOOTER
// ============================================================================

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div className={cn('mt-6 flex items-center justify-end gap-3', className)}>
      {children}
    </div>
  );
}

// ============================================================================
// CONFIRM MODAL
// ============================================================================

type ConfirmVariant = 'danger' | 'warning' | 'info' | 'success';

const variantConfig: Record<ConfirmVariant, {
  icon: ReactNode;
  iconBg: string;
  confirmVariant: 'danger' | 'primary' | 'success';
}> = {
  danger: {
    icon: <ExclamationTriangleIcon className="h-6 w-6 text-red-400" />,
    iconBg: 'bg-red-500/10',
    confirmVariant: 'danger',
  },
  warning: {
    icon: <ExclamationTriangleIcon className="h-6 w-6 text-yellow-400" />,
    iconBg: 'bg-yellow-500/10',
    confirmVariant: 'primary',
  },
  info: {
    icon: <InformationCircleIcon className="h-6 w-6 text-blue-400" />,
    iconBg: 'bg-blue-500/10',
    confirmVariant: 'primary',
  },
  success: {
    icon: <CheckCircleIcon className="h-6 w-6 text-green-400" />,
    iconBg: 'bg-green-500/10',
    confirmVariant: 'success',
  },
};

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  variant?: ConfirmVariant;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  variant = 'danger',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  loading = false,
}: ConfirmModalProps) {
  const config = variantConfig[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" showCloseButton={false}>
      <div className="flex gap-4">
        {/* Icon */}
        <div className={cn('flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full', config.iconBg)}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          <p className="mt-2 text-sm text-text-secondary">{message}</p>
        </div>
      </div>

      {/* Actions */}
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelText}
        </Button>
        <Button variant={config.confirmVariant} onClick={onConfirm} loading={loading}>
          {confirmText}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ============================================================================
// ALERT MODAL
// ============================================================================

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  variant?: ConfirmVariant;
  buttonText?: string;
}

export function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  variant = 'info',
  buttonText = 'OK',
}: AlertModalProps) {
  const config = variantConfig[variant];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm" showCloseButton={false}>
      <div className="text-center">
        {/* Icon */}
        <div className={cn('mx-auto flex h-12 w-12 items-center justify-center rounded-full', config.iconBg)}>
          {config.icon}
        </div>

        {/* Content */}
        <h3 className="mt-4 text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>

        {/* Action */}
        <div className="mt-6">
          <Button onClick={onClose} fullWidth>
            {buttonText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// DRAWER (Side Modal)
// ============================================================================

type DrawerSide = 'left' | 'right';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  side?: DrawerSide;
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Drawer({
  isOpen,
  onClose,
  side = 'right',
  title,
  children,
  className,
}: DrawerProps) {
  const slideFrom = side === 'right' ? 'translate-x-full' : '-translate-x-full';

  return (
    <Transition show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-modal" onClose={onClose}>
        {/* Backdrop */}
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        </TransitionChild>

        {/* Drawer Container */}
        <div className="fixed inset-0 overflow-hidden">
          <div className={cn(
            'absolute inset-y-0 flex max-w-full',
            side === 'right' ? 'right-0' : 'left-0'
          )}>
            <TransitionChild
              as={Fragment}
              enter="transform transition ease-out duration-300"
              enterFrom={slideFrom}
              enterTo="translate-x-0"
              leave="transform transition ease-in duration-200"
              leaveFrom="translate-x-0"
              leaveTo={slideFrom}
            >
              <DialogPanel
                className={cn(
                  'w-screen max-w-md border-l border-border-primary bg-background-elevated shadow-xl',
                  className
                )}
              >
                {/* Header */}
                {title && (
                  <div className="flex items-center justify-between border-b border-border-primary px-6 py-4">
                    <DialogTitle className="text-lg font-semibold text-text-primary">
                      {title}
                    </DialogTitle>
                    <button
                      onClick={onClose}
                      className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-primary"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                  {children}
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
