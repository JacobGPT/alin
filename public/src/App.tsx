/**
 * App - Main Application Component
 * 
 * UPDATED: 
 * - HomeDashboard as default route (/)
 * - ModalRenderer + CommandPalette render GLOBALLY (fixes settings on home page)
 * - Home renders without AppShell sidebar
 * - All existing routes preserved
 */

import { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';

// Stores
import { useUIStore } from '@store/uiStore';
import { useChatStore } from '@store/chatStore';
import { useSettingsStore } from '@store/settingsStore';

// API Service
import { initializeAPIService } from '@api/apiService';
import { initializeDatabase } from '@api/dbInit';
import { useProjectStore } from '@store/projectStore';

// Components
import { AppShell } from '@components/layout/AppShell';
import { LoadingScreen } from '@components/ui/LoadingScreen';
import { CommandPalette } from '@components/layout/CommandPalette';
import { ModalRenderer } from '@components/layout/ModalRenderer';
import { AuthGuard } from '@components/auth/AuthGuard';

// Lazy-loaded routes for code splitting
const HomeDashboard = lazy(() => import('@components/home/HomeDashboard'));
const ChatView = lazy(() => import('@components/chat/ChatContainer'));

// TBWO Dashboard (Phase 2 - Implemented)
const TBWODashboard = lazy(() => import('@components/tbwo/TBWODashboard'));

// Memory Dashboard (Phase 3 - Implemented)
const MemoryDashboard = lazy(() => import('@components/memory/MemoryDashboard'));

// Hardware Dashboard (Phase 4 - Implemented)
const HardwareDashboard = lazy(() => import('@components/hardware/HardwareDashboard'));

// Settings Modal
const SettingsView = lazy(() => import('@components/settings/SettingsModal'));

// Sites Dashboard (Deploy v1)
const SiteDashboard = lazy(() => import('@components/sites/SiteDashboard'));
const ThreadIngestPanel = lazy(() => import('@components/threads/ThreadIngestPanel'));


// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

function App() {
  const theme = useUIStore((state) => state.theme);
  const location = useLocation();

  // Determine if we're on the home dashboard (no sidebar needed)
  const isHomeDashboard = location.pathname === '/home';
  
  // ========================================================================
  // INITIALIZATION
  // ========================================================================
  
  useEffect(() => {
    // Apply saved theme on mount
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    // Initialize API service — API keys are now server-side only
    try {
      console.log('[ALIN] Initializing API service (server-side streaming)...');
      initializeAPIService({});
      console.log('[ALIN] API Service initialized successfully');
    } catch (error) {
      console.error('[ALIN] Failed to initialize API service:', error);
    }

    // Initialize SQLite backend (loads stores from DB if available)
    initializeDatabase().then(() => {
      // Create initial conversation if none exists (after DB load)
      const conversations = useChatStore.getState().conversations;
      if (conversations.size === 0) {
        useChatStore.getState().createConversation({
          title: 'Welcome to ALIN',
        });
      }

      // Auto-scan project if not scanned recently (> 1 hour)
      // Only scan on localhost (desktop) — deployed version doesn't have a local project
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (isLocal) {
        const projectStore = useProjectStore.getState();
        const activeProject = projectStore.getActiveProject();
        const ONE_HOUR = 3600000;
        if (!activeProject || Date.now() - activeProject.lastScanned > ONE_HOUR) {
          // Use CWD-relative path or env var; falls back gracefully if unavailable
          projectStore.scanProject('.').catch(() => {});
        }
      }
    }).catch((err) => {
      console.warn('[ALIN] DB init failed, using localStorage:', err);
      // Still create welcome conversation if needed
      const conversations = useChatStore.getState().conversations;
      if (conversations.size === 0) {
        useChatStore.getState().createConversation({
          title: 'Welcome to ALIN',
        });
      }
    });
  }, []);
  
  const uiPrefs = useSettingsStore((state) => state.ui);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);

    // Apply UI preferences to root
    const fontSizeMap = { small: '14px', medium: '16px', large: '18px' };
    root.style.fontSize = fontSizeMap[uiPrefs.fontSize] || '16px';

    const densityMap = { compact: '0.75', comfortable: '1', spacious: '1.25' };
    root.style.setProperty('--density', densityMap[uiPrefs.density] || '1');

    if (uiPrefs.accentColor) {
      root.style.setProperty('--accent-color', uiPrefs.accentColor);
    }
  }, [theme, uiPrefs.fontSize, uiPrefs.density, uiPrefs.accentColor]);
  
  // ========================================================================
  // GLOBAL KEYBOARD SHORTCUTS
  // ========================================================================
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;
      
      if (modifier && e.key === 'k') {
        e.preventDefault();
        useUIStore.getState().openCommandPalette();
      }
      
      if (modifier && e.key === '/') {
        e.preventDefault();
        useUIStore.getState().openModal({ type: 'keyboard-shortcuts' });
      }
      
      if (modifier && e.key === ',') {
        e.preventDefault();
        useUIStore.getState().openModal({ type: 'settings' });
      }
      
      if (modifier && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        const newId = useChatStore.getState().createConversation();
        useChatStore.getState().setCurrentConversation(newId);
      }
      
      if (modifier && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        useUIStore.getState().toggleTheme();
      }
      
      if (e.key === 'Escape') {
        if (useUIStore.getState().commandPaletteOpen) {
          useUIStore.getState().closeCommandPalette();
        } else if (useUIStore.getState().modal.type) {
          useUIStore.getState().closeModal();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // ========================================================================
  // WINDOW FOCUS/BLUR
  // ========================================================================
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('Tab hidden');
      } else {
        console.log('Tab visible');
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);
  
  // ========================================================================
  // RENDER
  // ========================================================================
  
  return (
    <>
      {/* Toast Notifications */}
      <Toaster
        theme={theme === 'dark' ? 'dark' : 'light'}
        position="bottom-right"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
          },
        }}
      />
      
      {/* Auth-gated main application */}
      <AuthGuard>
        {/* Main Application */}
        {isHomeDashboard ? (
          /* Home Dashboard renders without AppShell (no sidebar) */
          <Suspense fallback={<LoadingScreen message="Loading..." />}>
            <HomeDashboard />
          </Suspense>
        ) : (
          /* All station views render inside AppShell (with sidebar) */
          <AppShell>
            <Suspense fallback={<LoadingScreen message="Loading..." />}>
              <Routes>
                {/* Root redirect — send users to chat by default */}
                <Route path="/" element={<Navigate to="/chat" replace />} />

                {/* Chat routes */}
                <Route path="/chat" element={<ChatView />} />
                <Route path="/chat/:conversationId" element={<ChatView />} />

                {/* TBWO routes */}
                <Route path="/tbwo" element={<TBWODashboard />} />
                <Route path="/tbwo/:tbwoId" element={<TBWODashboard />} />

                {/* Memory routes */}
                <Route path="/memory" element={<MemoryDashboard />} />

                {/* Hardware monitoring */}
                <Route path="/hardware" element={<HardwareDashboard />} />

                {/* Sites Dashboard */}
                <Route path="/sites" element={<SiteDashboard />} />
                <Route path="/sites/:siteId" element={<SiteDashboard />} />

                {/* Thread Ingestion */}
                <Route path="/threads" element={<ThreadIngestPanel />} />

                {/* Settings */}
                <Route path="/settings" element={<SettingsView />} />

                {/* 404 - Not found */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </AppShell>
        )}

        {/* GLOBAL overlays - render on ALL pages including home */}
        <CommandPalette />
        <ModalRenderer />
      </AuthGuard>
    </>
  );
}

// ============================================================================
// NOT FOUND PAGE
// ============================================================================

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background-primary p-8">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-6xl font-bold text-text-primary">404</h1>
        <p className="mb-6 text-xl text-text-secondary">Page not found</p>
        <p className="mb-8 text-text-tertiary">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a
          href="/app/chat"
          className="inline-block rounded-lg bg-brand-primary px-6 py-3 font-medium text-white transition-colors hover:bg-brand-primary-hover"
        >
          Back to Chat
        </a>
      </div>
    </div>
  );
}

export default App;
