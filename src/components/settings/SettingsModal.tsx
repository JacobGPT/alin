/**
 * Settings Modal - Comprehensive Settings Interface
 *
 * Full-featured settings panel with categorized sections for
 * API configuration, appearance, chat, voice, TBWO, memory, and more.
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  XMarkIcon,
  KeyIcon,
  CpuChipIcon,
  PaintBrushIcon,
  ChatBubbleLeftRightIcon,
  SpeakerWaveIcon,
  DocumentDuplicateIcon,
  SparklesIcon,
  ShieldCheckIcon,
  BoltIcon,
  BeakerIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  ArrowPathIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  MoonIcon,
  SunIcon,
  ComputerDesktopIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

// Store
import { useSettingsStore } from '@store/settingsStore';
import { useAuthStore } from '@store/authStore';
import { useUIStore } from '@store/uiStore';
import { useMemoryStore } from '@store/memoryStore';

// Components
import { Button } from '@components/ui/Button';

// Types
import { Theme } from '../../types/ui';
import { MemoryLayer } from '../../types/memory';

// ============================================================================
// SETTINGS SECTIONS
// ============================================================================

const SETTINGS_SECTIONS = [
  { id: 'api', label: 'Account', icon: KeyIcon },
  { id: 'model', label: 'Models', icon: CpuChipIcon },
  { id: 'appearance', label: 'Appearance', icon: PaintBrushIcon },
  { id: 'chat', label: 'Chat', icon: ChatBubbleLeftRightIcon },
  { id: 'voice', label: 'Voice', icon: SpeakerWaveIcon },
  { id: 'tbwo', label: 'TBWO', icon: DocumentDuplicateIcon },
  { id: 'memory', label: 'Memory', icon: SparklesIcon },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheckIcon },
  { id: 'performance', label: 'Performance', icon: BoltIcon },
  { id: 'experimental', label: 'Experimental', icon: BeakerIcon },
];

// ============================================================================
// SETTINGS MODAL COMPONENT
// ============================================================================

export function SettingsModal() {
  const [activeSection, setActiveSection] = useState('api');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Store state
  const closeModal = useUIStore((state) => state.closeModal);
  const resetToDefaults = useSettingsStore((state) => state.resetToDefaults);
  const exportSettings = useSettingsStore((state) => state.exportSettings);
  const importSettings = useSettingsStore((state) => state.importSettings);

  // Handle export
  const handleExport = () => {
    const data = exportSettings();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alin-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle import
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          const data = e.target?.result as string;
          if (importSettings(data)) {
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 2000);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  return (
    <div className="flex h-[80vh] w-[900px] flex-col rounded-2xl bg-background-primary shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-primary px-6 py-4">
        <h2 className="text-xl font-bold text-text-primary">Settings</h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleImport} leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}>
            Import
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} leftIcon={<ArrowUpTrayIcon className="h-4 w-4" />}>
            Export
          </Button>
          <Button variant="ghost" size="sm" onClick={resetToDefaults} leftIcon={<ArrowPathIcon className="h-4 w-4" />}>
            Reset
          </Button>
          <button
            onClick={closeModal}
            className="rounded-lg p-2 text-text-tertiary hover:bg-background-tertiary hover:text-text-primary"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 flex-shrink-0 border-r border-border-primary bg-background-secondary p-4">
          <div className="space-y-1">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    activeSection === section.id
                      ? 'bg-brand-primary text-white'
                      : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {section.label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {activeSection === 'api' && <APISection />}
              {activeSection === 'model' && <ModelSection />}
              {activeSection === 'appearance' && <AppearanceSection />}
              {activeSection === 'chat' && <ChatSection />}
              {activeSection === 'voice' && <VoiceSection />}
              {activeSection === 'tbwo' && <TBWOSection />}
              {activeSection === 'memory' && <MemorySection />}
              {activeSection === 'privacy' && <PrivacySection />}
              {activeSection === 'performance' && <PerformanceSection />}
              {activeSection === 'experimental' && <ExperimentalSection />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      {saveStatus === 'saved' && (
        <div className="flex items-center justify-center border-t border-border-primary bg-semantic-success/10 px-6 py-3">
          <CheckIcon className="mr-2 h-4 w-4 text-semantic-success" />
          <span className="text-sm text-semantic-success">Settings saved successfully</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ACCOUNT SECTION (replaces API Keys — keys are now server-side)
// ============================================================================

function APISection() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/keys/status')
      .then(r => r.json())
      .then(data => setKeyStatus(data))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Account"
        description="Your account details and API key status"
      />

      {user && (
        <SettingsCard title="Profile">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Email</span>
              <span className="text-sm text-text-primary">{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Display Name</span>
              <span className="text-sm text-text-primary">{user.displayName || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">Plan</span>
              <span className={`text-sm font-semibold ${
                user.plan === 'pro' ? 'text-blue-400' :
                user.plan === 'enterprise' ? 'text-amber-400' : 'text-text-secondary'
              }`}>
                {user.plan.toUpperCase()}
              </span>
            </div>
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="API Key Status (Server-Side)">
        <div className="space-y-2">
          {[
            { key: 'anthropic', label: 'Anthropic (Claude)' },
            { key: 'openai', label: 'OpenAI (GPT)' },
            { key: 'brave', label: 'Brave Search' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-xs text-text-tertiary">{label}</span>
              <span className={`text-xs font-medium ${keyStatus[key] ? 'text-green-400' : 'text-red-400'}`}>
                {keyStatus[key] ? 'Configured' : 'Not Set'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-quaternary">
          API keys are configured in the server .env file. They never leave the server.
        </p>
      </SettingsCard>

      {user && (
        <SettingsCard title="Session">
          <button
            onClick={logout}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Sign Out
          </button>
        </SettingsCard>
      )}
    </div>
  );
}

// ============================================================================
// MODEL SECTION
// ============================================================================

function ModelSection() {
  const model = useSettingsStore((state) => state.model);
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
    </div>
  );
}

// ============================================================================
// APPEARANCE SECTION
// ============================================================================

function AppearanceSection() {
  const ui = useSettingsStore((state) => state.ui);
  const updateUIPreferences = useSettingsStore((state) => state.updateUIPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Appearance"
        description="Customize how ALIN looks and feels"
      />

      <SettingsCard title="Theme">
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: Theme.LIGHT, icon: SunIcon, label: 'Light' },
            { value: Theme.DARK, icon: MoonIcon, label: 'Dark' },
            { value: Theme.SYSTEM, icon: ComputerDesktopIcon, label: 'System' },
          ].map((theme) => {
            const Icon = theme.icon;
            return (
              <button
                key={theme.value}
                onClick={() => updateUIPreferences({ theme: theme.value })}
                className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 transition-all ${
                  ui.theme === theme.value
                    ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                    : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
                }`}
              >
                <Icon className="h-5 w-5" />
                {theme.label}
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard title="Font Size">
        <div className="grid grid-cols-3 gap-3">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => updateUIPreferences({ fontSize: size })}
              className={`rounded-lg border-2 p-3 capitalize transition-all ${
                ui.fontSize === size
                  ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                  : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Density">
        <div className="grid grid-cols-3 gap-3">
          {(['compact', 'comfortable', 'spacious'] as const).map((density) => (
            <button
              key={density}
              onClick={() => updateUIPreferences({ density })}
              className={`rounded-lg border-2 p-3 capitalize transition-all ${
                ui.density === density
                  ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
                  : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
              }`}
            >
              {density}
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard title="Accent Color">
        <div className="flex items-center gap-3">
          {['#6366f1', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#ef4444'].map((color) => (
            <button
              key={color}
              onClick={() => updateUIPreferences({ accentColor: color })}
              className={`h-8 w-8 rounded-full transition-transform hover:scale-110 ${
                ui.accentColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-background-primary' : ''
              }`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </SettingsCard>

      <SettingToggle
        label="Enable Animations"
        description="Smooth transitions and animations throughout the app"
        checked={ui.animationsEnabled}
        onChange={(checked) => updateUIPreferences({ animationsEnabled: checked })}
      />

      <SettingToggle
        label="Enable Sounds"
        description="Audio feedback for notifications and actions"
        checked={ui.soundEnabled}
        onChange={(checked) => updateUIPreferences({ soundEnabled: checked })}
      />
    </div>
  );
}

// ============================================================================
// CHAT SECTION
// ============================================================================

function ChatSection() {
  const chat = useSettingsStore((state) => state.chat);
  const updateChatPreferences = useSettingsStore((state) => state.updateChatPreferences);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Chat Preferences"
        description="Customize the chat experience"
      />

      <SettingToggle
        label="Auto Scroll"
        description="Automatically scroll to new messages"
        checked={chat.autoScroll}
        onChange={(checked) => updateChatPreferences({ autoScroll: checked })}
      />

      <SettingToggle
        label="Show Timestamps"
        description="Display message timestamps"
        checked={chat.showTimestamps}
        onChange={(checked) => updateChatPreferences({ showTimestamps: checked })}
      />

      <SettingToggle
        label="Show Token Count"
        description="Display token usage for messages"
        checked={chat.showTokenCount}
        onChange={(checked) => updateChatPreferences({ showTokenCount: checked })}
      />

      <SettingToggle
        label="Show Thinking"
        description="Display AI reasoning process"
        checked={chat.showThinking}
        onChange={(checked) => updateChatPreferences({ showThinking: checked })}
      />

      <SettingToggle
        label="Markdown Rendering"
        description="Render markdown in messages"
        checked={chat.markdownRendering}
        onChange={(checked) => updateChatPreferences({ markdownRendering: checked })}
      />

      <SettingsCard title="Code Theme">
        <select
          value={chat.codeTheme}
          onChange={(e) => updateChatPreferences({ codeTheme: e.target.value as any })}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        >
          <option value="github-dark">GitHub Dark</option>
          <option value="monokai">Monokai</option>
          <option value="dracula">Dracula</option>
          <option value="nord">Nord</option>
        </select>
      </SettingsCard>

      <SettingToggle
        label="Line Numbers"
        description="Show line numbers in code blocks"
        checked={chat.lineNumbers}
        onChange={(checked) => updateChatPreferences({ lineNumbers: checked })}
      />

      <SettingToggle
        label="Word Wrap"
        description="Wrap long lines in code blocks"
        checked={chat.wordWrap}
        onChange={(checked) => updateChatPreferences({ wordWrap: checked })}
      />
    </div>
  );
}

// ============================================================================
// VOICE SECTION
// ============================================================================

function VoiceSection() {
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

// ============================================================================
// TBWO SECTION
// ============================================================================

function TBWOSection() {
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
    </div>
  );
}

// ============================================================================
// MEMORY SECTION
// ============================================================================

function MemorySection() {
  const memory = useSettingsStore((state) => state.memory);
  const updateMemoryPreferences = useSettingsStore((state) => state.updateMemoryPreferences);
  const [showBrowser, setShowBrowser] = useState(false);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Memory Settings"
        description="Configure the 8-layer memory system"
      />

      <SettingToggle
        label="Enable Memory"
        description="Allow ALIN to form and recall memories"
        checked={memory.enabled}
        onChange={(checked) => updateMemoryPreferences({ enabled: checked })}
      />

      <SettingToggle
        label="Auto Consolidate"
        description="Automatically consolidate short-term memories"
        checked={memory.autoConsolidate}
        onChange={(checked) => updateMemoryPreferences({ autoConsolidate: checked })}
        disabled={!memory.enabled}
      />

      <SettingsCard title="Consolidation Interval (minutes)">
        <input
          type="number"
          value={memory.consolidationInterval}
          onChange={(e) => updateMemoryPreferences({ consolidationInterval: parseInt(e.target.value) })}
          min="5"
          max="120"
          disabled={!memory.enabled || !memory.autoConsolidate}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        />
      </SettingsCard>

      <SettingsCard title="Retention Period (days, 0 = forever)">
        <input
          type="number"
          value={memory.retentionPeriod}
          onChange={(e) => updateMemoryPreferences({ retentionPeriod: parseInt(e.target.value) })}
          min="0"
          disabled={!memory.enabled}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        />
      </SettingsCard>

      <SettingsCard title="Max Memories">
        <input
          type="number"
          value={memory.maxMemories}
          onChange={(e) => updateMemoryPreferences({ maxMemories: parseInt(e.target.value) })}
          min="100"
          max="100000"
          disabled={!memory.enabled}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none disabled:opacity-50"
        />
      </SettingsCard>

      {/* Memory Browser / Manager */}
      <SettingsCard title="Memory Manager">
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setShowBrowser(!showBrowser)}
              className="flex-1 rounded-lg border border-brand-primary bg-brand-primary/10 px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-primary/20 transition-colors"
            >
              {showBrowser ? 'Hide Memory Browser' : 'Browse & Manage Memories'}
            </button>
            <button
              onClick={() => useMemoryStore.getState().clearAllMemories()}
              className="flex items-center gap-2 rounded-lg border border-semantic-error bg-semantic-error/10 px-4 py-2 text-sm font-medium text-semantic-error hover:bg-semantic-error/20 transition-colors"
            >
              <TrashIcon className="h-4 w-4" />
              Clear All
            </button>
          </div>
          <MemoryStatsBar />
        </div>
      </SettingsCard>

      {showBrowser && <MemoryBrowser />}
    </div>
  );
}

