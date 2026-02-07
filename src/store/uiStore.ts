/**
 * UI Store - Global UI State Management
 * 
 * Manages:
 * - Theme
 * - Layout
 * - Modals
 * - Notifications
 * - Command palette
 * - Keyboard shortcuts
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';

import {
  Theme,
  RightPanelContent,
  NotificationType,
} from '../types/ui';
import type {
  LayoutState,
  ModalState,
  Notification,
  Command,
  KeyboardShortcut,
} from '../types/ui';

// ============================================================================
// STORE STATE TYPE
// ============================================================================

interface UIState {
  // Theme
  theme: Theme;
  
  // Layout
  layout: LayoutState;
  
  // Modals
  modal: ModalState;
  
  // Notifications
  notifications: Notification[];
  
  // Command palette
  commandPaletteOpen: boolean;
  commandPaletteQuery: string;
  
  // Keyboard shortcuts
  shortcuts: KeyboardShortcut[];
  shortcutsEnabled: boolean;
  
  // Loading
  globalLoading: boolean;
  loadingMessage?: string;
  
  // Network status
  isOnline: boolean;
  
  // Viewport
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

interface UIActions {
  // Theme
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  
  // Layout
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setRightPanel: (content: RightPanelContent, visible?: boolean) => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  
  // Modals
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  
  // Notifications
  addNotification: (notification: Omit<Notification, 'id' | 'createdAt'>) => string;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showWarning: (title: string, message?: string) => void;
  showInfo: (title: string, message?: string) => void;
  
  // Command palette
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setCommandPaletteQuery: (query: string) => void;
  
  // Keyboard shortcuts
  registerShortcut: (shortcut: KeyboardShortcut) => void;
  unregisterShortcut: (id: string) => void;
  toggleShortcuts: () => void;
  
  // Loading
  setGlobalLoading: (loading: boolean, message?: string) => void;
  
  // Network
  setOnlineStatus: (isOnline: boolean) => void;
  
  // Viewport
  updateViewport: (width: number, height: number) => void;
}

// ============================================================================
// DEFAULT LAYOUT
// ============================================================================

const DEFAULT_LAYOUT: LayoutState = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
  rightPanelWidth: 320,
  rightPanelVisible: false,
  rightPanelContent: RightPanelContent.NONE,
};

// ============================================================================
// ZUSTAND STORE
// ============================================================================

export const useUIStore = create<UIState & UIActions>()(
  persist(
    immer((set, get) => ({
      // ========================================================================
      // INITIAL STATE
      // ========================================================================
      
      theme: Theme.DARK,
      layout: DEFAULT_LAYOUT,
      modal: { type: null },
      notifications: [],
      commandPaletteOpen: false,
      commandPaletteQuery: '',
      shortcuts: [],
      shortcutsEnabled: true,
      globalLoading: false,
      isOnline: navigator.onLine,
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      
      // ========================================================================
      // THEME
      // ========================================================================
      
      setTheme: (theme) => {
        set({ theme });
        
        // Update DOM
        const root = document.documentElement;
        root.setAttribute('data-theme', theme === Theme.AUTO ? 'dark' : theme);
        
        // Handle auto theme
        if (theme === Theme.AUTO) {
          const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        }
      },
      
      toggleTheme: () => {
        const currentTheme = get().theme;
        const newTheme = currentTheme === Theme.DARK ? Theme.LIGHT : Theme.DARK;
        get().setTheme(newTheme);
      },
      
      // ========================================================================
      // LAYOUT
      // ========================================================================
      
      setSidebarWidth: (width) => {
        set((state) => {
          state.layout.sidebarWidth = Math.max(200, Math.min(400, width));
        });
      },
      
      toggleSidebar: () => {
        set((state) => {
          state.layout.sidebarCollapsed = !state.layout.sidebarCollapsed;
        });
      },
      
      setRightPanel: (content, visible = true) => {
        set((state) => {
          state.layout.rightPanelContent = content;
          state.layout.rightPanelVisible = visible;
        });
      },
      
      toggleRightPanel: () => {
        set((state) => {
          state.layout.rightPanelVisible = !state.layout.rightPanelVisible;
        });
      },
      
      setRightPanelWidth: (width) => {
        set((state) => {
          state.layout.rightPanelWidth = Math.max(280, Math.min(600, width));
        });
      },
      
      // ========================================================================
      // MODALS
      // ========================================================================
      
      openModal: (modal) => {
        set({ modal });
      },
      
      closeModal: () => {
        const { modal } = get();
        
        // Call onClose callback if provided
        modal.onClose?.();
        
        set({ modal: { type: null } });
      },
      
      // ========================================================================
      // NOTIFICATIONS
      // ========================================================================
      
      addNotification: (notification) => {
        const id = nanoid();
        const newNotification: Notification = {
          ...notification,
          id,
          createdAt: Date.now(),
        };
        
        set((state) => {
          state.notifications.push(newNotification);
          
          // Limit to 5 notifications
          if (state.notifications.length > 5) {
            state.notifications.shift();
          }
        });
        
        // Auto-remove after duration
        if (notification.duration) {
          setTimeout(() => {
            get().removeNotification(id);
          }, notification.duration);
        }
        
        return id;
      },
      
      removeNotification: (id) => {
        set((state) => {
          const index = state.notifications.findIndex((n) => n.id === id);
          if (index !== -1) {
            state.notifications.splice(index, 1);
          }
        });
      },
      
      clearNotifications: () => {
        set({ notifications: [] });
      },
      
      showSuccess: (title, message) => {
        get().addNotification({
          type: NotificationType.SUCCESS,
          title,
          message,
          duration: 3000,
        });
      },
      
      showError: (title, message) => {
        get().addNotification({
          type: NotificationType.ERROR,
          title,
          message,
          duration: 5000,
        });
      },
      
      showWarning: (title, message) => {
        get().addNotification({
          type: NotificationType.WARNING,
          title,
          message,
          duration: 4000,
        });
      },
      
      showInfo: (title, message) => {
        get().addNotification({
          type: NotificationType.INFO,
          title,
          message,
          duration: 3000,
        });
      },
      
      // ========================================================================
      // COMMAND PALETTE
      // ========================================================================
      
      openCommandPalette: () => {
        set({ commandPaletteOpen: true, commandPaletteQuery: '' });
      },
      
      closeCommandPalette: () => {
        set({ commandPaletteOpen: false, commandPaletteQuery: '' });
      },
      
      setCommandPaletteQuery: (query) => {
        set({ commandPaletteQuery: query });
      },
      
      // ========================================================================
      // KEYBOARD SHORTCUTS
      // ========================================================================
      
      registerShortcut: (shortcut) => {
        set((state) => {
          // Remove existing shortcut with same ID
          const index = state.shortcuts.findIndex((s) => s.id === shortcut.id);
          if (index !== -1) {
            state.shortcuts[index] = shortcut;
          } else {
            state.shortcuts.push(shortcut);
          }
        });
      },
      
      unregisterShortcut: (id) => {
        set((state) => {
          const index = state.shortcuts.findIndex((s) => s.id === id);
          if (index !== -1) {
            state.shortcuts.splice(index, 1);
          }
        });
      },
      
      toggleShortcuts: () => {
        set((state) => {
          state.shortcutsEnabled = !state.shortcutsEnabled;
        });
      },
      
      // ========================================================================
      // LOADING
      // ========================================================================
      
      setGlobalLoading: (loading, message) => {
        set({ globalLoading: loading, loadingMessage: message });
      },
      
      // ========================================================================
      // NETWORK
      // ========================================================================
      
      setOnlineStatus: (isOnline) => {
        set({ isOnline });
        
        if (isOnline) {
          get().showInfo('Connection restored', 'You are back online');
        } else {
          get().showWarning('Connection lost', 'Working in offline mode');
        }
      },
      
      // ========================================================================
      // VIEWPORT
      // ========================================================================
      
      updateViewport: (width, _height) => {
        set({
          isMobile: width < 768,
          isTablet: width >= 768 && width < 1024,
          isDesktop: width >= 1024,
        });
      },
    })),
    {
      name: 'alin-ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        layout: state.layout,
        shortcutsEnabled: state.shortcutsEnabled,
      }),
    }
  )
);

// ============================================================================
// INITIALIZATION
// ============================================================================

// Listen to online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useUIStore.getState().setOnlineStatus(true);
  });
  
  window.addEventListener('offline', () => {
    useUIStore.getState().setOnlineStatus(false);
  });
  
  // Listen to theme preference changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const theme = useUIStore.getState().theme;
    if (theme === Theme.AUTO) {
      const root = document.documentElement;
      root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
  
  // Listen to viewport changes
  const updateViewportSize = () => {
    useUIStore.getState().updateViewport(window.innerWidth, window.innerHeight);
  };
  
  window.addEventListener('resize', updateViewportSize);
  updateViewportSize();
}