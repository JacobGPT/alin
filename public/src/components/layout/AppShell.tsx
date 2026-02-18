/**
 * AppShell - Main Application Layout
 * 
 * Provides the overall structure:
 * - Sidebar (chat history) with home button
 * - Main content area
 * - Right panel (memory, TBWO, hardware)
 * 
 * NOTE: CommandPalette and ModalRenderer now render globally in App.tsx
 * so they work on both home and station pages.
 */

import { ReactNode, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { HomeIcon, Bars3Icon } from '@heroicons/react/24/outline';

// Store
import { useUIStore } from '@store/uiStore';
import { useModeStore } from '@store/modeStore';
import { getModeConfig } from '../../config/modes';
import { RightPanelContent } from '../../types/ui';

// Components
import { Sidebar } from '@components/sidebar/Sidebar';
import { RightPanel } from './RightPanel';
import { proactiveService } from '../../services/proactiveService';
import { hardwareService } from '../../services/hardwareService';
import { telemetry } from '../../services/telemetryService';
import { getCapabilitiesSnapshot } from '../../hooks/useCapabilities';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const layout = useUIStore((state) => state.layout);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setRightPanel = useUIStore((state) => state.setRightPanel);
  const currentMode = useModeStore((state) => state.currentMode);
  const [isResizing, setIsResizing] = useState(false);

  // Auto-open/close right panel when mode changes
  useEffect(() => {
    const modeConfig = getModeConfig(currentMode);
    if (modeConfig.rightPanelContent !== RightPanelContent.NONE) {
      setRightPanel(modeConfig.rightPanelContent, true);
    } else {
      setRightPanel(RightPanelContent.NONE, false);
    }
  }, [currentMode, setRightPanel]);

  // Start background services + telemetry session
  useEffect(() => {
    proactiveService.start();
    // Initialize internal trust system (no UI, powers intelligence)
    import('../../store/trustStore').then(({ useTrustStore }) => {
      useTrustStore.getState().initialize();
    }).catch(() => {});
    const caps = getCapabilitiesSnapshot();
    if (caps.canHardwareMonitor) {
      hardwareService.start();
    }
    telemetry.sessionStarted();
    return () => {
      proactiveService.stop();
      hardwareService.stop();
    };
  }, []);
  
  const [isResizingRight, setIsResizingRight] = useState(false);

  // ========================================================================
  // SIDEBAR RESIZE HANDLER
  // ========================================================================

  const handleSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = layout.sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = startWidth + delta;
      useUIStore.getState().setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // ========================================================================
  // RIGHT PANEL RESIZE HANDLER
  // ========================================================================

  const handleRightPanelResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingRight(true);

    const startX = e.clientX;
    const startWidth = layout.rightPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // Dragging left increases width, dragging right decreases
      const delta = startX - moveEvent.clientX;
      const newWidth = startWidth + delta;
      useUIStore.getState().setRightPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // ========================================================================
  // RENDER
  // ========================================================================
  
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background-primary">
      {/* Sidebar */}
      <AnimatePresence>
        {!layout.sidebarCollapsed && (
          <motion.aside
            initial={{ x: -layout.sidebarWidth }}
            animate={{ x: 0 }}
            exit={{ x: -layout.sidebarWidth }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ width: layout.sidebarWidth }}
            className="relative flex flex-shrink-0 flex-col border-r border-border-primary bg-background-secondary"
          >
            {/* Sidebar header with home button */}
            <div className="flex items-center justify-between border-b border-border-primary/50 px-3 py-2.5">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-primary"
                title="Back to Home"
              >
                <HomeIcon className="h-4 w-4 text-indigo-400" />
                <span className="text-xs font-bold tracking-widest bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">ALIN</span>
              </button>
              <button
                onClick={toggleSidebar}
                className="rounded p-1.5 text-text-quaternary transition-colors hover:bg-background-hover hover:text-text-tertiary"
                title="Collapse sidebar"
              >
                <Bars3Icon className="h-4 w-4" />
              </button>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-hidden">
              <Sidebar />
            </div>
            
            {/* Resize handle */}
            <div
              className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-brand-primary/50 active:bg-brand-primary"
              onMouseDown={handleSidebarResize}
              style={{
                backgroundColor: isResizing ? 'var(--brand-primary)' : 'transparent',
              }}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Collapsed sidebar toggle */}
      {layout.sidebarCollapsed && (
        <div className="flex flex-col items-center border-r border-border-primary bg-background-secondary py-3 px-1.5 gap-2">
          <button
            onClick={() => navigate('/')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-background-hover hover:text-text-primary"
            title="Home"
          >
            <HomeIcon className="h-4 w-4" />
          </button>
          <button
            onClick={toggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-quaternary transition-colors hover:bg-background-hover hover:text-text-tertiary"
            title="Expand sidebar"
          >
            <Bars3Icon className="h-4 w-4" />
          </button>
        </div>
      )}
      
      {/* Main Content */}
      <main className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
      
      {/* Right Panel */}
      <AnimatePresence>
        {layout.rightPanelVisible && (
          <motion.aside
            initial={{ x: layout.rightPanelWidth }}
            animate={{ x: 0 }}
            exit={{ x: layout.rightPanelWidth }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ width: layout.rightPanelWidth }}
            className="relative h-full flex-shrink-0 overflow-hidden border-l border-border-primary bg-background-secondary"
          >
            {/* Resize handle (left edge) */}
            <div
              className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-brand-primary/50 active:bg-brand-primary"
              onMouseDown={handleRightPanelResize}
              style={{
                backgroundColor: isResizingRight ? 'var(--brand-primary)' : 'transparent',
              }}
            />
            <RightPanel />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
