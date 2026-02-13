/**
 * HomeDashboard - ALIN Mission Control
 *
 * The hub of ALIN's hub-and-spoke architecture.
 * Six station cards with live previews, each opening a full-screen dedicated view.
 * Design: Cinematic dark UI, Apple-level polish, subtle ambient motion.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChatBubbleLeftRightIcon,
  CodeBracketSquareIcon,
  CommandLineIcon,
  MagnifyingGlassCircleIcon,
  PaintBrushIcon,
  MicrophoneIcon,
  GlobeAltIcon,
  Cog6ToothIcon,
  SparklesIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import {
  ChatBubbleLeftRightIcon as ChatSolid,
  CodeBracketSquareIcon as CodeSolid,
  CommandLineIcon as CommandSolid,
} from '@heroicons/react/24/solid';

import { useChatStore } from '@store/chatStore';
import { useTBWOStore } from '@store/tbwoStore';
import { useMemoryStore } from '@store/memoryStore';
import { useSettingsStore } from '@store/settingsStore';
import { useAuthStore } from '@store/authStore';
import { useUIStore } from '@store/uiStore';

// ============================================================================
// TYPES
// ============================================================================

interface StationConfig {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconSolid?: React.ComponentType<{ className?: string }>;
  route: string;
  gradient: string;
  glowColor: string;
  accentBorder: string;
  statusDot: string;
  preview: React.ComponentType;
  shortcut: string;
}

// ============================================================================
// STATION CONFIGURATIONS
// ============================================================================

const STATIONS: StationConfig[] = [
  {
    id: 'chat',
    name: 'Chat',
    subtitle: 'General Assistant',
    description: 'Conversational AI with smart model routing',
    icon: ChatBubbleLeftRightIcon,
    iconSolid: ChatSolid,
    route: '/chat',
    gradient: 'from-blue-500/10 via-transparent to-transparent',
    glowColor: 'rgba(59, 130, 246, 0.15)',
    accentBorder: 'border-blue-500/20 hover:border-blue-500/40',
    statusDot: 'bg-blue-400',
    preview: ChatPreview,
    shortcut: '⌘ 1',
  },
  {
    id: 'code',
    name: 'Code Lab',
    subtitle: 'Developer Workspace',
    description: 'Code editing, execution, and Docker sandbox',
    icon: CodeBracketSquareIcon,
    iconSolid: CodeSolid,
    route: '/chat?mode=coding',
    gradient: 'from-emerald-500/10 via-transparent to-transparent',
    glowColor: 'rgba(16, 185, 129, 0.15)',
    accentBorder: 'border-emerald-500/20 hover:border-emerald-500/40',
    statusDot: 'bg-emerald-400',
    preview: CodePreview,
    shortcut: '⌘ 2',
  },
  {
    id: 'tbwo',
    name: 'TBWO Command',
    subtitle: 'Autonomous Tasks',
    description: 'Time-budgeted work orders with pod orchestration',
    icon: CommandLineIcon,
    iconSolid: CommandSolid,
    route: '/tbwo',
    gradient: 'from-violet-500/10 via-transparent to-transparent',
    glowColor: 'rgba(139, 92, 246, 0.15)',
    accentBorder: 'border-violet-500/20 hover:border-violet-500/40',
    statusDot: 'bg-violet-400',
    preview: TBWOPreview,
    shortcut: '⌘ 3',
  },
  {
    id: 'research',
    name: 'Research',
    subtitle: 'Deep Analysis',
    description: 'Web search, citations, and source evaluation',
    icon: MagnifyingGlassCircleIcon,
    route: '/chat?mode=research',
    gradient: 'from-amber-500/10 via-transparent to-transparent',
    glowColor: 'rgba(245, 158, 11, 0.15)',
    accentBorder: 'border-amber-500/20 hover:border-amber-500/40',
    statusDot: 'bg-amber-400',
    preview: ResearchPreview,
    shortcut: '⌘ 4',
  },
  {
    id: 'image',
    name: 'Image Studio',
    subtitle: 'Visual Creation',
    description: 'AI image generation with style direction',
    icon: PaintBrushIcon,
    route: '/chat?mode=image',
    gradient: 'from-pink-500/10 via-transparent to-transparent',
    glowColor: 'rgba(236, 72, 153, 0.15)',
    accentBorder: 'border-pink-500/20 hover:border-pink-500/40',
    statusDot: 'bg-pink-400',
    preview: ImagePreview,
    shortcut: '⌘ 5',
  },
  {
    id: 'voice',
    name: 'Voice Room',
    subtitle: 'Voice-First Interface',
    description: 'Emotion-aware voice with adaptive modulation',
    icon: MicrophoneIcon,
    route: '/chat?mode=voice',
    gradient: 'from-cyan-500/10 via-transparent to-transparent',
    glowColor: 'rgba(6, 182, 212, 0.15)',
    accentBorder: 'border-cyan-500/20 hover:border-cyan-500/40',
    statusDot: 'bg-cyan-400',
    preview: VoicePreview,
    shortcut: '⌘ 6',
  },
  {
    id: 'sites',
    name: 'Sites',
    subtitle: 'Deploy & Manage',
    description: 'AI-generated websites deployed to the edge',
    icon: GlobeAltIcon,
    route: '/sites',
    gradient: 'from-teal-500/10 via-transparent to-transparent',
    glowColor: 'rgba(20, 184, 166, 0.15)',
    accentBorder: 'border-teal-500/20 hover:border-teal-500/40',
    statusDot: 'bg-teal-400',
    preview: SitesPreview,
    shortcut: '⌘ 7',
  },
];

// ============================================================================
// STAGGER ANIMATION CONFIG
// ============================================================================

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 30,
    },
  },
};

const headerVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function HomeDashboard() {
  const navigate = useNavigate();
  const [hoveredStation, setHoveredStation] = useState<string | null>(null);
  const [time, setTime] = useState(new Date());

  // Update clock
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Station keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key >= '1' && e.key <= '6') {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (STATIONS[index]) {
          navigate(STATIONS[index].route);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const greeting = getGreeting();

  return (
    <div className="home-dashboard relative flex h-full min-h-screen flex-col overflow-auto bg-background-primary">
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-[40%] left-1/2 h-[80%] w-[80%] -translate-x-1/2 rounded-full opacity-[0.03]"
          style={{
            background:
              'radial-gradient(ellipse, var(--brand-primary) 0%, transparent 70%)',
          }}
        />
        {hoveredStation && (
          <motion.div
            key={hoveredStation}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute -top-[30%] left-1/2 h-[60%] w-[60%] -translate-x-1/2 rounded-full"
            style={{
              background: `radial-gradient(ellipse, ${STATIONS.find((s) => s.id === hoveredStation)?.glowColor || 'transparent'} 0%, transparent 70%)`,
            }}
          />
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 py-8 lg:px-12 lg:py-12">
        {/* Header */}
        <motion.header
          variants={headerVariants}
          initial="hidden"
          animate="visible"
          className="mb-10 flex items-start justify-between lg:mb-14"
        >
          <div>
            {/* ALIN wordmark */}
            <div className="mb-3 flex items-center gap-3">
              <div className="relative flex h-9 w-9 items-center justify-center">
                <div className="absolute inset-0 rounded-lg bg-brand-primary/20" />
                <SparklesIcon className="relative h-5 w-5 text-brand-primary" />
              </div>
              <span className="text-sm font-medium tracking-[0.2em] text-text-tertiary">
                A L I N
              </span>
            </div>

            {/* Greeting */}
            <h1 className="mb-1.5 text-3xl font-semibold tracking-tight text-text-primary lg:text-4xl">
              {greeting}
            </h1>
            <p className="text-base text-text-tertiary lg:text-lg">
              Choose a station to begin, or press{' '}
              <kbd className="mx-0.5 rounded-md border border-border-primary bg-background-tertiary px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                ⌘K
              </kbd>{' '}
              for command palette.
            </p>
          </div>

          {/* Right side - time + settings */}
          <div className="hidden items-center gap-4 lg:flex">
            <div className="text-right">
              <div className="text-sm font-medium text-text-secondary">
                {time.toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div className="font-mono text-xs text-text-quaternary">
                {time.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
            <button
              onClick={() => useUIStore.getState().openModal({ type: 'settings' })}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-primary bg-background-secondary text-text-tertiary transition-all hover:border-border-secondary hover:bg-background-tertiary hover:text-text-secondary"
            >
              <Cog6ToothIcon className="h-5 w-5" />
            </button>
          </div>
        </motion.header>

        {/* Station Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid flex-1 auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5"
        >
          {STATIONS.map((station) => (
            <StationCard
              key={station.id}
              station={station}
              isHovered={hoveredStation === station.id}
              onHover={() => setHoveredStation(station.id)}
              onLeave={() => setHoveredStation(null)}
              onClick={() => navigate(station.route)}
            />
          ))}
        </motion.div>

        {/* Footer status bar */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.4 }}
          className="mt-8 flex items-center justify-between border-t border-border-primary/50 pt-5"
        >
          <SystemStatus />
          <div className="flex items-center gap-4">
            <CanonBadge />
            <span className="text-xs text-text-quaternary">
              ALIN v1.0 · Advanced Linguistic Intelligence Network
            </span>
          </div>
        </motion.footer>
      </div>
    </div>
  );
}

