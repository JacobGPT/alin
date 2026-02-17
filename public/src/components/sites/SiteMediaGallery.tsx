/**
 * SiteMediaGallery — CF Images upload/gallery + CF Stream video management.
 * Drag-and-drop image upload, thumbnail grid, video embed codes.
 * Plan-gated: shows upgrade prompts for free users.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  PhotoIcon,
  VideoCameraIcon,
  CloudArrowUpIcon,
  TrashIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  LinkIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useSitesStore } from '@store/sitesStore';
import { useCapabilities } from '../../hooks/useCapabilities';

// ============================================================================
// IMAGE GALLERY
// ============================================================================

function ImageGallery({ siteId }: { siteId?: string }) {
  const { images, imagesLoading, loadImages, uploadImage, deleteImage } = useSitesStore();
  const [dragging, setDragging] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadImages(); }, []);

  const handleFiles = useCallback(async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      await uploadImage(file, siteId);
    }
  }, [siteId, uploadImage]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
  };

  const selected = images.find(i => i.id === selectedImage);

  return (
    <div className="space-y-4">
      {/* Upload area */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
          dragging
            ? 'border-brand-primary bg-brand-primary/5'
            : 'border-border-primary hover:border-brand-primary/50'
        }`}
      >
        <CloudArrowUpIcon className="h-8 w-8 text-text-tertiary mb-2" />
        <p className="text-sm text-text-secondary">Drop images here or click to upload</p>
        <p className="text-xs text-text-quaternary mt-1">PNG, JPG, GIF, SVG, WebP</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Grid */}
      {imagesLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-primary" />
        </div>
      ) : images.length === 0 ? (
        <div className="text-center py-8 text-text-tertiary text-sm">
          <PhotoIcon className="mx-auto h-10 w-10 opacity-50 mb-2" />
          No images uploaded yet
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          {images.map(img => (
            <div
              key={img.id}
              onClick={() => setSelectedImage(img.id)}
              className={`group relative aspect-square rounded-lg border overflow-hidden cursor-pointer transition-all ${
                selectedImage === img.id
                  ? 'border-brand-primary ring-2 ring-brand-primary/30'
                  : 'border-border-primary hover:border-brand-primary/50'
              }`}
            >
              <img
                src={img.url}
                alt={img.filename}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-[10px] text-white truncate">{img.filename}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image detail */}
      {selected && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary truncate">{selected.filename}</p>
            <button onClick={() => setSelectedImage(null)} className="text-xs text-text-tertiary hover:text-text-secondary">Close</button>
          </div>
          <img src={selected.url} alt={selected.filename} className="max-h-64 rounded-lg mx-auto" />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={selected.url}
                className="flex-1 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-text-secondary font-mono"
              />
              <button
                onClick={() => copyUrl(selected.url)}
                className="flex items-center gap-1 rounded border border-border-primary px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
              >
                <ClipboardDocumentIcon className="h-3 w-3" />
                Copy
              </button>
            </div>
            {/* Variant URLs */}
            {selected.variants && selected.variants.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Variants:</p>
                {selected.variants.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10px] text-text-quaternary font-mono truncate flex-1">{v}</span>
                    <button onClick={() => copyUrl(v)} className="text-text-tertiary hover:text-text-secondary">
                      <ClipboardDocumentIcon className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                deleteImage(selected.id);
                setSelectedImage(null);
              }}
              className="flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
            >
              <TrashIcon className="h-3 w-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// VIDEO SECTION
// ============================================================================

function VideoSection({ siteId }: { siteId?: string }) {
  const { videos, videosLoading, getUploadUrl, deleteVideo } = useSitesStore();
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleUploadFromUrl = async () => {
    if (!videoUrl.trim()) return;
    setUploading(true);
    try {
      const dbService = await import('../../api/dbService');
      await dbService.uploadVideoFromUrl(videoUrl.trim(), siteId);
      setVideoUrl('');
    } catch (err) {
      console.error('Video upload failed:', err);
    }
    setUploading(false);
  };

  const handleDirectUpload = async () => {
    try {
      const result = await getUploadUrl(siteId);
      if (result.uploadUrl) {
        window.open(result.uploadUrl, '_blank');
      }
    } catch (err) {
      console.error('Get upload URL failed:', err);
    }
  };

  return (
    <div className="space-y-4">
      {/* Upload from URL */}
      <div className="flex gap-2">
        <div className="flex-1 flex gap-2">
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Paste video URL..."
            className="flex-1 rounded-lg border border-border-primary bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:border-brand-primary focus:outline-none"
          />
          <button
            onClick={handleUploadFromUrl}
            disabled={!videoUrl.trim() || uploading}
            className="flex items-center gap-1 rounded-lg bg-brand-primary px-3 py-2 text-sm text-white hover:bg-brand-primary-hover disabled:opacity-50"
          >
            <LinkIcon className="h-4 w-4" />
            Upload
          </button>
        </div>
        <button
          onClick={handleDirectUpload}
          className="flex items-center gap-1 rounded-lg border border-border-primary px-3 py-2 text-sm text-text-secondary hover:bg-bg-tertiary"
        >
          <CloudArrowUpIcon className="h-4 w-4" />
          Direct
        </button>
      </div>

      {/* Video list */}
      {videos.length === 0 ? (
        <div className="text-center py-8 text-text-tertiary text-sm">
          <VideoCameraIcon className="mx-auto h-10 w-10 opacity-50 mb-2" />
          No videos uploaded yet
        </div>
      ) : (
        <div className="space-y-2">
          {videos.map(video => (
            <div key={video.id} className="flex items-center justify-between rounded-lg border border-border-primary bg-bg-secondary p-3">
              <div className="flex items-center gap-3">
                {video.thumbnail ? (
                  <img src={video.thumbnail} alt="" className="h-12 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-12 w-16 items-center justify-center rounded bg-bg-tertiary">
                    <VideoCameraIcon className="h-5 w-5 text-text-quaternary" />
                  </div>
                )}
                <div>
                  <p className="text-sm text-text-primary capitalize">{video.status}</p>
                  {video.duration && (
                    <p className="text-xs text-text-tertiary">{Math.round(video.duration)}s</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => deleteVideo(video.id)}
                  className="rounded p-1 text-text-tertiary hover:text-red-400 hover:bg-red-500/10"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export function SiteMediaGallery({ siteId }: { siteId?: string }) {
  const caps = useCapabilities();
  const [activeTab, setActiveTab] = useState<'images' | 'videos'>('images');

  if (!caps.canCfImages && !caps.canCfStream) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-6 text-center">
        <ExclamationTriangleIcon className="mx-auto h-8 w-8 text-amber-400 mb-2" />
        <p className="text-sm font-medium text-text-primary mb-1">Media uploads require Pro plan</p>
        <p className="text-xs text-text-tertiary">Upgrade to Pro to upload images and videos to your sites.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-lg border border-border-primary bg-bg-tertiary p-1">
        <button
          onClick={() => setActiveTab('images')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'images'
              ? 'bg-bg-secondary text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <PhotoIcon className="h-3.5 w-3.5" />
          Images
        </button>
        <button
          onClick={() => setActiveTab('videos')}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            activeTab === 'videos'
              ? 'bg-bg-secondary text-text-primary shadow-sm'
              : 'text-text-tertiary hover:text-text-secondary'
          }`}
        >
          <VideoCameraIcon className="h-3.5 w-3.5" />
          Videos
        </button>
      </div>

      {activeTab === 'images' ? (
        <ImageGallery siteId={siteId} />
      ) : (
        <VideoSection siteId={siteId} />
      )}
    </div>
  );
}
