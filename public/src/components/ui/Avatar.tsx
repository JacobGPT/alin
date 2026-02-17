/**
 * Avatar - Professional Avatar Component
 *
 * Features:
 * - Image or initials fallback
 * - Multiple sizes
 * - Status indicator
 * - Border styles
 * - Avatar groups
 * - Clickable
 */

import { ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@utils/cn';

// ============================================================================
// AVATAR TYPES
// ============================================================================

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
type AvatarStatus = 'online' | 'offline' | 'busy' | 'away' | 'none';

const sizeConfig: Record<AvatarSize, { container: string; text: string; status: string }> = {
  xs: { container: 'h-6 w-6', text: 'text-[10px]', status: 'h-1.5 w-1.5' },
  sm: { container: 'h-8 w-8', text: 'text-xs', status: 'h-2 w-2' },
  md: { container: 'h-10 w-10', text: 'text-sm', status: 'h-2.5 w-2.5' },
  lg: { container: 'h-12 w-12', text: 'text-base', status: 'h-3 w-3' },
  xl: { container: 'h-16 w-16', text: 'text-lg', status: 'h-3.5 w-3.5' },
  '2xl': { container: 'h-20 w-20', text: 'text-xl', status: 'h-4 w-4' },
};

const statusColors: Record<AvatarStatus, string> = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  busy: 'bg-red-500',
  away: 'bg-yellow-500',
  none: '',
};

// ============================================================================
// AVATAR COMPONENT
// ============================================================================

interface AvatarProps {
  src?: string;
  alt?: string;
  name?: string;
  size?: AvatarSize;
  status?: AvatarStatus;
  bordered?: boolean;
  borderColor?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Avatar({
  src,
  alt,
  name,
  size = 'md',
  status = 'none',
  bordered = false,
  borderColor,
  className,
  onClick,
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  const config = sizeConfig[size];

  const initials = name
    ? name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';

  const getBackgroundColor = (name?: string) => {
    if (!name) return 'bg-background-tertiary';
    const colors = [
      'bg-red-500/20',
      'bg-orange-500/20',
      'bg-yellow-500/20',
      'bg-green-500/20',
      'bg-teal-500/20',
      'bg-blue-500/20',
      'bg-indigo-500/20',
      'bg-purple-500/20',
      'bg-pink-500/20',
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const getTextColor = (name?: string) => {
    if (!name) return 'text-text-tertiary';
    const colors = [
      'text-red-400',
      'text-orange-400',
      'text-yellow-400',
      'text-green-400',
      'text-teal-400',
      'text-blue-400',
      'text-indigo-400',
      'text-purple-400',
      'text-pink-400',
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const Component = onClick ? motion.button : motion.div;

  return (
    <Component
      className={cn(
        'relative inline-flex flex-shrink-0 items-center justify-center rounded-full overflow-hidden',
        config.container,
        bordered && 'ring-2 ring-offset-2 ring-offset-background-primary',
        bordered && (borderColor || 'ring-border-primary'),
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
      whileHover={onClick ? { scale: 1.05 } : undefined}
      whileTap={onClick ? { scale: 0.95 } : undefined}
    >
      {src && !imageError ? (
        <img
          src={src}
          alt={alt || name || 'Avatar'}
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        <div
          className={cn(
            'flex h-full w-full items-center justify-center font-medium',
            getBackgroundColor(name),
            getTextColor(name),
            config.text
          )}
        >
          {initials}
        </div>
      )}

      {/* Status Indicator */}
      {status !== 'none' && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-2 ring-background-primary',
            config.status,
            statusColors[status]
          )}
        />
      )}
    </Component>
  );
}

// ============================================================================
// AVATAR GROUP
// ============================================================================

interface AvatarGroupProps {
  avatars: Array<{
    src?: string;
    name?: string;
    alt?: string;
  }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}

export function AvatarGroup({ avatars, max = 4, size = 'md', className }: AvatarGroupProps) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - max;
  const config = sizeConfig[size];

  return (
    <div className={cn('flex -space-x-2', className)}>
      {visible.map((avatar, index) => (
        <Avatar
          key={index}
          src={avatar.src}
          name={avatar.name}
          alt={avatar.alt}
          size={size}
          bordered
          borderColor="ring-background-primary"
          className="relative"
          style={{ zIndex: visible.length - index }}
        />
      ))}

      {overflow > 0 && (
        <div
          className={cn(
            'relative flex items-center justify-center rounded-full bg-background-tertiary ring-2 ring-background-primary',
            config.container,
            config.text
          )}
          style={{ zIndex: 0 }}
        >
          <span className="font-medium text-text-secondary">+{overflow}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AVATAR WITH NAME
// ============================================================================

interface AvatarWithNameProps extends AvatarProps {
  title?: string;
  subtitle?: string;
  titleClassName?: string;
  subtitleClassName?: string;
}

export function AvatarWithName({
  title,
  subtitle,
  titleClassName,
  subtitleClassName,
  ...avatarProps
}: AvatarWithNameProps) {
  return (
    <div className="flex items-center gap-3">
      <Avatar {...avatarProps} />
      <div className="min-w-0">
        {title && (
          <p className={cn('truncate font-medium text-text-primary', titleClassName)}>
            {title}
          </p>
        )}
        {subtitle && (
          <p className={cn('truncate text-sm text-text-tertiary', subtitleClassName)}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// AI AVATAR (for ALIN)
// ============================================================================

interface AIAvatarProps {
  size?: AvatarSize;
  animated?: boolean;
  className?: string;
}

export function AIAvatar({ size = 'md', animated = false, className }: AIAvatarProps) {
  const config = sizeConfig[size];

  return (
    <motion.div
      className={cn(
        'flex items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary',
        config.container,
        className
      )}
      animate={animated ? {
        boxShadow: [
          '0 0 0px rgba(99, 102, 241, 0)',
          '0 0 20px rgba(99, 102, 241, 0.4)',
          '0 0 0px rgba(99, 102, 241, 0)',
        ],
      } : undefined}
      transition={animated ? {
        duration: 2,
        repeat: Infinity,
        ease: 'easeInOut',
      } : undefined}
    >
      <span className={cn('font-bold text-white', config.text)}>A</span>
    </motion.div>
  );
}

// ============================================================================
// USER AVATAR (convenience wrapper)
// ============================================================================

interface UserAvatarProps {
  size?: AvatarSize;
  showStatus?: boolean;
  className?: string;
}

export function UserAvatar({ size = 'md', showStatus = true, className }: UserAvatarProps) {
  return (
    <Avatar
      name="User"
      size={size}
      status={showStatus ? 'online' : 'none'}
      className={className}
    />
  );
}
