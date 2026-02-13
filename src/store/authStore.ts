/**
 * Auth Store - User Authentication State
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  displayName: string;
  plan: 'free' | 'pro' | 'elite';
  isAdmin?: boolean;
  emailVerified?: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  needsVerification: boolean;
  verificationEmail: string | null;

  signup(email: string, password: string, displayName: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): void;
  refreshToken(): Promise<void>;
  fetchProfile(): Promise<void>;
  updateProfile(updates: { displayName?: string; email?: string }): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  getAuthHeader(): Record<string, string>;
  clearError(): void;
  verifyEmail(code: string): Promise<void>;
  resendCode(): Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      needsVerification: false,
      verificationEmail: null,

      signup: async (email, password, displayName) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, displayName }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Signup failed');

          if (data.needsVerification) {
            set({ needsVerification: true, verificationEmail: email, isLoading: false });
          } else {
            set({ user: data.user, token: data.token, isAuthenticated: true, isLoading: false });
          }
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
          throw err;
        }
      },

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Login failed');

          if (data.needsVerification) {
            set({ needsVerification: true, verificationEmail: email, isLoading: false });
          } else {
            set({ user: data.user, token: data.token, isAuthenticated: true, isLoading: false });
          }
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
          throw err;
        }
      },

      logout: () => {
        const { token } = get();
        // Fire-and-forget server-side token revocation
        if (token) {
          fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        set({ user: null, token: null, isAuthenticated: false, error: null });
      },

      refreshToken: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            set({ token: data.token, user: data.user, isAuthenticated: true });
          } else if (res.status === 401) {
            set({ user: null, token: null, isAuthenticated: false });
          }
          // Other errors: no-op (keep current token, might be temporary)
        } catch {
          // Network error — no-op
        }
      },

      fetchProfile: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            if (res.status === 401) {
              // Try refreshing the token before giving up
              await get().refreshToken();
              // If refreshToken cleared auth, we're done
              if (!get().token) return;
              // Retry with new token
              const retryRes = await fetch('/api/auth/me', {
                headers: { Authorization: `Bearer ${get().token}` },
              });
              if (retryRes.ok) {
                const retryData = await retryRes.json();
                set({ user: retryData.user, isAuthenticated: true });
              }
            }
            return;
          }
          const data = await res.json();
          set({ user: data.user, isAuthenticated: true });
        } catch {
          // Network error - don't clear auth, might be temporary
        }
      },

      updateProfile: async (updates) => {
        const { token } = get();
        if (!token) return;
        const res = await fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Update failed');
        set({ user: data.user });
      },

      changePassword: async (oldPassword, newPassword) => {
        const { token } = get();
        if (!token) return;
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ oldPassword, newPassword }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Password change failed');
      },

      getAuthHeader: (): Record<string, string> => {
        const { token } = get();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },

      verifyEmail: async (code: string) => {
        const { verificationEmail } = get();
        if (!verificationEmail) throw new Error('No email to verify');
        set({ isLoading: true, error: null });
        try {
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: verificationEmail, code }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Verification failed');
          set({
            user: data.user,
            token: data.token,
            isAuthenticated: true,
            needsVerification: false,
            verificationEmail: null,
            isLoading: false,
          });
        } catch (err: any) {
          set({ error: err.message, isLoading: false });
          throw err;
        }
      },

      resendCode: async () => {
        const { verificationEmail } = get();
        if (!verificationEmail) return;
        try {
          await fetch('/api/auth/resend-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: verificationEmail }),
          });
        } catch { /* silent */ }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'alin-auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        needsVerification: state.needsVerification,
        verificationEmail: state.verificationEmail,
      }),
    }
  )
);
