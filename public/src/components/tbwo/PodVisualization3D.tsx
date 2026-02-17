/**
 * PodVisualization3D - 3D-styled pod visualization using CSS transforms
 * Central orchestrator with orbiting specialist pods.
 * Uses CSS perspective transforms + framer-motion for a lightweight 3D look
 * without requiring WebGL / react-three-fiber overhead.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTBWOStore } from '@store/tbwoStore';
import { PodStatus } from '../../types/tbwo';

// ============================================================================
// TYPES
// ============================================================================

interface PodVisualization3DProps {
  tbwoId: string;
  onSelectPod?: (podId: string) => void;
  selectedPodId?: string;
}

// ============================================================================
// COLOR & STATUS CONFIGURATION
// ============================================================================

const POD_COLORS: Record<string, { bg: string; border: string; glow: string; text: string; gradient: string }> = {
  orchestrator: {
    bg: 'bg-purple-500',
    border: 'border-purple-400',
    glow: 'shadow-purple-500/50',
    text: 'text-purple-300',
    gradient: 'rgba(168, 85, 247, 0.8), rgba(107, 33, 168, 0.9)',
  },
  design: {
    bg: 'bg-pink-500',
    border: 'border-pink-400',
    glow: 'shadow-pink-500/50',
    text: 'text-pink-300',
    gradient: 'rgba(236, 72, 153, 0.8), rgba(157, 23, 77, 0.9)',
  },
  frontend: {
    bg: 'bg-blue-500',
    border: 'border-blue-400',
    glow: 'shadow-blue-500/50',
    text: 'text-blue-300',
    gradient: 'rgba(59, 130, 246, 0.8), rgba(29, 78, 216, 0.9)',
  },
  backend: {
    bg: 'bg-green-500',
    border: 'border-green-400',
    glow: 'shadow-green-500/50',
    text: 'text-green-300',
    gradient: 'rgba(34, 197, 94, 0.8), rgba(21, 128, 61, 0.9)',
  },
  copy: {
    bg: 'bg-amber-500',
    border: 'border-amber-400',
    glow: 'shadow-amber-500/50',
    text: 'text-amber-300',
    gradient: 'rgba(245, 158, 11, 0.8), rgba(180, 83, 9, 0.9)',
  },
  motion: {
    bg: 'bg-orange-500',
    border: 'border-orange-400',
    glow: 'shadow-orange-500/50',
    text: 'text-orange-300',
    gradient: 'rgba(249, 115, 22, 0.8), rgba(194, 65, 12, 0.9)',
  },
  qa: {
    bg: 'bg-red-500',
    border: 'border-red-400',
    glow: 'shadow-red-500/50',
    text: 'text-red-300',
    gradient: 'rgba(239, 68, 68, 0.8), rgba(185, 28, 28, 0.9)',
  },
  research: {
    bg: 'bg-indigo-500',
    border: 'border-indigo-400',
    glow: 'shadow-indigo-500/50',
    text: 'text-indigo-300',
    gradient: 'rgba(99, 102, 241, 0.8), rgba(67, 56, 202, 0.9)',
  },
  data: {
    bg: 'bg-teal-500',
    border: 'border-teal-400',
    glow: 'shadow-teal-500/50',
    text: 'text-teal-300',
    gradient: 'rgba(20, 184, 166, 0.8), rgba(15, 118, 110, 0.9)',
  },
  deployment: {
    bg: 'bg-cyan-500',
    border: 'border-cyan-400',
    glow: 'shadow-cyan-500/50',
    text: 'text-cyan-300',
    gradient: 'rgba(6, 182, 212, 0.8), rgba(8, 145, 178, 0.9)',
  },
  devops: {
    bg: 'bg-cyan-500',
    border: 'border-cyan-400',
    glow: 'shadow-cyan-500/50',
    text: 'text-cyan-300',
    gradient: 'rgba(6, 182, 212, 0.8), rgba(8, 145, 178, 0.9)',
  },
};

const STATUS_INDICATOR: Record<string, string> = {
  [PodStatus.INITIALIZING]: 'animate-pulse bg-yellow-400',
  [PodStatus.IDLE]: 'bg-gray-400',
  [PodStatus.WORKING]: 'animate-pulse bg-green-400',
  [PodStatus.WAITING]: 'bg-yellow-400',
  [PodStatus.CHECKPOINT]: 'animate-bounce bg-orange-400',
  [PodStatus.COMPLETE]: 'bg-blue-400',
  [PodStatus.FAILED]: 'bg-red-500',
  [PodStatus.TERMINATED]: 'bg-gray-600',
};

const ROLE_EMOJI: Record<string, string> = {
  orchestrator: '🧠',
  design: '🎨',
  frontend: '💻',
  backend: '⚙️',
  copy: '✍️',
  motion: '🎬',
  qa: '🔍',
  research: '📚',
  data: '📊',
  deployment: '🚀',
  devops: '🚀',
};

const ROLE_LABEL: Record<string, string> = {
  orchestrator: 'Orchestrator',
  design: 'Design',
  frontend: 'Frontend',
  backend: 'Backend',
  copy: 'Copy',
  motion: 'Motion',
  qa: 'QA',
  research: 'Research',
  data: 'Data',
  deployment: 'Deploy',
  devops: 'DevOps',
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const PodVisualization3D: React.FC<PodVisualization3DProps> = ({
  tbwoId,
  onSelectPod,
  selectedPodId,
}) => {
  const tbwo = useTBWOStore((s) => s.getTBWOById(tbwoId));
  const [rotation, setRotation] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const pods = useMemo(() => {
    if (!tbwo?.pods) return [];
    return Array.from(tbwo.pods.values());
  }, [tbwo?.pods]);

  const orchestratorPod = useMemo(
    () => pods.find((p) => p.role === 'orchestrator'),
    [pods]
  );
  const workers = useMemo(
    () => pods.filter((p) => p.role !== 'orchestrator'),
    [pods]
  );

  // Auto-rotate animation
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setRotation((r) => (r + 0.5) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, [isPaused]);

  if (!tbwo || pods.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-text-tertiary text-sm">
        No active pods
      </div>
    );
  }

  const radius = 120; // orbit radius in px
  const centerX = 150;
  const centerY = 150;

  return (
    <div
      className="relative select-none"
      style={{ width: 300, height: 300, perspective: '800px' }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* SVG Layer: orbit ring, connection lines, data flow particles */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 300 300"
      >
        {/* Orbit circle (dashed ring) */}
        <circle
          cx={centerX}
          cy={centerY}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {/* Connection lines from orchestrator to each worker */}
        {workers.map((pod, idx) => {
          const angle =
            (idx / workers.length) * Math.PI * 2 +
            (rotation * Math.PI) / 180;
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;
          const isWorking = pod.status === PodStatus.WORKING;

          return (
            <line
              key={`line-${pod.id}`}
              x1={centerX}
              y1={centerY}
              x2={x}
              y2={y}
              stroke={
                isWorking
                  ? 'rgba(96, 165, 250, 0.4)'
                  : 'rgba(255, 255, 255, 0.08)'
              }
              strokeWidth={isWorking ? 2 : 1}
              strokeDasharray={isWorking ? '' : '3 3'}
            />
          );
        })}

        {/* Animated data-flow particles on active connections */}
        {workers
          .filter((p) => p.status === PodStatus.WORKING)
          .map((pod) => {
            const pidx = workers.indexOf(pod);
            const angle =
              (pidx / workers.length) * Math.PI * 2 +
              (rotation * Math.PI) / 180;
            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            return (
              <circle
                key={`flow-${pod.id}`}
                r="3"
                fill="rgba(96, 165, 250, 0.8)"
              >
                <animateMotion
                  dur="2s"
                  repeatCount="indefinite"
                  path={`M ${centerX} ${centerY} L ${x} ${y}`}
                />
              </circle>
            );
          })}
      </svg>

      {/* Central Orchestrator Node */}
      {orchestratorPod && (
        <motion.button
          onClick={() => onSelectPod?.(orchestratorPod.id)}
          className={`absolute rounded-full border-2 flex items-center justify-center transition-all ${
            selectedPodId === orchestratorPod.id
              ? 'ring-2 ring-purple-400 ring-offset-2 ring-offset-background-primary'
              : ''
          } ${
            orchestratorPod.status === PodStatus.WORKING
              ? 'shadow-lg shadow-purple-500/30'
              : ''
          }`}
          style={{
            left: centerX - 28,
            top: centerY - 28,
            width: 56,
            height: 56,
            background: `radial-gradient(circle at 30% 30%, ${
              POD_COLORS['orchestrator']!.gradient
            })`,
            borderColor: 'rgba(168, 85, 247, 0.6)',
          }}
          animate={{
            scale:
              orchestratorPod.status === PodStatus.WORKING
                ? [1, 1.08, 1]
                : 1,
            boxShadow:
              orchestratorPod.status === PodStatus.WORKING
                ? [
                    '0 0 20px rgba(168, 85, 247, 0.3)',
                    '0 0 40px rgba(168, 85, 247, 0.6)',
                    '0 0 20px rgba(168, 85, 247, 0.3)',
                  ]
                : '0 0 10px rgba(168, 85, 247, 0.2)',
          }}
          transition={{ repeat: Infinity, duration: 2 }}
          whileHover={{ scale: 1.15 }}
        >
          <span className="text-lg">{ROLE_EMOJI['orchestrator']}</span>
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ${
              STATUS_INDICATOR[orchestratorPod.status] || 'bg-gray-400'
            }`}
          />
        </motion.button>
      )}

      {/* Worker Pod Nodes (orbiting) */}
      {workers.map((pod, idx) => {
        const angle =
          (idx / workers.length) * Math.PI * 2 +
          (rotation * Math.PI) / 180;
        const x = centerX + Math.cos(angle) * radius - 22;
        const y = centerY + Math.sin(angle) * radius - 22;
        const colors = (POD_COLORS[pod.role.toLowerCase()] || POD_COLORS['orchestrator'])!;
        const isWorking = pod.status === PodStatus.WORKING;
        const isSelected = selectedPodId === pod.id;

        return (
          <motion.button
            key={pod.id}
            onClick={() => onSelectPod?.(pod.id)}
            className={`absolute rounded-full border-2 flex items-center justify-center transition-all ${
              isSelected
                ? `ring-2 ${colors.border} ring-offset-2 ring-offset-background-primary`
                : ''
            }`}
            style={{
              left: x,
              top: y,
              width: 44,
              height: 44,
              borderColor: isWorking
                ? 'rgba(96, 165, 250, 0.6)'
                : 'rgba(255,255,255,0.15)',
              background: isWorking
                ? `radial-gradient(circle at 30% 30%, ${colors.gradient})`
                : 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.1), rgba(0,0,0,0.3))',
              backgroundColor: isWorking ? undefined : 'rgba(30, 30, 40, 0.8)',
            }}
            animate={{
              scale: isWorking ? [1, 1.1, 1] : 1,
            }}
            transition={{
              repeat: isWorking ? Infinity : 0,
              duration: 1.5,
            }}
            whileHover={{ scale: 1.2 }}
          >
            <span className="text-sm">
              {ROLE_EMOJI[pod.role] || '\u26A1'}
            </span>
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${
                STATUS_INDICATOR[pod.status] || 'bg-gray-400'
              }`}
            />
          </motion.button>
        );
      })}

      {/* Pod Labels -- shown only when rotation is paused (hover) */}
      <AnimatePresence>
        {isPaused &&
          workers.map((pod, idx) => {
            const angle =
              (idx / workers.length) * Math.PI * 2 +
              (rotation * Math.PI) / 180;
            const labelRadius = radius + 35;
            const x = centerX + Math.cos(angle) * labelRadius;
            const y = centerY + Math.sin(angle) * labelRadius;

            return (
              <motion.div
                key={`label-${pod.id}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute text-[10px] text-text-secondary whitespace-nowrap pointer-events-none font-medium"
                style={{
                  left: x,
                  top: y,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {ROLE_LABEL[pod.role] || pod.role}
              </motion.div>
            );
          })}
      </AnimatePresence>

      {/* Pause indicator */}
      <AnimatePresence>
        {isPaused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-text-quaternary"
          >
            Paused -- hover to inspect
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PodVisualization3D;
