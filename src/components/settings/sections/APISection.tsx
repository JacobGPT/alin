/**
 * API / Account Settings Section
 */

import { useState, useEffect } from 'react';
import { useAuthStore } from '@store/authStore';
import { SectionHeader, SettingsCard } from '../helpers/SettingsHelpers';

export function APISection() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/keys/status')
      .then(r => r.json())
      .then(data => setKeyStatus(data))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Account"
        description="Your account details and API key status"
      />

      {user && (
        <SettingsCard title="Profile">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Email</span>
              <span className="text-sm text-text-primary">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Display Name</span>
              <span className="text-sm text-text-primary">{user.displayName || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Plan</span>
              <span className={`text-sm font-semibold ${
                user.plan === 'pro' ? 'text-blue-400' :
                user.plan === 'elite' ? 'text-amber-400' : 'text-text-secondary'
              }`}>
                {user.plan.toUpperCase()}
              </span>
            </div>
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="API Key Status (Server-Side)">
        <div className="space-y-2">
          {[
            { key: 'anthropic', label: 'Anthropic (Claude)' },
            { key: 'openai', label: 'OpenAI (GPT)' },
            { key: 'brave', label: 'Brave Search' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">{label}</span>
              <span className={`text-xs font-medium ${keyStatus[key] ? 'text-green-400' : 'text-red-400'}`}>
                {keyStatus[key] ? 'Configured' : 'Not Set'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-quaternary">
          API keys are configured in the server .env file. They never leave the server.
        </p>
      </SettingsCard>

      {user && (
        <SettingsCard title="Session">
          <button
            onClick={logout}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Sign Out
          </button>
        </SettingsCard>
      )}
    </div>
  );
}
