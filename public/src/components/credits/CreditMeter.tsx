/**
 * CreditMeter — compact credit balance bar for sidebar
 */
import { useEffect } from 'react';
import { useCreditsStore } from '../../store/creditsStore';

export function CreditMeter() {
  const { balance, allocation, plan, fetchBalance } = useCreditsStore();

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Unlimited plans
  if (allocation === -1) {
    return (
      <div className="mt-1.5 px-1">
        <div className="flex items-center justify-between text-[10px] text-text-quaternary">
          <span>Credits</span>
          <span>&infin; unlimited</span>
        </div>
      </div>
    );
  }

  const pct = allocation > 0 ? Math.min(100, Math.round((balance / allocation) * 100)) : 0;
  const barColor = pct > 50 ? 'bg-green-500' : pct > 20 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="mt-1.5 px-1">
      <div className="flex items-center justify-between text-[10px] text-text-quaternary mb-0.5">
        <span>Credits</span>
        <span>{balance.toLocaleString()} / {allocation.toLocaleString()}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-background-hover overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
