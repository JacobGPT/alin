/**
 * ProactiveSuggestions - Suggestion chips displayed above the input area
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LightBulbIcon,
  XMarkIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
  BookOpenIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { useProactiveStore, type Suggestion } from '../../store/proactiveStore';

interface ProactiveSuggestionsProps {
  onAction?: (handler: string, params?: Record<string, unknown>) => void;
}

const SUGGESTION_ICONS: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  action: SparklesIcon,
  info: LightBulbIcon,
  tbwo: CpuChipIcon,
  memory: BookOpenIcon,
  tool: WrenchScrewdriverIcon,
};

const SUGGESTION_COLORS: Record<string, string> = {
  action: 'border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10',
  info: 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10',
  tbwo: 'border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10',
  memory: 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10',
  tool: 'border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10',
};

export const ProactiveSuggestions: React.FC<ProactiveSuggestionsProps> = ({ onAction }) => {
  const suggestions = useProactiveStore(s => s.getActiveSuggestions());
  const dismissSuggestion = useProactiveStore(s => s.dismissSuggestion);
  const enabled = useProactiveStore(s => s.enabled);

  if (!enabled || suggestions.length === 0) return null;

  return (
    <div className="px-4 py-2">
      <AnimatePresence>
        <div className="flex flex-wrap gap-2">
          {suggestions.slice(0, 3).map(suggestion => (
            <SuggestionChip
              key={suggestion.id}
              suggestion={suggestion}
              onDismiss={() => dismissSuggestion(suggestion.id)}
              onAction={onAction}
            />
          ))}
        </div>
      </AnimatePresence>
    </div>
  );
};

const SuggestionChip: React.FC<{
  suggestion: Suggestion;
  onDismiss: () => void;
  onAction?: (handler: string, params?: Record<string, unknown>) => void;
}> = ({ suggestion, onDismiss, onAction }) => {
  const Icon = SUGGESTION_ICONS[suggestion.type] || LightBulbIcon;
  const colorClass = SUGGESTION_COLORS[suggestion.type] || SUGGESTION_COLORS['info'] || '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      className={`group flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition-colors cursor-pointer ${colorClass}`}
      onClick={() => {
        if (suggestion.action && onAction) {
          onAction(suggestion.action.handler, suggestion.action.params);
        }
      }}
    >
      <Icon className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="text-text-primary max-w-[200px] truncate">{suggestion.title}</span>
      {suggestion.action && (
        <span className="text-accent-primary text-[10px] font-medium">
          {suggestion.action.label}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
      >
        <XMarkIcon className="w-3 h-3 text-text-tertiary hover:text-text-primary" />
      </button>
    </motion.div>
  );
};

export default ProactiveSuggestions;
