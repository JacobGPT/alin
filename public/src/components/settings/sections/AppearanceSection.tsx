/**
 * Appearance Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';
import { Theme } from '../../../types/ui';
import {
  MoonIcon,
  SunIcon,
  ComputerDesktopIcon,
} from '@heroicons/react/24/outline';

export function AppearanceSection() {
  const ui = useSettingsStore((state) => state.ui);
  const updateUIPreferences = useSettingsStore((state) => state.updateUIPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Appearance"
        description="Customize how ALIN looks and feels"
      />

      <SettingsCard title="Theme">
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: Theme.LIGHT, icon: SunIcon, label: 'Light' },
            { value: Theme.DARK, icon: MoonIcon, label: 'Dark' },
            { value: Theme.SYSTEM, icon: ComputerDesktopIcon, label: 'System' },
          ].map((theme) => {
            const Icon = theme.icon;
            return (
              <button
                key={theme.value}
                onClick={() => updateUIPreferences({ theme: theme.value })}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 transition-all ${
                  ui.theme === theme.value
                    ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                    : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
                }`}
              >
                <Icon className="h-5 w-5" />
                {theme.label}
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Font Size">
        <div className="grid grid-cols-3 gap-3">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => updateUIPreferences({ fontSize: size })}
              className={`rounded-lg border-2 p-3 capitalize transition-all ${
                ui.fontSize === size
                  ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                  : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Density">
        <div className="grid grid-cols-3 gap-3">
          {(['compact', 'comfortable', 'spacious'] as const).map((density) => (
            <button
              key={density}
              onClick={() => updateUIPreferences({ density })}
              className={`rounded-lg border-2 p-3 capitalize transition-all ${
                ui.density === density
                  ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                  : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
              }`}
            >
              {density}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Accent Color">
        <div className="flex items-center gap-3">
          {['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444'].map((color) => (
            <button
              key={color}
              onClick={() => updateUIPreferences({ accentColor: color })}
              className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                ui.accentColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-background-primary' : ''
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingToggle
        label="Enable Animations"
        description="Smooth transitions and animations throughout the app"
        checked={ui.animationsEnabled}
        onChange={(checked) => updateUIPreferences({ animationsEnabled: checked })}
      />

      <SettingToggle
        label="Enable Sounds"
        description="Audio feedback for notifications and actions"
        checked={ui.soundEnabled}
        onChange={(checked) => updateUIPreferences({ soundEnabled: checked })}
      />
    </div>
  );
}
