/**
 * PodActivityTabs - Per-pod activity view for TBWO Dashboard
 *
 * Sub-tabs: "All" (full TBWOChatTab) + one tab per pod showing a
 * read-only chat-style view of the pod's work (like Claude/GPT).
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  ChevronDownIcon,
  CodeBracketIcon,
  WrenchScrewdriverIcon,
  DocumentDuplicateIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline';

import { useChatStore } from '../../store/chatStore';
import { usePodPoolStore } from '../../store/podPoolStore';
import { TBWOChatTab } from './TBWOChatTab';
import { ToolActivityPanel } from '../chat/ToolActivityPanel';
import type { TBWO, AgentPod } from '../../types/tbwo';
import { PodStatus, getPodRoleDisplayName } from '../../types/tbwo';
import type { ContentBlock } from '../../types/chat';
import { MessageRole } from '../../types/chat';
import { getModelDisplayName, getModelBadgeColor, resolveModelForPod } from '../../services/tbwo/modelRouter';

// ============================================================================
// CONSTANTS
// ============================================================================

const POD_ROLE_ICONS: Record<string, string> = {
  orchestrator: '\uD83C\uDFAF',
  design: '\uD83C\uDFA8',
  frontend: '\uD83D\uDCBB',
  backend: '\u2699\uFE0F',
  motion: '\u2728',
  animation: '\uD83C\uDFAC',
  three_d: '\uD83D\uDDA5\uFE0F',
  copy: '\uD83D\uDCDD',
  qa: '\uD83D\uDD0D',
  devops: '\uD83D\uDE80',
  deployment: '\uD83D\uDE80',
  research: '\uD83D\uDD2C',
  data: '\uD83D\uDCCA',
};

/** Names the pool store assigns to pods — must match podPoolStore ROLE_NAMES */
const POOL_ROLE_NAMES: Record<string, string> = {
  orchestrator: 'Orchestrator',
  design: 'Designer',
  frontend: 'Frontend Dev',
  backend: 'Backend Dev',
  copy: 'Copywriter',
  motion: 'Motion Designer',
  animation: 'Animator',
  three_d: '3D Artist',
  qa: 'QA Engineer',
  research: 'Researcher',
  data: 'Data Analyst',
  deployment: 'DevOps',
  devops: 'DevOps',
};

const POD_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ['ready']:                { label: 'Ready to begin...', color: 'bg-blue-500/15 text-blue-400' },
  [PodStatus.INITIALIZING]: { label: 'Initializing', color: 'bg-yellow-500/15 text-yellow-400' },
  [PodStatus.IDLE]:         { label: 'Idle',         color: 'bg-gray-500/15 text-gray-400' },
  [PodStatus.WORKING]:      { label: 'Working',      color: 'bg-brand-primary/15 text-brand-primary' },
  [PodStatus.WAITING]:      { label: 'Waiting',      color: 'bg-orange-500/15 text-orange-400' },
  [PodStatus.CHECKPOINT]:   { label: 'Checkpoint',   color: 'bg-blue-500/15 text-blue-400' },
  [PodStatus.COMPLETE]:     { label: 'Done',          color: 'bg-green-500/15 text-green-400' },
  [PodStatus.FAILED]:       { label: 'Failed',        color: 'bg-red-500/15 text-red-400' },
  [PodStatus.TERMINATED]:   { label: 'Terminated',    color: 'bg-gray-500/15 text-gray-400' },
};

// ============================================================================
// MODEL BADGE (exported for reuse)
// ============================================================================

interface ModelBadgeProps {
  model: string;
  animate?: boolean;
}

