/**
 * RightPanel - Contextual panel for mode-specific content
 *
 * Wraps all sub-panels with a universal close button header.
 */

import { XMarkIcon } from '@heroicons/react/24/outline';
import { useUIStore } from '@store/uiStore';
import { RightPanelContent } from '../../types/ui';
import { FileBrowserPanel } from '@components/modes/FileBrowserPanel';
import { ImageGalleryPanel } from '@components/modes/ImageGalleryPanel';
import { SourceTrackerPanel } from '@components/modes/SourceTrackerPanel';
import { ArtifactPanel } from '@components/modes/ArtifactPanel';
import { MemoryDashboard } from '../memory/MemoryDashboard';
import { TBWODashboard } from '../tbwo/TBWODashboard';
import { HardwareDashboard } from '../hardware/HardwareDashboard';
import { VisionPanel } from '@components/modes/VisionPanel';
import { TimeTravelPanel } from '@components/modes/TimeTravelPanel';
import { ConsequenceDashboard } from '../consequence/ConsequenceDashboard';
import { ProactiveDashboard } from '../proactive/ProactiveDashboard';

export function RightPanel() {
  const content = useUIStore((state) => state.layout.rightPanelContent);
  const setRightPanel = useUIStore((state) => state.setRightPanel);

  const handleClose = () => {
    setRightPanel(RightPanelContent.NONE, false);
  };

  const getPanelTitle = () => {
    switch (content) {
      case RightPanelContent.FILE_BROWSER: return 'Files';
      case RightPanelContent.IMAGE_GALLERY: return 'Gallery';
      case RightPanelContent.SOURCE_TRACKER: return 'Sources';
      case RightPanelContent.ARTIFACT: return 'Artifact';
      case RightPanelContent.MEMORY: return 'Memory';
      case RightPanelContent.TBWO: return 'TBWO Dashboard';
      case RightPanelContent.HARDWARE: return 'Hardware';
      case RightPanelContent.VISION: return 'Vision';
      case RightPanelContent.TIME_TRAVEL: return 'Timeline';
      case RightPanelContent.CONSEQUENCE: return 'Consequence Engine';
      case RightPanelContent.PROACTIVE: return 'Intelligence';
      case RightPanelContent.SETTINGS: return 'Settings';
      default: return '';
    }
  };

  const renderContent = () => {
    switch (content) {
      case RightPanelContent.FILE_BROWSER:
        return <FileBrowserPanel />;
      case RightPanelContent.IMAGE_GALLERY:
        return <ImageGalleryPanel />;
      case RightPanelContent.SOURCE_TRACKER:
        return <SourceTrackerPanel />;
      case RightPanelContent.ARTIFACT:
        return <ArtifactPanel />;
      case RightPanelContent.MEMORY:
        return <MemoryDashboard />;
      case RightPanelContent.TBWO:
        return <TBWODashboard />;
      case RightPanelContent.HARDWARE:
        return <HardwareDashboard />;
      case RightPanelContent.VISION:
        return <VisionPanel />;
      case RightPanelContent.TIME_TRAVEL:
        return <TimeTravelPanel />;
      case RightPanelContent.CONSEQUENCE:
        return <ConsequenceDashboard />;
      case RightPanelContent.PROACTIVE:
        return <ProactiveDashboard />;
      case RightPanelContent.SETTINGS:
        return (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-sm text-text-tertiary">Use the settings modal instead</p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col bg-background-secondary">
      {/* Universal Header */}
      <div className="flex items-center justify-between border-b border-border-primary px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-quaternary">
          {getPanelTitle()}
        </span>
        <button
          onClick={handleClose}
          className="rounded p-1 text-text-quaternary hover:text-text-primary hover:bg-background-hover transition-colors"
          title="Close panel"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
