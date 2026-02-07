/**
 * UI Types - User Interface State and Component Props
 */

// ============================================================================
// THEME & APPEARANCE
// ============================================================================

export enum Theme {
  DARK = 'dark',
  LIGHT = 'light',
  AUTO = 'auto',
  SYSTEM = 'auto', // Alias — "System" in UI maps to AUTO behavior
}

export enum RightPanelContent {
  NONE = 'none',
  MEMORY = 'memory',
  TBWO = 'tbwo',
  HARDWARE = 'hardware',
  SETTINGS = 'settings',
  FILE_BROWSER = 'file_browser',
  IMAGE_GALLERY = 'image_gallery',
  SOURCE_TRACKER = 'source_tracker',
  ARTIFACT = 'artifact',
  VISION = 'vision',
  TIME_TRAVEL = 'time_travel',
}

export interface ThemeColors {
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
    elevated: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: {
    primary: string;
    secondary: string;
  };
  brand: {
    primary: string;
    secondary: string;
  };
}

// ============================================================================
// LAYOUT
// ============================================================================

export interface LayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  rightPanelWidth: number;
  rightPanelVisible: boolean;
  rightPanelContent: RightPanelContent;
}

// ============================================================================
// MODALS
// ============================================================================

export type ModalType =
  | 'settings'
  | 'new-tbwo'
  | 'export-chat'
  | 'import-chat'
  | 'keyboard-shortcuts'
  | 'about'
  | 'audit-dashboard'
  | 'confirm';

export interface ModalState {
  type: ModalType | null;
  props?: Record<string, unknown>;
  onClose?: () => void;
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

export enum NotificationType {
  SUCCESS = 'success',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

export interface Notification {
  id: string;
  type: NotificationType;
  title?: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  createdAt: number;
}

// ============================================================================
// COMMAND PALETTE
// ============================================================================

export interface Command {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  category: 'navigation' | 'action' | 'view' | 'file';
  action: () => void;
  keywords?: string[];
}

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  results: Command[];
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

export interface KeyboardShortcut {
  id: string;
  name: string;
  description: string;
  keys: string[];
  category: 'general' | 'navigation' | 'editing' | 'view';
  action: () => void;
  enabled: boolean;
}

// ============================================================================
// DRAG & DROP
// ============================================================================

export interface DragDropState {
  isDragging: boolean;
  draggedItemId?: string;
  draggedItemType?: string;
  dropTargetId?: string;
}

// ============================================================================
// CONTEXT MENU
// ============================================================================

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
  submenu?: ContextMenuItem[];
}

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

// ============================================================================
// TOAST
// ============================================================================

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  message: string;
  duration?: number;
  position?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
}

// ============================================================================
// LOADING
// ============================================================================

export interface LoadingState {
  isLoading: boolean;
  message?: string;
  progress?: number;
}

// ============================================================================
// ERROR
// ============================================================================

export interface ErrorInfo {
  message: string;
  code?: string;
  details?: string;
  stack?: string;
  timestamp: number;
}

// ============================================================================
// VIEWPORT
// ============================================================================

export enum ViewportSize {
  MOBILE = 'mobile',    // < 768px
  TABLET = 'tablet',    // 768px - 1024px
  DESKTOP = 'desktop',  // > 1024px
}

export interface ViewportState {
  width: number;
  height: number;
  size: ViewportSize;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

// ============================================================================
// SCROLL
// ============================================================================

export interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isAtTop: boolean;
  isAtBottom: boolean;
}

// ============================================================================
// SELECTION
// ============================================================================

export interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId?: string;
  isSelecting: boolean;
}

// ============================================================================
// ANIMATION
// ============================================================================

export interface AnimationState {
  enabled: boolean;
  reducedMotion: boolean;
  duration: 'fast' | 'normal' | 'slow';
}

// ============================================================================
// ACCESSIBILITY
// ============================================================================

export interface A11yState {
  screenReaderEnabled: boolean;
  highContrast: boolean;
  keyboardNavigation: boolean;
  focusVisible: boolean;
}

// ============================================================================
// SIDEBAR ITEM
// ============================================================================

export interface SidebarItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  path?: string;
  badge?: string | number;
  children?: SidebarItem[];
  collapsed?: boolean;
  active?: boolean;
}

// ============================================================================
// PANEL
// ============================================================================

export interface PanelConfig {
  id: string;
  title: string;
  icon?: React.ReactNode;
  component: React.ComponentType;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  resizable?: boolean;
  closable?: boolean;
}
