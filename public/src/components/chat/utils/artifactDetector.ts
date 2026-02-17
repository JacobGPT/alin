/**
 * Auto-Artifact Detection Utilities
 *
 * Extracted from InputArea.tsx — detects code fences in assistant output
 * and maps them to artifact types for the artifact panel.
 */

import type { ArtifactType } from '../../../store/artifactStore';

// ============================================================================
// TYPES
// ============================================================================

export interface DetectedArtifact {
  type: ArtifactType;
  language: string;
  content: string;
  title: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const ARTIFACT_LANG_MAP: Record<string, ArtifactType> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'react',
  tsx: 'react',
  react: 'react',
  chart: 'chart',
  markdown: 'markdown',
  md: 'markdown',
};

// ============================================================================
// FUNCTIONS
// ============================================================================

export function detectArtifact(text: string): DetectedArtifact | null {
  // Match completed code fences: ```lang\n...\n```
  const fenceRegex = /```(\w+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let lastArtifact: DetectedArtifact | null = null;

  while ((match = fenceRegex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    const codeContent = (match[2] || '').trim();

    // Skip small snippets
    if (codeContent.length < 100) continue;

    // Direct language match
    if (ARTIFACT_LANG_MAP[lang]) {
      lastArtifact = {
        type: ARTIFACT_LANG_MAP[lang],
        language: lang,
        content: codeContent,
        title: getTitleFromContent(ARTIFACT_LANG_MAP[lang], codeContent, lang),
      };
      continue;
    }

    // Check if JSON content looks like a chart spec
    if (lang === 'json') {
      try {
        const parsed = JSON.parse(codeContent);
        if (parsed.type && parsed.data && Array.isArray(parsed.data)) {
          lastArtifact = {
            type: 'chart',
            language: 'chart',
            content: codeContent,
            title: parsed.title || 'Chart',
          };
          continue;
        }
      } catch { /* not chart JSON */ }
    }
  }

  return lastArtifact;
}

export function getTitleFromContent(type: ArtifactType, content: string, lang: string): string {
  switch (type) {
    case 'html': {
      const titleMatch = content.match(/<title>(.*?)<\/title>/i);
      return titleMatch?.[1] || 'HTML App';
    }
    case 'mermaid': return 'Mermaid Diagram';
    case 'react': return 'React Component';
    case 'svg': return 'SVG Graphic';
    case 'markdown': return 'Document';
    case 'chart': return 'Chart';
    default: return `${lang.toUpperCase()} Artifact`;
  }
}
