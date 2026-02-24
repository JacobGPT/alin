/**
 * Model Settings Section — All 4 providers + model behavior settings + local model config
 */

import { useState } from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { useCapabilities } from '../../../hooks/useCapabilities';
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
  const caps = useCapabilities();

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

      {/* Local Model Configuration */}
      <LocalModelSection enabled={caps.planLimits.localModelEnabled} />
    </div>
  );
}

// ============================================================================
// LOCAL MODEL SUBSECTION
// ============================================================================

function LocalModelSection({ enabled }: { enabled: boolean }) {
  const [endpoint, setEndpoint] = useState('');
  const [modelName, setModelName] = useState('');
  const [testStatus, setTestStatus] = useState<null | 'testing' | 'success' | 'error'>(null);
  const [testResult, setTestResult] = useState<{ modelName?: string; latency?: number; error?: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load stored values on first render
  if (!loaded) {
    fetch('/api/settings', { headers: { 'Authorization': `Bearer ${localStorage.getItem('alin-auth-token') || ''}` } })
      .then(r => r.json())
      .then(data => {
        if (data.settings?.local_model_endpoint) setEndpoint(data.settings.local_model_endpoint);
        if (data.settings?.local_model_name) setModelName(data.settings.local_model_name);
      })
      .catch(() => {});
    setLoaded(true);
  }

  const saveEndpoint = (value: string) => {
    setEndpoint(value);
    fetch('/api/settings/local_model_endpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('alin-auth-token') || ''}` },
      body: JSON.stringify({ value }),
    }).catch(() => {});
  };

  const saveModelName = (value: string) => {
    setModelName(value);
    fetch('/api/settings/local_model_name', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('alin-auth-token') || ''}` },
      body: JSON.stringify({ value }),
    }).catch(() => {});
  };

  const testConnection = async () => {
    setTestStatus('testing');
    setTestResult(null);
    try {
      const params = new URLSearchParams();
      if (endpoint) params.set('endpoint', endpoint);
      if (modelName) params.set('model', modelName);
      const res = await fetch(`/api/settings/local-model/test?${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('alin-auth-token') || ''}` },
      });
      const data = await res.json();
      if (data.connected) {
        setTestStatus('success');
        setTestResult({ modelName: data.modelName, latency: data.latency });
      } else {
        setTestStatus('error');
        setTestResult({ error: data.error || 'Connection failed' });
      }
    } catch (err) {
      setTestStatus('error');
      setTestResult({ error: 'Network error — is the backend running?' });
    }
  };

  if (!enabled) {
    return (
      <SettingsCard title="Local Model">
        <div className="flex items-center gap-3 rounded-lg bg-background-tertiary p-4 opacity-60">
          <svg className="h-5 w-5 text-text-quaternary flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-text-secondary">Available on Pro and above</p>
            <p className="text-xs text-text-quaternary mt-0.5">
              Connect your own local models (Ollama, LM Studio, vLLM) with a Pro or Agency plan.
            </p>
          </div>
        </div>
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Local Model">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">
            Endpoint URL
          </label>
          <input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            onBlur={(e) => saveEndpoint(e.target.value)}
            placeholder="http://localhost:11434/v1"
            className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-text-secondary">
            Model Name
          </label>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            onBlur={(e) => saveModelName(e.target.value)}
            placeholder="llama3.2:latest"
            className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={testConnection}
            disabled={testStatus === 'testing' || !endpoint}
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>

          {testStatus === 'success' && testResult && (
            <div className="flex items-center gap-2 text-sm text-green-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span>{testResult.modelName} ({testResult.latency}ms)</span>
            </div>
          )}

          {testStatus === 'error' && testResult && (
            <div className="flex items-center gap-2 text-sm text-red-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
              <span className="truncate max-w-xs">{testResult.error}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-text-quaternary">
          Works with any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, text-generation-webui, LocalAI, and more.
        </p>
      </div>
    </SettingsCard>
  );
}
