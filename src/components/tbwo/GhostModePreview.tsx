/**
 * GhostModePreview - Shows execution plan preview before approval
 * Timeline visualization, predicted file changes, cost estimate, risk assessment
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  EyeIcon,
  PlayIcon,
  XMarkIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  DocumentIcon,
  FolderIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ShieldCheckIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import type { TBWO } from '../../types/tbwo';

interface GhostModePreviewProps {
  tbwo: TBWO;
  onApprove: () => void;
  onReject: () => void;
  onEdit?: () => void;
}

// Claude pricing estimates per 1K tokens
const COST_PER_1K_INPUT = 0.003;
const COST_PER_1K_OUTPUT = 0.015;

export const GhostModePreview: React.FC<GhostModePreviewProps> = ({
  tbwo,
  onApprove,
  onReject,
  onEdit,
}) => {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [showRisks, setShowRisks] = useState(false);

  const plan = tbwo.plan;
  if (!plan) return null;

  const costEstimate = useMemo(() => {
    const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    const estimatedInputTokens = totalTasks * 2000;
    const estimatedOutputTokens = totalTasks * 1500;
    const inputCost = (estimatedInputTokens / 1000) * COST_PER_1K_INPUT;
    const outputCost = (estimatedOutputTokens / 1000) * COST_PER_1K_OUTPUT;
    return {
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      totalCost: inputCost + outputCost,
      perTask: (inputCost + outputCost) / Math.max(1, totalTasks),
    };
  }, [plan]);

  const predictedFiles = useMemo(() => {
    const files: Array<{ path: string; action: 'create' | 'modify'; type: string }> = [];
    plan.phases.forEach(phase => {
      phase.tasks.forEach(task => {
        const name = task.name.toLowerCase();
        if (name.includes('create') || name.includes('build') || name.includes('write') || name.includes('generate')) {
          const ext = name.includes('component') || name.includes('page') ? '.tsx' :
                     name.includes('style') || name.includes('css') ? '.css' :
                     name.includes('api') || name.includes('server') ? '.ts' :
                     name.includes('config') ? '.json' :
                     name.includes('test') ? '.test.ts' : '.ts';
          files.push({
            path: `src/${task.name.replace(/\s+/g, '-').toLowerCase()}${ext}`,
            action: 'create',
            type: ext.slice(1),
          });
        }
      });
    });
    return files;
  }, [plan]);

  const totalTasks = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-background-secondary border border-border-primary rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border-primary bg-background-tertiary/50">
        <div className="flex items-center gap-2">
          <EyeIcon className="w-5 h-5 text-purple-400" />
          <h3 className="font-medium text-text-primary">Ghost Mode Preview</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
            Pre-execution
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {/* Overview Stats */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard icon={ClockIcon} label="Duration" value={`${plan.estimatedDuration} min`} color="text-blue-400" />
          <StatCard icon={CpuChipIcon} label="Tasks" value={`${totalTasks}`} color="text-green-400" />
          <StatCard icon={CurrencyDollarIcon} label="Est. Cost" value={`$${costEstimate.totalCost.toFixed(2)}`} color="text-yellow-400" />
          <StatCard icon={ShieldCheckIcon} label="Confidence" value={`${(plan.confidence * 100).toFixed(0)}%`} color="text-purple-400" />
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-text-primary">Execution Timeline</h4>
          <div className="space-y-1">
            {plan.phases.map((phase, idx) => {
              const isExpanded = expandedPhase === phase.id;
              const widthPercent = (phase.estimatedDuration / plan.estimatedDuration) * 100;
              const phaseColors = [
                'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-cyan-500'
              ];

              return (
                <div key={phase.id}>
                  <button
                    onClick={() => setExpandedPhase(isExpanded ? null : phase.id)}
                    className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-background-tertiary transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDownIcon className="w-3.5 h-3.5 text-text-tertiary" />
                    ) : (
                      <ChevronRightIcon className="w-3.5 h-3.5 text-text-tertiary" />
                    )}
                    <div className={`h-3 rounded ${phaseColors[idx % phaseColors.length]}`}
                      style={{ width: `${Math.max(widthPercent, 8)}%` }}
                    />
                    <span className="text-xs text-text-secondary flex-1 text-left truncate">{phase.name}</span>
                    <span className="text-xs text-text-tertiary">{phase.estimatedDuration} min</span>
                    <span className="text-xs text-text-tertiary">{phase.tasks.length} tasks</span>
                  </button>
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="pl-8 overflow-hidden"
                      >
                        {phase.tasks.map(task => (
                          <div key={task.id} className="flex items-center gap-2 py-1 text-xs text-text-secondary">
                            <div className="w-1.5 h-1.5 rounded-full bg-text-tertiary" />
                            <span className="flex-1">{task.name}</span>
                            {task.estimatedDuration && (
                              <span className="text-text-tertiary">{task.estimatedDuration} min</span>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        {/* Predicted File Changes */}
        {predictedFiles.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-text-primary flex items-center gap-1.5">
              <FolderIcon className="w-3.5 h-3.5" />
              Predicted File Changes
            </h4>
            <div className="bg-background-tertiary rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto">
              {predictedFiles.map((file, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <DocumentIcon className="w-3.5 h-3.5 text-text-tertiary" />
                  <span className="text-text-secondary font-mono flex-1 truncate">{file.path}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    file.action === 'create' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {file.action}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risk Assessment */}
        {plan.risks && plan.risks.length > 0 && (
          <div className="space-y-2">
            <button
              onClick={() => setShowRisks(!showRisks)}
              className="flex items-center gap-1.5 text-xs font-medium text-text-primary"
            >
              <ExclamationTriangleIcon className="w-3.5 h-3.5 text-yellow-400" />
              Risk Assessment ({plan.risks.length})
              {showRisks ? <ChevronDownIcon className="w-3 h-3" /> : <ChevronRightIcon className="w-3 h-3" />}
            </button>
            <AnimatePresence>
              {showRisks && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  {plan.risks.map((risk, i) => (
                    <div key={i} className={`p-2 rounded-lg text-xs ${
                      risk.severity === 'high' ? 'bg-red-500/10 border border-red-500/20' :
                      risk.severity === 'medium' ? 'bg-yellow-500/10 border border-yellow-500/20' :
                      'bg-blue-500/10 border border-blue-500/20'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          risk.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                          risk.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-blue-500/20 text-blue-400'
                        }`}>
                          {risk.severity}
                        </span>
                      </div>
                      <p className="text-text-secondary">{risk.description}</p>
                      <p className="text-text-tertiary mt-1">Mitigation: {risk.mitigation}</p>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Cost Breakdown */}
        <div className="bg-background-tertiary rounded-lg p-3 space-y-1">
          <h4 className="text-xs font-medium text-text-primary">Cost Estimate</h4>
          <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
            <span>Input tokens: ~{(costEstimate.inputTokens / 1000).toFixed(0)}k</span>
            <span>Output tokens: ~{(costEstimate.outputTokens / 1000).toFixed(0)}k</span>
            <span>Per task: ~${costEstimate.perTask.toFixed(3)}</span>
            <span className="font-medium text-text-primary">Total: ~${costEstimate.totalCost.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 p-4 border-t border-border-primary bg-background-tertiary/50">
        <motion.button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-medium text-sm transition-colors"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
        >
          <PlayIcon className="w-4 h-4" />
          Approve & Execute
        </motion.button>
        {onEdit && (
          <motion.button
            onClick={onEdit}
            className="px-4 py-2.5 rounded-lg bg-background-tertiary hover:bg-background-primary text-text-secondary text-sm transition-colors"
            whileTap={{ scale: 0.98 }}
          >
            Edit Plan
          </motion.button>
        )}
        <motion.button
          onClick={onReject}
          className="px-4 py-2.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors"
          whileTap={{ scale: 0.98 }}
        >
          <XMarkIcon className="w-4 h-4" />
        </motion.button>
      </div>
    </motion.div>
  );
};

const StatCard: React.FC<{
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
  color: string;
}> = ({ icon: Icon, label, value, color }) => (
  <div className="bg-background-tertiary rounded-lg p-2 text-center">
    <Icon className={`w-4 h-4 ${color} mx-auto mb-1`} />
    <p className="text-sm font-medium text-text-primary">{value}</p>
    <p className="text-[10px] text-text-tertiary">{label}</p>
  </div>
);

export default GhostModePreview;
