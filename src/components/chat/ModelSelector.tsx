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
// MODEL OPTIONS WITH DETAILED VERSIONS
// ============================================================================

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic Claude - Best for reasoning & analysis',
    icon: SparklesIcon,
    available: true,
    models: [
      {
        id: 'claude-sonnet-4-5-20250929',
        name: 'Claude Sonnet 4.5',
        description: 'Best balance of speed and quality',
        contextWindow: '200K',
        recommended: true,
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        description: 'Most capable, best for complex tasks',
        contextWindow: '200K',
      },
      {
        id: 'claude-haiku-4-5-20251001',
        name: 'Claude Haiku 4.5',
        description: 'Fastest and most cost-effective',
        contextWindow: '200K',
      },
      {
        id: 'claude-sonnet-4-20250514',
        name: 'Claude Sonnet 4',
        description: 'Previous generation Sonnet',
        contextWindow: '200K',
      },
    ],
  },
  {
    id: 'gpt',
    name: 'GPT',
    description: 'OpenAI GPT - Best for creative & code tasks',
    icon: CpuChipIcon,
    available: true,
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Most capable GPT model',
        contextWindow: '128K',
        recommended: true,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Smaller, faster GPT-4o variant',
        contextWindow: '128K',
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        description: 'Previous GPT-4 with vision',
        contextWindow: '128K',
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        description: 'Fast and cost-effective',
        contextWindow: '16K',
      },
      {
        id: 'o1-preview',
        name: 'o1 Preview',
        description: 'Reasoning model (preview)',
        contextWindow: '128K',
      },
      {
        id: 'o1-mini',
        name: 'o1 Mini',
        description: 'Smaller reasoning model',
        contextWindow: '128K',
      },
    ],
  },
  {
    id: 'both',
    name: 'Both',
    description: 'Run Claude & GPT in parallel, compare responses',
    icon: ArrowsRightLeftIcon,
    available: true,
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
    description: 'Claude plans, GPT executes (or vice versa)',
    icon: AdjustmentsHorizontalIcon,
    available: true,
  },
  {
    id: 'local',
    name: 'Local',
    description: 'Use local models (Ollama, LM Studio) - Coming soon',
    icon: ServerIcon,
    available: false,
  },
];

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
                          </div>
                          <p className="text-xs text-text-tertiary mt-0.5">
                            {option.description}
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

      {/* Model Version Selector (only for claude and gpt modes) */}
      {(modelMode === 'claude' || modelMode === 'gpt') && (
        <ModelVersionSelector
          provider={modelMode}
          selectedVersion={selectedModelVersions[modelMode]}
          onVersionChange={(version) => setModelVersion(modelMode, version)}
          models={selectedOption.models || []}
          allowedModels={caps.allowedModels}
        />
      )}
    </div>
  );
}

// ============================================================================
// MODEL VERSION SELECTOR
// ============================================================================

interface ModelVersionSelectorProps {
  provider: 'claude' | 'gpt';
  selectedVersion: string;
  onVersionChange: (version: string) => void;
  models: ModelVersionInfo[];
  allowedModels: string[];
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
                {provider === 'claude' ? 'Claude Models' : 'GPT Models'}
              </h4>
            </div>
            {models.map((model) => {
              const isLocked = allowedModels.length > 0 && !allowedModels.includes(model.id);
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
