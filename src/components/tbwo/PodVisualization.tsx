/**
 * Pod Visualization - Real-time Agent Pod Display
 *
 * Displays active pods with their status, health, and resource usage.
 * Includes a visual network graph showing pod relationships and communication.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CpuChipIcon,
  SignalIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  ArrowPathIcon,
  XCircleIcon,
  ChevronDownIcon,
  BoltIcon,
  ClockIcon,
  CodeBracketIcon,
} from '@heroicons/react/24/outline';

// Components
import { PodVisualization3D } from './PodVisualization3D';

// Store
import { useTBWOStore } from '@store/tbwoStore';

// Types
import type { TBWO, AgentPod, PodRole } from '../../types/tbwo';
import { PodStatus } from '../../types/tbwo';

// ============================================================================
// POD ROLE CONFIG
// ============================================================================

const POD_ROLE_CONFIG: Record<string, {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
  label: string;
  description: string;
}> = {
  orchestrator: {
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    icon: '🎯',
    label: 'Orchestrator',
    description: 'Coordinates all pod activities',
  },
  design: {
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/30',
    icon: '🎨',
    label: 'Design',
    description: 'UI/UX and visual design',
  },
  frontend: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    icon: '💻',
    label: 'Frontend',
    description: 'React components and UI code',
  },
  backend: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/30',
    icon: '⚙️',
    label: 'Backend',
    description: 'API and server logic',
  },
  motion: {
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
    icon: '✨',
    label: 'Motion',
    description: 'Animations and interactions',
  },
  copy: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
    icon: '📝',
    label: 'Copy',
    description: 'Content and copywriting',
  },
  qa: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    icon: '🔍',
    label: 'QA',
    description: 'Testing and quality assurance',
  },
  devops: {
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
    icon: '🚀',
    label: 'DevOps',
    description: 'Deployment and infrastructure',
  },
};

const POD_STATUS_CONFIG: Record<string, {
  color: string;
  bgColor: string;
  icon: React.ReactNode;
  label: string;
}> = {
  [PodStatus.INITIALIZING]: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    icon: <ArrowPathIcon className="h-4 w-4 animate-spin" />,
    label: 'Initializing',
  },
  [PodStatus.IDLE]: {
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/10',
    icon: <PauseCircleIcon className="h-4 w-4" />,
    label: 'Idle',
  },
  [PodStatus.WORKING]: {
    color: 'text-brand-primary',
    bgColor: 'bg-brand-primary/10',
    icon: <PlayCircleIcon className="h-4 w-4" />,
    label: 'Working',
  },
  [PodStatus.WAITING]: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    icon: <ClockIcon className="h-4 w-4" />,
    label: 'Waiting',
  },
  [PodStatus.CHECKPOINT]: {
    color: 'text-semantic-warning',
    bgColor: 'bg-semantic-warning/10',
    icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    label: 'Checkpoint',
  },
  [PodStatus.COMPLETE]: {
    color: 'text-semantic-success',
    bgColor: 'bg-semantic-success/10',
    icon: <CheckCircleIcon className="h-4 w-4" />,
    label: 'Complete',
  },
  [PodStatus.FAILED]: {
    color: 'text-semantic-error',
    bgColor: 'bg-semantic-error/10',
    icon: <ExclamationTriangleIcon className="h-4 w-4" />,
    label: 'Failed',
  },
  [PodStatus.TERMINATED]: {
    color: 'text-gray-500',
    bgColor: 'bg-gray-500/10',
    icon: <XCircleIcon className="h-4 w-4" />,
    label: 'Terminated',
  },
};

// ============================================================================
// POD VISUALIZATION COMPONENT
// ============================================================================

interface PodVisualizationProps {
  tbwo: TBWO;
}

export function PodVisualization({ tbwo }: PodVisualizationProps) {
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'network' | '3d'>('grid');

  // Convert pods map to array
  const pods = useMemo(() => Array.from(tbwo.pods?.values() || []), [tbwo.pods]);
  const activePods = useMemo(
    () => pods.filter((p) => p.status !== PodStatus.TERMINATED),
    [pods]
  );

  // Group pods by role
  const podsByRole = useMemo(() => {
    const grouped: Record<string, AgentPod[]> = {};
    pods.forEach((pod) => {
      if (!grouped[pod.role]) {
        grouped[pod.role] = [];
      }
      grouped[pod.role].push(pod);
    });
    return grouped;
  }, [pods]);

  // Calculate aggregate stats
  const stats = useMemo(() => {
    let totalTokens = 0;
    let totalApiCalls = 0;
    let totalCpu = 0;
    let totalMemory = 0;

    pods.forEach((pod) => {
      totalTokens += pod.resourceUsage?.tokensUsed || 0;
      totalApiCalls += pod.resourceUsage?.apiCalls || 0;
      totalCpu += pod.resourceUsage?.cpuPercent || 0;
      totalMemory += pod.resourceUsage?.memoryMB || 0;
    });

    return {
      totalPods: pods.length,
      activePods: activePods.length,
      totalTokens,
      totalApiCalls,
      avgCpu: pods.length > 0 ? totalCpu / pods.length : 0,
      totalMemory,
    };
  }, [pods, activePods]);

  // Get selected pod details
  const selectedPodData = selectedPod ? pods.find((p) => p.id === selectedPod) : null;

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-text-primary">Pod Network</h2>
          <p className="text-sm text-text-tertiary">
            {stats.activePods} active pods using {stats.totalTokens.toLocaleString()} tokens
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2 rounded-lg bg-background-tertiary p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'grid'
                ? 'bg-background-primary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            Grid View
          </button>
          <button
            onClick={() => setViewMode('network')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'network'
                ? 'bg-background-primary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            Network View
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === '3d'
                ? 'bg-background-primary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
          >
            3D View
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-6 gap-4">
        <StatCard label="Total Pods" value={stats.totalPods} icon={<CpuChipIcon className="h-5 w-5" />} />
        <StatCard label="Active" value={stats.activePods} icon={<PlayCircleIcon className="h-5 w-5" />} color="text-semantic-success" />
        <StatCard label="API Calls" value={stats.totalApiCalls} icon={<BoltIcon className="h-5 w-5" />} />
        <StatCard label="Tokens Used" value={`${(stats.totalTokens / 1000).toFixed(1)}k`} icon={<CodeBracketIcon className="h-5 w-5" />} />
        <StatCard label="Avg CPU" value={`${stats.avgCpu.toFixed(1)}%`} icon={<CpuChipIcon className="h-5 w-5" />} />
        <StatCard label="Memory" value={`${stats.totalMemory}MB`} icon={<SignalIcon className="h-5 w-5" />} />
      </div>

      {/* Main Content */}
      <div className="flex gap-6">
        {/* Pod Grid/Network */}
        <div className="flex-1">
          {pods.length === 0 ? (
            <EmptyPodState />
          ) : viewMode === '3d' ? (
            <div className="flex items-center justify-center rounded-xl border border-border-primary bg-background-secondary p-6">
              <PodVisualization3D
                tbwoId={tbwo.id}
                onSelectPod={(podId) => setSelectedPod(podId === selectedPod ? null : podId)}
                selectedPodId={selectedPod || undefined}
              />
            </div>
          ) : viewMode === 'grid' ? (
            <PodGrid
              pods={pods}
              selectedPod={selectedPod}
              onSelectPod={setSelectedPod}
            />
          ) : (
            <PodNetworkGraph
              pods={pods}
              selectedPod={selectedPod}
              onSelectPod={setSelectedPod}
            />
          )}
        </div>

        {/* Pod Detail Panel */}
        <AnimatePresence>
          {selectedPodData && (
            <motion.div
              initial={{ opacity: 0, x: 20, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 320 }}
              exit={{ opacity: 0, x: 20, width: 0 }}
              className="w-80 flex-shrink-0"
            >
              <PodDetailPanel pod={selectedPodData} onClose={() => setSelectedPod(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================================
// POD GRID
// ============================================================================

interface PodGridProps {
  pods: AgentPod[];
  selectedPod: string | null;
  onSelectPod: (id: string | null) => void;
}

function PodGrid({ pods, selectedPod, onSelectPod }: PodGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <AnimatePresence>
        {pods.map((pod) => (
          <PodCard
            key={pod.id}
            pod={pod}
            isSelected={pod.id === selectedPod}
            onClick={() => onSelectPod(pod.id === selectedPod ? null : pod.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// POD CARD
// ============================================================================

interface PodCardProps {
  pod: AgentPod;
  isSelected: boolean;
  onClick: () => void;
}

function PodCard({ pod, isSelected, onClick }: PodCardProps) {
  const roleConfig = POD_ROLE_CONFIG[pod.role] || POD_ROLE_CONFIG.frontend;
  const statusConfig = POD_STATUS_CONFIG[pod.status] || POD_STATUS_CONFIG.idle;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${
        isSelected
          ? `${roleConfig.borderColor} ${roleConfig.bgColor}`
          : 'border-border-primary bg-background-secondary hover:border-border-secondary'
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl ${roleConfig.bgColor}`}>
            {roleConfig.icon}
          </div>
          <div>
            <p className={`font-semibold ${roleConfig.color}`}>{roleConfig.label}</p>
            <p className="text-xs text-text-tertiary">{pod.name}</p>
          </div>
        </div>

        {/* Health Indicator */}
        <div className={`h-3 w-3 rounded-full ${
          pod.health.status === 'healthy'
            ? 'bg-semantic-success'
            : (pod.health.status as string) === 'degraded'
            ? 'bg-semantic-warning'
            : 'bg-semantic-error'
        }`}>
          {pod.status === PodStatus.WORKING && (
            <motion.div
              className="h-full w-full rounded-full bg-inherit"
              animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
        </div>
      </div>

      {/* Status Badge */}
      <div className={`mb-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusConfig.bgColor} ${statusConfig.color}`}>
        {statusConfig.icon}
        {statusConfig.label}
      </div>

      {/* Current Task */}
      {pod.currentTask && (
        <div className="mb-3 rounded-lg bg-background-tertiary p-2">
          <p className="text-xs text-text-tertiary">Current Task</p>
          <p className="line-clamp-1 text-sm text-text-primary">{pod.currentTask.name}</p>
        </div>
      )}

      {/* Resource Usage */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-text-tertiary">CPU: </span>
          <span className="font-medium text-text-primary">{pod.resourceUsage?.cpuPercent || 0}%</span>
        </div>
        <div>
          <span className="text-text-tertiary">Memory: </span>
          <span className="font-medium text-text-primary">{pod.resourceUsage?.memoryMB || 0}MB</span>
        </div>
        <div>
          <span className="text-text-tertiary">Tokens: </span>
          <span className="font-medium text-text-primary">{(pod.resourceUsage?.tokensUsed || 0).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-text-tertiary">Tasks: </span>
          <span className="font-medium text-text-primary">{pod.completedTasks?.length || 0}</span>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// POD NETWORK GRAPH
// ============================================================================

function PodNetworkGraph({ pods, selectedPod, onSelectPod }: PodGridProps) {
  // Calculate positions in a circle around the orchestrator
  const positions = useMemo(() => {
    const centerX = 200;
    const centerY = 200;
    const radius = 150;
    const posMap: Record<string, { x: number; y: number }> = {};

    const orchestrators = pods.filter((p) => p.role === 'orchestrator');
    const others = pods.filter((p) => p.role !== 'orchestrator');

    // Place orchestrators in center
    orchestrators.forEach((pod, i) => {
      posMap[pod.id] = { x: centerX + i * 30, y: centerY };
    });

    // Place others in a circle
    others.forEach((pod, i) => {
      const angle = (i / others.length) * 2 * Math.PI - Math.PI / 2;
      posMap[pod.id] = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });

    return posMap;
  }, [pods]);

  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-6">
      <svg viewBox="0 0 400 400" className="h-96 w-full">
        {/* Connection Lines */}
        {pods
          .filter((p) => p.role === 'orchestrator')
          .map((orchestrator) =>
            pods
              .filter((p) => p.role !== 'orchestrator')
              .map((pod) => (
                <motion.line
                  key={`${orchestrator.id}-${pod.id}`}
                  x1={positions[orchestrator.id]?.x || 200}
                  y1={positions[orchestrator.id]?.y || 200}
                  x2={positions[pod.id]?.x || 200}
                  y2={positions[pod.id]?.y || 200}
                  stroke={pod.status === PodStatus.WORKING ? '#6366f1' : '#374151'}
                  strokeWidth={pod.status === PodStatus.WORKING ? 2 : 1}
                  strokeDasharray={pod.status === 'waiting' ? '5,5' : undefined}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5 }}
                />
              ))
          )}

        {/* Pod Nodes */}
        {pods.map((pod) => {
          const pos = positions[pod.id] || { x: 200, y: 200 };
          const roleConfig = POD_ROLE_CONFIG[pod.role] || POD_ROLE_CONFIG.frontend;

          return (
            <g
              key={pod.id}
              onClick={() => onSelectPod(pod.id === selectedPod ? null : pod.id)}
              className="cursor-pointer"
            >
              {/* Pulse animation for working pods */}
              {pod.status === PodStatus.WORKING && (
                <motion.circle
                  cx={pos.x}
                  cy={pos.y}
                  r={30}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth={2}
                  initial={{ r: 20, opacity: 1 }}
                  animate={{ r: 40, opacity: 0 }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}

              {/* Main circle */}
              <motion.circle
                cx={pos.x}
                cy={pos.y}
                r={pod.role === 'orchestrator' ? 35 : 25}
                className={pod.id === selectedPod ? 'fill-brand-primary' : 'fill-background-tertiary'}
                stroke={pod.id === selectedPod ? '#6366f1' : '#374151'}
                strokeWidth={2}
                whileHover={{ scale: 1.1 }}
              />

              {/* Role icon */}
              <text
                x={pos.x}
                y={pos.y + 5}
                textAnchor="middle"
                className="text-lg"
              >
                {roleConfig.icon}
              </text>

              {/* Label */}
              <text
                x={pos.x}
                y={pos.y + (pod.role === 'orchestrator' ? 55 : 45)}
                textAnchor="middle"
                className="fill-text-secondary text-xs"
              >
                {roleConfig.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================================
// POD DETAIL PANEL
// ============================================================================

interface PodDetailPanelProps {
  pod: AgentPod;
  onClose: () => void;
}

function PodDetailPanel({ pod, onClose }: PodDetailPanelProps) {
  const roleConfig = POD_ROLE_CONFIG[pod.role] || POD_ROLE_CONFIG.frontend;
  const statusConfig = POD_STATUS_CONFIG[pod.status] || POD_STATUS_CONFIG.idle;
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="h-full rounded-xl border border-border-primary bg-background-secondary">
      {/* Header */}
      <div className={`rounded-t-xl p-4 ${roleConfig.bgColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{roleConfig.icon}</span>
            <div>
              <h3 className={`font-bold ${roleConfig.color}`}>{roleConfig.label}</h3>
              <p className="text-xs text-text-tertiary">{pod.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-tertiary hover:bg-background-tertiary hover:text-text-primary"
          >
            <XCircleIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Status */}
        <div>
          <p className="mb-1 text-xs font-medium text-text-tertiary">Status</p>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 ${statusConfig.bgColor} ${statusConfig.color}`}>
            {statusConfig.icon}
            <span className="text-sm font-medium">{statusConfig.label}</span>
          </div>
        </div>

        {/* Health */}
        <div>
          <p className="mb-1 text-xs font-medium text-text-tertiary">Health</p>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${
              pod.health.status === 'healthy'
                ? 'bg-semantic-success'
                : (pod.health.status as string) === 'degraded'
                ? 'bg-semantic-warning'
                : 'bg-semantic-error'
            }`} />
            <span className="text-sm text-text-primary capitalize">{pod.health.status}</span>
            {pod.health.errorCount > 0 && (
              <span className="text-xs text-semantic-error">({pod.health.errorCount} errors)</span>
            )}
          </div>
        </div>

        {/* Current Task */}
        {pod.currentTask && (
          <div>
            <p className="mb-1 text-xs font-medium text-text-tertiary">Current Task</p>
            <div className="rounded-lg bg-background-tertiary p-3">
              <p className="font-medium text-text-primary">{pod.currentTask.name}</p>
              {pod.currentTask.description && (
                <p className="mt-1 text-sm text-text-secondary">{pod.currentTask.description}</p>
              )}
            </div>
          </div>
        )}

        {/* Resource Usage */}
        <div>
          <p className="mb-2 text-xs font-medium text-text-tertiary">Resource Usage</p>
          <div className="space-y-2">
            <ResourceBar label="CPU" value={pod.resourceUsage?.cpuPercent || 0} max={100} unit="%" />
            <ResourceBar label="Memory" value={pod.resourceUsage?.memoryMB || 0} max={512} unit="MB" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-tertiary">Tokens Used</span>
              <span className="font-medium text-text-primary">{(pod.resourceUsage?.tokensUsed || 0).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-tertiary">API Calls</span>
              <span className="font-medium text-text-primary">{pod.resourceUsage?.apiCalls || 0}</span>
            </div>
          </div>
        </div>

        {/* Task Stats */}
        <div>
          <p className="mb-2 text-xs font-medium text-text-tertiary">Task Statistics</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-background-tertiary p-2 text-center">
              <p className="text-lg font-bold text-text-primary">{pod.taskQueue?.length || 0}</p>
              <p className="text-xs text-text-tertiary">Queued</p>
            </div>
            <div className="rounded-lg bg-background-tertiary p-2 text-center">
              <p className="text-lg font-bold text-semantic-success">{pod.completedTasks?.length || 0}</p>
              <p className="text-xs text-text-tertiary">Done</p>
            </div>
            <div className="rounded-lg bg-background-tertiary p-2 text-center">
              <p className="text-lg font-bold text-text-primary">
                {Math.round((pod.resourceUsage?.executionTime || 0) / 1000)}s
              </p>
              <p className="text-xs text-text-tertiary">Runtime</p>
            </div>
          </div>
        </div>

        {/* Logs Toggle */}
        <div>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex w-full items-center justify-between rounded-lg bg-background-tertiary p-3 text-sm font-medium text-text-primary hover:bg-background-hover"
          >
            <span>View Logs</span>
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${showLogs ? 'rotate-180' : ''}`} />
          </button>

          <AnimatePresence>
            {showLogs && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-background-tertiary p-3 font-mono text-xs">
                  {pod.messageLog?.length ? (
                    pod.messageLog.slice(-20).map((log, i) => (
                      <div key={i} className="mb-1 text-text-secondary">
                        <span className="text-text-quaternary">[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                        {String(log.content)}
                      </div>
                    ))
                  ) : (
                    <p className="text-text-tertiary">No logs available</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function StatCard({
  label,
  value,
  icon,
  color = 'text-text-primary',
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border-primary bg-background-secondary p-4">
      <div className="mb-2 flex items-center gap-2 text-text-tertiary">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function ResourceBar({
  label,
  value,
  max,
  unit,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
}) {
  const percentage = Math.min((value / max) * 100, 100);
  const color = percentage > 80 ? 'bg-semantic-error' : percentage > 60 ? 'bg-semantic-warning' : 'bg-brand-primary';

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-text-tertiary">{label}</span>
        <span className="font-medium text-text-primary">{value}{unit}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
    </div>
  );
}

function EmptyPodState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border-primary bg-background-secondary py-16 text-center">
      <CpuChipIcon className="mb-4 h-12 w-12 text-text-tertiary" />
      <h3 className="mb-2 font-semibold text-text-primary">No Pods Active</h3>
      <p className="text-sm text-text-tertiary">
        Pods will spawn when execution begins
      </p>
    </div>
  );
}

export default PodVisualization;
