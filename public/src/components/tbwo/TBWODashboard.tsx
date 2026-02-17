/**
 * TBWO Dashboard - Time-Budgeted Work Order Management Interface
 *
 * A professional, feature-rich dashboard for managing autonomous work orders.
 * Includes real-time pod visualization, progress tracking, and checkpoint approval.
 */

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  ClockIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  XCircleIcon,
  EllipsisHorizontalIcon,
  TrashIcon,
  ArrowPathIcon,
  CpuChipIcon,
  RocketLaunchIcon,
  ArrowDownTrayIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';

// Store
import { useTBWOStore } from '@store/tbwoStore';
import { useUIStore } from '@store/uiStore';
import { useSitesStore } from '@store/sitesStore';
import { usePodPoolStore } from '@store/podPoolStore';

// Components
import { Button } from '@components/ui/Button';
import { PodVisualization } from './PodVisualization';
import { CheckpointPanel } from './CheckpointPanel';
import { PodActivityTabs } from './PodActivityTabs';

// Extracted tabs
import { OverviewTab } from './tabs/OverviewTab';
import { PlanTab } from './tabs/PlanTab';
import { PauseAskTab } from './tabs/PauseAskTab';
import { BuildTab } from './tabs/BuildTab';
import { ReceiptsTab } from './tabs/ReceiptsTab';

// Extracted utils
import { STATUS_CONFIG, QUALITY_BADGES } from './utils/tbwoDashboardConstants';
import { ActionButton, QuickStat, EmptyDetailView, formatTimeAgo, formatDateTime } from './utils/tbwoDashboardHelpers';
import type { TabId } from './utils/tbwoDashboardHelpers';

// Types
import type { TBWO } from '../../types/tbwo';
import { QualityTarget } from '../../types/tbwo';

