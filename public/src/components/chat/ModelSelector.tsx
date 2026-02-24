/**
 * ModelSelector - AI Model Selection Component
 *
 * Allows users to choose between:
 * - Claude (Anthropic)
 * - GPT (OpenAI)
 * - Both (parallel execution)
 * - Auto (system decides)
 * - Hybrid (collaborative)
 * - Local (future - Ollama/etc)
 *
 * Also allows selecting specific model versions within each provider.
 */

import { Fragment, useState } from 'react';
import { Listbox, Transition, Menu } from '@headlessui/react';
import {
  ChevronUpDownIcon,
  ChevronDownIcon,
  CheckIcon,
  SparklesIcon,
  CpuChipIcon,
  BoltIcon,
  AdjustmentsHorizontalIcon,
  ArrowsRightLeftIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';
import { useSettingsStore } from '@store/settingsStore';
import type { ModelMode, ModelVersions } from '@store/settingsStore';
import { useCapabilities } from '../../hooks/useCapabilities';
import { LockClosedIcon } from '@heroicons/react/24/outline';

// ============================================================================
// TYPES
// ============================================================================

export interface ModelOption {
  id: ModelMode;
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  available: boolean;
  models?: ModelVersionInfo[];
}

export interface ModelVersionInfo {
  id: string;
  name: string;
  description: string;
  contextWindow?: string;
  recommended?: boolean;
}

// ============================================================================
// MODEL OPTIONS WITH DETAILED VERSIONS (ordered best → oldest)
// ============================================================================

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'claude',
    name: 'Anthropic',
    description: 'Claude models - Best for reasoning & analysis',
    icon: SparklesIcon,
    available: true,
    models: [
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        description: 'Most intelligent — deep reasoning and extended thinking',
        contextWindow: '200K',
      },
      {
        id: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        description: 'Best coding, agents, and reasoning — the new default',
        contextWindow: '200K',
        recommended: true,
      },
      {
        id: 'claude-opus-4-5-20250918',
        name: 'Claude Opus 4.5',
        description: 'Previous flagship — creative writing, nuanced analysis',
        contextWindow: '200K',
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        description: 'Strong reasoning and coding, efficient and reliable',
        contextWindow: '200K',
      },
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        description: 'Previous generation all-rounder',
        contextWindow: '200K',
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        description: 'Fastest Claude, quick tasks and classifications',
        contextWindow: '200K',
      },
    ],
  },
  {
    id: 'gpt',
    name: 'OpenAI',
    description: 'GPT models - Best for creative & code tasks',
    icon: CpuChipIcon,
    available: true,
    models: [
      {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        description: 'OpenAI flagship — best coding, reasoning, vision, agentic',
        contextWindow: '200K',
      },
      {
        id: 'gpt-5.1',
        name: 'GPT-5.1',
        description: 'Previous flagship, excellent coding and reasoning',
        contextWindow: '128K',
      },
      {
        id: 'gpt-5',
        name: 'GPT-5',
        description: 'Strong reasoning with configurable effort',
        contextWindow: '128K',
        recommended: true,
      },
      {
        id: 'gpt-5-mini',
        name: 'GPT-5 Mini',
        description: 'Fast reasoning at low cost, well-defined tasks',
        contextWindow: '128K',
      },
      {
        id: 'gpt-5-nano',
        name: 'GPT-5 Nano',
        description: 'Cheapest reasoning, summarization, classification',
        contextWindow: '128K',
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        description: '1M context, strong coding and instruction following',
        contextWindow: '1M',
      },
      {
        id: 'gpt-4.1-mini',
        name: 'GPT-4.1 Mini',
        description: '1M context at affordable price, versatile',
        contextWindow: '1M',
      },
      {
        id: 'gpt-4.1-nano',
        name: 'GPT-4.1 Nano',
        description: '1M context, cheapest long-context GPT',
        contextWindow: '1M',
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Multimodal, creative writing, vision, structured output',
        contextWindow: '128K',
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Cheapest multimodal, great JSON extraction',
        contextWindow: '128K',
      },
      {
        id: 'o3',
        name: 'o3',
        description: 'Deep multi-step reasoning for hardest problems',
        contextWindow: '200K',
      },
      {
        id: 'o4-mini',
        name: 'o4-mini',
        description: 'Fast reasoning, strong math/coding/visual tasks',
        contextWindow: '200K',
      },
      {
        id: 'o3-mini',
        name: 'o3-mini',
        description: 'Efficient reasoning, science/math/coding',
        contextWindow: '200K',
      },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google Gemini - Best for multimodal & long context',
    icon: BoltIcon,
    available: true,
    models: [
      {
        id: 'gemini-3-pro-preview',
        name: 'Gemini 3 Pro',
        description: 'Strongest reasoning, agentic coding, native multimodal',
        contextWindow: '1M',
      },
      {
        id: 'gemini-3-flash-preview',
        name: 'Gemini 3 Flash',
        description: 'Fast frontier model, rivals much larger models',
        contextWindow: '200K',
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: '1M token context, built-in Google Search grounding',
        contextWindow: '1M',
      },
      {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Hybrid reasoning, excellent value and speed',
        contextWindow: '1M',
        recommended: true,
      },
      {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash-Lite',
        description: 'Ultra-fast, lowest cost, great for background tasks',
        contextWindow: '1M',
      },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek - Best value for reasoning & math',
    icon: CpuChipIcon,
    available: true,
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3.2',
        description: 'Near-frontier intelligence at 95% lower cost',
        contextWindow: '64K',
        recommended: true,
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        description: 'Chain-of-thought reasoning, IMO gold medalist math',
        contextWindow: '64K',
      },
    ],
  },
  {
    id: 'both',
    name: 'Both',
    description: 'Run any two models in parallel, compare responses',
    icon: ArrowsRightLeftIcon,
    available: true,
    models: [],
  },
  {
    id: 'auto',
    name: 'Auto',
    description: 'Let ALIN choose the best model for each task',
    icon: BoltIcon,
    available: true,
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    description: 'One model plans, another executes — any combination',
    icon: AdjustmentsHorizontalIcon,
    available: true,
  },
  {
    id: 'local',
    name: 'Local',
    description: 'Use local models (Ollama, LM Studio)',
    icon: ServerIcon,
    available: true,
  },
];

