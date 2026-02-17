/**
 * BranchingPanel - Branch management UI for conversations
 */

import React from 'react';
import {
  ArrowsPointingOutIcon,
} from '@heroicons/react/24/outline';
import { useChatStore } from '../../store/chatStore';
import { BranchTree } from './BranchTree';

export const BranchingPanel: React.FC = () => {
  const currentConversation = useChatStore(s => s.getCurrentConversation());
  const branches = currentConversation?.branches || [];
  const currentBranchId = currentConversation?.currentBranchId;

  const switchBranch = useChatStore(s => s.switchBranch);
  const deleteBranch = useChatStore(s => s.deleteBranch);

  if (!currentConversation) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No active conversation
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary text-sm gap-2 p-4">
        <ArrowsPointingOutIcon className="w-8 h-8 opacity-50" />
        <p>No branches yet</p>
        <p className="text-xs text-center">Edit a message to create a branch, or click the branch icon on any user message.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border-primary">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <ArrowsPointingOutIcon className="w-4 h-4" />
          Conversation Branches
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        <BranchTree
          branches={branches}
          currentBranchId={currentBranchId}
          onSwitchBranch={(branchId) => {
            if (currentConversation) {
              switchBranch(currentConversation.id, branchId);
            }
          }}
          onDeleteBranch={(branchId) => {
            if (currentConversation) {
              deleteBranch(currentConversation.id, branchId);
            }
          }}
        />
      </div>
    </div>
  );
};

export default BranchingPanel;
