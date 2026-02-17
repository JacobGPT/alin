/**
 * ModalRenderer - Global Modal Rendering Component
 *
 * Listens to the UI store modal state and renders the appropriate modal.
 * Supported modal types:
 * - settings: Full settings modal
 * - export-chat: Export conversation modal
 * - import-chat: Import conversation modal
 * - keyboard-shortcuts: Keyboard shortcuts help
 * - confirm: Generic confirmation dialog
 */

import { lazy, Suspense } from 'react';
import { useUIStore } from '@store/uiStore';
import { useChatStore } from '@store/chatStore';
import { Modal, ModalFooter, ConfirmModal } from '@components/ui/Modal';
import { Button } from '@components/ui/Button';
import {
  DocumentArrowDownIcon,
  DocumentArrowUpIcon,
  KeyIcon,
} from '@heroicons/react/24/outline';

// Lazy load heavy modals
const SettingsModal = lazy(() => import('@components/settings/SettingsModal'));
const AuditDashboard = lazy(() => import('@components/audit/AuditDashboard'));
const TemplateSelector = lazy(() => import('@components/tbwo/TemplateSelector'));

// ============================================================================
// MODAL RENDERER COMPONENT
// ============================================================================

export function ModalRenderer() {
  const modal = useUIStore((state) => state.modal);
  const closeModal = useUIStore((state) => state.closeModal);
  const showSuccess = useUIStore((state) => state.showSuccess);
  const showError = useUIStore((state) => state.showError);

  const isOpen = modal.type !== null;

  // ========================================================================
  // EXPORT CHAT MODAL
  // ========================================================================

  const ExportChatModal = () => {
    const conversationId = modal.props?.conversationId as string | undefined;
    const exportConversation = useChatStore((state) => state.exportConversation);
    const getConversationById = useChatStore((state) => state.getConversationById);

    const conversation = conversationId ? getConversationById(conversationId as string) : null;

    const handleExport = async (format: 'json' | 'markdown' | 'txt') => {
      if (!conversationId) return;

      try {
        const data = await exportConversation(conversationId);

        let content = data;
        let filename = `conversation-${conversationId}`;
        let mimeType = 'application/json';

        if (format === 'markdown') {
          const conv = JSON.parse(data);
          content = convertToMarkdown(conv);
          filename += '.md';
          mimeType = 'text/markdown';
        } else if (format === 'txt') {
          const conv = JSON.parse(data);
          content = convertToText(conv);
          filename += '.txt';
          mimeType = 'text/plain';
        } else {
          filename += '.json';
        }

        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        showSuccess('Conversation exported successfully');
        closeModal();
      } catch (error) {
        console.error('Export failed:', error);
        showError('Failed to export conversation');
      }
    };

    return (
      <Modal
        isOpen={modal.type === 'export-chat'}
        onClose={closeModal}
        title="Export Conversation"
        description={conversation ? `Export "${conversation.title}"` : 'Export conversation'}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Choose a format to export your conversation:
          </p>

          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => handleExport('json')}
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-border-primary p-4 transition-all hover:border-brand-primary hover:bg-brand-primary/5"
            >
              <DocumentArrowDownIcon className="h-8 w-8 text-brand-primary" />
              <span className="text-sm font-medium text-text-primary">JSON</span>
              <span className="text-xs text-text-tertiary">Full data</span>
            </button>

            <button
              onClick={() => handleExport('markdown')}
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-border-primary p-4 transition-all hover:border-brand-primary hover:bg-brand-primary/5"
            >
              <DocumentArrowDownIcon className="h-8 w-8 text-brand-primary" />
              <span className="text-sm font-medium text-text-primary">Markdown</span>
              <span className="text-xs text-text-tertiary">Readable</span>
            </button>

            <button
              onClick={() => handleExport('txt')}
              className="flex flex-col items-center gap-2 rounded-lg border-2 border-border-primary p-4 transition-all hover:border-brand-primary hover:bg-brand-primary/5"
            >
              <DocumentArrowDownIcon className="h-8 w-8 text-brand-primary" />
              <span className="text-sm font-medium text-text-primary">Text</span>
              <span className="text-xs text-text-tertiary">Plain text</span>
            </button>
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" onClick={closeModal}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    );
  };

  // ========================================================================
  // IMPORT CHAT MODAL
  // ========================================================================

  const ImportChatModal = () => {
    const importConversation = useChatStore((state) => state.importConversation);

    const handleImport = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = async (e) => {
            try {
              const data = e.target?.result as string;
              await importConversation(data);
              showSuccess('Conversation imported successfully');
              closeModal();
            } catch (error) {
              console.error('Import failed:', error);
              showError('Failed to import conversation. Invalid file format.');
            }
          };
          reader.readAsText(file);
        }
      };
      input.click();
    };

    return (
      <Modal
        isOpen={modal.type === 'import-chat'}
        onClose={closeModal}
        title="Import Conversation"
        description="Import a previously exported conversation"
        size="md"
      >
        <div className="space-y-4">
          <div className="rounded-lg border-2 border-dashed border-border-primary p-8 text-center">
            <DocumentArrowUpIcon className="mx-auto mb-4 h-12 w-12 text-text-tertiary" />
            <p className="mb-2 text-sm font-medium text-text-primary">
              Select a JSON file to import
            </p>
            <p className="mb-4 text-xs text-text-tertiary">
              Only JSON files exported from ALIN are supported
            </p>
            <Button onClick={handleImport}>
              Choose File
            </Button>
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" onClick={closeModal}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    );
  };

  // ========================================================================
  // KEYBOARD SHORTCUTS MODAL
  // ========================================================================

  const KeyboardShortcutsModal = () => {
    const shortcuts = [
      { keys: ['Cmd/Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['Cmd/Ctrl', ','], description: 'Open settings' },
      { keys: ['Cmd/Ctrl', '/'], description: 'Show keyboard shortcuts' },
      { keys: ['Cmd/Ctrl', 'Shift', 'N'], description: 'New conversation' },
      { keys: ['Cmd/Ctrl', 'Shift', 'D'], description: 'Toggle theme' },
      { keys: ['Enter'], description: 'Send message' },
      { keys: ['Shift', 'Enter'], description: 'New line in message' },
      { keys: ['Escape'], description: 'Close modal/palette' },
    ];

    return (
      <Modal
        isOpen={modal.type === 'keyboard-shortcuts'}
        onClose={closeModal}
        title="Keyboard Shortcuts"
        description="Quick actions to boost your productivity"
        size="md"
      >
        <div className="space-y-2">
          {shortcuts.map((shortcut, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg bg-background-secondary p-3"
            >
              <span className="text-sm text-text-secondary">{shortcut.description}</span>
              <div className="flex items-center gap-1">
                {shortcut.keys.map((key, keyIndex) => (
                  <span key={keyIndex}>
                    <kbd className="rounded bg-background-elevated px-2 py-1 font-mono text-xs text-text-primary">
                      {key}
                    </kbd>
                    {keyIndex < shortcut.keys.length - 1 && (
                      <span className="mx-1 text-text-tertiary">+</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <ModalFooter>
          <Button onClick={closeModal}>Done</Button>
        </ModalFooter>
      </Modal>
    );
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  if (!isOpen) return null;

  return (
    <>
      {/* Settings Modal */}
      {modal.type === 'settings' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
              </div>
            }
          >
            <SettingsModal />
          </Suspense>
        </div>
      )}

      {/* Export Chat Modal */}
      {modal.type === 'export-chat' && <ExportChatModal />}

      {/* Import Chat Modal */}
      {modal.type === 'import-chat' && <ImportChatModal />}

      {/* Keyboard Shortcuts Modal */}
      {modal.type === 'keyboard-shortcuts' && <KeyboardShortcutsModal />}

      {/* Audit Dashboard Modal */}
      {modal.type === 'audit-dashboard' && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
            </div>
          }
        >
          <AuditDashboard />
        </Suspense>
      )}

      {/* New TBWO Modal */}
      {modal.type === 'new-tbwo' && (
        <Modal
          isOpen={true}
          onClose={closeModal}
          title="Create New TBWO"
          description="Select a template to create a Time-Budgeted Work Order"
          size="2xl"
        >
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-primary border-t-transparent" />
              </div>
            }
          >
            <TemplateSelector />
          </Suspense>
        </Modal>
      )}

      {/* About Modal */}
      {modal.type === 'about' && (
        <Modal
          isOpen={true}
          onClose={closeModal}
          title="About ALIN"
          description="Artificial Life Intelligence Network"
          size="md"
        >
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              ALIN is an advanced AI operating system with 400+ features including multi-agent orchestration,
              persistent memory, vision, hardware access, and time-travel debugging.
            </p>
            <div className="rounded-lg bg-background-secondary p-3 space-y-1">
              <p className="text-xs text-text-tertiary">Version: 1.0.0</p>
              <p className="text-xs text-text-tertiary">Runtime: Vite + React + TypeScript</p>
              <p className="text-xs text-text-tertiary">Backend: Node.js + SQLite</p>
              <p className="text-xs text-text-tertiary">AI: Claude + GPT + Local Models</p>
            </div>
          </div>
          <ModalFooter>
            <Button onClick={closeModal}>Close</Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Confirm Modal */}
      {modal.type === 'confirm' && (
        <ConfirmModal
          isOpen={true}
          onClose={closeModal}
          onConfirm={() => {
            (modal.props?.onConfirm as (() => void) | undefined)?.();
            closeModal();
          }}
          title={(modal.props?.title as string) || 'Confirm'}
          message={(modal.props?.message as string) || 'Are you sure?'}
          variant={(modal.props?.variant as 'danger' | 'warning' | 'info' | 'success') || 'danger'}
          confirmText={modal.props?.confirmText as string | undefined}
          cancelText={modal.props?.cancelText as string | undefined}
        />
      )}
    </>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function convertToMarkdown(conversation: any): string {
  let md = `# ${conversation.title}\n\n`;
  md += `**Created:** ${new Date(conversation.createdAt).toLocaleString()}\n`;
  md += `**Updated:** ${new Date(conversation.updatedAt).toLocaleString()}\n\n`;
  md += `---\n\n`;

  (conversation.messages || []).forEach((msg: any) => {
    const role = msg.role === 'user' ? '**You**' : '**ALIN**';
    md += `### ${role}\n\n`;

    msg.content?.forEach((block: any) => {
      if (block.type === 'text') {
        md += block.text + '\n\n';
      } else if (block.type === 'code') {
        md += `\`\`\`${block.language || ''}\n${block.code}\n\`\`\`\n\n`;
      }
    });
  });

  return md;
}

function convertToText(conversation: any): string {
  let txt = `${conversation.title}\n`;
  txt += `${'='.repeat(conversation.title.length)}\n\n`;
  txt += `Created: ${new Date(conversation.createdAt).toLocaleString()}\n`;
  txt += `Updated: ${new Date(conversation.updatedAt).toLocaleString()}\n\n`;
  txt += `---\n\n`;

  (conversation.messages || []).forEach((msg: any) => {
    const role = msg.role === 'user' ? 'You' : 'ALIN';
    txt += `[${role}]\n`;

    msg.content?.forEach((block: any) => {
      if (block.type === 'text') {
        txt += block.text + '\n';
      } else if (block.type === 'code') {
        txt += `\n${block.code}\n`;
      }
    });

    txt += '\n---\n\n';
  });

  return txt;
}

export default ModalRenderer;