// ============================================================================
// STATION CARD COMPONENT
// ============================================================================

interface StationCardProps {
  station: StationConfig;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}

function StationCard({
  station,
  isHovered,
  onHover,
  onLeave,
  onClick,
}: StationCardProps) {
  const Icon = station.icon;

  return (
    <motion.button
      variants={itemVariants}
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={`station-card group relative flex flex-col overflow-hidden rounded-2xl border bg-background-secondary/50 p-5 text-left transition-all duration-300 lg:p-6 ${station.accentBorder} hover:bg-background-secondary`}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.985 }}
    >
      {/* Gradient overlay on hover */}
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${station.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-100`}
      />

      {/* Top row: icon + shortcut */}
      <div className="relative z-10 mb-4 flex items-start justify-between">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.06] transition-colors duration-300"
          style={{
            background: isHovered ? station.glowColor : 'rgba(255,255,255,0.03)',
          }}
        >
          <Icon className="h-5 w-5 text-text-secondary transition-colors duration-300 group-hover:text-text-primary" />
        </div>
        <span className="rounded-md bg-background-tertiary/80 px-2 py-1 font-mono text-[10px] text-text-quaternary opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {station.shortcut}
        </span>
      </div>

      {/* Station name + subtitle */}
      <div className="relative z-10 mb-2">
        <h3 className="text-base font-semibold text-text-primary">
          {station.name}
        </h3>
        <span className="text-xs text-text-tertiary">{station.subtitle}</span>
      </div>

      {/* Description */}
      <p className="relative z-10 mb-4 text-[13px] leading-relaxed text-text-quaternary">
        {station.description}
      </p>

      {/* Live preview area */}
      <div className="relative z-10 mt-auto min-h-[60px] rounded-lg border border-white/[0.04] bg-background-primary/50 p-3">
        <station.preview />
      </div>

      {/* Bottom: status + arrow */}
      <div className="relative z-10 mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${station.statusDot}`}
          />
          <span className="text-[11px] text-text-quaternary">Ready</span>
        </div>
        <ArrowRightIcon className="h-3.5 w-3.5 text-text-quaternary opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
    </motion.button>
  );
}

