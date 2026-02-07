/**
 * ImageGalleryPanel - Generated images gallery for Image Mode
 * Connected to imageStore for persistent image tracking.
 */

import { useState } from 'react';
import {
  PhotoIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  ArrowsPointingOutIcon,
} from '@heroicons/react/24/outline';
import { useImageStore, type GeneratedImage } from '../../store/imageStore';

export function ImageGalleryPanel() {
  const images = useImageStore((state) => state.images);
  const removeImage = useImageStore((state) => state.removeImage);
  const clearImages = useImageStore((state) => state.clearImages);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);

  const handleRemove = (id: string) => {
    removeImage(id);
    if (selectedImage?.id === id) {
      setSelectedImage(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 border-b border-border-primary flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Image Gallery
          </h3>
          {images.length > 0 && (
            <p className="text-xs text-text-quaternary mt-0.5">
              {images.length} image{images.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {images.length > 0 && (
          <button
            onClick={clearImages}
            className="text-xs text-text-quaternary hover:text-red-400 transition-colors"
            title="Clear all images"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Selected image preview */}
      {selectedImage && (
        <div className="p-3 border-b border-border-primary">
          <div className="relative rounded-lg overflow-hidden bg-background-tertiary">
            <img
              src={selectedImage.url}
              alt={selectedImage.prompt}
              className="w-full h-auto"
              loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
              <p className="text-xs text-white line-clamp-2">
                {selectedImage.revisedPrompt || selectedImage.prompt}
              </p>
            </div>
          </div>
          <div className="mt-2 space-y-1">
            <div className="flex gap-1 text-xs text-text-quaternary">
              <span className="bg-background-tertiary px-1.5 py-0.5 rounded">{selectedImage.size}</span>
              <span className="bg-background-tertiary px-1.5 py-0.5 rounded">{selectedImage.quality}</span>
              <span className="bg-background-tertiary px-1.5 py-0.5 rounded">{selectedImage.style}</span>
            </div>
            <div className="flex gap-2">
              <a
                href={selectedImage.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary bg-background-hover rounded transition-colors"
              >
                <ArrowDownTrayIcon className="h-3 w-3" />
                Open
              </a>
              <button
                onClick={() => setSelectedImage(null)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary bg-background-hover rounded transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image grid */}
      <div className="p-3">
        {images.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {images.map((image) => (
              <div
                key={image.id}
                className="group relative rounded-lg overflow-hidden bg-background-tertiary cursor-pointer"
                onClick={() => setSelectedImage(image)}
              >
                <img
                  src={image.url}
                  alt={image.prompt}
                  className="w-full h-24 object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <div className="flex gap-1">
                    <button
                      className="p-1 bg-black/50 rounded text-white hover:bg-black/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(image);
                      }}
                    >
                      <ArrowsPointingOutIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="p-1 bg-black/50 rounded text-white hover:bg-red-500/70"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(image.id);
                      }}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <PhotoIcon className="h-10 w-10 text-text-quaternary mb-2" />
            <p className="text-xs text-text-quaternary">
              No images generated yet.
            </p>
            <p className="text-xs text-text-quaternary mt-1">
              Switch to Image mode and ask ALIN to create images.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
