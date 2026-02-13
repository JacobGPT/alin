/**
 * Settings Modal - Comprehensive Settings Interface
 *
 * Full-featured settings panel with categorized sections for
 * API configuration, appearance, chat, voice, TBWO, memory, and more.
 */

import { useState } from 'react';
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
} from '@heroicons/react/24/outline';

// Store
import { useSettingsStore } from '@store/settingsStore';
import { useUIStore } from '@store/uiStore';

// Components
import { Button } from '@components/ui/Button';

// Sections
import {
  APISection,
  ModelSection,
  AppearanceSection,
  ChatSection,
  VoiceSection,
  TBWOSection,
  MemorySection,
  PrivacySection,
  PerformanceSection,
  ExperimentalSection,
} from './sections';

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

export default SettingsModal;
