/**
 * Performance Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';

export function PerformanceSection() {
  const performance = useSettingsStore((state) => state.performance);
  const updatePerformanceSettings = useSettingsStore((state) => state.updatePerformanceSettings);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Performance Settings"
        description="Optimize ALIN's performance"
      />

      <SettingToggle
        label="Hardware Acceleration"
        description="Use GPU for rendering and computations"
        checked={performance.hardwareAcceleration}
        onChange={(checked) => updatePerformanceSettings({ hardwareAcceleration: checked })}
      />

      <SettingToggle
        label="GPU Offloading"
        description="Offload AI computations to GPU when available"
        checked={performance.gpuOffloading}
        onChange={(checked) => updatePerformanceSettings({ gpuOffloading: checked })}
      />

      <SettingsCard title="Max Concurrent Requests">
        <input
          type="number"
          value={performance.maxConcurrentRequests}
          onChange={(e) => updatePerformanceSettings({ maxConcurrentRequests: parseInt(e.target.value) })}
          min="1"
          max="10"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
      </SettingsCard>

      <SettingsCard title="Cache Size (MB)">
        <input
          type="number"
          value={performance.cacheSize}
          onChange={(e) => updatePerformanceSettings({ cacheSize: parseInt(e.target.value) })}
          min="10"
          max="1000"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
      </SettingsCard>

      <SettingToggle
        label="Enable Prefetch"
        description="Preload likely-needed resources"
        checked={performance.prefetchEnabled}
        onChange={(checked) => updatePerformanceSettings({ prefetchEnabled: checked })}
      />
    </div>
  );
}
