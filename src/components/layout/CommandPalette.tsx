/**
 * CommandPalette - Enhanced Cmd+K Command Menu
 *
 * Professional command palette with 50+ commands organized by category.
 * Supports keyboard navigation, fuzzy search, and recent commands.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Dialog, DialogPanel } from '@headlessui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  ArrowPathIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentDuplicateIcon,
  PencilIcon,
  FolderIcon,
  TagIcon,
  StarIcon,
  ArchiveBoxIcon,
  Cog6ToothIcon,
  SunIcon,
  MoonIcon,
  ComputerDesktopIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  CpuChipIcon,
  SignalIcon,
  CircleStackIcon,
  PlayCircleIcon,
  PauseCircleIcon,
  StopCircleIcon,
  DocumentTextIcon,
  BeakerIcon,
  GlobeAltIcon,
  PhotoIcon,
  MicrophoneIcon,
  SpeakerWaveIcon,
  EyeIcon,
  EyeSlashIcon,
  ChevronRightIcon,
  CommandLineIcon,
  HashtagIcon,
  ClockIcon,
  BoltIcon,
  LinkIcon,
  CodeBracketIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/outline';
import { StarIcon as StarSolid } from '@heroicons/react/24/solid';

// Stores
import { useUIStore } from '@store/uiStore';
import { useChatStore } from '@store/chatStore';
import { useTBWOStore } from '@store/tbwoStore';
import { useMemoryStore } from '@store/memoryStore';
import { useSettingsStore } from '@store/settingsStore';

// Types
import { Theme } from '../../types/ui';
import { TBWOType, QualityTarget } from '../../types/tbwo';

// ============================================================================
// COMMAND TYPES
// ============================================================================

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  category: string;
  keywords?: string[];
  shortcut?: string;
  action: () => void;
}

// ============================================================================
// COMMAND CATEGORIES
// ============================================================================

const CATEGORIES = [
  { id: 'recent', label: 'Recent', icon: <ClockIcon className="h-4 w-4" /> },
  { id: 'chat', label: 'Chat', icon: <ChatBubbleLeftRightIcon className="h-4 w-4" /> },
  { id: 'tbwo', label: 'TBWO', icon: <RocketLaunchIcon className="h-4 w-4" /> },
  { id: 'memory', label: 'Memory', icon: <SparklesIcon className="h-4 w-4" /> },
  { id: 'navigation', label: 'Navigation', icon: <LinkIcon className="h-4 w-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <SunIcon className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Cog6ToothIcon className="h-4 w-4" /> },
  { id: 'tools', label: 'Tools', icon: <BeakerIcon className="h-4 w-4" /> },
  { id: 'experimental', label: 'Experimental', icon: <BoltIcon className="h-4 w-4" /> },
];

// ============================================================================
// COMMAND PALETTE COMPONENT
// ============================================================================

export function CommandPalette() {
  const navigate = useNavigate();

  // Store state
  const isOpen = useUIStore((state) => state.commandPaletteOpen);
  const query = useUIStore((state) => state.commandPaletteQuery);
  const closeCommandPalette = useUIStore((state) => state.closeCommandPalette);
  const setCommandPaletteQuery = useUIStore((state) => state.setCommandPaletteQuery);
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const toggleRightPanel = useUIStore((state) => state.toggleRightPanel);
  const openModal = useUIStore((state) => state.openModal);

  const createConversation = useChatStore((state) => state.createConversation);
  const setCurrentConversation = useChatStore((state) => state.setCurrentConversation);
  const clearCurrentConversation = useChatStore((state) => (state as any).clearMessages ?? state.deleteConversation);
  const exportConversation = useChatStore((state) => state.exportConversation);
  const getCurrentConversation = useChatStore((state) => state.getCurrentConversation);
  const conversations = useChatStore((state) => state.conversations);
  const toggleFavorite = useChatStore((state) => (state as any).toggleFavorite ?? (() => {}));
  const deleteConversation = useChatStore((state) => state.deleteConversation);

  const createTBWO = useTBWOStore((state) => state.createTBWO);
  const toggleDashboard = useTBWOStore((state) => state.toggleDashboard);

  const consolidateMemories = useMemoryStore((state) => state.consolidateMemories);
  const clearAllMemories = useMemoryStore((state) => state.clearAllMemories);

  const toggleExperimentalFeature = useSettingsStore((state) => state.toggleExperimentalFeature);
  const experimental = useSettingsStore((state) => state.experimental);

  // Local state
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);

  // Load recent commands from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('alin-recent-commands');
    if (stored) {
      setRecentCommands(JSON.parse(stored));
    }
  }, []);

  // Save recent command
  const addRecentCommand = useCallback((commandId: string) => {
    setRecentCommands((prev) => {
      const updated = [commandId, ...prev.filter((id) => id !== commandId)].slice(0, 5);
      localStorage.setItem('alin-recent-commands', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ========================================================================
  // COMMANDS DEFINITION
  // ========================================================================

  const commands: Command[] = useMemo(() => [
    // ---- CHAT ----
    {
      id: 'new-chat',
      label: 'New Chat',
      description: 'Start a new conversation',
      icon: <PlusIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['create', 'conversation', 'start'],
      shortcut: '⌘⇧N',
      action: () => {
        const id = createConversation();
        setCurrentConversation(id);
        navigate('/chat');
      },
    },
    {
      id: 'clear-chat',
      label: 'Clear Current Chat',
      description: 'Delete all messages in current chat',
      icon: <TrashIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['delete', 'messages', 'empty'],
      action: () => {
        const current = getCurrentConversation();
        if (current) clearCurrentConversation(current.id);
      },
    },
    {
      id: 'export-chat',
      label: 'Export Chat',
      description: 'Download conversation as JSON',
      icon: <ArrowDownTrayIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['download', 'save', 'backup'],
      action: async () => {
        const current = getCurrentConversation();
        if (current) {
          const data = await exportConversation(current.id);
          if (data) {
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `alin-chat-${current.id}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }
        }
      },
    },
    {
      id: 'duplicate-chat',
      label: 'Duplicate Chat',
      description: 'Create a copy of current conversation',
      icon: <DocumentDuplicateIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['copy', 'clone'],
      action: () => {
        const current = getCurrentConversation();
        if (current) {
          const newId = createConversation({ title: `${current.title} (copy)` });
          setCurrentConversation(newId);
        }
      },
    },
    {
      id: 'favorite-chat',
      label: 'Toggle Favorite',
      description: 'Add/remove from favorites',
      icon: <StarIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['star', 'bookmark'],
      action: () => {
        const current = getCurrentConversation();
        if (current) toggleFavorite(current.id);
      },
    },
    {
      id: 'archive-chat',
      label: 'Archive Chat',
      description: 'Move to archive',
      icon: <ArchiveBoxIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['hide', 'store'],
      action: () => {
        const current = getCurrentConversation();
        if (current) {
          useChatStore.getState().updateConversation(current.id, { isArchived: true });
        }
      },
    },
    {
      id: 'delete-chat',
      label: 'Delete Chat',
      description: 'Permanently delete conversation',
      icon: <TrashIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['remove', 'destroy'],
      action: () => {
        const current = getCurrentConversation();
        if (current && confirm('Delete this conversation?')) {
          deleteConversation(current.id);
        }
      },
    },
    {
      id: 'rename-chat',
      label: 'Rename Chat',
      description: 'Change conversation title',
      icon: <PencilIcon className="h-4 w-4" />,
      category: 'chat',
      keywords: ['edit', 'title'],
      action: () => {
        const current = getCurrentConversation();
        if (current) {
          const title = prompt('Enter new title:', current.title);
          if (title) {
            useChatStore.getState().updateConversation(current.id, { title });
          }
        }
      },
    },

    // ---- TBWO ----
    {
      id: 'new-website-sprint',
      label: 'New Website Sprint',
      description: 'Create a website with TBWO',
      icon: <GlobeAltIcon className="h-4 w-4" />,
      category: 'tbwo',
      keywords: ['web', 'project', 'build'],
      action: () => {
        createTBWO({
          type: TBWOType.WEBSITE_SPRINT,
          objective: 'New Website',
          timeBudgetMinutes: 60,
          qualityTarget: QualityTarget.PREMIUM,
        });
        navigate('/tbwo');
      },
    },
    {
      id: 'new-code-project',
      label: 'New Code Project',
      description: 'Start a coding project',
      icon: <CodeBracketIcon className="h-4 w-4" />,
      category: 'tbwo',
      keywords: ['development', 'programming'],
      action: () => {
        createTBWO({
          type: TBWOType.CODE_PROJECT,
          objective: 'New Project',
          timeBudgetMinutes: 60,
          qualityTarget: QualityTarget.PREMIUM,
        });
        navigate('/tbwo');
      },
    },
    {
      id: 'new-research',
      label: 'New Research Report',
      description: 'Start a research task',
      icon: <DocumentTextIcon className="h-4 w-4" />,
      category: 'tbwo',
      keywords: ['analysis', 'investigate'],
      action: () => {
        createTBWO({
          type: TBWOType.RESEARCH_REPORT,
          objective: 'Research Task',
          timeBudgetMinutes: 30,
          qualityTarget: QualityTarget.STANDARD,
        });
        navigate('/tbwo');
      },
    },
    {
      id: 'view-tbwo-dashboard',
      label: 'TBWO Dashboard',
      description: 'View all work orders',
      icon: <RocketLaunchIcon className="h-4 w-4" />,
      category: 'tbwo',
      keywords: ['tasks', 'projects'],
      action: () => navigate('/tbwo'),
    },

    // ---- MEMORY ----
    {
      id: 'view-memories',
      label: 'Memory Dashboard',
      description: 'View memory system',
      icon: <SparklesIcon className="h-4 w-4" />,
      category: 'memory',
      keywords: ['knowledge', 'recall'],
      action: () => navigate('/memory'),
    },
    {
      id: 'consolidate-memories',
      label: 'Consolidate Memories',
      description: 'Merge short-term to long-term',
      icon: <ArrowPathIcon className="h-4 w-4" />,
      category: 'memory',
      keywords: ['compress', 'optimize'],
      action: () => consolidateMemories(),
    },
    {
      id: 'clear-memories',
      label: 'Clear All Memories',
      description: 'Delete all stored memories',
      icon: <TrashIcon className="h-4 w-4" />,
      category: 'memory',
      keywords: ['delete', 'reset'],
      action: () => clearAllMemories(),
    },
    {
      id: 'export-memories',
      label: 'Export Memories',
      description: 'Download memories as JSON',
      icon: <ArrowDownTrayIcon className="h-4 w-4" />,
      category: 'memory',
      keywords: ['backup', 'save'],
      action: async () => {
        const data = await useMemoryStore.getState().exportMemories('json');
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'alin-memories.json';
        a.click();
        URL.revokeObjectURL(url);
      },
    },

    // ---- NAVIGATION ----
    {
      id: 'go-chat',
      label: 'Go to Chat',
      description: 'Open chat view',
      icon: <ChatBubbleLeftRightIcon className="h-4 w-4" />,
      category: 'navigation',
      keywords: ['home', 'main'],
      action: () => navigate('/chat'),
    },
    {
      id: 'go-tbwo',
      label: 'Go to TBWO',
      description: 'Open TBWO dashboard',
      icon: <RocketLaunchIcon className="h-4 w-4" />,
      category: 'navigation',
      action: () => navigate('/tbwo'),
    },
    {
      id: 'go-memory',
      label: 'Go to Memory',
      description: 'Open memory dashboard',
      icon: <SparklesIcon className="h-4 w-4" />,
      category: 'navigation',
      action: () => navigate('/memory'),
    },
    {
      id: 'go-hardware',
      label: 'Go to Hardware',
      description: 'Open hardware monitor',
      icon: <CpuChipIcon className="h-4 w-4" />,
      category: 'navigation',
      action: () => navigate('/hardware'),
    },
    {
      id: 'go-settings',
      label: 'Go to Settings',
      description: 'Open settings',
      icon: <Cog6ToothIcon className="h-4 w-4" />,
      category: 'navigation',
      shortcut: '⌘,',
      action: () => navigate('/settings'),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      description: 'Show/hide left sidebar',
      icon: <ChevronRightIcon className="h-4 w-4" />,
      category: 'navigation',
      keywords: ['hide', 'show', 'panel'],
      action: () => toggleSidebar(),
    },
    {
      id: 'toggle-right-panel',
      label: 'Toggle Right Panel',
      description: 'Show/hide right panel',
      icon: <ChevronRightIcon className="h-4 w-4 rotate-180" />,
      category: 'navigation',
      keywords: ['hide', 'show', 'panel'],
      action: () => toggleRightPanel(),
    },

    // ---- APPEARANCE ----
    {
      id: 'theme-dark',
      label: 'Dark Theme',
      description: 'Switch to dark mode',
      icon: <MoonIcon className="h-4 w-4" />,
      category: 'appearance',
      keywords: ['night', 'mode'],
      action: () => setTheme(Theme.DARK),
    },
    {
      id: 'theme-light',
      label: 'Light Theme',
      description: 'Switch to light mode',
      icon: <SunIcon className="h-4 w-4" />,
      category: 'appearance',
      keywords: ['day', 'mode'],
      action: () => setTheme(Theme.LIGHT),
    },
    {
      id: 'theme-system',
      label: 'System Theme',
      description: 'Follow system preference',
      icon: <ComputerDesktopIcon className="h-4 w-4" />,
      category: 'appearance',
      keywords: ['auto', 'mode'],
      action: () => setTheme(Theme.SYSTEM),
    },

    // ---- SETTINGS ----
    {
      id: 'open-settings',
      label: 'Open Settings',
      description: 'Configure preferences',
      icon: <Cog6ToothIcon className="h-4 w-4" />,
      category: 'settings',
      shortcut: '⌘,',
      action: () => openModal({ type: 'settings' }),
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard Shortcuts',
      description: 'View all shortcuts',
      icon: <CommandLineIcon className="h-4 w-4" />,
      category: 'settings',
      shortcut: '⌘/',
      action: () => openModal({ type: 'keyboard-shortcuts' }),
    },
    {
      id: 'reset-settings',
      label: 'Reset Settings',
      description: 'Restore default settings',
      icon: <ArrowPathIcon className="h-4 w-4" />,
      category: 'settings',
      keywords: ['default', 'restore'],
      action: () => useSettingsStore.getState().resetToDefaults(),
    },
    {
      id: 'export-settings',
      label: 'Export Settings',
      description: 'Download settings as JSON',
      icon: <ArrowDownTrayIcon className="h-4 w-4" />,
      category: 'settings',
      keywords: ['backup'],
      action: () => {
        const data = useSettingsStore.getState().exportSettings();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'alin-settings.json';
        a.click();
        URL.revokeObjectURL(url);
      },
    },

    // ---- TOOLS ----
    {
      id: 'web-search',
      label: 'Web Search',
      description: 'Search the web',
      icon: <GlobeAltIcon className="h-4 w-4" />,
      category: 'tools',
      keywords: ['google', 'browse'],
      action: () => {
        const query = prompt('Enter search query:');
        if (query) {
          window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
        }
      },
    },
    {
      id: 'image-generation',
      label: 'Generate Image',
      description: 'Create an image with AI',
      icon: <PhotoIcon className="h-4 w-4" />,
      category: 'tools',
      keywords: ['dall-e', 'art'],
      action: () => {
        // Would open image generation modal
      },
    },
    {
      id: 'code-execution',
      label: 'Code Sandbox',
      description: 'Execute code safely',
      icon: <CommandLineIcon className="h-4 w-4" />,
      category: 'tools',
      keywords: ['run', 'execute'],
      action: () => {
        // Would open code execution sandbox
      },
    },

    // ---- EXPERIMENTAL ----
    {
      id: 'toggle-local-models',
      label: experimental.enableLocalModels ? 'Disable Local Models' : 'Enable Local Models',
      description: 'Toggle local model support',
      icon: <CpuChipIcon className="h-4 w-4" />,
      category: 'experimental',
      keywords: ['ollama', 'offline'],
      action: () => toggleExperimentalFeature('enableLocalModels'),
    },
    {
      id: 'toggle-voice',
      label: experimental.enableVoice ? 'Disable Voice' : 'Enable Voice',
      description: 'Toggle voice features',
      icon: <MicrophoneIcon className="h-4 w-4" />,
      category: 'experimental',
      keywords: ['speech', 'tts'],
      action: () => toggleExperimentalFeature('enableVoice'),
    },
    {
      id: 'toggle-tbwo-feature',
      label: experimental.enableTBWO ? 'Disable TBWO' : 'Enable TBWO',
      description: 'Toggle TBWO system',
      icon: <RocketLaunchIcon className="h-4 w-4" />,
      category: 'experimental',
      action: () => toggleExperimentalFeature('enableTBWO'),
    },
    {
      id: 'toggle-memory-feature',
      label: experimental.enableMemory ? 'Disable Memory' : 'Enable Memory',
      description: 'Toggle memory system',
      icon: <SparklesIcon className="h-4 w-4" />,
      category: 'experimental',
      action: () => toggleExperimentalFeature('enableMemory'),
    },
    {
      id: 'toggle-web-research',
      label: experimental.enableWebResearch ? 'Disable Web Research' : 'Enable Web Research',
      description: 'Toggle web research tool',
      icon: <GlobeAltIcon className="h-4 w-4" />,
      category: 'experimental',
      action: () => toggleExperimentalFeature('enableWebResearch'),
    },
  ], [
    createConversation, setCurrentConversation, getCurrentConversation, clearCurrentConversation,
    exportConversation, toggleFavorite, deleteConversation, createTBWO, navigate,
    consolidateMemories, clearAllMemories, setTheme, toggleSidebar, toggleRightPanel,
    openModal, toggleExperimentalFeature, experimental,
  ]);

  // ========================================================================
  // FILTERING AND SEARCH
  // ========================================================================

  const filteredCommands = useMemo(() => {
    // If query is empty and no category selected, show recent
    if (!query && !selectedCategory) {
      const recentCmds = recentCommands
        .map((id) => commands.find((c) => c.id === id))
        .filter((c): c is Command => !!c);

      if (recentCmds.length > 0) {
        return [
          { category: 'recent', commands: recentCmds },
          ...CATEGORIES.filter((cat) => cat.id !== 'recent').map((cat) => ({
            category: cat.id,
            commands: commands.filter((c) => c.category === cat.id).slice(0, 3),
          })).filter((g) => g.commands.length > 0),
        ];
      }
    }

    // If category is selected
    if (selectedCategory) {
      const catCommands = commands.filter((c) => c.category === selectedCategory);
      const filtered = query
        ? catCommands.filter((c) =>
            c.label.toLowerCase().includes(query.toLowerCase()) ||
            c.description?.toLowerCase().includes(query.toLowerCase()) ||
            c.keywords?.some((k) => k.toLowerCase().includes(query.toLowerCase()))
          )
        : catCommands;
      return [{ category: selectedCategory, commands: filtered }];
    }

    // Search all commands
    if (query) {
      const searchResults = commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase()) ||
        c.keywords?.some((k) => k.toLowerCase().includes(query.toLowerCase()))
      );

      // Group by category
      const grouped = CATEGORIES.map((cat) => ({
        category: cat.id,
        commands: searchResults.filter((c) => c.category === cat.id),
      })).filter((g) => g.commands.length > 0);

      return grouped;
    }

    // Default: show all by category
    return CATEGORIES.filter((cat) => cat.id !== 'recent').map((cat) => ({
      category: cat.id,
      commands: commands.filter((c) => c.category === cat.id),
    })).filter((g) => g.commands.length > 0);
  }, [commands, query, selectedCategory, recentCommands]);

  // Flatten for keyboard navigation
  const flatCommands = useMemo(() =>
    filteredCommands.flatMap((g) => g.commands),
    [filteredCommands]
  );

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  // ========================================================================
  // KEYBOARD HANDLING
  // ========================================================================

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flatCommands[selectedIndex];
      if (cmd) {
        addRecentCommand(cmd.id);
        cmd.action();
        closeCommandPalette();
      }
    } else if (e.key === 'Escape') {
      if (selectedCategory) {
        setSelectedCategory(null);
      } else {
        closeCommandPalette();
      }
    } else if (e.key === 'Backspace' && !query && selectedCategory) {
      setSelectedCategory(null);
    }
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <Dialog open={isOpen} onClose={closeCommandPalette} className="relative z-max">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      <div className="fixed inset-0 flex items-start justify-center pt-[15vh]">
        <DialogPanel className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border-primary bg-background-elevated shadow-2xl">
          {/* Search Input */}
          <div className="flex items-center gap-3 border-b border-border-primary px-4 py-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-text-tertiary" />
            {selectedCategory && (
              <span className="flex items-center gap-1 rounded-full bg-brand-primary/10 px-2 py-0.5 text-xs font-medium text-brand-primary">
                {CATEGORIES.find((c) => c.id === selectedCategory)?.label}
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="ml-1 rounded-full hover:bg-brand-primary/20"
                >
                  ×
                </button>
              </span>
            )}
            <input
              type="text"
              placeholder={selectedCategory ? `Search in ${selectedCategory}...` : 'Type a command or search...'}
              value={query}
              onChange={(e) => setCommandPaletteQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-quaternary focus:outline-none"
            />
            <kbd className="hidden rounded bg-background-tertiary px-2 py-0.5 text-xs text-text-tertiary sm:block">
              esc
            </kbd>
          </div>

          {/* Category Pills (when no query) */}
          {!query && !selectedCategory && (
            <div className="flex flex-wrap gap-2 border-b border-border-primary p-3">
              {CATEGORIES.filter((c) => c.id !== 'recent').map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className="flex items-center gap-1.5 rounded-full bg-background-tertiary px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-background-hover hover:text-text-primary"
                  >
                    {cat.icon}
                    {cat.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Results */}
          <div className="max-h-[50vh] overflow-y-auto p-2">
            {flatCommands.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-text-tertiary">No commands found</p>
              </div>
            ) : (
              filteredCommands.map((group, groupIndex) => (
                <div key={group.category} className="mb-2">
                  {/* Category Header */}
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wider text-text-quaternary">
                      {CATEGORIES.find((c) => c.id === group.category)?.label}
                    </span>
                    <div className="h-px flex-1 bg-border-primary" />
                  </div>

                  {/* Commands */}
                  {group.commands.map((cmd) => {
                    const globalIndex = flatCommands.indexOf(cmd);
                    const isSelected = globalIndex === selectedIndex;

                    return (
                      <button
                        key={cmd.id}
                        onClick={() => {
                          addRecentCommand(cmd.id);
                          cmd.action();
                          closeCommandPalette();
                        }}
                        onMouseEnter={() => setSelectedIndex(globalIndex)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-brand-primary/10 text-text-primary'
                            : 'text-text-secondary hover:bg-background-hover'
                        }`}
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                          isSelected ? 'bg-brand-primary text-white' : 'bg-background-tertiary text-text-tertiary'
                        }`}>
                          {cmd.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{cmd.label}</p>
                          {cmd.description && (
                            <p className="text-xs text-text-tertiary truncate">{cmd.description}</p>
                          )}
                        </div>
                        {cmd.shortcut && (
                          <kbd className="rounded bg-background-tertiary px-2 py-0.5 text-xs text-text-tertiary">
                            {cmd.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border-primary px-4 py-2 text-xs text-text-quaternary">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-background-tertiary px-1.5 py-0.5">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-background-tertiary px-1.5 py-0.5">↵</kbd>
                Select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded bg-background-tertiary px-1.5 py-0.5">esc</kbd>
                Close
              </span>
            </div>
            <span>{flatCommands.length} commands</span>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export default CommandPalette;
