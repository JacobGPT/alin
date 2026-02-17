/**
 * ModeSelector - ALIN Mode Selection Component
 *
 * Allows switching between ALIN modes:
 * - Regular (standard chat)
 * - Coding (text editor, file browser)
 * - Image (image generation)
 * - TBWO (time-budget workflow)
 * - Research (web search, citations)
 */

import { Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import {
  ChevronUpDownIcon,
  CheckIcon,
  ChatBubbleLeftRightIcon,
  CodeBracketIcon,
  PhotoIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  MicrophoneIcon,
} from '@heroicons/react/24/outline';

import { useModeStore } from '@store/modeStore';
import { useSettingsStore } from '@store/settingsStore';
import { type ALINMode, getAllModes, type ModeConfig } from '../../config/modes';
import { useCapabilities } from '../../hooks/useCapabilities';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { telemetry } from '../../services/telemetryService';

// ============================================================================
// ICON MAPPING
// ============================================================================

const MODE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ChatBubbleLeftRight: ChatBubbleLeftRightIcon,
  CodeBracket: CodeBracketIcon,
  Photo: PhotoIcon,
  Clock: ClockIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  Microphone: MicrophoneIcon,
};

function getModeIcon(config: ModeConfig) {
  return MODE_ICONS[config.icon] || ChatBubbleLeftRightIcon;
}

// ============================================================================
// MODE SELECTOR COMPONENT
// ============================================================================

export function ModeSelector() {
  const currentMode = useModeStore((state) => state.currentMode);
  const setMode = useModeStore((state) => state.setMode);
  const experimental = useSettingsStore((s) => s.experimental);
  const allModes = getAllModes();
  // Filter modes based on experimental feature toggles
  const modes = allModes
    .filter(mode => mode.id !== 'tbwo' || experimental.enableTBWO)
    .filter(mode => mode.id !== 'voice' || experimental.enableVoice)
    .filter(mode => mode.id !== 'image' || experimental.enableImageGeneration);
  const currentConfig = (modes.find((m) => m.id === currentMode) ?? modes[0])!;
  const CurrentIcon = getModeIcon(currentConfig);
  const caps = useCapabilities();

  // Determine which modes are locked based on capabilities
  const isModeLocked = (modeId: string): boolean => {
    if (modeId === 'coding') return !caps.canExecuteCode;
    if (modeId === 'image') return !caps.canImageGen;
    if (modeId === 'tbwo') return !caps.canTBWO;
    return false;
  };

  return (
    <Listbox value={currentMode} onChange={(mode: ALINMode) => { telemetry.modeChanged(currentMode, mode); setMode(mode); }}>
      <div className="relative">
        <Listbox.Button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-text-secondary hover:bg-background-hover hover:text-text-primary transition-colors">
          <CurrentIcon className={`h-4 w-4 ${currentConfig.color}`} />
          <span>{currentConfig.name}</span>
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-text-quaternary" />
        </Listbox.Button>

        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute left-0 z-50 mt-1 w-64 rounded-xl border border-border-primary bg-background-secondary shadow-xl focus:outline-none overflow-hidden">
            <div className="p-1.5">
              {modes.map((mode) => {
                const Icon = getModeIcon(mode);
                const locked = isModeLocked(mode.id);
                return (
                  <Listbox.Option
                    key={mode.id}
                    value={mode.id}
                    disabled={locked}
                    className={({ active }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        locked
                          ? 'opacity-50 cursor-not-allowed'
                          : `cursor-pointer ${active ? 'bg-background-hover' : ''}`
                      }`
                    }
                  >
                    {({ selected }) => (
                      <>
                        <Icon className={`h-5 w-5 flex-shrink-0 ${mode.color}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${selected ? 'text-brand-primary' : 'text-text-primary'}`}>
                              {mode.name}
                            </span>
                            {locked && (
                              <LockClosedIcon className="h-3.5 w-3.5 text-text-quaternary" />
                            )}
                            {selected && !locked && (
                              <CheckIcon className="h-3.5 w-3.5 text-brand-primary" />
                            )}
                          </div>
                          <p className="text-xs text-text-tertiary truncate">
                            {locked ? 'Upgrade to Pro to unlock' : mode.description}
                          </p>
                        </div>
                      </>
                    )}
                  </Listbox.Option>
                );
              })}
            </div>
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}
