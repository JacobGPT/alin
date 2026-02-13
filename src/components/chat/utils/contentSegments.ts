/**
 * Content Segment Types and Utilities
 *
 * Extracted from InputArea.tsx — defines the ContentSegment type used for
 * interleaved tool activities, thinking blocks, images, and file blocks
 * in streaming message construction.
 *
 * NOTE: The segment helper functions (ensureTextSegment, addThinkingChunk,
 * addToolActivitySegment, addImageSegment, addFileSegment) and buildContentBlocks()
 * are closures inside InputArea that mutate local state (segments array,
 * currentTextSegment, currentThinkingSegment). They remain in InputArea.tsx.
 * This file exports only the pure type definition and the formatFileSize helper.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ContentSegment {
  type: 'text' | 'tool_activity' | 'thinking' | 'image' | 'file';
  text?: string;
  activityIds?: string[];
  thinkingContent?: string;
  imageUrl?: string;
  imageAlt?: string;
  imageCaption?: string;
  fileName?: string;
  fileContent?: string;
  fileLanguage?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