// ============================================================================
// LIVE PREVIEW COMPONENTS (one per station)
// ============================================================================

function ChatPreview() {
  const conversations = useChatStore((s) => s.conversations);
  const count = conversations?.size ?? 0;
  const latest = count > 0 ? Array.from(conversations.values()).pop() : null;

  return (
    <div className="space-y-1.5">
      {latest ? (
        <>
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 rounded-full bg-blue-500/20">
              <div className="h-full w-3/4 rounded-full bg-blue-500/40" />
            </div>
          </div>
          <div className="truncate text-[11px] text-text-quaternary">
            {latest.title || 'New conversation'}
          </div>
          <div className="text-[10px] text-text-disabled">
            {count} conversation{count !== 1 ? 's' : ''}
          </div>
        </>
      ) : (
        <div className="text-[11px] text-text-disabled">
          No conversations yet
        </div>
      )}
    </div>
  );
}

function CodePreview() {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] leading-relaxed text-text-quaternary">
        <span className="text-emerald-400/60">const</span>{' '}
        <span className="text-text-tertiary">app</span>{' '}
        <span className="text-text-quaternary">=</span>{' '}
        <span className="text-amber-400/60">express</span>
        <span className="text-text-disabled">();</span>
      </div>
      <div className="font-mono text-[10px] leading-relaxed text-text-quaternary">
        <span className="text-emerald-400/60">await</span>{' '}
        <span className="text-text-tertiary">app</span>
        <span className="text-text-disabled">.</span>
        <span className="text-blue-400/60">listen</span>
        <span className="text-text-disabled">(3000);</span>
      </div>
      <div className="mt-1 text-[10px] text-text-disabled">
        Docker sandbox · Node 20
      </div>
    </div>
  );
}

