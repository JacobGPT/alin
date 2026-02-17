/**
 * Voice Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';

export function VoiceSection() {
  const voice = useSettingsStore((state) => state.voice);
  const updateVoicePreferences = useSettingsStore((state) => state.updateVoicePreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Voice Settings"
        description="Configure text-to-speech and voice input"
      />

      <SettingToggle
        label="Enable Voice"
        description="Enable voice features"
        checked={voice.enabled}
        onChange={(checked) => updateVoicePreferences({ enabled: checked })}
      />

      <SettingsCard title="Voice">
        <select
          value={voice.voice}
          onChange={(e) => updateVoicePreferences({ voice: e.target.value as any })}
          disabled={!voice.enabled}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        >
          <option value="alloy">Alloy</option>
          <option value="echo">Echo</option>
          <option value="fable">Fable</option>
          <option value="onyx">Onyx</option>
          <option value="nova">Nova</option>
          <option value="shimmer">Shimmer</option>
        </select>
      </SettingsCard>

      <SettingsCard title="Speed">
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0.25"
            max="4"
            step="0.25"
            value={voice.speed}
            onChange={(e) => updateVoicePreferences({ speed: parseFloat(e.target.value) })}
            disabled={!voice.enabled}
            className="flex-1"
          />
          <span className="w-12 text-right font-mono text-text-primary">{voice.speed.toFixed(2)}x</span>
        </div>
      </SettingsCard>

      <SettingToggle
        label="Auto Play"
        description="Automatically play AI responses"
        checked={voice.autoPlay}
        onChange={(checked) => updateVoicePreferences({ autoPlay: checked })}
        disabled={!voice.enabled}
      />

      <SettingToggle
        label="Push to Talk"
        description="Hold key to record voice input"
        checked={voice.pushToTalk}
        onChange={(checked) => updateVoicePreferences({ pushToTalk: checked })}
        disabled={!voice.enabled}
      />
    </div>
  );
}
