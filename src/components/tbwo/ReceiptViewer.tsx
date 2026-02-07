/**
 * ReceiptViewer - Two-tab viewer (Executive / Technical) with quality gauge
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DocumentTextIcon,
  WrenchScrewdriverIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ClockIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import type { TBWOReceipts } from '../../types/tbwo';

interface ReceiptViewerProps {
  receipts: TBWOReceipts;
}

type ReceiptTab = 'executive' | 'technical';

export const ReceiptViewer: React.FC<ReceiptViewerProps> = ({ receipts }) => {
  const [activeTab, setActiveTab] = useState<ReceiptTab>('executive');

  return (
    <div className="space-y-4">
      {/* Tab Selector */}
      <div className="flex gap-1 bg-background-tertiary rounded-lg p-1">
        <TabButton
          label="Executive"
          icon={DocumentTextIcon}
          active={activeTab === 'executive'}
          onClick={() => setActiveTab('executive')}
        />
        <TabButton
          label="Technical"
          icon={WrenchScrewdriverIcon}
          active={activeTab === 'technical'}
          onClick={() => setActiveTab('technical')}
        />
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'executive' ? (
          <motion.div
            key="executive"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <ExecutiveView executive={receipts.executive} />
          </motion.div>
        ) : (
          <motion.div
            key="technical"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <TechnicalView
              technical={receipts.technical}
              rollback={receipts.rollback}
              podReceipts={receipts.podReceipts}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generation timestamp */}
      <p className="text-xs text-text-tertiary text-center">
        Generated {new Date(receipts.generatedAt).toLocaleString()}
      </p>
    </div>
  );
};

const TabButton: React.FC<{
  label: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  active: boolean;
  onClick: () => void;
}> = ({ label, icon: Icon, active, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-sm transition-colors ${
      active
        ? 'bg-background-primary text-text-primary shadow-sm'
        : 'text-text-tertiary hover:text-text-secondary'
    }`}
  >
    <Icon className="w-4 h-4" />
    {label}
  </button>
);

const QualityGauge: React.FC<{ score: number }> = ({ score }) => {
  const color = score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400';
  const circumference = 2 * Math.PI * 40;
  const filled = (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8"
            className="text-background-tertiary" />
          <circle cx="50" cy="50" r="40" fill="none" strokeWidth="8"
            className={color}
            strokeDasharray={circumference}
            strokeDashoffset={circumference - filled}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xl font-bold ${color}`}>{Math.round(score)}</span>
        </div>
      </div>
      <span className="text-xs text-text-secondary mt-1">Quality Score</span>
    </div>
  );
};

const ExecutiveView: React.FC<{ executive: TBWOReceipts['executive'] }> = ({ executive }) => (
  <div className="space-y-4">
    {/* Quality + Summary */}
    <div className="flex gap-4 items-start">
      <QualityGauge score={executive.qualityScore} />
      <div className="flex-1">
        <p className="text-sm text-text-primary">{executive.summary}</p>
        <div className="flex gap-4 mt-2 text-xs text-text-secondary">
          <span>{executive.filesCreated} files created</span>
          <span>{executive.linesOfCode} lines of code</span>
        </div>
      </div>
    </div>

    {/* Accomplishments */}
    {executive.accomplishments.length > 0 && (
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-text-primary">Accomplishments</h4>
        {executive.accomplishments.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
            <CheckCircleIcon className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    )}

    {/* Unfinished Items */}
    {executive.unfinishedItems.length > 0 && (
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-text-primary">Unfinished Items</h4>
        {executive.unfinishedItems.map((item, i) => (
          <div key={i} className="flex items-start gap-2 text-xs text-text-secondary">
            <XCircleIcon className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    )}

    {/* Quality Notes */}
    {executive.qualityNotes.length > 0 && (
      <div className="bg-background-tertiary rounded-lg p-3 space-y-1">
        <h4 className="text-xs font-medium text-text-primary">Quality Notes</h4>
        {executive.qualityNotes.map((note, i) => (
          <p key={i} className="text-xs text-text-secondary">{note}</p>
        ))}
      </div>
    )}
  </div>
);

const TechnicalView: React.FC<{
  technical: TBWOReceipts['technical'];
  rollback: TBWOReceipts['rollback'];
  podReceipts: TBWOReceipts['podReceipts'];
}> = ({ technical, rollback, podReceipts }) => (
  <div className="space-y-4">
    {/* Performance Metrics */}
    <div className="grid grid-cols-2 gap-2">
      <MetricCard
        icon={ClockIcon}
        label="Execution Time"
        value={`${(technical.performanceMetrics.buildTime ?? 0).toFixed(1)} min`}
      />
      <MetricCard
        icon={CpuChipIcon}
        label="Tokens Used"
        value={`${((technical.performanceMetrics.memoryUsage ?? 0) / 1000).toFixed(0)}k`}
      />
    </div>

    {/* Build Status */}
    <div className={`flex items-center gap-2 p-2 rounded-lg text-sm ${
      technical.buildStatus === 'success' ? 'bg-green-500/10 text-green-400' :
      technical.buildStatus === 'partial' ? 'bg-yellow-500/10 text-yellow-400' :
      'bg-red-500/10 text-red-400'
    }`}>
      {technical.buildStatus === 'success' ? (
        <CheckCircleIcon className="w-4 h-4" />
      ) : (
        <XCircleIcon className="w-4 h-4" />
      )}
      Build Status: {technical.buildStatus}
    </div>

    {/* Pod Receipts */}
    {podReceipts && (() => {
      const entries: [string, any][] = podReceipts instanceof Map
        ? Array.from(podReceipts.entries())
        : Array.isArray(podReceipts as unknown) ? (podReceipts as unknown as [string, any][]) : [];
      return entries.length > 0 ? (
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-text-primary">Pod Performance</h4>
        {entries.map(([podId, receipt]: [string, any]) => (
          <div key={podId} className="bg-background-tertiary rounded-lg p-2 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="font-medium text-text-primary">{receipt.role}</span>
              <span className="text-text-secondary">{receipt.tasksCompleted || 0} tasks</span>
            </div>
            <div className="flex gap-3 text-text-tertiary">
              <span>{receipt.timeUsed?.toFixed(1) || '0'} min</span>
              <span>{receipt.artifactsProduced?.length || 0} artifacts</span>
              {receipt.tasksFailed > 0 && (
                <span className="text-red-400">{receipt.tasksFailed} failed</span>
              )}
            </div>
          </div>
        ))}
      </div>
      ) : null;
    })()}

    {/* Rollback */}
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ArrowPathIcon className="w-4 h-4 text-text-secondary" />
        <h4 className="text-xs font-medium text-text-primary">Rollback</h4>
        <span className={`text-xs px-1.5 py-0.5 rounded ${
          rollback.canRollback ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {rollback.canRollback ? 'Available' : 'N/A'}
        </span>
      </div>
      {rollback.rollbackInstructions.map((instruction, i) => (
        <p key={i} className="text-xs text-text-secondary pl-6">• {instruction.action} - {instruction.target}</p>
      ))}
      {rollback.limitations.map((limitation, i) => (
        <p key={i} className="text-xs text-text-tertiary pl-6 italic">⚠ {limitation}</p>
      ))}
    </div>
  </div>
);

const MetricCard: React.FC<{
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className="bg-background-tertiary rounded-lg p-3 flex items-center gap-3">
    <Icon className="w-5 h-5 text-text-secondary" />
    <div>
      <p className="text-xs text-text-tertiary">{label}</p>
      <p className="text-sm font-medium text-text-primary">{value}</p>
    </div>
  </div>
);

export default ReceiptViewer;
