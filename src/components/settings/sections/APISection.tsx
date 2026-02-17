/**
 * Profile / Account Settings Section
 * Clean user-facing profile — no API keys, no developer content.
 */

import { useAuthStore } from '@store/authStore';
import { SectionHeader, SettingsCard } from '../helpers/SettingsHelpers';

export function APISection() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const planLabel = user?.plan === 'elite' ? 'Elite' : user?.plan === 'pro' ? 'Pro' : 'Free';
  const planColor = user?.plan === 'elite' ? 'text-amber-400' : user?.plan === 'pro' ? 'text-blue-400' : 'text-text-secondary';

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Profile"
        description="Your account and subscription"
      />

      {user && (
        <SettingsCard title="Account">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 text-white text-lg font-bold flex-shrink-0">
                {(user.displayName || user.email || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {user.displayName || user.email}
                </p>
                <p className="text-xs text-text-tertiary truncate">{user.email}</p>
              </div>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                user.plan === 'elite' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
                user.plan === 'pro' ? 'border-blue-500/30 bg-blue-500/10 text-blue-400' :
                'border-border-primary bg-background-tertiary text-text-secondary'
              }`}>
                {planLabel}
              </span>
            </div>
          </div>
        </SettingsCard>
      )}

      {user && (
        <SettingsCard title="Subscription">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">Current plan</span>
              <span className={`text-sm font-semibold ${planColor}`}>{planLabel}</span>
            </div>
            {user.plan === 'free' && (
              <p className="text-xs text-text-tertiary leading-relaxed">
                Upgrade to Pro for more models, faster responses, image generation, TBWO projects, and priority access.
              </p>
            )}
            {user.plan === 'pro' && (
              <p className="text-xs text-text-tertiary leading-relaxed">
                You have access to all standard models, image generation, TBWO projects, and priority support.
              </p>
            )}
            {(user.plan === 'elite' || user.isAdmin) && (
              <p className="text-xs text-text-tertiary leading-relaxed">
                Full access to all models, features, and priority everything.
              </p>
            )}
          </div>
        </SettingsCard>
      )}

      {user && (
        <SettingsCard title="Session">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Signed in as</p>
              <p className="text-xs text-text-tertiary">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
