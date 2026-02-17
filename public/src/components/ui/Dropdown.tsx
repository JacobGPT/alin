/**
 * Dropdown - Accessible Dropdown Menu Component
 * 
 * Features:
 * - Keyboard accessible (Radix UI)
 * - Portal rendering
 * - Custom trigger
 * - Icon support
 * - Dividers
 * - Dangerous actions (red)
 * - Disabled items
 */

import { ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CheckIcon } from '@heroicons/react/24/outline';
import { cn } from '@utils/cn';

// ============================================================================
// DROPDOWN ITEM TYPE
// ============================================================================

export interface DropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  dangerous?: boolean;
  checked?: boolean;
  onClick: (e?: React.MouseEvent) => void;
}

// ============================================================================
// DROPDOWN COMPONENT
// ============================================================================

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
}

export function Dropdown({ trigger, items, align = 'end', side = 'bottom' }: DropdownProps) {
  return (
    <DropdownMenu.Root>
      {/* Trigger */}
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>
      
      {/* Content */}
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          side={side}
          sideOffset={4}
          className={cn(
            'z-dropdown min-w-[200px] animate-scale-in rounded-lg border border-border-primary bg-background-elevated p-1 shadow-lg',
            'will-change-[opacity,transform] data-[side=top]:animate-slide-in-down data-[side=right]:animate-slide-in-left data-[side=bottom]:animate-slide-in-up data-[side=left]:animate-slide-in-right'
          )}
        >
          {items.map((item) => {
            // Divider
            if (item.label === '') {
              return (
                <DropdownMenu.Separator
                  key={item.id}
                  className="my-1 h-px bg-border-primary"
                />
              );
            }
            
            // Menu Item
            return (
              <DropdownMenu.Item
                key={item.id}
                disabled={item.disabled}
                onClick={item.onClick}
                className={cn(
                  'group relative flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors',
                  item.disabled && 'pointer-events-none opacity-50',
                  item.dangerous
                    ? 'text-semantic-error hover:bg-semantic-error-bg focus:bg-semantic-error-bg'
                    : 'text-text-primary hover:bg-background-hover focus:bg-background-hover'
                )}
              >
                {/* Icon */}
                {item.icon && (
                  <span className="flex-shrink-0">{item.icon}</span>
                )}
                
                {/* Label */}
                <span className="flex-1">{item.label}</span>
                
                {/* Shortcut */}
                {item.shortcut && (
                  <span className="text-xs text-text-quaternary">
                    {item.shortcut}
                  </span>
                )}
                
                {/* Checked */}
                {item.checked && (
                  <CheckIcon className="h-4 w-4 flex-shrink-0" />
                )}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
