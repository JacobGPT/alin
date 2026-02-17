/**
 * VideoEmbed - Inline video player for chat messages
 *
 * Renders an embedded video player with click-to-play (no autoplay),
 * platform badge, title, and open-in-new-tab button.
 * Supports: YouTube, Vimeo, Loom, Twitch, Dailymotion (iframe),
 *           and direct video files from Veo/generated content (<video> tag).
 */

import { useState, useRef, useEffect } from 'react';

interface VideoEmbedProps {
  url: string;
  embed_url: string;
  platform: string;
  title?: string;
  thumbnail?: string;
  timestamp?: number;
}

const platformColors: Record<string, string> = {
  youtube: '#FF0000',
  vimeo: '#1AB7EA',
  loom: '#625DF5',
  twitch: '#9146FF',
  dailymotion: '#00B2FF',
  veo: '#4285F4',
  'veo-3.1': '#4285F4',
  'veo-3.1-fast': '#4285F4',
  unknown: '#666',
};

const platformLabels: Record<string, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  twitch: 'Twitch',
  dailymotion: 'Dailymotion',
  veo: 'Veo 3.1',
  'veo-3.1': 'Veo 3.1',
  'veo-3.1-fast': 'Veo 3.1 Fast',
  unknown: 'Video',
};

/** Detect if this is a direct video file rather than an iframe embed */
function isDirectVideo(url: string): boolean {
  if (!url) return false;
  // Local ALIN-served video assets or data URIs
  if (url.startsWith('/api/assets/') && url.includes('video')) return true;
  if (url.startsWith('data:video/')) return true;
  // Common video file extensions
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) return true;
  // Google generative AI video URIs
  if (url.includes('generativelanguage.googleapis.com') && url.includes('video')) return true;
  return false;
}

function useAuthToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    import('@store/authStore').then(({ useAuthStore }) => {
      setToken(useAuthStore.getState().token);
    });
  }, []);
  return token;
}

export function VideoEmbed({ url, embed_url, platform, title, thumbnail, timestamp }: VideoEmbedProps) {
  const [playing, setPlaying] = useState(false);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const token = useAuthToken();

  const directVideo = isDirectVideo(embed_url) || isDirectVideo(url);
  const videoSrc = embed_url || url;
  const needsAuth = videoSrc.startsWith('/api/') && !videoSrc.startsWith('/api/assets/');

  // For auth-protected direct videos, fetch with auth header and create blob URL
  useEffect(() => {
    if (!directVideo || !needsAuth || !token) return;
    let revoke: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(videoSrc, { headers: { 'Authorization': `Bearer ${token}` } });
        if (cancelled || !res.ok) return;
        const arrayBuf = await res.arrayBuffer();
        if (cancelled) return;
        // Explicitly set MIME type — server may return application/octet-stream
        const typedBlob = new Blob([arrayBuf], { type: 'video/mp4' });
        revoke = URL.createObjectURL(typedBlob);
        setVideoBlobUrl(revoke);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [videoSrc, token, needsAuth, directVideo]);

  const handlePlay = () => {
    setPlaying(true);
    // Auto-play after state update for direct videos
    setTimeout(() => videoRef.current?.play(), 50);
  };

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = videoBlobUrl || videoSrc;
    a.download = `alin-video-${Date.now()}.mp4`;
    a.click();
  };

  const autoplayUrl = !directVideo
    ? embed_url + (embed_url.includes('?') ? '&' : '?') + 'autoplay=1'
    : '';

  const resolvedVideoSrc = needsAuth ? videoBlobUrl : videoSrc;
  const color = platformColors[platform] || platformColors.unknown;
  const label = platformLabels[platform] || platformLabels.unknown;

  return (
    <div
      ref={containerRef}
      className="my-3 rounded-xl overflow-hidden border border-white/[0.08] bg-[#0a0a0a] max-w-[560px] w-full"
    >
      {/* Video player area — 16:9 */}
      <div
        className="relative w-full bg-black"
        style={{ paddingBottom: '56.25%', cursor: playing ? 'default' : 'pointer' }}
        onClick={!playing ? handlePlay : undefined}
      >
        {playing ? (
          directVideo ? (
            // Direct video file — use <video> tag with <source> for explicit type
            resolvedVideoSrc ? (
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-contain"
                controls
                autoPlay
                playsInline
                preload="auto"
                title={title || 'Generated video'}
              >
                <source src={resolvedVideoSrc} type="video/mp4" />
              </video>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-pulse text-white/50 text-sm">Loading video...</div>
              </div>
            )
          ) : (
            // Iframe embed (YouTube, Vimeo, etc.)
            <iframe
              src={autoplayUrl}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              title={title || 'Embedded video'}
            />
          )
        ) : (
          <>
            {/* Thumbnail with fallback chain */}
            {thumbnail && (
              <img
                src={thumbnail}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  // YouTube maxresdefault → hqdefault → sddefault fallback
                  if (img.src.includes('maxresdefault')) {
                    img.src = img.src.replace('maxresdefault', 'hqdefault');
                  } else if (img.src.includes('hqdefault')) {
                    img.src = img.src.replace('hqdefault', 'sddefault');
                  } else {
                    img.style.display = 'none';
                  }
                }}
              />
            )}
            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="flex items-center justify-center w-[68px] h-[48px] rounded-[14px] opacity-90 hover:opacity-100 hover:scale-110 transition-all duration-200"
                style={{ background: color }}
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="white">
                  <polygon points="5,3 17,10 5,17" />
                </svg>
              </div>
            </div>
            {/* "AI Generated" badge for Veo videos */}
            {platform.startsWith('veo') && (
              <div className="absolute top-3 left-3 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded bg-black/60 text-white/80 backdrop-blur-sm">
                AI Generated
              </div>
            )}
          </>
        )}
      </div>

      {/* Info bar */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-white/[0.03] border-t border-white/[0.06]">
        {/* Platform badge */}
        <span
          className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: color + '22', color }}
        >
          {label}
        </span>

        {/* Title + timestamp */}
        <div className="flex-1 min-w-0">
          {title && (
            <div className="text-[13px] font-medium text-white/90 truncate">
              {title}
            </div>
          )}
          {!!timestamp && timestamp > 0 && (
            <div className="text-[11px] text-white/40">
              starts at {Math.floor(timestamp / 60)}:{(timestamp % 60).toString().padStart(2, '0')}
            </div>
          )}
        </div>

        {/* Download button for generated videos */}
        {directVideo && (
          <button
            onClick={handleDownload}
            className="text-[11px] text-white/50 border border-white/10 rounded-md px-2.5 py-1 hover:border-white/30 hover:text-white/80 transition-all whitespace-nowrap"
            title="Download video"
          >
            Download
          </button>
        )}

        {/* Open external */}
        <button
          onClick={handleOpenExternal}
          className="text-[11px] text-white/50 border border-white/10 rounded-md px-2.5 py-1 hover:border-white/30 hover:text-white/80 transition-all whitespace-nowrap"
          title="Open in new tab"
        >
          Open
        </button>
      </div>
    </div>
  );
}