// Services
import { downloadTBWOZip, countDownloadableArtifacts } from '../../services/tbwo/zipService';

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
  // Show runtime pod count during/after execution, plan count otherwise
  const isRunOrDone = !['draft', 'planning', 'awaiting_approval'].includes(tbwo.status);
  const runtimePodCount = usePodPoolStore((s) => {
    if (!isRunOrDone) return 0;
    let count = 0;
    for (const pod of s.pool.values()) {
      if (pod.activeTBWOId === tbwo.id) count++;
    }
    return count;
  });
  const podsCount = isRunOrDone && runtimePodCount > 0 ? runtimePodCount : (tbwo.pods?.size || 0);
  const timeRemaining = tbwo.timeBudget.remaining ?? Math.max(0, (tbwo.timeBudget.total ?? 60) - (tbwo.timeBudget.elapsed ?? 0));
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
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${statusConfig.bgColor} ${statusConfig.color}`}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white whitespace-nowrap ${qualityBadge.color}`}>
              {qualityBadge.label}
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 font-semibold text-text-primary break-words">
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
          <span>{isNaN(timeRemaining) ? '\u2014' : `${Math.round(timeRemaining)}m`} left</span>
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
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const generateExecutionPlan = useTBWOStore((state) => state.generateExecutionPlan);
  const approvePlan = useTBWOStore((state) => state.approvePlan);
  const startExecution = useTBWOStore((state) => state.startExecution);
  const pauseExecution = useTBWOStore((state) => state.pauseExecution);
  const resumeExecution = useTBWOStore((state) => state.resumeExecution);
  const cancelExecution = useTBWOStore((state) => state.cancelExecution);
  const [isStarting, setIsStarting] = useState(false);

  const [isPlanning, setIsPlanning] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const fileCount = countDownloadableArtifacts(tbwo);

  // Conditional tab visibility
  const hasPauseRequests = (tbwo.pauseRequests?.length || 0) > 0 || tbwo.status === 'paused_waiting_for_user';
  const hasStartedExecution = !['draft', 'planning', 'awaiting_approval'].includes(tbwo.status);
  const isWebsiteSprint = tbwo.type === 'website_sprint';
  const showPreview = isWebsiteSprint && hasStartedExecution;
  const artifactCount = tbwo.artifacts?.length || 0;

  // Auto-switch to Build tab when execution starts (website sprints get live preview)
  useEffect(() => {
    if (tbwo.status === 'executing' && isWebsiteSprint && activeTab === 'overview') {
      setActiveTab('artifacts');
    }
    // Auto-switch to Pause & Ask when paused
    if (tbwo.status === 'paused_waiting_for_user') {
      setActiveTab('pause_ask');
    }
  }, [tbwo.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build visible tabs
  const tabs = useMemo(() => {
    const t: Array<{ id: TabId; label: string; badge?: number }> = [
      { id: 'overview', label: 'Overview' },
    ];
    if (tbwo.plan) {
      t.push({ id: 'plan', label: 'Plan' });
    }
    t.push({ id: 'pods', label: 'Pods' });
    t.push({ id: 'activity', label: 'Activity' });
    if (hasPauseRequests) {
      const pendingCount = tbwo.pauseRequests?.filter(p => p.status === 'pending').length || 0;
      t.push({ id: 'pause_ask', label: 'Pause & Ask', badge: pendingCount > 0 ? pendingCount : undefined });
    }
    if (hasStartedExecution || showPreview) {
      t.push({ id: 'artifacts', label: 'Build', badge: artifactCount > 0 ? artifactCount : undefined });
    }
    t.push({ id: 'receipts', label: 'Receipts' });
    return t;
  }, [tbwo.plan, hasPauseRequests, hasStartedExecution, showPreview, artifactCount, tbwo.pauseRequests, isWebsiteSprint, tbwo.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    try {
      await downloadTBWOZip(tbwo, tbwo.receipts);
    } catch (e) {
      console.error('[TBWO] ZIP download failed:', e);
    } finally {
      setIsDownloading(false);
    }
  };

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
    setActiveTab('activity');
    await startExecution(tbwo.id);
    setIsStarting(false);
  };

  // Auto-switch to Pause & Ask tab when there are pending questions
  useEffect(() => {
    if (tbwo.status === 'paused_waiting_for_user') {
      setActiveTab('pause_ask');
    }
    // Also auto-switch when TBWO is awaiting approval and has pre-exec questions
    if (tbwo.status === 'awaiting_approval') {
      const pendingPreExec = tbwo.pauseRequests?.filter(p => p.phase === 'pre-execution' && p.status === 'pending') || [];
      if (pendingPreExec.length > 0) {
        setActiveTab('pause_ask');
      }
    }
  }, [tbwo.status, tbwo.pauseRequests?.length]);

  const statusConfig = STATUS_CONFIG[tbwo.status] || STATUS_CONFIG.draft;
  const qualityBadge = QUALITY_BADGES[tbwo.qualityTarget];

  return (
    <div className="flex h-full flex-col">
      {/* Detail Header */}
      <div className="border-b border-border-primary bg-background-secondary px-8 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap ${statusConfig.bgColor} ${statusConfig.color}`}>
                {statusConfig.icon}
                {statusConfig.label}
              </span>
              <span className={`rounded-full px-3 py-1 text-sm font-medium text-white whitespace-nowrap ${qualityBadge.color}`}>
                {qualityBadge.label}
              </span>
              <span className="rounded-full bg-background-tertiary px-3 py-1 text-sm text-text-secondary whitespace-nowrap">
                {tbwo.type.replace('_', ' ')}
              </span>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-text-primary line-clamp-2 break-words" title={tbwo.objective || 'Untitled Work Order'}>
              {tbwo.objective || 'Untitled Work Order'}
            </h1>
            <p className="text-sm text-text-tertiary">
              Created {formatDateTime(tbwo.createdAt)}
              {tbwo.startedAt && ` \u00b7 Started ${formatDateTime(tbwo.startedAt)}`}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
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
            {tbwo.status === 'awaiting_approval' && (() => {
              const pendingPreExec = tbwo.pauseRequests?.filter(p => p.phase === 'pre-execution' && p.status === 'pending') || [];
              const hasPendingQuestions = pendingPreExec.length > 0;
              return (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab('plan')}>
                    View Plan
                  </Button>
                  {hasPendingQuestions && (
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab('pause_ask')}>
                      Answer Questions ({pendingPreExec.length})
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleApproveAndStart}
                    loading={isStarting}
                    disabled={hasPendingQuestions}
                    leftIcon={<PlayCircleIcon className="h-4 w-4" />}
                    title={hasPendingQuestions ? `Answer ${pendingPreExec.length} question(s) first` : undefined}
                  >
                    Approve & Start
                  </Button>
                </>
              );
            })()}
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
            {(tbwo.status === 'paused' || tbwo.status === 'paused_waiting_for_user') && (
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
              <>
                {fileCount > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownloadZip}
                    disabled={isDownloading}
                    leftIcon={isDownloading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ArrowDownTrayIcon className="h-4 w-4" />}
                  >
                    {isDownloading ? 'Zipping...' : `Download ZIP (${fileCount})`}
                  </Button>
                )}
                {isWebsiteSprint && (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<RocketLaunchIcon className="h-4 w-4" />}
                      onClick={async () => {
                        try {
                          const site = await useSitesStore.getState().createSite(
                            tbwo.objective || 'Untitled Site',
                            tbwo.id,
                          );
                          window.location.href = `/sites/${site.id}`;
                        } catch (e) {
                          console.error('[TBWO] Create site failed:', e);
                        }
                      }}
                    >
                      Create Site
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:bg-background-tertiary hover:text-text-primary'
              }`}
            >
              {tab.label}
              {tab.badge != null && (
                <span className={`ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-bold ${
                  activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-brand-primary/20 text-brand-primary'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <OverviewTab tbwo={tbwo} onNavigate={setActiveTab} />
            </motion.div>
          )}
          {activeTab === 'plan' && (
            <motion.div key="plan" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <PlanTab tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'pods' && (
            <motion.div key="pods" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <PodVisualization tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'activity' && (
            <motion.div key="activity" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <PodActivityTabs tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'pause_ask' && (
            <motion.div key="pause_ask" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <PauseAskTab tbwo={tbwo} />
            </motion.div>
          )}
          {activeTab === 'artifacts' && (
            <motion.div key="artifacts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <BuildTab tbwo={tbwo} isWebsiteSprint={isWebsiteSprint} />
            </motion.div>
          )}
          {activeTab === 'receipts' && (
            <motion.div key="receipts" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
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

export default TBWODashboard;