// Provider IDs that have model lists
const PROVIDER_IDS = ['claude', 'gpt', 'gemini', 'deepseek'] as const;
const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Anthropic',
  gpt: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ModelSelector() {
  const modelMode = useSettingsStore((state) => state.modelMode);
  const setModelMode = useSettingsStore((state) => state.setModelMode);
  const selectedModelVersions = useSettingsStore((state) => state.selectedModelVersions);
  const setModelVersion = useSettingsStore((state) => state.setModelVersion);
  const caps = useCapabilities();

  const selectedOption = MODEL_OPTIONS.find((opt) => opt.id === modelMode) || MODEL_OPTIONS[0];

  // Local model config from settings (lazy-loaded)
  const [localConfig, setLocalConfig] = useState<{ endpoint: string; model: string } | null>(null);
  const [localConfigLoaded, setLocalConfigLoaded] = useState(false);

  if (modelMode === 'local' && !localConfigLoaded) {
    setLocalConfigLoaded(true);
    fetch('/api/settings', { headers: { 'Authorization': `Bearer ${localStorage.getItem('alin-auth-token') || ''}` } })
      .then(r => r.json())
      .then(data => {
        if (data.settings) {
          setLocalConfig({
            endpoint: data.settings.local_model_endpoint || '',
            model: data.settings.local_model_name || '',
          });
        }
      })
      .catch(() => {});
  }

  // Get current model version display name
  const getCurrentVersionName = () => {
    if (modelMode === 'claude') {
      const claudeModel = MODEL_OPTIONS.find((o) => o.id === 'claude')?.models?.find(
        (m) => m.id === selectedModelVersions.claude
      );
      return claudeModel?.name || 'Claude Sonnet 4';
    } else if (modelMode === 'gpt') {
      const gptModel = MODEL_OPTIONS.find((o) => o.id === 'gpt')?.models?.find(
        (m) => m.id === selectedModelVersions.gpt
      );
      return gptModel?.name || 'GPT-4o';
    } else if (modelMode === 'gemini') {
      const geminiModel = MODEL_OPTIONS.find((o) => o.id === 'gemini')?.models?.find(
        (m) => m.id === selectedModelVersions.gemini
      );
      return geminiModel?.name || 'Gemini 2.5 Flash';
    } else if (modelMode === 'deepseek') {
      const deepseekModel = MODEL_OPTIONS.find((o) => o.id === 'deepseek')?.models?.find(
        (m) => m.id === selectedModelVersions.deepseek
      );
      return deepseekModel?.name || 'DeepSeek V3.2';
    } else if (modelMode === 'local') {
      return localConfig?.model || null;
    } else if (modelMode === 'both') {
      return null; // Dual selectors shown separately
    } else if (modelMode === 'hybrid') {
      return null; // Dual selectors shown separately
    }
    return null;
  };

  const versionName = getCurrentVersionName();

  return (
    <div className="flex items-center gap-2">
      {/* Main Mode Selector */}
      <Listbox value={modelMode} onChange={setModelMode}>
        <div className="relative">
          <Listbox.Button className="relative flex items-center gap-2 rounded-lg border border-border-primary bg-background-secondary px-3 py-2 text-left text-sm transition-colors hover:bg-background-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary">
            <selectedOption.icon className="h-4 w-4 text-brand-primary" />
            <span className="text-text-primary font-medium">{selectedOption.name}</span>
            <ChevronUpDownIcon className="h-4 w-4 text-text-tertiary" />
          </Listbox.Button>

          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options className="absolute right-0 z-50 mt-2 w-80 origin-top-right rounded-lg border border-border-primary bg-background-elevated shadow-xl focus:outline-none">
              <div className="p-2">
                {MODEL_OPTIONS.map((option) => (
                  <Listbox.Option
                    key={option.id}
                    value={option.id}
                    disabled={!option.available}
                    className={({ active, selected }) =>
                      `relative flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors ${
                        !option.available
                          ? 'cursor-not-allowed opacity-50'
                          : active
                          ? 'bg-background-hover'
                          : ''
                      } ${selected ? 'bg-brand-primary/10' : ''}`
                    }
                  >
                    {({ selected }) => (
                      <>
                        <option.icon
                          className={`h-5 w-5 mt-0.5 flex-shrink-0 ${
                            selected ? 'text-brand-primary' : 'text-text-tertiary'
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-medium ${
                                selected ? 'text-brand-primary' : 'text-text-primary'
                              }`}
                            >
                              {option.name}
                            </span>
                            {!option.available && (
                              <span className="text-xs bg-background-tertiary text-text-tertiary px-1.5 py-0.5 rounded">
                                Soon
                              </span>
                            )}
                            {option.id === 'local' && option.available && !caps.planLimits.localModelEnabled && (
                              <LockClosedIcon className="h-3.5 w-3.5 text-text-quaternary" />
                            )}
                          </div>
                          <p className="text-xs text-text-tertiary mt-0.5">
                            {option.id === 'local' && option.available && !caps.planLimits.localModelEnabled
                              ? 'Available on Pro and above'
                              : option.description}
                          </p>
                        </div>
                        {selected && (
                          <CheckIcon className="h-4 w-4 text-brand-primary flex-shrink-0 mt-0.5" />
                        )}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </div>
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>

      {/* Model Version Selector (single provider modes) */}
      {(modelMode === 'claude' || modelMode === 'gpt' || modelMode === 'gemini' || modelMode === 'deepseek') && (
        <ModelVersionSelector
          provider={modelMode as 'claude' | 'gpt' | 'gemini' | 'deepseek'}
          selectedVersion={selectedModelVersions[modelMode]}
          onVersionChange={(version) => setModelVersion(modelMode, version)}
          models={selectedOption.models || []}
          allowedModels={caps.allowedModels}
        />
      )}

      {/* Dual Model Version Selectors for Both mode — grouped by provider */}
      {modelMode === 'both' && (
        <>
          <GroupedModelVersionSelector
            label="Model A"
            selectedVersion={selectedModelVersions.bothClaude || 'claude-sonnet-4-5-20250929'}
            onVersionChange={(version) => setModelVersion('bothClaude' as any, version)}
            allowedModels={caps.allowedModels}
          />
          <GroupedModelVersionSelector
            label="Model B"
            selectedVersion={selectedModelVersions.bothGPT || 'gpt-5'}
            onVersionChange={(version) => setModelVersion('bothGPT' as any, version)}
            allowedModels={caps.allowedModels}
          />
        </>
      )}

      {/* Dual Model Version Selectors for Hybrid mode — grouped by provider */}
      {modelMode === 'hybrid' && (
        <>
          <GroupedModelVersionSelector
            label="Planner"
            selectedVersion={selectedModelVersions.hybridPlanner || 'claude-sonnet-4-5-20250929'}
            onVersionChange={(version) => setModelVersion('hybridPlanner' as any, version)}
            allowedModels={caps.allowedModels}
          />
          <GroupedModelVersionSelector
            label="Executor"
            selectedVersion={selectedModelVersions.hybridExecutor || 'gpt-5'}
            onVersionChange={(version) => setModelVersion('hybridExecutor' as any, version)}
            allowedModels={caps.allowedModels}
          />
        </>
      )}

      {/* Local Model: show configured model name or inline setup prompt */}
      {modelMode === 'local' && (
        <LocalModelIndicator config={localConfig} />
      )}
    </div>
  );
}

// ============================================================================
// MODEL VERSION SELECTOR (single provider)
// ============================================================================

interface ModelVersionSelectorProps {
  provider: 'claude' | 'gpt' | 'gemini' | 'deepseek';
  selectedVersion: string;
  onVersionChange: (version: string) => void;
  models: ModelVersionInfo[];
  allowedModels: string[];
  label?: string;
}

function ModelVersionSelector({
  provider,
  selectedVersion,
  onVersionChange,
  models,
  allowedModels,
}: ModelVersionSelectorProps) {
  const selectedModel = models.find((m) => m.id === selectedVersion) || models[0];

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-1.5 rounded-lg border border-border-primary bg-background-secondary px-2.5 py-2 text-sm transition-colors hover:bg-background-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary">
        <span className="text-text-secondary">{selectedModel?.name || 'Select version'}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-text-tertiary" />
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-lg border border-border-primary bg-background-elevated shadow-xl focus:outline-none">
          <div className="p-2">
            <div className="mb-2 px-3 py-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                {provider === 'claude' ? 'Anthropic Models' : provider === 'gpt' ? 'OpenAI Models' : provider === 'gemini' ? 'Gemini Models' : 'DeepSeek Models'}
              </h4>
            </div>
            {models.map((model) => {
              const isLocked = allowedModels.length > 0 && !allowedModels.includes('*') && !allowedModels.includes(model.id);
              return (
                <Menu.Item key={model.id} disabled={isLocked}>
                  {({ active }) => (
                    <button
                      onClick={() => !isLocked && onVersionChange(model.id)}
                      className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                        isLocked
                          ? 'opacity-50 cursor-not-allowed'
                          : active ? 'bg-background-hover' : ''
                      } ${model.id === selectedVersion ? 'bg-brand-primary/10' : ''}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-medium ${
                              model.id === selectedVersion
                                ? 'text-brand-primary'
                                : 'text-text-primary'
                            }`}
                          >
                            {model.name}
                          </span>
                          {isLocked && (
                            <LockClosedIcon className="h-3.5 w-3.5 text-text-quaternary" />
                          )}
                          {model.recommended && !isLocked && (
                            <span className="text-xs bg-brand-primary/20 text-brand-primary px-1.5 py-0.5 rounded">
                              Recommended
                            </span>
                          )}
                          {model.contextWindow && (
                            <span className="text-xs bg-background-tertiary text-text-tertiary px-1.5 py-0.5 rounded">
                              {model.contextWindow}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-tertiary mt-0.5">
                          {isLocked ? 'Upgrade to Pro to unlock' : model.description}
                        </p>
                      </div>
                      {model.id === selectedVersion && !isLocked && (
                        <CheckIcon className="h-4 w-4 text-brand-primary flex-shrink-0 mt-0.5" />
                      )}
                    </button>
                  )}
                </Menu.Item>
              );
            })}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

// ============================================================================
// GROUPED MODEL VERSION SELECTOR (for Both/Hybrid — sections by provider)
// ============================================================================

interface GroupedModelVersionSelectorProps {
  label: string;
  selectedVersion: string;
  onVersionChange: (version: string) => void;
  allowedModels: string[];
}

function GroupedModelVersionSelector({
  label,
  selectedVersion,
  onVersionChange,
  allowedModels,
}: GroupedModelVersionSelectorProps) {
  // Find the selected model across all providers
  const allModels = PROVIDER_IDS.flatMap(
    (pid) => MODEL_OPTIONS.find((o) => o.id === pid)?.models || []
  );
  const selectedModel = allModels.find((m) => m.id === selectedVersion) || allModels[0];

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="flex items-center gap-1.5 rounded-lg border border-border-primary bg-background-secondary px-2.5 py-2 text-sm transition-colors hover:bg-background-tertiary focus:outline-none focus:ring-2 focus:ring-brand-primary">
        <span className="text-text-quaternary text-xs mr-0.5">{label}</span>
        <span className="text-text-secondary">{selectedModel?.name || 'Select model'}</span>
        <ChevronDownIcon className="h-3.5 w-3.5 text-text-tertiary" />
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-50 mt-2 w-80 max-h-96 overflow-y-auto origin-top-right rounded-lg border border-border-primary bg-background-elevated shadow-xl focus:outline-none">
          <div className="p-2">
            {PROVIDER_IDS.map((providerId) => {
              const providerModels = MODEL_OPTIONS.find((o) => o.id === providerId)?.models || [];
              if (providerModels.length === 0) return null;
              return (
                <Fragment key={providerId}>
                  <div className="px-3 py-1.5 mt-1 first:mt-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                      {PROVIDER_NAMES[providerId]}
                    </span>
                  </div>
                  {providerModels.map((model) => {
                    const isLocked = allowedModels.length > 0 && !allowedModels.includes('*') && !allowedModels.includes(model.id);
                    return (
                      <Menu.Item key={model.id} disabled={isLocked}>
                        {({ active }) => (
                          <button
                            onClick={() => !isLocked && onVersionChange(model.id)}
                            className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                              isLocked
                                ? 'opacity-50 cursor-not-allowed'
                                : active ? 'bg-background-hover' : ''
                            } ${model.id === selectedVersion ? 'bg-brand-primary/10' : ''}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-sm font-medium ${
                                    model.id === selectedVersion
                                      ? 'text-brand-primary'
                                      : 'text-text-primary'
                                  }`}
                                >
                                  {model.name}
                                </span>
                                {isLocked && (
                                  <LockClosedIcon className="h-3.5 w-3.5 text-text-quaternary" />
                                )}
                                {model.recommended && !isLocked && (
                                  <span className="text-xs bg-brand-primary/20 text-brand-primary px-1.5 py-0.5 rounded">
                                    Recommended
                                  </span>
                                )}
                                {model.contextWindow && (
                                  <span className="text-xs bg-background-tertiary text-text-tertiary px-1.5 py-0.5 rounded">
                                    {model.contextWindow}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-text-tertiary mt-0.5">
                                {isLocked ? 'Upgrade to Pro to unlock' : model.description}
                              </p>
                            </div>
                            {model.id === selectedVersion && !isLocked && (
                              <CheckIcon className="h-4 w-4 text-brand-primary flex-shrink-0 mt-0.5" />
                            )}
                          </button>
                        )}
                      </Menu.Item>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

// ============================================================================
// LOCAL MODEL INDICATOR (for Local mode in chat header)
// ============================================================================

function LocalModelIndicator({ config }: { config: { endpoint: string; model: string } | null }) {
  if (config?.model && config?.endpoint) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-border-primary bg-background-secondary px-2.5 py-2 text-sm">
        <span className="text-text-secondary">{config.model}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Configured" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-sm">
      <span className="text-amber-500 text-xs">Configure in Settings &rarr; Models</span>
    </div>
  );
}

// ============================================================================
// COMPACT VERSION (for header/toolbar)
// ============================================================================

export function ModelSelectorCompact() {
  const modelMode = useSettingsStore((state) => state.modelMode);
  const setModelMode = useSettingsStore((state) => state.setModelMode);
  const selectedModelVersions = useSettingsStore((state) => state.selectedModelVersions);

  const selectedOption = MODEL_OPTIONS.find((opt) => opt.id === modelMode) || MODEL_OPTIONS[0];

  const cycleMode = () => {
    const availableOptions = MODEL_OPTIONS.filter((opt) => opt.available);
    const currentIndex = availableOptions.findIndex((opt) => opt.id === modelMode);
    const nextIndex = (currentIndex + 1) % availableOptions.length;
    setModelMode(availableOptions[nextIndex]!.id);
  };

  // Get the specific model name if claude or gpt
  const getDisplayName = () => {
    if (modelMode === 'claude') {
      const model = MODEL_OPTIONS.find((o) => o.id === 'claude')?.models?.find(
        (m) => m.id === selectedModelVersions.claude
      );
      return model?.name || selectedOption.name;
    } else if (modelMode === 'gpt') {
      const model = MODEL_OPTIONS.find((o) => o.id === 'gpt')?.models?.find(
        (m) => m.id === selectedModelVersions.gpt
      );
      return model?.name || selectedOption.name;
    } else if (modelMode === 'local') {
      return 'Local';
    }
    return selectedOption.name;
  };

  return (
    <button
      onClick={cycleMode}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-background-hover"
      title={`Current: ${getDisplayName()}. Click to change mode.`}
    >
      <selectedOption.icon className="h-3.5 w-3.5 text-brand-primary" />
      <span className="text-text-secondary">{getDisplayName()}</span>
    </button>
  );
}
