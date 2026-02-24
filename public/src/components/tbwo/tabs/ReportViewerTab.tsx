import { useState, useMemo, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  DocumentTextIcon,
  ListBulletIcon,
  GlobeAltIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  PrinterIcon,
  ClipboardDocumentIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

import type { TBWO, Artifact } from '../../../types/tbwo';
import { downloadTBWOZip } from '../../../services/tbwo/zipService';

// ============================================================================
// TYPES
// ============================================================================

interface InsightItem {
  insight: string;
  confidence: 'high' | 'medium' | 'low';
  supportingSources?: number;
  significance?: 'high' | 'medium' | 'low';
}

interface AnalysisData {
  keyInsights?: InsightItem[];
  patterns?: string[];
  contradictions?: Array<{ topic: string; resolution?: string }>;
  gaps?: string[];
  topFindings?: string[];
  recommendations?: string[];
  overallConfidence?: string;
  dataQualityScore?: number;
}

interface TocEntry {
  level: number;
  text: string;
  id: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function findArtifact(artifacts: Artifact[], name: string): Artifact | undefined {
  return artifacts.find(a =>
    (a.path || a.name || '').toLowerCase().endsWith(name.toLowerCase())
  );
}

function parseAnalysis(artifacts: Artifact[]): AnalysisData | null {
  const a = findArtifact(artifacts, 'analysis.json');
  if (!a || !a.content) return null;
  try {
    return typeof a.content === 'string' ? JSON.parse(a.content) : a.content as AnalysisData;
  } catch { return null; }
}

function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const regex = /^(#{2,3}) (.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = text.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    entries.push({ level, text, id });
  }
  return entries;
}

function countSources(artifacts: Artifact[]): number {
  const src = findArtifact(artifacts, 'SOURCES.md');
  if (!src || typeof src.content !== 'string') return 0;
  const lines = src.content.split('\n').filter(l => /^\d+\./.test(l.trim()));
  return lines.length;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high: 'bg-semantic-success/20 text-semantic-success',
  medium: 'bg-semantic-warning/20 text-semantic-warning',
  low: 'bg-semantic-error/20 text-semantic-error',
};

const CONFIDENCE_DOT: Record<string, string> = {
  high: 'bg-semantic-success',
  medium: 'bg-semantic-warning',
  low: 'bg-semantic-error',
};

// ============================================================================
// INSIGHT CARDS
// ============================================================================

function InsightCards({ insights }: { insights: InsightItem[] }) {
  if (!insights || insights.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="mb-3 text-sm font-semibold text-text-secondary uppercase tracking-wide">Key Insights</h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {insights.slice(0, 6).map((item, i) => (
          <div
            key={i}
            className="min-w-[200px] max-w-[260px] flex-shrink-0 rounded-xl border border-border-primary bg-background-secondary p-4"
          >
            <p className="mb-2 text-sm text-text-primary line-clamp-3">{item.insight}</p>
            <div className="flex items-center gap-2">
              <span className={`inline-flex h-2 w-2 rounded-full ${CONFIDENCE_DOT[item.confidence] || CONFIDENCE_DOT.medium}`} />
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_COLORS[item.confidence] || CONFIDENCE_COLORS.medium}`}>
                {item.confidence}
              </span>
              {item.supportingSources != null && (
                <span className="text-xs text-text-quaternary">{item.supportingSources} sources</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// TABLE OF CONTENTS SIDEBAR
// ============================================================================

function ReportTOC({ entries, sourceCount, onSelect }: { entries: TocEntry[]; sourceCount: number; onSelect: (id: string) => void }) {
  return (
    <div className="w-52 flex-shrink-0 overflow-y-auto pr-4">
      <h3 className="mb-3 text-xs font-semibold text-text-tertiary uppercase tracking-wider">Table of Contents</h3>
      <ul className="space-y-1">
        {entries.map((e, i) => (
          <li key={i}>
            <button
              onClick={() => onSelect(e.id)}
              className={`w-full text-left text-xs hover:text-brand-primary transition-colors truncate ${
                e.level === 3 ? 'pl-3 text-text-quaternary' : 'text-text-secondary font-medium'
              }`}
            >
              {e.text}
            </button>
          </li>
        ))}
      </ul>
      {sourceCount > 0 && (
        <div className="mt-4 border-t border-border-primary pt-3">
          <button
            onClick={() => onSelect('sources-section')}
            className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-brand-primary"
          >
            <GlobeAltIcon className="h-3.5 w-3.5" />
            Sources ({sourceCount})
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SOURCES PANEL
// ============================================================================

function SourcesPanel({ artifacts }: { artifacts: Artifact[] }) {
  const src = findArtifact(artifacts, 'SOURCES.md');
  const [expanded, setExpanded] = useState(false);
  if (!src || typeof src.content !== 'string') return null;

  return (
    <div id="sources-section" className="mt-8 border-t border-border-primary pt-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-brand-primary transition-colors"
      >
        <ChevronRightIcon className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <GlobeAltIcon className="h-4 w-4" />
        Sources
      </button>
      {expanded && (
        <div className="mt-3 pl-6 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{src.content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// REPORT VIEWER TAB
// ============================================================================

export function ReportViewerTab({ tbwo }: { tbwo: TBWO }) {
  const artifacts = tbwo.artifacts || [];
  const reportArtifact = findArtifact(artifacts, 'REPORT.md');
  const analysis = useMemo(() => parseAnalysis(artifacts), [artifacts]);
  const toc = useMemo(() => reportArtifact && typeof reportArtifact.content === 'string' ? extractToc(reportArtifact.content) : [], [reportArtifact]);
  const sourceCount = useMemo(() => countSources(artifacts), [artifacts]);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);

  const scrollToSection = useCallback((id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleDownloadZip = async () => {
    setIsDownloading(true);
    try { await downloadTBWOZip(tbwo, tbwo.receipts); } catch (e) { console.error('[Report] ZIP failed:', e); }
    finally { setIsDownloading(false); }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    try {
      const resp = await fetch(`/api/tbwo/${tbwo.id}/publish-report`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const data = await resp.json();
      if (data.success && data.previewUrl) {
        window.open(data.previewUrl, '_blank');
      }
    } catch (e) {
      console.error('[Report] Publish failed:', e);
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePrint = () => window.print();

  const handleCopy = () => {
    if (reportArtifact && typeof reportArtifact.content === 'string') {
      navigator.clipboard.writeText(reportArtifact.content);
    }
  };

  if (!reportArtifact || !reportArtifact.content) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <DocumentTextIcon className="mb-4 h-12 w-12 text-text-tertiary" />
        <h3 className="mb-2 font-semibold text-text-primary">No Report Yet</h3>
        <p className="text-sm text-text-tertiary">
          The report will appear here once the pipeline completes
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Insight Cards */}
      {analysis?.keyInsights && <InsightCards insights={analysis.keyInsights} />}

      {/* Main Layout: TOC + Content */}
      <div className="flex gap-6 h-[calc(100vh-400px)]">
        {/* TOC Sidebar */}
        {toc.length > 0 && (
          <ReportTOC entries={toc} sourceCount={sourceCount} onSelect={scrollToSection} />
        )}

        {/* Report Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto rounded-xl border border-border-primary bg-background-secondary p-6">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children, ...props }) => {
                  const text = typeof children === 'string' ? children : String(children);
                  const id = text.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
                  return <h2 id={id} {...props}>{children}</h2>;
                },
                h3: ({ children, ...props }) => {
                  const text = typeof children === 'string' ? children : String(children);
                  const id = text.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
                  return <h3 id={id} {...props}>{children}</h3>;
                },
                a: ({ href, children, ...props }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline" {...props}>
                    {children}
                  </a>
                ),
              }}
            >
              {reportArtifact.content as string}
            </ReactMarkdown>
          </div>

          <SourcesPanel artifacts={artifacts} />
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-3 pt-4 border-t border-border-primary mt-4">
        <button
          onClick={handleDownloadZip}
          disabled={isDownloading}
          className="flex items-center gap-1.5 rounded-lg border border-border-primary px-3 py-2 text-sm text-text-secondary hover:bg-background-tertiary transition-colors disabled:opacity-50"
        >
          {isDownloading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <ArrowDownTrayIcon className="h-4 w-4" />}
          Download ZIP
        </button>
        {tbwo.status === 'completed' && (
          <button
            onClick={handlePublish}
            disabled={isPublishing}
            className="flex items-center gap-1.5 rounded-lg border border-brand-primary px-3 py-2 text-sm text-brand-primary hover:bg-brand-primary/10 transition-colors disabled:opacity-50"
          >
            {isPublishing ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <GlobeAltIcon className="h-4 w-4" />}
            Publish as Site
          </button>
        )}
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 rounded-lg border border-border-primary px-3 py-2 text-sm text-text-secondary hover:bg-background-tertiary transition-colors"
        >
          <PrinterIcon className="h-4 w-4" />
          Print / PDF
        </button>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-border-primary px-3 py-2 text-sm text-text-secondary hover:bg-background-tertiary transition-colors"
        >
          <ClipboardDocumentIcon className="h-4 w-4" />
          Copy Markdown
        </button>
      </div>
    </div>
  );
}
