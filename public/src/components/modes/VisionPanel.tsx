/**
 * VisionPanel - Screenshot capture and display panel
 *
 * Displays captured screenshots, allows manual capture via backend,
 * and supports attaching screenshots to chat messages.
 */

import { useState } from 'react';
import {
  CameraIcon,
  TrashIcon,
  ArrowsPointingOutIcon,
  ClipboardDocumentIcon,
  ArrowPathIcon,
  ChatBubbleLeftIcon,
} from '@heroicons/react/24/outline';
import { useVisionStore, type Screenshot } from '../../store/visionStore';
import { useChatStore } from '../../store/chatStore';
import { MessageRole } from '../../types/chat';

export function VisionPanel() {
  const screenshots = useVisionStore((state) => state.screenshots);
  const isCapturing = useVisionStore((state) => state.isCapturing);
  const captureScreenshot = useVisionStore((state) => state.captureScreenshot);
  const removeScreenshot = useVisionStore((state) => state.removeScreenshot);
  const clearScreenshots = useVisionStore((state) => state.clearScreenshots);

  const [selected, setSelected] = useState<Screenshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = async () => {
    setError(null);
    const result = await captureScreenshot();
    if (!result) {
      setError('Screenshot failed. Is the backend running?');
      setTimeout(() => setError(null), 4000);
    }
  };

  const handleAttachToChat = (screenshot: Screenshot) => {
    const convId = useChatStore.getState().currentConversationId;
    if (!convId) return;
    useChatStore.getState().addMessage(convId, {
      role: MessageRole.USER,
      content: [
        { type: 'text', text: 'Here is my current screen:' },
        { type: 'image', url: screenshot.dataUrl, alt: 'Screen capture' } as any,
      ],
    });
  };

  const handleCopyToClipboard = async (screenshot: Screenshot) => {
    try {
      const resp = await fetch(screenshot.dataUrl);
      const blob = await resp.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    } catch {
      // Fallback: copy data URL as text
      await navigator.clipboard.writeText(screenshot.dataUrl);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="p-3 border-b border-border-primary">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Vision
            </h3>
            {screenshots.length > 0 && (
              <p className="text-xs text-text-quaternary mt-0.5">
                {screenshots.length} screenshot{screenshots.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {screenshots.length > 0 && (
            <button
              onClick={clearScreenshots}
              className="text-xs text-text-quaternary hover:text-red-400 transition-colors"
              title="Clear all screenshots"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Capture button */}
        <button
          onClick={handleCapture}
          disabled={isCapturing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isCapturing ? (
            <>
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Capturing...
            </>
          ) : (
            <>
              <CameraIcon className="h-4 w-4" />
              Capture Screenshot
            </>
          )}
        </button>

        {error && (
          <p className="mt-1.5 text-xs text-red-400">{error}</p>
        )}
      </div>

      {/* Selected preview */}
      {selected && (
        <div className="p-3 border-b border-border-primary">
          <div className="relative rounded-lg overflow-hidden bg-background-tertiary">
            <img
              src={selected.dataUrl}
              alt={`Screenshot from ${formatTime(selected.timestamp)}`}
              className="w-full h-auto"
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-text-quaternary">
              {formatTime(selected.timestamp)}
              {selected.width && selected.height && (
                <> &middot; {selected.width}x{selected.height}</>
              )}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => handleAttachToChat(selected)}
                className="p-1 rounded text-text-quaternary hover:text-brand-primary hover:bg-brand-primary/10 transition-colors"
                title="Attach to chat"
              >
                <ChatBubbleLeftIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => handleCopyToClipboard(selected)}
                className="p-1 rounded text-text-quaternary hover:text-text-primary hover:bg-background-hover transition-colors"
                title="Copy to clipboard"
              >
                <ClipboardDocumentIcon className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setSelected(null)}
                className="p-1 rounded text-text-quaternary hover:text-text-primary hover:bg-background-hover transition-colors"
                title="Close preview"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screenshot grid */}
      <div className="p-3">
        {screenshots.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {screenshots.map((ss) => (
              <div
                key={ss.id}
                className="group relative rounded-lg overflow-hidden bg-background-tertiary cursor-pointer"
                onClick={() => setSelected(ss)}
              >
                <img
                  src={ss.dataUrl}
                  alt={`Screenshot ${formatTime(ss.timestamp)}`}
                  className="w-full h-24 object-cover"
                  loading="lazy"
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <div className="flex gap-1">
                    <button
                      className="p-1 bg-black/50 rounded text-white hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(ss);
                      }}
                    >
                      <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="p-1 bg-black/50 rounded text-white hover:bg-red-500/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeScreenshot(ss.id);
                        if (selected?.id === ss.id) setSelected(null);
                      }}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {/* Timestamp badge */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1">
                  <span className="text-[10px] text-white/80">{formatTime(ss.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CameraIcon className="h-10 w-10 text-text-quaternary mb-2" />
            <p className="text-xs text-text-quaternary">
              No screenshots yet.
            </p>
            <p className="text-xs text-text-quaternary mt-1">
              Click "Capture Screenshot" to take one, or ALIN can capture automatically with the computer tool.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