export function ModelBadge({ model, animate }: ModelBadgeProps) {
  const displayName = getModelDisplayName(model);
  const { bg, text } = getModelBadgeColor(model);

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${bg} ${text} ${
        animate ? 'animate-pulse' : ''
      }`}
    >
      {displayName}
    </span>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a set of all possible `msg.model` strings for a given pod role.
 * The execution engine tags messages with the pool pod name, which may differ
 * from the definition pod name or the display name.
 */
function buildPodNameMatchSet(pod: AgentPod, poolPods: Map<string, any>, tbwoId: string): Set<string> {
  const names = new Set<string>();
  // Definition pod name
  if (pod.name) names.add(pod.name);
  // Pool pod ROLE_NAMES (what the execution engine uses as msg.model)
  const poolName = POOL_ROLE_NAMES[pod.role];
  if (poolName) names.add(poolName);
  // Display name from types
  names.add(getPodRoleDisplayName(pod.role));
  // Actual pool pod name for this TBWO (runtime)
  for (const pp of poolPods.values()) {
    if (pp.role === pod.role && (pp.activeTBWOId === tbwoId || pp.tbwoHistory?.includes(tbwoId))) {
      if (pp.name) names.add(pp.name);
    }
  }
  return names;
}

// ============================================================================
// POD ACTIVITY TABS (main export)
// ============================================================================

interface PodActivityTabsProps {
  tbwo: TBWO;
}

export function PodActivityTabs({ tbwo }: PodActivityTabsProps) {
  const [activeSubTab, setActiveSubTab] = useState<string>('all');

  const poolPods = usePodPoolStore((s) => s.pool);

  // Overlay runtime model configs from podPoolStore onto definition pods
  const pods = useMemo(() =>
    Array.from(tbwo.pods.values()).map((pod) => {
      const poolPod = Array.from(poolPods.values()).find(
        (p) => p.role === pod.role && (p.activeTBWOId === tbwo.id || p.tbwoHistory?.includes(tbwo.id))
      );
      const routed = resolveModelForPod(pod.role);
      return {
        ...pod,
        modelConfig: poolPod?.runtime?.modelConfig || { ...pod.modelConfig, provider: routed.provider, model: routed.model },
      };
    }),
    [tbwo.pods, tbwo.id, poolPods]
  );

  if (pods.length === 0) {
    return <TBWOChatTab tbwo={tbwo} />;
  }

  const activePod = activeSubTab !== 'all'
    ? pods.find((p) => p.id === activeSubTab)
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tab bar */}
      <div className="flex items-center border-b border-border-primary bg-background-secondary overflow-x-auto scrollbar-thin scrollbar-thumb-border-primary">
        <button
          onClick={() => setActiveSubTab('all')}
          className={`flex-shrink-0 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
            activeSubTab === 'all'
              ? 'border-brand-primary text-brand-primary'
              : 'border-transparent text-text-tertiary hover:text-text-secondary'
          }`}
        >
          All Activity
        </button>

        {pods.map((pod) => (
          <PodSubTab
            key={pod.id}
            pod={pod}
            tbwo={tbwo}
            poolPods={poolPods}
            isActive={activeSubTab === pod.id}
            onClick={() => setActiveSubTab(pod.id)}
          />
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {activeSubTab === 'all' ? (
            <motion.div
              key="all"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <TBWOChatTab tbwo={tbwo} />
            </motion.div>
          ) : activePod ? (
            <motion.div
              key={activePod.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="h-full"
            >
              <PodChatView pod={activePod} tbwo={tbwo} poolPods={poolPods} />
            </motion.div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-tertiary">
              Pod not found
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ============================================================================
// POD SUB-TAB BUTTON
// ============================================================================

function PodSubTab({
  pod,
  tbwo,
  poolPods,
  isActive,
  onClick,
}: {
  pod: AgentPod;
  tbwo: TBWO;
  poolPods: Map<string, any>;
  isActive: boolean;
  onClick: () => void;
}) {
  const icon = POD_ROLE_ICONS[pod.role] || '\uD83E\uDD16';

  // Get live status from pool
  const poolPod = Array.from(poolPods.values()).find(
    (p) => p.role === pod.role && p.activeTBWOId === tbwo.id && p.status === 'active'
  );
  const isWorking = poolPod?.runtime?.podStatus === PodStatus.WORKING || pod.status === PodStatus.WORKING;

  // Count messages for this pod
  const chatConvId = tbwo.chatConversationId;
  const conversation = useChatStore((s) =>
    chatConvId ? s.conversations.get(chatConvId) : undefined
  );
  const nameSet = useMemo(() => buildPodNameMatchSet(pod, poolPods, tbwo.id), [pod, poolPods, tbwo.id]);
  const msgCount = useMemo(() =>
    (conversation?.messages || []).filter(
      (msg) => nameSet.has(msg.model || '') && msg.role === MessageRole.ASSISTANT
    ).length,
    [conversation?.messages, nameSet]
  );

  return (
    <button
      onClick={onClick}
      className={`flex flex-shrink-0 items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 ${
        isActive
          ? 'border-brand-primary text-text-primary'
          : 'border-transparent text-text-tertiary hover:text-text-secondary'
      }`}
    >
      <span className="text-sm">{icon}</span>
      <span className="max-w-[100px] truncate">{getPodRoleDisplayName(pod.role)}</span>
      {msgCount > 0 && (
        <span className="text-[10px] text-text-quaternary">({msgCount})</span>
      )}
      <ModelBadge model={pod.modelConfig.model} animate={isWorking} />
      {isWorking && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-primary" />
        </span>
      )}
    </button>
  );
}

// ============================================================================
// POD CHAT VIEW — Read-only Claude/GPT-style conversation
// ============================================================================

function PodChatView({
  pod,
  tbwo,
  poolPods,
}: {
  pod: AgentPod;
  tbwo: TBWO;
  poolPods: Map<string, any>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Build name match set for this pod's role
  const nameSet = useMemo(
    () => buildPodNameMatchSet(pod, poolPods, tbwo.id),
    [pod, poolPods, tbwo.id]
  );

  // Get messages from linked chat, filtered to this pod
  const chatConvId = tbwo.chatConversationId;
  const conversation = useChatStore((s) =>
    chatConvId ? s.conversations.get(chatConvId) : undefined
  );
  const allMessages = conversation?.messages || [];
  const podMessages = useMemo(
    () => allMessages.filter(
      (msg) => nameSet.has(msg.model || '') && msg.role === MessageRole.ASSISTANT
    ),
    [allMessages, nameSet]
  );

  // Live runtime from pool pod
  const poolPod = Array.from(poolPods.values()).find(
    (p) => p.role === pod.role && (p.activeTBWOId === tbwo.id || p.tbwoHistory?.includes(tbwo.id))
  );
  const runtime = poolPod?.runtime;

  // Stats — prefer runtime (live) over definition pod data
  const tokensUsed = runtime?.resourceUsage?.tokensUsed ?? pod.resourceUsage?.tokensUsed ?? 0;
  const apiCalls = runtime?.resourceUsage?.apiCalls ?? pod.resourceUsage?.apiCalls ?? 0;
  const completedCount = runtime?.completedTasks?.length ?? pod.completedTasks?.length ?? 0;
  const currentTaskName = runtime?.currentTask?.name ?? pod.currentTask?.name ?? null;

  // Resolve pod status
  const hasStarted = !['draft', 'planning', 'awaiting_approval'].includes(tbwo.status);
  const isCompleted = tbwo.status === 'completed' || tbwo.status === 'cancelled' || tbwo.status === 'failed';
  const liveStatus = (runtime?.podStatus as PodStatus) ?? pod.status;
  const resolvedStatus = !hasStarted ? 'ready' as any : isCompleted && liveStatus !== PodStatus.FAILED ? PodStatus.COMPLETE : liveStatus;
  const statusInfo = POD_STATUS_LABELS[resolvedStatus] || { label: resolvedStatus, color: 'bg-gray-500/15 text-gray-400' };
  const roleIcon = POD_ROLE_ICONS[pod.role] || '\uD83E\uDD16';
  const isWorking = resolvedStatus === PodStatus.WORKING;

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [podMessages.length]);

  return (
    <div className="flex h-full flex-col bg-background-primary">
      {/* Header */}
      <div className="border-b border-border-primary bg-background-secondary px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-accent to-brand-secondary">
              <span className="text-base">{roleIcon}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-text-primary">{getPodRoleDisplayName(pod.role)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
                <ModelBadge model={pod.modelConfig.model} animate={isWorking} />
              </div>
              {currentTaskName && (
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
                  <span className="text-[11px] text-text-secondary truncate max-w-[300px]">{currentTaskName}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-text-tertiary">
            <span>{completedCount} tasks</span>
            <span className="text-text-quaternary">|</span>
            <span>{formatNumber(tokensUsed)} tokens</span>
            <span className="text-text-quaternary">|</span>
            <span>{apiCalls} calls</span>
          </div>
        </div>
      </div>

      {/* Chat messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {podMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background-secondary mb-4">
              <span className="text-3xl">{roleIcon}</span>
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1">
              {getPodRoleDisplayName(pod.role)}
            </p>
            <p className="text-xs text-text-tertiary max-w-[280px]">
              {isWorking
                ? 'Working on a task... output will appear here shortly.'
                : resolvedStatus === PodStatus.COMPLETE || isCompleted
                ? 'This pod completed its work without generating visible chat messages.'
                : 'Activity will appear here when this pod starts working.'}
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-1">
            {podMessages.map((msg, idx) => (
              <ChatBubble
                key={msg.id}
                content={msg.content}
                timestamp={msg.timestamp}
                isStreaming={msg.isStreaming}
                isFirst={idx === 0}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Read-only footer */}
      <div className="border-t border-border-primary bg-background-secondary px-4 py-2">
        <p className="text-[11px] text-text-quaternary text-center">
          Read-only view of {getPodRoleDisplayName(pod.role)}'s activity
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// CHAT BUBBLE — single message rendered in Claude/GPT style
// ============================================================================

function ChatBubble({
  content,
  timestamp,
  isStreaming,
  isFirst,
}: {
  content: ContentBlock[];
  timestamp: number;
  isStreaming?: boolean;
  isFirst?: boolean;
}) {
  // Separate content into text, code, thinking, and tool_activity blocks
  const textBlocks = content.filter((b) => b.type === 'text');
  const codeBlocks = content.filter((b) => b.type === 'code');
  const thinkingBlocks = content.filter((b) => b.type === 'thinking');
  const toolBlocks = content.filter((b) => b.type === 'tool_activity');

  const hasVisibleContent = textBlocks.some((b) => (b as any).text?.trim()) ||
    codeBlocks.length > 0 || thinkingBlocks.length > 0 || toolBlocks.length > 0;

  if (!hasVisibleContent && !isStreaming) return null;

  return (
    <div className={`${isFirst ? '' : 'mt-3'}`}>
      {/* Thinking blocks (collapsed by default) */}
      {thinkingBlocks.map((block, i) => (
        <ThinkingBlock key={`think-${i}`} content={(block as any).content || ''} />
      ))}

      {/* Tool activity blocks */}
      {toolBlocks.map((block, i) => (
        <ToolBlock key={`tool-${i}`} activities={(block as any).activities || []} />
      ))}

      {/* Text content */}
      {textBlocks.map((block, i) => {
        const text = (block as any).text as string;
        if (!text?.trim()) return null;
        return <TextContent key={`text-${i}`} text={text} isStreaming={isStreaming} />;
      })}

      {/* Code blocks */}
      {codeBlocks.map((block, i) => (
        <CollapsibleCode
          key={`code-${i}`}
          code={(block as any).code || ''}
          language={(block as any).language || ''}
          filename={(block as any).filename}
        />
      ))}

      {/* Streaming indicator */}
      {isStreaming && (
        <span className="inline-block ml-1 animate-pulse text-brand-primary text-lg leading-none">|</span>
      )}

      {/* Timestamp */}
      {!isStreaming && timestamp > 0 && (
        <div className="mt-1 text-[10px] text-text-quaternary">
          {formatTime(timestamp)}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TEXT CONTENT — markdown rendered
// ============================================================================

function TextContent({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  // Strip XML tool markup (same as TBWOChatTab)
  const cleaned = stripXMLToolMarkup(text);
  if (!cleaned.trim()) return null;

  // Close unclosed code fences during streaming
  const display = isStreaming ? closeUnfinishedFences(cleaned) : cleaned;

  return (
    <div className="text-sm break-words prose prose-sm prose-invert max-w-none text-text-primary">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p className="my-1">{children}</p>,
          code: ({ children, className }) => {
            const isInline = !className;
            return isInline ? (
              <code className="bg-background-elevated px-1 py-0.5 rounded text-xs">{children}</code>
            ) : (
              <code className={className}>{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-[#1e1e2e] p-3 rounded-lg text-xs overflow-x-auto my-2">{children}</pre>
          ),
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
        }}
      >
        {display}
      </ReactMarkdown>
    </div>
  );
}

// ============================================================================
// THINKING BLOCK — collapsible
// ============================================================================

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!content?.trim()) return null;

  return (
    <div className="mb-2 rounded-lg border border-brand-primary/20 bg-brand-primary/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-brand-primary hover:bg-brand-primary/10 transition-colors"
      >
        <LightBulbIcon className="h-3 w-3" />
        <span>Thinking</span>
        <ChevronDownIcon className={`h-3 w-3 ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 text-xs text-text-tertiary whitespace-pre-wrap border-t border-brand-primary/10 max-h-[300px] overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TOOL BLOCK — expandable tool usage panel