function TBWOPreview() {
  const tbwos = useTBWOStore((s) => s.tbwos);
  const activeCount = tbwos
    ? Array.from(tbwos.values()).filter(
        (t: any) => t.status === 'running' || t.status === 'active'
      ).length
    : 0;
  const totalCount = tbwos?.size ?? 0;

  return (
    <div className="space-y-1.5">
      {activeCount > 0 ? (
        <>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
            <span className="text-[11px] text-violet-400/80">
              {activeCount} active pod{activeCount !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="h-1 rounded-full bg-violet-500/20">
            <motion.div
              className="h-full rounded-full bg-violet-500/50"
              initial={{ width: '10%' }}
              animate={{ width: '60%' }}
              transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
            />
          </div>
        </>
      ) : (
        <>
          <div className="text-[11px] text-text-quaternary">
            {totalCount > 0 ? `${totalCount} completed` : 'No active tasks'}
          </div>
          <div className="text-[10px] text-text-disabled">
            Website Sprint ready
          </div>
        </>
      )}
    </div>
  );
}

function ResearchPreview() {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="h-1 w-8 rounded-full bg-amber-500/30" />
        <div className="h-1 w-12 rounded-full bg-amber-500/20" />
        <div className="h-1 w-6 rounded-full bg-amber-500/10" />
      </div>
      <div className="text-[11px] text-text-quaternary">
        Deep search · Citations
      </div>
      <div className="text-[10px] text-text-disabled">
        Brave + web sources
      </div>
    </div>
  );
}

function ImagePreview() {
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {['bg-pink-500/20', 'bg-purple-500/20', 'bg-rose-500/20'].map(
          (bg, i) => (
            <div key={i} className={`h-6 w-6 rounded ${bg}`} />
          )
        )}
      </div>
      <div className="text-[11px] text-text-quaternary">
        FLUX.2 [max] · 4MP · Web-grounded
      </div>
    </div>
  );
}

function VoicePreview() {
  return (
    <div className="space-y-1.5">
      {/* Waveform bars */}
      <div className="flex items-end gap-[3px]">
        {[3, 6, 4, 8, 5, 7, 3, 5, 6, 4, 7, 5, 3, 6, 4].map((h, i) => (
          <div
            key={i}
            className="w-[2px] rounded-full bg-cyan-500/30"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
      <div className="text-[11px] text-text-quaternary">
        Whisper STT · ElevenLabs
      </div>
    </div>
  );
}

function SitesPreview() {
  const user = useAuthStore((s) => s.user);
  const isFree = !user?.plan || user.plan === 'free';

  if (isFree) {
    return (
      <div className="text-[11px] text-text-quaternary">
        <span className="text-amber-400">Upgrade to Pro</span> to deploy sites
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
        <span className="text-[11px] text-text-quaternary">Edge deploy ready</span>
      </div>
      <div className="text-[11px] text-text-quaternary">
        R2 + Workers + KV
      </div>
    </div>
  );
}

// ============================================================================
// FOOTER COMPONENTS
// ============================================================================

function SystemStatus() {
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const token = useAuthStore.getState().token;
    if (!token) return;
    fetch('/api/keys/status', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.keys) setKeyStatus(data.keys); })
      .catch(() => {});
  }, []);

  const hasAnthropic = !!keyStatus['ANTHROPIC_API_KEY'];
  const hasOpenAI = !!keyStatus['OPENAI_API_KEY'];

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${hasAnthropic || hasOpenAI ? 'bg-semantic-success' : 'bg-semantic-warning'}`}
        />
        <span className="text-xs text-text-quaternary">
          {hasAnthropic || hasOpenAI ? 'Systems online' : 'Checking API keys...'}
        </span>
      </div>
      {hasAnthropic && (
        <span className="rounded-full bg-brand-primary/10 px-2 py-0.5 text-[10px] text-brand-primary">
          Claude
        </span>
      )}
      {hasOpenAI && (
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
          GPT
        </span>
      )}
    </div>
  );
}

function CanonBadge() {
  return (
    <div className="flex items-center gap-1 rounded-full border border-brand-primary/20 bg-brand-primary/5 px-2.5 py-1">
      <SparklesIcon className="h-3 w-3 text-brand-primary/60" />
      <span className="text-[10px] font-medium text-brand-primary/80">
        Canon Compliant
      </span>
    </div>
  );
}

// ============================================================================
// UTILS
// ============================================================================

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Working late?';
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  if (hour < 21) return 'Good evening.';
  return 'Working late?';
}
