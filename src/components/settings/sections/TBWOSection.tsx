/**
 * TBWO Settings Section (includes ModelRoutingSettings sub-component)
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

      {/* Model Routing */}
      <ModelRoutingSettings />
    </div>
  );
}

function ModelRoutingSettings() {
  const routing = useSettingsStore((state) => state.tbwo.modelRouting);
  const updateTBWOPreferences = useSettingsStore((state) => state.updateTBWOPreferences);

  const MODEL_OPTIONS = [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic' },
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', provider: 'anthropic' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'anthropic' },
    { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
  ];

  const updateRule = (index: number, model: string) => {
    const opt = MODEL_OPTIONS.find(o => o.value === model);
    if (!opt) return;
    const newRules = [...(routing?.rules || [])];
    newRules[index] = { ...newRules[index]!, model, provider: opt.provider as any };
    updateTBWOPreferences({
      modelRouting: { ...routing, rules: newRules },
    });
  };

  const resetDefaults = () => {
    updateTBWOPreferences({
      modelRouting: {
        enabled: routing?.enabled ?? false,
        rules: [
          { podRole: 'design' as any, provider: 'anthropic', model: 'claude-opus-4-6', reason: 'Creative work benefits from Opus' },
          { podRole: 'copy' as any, provider: 'anthropic', model: 'claude-opus-4-6', reason: 'Copywriting quality from Opus' },
          { podRole: 'frontend' as any, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', reason: 'Fast, excellent code generation' },
          { podRole: 'backend' as any, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', reason: 'Efficient code output' },
          { podRole: 'qa' as any, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', reason: 'QA checks are lightweight' },
          { podRole: 'orchestrator' as any, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', reason: 'Good reasoning, cost-effective' },
        ],
        fallback: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
      },
    });
  };

  // Cost estimation
  const estimateCost = () => {
    const roles = (routing?.rules || []).map(r => r.podRole);
    const PRICING: Record<string, { input: number; output: number }> = {
      'claude-opus-4-6': { input: 15, output: 75 },
      'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
      'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
      'gpt-4o': { input: 2.5, output: 10 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    };
    let total = 0;
    for (const rule of (routing?.rules || [])) {
      const p = PRICING[rule.model] || PRICING['claude-sonnet-4-5-20250929']!;
      total += (30_000 / 1_000_000) * p.input + (15_000 / 1_000_000) * p.output;
    }
    return total.toFixed(2);
  };

  return (
    <SettingsCard title="Model Routing (per-pod AI model selection)">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <SettingToggle
            label="Enable Model Routing"
            description="Use different AI models for different pod roles"
            checked={routing?.enabled ?? false}
            onChange={(checked) => updateTBWOPreferences({ modelRouting: { ...routing, enabled: checked } })}
          />
        </div>

        {routing?.enabled && (
          <>
            <div className="rounded-lg border border-border-primary overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-background-tertiary">
                    <th className="px-3 py-2 text-left text-text-secondary font-medium">Pod Role</th>
                    <th className="px-3 py-2 text-left text-text-secondary font-medium">Model</th>
                    <th className="px-3 py-2 text-left text-text-secondary font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(routing.rules || []).map((rule, i) => (
                    <tr key={i} className="border-t border-border-primary">
                      <td className="px-3 py-2 text-text-primary capitalize">{String(rule.podRole)}</td>
                      <td className="px-3 py-2">
                        <select
                          value={rule.model}
                          onChange={(e) => updateRule(i, e.target.value)}
                          className="w-full rounded border border-border-primary bg-background-secondary px-2 py-1 text-xs text-text-primary"
                        >
                          {MODEL_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-text-tertiary">{rule.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-text-tertiary">
                Estimated cost per TBWO: <span className="font-medium text-text-primary">~${estimateCost()}</span>
              </p>
              <button
                onClick={resetDefaults}
                className="text-xs text-brand-primary hover:underline"
              >
                Reset to Defaults
              </button>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}
