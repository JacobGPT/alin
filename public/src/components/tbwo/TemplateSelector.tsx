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
import { TBWOType, isEphemeralType } from '../../types/tbwo';
import { useTBWOStore } from '../../store/tbwoStore';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAuthStore } from '../../store/authStore';
import { getPlanLimits } from '../../config/planLimits';

import { productUIRegistry } from '../../alin-surface/productUIRegistry';

// ── Template categories ──────────────────────────────────────
interface TemplateCategory {
  id: string;
  label: string;
  description: string;
  types: TBWOType[];
  locked?: boolean;
  requiresPlan?: string;
}

const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: 'build',
    label: 'Build',
    description: 'Create websites, apps, and digital products',
    types: [TBWOType.WEBSITE_SPRINT, TBWOType.CODE_PROJECT, TBWOType.DESIGN_SYSTEM],
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Gather intelligence, audit sites, and investigate',
    types: [TBWOType.MARKET_RESEARCH, TBWOType.DUE_DILIGENCE, TBWOType.SEO_AUDIT, TBWOType.RESEARCH_REPORT],
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Generate plans, strategies, and content',
    types: [TBWOType.BUSINESS_PLAN, TBWOType.CONTENT_STRATEGY, TBWOType.NEWSLETTER, TBWOType.CONTENT_CREATION],
  },
  {
    id: 'fun',
    label: 'Ephemeral Fun',
    description: 'Shareable pages that expire in 30 days',
    types: [TBWOType.ROAST_PAGE, TBWOType.TRIBUTE_PAGE, TBWOType.BET_TRACKER,
            TBWOType.DEBATE_PAGE, TBWOType.TIME_CAPSULE, TBWOType.SCOREBOARD],
    requiresPlan: 'spark',
  },
];

interface TemplateSelectorProps {
  onSelect?: (templateId: string) => void;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({ onSelect }) => {
  const tbwoSettings = useSettingsStore(s => s.tbwo);
  const userPlan = useAuthStore(s => s.user?.plan) || 'free';
  const planLimits = getPlanLimits(userPlan);
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

  // If the selected template has a registered product wizard, render it
  const WizardComponent = selectedTemplate ? productUIRegistry.getWizard(selectedTemplate.type) : undefined;
  if (selectedTemplate && WizardComponent) {
    return (
      <div className="max-h-[80vh] overflow-y-auto">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setSelectedTemplate(null)}
            className="text-text-tertiary hover:text-text-primary"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
          <span className="text-lg font-semibold text-text-primary">{selectedTemplate.name} Wizard</span>
        </div>
        <WizardComponent onComplete={onSelect} />
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
            <h2 className="text-lg font-semibold text-text-primary mb-4">Choose a Template</h2>

            {TEMPLATE_CATEGORIES.map(category => {
              const isGated = category.requiresPlan && !planLimits.ephemeralEnabled;
              const templates = (category.locked || isGated)
                ? TBWO_TEMPLATES.filter(t => category.types.includes(t.type))
                : TBWO_TEMPLATES.filter(t => category.types.includes(t.type));
              return (
                <div key={category.id} className="mb-5">
                  <h3 className="text-sm font-semibold text-text-secondary mb-1">{category.label}</h3>
                  <p className="text-xs text-text-tertiary mb-2">{category.description}</p>

                  {category.locked ? (
                    <div className="rounded-xl border border-border-primary bg-background-tertiary/50 p-4 flex items-center gap-3 opacity-60">
                      <svg className="h-5 w-5 text-text-quaternary flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                      <span className="text-sm text-text-tertiary">Coming soon — creative & experimental workflows</span>
                    </div>
                  ) : isGated ? (
                    <div className="rounded-xl border border-border-primary bg-background-tertiary/50 p-4 opacity-60">
                      <div className="flex items-center gap-3 mb-3">
                        <svg className="h-5 w-5 text-text-quaternary flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                        </svg>
                        <span className="text-sm text-text-tertiary">Available on Spark and above</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {templates.map(template => (
                          <div key={template.id} className="flex items-center gap-2 text-xs text-text-quaternary p-2">
                            <span>{template.icon}</span>
                            <span>{template.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {templates.map(template => (
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
                  )}
                </div>
              );
            })}
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

              {/* Reference Sites (optional — for website_sprint) */}
              {selectedTemplate.type === 'website_sprint' && (
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    Reference Sites <span className="text-text-tertiary font-normal">(optional)</span>
                  </label>
                  <p className="text-xs text-text-tertiary mb-1.5">
                    Paste up to 3 URLs of sites you like. ALIN will analyze their style, structure, and tone.
                  </p>
                  <textarea
                    value={(inputs['referenceUrls'] as string) || ''}
                    onChange={e => setInputs(prev => ({ ...prev, referenceUrls: e.target.value }))}
                    placeholder="https://example.com&#10;https://another-site.com"
                    className="w-full px-3 py-2 bg-background-tertiary border border-border-primary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary resize-none font-mono"
                    rows={2}
                  />
                </div>
              )}

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
