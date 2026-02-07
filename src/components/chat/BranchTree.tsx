/**
 * BranchTree - Visual tree showing conversation branches
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  ArrowsPointingOutIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import type { ConversationBranch } from '../../types/chat';

interface BranchTreeProps {
  branches: ConversationBranch[];
  currentBranchId?: string;
  onSwitchBranch: (branchId: string) => void;
  onDeleteBranch?: (branchId: string) => void;
}

export const BranchTree: React.FC<BranchTreeProps> = ({
  branches,
  currentBranchId,
  onSwitchBranch,
  onDeleteBranch: _onDeleteBranch,
}) => {
  if (!branches || branches.length === 0) return null;

  return (
    <div className="space-y-1 p-2">
      <div className="flex items-center gap-1.5 text-xs text-text-tertiary mb-2">
        <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
        <span>{branches.length} branch{branches.length !== 1 ? 'es' : ''}</span>
      </div>
      {branches.map(branch => {
        const isActive = branch.id === currentBranchId;
        return (
          <motion.button
            key={branch.id}
            onClick={() => onSwitchBranch(branch.id)}
            className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors ${
              isActive
                ? 'bg-accent-primary/15 text-accent-primary border border-accent-primary/30'
                : 'text-text-secondary hover:bg-background-tertiary'
            }`}
            whileHover={{ x: 2 }}
          >
            <ChatBubbleLeftRightIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="truncate block">{branch.name || `Branch ${branch.id.slice(0, 6)}`}</span>
              <span className="text-text-tertiary">{branch.messages.length} messages</span>
            </div>
            {isActive && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-accent-primary/20">active</span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
};

export default BranchTree;
