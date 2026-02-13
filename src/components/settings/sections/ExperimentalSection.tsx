/**
 * Experimental Settings Section
 */

import { useSettingsStore } from '@store/settingsStore';
import { SectionHeader, SettingToggle } from '../helpers/SettingsHelpers';

export function ExperimentalSection() {
  const experimental = useSettingsStore((state) => state.experimental);
  const toggleExperimentalFeature = useSettingsStore((state) => state.toggleExperimentalFeature);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Experimental Features"
        description="Enable or disable experimental features"
      />

      <div className="rounded-lg bg-semantic-warning/10 p-4">
        <p className="text-sm text-semantic-warning">
          These features are experimental and may not work as expected.
        </p>
      </div>

      <SettingToggle
        label="Local Models"
        description="Use locally hosted models via Ollama"
        checked={experimental.enableLocalModels}
        onChange={() => toggleExperimentalFeature('enableLocalModels')}
      />

      <SettingToggle
        label="Image Generation"
        description="Generate images with DALL-E or Stable Diffusion"
        checked={experimental.enableImageGeneration}
        onChange={() => toggleExperimentalFeature('enableImageGeneration')}
      />

      <SettingToggle
        label="Voice"
        description="Text-to-speech and voice input"
        checked={experimental.enableVoice}
        onChange={() => toggleExperimentalFeature('enableVoice')}
      />

      <SettingToggle
        label="TBWO System"
        description="Time-Budgeted Work Orders"
        checked={experimental.enableTBWO}
        onChange={() => toggleExperimentalFeature('enableTBWO')}
      />

      <SettingToggle
        label="Memory System"
        description="8-layer cognitive memory"
        checked={experimental.enableMemory}
        onChange={() => toggleExperimentalFeature('enableMemory')}
      />

      <SettingToggle
        label="Hardware Monitoring"
        description="Real-time system resource monitoring"
        checked={experimental.enableHardwareMonitoring}
        onChange={() => toggleExperimentalFeature('enableHardwareMonitoring')}
      />

      <SettingToggle
        label="Code Execution"
        description="Execute code in a sandboxed environment"
        checked={experimental.enableCodeExecution}
        onChange={() => toggleExperimentalFeature('enableCodeExecution')}
      />

      <SettingToggle
        label="Web Research"
        description="Search the web and analyze results"
        checked={experimental.enableWebResearch}
        onChange={() => toggleExperimentalFeature('enableWebResearch')}
      />
    </div>
  );
}
