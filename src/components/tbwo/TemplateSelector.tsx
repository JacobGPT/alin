/**
 * TemplateSelector - Grid of template cards for creating new TBWOs
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClockIcon,
  SparklesIcon,
  XMarkIcon,
  ArrowRightIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { TBWO_TEMPLATES, type TBWOTemplate } from '../../config/tbwoTemplates';
import { useTBWOStore } from '../../store/tbwoStore';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { TBWOType } from '../../types/tbwo';
import { WebsiteSprintWizard } from './WebsiteSprintWizard';

interface TemplateSelectorProps {
  onSelect?: (templateId: string) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onSelect }) => {
  const tbwoSettings = useSettingsStore(s => s.tbwo);
  const [selectedTemplate, setSelectedTemplate] = useState<TBWOTemplate | null>(null);
  const [inputs, setInputs] = useState<Record<string, string | number>>({});
  const [timeBudget, setTimeBudget] = useState<number>(tbwoSettings.defaultTimeBudget || 60);
  const [isCreating, setIsCreating] = useState(false);
  const createTBWO = useTBWOStore(s => s.createTBWO);
  const generateExecutionPlan = useTBWOStore(s => s.generateExecutionPlan);
  const setActiveTBWO = useTBWOStore(s => s.setActiveTBWO);
  const closeModal = useUIStore(s => s.closeModal);

  const handleSelectTemplate = (template: TBWOTemplate) => {
    setSelectedTemplate(template);
    setTimeBudget(template.defaultTimeBudget);
    // Set default values
    const defaults: Record<string, string | number> = {};
    template.requiredInputs.forEach(input => {
      if (input.defaultValue !== undefined) {
        defaults[input.key] = input.defaultValue;
      }
    });
    setInputs(defaults);
  };

  // If user selected Website Sprint, render the dedicated wizard
  if (selectedTemplate?.type === TBWOType.WEBSITE_SPRINT) {
    return (
      <div className="max-h-[80vh] overflow-y-auto">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setSelectedTemplate(null)}
            className="text-text-tertiary hover:text-text-primary"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
          <span className="text-lg font-semibold text-text-primary">Website Sprint Wizard</span>
        </div>
        <WebsiteSprintWizard onComplete={onSelect} />
      </div>
    );
  }

  const handleCreate = async () => {
    if (!selectedTemplate || isCreating) return;
    setIsCreating(true);

    try {
      const objective = (inputs['objective'] as string) || selectedTemplate.description;

      const tbwoId = createTBWO({
        type: selectedTemplate.type,
        objective,
        timeBudgetMinutes: timeBudget,
        qualityTarget: (tbwoSettings.defaultQuality || selectedTemplate.defaultQuality) as any,
      });

      // Set as active TBWO so the dashboard shows it
      setActiveTBWO(tbwoId);

      // Auto-generate the execution plan
      await generateExecutionPlan(tbwoId);

      onSelect?.(tbwoId);
    } catch (e) {
      console.error('[TBWO] TemplateSelector create failed:', e);
    } finally {
      closeModal();
      setIsCreating(false);
    }
  };

  const canCreate = selectedTemplate && inputs['objective'];

  return (
    <div className="max-h-[80vh] overflow-y-auto">
      <AnimatePresence mode="wait">
        {!selectedTemplate ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Template Grid */}
            <h2 className="text-lg font-semibold text-text-primary mb-4">Choose a Template</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {TBWO_TEMPLATES.map(template => (
                <motion.button
                  key={template.id}
                  onClick={() => handleSelectTemplate(template)}
                  className="text-left p-4 rounded-xl border border-border-primary hover:border-accent-primary bg-background-secondary hover:bg-background-tertiary transition-all"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{template.icon}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-text-primary">{template.name}</h3>
                      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{template.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-text-tertiary">
                        <span className="flex items-center gap-1">
                          <ClockIcon className="w-3.5 h-3.5" />
                          {template.defaultTimeBudget} min
                        </span>
                        <span className="flex items-center gap-1">
                          <CpuChipIcon className="w-3.5 h-3.5" />
                          {template.pods.length} pods
                        </span>
                        <span className="flex items-center gap-1">
                          <SparklesIcon className="w-3.5 h-3.5" />
                          {template.defaultQuality}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="wizard"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedTemplate(null)}
                  className="text-text-tertiary hover:text-text-primary"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
                <span className="text-2xl">{selectedTemplate.icon}</span>
                <h2 className="text-lg font-semibold text-text-primary">{selectedTemplate.name}</h2>
              </div>
            </div>

            {/* Pods Preview */}
            <div className="flex flex-wrap gap-2">
              {selectedTemplate.pods.map(pod => (
                <span
                  key={pod.role}
                  className="text-xs px-2 py-1 rounded-full bg-accent-primary/10 text-accent-primary"
                  title={pod.description}
                >
                  {pod.name}
                </span>
              ))}
            </div>

            {/* Input Fields */}
            <div className="space-y-3">
              {selectedTemplate.requiredInputs.map(input => (
                <div key={input.key}>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {input.label}
                    {input.required && <span className="text-red-400 ml-1">*</span>}
                  </label>
                  {input.type === 'textarea' ? (
                    <textarea
                      value={(inputs[input.key] as string) || ''}
                      onChange={e => setInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                      placeholder={input.placeholder}
                      className="w-full px-3 py-2 bg-background-tertiary border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary resize-none"
                      rows={3}
                    />
                  ) : input.type === 'select' ? (
                    <select
                      value={(inputs[input.key] as string) || input.defaultValue || ''}
                      onChange={e => setInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                      className="w-full px-3 py-2 bg-background-tertiary border border-border-primary rounded-lg text-sm text-text-primary"
                    >
                      <option value="">Select...</option>
                      {input.options?.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : input.type === 'number' ? (
                    <input
                      type="number"
                      value={(inputs[input.key] as number) || input.defaultValue || ''}
                      onChange={e => setInputs(prev => ({ ...prev, [input.key]: parseInt(e.target.value) || 0 }))}
                      className="w-full px-3 py-2 bg-background-tertiary border border-border-primary rounded-lg text-sm text-text-primary"
                    />
                  ) : (
                    <input
                      type="text"
                      value={(inputs[input.key] as string) || ''}
                      onChange={e => setInputs(prev => ({ ...prev, [input.key]: e.target.value }))}
                      placeholder={input.placeholder}
                      className="w-full px-3 py-2 bg-background-tertiary border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary"
                    />
                  )}
                </div>
              ))}

              {/* Time Budget */}
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Time Budget (minutes)
                </label>
                <input
                  type="range"
                  min={15}
                  max={240}
                  step={15}
                  value={timeBudget}
                  onChange={e => setTimeBudget(parseInt(e.target.value))}
                  className="w-full accent-accent-primary"
                />
                <div className="flex justify-between text-xs text-text-tertiary">
                  <span>15 min</span>
                  <span className="text-text-primary font-medium">{timeBudget} min</span>
                  <span>4 hrs</span>
                </div>
              </div>
            </div>

            {/* Phases Preview */}
            <div className="bg-background-tertiary rounded-lg p-3 space-y-2">
              <h4 className="text-xs font-medium text-text-primary">Execution Phases</h4>
              {selectedTemplate.phases.map((phase, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div
                    className="h-1.5 rounded-full bg-accent-primary"
                    style={{ width: `${phase.durationPercent}%`, minWidth: '8px' }}
                  />
                  <span className="text-text-secondary flex-1">{phase.name}</span>
                  <span className="text-text-tertiary">{Math.round(timeBudget * phase.durationPercent / 100)} min</span>
                </div>
              ))}
            </div>

            {/* Create Button */}
            <motion.button
              onClick={handleCreate}
              disabled={!canCreate || isCreating}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-colors ${
                canCreate && !isCreating
                  ? 'bg-accent-primary text-white hover:bg-accent-primary/90'
                  : 'bg-background-tertiary text-text-tertiary cursor-not-allowed'
              }`}
              whileHover={canCreate && !isCreating ? { scale: 1.01 } : {}}
              whileTap={canCreate && !isCreating ? { scale: 0.99 } : {}}
            >
              {isCreating ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Creating & Planning...</span>
                </>
              ) : (
                <>
                  <span>Create TBWO</span>
                  <ArrowRightIcon className="w-4 h-4" />
                </>
              )}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TemplateSelector;