// ============================================================================

function ToolBlock({ activities }: { activities: any[] }) {
  const [expanded, setExpanded] = useState(false);

  if (activities.length === 0) return null;

  const completedCount = activities.filter((a: any) => a.status === 'completed').length;
  const summary = activities.length === 1
    ? activities[0].label || activities[0].details || activities[0].name?.replace(/_/g, ' ') || 'tool used'
    : `${completedCount} tool${completedCount !== 1 ? 's' : ''} used`;

  return (
    <div className="mb-2 rounded-lg border border-border-primary bg-background-secondary overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-background-elevated transition-colors"
      >
        <WrenchScrewdriverIcon className="h-3.5 w-3.5 text-text-tertiary" />
        <span className="text-text-secondary font-medium">{summary}</span>
        <ChevronDownIcon className={`h-3 w-3 ml-auto text-text-quaternary transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-border-primary">
          <ToolActivityPanel activities={activities} isProcessing={false} />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COLLAPSIBLE CODE BLOCK
// ============================================================================

function CollapsibleCode({
  code,
  language,
  filename,
}: {
  code: string;
  language: string;
  filename?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lineCount = code.split('\n').length;
  const preview = code.split('\n').slice(0, 4).join('\n');

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-border-primary">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full bg-background-elevated px-3 py-2 text-xs hover:bg-background-hover transition-colors"
      >
        <div className="flex items-center gap-1.5 text-text-secondary">
          <CodeBracketIcon className="h-3.5 w-3.5" />
          <span className="font-medium">{filename || language || 'code'}</span>
          <span className="text-text-quaternary">({lineCount} lines)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-white/10 text-text-quaternary"
            title="Copy code"
          >
            <DocumentDuplicateIcon className="h-3.5 w-3.5" />
          </button>
          {copied && <span className="text-green-400 text-[10px]">Copied</span>}
          <ChevronDownIcon className={`h-3 w-3 text-text-quaternary transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {expanded ? (
        <pre className="bg-[#1e1e2e] p-3 text-xs overflow-x-auto max-h-[500px] overflow-y-auto">
          <code className="text-green-400">{code}</code>
        </pre>
      ) : (
        <pre className="bg-[#1e1e2e] px-3 py-2 text-xs text-text-quaternary overflow-hidden max-h-[72px]">
          <code>{preview}{lineCount > 4 ? '\n...' : ''}</code>
        </pre>
      )}
    </div>
  );
}

// ============================================================================
// UTILITIES
// ============================================================================

function stripXMLToolMarkup(text: string): string {
  return text
    .replace(/<\/?anythingllm-function-calls?>/gi, '')
    .replace(/<\/?invoke>/gi, '')
    .replace(/<\/?tool_call>/gi, '')
    .replace(/<\/?function_calls?>/gi, '')
    .replace(/<\/?result>/gi, '')
    .replace(/<\/?results?>/gi, '')
    .replace(/<tool_name>[^<]*<\/tool_name>/gi, '')
    .replace(/<\/?parameters?>/gi, '')
    .replace(/<\/?command>/gi, '')
    .replace(/<\/?language>/gi, '')
    .replace(/<\/?path>/gi, '')
    .replace(/<\/?content>/gi, '')
    .replace(/<\/?code>/gi, '')
    .replace(/<\/?file_read[^>]*>/gi, '')
    .replace(/<\/?file_write[^>]*>/gi, '')
    .replace(/<\/?file_list[^>]*>/gi, '')
    .replace(/<\/?execute_code[^>]*>/gi, '')
    .replace(/<\/?run_command[^>]*>/gi, '')
    .replace(/<\/?scan_directory[^>]*>/gi, '')
    .replace(/<\/?edit_file[^>]*>/gi, '')
    .replace(/<\/?web_search[^>]*>/gi, '')
    .replace(/<\/?git[^>]*>/gi, '')
    .replace(/<\/?memory_store[^>]*>/gi, '')
    .replace(/<\/?memory_recall[^>]*>/gi, '')
    .replace(/<\/?system_status[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function closeUnfinishedFences(text: string): string {
  const fencePattern = /^(`{3,})(\w*)/gm;
  let openFence: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(text)) !== null) {
    const backticks = match[1] || '';
    if (!openFence) {
      openFence = backticks;
    } else if (backticks.length >= openFence.length) {
      openFence = null;
    }
  }
  return openFence ? text + '\n' + openFence : text;
}

function formatTime(timestamp: number): string {
  if (!timestamp || isNaN(timestamp) || timestamp <= 0) return '';
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export default PodActivityTabs;
