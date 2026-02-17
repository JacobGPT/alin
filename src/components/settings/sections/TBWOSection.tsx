/**
 * TBWO Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';

export function TBWOSection() {
  const tbwo = useSettingsStore((state) => state.tbwo);
  const updateTBWOPreferences = useSettingsStore((state) => state.updateTBWOPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="TBWO Settings"
        description="Configure Time-Budgeted Work Order defaults"
      />

      <SettingsCard title="Default Quality">
        <select
          value={tbwo.defaultQuality}
          onChange={(e) => updateTBWOPreferences({ defaultQuality: e.target.value as any })}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        >
          <option value="draft">Draft</option>
          <option value="standard">Standard</option>
          <option value="premium">Premium</option>
          <option value="apple_level">Apple-Level</option>
        </select>
      </SettingsCard>

      <SettingsCard title="Default Time Budget (minutes)">
        <input
          type="number"
          value={tbwo.defaultTimeBudget}
          onChange={(e) => updateTBWOPreferences({ defaultTimeBudget: parseInt(e.target.value) })}
          min="1"
          max="480"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
      </SettingsCard>

      <SettingToggle
        label="Auto Approve Plans"
        description="Automatically approve execution plans without review"
        checked={tbwo.autoApprove}
        onChange={(checked) => updateTBWOPreferences({ autoApprove: checked })}
      />

      <SettingToggle
        label="Verbose Receipts"
        description="Include detailed technical information in receipts"
        checked={tbwo.verboseReceipts}
        onChange={(checked) => updateTBWOPreferences({ verboseReceipts: checked })}
      />

      <SettingToggle
        label="Show Pod Visualization"
        description="Display pod network visualization during execution"
        checked={tbwo.showPodVisualization}
        onChange={(checked) => updateTBWOPreferences({ showPodVisualization: checked })}
      />
    </div>
  );
}
