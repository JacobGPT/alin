/**
 * ToolActivityPanel - Rich tool activity display
 *
 * Shows what tools ALIN used with FULL visibility into the work:
 * - File writes show the actual code written
 * - Code execution shows input code + output
 * - File edits show the old→new text diff
 * - Commands show the command + full output
 * - Git shows the operation + output
 * - Web search shows results with links
 * - Auto-expands activities so users see the work happening
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GlobeAltIcon,
  CircleStackIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  CommandLineIcon,
  CodeBracketSquareIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import type { ToolActivityType } from '../../store/statusStore';
import type { ToolActivitySummary } from '../../types/chat';

// ============================================================================
// TYPES
// ============================================================================

type ActivityData = ToolActivitySummary & {
  startTime?: number;
  endTime?: number;
  input?: Record<string, unknown>;
  output?: unknown;
};

interface ToolActivityPanelProps {
  activities: ActivityData[];
  isProcessing?: boolean;
}

// ============================================================================
// ICON MAPPING
// ============================================================================

const ACTIVITY_ICONS: Record<ToolActivityType, React.ComponentType<{ className?: string }>> = {
  web_search: GlobeAltIcon,
  memory_recall: CircleStackIcon,
  memory_store: CircleStackIcon,
  code_execute: CodeBracketIcon,
  file_read: DocumentTextIcon,
  file_write: DocumentTextIcon,
  image_generate: DocumentTextIcon,
  directory_scan: FolderOpenIcon,
  code_search: MagnifyingGlassIcon,
  terminal_command: CommandLineIcon,
  git_operation: CodeBracketSquareIcon,
  file_edit: PencilSquareIcon,
  other: DocumentTextIcon,
};

const ACTIVITY_COLORS: Record<ToolActivityType, string> = {
  web_search: 'text-blue-400',
  memory_recall: 'text-purple-400',
  memory_store: 'text-purple-400',
  code_execute: 'text-green-400',
  file_read: 'text-yellow-400',
  file_write: 'text-orange-400',
  image_generate: 'text-pink-400',
  directory_scan: 'text-cyan-400',
  code_search: 'text-indigo-400',
  terminal_command: 'text-emerald-400',
  git_operation: 'text-red-400',
  file_edit: 'text-amber-400',
  other: 'text-gray-400',
};

// Types that should auto-expand to show the work
const AUTO_EXPAND_TYPES: Set<ToolActivityType> = new Set([
  'file_write',
  'file_edit',
  'code_execute',
  'terminal_command',
  'git_operation',
]);

// ============================================================================
// HELPERS
// ============================================================================

function getFileExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function extractCodeFromOutput(output: string, toolName?: string): { code: string; language: string } | null {
  // Try to extract code blocks from tool output
  const codeBlockMatch = output.match(/```(\w*)\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    return { code: codeBlockMatch[2].trim(), language: codeBlockMatch[1] || 'text' };
  }
  return null;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (' + (str.length - maxLen) + ' more characters)';
}

// ============================================================================
// ACTIVITY ITEM COMPONENT
// ============================================================================

function ActivityItem({ activity }: { activity: ActivityData }) {
  const shouldAutoExpand = AUTO_EXPAND_TYPES.has(activity.type) && activity.status === 'completed';
  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);
  const Icon = ACTIVITY_ICONS[activity.type];
  const colorClass = ACTIVITY_COLORS[activity.type];

  const hasContent =
    activity.output ||
    (activity.results && activity.results.length > 0) ||
    activity.error ||
    activity.query ||
    activity.input;

  const duration = activity.startTime && activity.endTime
    ? ((activity.endTime - activity.startTime) / 1000).toFixed(1) + 's'
    : null;

  return (
    <div className="border-l-2 border-border-primary pl-3 py-1">
      {/* Header */}
      <button
        onClick={() => hasContent && setIsExpanded(!isExpanded)}
        disabled={!hasContent}
        className={`flex items-center gap-2 w-full text-left text-sm ${
          hasContent ? 'cursor-pointer hover:bg-background-hover rounded px-1 -ml-1' : ''
        }`}
      >
        {hasContent ? (
          isExpanded ? (
            <ChevronDownIcon className="h-3 w-3 text-text-tertiary flex-shrink-0" />
          ) : (
            <ChevronRightIcon className="h-3 w-3 text-text-tertiary flex-shrink-0" />
          )
        ) : (
          <div className="w-3" />
        )}
        <Icon className={`h-4 w-4 ${colorClass} flex-shrink-0`} />
        <span className="text-text-secondary flex-1">{activity.label}</span>
        {duration && (
          <span className="text-xs text-text-quaternary">{duration}</span>
        )}
        {activity.status === 'running' ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
            <ClockIcon className="h-4 w-4 text-yellow-400" />
          </motion.div>
        ) : activity.status === 'completed' ? (
          <CheckCircleIcon className="h-4 w-4 text-green-400" />
        ) : activity.status === 'error' ? (
          <ExclamationCircleIcon className="h-4 w-4 text-red-400" />
        ) : null}
      </button>

      {/* Expanded Content */}
      <AnimatePresence initial={false}>
        {isExpanded && hasContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-5 space-y-2">
              <ActivityContent activity={activity} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// ACTIVITY CONTENT (rich rendering per type)
// ============================================================================

function ActivityContent({ activity }: { activity: ActivityData }) {
  const input = activity.input || {};
  const output = typeof activity.output === 'string' ? activity.output : '';

  switch (activity.type) {
    // ------------------------------------------------------------------
    // FILE WRITE — show path + the code that was written
    // ------------------------------------------------------------------
    case 'file_write': {
      const path = (input.path as string) || '';
      const content = (input.content as string) || '';
      const ext = getFileExtension(path);
      return (
        <div className="space-y-1">
          <div className="text-xs text-text-quaternary font-mono">{path}</div>
          {content ? (
            <pre className="text-xs font-mono text-text-secondary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-64 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(content, 3000)}
            </pre>
          ) : output ? (
            <div className="text-xs text-green-400">{output.split('\n')[0]}</div>
          ) : null}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // FILE EDIT — show path + old_text → new_text diff
    // ------------------------------------------------------------------
    case 'file_edit': {
      const path = (input.path as string) || '';
      const oldText = (input.old_text as string) || '';
      const newText = (input.new_text as string) || '';
      return (
        <div className="space-y-1">
          <div className="text-xs text-text-quaternary font-mono">{path}</div>
          {oldText && (
            <div className="rounded-md border border-border-primary overflow-hidden">
              <div className="bg-red-500/10 px-3 py-1.5 border-b border-border-primary">
                <span className="text-xs font-mono text-red-400">- removed</span>
              </div>
              <pre className="text-xs font-mono text-red-300/80 px-3 py-2 overflow-x-auto max-h-32 overflow-y-auto leading-relaxed">
                {truncate(oldText, 1500)}
              </pre>
            </div>
          )}
          {newText && (
            <div className="rounded-md border border-border-primary overflow-hidden">
              <div className="bg-green-500/10 px-3 py-1.5 border-b border-border-primary">
                <span className="text-xs font-mono text-green-400">+ added</span>
              </div>
              <pre className="text-xs font-mono text-green-300/80 px-3 py-2 overflow-x-auto max-h-32 overflow-y-auto leading-relaxed">
                {truncate(newText, 1500)}
              </pre>
            </div>
          )}
          {output && !oldText && !newText && (
            <div className="text-xs text-green-400">{output.split('\n')[0]}</div>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // CODE EXECUTION — show code input + stdout/stderr
    // ------------------------------------------------------------------
    case 'code_execute': {
      const lang = (input.language as string) || 'code';
      const code = (input.code as string) || '';
      return (
        <div className="space-y-1">
          {code && (
            <div className="rounded-md border border-border-primary overflow-hidden">
              <div className="bg-background-elevated px-3 py-1 border-b border-border-primary flex items-center gap-2">
                <CodeBracketIcon className="h-3 w-3 text-text-quaternary" />
                <span className="text-xs text-text-quaternary">{lang}</span>
              </div>
              <pre className="text-xs font-mono text-text-secondary px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed">
                {truncate(code, 2000)}
              </pre>
            </div>
          )}
          {output && (
            <div className="rounded-md border border-border-primary overflow-hidden">
              <div className="bg-background-elevated px-3 py-1 border-b border-border-primary">
                <span className="text-xs text-text-quaternary">Output</span>
              </div>
              <pre className="text-xs font-mono text-green-300/80 px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed">
                {truncate(output, 2000)}
              </pre>
            </div>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // TERMINAL COMMAND — show command + output
    // ------------------------------------------------------------------
    case 'terminal_command': {
      const command = (input.command as string) || '';
      return (
        <div className="space-y-1">
          {command && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-green-400 font-mono">$</span>
              <code className="text-text-secondary font-mono">{command}</code>
            </div>
          )}
          {output && (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 2000)}
            </pre>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // GIT — show git command + output
    // ------------------------------------------------------------------
    case 'git_operation': {
      const operation = (input.operation as string) || '';
      const args = (input.args as string[]) || [];
      const fullCmd = `git ${operation}${args.length ? ' ' + args.join(' ') : ''}`;
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-red-400 font-mono">git</span>
            <code className="text-text-secondary font-mono">{operation} {args.join(' ')}</code>
          </div>
          {output && (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 2000)}
            </pre>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // FILE READ — show path + file contents
    // ------------------------------------------------------------------
    case 'file_read': {
      const path = (input.path as string) || '';
      return (
        <div className="space-y-1">
          <div className="text-xs text-text-quaternary font-mono">{path}</div>
          {output && (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 2000)}
            </pre>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // DIRECTORY SCAN — show path + summary
    // ------------------------------------------------------------------
    case 'directory_scan': {
      const path = (input.path as string) || '';
      // Output can be very large, just show file tree portion
      let treeOutput = '';
      if (output) {
        const treeMatch = output.match(/### File Tree\n```\n([\s\S]*?)```/);
        const summaryMatch = output.match(/### Summary\n([\s\S]*?)(\n###|$)/);
        if (treeMatch) treeOutput = treeMatch[1].trim();
        if (summaryMatch) treeOutput += '\n\n' + summaryMatch[1].trim();
      }
      return (
        <div className="space-y-1">
          <div className="text-xs text-text-quaternary font-mono">{path}</div>
          {treeOutput ? (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(treeOutput, 2000)}
            </pre>
          ) : output ? (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-32 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 1000)}
            </pre>
          ) : null}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // CODE SEARCH — show pattern + matches
    // ------------------------------------------------------------------
    case 'code_search': {
      const query = activity.query || (input.query as string) || '';
      const searchPath = (input.path as string) || '';
      return (
        <div className="space-y-1">
          {(query || searchPath) && (
            <div className="text-xs text-text-quaternary">
              {query && <>Pattern: <span className="text-text-tertiary font-mono">{query}</span></>}
              {query && searchPath && ' in '}
              {!query && searchPath && 'In '}
              {searchPath && <span className="font-mono">{searchPath}</span>}
            </div>
          )}
          {activity.resultCount != null && (
            <div className="text-xs text-text-quaternary">{activity.resultCount} match{activity.resultCount !== 1 ? 'es' : ''} found</div>
          )}
          {output && (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-48 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 2000)}
            </pre>
          )}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // WEB SEARCH — show results with links
    // ------------------------------------------------------------------
    case 'web_search': {
      return (
        <div className="space-y-1">
          {activity.query && (
            <div className="text-xs text-text-quaternary">
              Query: "{activity.query}"
            </div>
          )}
          {activity.results && (activity.results as any[]).length > 0 ? (
            <div className="space-y-1">
              {(activity.results as any[]).slice(0, 5).map((result, i) => (
                <a
                  key={i}
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-text-tertiary hover:text-brand-primary transition-colors"
                >
                  <GlobeAltIcon className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{result.title || result.url}</span>
                  <span className="text-text-quaternary truncate max-w-[200px]">
                    {(() => { try { return new URL(result.url).hostname; } catch { return ''; } })()}
                  </span>
                </a>
              ))}
              {(activity.results as any[]).length > 5 && (
                <div className="text-xs text-text-quaternary">
                  +{(activity.results as any[]).length - 5} more results
                </div>
              )}
            </div>
          ) : output ? (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-32 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 1000)}
            </pre>
          ) : null}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // MEMORY — show stored/recalled memories
    // ------------------------------------------------------------------
    case 'memory_recall':
    case 'memory_store': {
      return (
        <div className="space-y-1">
          {activity.results && (activity.results as any[]).length > 0 ? (
            (activity.results as any[]).slice(0, 3).map((result, i) => (
              <div key={i} className="text-xs text-text-tertiary bg-background-elevated rounded px-2 py-1">
                <span className="text-text-quaternary">[{result.type}]</span>{' '}
                {result.content?.slice(0, 100)}
                {result.content?.length > 100 && '...'}
              </div>
            ))
          ) : output ? (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-32 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 1000)}
            </pre>
          ) : null}
        </div>
      );
    }

    // ------------------------------------------------------------------
    // DEFAULT — show raw output
    // ------------------------------------------------------------------
    default: {
      return (
        <div className="space-y-1">
          {activity.query && (
            <div className="text-xs text-text-quaternary">Query: "{activity.query}"</div>
          )}
          {output && (
            <pre className="text-xs font-mono text-text-tertiary bg-background-elevated rounded-md px-3 py-2 overflow-x-auto max-h-32 overflow-y-auto border border-border-primary leading-relaxed">
              {truncate(output, 1000)}
            </pre>
          )}
        </div>
      );
    }
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ToolActivityPanel({ activities, isProcessing }: ToolActivityPanelProps) {
  // Don't render if no activities
  if (activities.length === 0) {
    return null;
  }

  const completedCount = activities.filter((a) => a.status === 'completed').length;
  const runningCount = activities.filter((a) => a.status === 'running').length;
  const errorCount = activities.filter((a) => a.status === 'error').length;

  return (
    <div className="mb-3">
      {/* Activities - always visible, no outer collapse */}
      <div className="space-y-1">
        {activities.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} />
        ))}
      </div>

      {/* Error always shown */}
      {activities.map((a) =>
        a.error ? (
          <div key={a.id + '-err'} className="mt-1 ml-5 text-xs text-red-400 bg-red-400/10 rounded px-2 py-1">
            {a.error}
          </div>
        ) : null
      )}
    </div>
  );
}

export default ToolActivityPanel;
