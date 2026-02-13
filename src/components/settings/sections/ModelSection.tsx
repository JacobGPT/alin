/**
 * Model Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';

export function ModelSection() {
  const model = useSettingsStore((state) => state.model);
  const enableAutoContinuation = useSettingsStore((state) => state.enableAutoContinuation);
  const maxContinuationRounds = useSettingsStore((state) => state.maxContinuationRounds);
  const updateModelPreferences = useSettingsStore((state) => state.updateModelPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Model Preferences"
        description="Configure default model settings"
      />

      <SettingsCard title="Default Provider">
        <div className="grid grid-cols-3 gap-3">
          {['anthropic', 'openai', 'local'].map((provider) => (
            <button
              key={provider}
              onClick={() => updateModelPreferences({ defaultProvider: provider as any })}
              className={`rounded-lg border-2 p-3 text-center capitalize transition-all ${
                model.defaultProvider === provider
                  ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                  : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
              }`}
            >
              {provider}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Temperature">
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={model.temperature}
            onChange={(e) => updateModelPreferences({ temperature: parseFloat(e.target.value) })}
            className="flex-1"
          />
          <span className="w-12 text-right font-mono text-text-primary">{model.temperature.toFixed(1)}</span>
        </div>
        <p className="mt-2 text-xs text-text-tertiary">
          Lower = more focused, Higher = more creative
        </p>
      </SettingsCard>

      <SettingsCard title="Max Tokens">
        <input
          type="number"
          value={model.maxTokens}
          onChange={(e) => updateModelPreferences({ maxTokens: parseInt(e.target.value) })}
          min="1"
          max="128000"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
      </SettingsCard>

      <SettingsCard title="Auto-Continuation">
        <SettingToggle
          label="Continue when cut off"
          description="Automatically continue generating when the response hits the token limit"
          checked={enableAutoContinuation}
          onChange={(v) => useSettingsStore.getState().setAutoContinuation(v)}
        />
        {enableAutoContinuation && (
          <div className="mt-4">
            <label className="mb-1.5 block text-sm text-text-secondary">
              Max continuation rounds: {maxContinuationRounds}
            </label>
            <input
              type="range"
              min="1"
              max="5"
              value={maxContinuationRounds}
              onChange={(e) => useSettingsStore.getState().setMaxContinuationRounds(parseInt(e.target.value))}
              className="w-full"
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Higher = longer responses possible, but uses more tokens
            </p>
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
