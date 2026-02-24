/**
 * Credits Store — unified credit balance tracking
 */
import { create } from 'zustand';

interface CreditsState {
  balance: number;
  allocation: number;
  plan: string;
  loading: boolean;
  lastFetched: number;
  fetchBalance: () => Promise<void>;
}

const CACHE_TTL = 30_000; // 30 seconds

export const useCreditsStore = create<CreditsState>((set, get) => ({
  balance: 0,
  allocation: 0,
  plan: 'free',
  loading: false,
  lastFetched: 0,

  fetchBalance: async () => {
    const now = Date.now();
    if (now - get().lastFetched < CACHE_TTL) return;

    set({ loading: true });
    try {
      const res = await fetch('/api/credits/balance');
      if (res.ok) {
        const data = await res.json();
        set({
          balance: data.balance ?? 0,
          allocation: data.allocation ?? 0,
          plan: data.plan ?? 'free',
          lastFetched: now,
        });
      }
    } catch {
      // Silently fail — credit meter will show stale data
    } finally {
      set({ loading: false });
    }
  },
}));
