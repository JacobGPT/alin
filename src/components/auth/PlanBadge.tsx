/**
 * PlanBadge - Colored badge showing user's plan tier
 */

interface PlanBadgeProps {
  plan: string;
  className?: string;
}

const PLAN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  free: { bg: 'bg-zinc-700/50', text: 'text-zinc-300', label: 'FREE' },
  pro: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'PRO' },
  enterprise: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'ENTERPRISE' },
};

export function PlanBadge({ plan, className = '' }: PlanBadgeProps) {
  const config = PLAN_COLORS[plan] ?? PLAN_COLORS['free']!;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${config.bg} ${config.text} ${className}`}
    >
      {config.label}
    </span>
  );
}