// ============================================================================
// MEMORY STATS BAR
// ============================================================================

function MemoryStatsBar() {
  const memories = useMemoryStore((state) => state.memories);
  const totalCount = memories.size;

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    memories.forEach((mem) => {
      counts[mem.layer] = (counts[mem.layer] || 0) + 1;
    });
    return counts;
  }, [memories]);

  return (
    <div className="flex flex-wrap gap-2 text-xs text-text-tertiary">
      <span className="rounded bg-background-tertiary px-2 py-1">
        Total: <span className="font-medium text-text-primary">{totalCount}</span>
      </span>
      {Object.entries(layerCounts).map(([layer, count]) => (
        <span key={layer} className="rounded bg-background-tertiary px-2 py-1">
          {layer.replace('_', ' ')}: <span className="font-medium text-text-secondary">{count}</span>
        </span>
      ))}
    </div>
  );
}

// ============================================================================
// MEMORY BROWSER
// ============================================================================

function MemoryBrowser() {
  const memories = useMemoryStore((state) => state.memories);
  const deleteMemory = useMemoryStore((state) => state.deleteMemory);
  const deleteMultipleMemories = useMemoryStore((state) => state.deleteMultipleMemories);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterLayer, setFilterLayer] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter and sort memories
  const filteredMemories = useMemo(() => {
    const all = Array.from(memories.values());
    return all
      .filter((mem) => {
        if (filterLayer !== 'all' && mem.layer !== filterLayer) return false;
        if (searchQuery && !mem.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [memories, filterLayer, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredMemories.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredMemories.map((m) => m.id)));
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected memories? This cannot be undone.`)) return;
    deleteMultipleMemories(Array.from(selectedIds));
    setSelectedIds(new Set());
  };

  const formatDate = (ts: number) => {
    if (!ts || isNaN(ts) || ts <= 0) return 'Unknown';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const layerColor: Record<string, string> = {
    short_term: 'bg-blue-500/20 text-blue-400',
    long_term: 'bg-purple-500/20 text-purple-400',
    semantic: 'bg-green-500/20 text-green-400',
    relational: 'bg-pink-500/20 text-pink-400',
    procedural: 'bg-orange-500/20 text-orange-400',
    working: 'bg-yellow-500/20 text-yellow-400',
    episodic: 'bg-cyan-500/20 text-cyan-400',
    meta: 'bg-gray-500/20 text-gray-400',
  };

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-border-primary bg-background-tertiary/50 p-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
        />
        {/* Filter + actions row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <select
              value={filterLayer}
              onChange={(e) => setFilterLayer(e.target.value)}
              className="rounded-lg border border-border-primary bg-background-tertiary px-2 py-1 text-xs text-text-primary focus:border-brand-primary focus:outline-none"
            >
              <option value="all">All Layers</option>
              {Object.values(MemoryLayer).map((layer) => (
                <option key={layer} value={layer}>{layer.replace('_', ' ')}</option>
              ))}
            </select>
            <span className="text-xs text-text-tertiary">{filteredMemories.length} memories</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-background-tertiary hover:text-text-primary transition-colors"
            >
              {selectedIds.size === filteredMemories.length && filteredMemories.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                className="flex items-center gap-1 rounded bg-semantic-error/10 px-2 py-1 text-xs font-medium text-semantic-error hover:bg-semantic-error/20 transition-colors"
              >
                <TrashIcon className="h-3 w-3" />
                Delete {selectedIds.size}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Memory list */}
      <div className="max-h-[400px] overflow-y-auto divide-y divide-border-primary">
        {filteredMemories.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-tertiary">
            {memories.size === 0 ? 'No memories stored yet' : 'No memories match your filter'}
          </div>
        ) : (
          filteredMemories.map((mem) => (
            <div
              key={mem.id}
              className={`flex items-start gap-3 px-3 py-2.5 hover:bg-background-tertiary/50 transition-colors ${
                selectedIds.has(mem.id) ? 'bg-brand-primary/5' : ''
              }`}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selectedIds.has(mem.id)}
                onChange={() => toggleSelect(mem.id)}
                className="mt-1 h-3.5 w-3.5 rounded border-border-primary accent-brand-primary cursor-pointer"
              />
              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary line-clamp-2 leading-snug">{mem.content}</p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${layerColor[mem.layer] || 'bg-gray-500/20 text-gray-400'}`}>
                    {mem.layer.replace('_', ' ')}
                  </span>
                  <span className="text-[10px] text-text-quaternary">{formatDate(mem.createdAt)}</span>
                  {mem.salience > 0.7 && (
                    <span className="text-[10px] text-yellow-400">high salience</span>
                  )}
                  {mem.tags && mem.tags.length > 0 && (
                    <span className="text-[10px] text-text-quaternary">{mem.tags.slice(0, 3).join(', ')}</span>
                  )}
                </div>
              </div>
              {/* Delete individual */}
              <button
                onClick={() => {
                  deleteMemory(mem.id);
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    next.delete(mem.id);
                    return next;
                  });
                }}
                className="mt-0.5 rounded p-1 text-text-quaternary hover:bg-semantic-error/10 hover:text-semantic-error transition-colors"
                title="Delete this memory"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PRIVACY SECTION
// ============================================================================

function PrivacySection() {
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

// ============================================================================
// PERFORMANCE SECTION
// ============================================================================

function PerformanceSection() {
  const performance = useSettingsStore((state) => state.performance);
  const updatePerformanceSettings = useSettingsStore((state) => state.updatePerformanceSettings);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Performance Settings"
        description="Optimize ALIN's performance"
      />

      <SettingToggle
        label="Hardware Acceleration"
        description="Use GPU for rendering and computations"
        checked={performance.hardwareAcceleration}
        onChange={(checked) => updatePerformanceSettings({ hardwareAcceleration: checked })}
      />

      <SettingToggle
        label="GPU Offloading"
        description="Offload AI computations to GPU when available"
        checked={performance.gpuOffloading}
        onChange={(checked) => updatePerformanceSettings({ gpuOffloading: checked })}
      />

      <SettingsCard title="Max Concurrent Requests">
        <input
          type="number"
          value={performance.maxConcurrentRequests}
          onChange={(e) => updatePerformanceSettings({ maxConcurrentRequests: parseInt(e.target.value) })}
          min="1"
          max="10"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
      </SettingsCard>

      <SettingsCard title="Cache Size (MB)">
        <input
          type="number"
          value={performance.cacheSize}
          onChange={(e) => updatePerformanceSettings({ cacheSize: parseInt(e.target.value) })}
          min="10"
          max="1000"
          className="w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
        />
      </SettingsCard>

      <SettingToggle
        label="Enable Prefetch"
        description="Preload likely-needed resources"
        checked={performance.prefetchEnabled}
        onChange={(checked) => updatePerformanceSettings({ prefetchEnabled: checked })}
      />
    </div>
  );
}

// ============================================================================
// EXPERIMENTAL SECTION
// ============================================================================

function ExperimentalSection() {
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

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="text-sm text-text-tertiary">{description}</p>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-4">
      <label className="mb-2 block text-sm font-medium text-text-primary">{title}</label>
      {children}
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border border-border-primary bg-background-secondary p-4 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <p className="font-medium text-text-primary">{label}</p>
        <p className="text-sm text-text-tertiary">{description}</p>
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative h-6 w-11 rounded-full transition-colors ${
          checked ? 'bg-brand-primary' : 'bg-background-tertiary'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'left-5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export default SettingsModal;
