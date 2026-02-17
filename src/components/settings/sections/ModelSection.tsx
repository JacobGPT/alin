/**
 * Model Settings Section — All 4 providers + model behavior settings
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingsCard, SettingToggle } from '../helpers/SettingsHelpers';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', description: 'Claude models — reasoning, analysis, coding' },
  { id: 'openai', label: 'OpenAI', description: 'GPT models — creative, multimodal, coding' },
  { id: 'gemini', label: 'Gemini', description: 'Google models — multimodal, long context' },
  { id: 'deepseek', label: 'DeepSeek', description: 'Best value — near-frontier at low cost' },
] as const;

export function ModelSection() {
  const model = useSettingsStore((state) => state.model);
  const enableAutoContinuation = useSettingsStore((state) => state.enableAutoContinuation);
  const maxContinuationRounds = useSettingsStore((state) => state.maxContinuationRounds);
  const updateModelPreferences = useSettingsStore((state) => state.updateModelPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Models"
        description="Choose your default AI provider and configure model behavior"
      />

      <SettingsCard title="Default Provider">
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => updateModelPreferences({ defaultProvider: provider.id as any })}
              className={`rounded-xl border-2 p-4 text-left transition-all ${
                model.defaultProvider === provider.id
                  ? 'border-brand-primary bg-brand-primary/10'
                  : 'border-border-primary hover:border-brand-primary/50'
              }`}
            >
              <span className={`text-sm font-semibold ${
                model.defaultProvider === provider.id ? 'text-brand-primary' : 'text-text-primary'
              }`}>
                {provider.label}
              </span>
              <p className="text-xs text-text-tertiary mt-1">{provider.description}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-quaternary">
          You can switch providers anytime from the model selector in the chat header.
        </p>
      </SettingsCard>

      <SettingsCard title="Creativity (Temperature)">
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
          <span className="w-12 text-right font-mono text-sm text-text-primary">{model.temperature.toFixed(1)}</span>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-text-quaternary">Precise</span>
          <span className="text-xs text-text-quaternary">Creative</span>
        </div>
      </SettingsCard>

      <SettingsCard title="Response Length">
        <input
          type="number"
          value={model.maxTokens}
          onChange={(e) => updateModelPreferences({ maxTokens: parseInt(e.target.value) })}
          min="1"
          max="128000"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
        <p className="mt-2 text-xs text-text-quaternary">
          Maximum tokens per response. Higher values allow longer responses but cost more.
        </p>
      </SettingsCard>

      <SettingsCard title="Auto-Continuation">
        <SettingToggle
          label="Continue when cut off"
          description="Automatically continue generating when a response hits the token limit"
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
            <p className="mt-1 text-xs text-text-quaternary">
              Higher = longer responses possible, but uses more tokens
            </p>
          </div>
        )}
      </SettingsCard>
    </div>
  );
}
