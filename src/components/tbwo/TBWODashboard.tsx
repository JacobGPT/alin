/**
 * TBWO Dashboard - Time-Budgeted Work Order Management Interface
 *
 * A professional, feature-rich dashboard for managing autonomous work orders.
 * Includes real-time pod visualization, progress tracking, and checkpoint approval.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PlusIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  XCircleIcon,
  ChevronRightIcon,
  EllipsisHorizontalIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  ArrowPathIcon,
  SparklesIcon,
  CpuChipIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolid } from '@heroicons/react/24/solid';

// Store
import { useTBWOStore } from '@store/tbwoStore';
import { useUIStore } from '@store/uiStore';

// Components
import { Button } from '@components/ui/Button';
import { Input } from '@components/ui/Input';
import { PodVisualization } from './PodVisualization';
import { ExecutionTimeline } from './ExecutionTimeline';
import { CheckpointPanel } from './CheckpointPanel';
import { TBWOMetrics } from './TBWOMetrics';
import { TBWOChatTab } from './TBWOChatTab';

// Types
import type { TBWO, TBWOStatus, TBWOType } from '../../types/tbwo';
import { QualityTarget } from '../../types/tbwo';

// ============================================================================
// STATUS COLORS & ICONS
// ============================================================================

const STATUS_CONFIG: Record<string, { color: string; bgColor: string; icon: React.ReactNode; label: string }> = {
  draft: {
    color: 'text-text-tertiary',
    bgColor: 'bg-background-tertiary',
    icon: <DocumentDuplicateIcon className="h-4 w-4" />,
    label: 'Draft',
  },
  planning: {
    color: 'text-brand-secondary',
    bgColor: 'bg-brand-secondary/10',
    icon: <SparklesIcon className="h-4 w-4" />,
    label: 'Planning',
  },
  awaiting_approval: {
    color: 'text-semantic-warning',
    bgColor: 'bg-semantic-warning/10',
    icon: <ClockIcon className="h-4 w-4" />,
    label: 'Awaiting Approval',
  },
  executing: {
    color: 'text-brand-primary',
    bgColor: 'bg-brand-primary/10',
    icon: <PlayCircleIcon className="h-4 w-4" />,
    label: 'Executing',
  },
  checkpoint: {
    color: 'text-semantic-warning',
    bgColor: 'bg-semantic-warning/10',
    icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    label: 'Checkpoint',
  },
  paused: {
    color: 'text-text-tertiary',
    bgColor: 'bg-background-tertiary',
    icon: <PauseCircleIcon className="h-4 w-4" />,
    label: 'Paused',
  },
  completing: {
    color: 'text-semantic-success',
    bgColor: 'bg-semantic-success/10',
    icon: <ArrowPathIcon className="h-4 w-4 animate-spin" />,
    label: 'Completing',
  },
  completed: {
    color: 'text-semantic-success',
    bgColor: 'bg-semantic-success/10',
    icon: <CheckCircleSolid className="h-4 w-4" />,
    label: 'Completed',
  },
  cancelled: {
    color: 'text-semantic-error',
    bgColor: 'bg-semantic-error/10',
    icon: <XCircleIcon className="h-4 w-4" />,
    label: 'Cancelled',
  },
  failed: {
    color: 'text-semantic-error',
    bgColor: 'bg-semantic-error/10',
    icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    label: 'Failed',
  },
};

const QUALITY_BADGES: Record<QualityTarget, { color: string; label: string }> = {
  [QualityTarget.DRAFT]: { color: 'bg-gray-500', label: 'Draft' },
  [QualityTarget.STANDARD]: { color: 'bg-blue-500', label: 'Standard' },
  [QualityTarget.PREMIUM]: { color: 'bg-purple-500', label: 'Premium' },
  [QualityTarget.APPLE_LEVEL]: { color: 'bg-gradient-to-r from-pink-500 to-orange-500', label: 'Apple-Level' },
};

// ============================================================================
// TBWO DASHBOARD COMPONENT
// ============================================================================

export function TBWODashboard() {
  // Store state
  const tbwos = useTBWOStore((state) => state.tbwos);
  const activeTBWOId = useTBWOStore((state) => state.activeTBWOId);
  const statusFilter = useTBWOStore((state) => state.statusFilter);
  const setStatusFilter = useTBWOStore((state) => state.setStatusFilter);
  const setActiveTBWO = useTBWOStore((state) => state.setActiveTBWO);
  const deleteTBWO = useTBWOStore((state) => state.deleteTBWO);
  const pauseExecution = useTBWOStore((state) => state.pauseExecution);
  const resumeExecution = useTBWOStore((state) => state.resumeExecution);
  const cancelExecution = useTBWOStore((state) => state.cancelExecution);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedForAction, setSelectedForAction] = useState<string | null>(null);

  // Convert Map to array and filter
  const tbwoList = useMemo(() => {
    let list = Array.from(tbwos.values());

    // Apply status filter
    if (statusFilter !== 'all') {
      list = list.filter((tbwo) => tbwo.status === statusFilter);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (tbwo) =>
          tbwo.objective.toLowerCase().includes(query) ||
          tbwo.type.toLowerCase().includes(query)
      );
    }

    // Sort by most recent
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }, [tbwos, statusFilter, searchQuery]);

  // Get active TBWO details
  const activeTBWO = activeTBWOId ? tbwos.get(activeTBWOId) : null;

  // Stats
  const stats = useMemo(() => {
    const all = Array.from(tbwos.values());
    return {
      total: all.length,
      active: all.filter((t) => t.status === 'executing' || t.status === 'checkpoint').length,
      completed: all.filter((t) => t.status === 'completed').length,
      pending: all.filter((t) => t.status === 'awaiting_approval' || t.status === 'planning').length,
    };
  }, [tbwos]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const openModal = useUIStore((state) => state.openModal);

  const handleCreateNew = () => {
    openModal({ type: 'new-tbwo' });
  };

  const handleSelectTBWO = (id: string) => {
    setActiveTBWO(id);
  };

  const handleAction = (action: string, tbwoId: string) => {
    switch (action) {
      case 'pause':
        pauseExecution(tbwoId);
        break;
      case 'resume':
        resumeExecution(tbwoId);
        break;
      case 'cancel':
        cancelExecution(tbwoId);
        break;
      case 'delete':
        if (confirm('Are you sure you want to delete this TBWO?')) {
          deleteTBWO(tbwoId);
        }
        break;
    }
    setSelectedForAction(null);
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="flex h-full min-h-screen bg-background-primary">
      {/* Left Panel - TBWO List */}
      <div className="flex w-96 flex-shrink-0 flex-col border-r border-border-primary bg-background-secondary">
        {/* Header */}
        <div className="border-b border-border-primary p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-text-primary">Work Orders</h1>
              <p className="text-sm text-text-tertiary">
                {stats.active} active, {stats.completed} completed
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateNew}
              leftIcon={<PlusIcon className="h-4 w-4" />}
            >
              New TBWO
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              placeholder="Search work orders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border-primary bg-background-tertiary py-2 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none"
            />
          </div>

          {/* Filter Pills */}
          <div className="mt-4 flex flex-wrap gap-2">
            {(['all', 'executing', 'awaiting_approval', 'completed', 'paused'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter as any)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  statusFilter === filter
                    ? 'bg-brand-primary text-white'
                    : 'bg-background-tertiary text-text-secondary hover:bg-background-hover'
                }`}
              >
                {filter === 'all' ? 'All' : filter.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* TBWO List */}
        <div className="flex-1 overflow-y-auto p-4">
          {tbwoList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-background-tertiary">
                <RocketLaunchIcon className="h-8 w-8 text-text-tertiary" />
              </div>
              <h3 className="mb-2 font-semibold text-text-primary">No Work Orders</h3>
              <p className="mb-4 text-sm text-text-tertiary">
                Create your first TBWO to get started
              </p>
              <Button variant="primary" size="sm" onClick={handleCreateNew}>
                Create TBWO
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {tbwoList.map((tbwo) => (
                  <TBWOCard
                    key={tbwo.id}
                    tbwo={tbwo}
                    isActive={tbwo.id === activeTBWOId}
                    onSelect={() => handleSelectTBWO(tbwo.id)}
                    onAction={(action) => handleAction(action, tbwo.id)}
                    showActions={selectedForAction === tbwo.id}
                    onToggleActions={() =>
                      setSelectedForAction(selectedForAction === tbwo.id ? null : tbwo.id)
                    }
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Quick Stats */}
        <div className="border-t border-border-primary p-4">
          <div className="grid grid-cols-4 gap-2">
            <QuickStat label="Total" value={stats.total} />
            <QuickStat label="Active" value={stats.active} color="text-brand-primary" />
            <QuickStat label="Done" value={stats.completed} color="text-semantic-success" />
            <QuickStat label="Pending" value={stats.pending} color="text-semantic-warning" />
          </div>
        </div>
      </div>

      {/* Right Panel - Active TBWO Details */}
      <div className="flex-1 overflow-hidden">
        {activeTBWO ? (
          <TBWODetailView tbwo={activeTBWO} />
        ) : (
          <EmptyDetailView onCreateNew={handleCreateNew} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// TBWO CARD COMPONENT
// ============================================================================

interface TBWOCardProps {
  tbwo: TBWO;
  isActive: boolean;
  onSelect: () => void;
  onAction: (action: string) => void;
  showActions: boolean;
  onToggleActions: () => void;
}

function TBWOCard({
  tbwo,
  isActive,
  onSelect,
  onAction,
  showActions,
  onToggleActions,
}: TBWOCardProps) {
  const statusConfig = STATUS_CONFIG[tbwo.status] || STATUS_CONFIG.draft;
  const qualityBadge = QUALITY_BADGES[tbwo.qualityTarget];
  const podsCount = tbwo.pods?.size || 0;
  const timeRemaining = tbwo.timeBudget.remaining;
  const progress = tbwo.progress || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`group relative cursor-pointer rounded-xl border-2 p-4 transition-all ${
        isActive
          ? 'border-brand-primary bg-brand-primary/5'
          : 'border-transparent bg-background-primary hover:border-border-primary hover:bg-background-hover'
      }`}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${qualityBadge.color}`}>
              {qualityBadge.label}
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 font-semibold text-text-primary">
            {tbwo.objective || 'Untitled TBWO'}
          </h3>
        </div>

        {/* Actions Menu */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActions();
            }}
            className="rounded-lg p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-background-tertiary group-hover:opacity-100"
          >
            <EllipsisHorizontalIcon className="h-5 w-5" />
          </button>

          <AnimatePresence>
            {showActions && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-8 z-10 w-40 rounded-lg border border-border-primary bg-background-primary py-1 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                {tbwo.status === 'executing' && (
                  <ActionButton icon={<PauseCircleIcon />} label="Pause" onClick={() => onAction('pause')} />
                )}
                {tbwo.status === 'paused' && (
                  <ActionButton icon={<PlayCircleIcon />} label="Resume" onClick={() => onAction('resume')} />
                )}
                {['executing', 'paused', 'checkpoint'].includes(tbwo.status) && (
                  <ActionButton icon={<XCircleIcon />} label="Cancel" onClick={() => onAction('cancel')} danger />
                )}
                <ActionButton icon={<TrashIcon />} label="Delete" onClick={() => onAction('delete')} danger />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Progress Bar */}
      {tbwo.status === 'executing' && (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-text-tertiary">Progress</span>
            <span className="font-medium text-text-primary">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-brand-primary to-brand-secondary"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      )}

      {/* Footer Stats */}
      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <div className="flex items-center gap-1">
          <CpuChipIcon className="h-3.5 w-3.5" />
          <span>{podsCount} pods</span>
        </div>
        <div className="flex items-center gap-1">
          <ClockIcon className="h-3.5 w-3.5" />
          <span>{Math.round(timeRemaining)}m left</span>
        </div>
        <div className="flex-1 text-right">
          {formatTimeAgo(tbwo.updatedAt)}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// TBWO DETAIL VIEW
// ============================================================================

interface TBWODetailViewProps {
  tbwo: TBWO;
}

function TBWODetailView({ tbwo }: TBWODetailViewProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'pods' | 'timeline' | 'receipts' | 'chat'>('overview');

  const generateExecutionPlan = useTBWOStore((state) => state.generateExecutionPlan);
  const approvePlan = useTBWOStore((state) => state.approvePlan);
  const startExecution = useTBWOStore((state) => state.startExecution);
  const pauseExecution = useTBWOStore((state) => state.pauseExecution);
  const resumeExecution = useTBWOStore((state) => state.resumeExecution);
  const cancelExecution = useTBWOStore((state) => state.cancelExecution);
  const [isStarting, setIsStarting] = useState(false);

  const [isPlanning, setIsPlanning] = useState(false);

  const handleGeneratePlan = async () => {
    setIsPlanning(true);
    try {
      await generateExecutionPlan(tbwo.id);
    } catch (e) {
      console.error('[TBWO] Generate plan failed:', e);
    } finally {
      setIsPlanning(false);
    }
  };

  const handleApproveAndStart = async () => {
    setIsStarting(true);
    approvePlan(tbwo.id);
    setActiveTab('chat'); // Switch to chat tab to see live execution
    await startExecution(tbwo.id);
    setIsStarting(false);
  };

  const statusConfig = STATUS_CONFIG[tbwo.status] || STATUS_CONFIG.draft;
  const qualityBadge = QUALITY_BADGES[tbwo.qualityTarget];

  return (
    <div className="flex h-full flex-col">
      {/* Detail Header */}
      <div className="border-b border-border-primary bg-background-secondary px-8 py-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-2 flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
                {statusConfig.icon}
                {statusConfig.label}
              </span>
              <span className={`rounded-full px-3 py-1 text-sm font-medium text-white ${qualityBadge.color}`}>
                {qualityBadge.label}
              </span>
              <span className="rounded-full bg-background-tertiary px-3 py-1 text-sm text-text-secondary">
                {tbwo.type.replace('_', ' ')}
              </span>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-text-primary">
              {tbwo.objective || 'Untitled Work Order'}
            </h1>
            <p className="text-text-tertiary">
              Created {formatDateTime(tbwo.createdAt)}
              {tbwo.startedAt && ` · Started ${formatDateTime(tbwo.startedAt)}`}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {tbwo.status === 'draft' && (
              <Button variant="primary" size="sm" onClick={handleGeneratePlan} disabled={isPlanning} leftIcon={isPlanning ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}>
                {isPlanning ? 'Generating...' : 'Generate Plan'}
              </Button>
            )}
            {tbwo.status === 'planning' && (
              <Button variant="secondary" size="sm" disabled leftIcon={<ArrowPathIcon className="h-4 w-4 animate-spin" />}>
                Planning...
              </Button>
            )}
            {tbwo.status === 'awaiting_approval' && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setActiveTab('timeline')}>
                  View Plan
                </Button>
                <Button variant="primary" size="sm" onClick={handleApproveAndStart} loading={isStarting} leftIcon={<PlayCircleIcon className="h-4 w-4" />}>
                  Approve & Start
                </Button>
              </>
            )}
            {tbwo.status === 'executing' && (
              <>
                <Button variant="secondary" size="sm" leftIcon={<PauseCircleIcon className="h-4 w-4" />} onClick={() => pauseExecution(tbwo.id)}>
                  Pause
                </Button>
                <Button variant="secondary" size="sm" leftIcon={<XCircleIcon className="h-4 w-4 text-semantic-error" />} onClick={() => cancelExecution(tbwo.id)}>
                  Stop
                </Button>
              </>
            )}
            {tbwo.status === 'paused' && (
              <>
                <Button variant="primary" size="sm" leftIcon={<PlayCircleIcon className="h-4 w-4" />} onClick={() => resumeExecution(tbwo.id)}>
                  Resume
                </Button>
                <Button variant="secondary" size="sm" leftIcon={<XCircleIcon className="h-4 w-4 text-semantic-error" />} onClick={() => cancelExecution(tbwo.id)}>
                  Stop
                </Button>
              </>
            )}
            {tbwo.status === 'completed' && (
              <Button variant="primary" size="sm" onClick={() => setActiveTab('receipts')}>
                View Receipts
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1">
          {(['overview', 'pods', 'timeline', 'chat', 'receipts'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <OverviewTab tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'pods' && (
            <motion.div
              key="pods"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <PodVisualization tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'timeline' && (
            <motion.div
              key="timeline"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ExecutionTimeline tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <TBWOChatTab tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'receipts' && (
            <motion.div
              key="receipts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ReceiptsTab tbwo={tbwo} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Checkpoint Panel (if applicable) */}
      {tbwo.status === 'checkpoint' && (
        <CheckpointPanel tbwo={tbwo} />
      )}
    </div>
  );
}

// ============================================================================
// OVERVIEW TAB
// ============================================================================

function OverviewTab({ tbwo }: { tbwo: TBWO }) {
  const podsArray = Array.from(tbwo.pods?.values() || []);

  return (
    <div className="space-y-8">
      {/* Metrics Grid */}
      <TBWOMetrics tbwo={tbwo} />

      {/* Time Budget */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 font-semibold text-text-primary">Time Budget</h3>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-2xl font-bold text-text-primary">
              {tbwo.timeBudget.total}
              <span className="text-base font-normal text-text-tertiary"> min</span>
            </p>
            <p className="text-sm text-text-tertiary">Total Budget</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-brand-primary">
              {Math.round(tbwo.timeBudget.elapsed)}
              <span className="text-base font-normal text-text-tertiary"> min</span>
            </p>
            <p className="text-sm text-text-tertiary">Time Elapsed</p>
          </div>
          <div>
            <p className={`text-2xl font-bold ${
              tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.1
                ? 'text-semantic-error'
                : tbwo.timeBudget.remaining < tbwo.timeBudget.total * 0.25
                ? 'text-semantic-warning'
                : 'text-semantic-success'
            }`}>
              {Math.round(tbwo.timeBudget.remaining)}
              <span className="text-base font-normal text-text-tertiary"> min</span>
            </p>
            <p className="text-sm text-text-tertiary">Time Remaining</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="h-3 overflow-hidden rounded-full bg-background-tertiary">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-brand-primary via-brand-secondary to-brand-accent"
              initial={{ width: 0 }}
              animate={{ width: `${(tbwo.timeBudget.elapsed / tbwo.timeBudget.total) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </div>

      {/* Active Pods Summary */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-text-primary">Active Pods</h3>
          <span className="text-sm text-text-tertiary">{podsArray.length} total</span>
        </div>

        {podsArray.length === 0 ? (
          <p className="text-sm text-text-tertiary">No pods spawned yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {podsArray.slice(0, 4).map((pod) => (
              <div
                key={pod.id}
                className="flex items-center gap-3 rounded-lg bg-background-tertiary p-3"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                  pod.status === 'working'
                    ? 'bg-brand-primary/20 text-brand-primary'
                    : pod.status === 'idle'
                    ? 'bg-semantic-success/20 text-semantic-success'
                    : 'bg-background-elevated text-text-tertiary'
                }`}>
                  <CpuChipIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-text-primary">{pod.name}</p>
                  <p className="text-xs text-text-tertiary">{pod.role} · {pod.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Execution Plan */}
      {tbwo.plan && (
        <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
          <h3 className="mb-4 font-semibold text-text-primary">Execution Plan</h3>
          <div className="space-y-3">
            {tbwo.plan.phases.map((phase, index) => (
              <div
                key={phase.id}
                className="flex items-center gap-4 rounded-lg bg-background-tertiary p-4"
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                  phase.status === 'complete'
                    ? 'bg-semantic-success text-white'
                    : phase.status === 'in_progress'
                    ? 'bg-brand-primary text-white'
                    : 'bg-background-elevated text-text-tertiary'
                }`}>
                  {phase.status === 'complete' ? <CheckCircleSolid className="h-5 w-5" /> : index + 1}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-text-primary">{phase.name}</p>
                  <p className="text-sm text-text-tertiary">{phase.description}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-text-primary">{Math.round(phase.progress)}%</p>
                  <p className="text-xs text-text-tertiary">{phase.estimatedDuration} min</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// RECEIPTS TAB
// ============================================================================

function ReceiptsTab({ tbwo }: { tbwo: TBWO }) {
  if (!tbwo.receipts) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <DocumentDuplicateIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Receipts Yet</h3>
        <p className="text-sm text-text-tertiary">
          Receipts will be generated when the TBWO completes
        </p>
      </div>
    );
  }

  const { executive, technical } = tbwo.receipts;

  return (
    <div className="space-y-6">
      {/* Executive Summary */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-text-primary">
          <SparklesIcon className="h-5 w-5 text-brand-primary" />
          Executive Summary
        </h3>
        <p className="mb-4 text-text-secondary">{executive.summary}</p>

        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-background-tertiary p-4">
            <p className="text-2xl font-bold text-text-primary">{executive.filesCreated}</p>
            <p className="text-sm text-text-tertiary">Files Created</p>
          </div>
          <div className="rounded-lg bg-background-tertiary p-4">
            <p className="text-2xl font-bold text-text-primary">{executive.linesOfCode}</p>
            <p className="text-sm text-text-tertiary">Lines of Code</p>
          </div>
          <div className="rounded-lg bg-background-tertiary p-4">
            <p className="text-2xl font-bold text-semantic-success">{executive.qualityScore}%</p>
            <p className="text-sm text-text-tertiary">Quality Score</p>
          </div>
        </div>

        {executive.accomplishments.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-sm font-medium text-text-primary">Accomplishments</h4>
            <ul className="space-y-1">
              {executive.accomplishments.map((item, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-text-secondary">
                  <CheckCircleSolid className="h-4 w-4 text-semantic-success" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Technical Details */}
      <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-text-primary">
          <CpuChipIcon className="h-5 w-5 text-brand-secondary" />
          Technical Details
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-background-tertiary px-4 py-3">
            <span className="text-text-secondary">Build Status</span>
            <span className={`font-medium ${
              technical.buildStatus === 'success'
                ? 'text-semantic-success'
                : technical.buildStatus === 'failed'
                ? 'text-semantic-error'
                : 'text-semantic-warning'
            }`}>
              {technical.buildStatus}
            </span>
          </div>
          {technical.dependencies?.length > 0 && (
            <div className="rounded-lg bg-background-tertiary p-4">
              <p className="mb-2 text-sm font-medium text-text-primary">Dependencies</p>
              <div className="flex flex-wrap gap-2">
                {technical.dependencies.map((dep, i) => (
                  <span key={i} className="rounded-full bg-background-elevated px-3 py-1 text-xs text-text-secondary">
                    {typeof dep === 'string' ? dep : `${dep.name}@${dep.version}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EMPTY STATE
// ============================================================================

function EmptyDetailView({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary"
      >
        <RocketLaunchIcon className="h-12 w-12 text-white" />
      </motion.div>
      <h2 className="mb-2 text-2xl font-bold text-text-primary">
        Select a Work Order
      </h2>
      <p className="mb-6 max-w-md text-text-tertiary">
        Choose a TBWO from the list to view details, monitor progress, and manage execution.
        Or create a new one to get started.
      </p>
      <Button variant="primary" onClick={onCreateNew} leftIcon={<PlusIcon className="h-4 w-4" />}>
        Create New TBWO
      </Button>
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
        danger
          ? 'text-semantic-error hover:bg-semantic-error/10'
          : 'text-text-primary hover:bg-background-hover'
      }`}
    >
      <span className="h-4 w-4">{icon}</span>
      {label}
    </button>
  );
}

function QuickStat({
  label,
  value,
  color = 'text-text-primary',
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-text-tertiary">{label}</p>
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default TBWODashboard;
