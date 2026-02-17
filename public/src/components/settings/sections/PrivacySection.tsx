/**
 * Privacy Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingToggle } from '../helpers/SettingsHelpers';

export function PrivacySection() {
  const privacy = useSettingsStore((state) => state.privacy);
  const updatePrivacySettings = useSettingsStore((state) => state.updatePrivacySettings);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Privacy Settings"
        description="Control your data and privacy"
      />

      <SettingToggle
        label="Analytics"
        description="Help improve ALIN by sharing anonymous usage data"
        checked={privacy.analytics}
        onChange={(checked) => updatePrivacySettings({ analytics: checked })}
      />

      <SettingToggle
        label="Crash Reporting"
        description="Automatically send crash reports to help fix bugs"
        checked={privacy.crashReporting}
        onChange={(checked) => updatePrivacySettings({ crashReporting: checked })}
      />

      <SettingToggle
        label="Local Storage Only"
        description="Store all data locally (no cloud sync)"
        checked={privacy.localStorageOnly}
        onChange={(checked) => updatePrivacySettings({ localStorageOnly: checked })}
      />

      <SettingToggle
        label="Share to Improve"
        description="Allow conversations to be used for model improvement"
        checked={privacy.shareImprove}
        onChange={(checked) => updatePrivacySettings({ shareImprove: checked })}
      />
    </div>
  );
}
