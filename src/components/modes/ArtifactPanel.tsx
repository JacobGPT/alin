/**
 * ArtifactPanel - Enhanced Artifacts preview panel
 *
 * Features:
 * - Split/Code/Preview view modes
 * - Editable code with live preview
 * - Mermaid diagram rendering
 * - Chart rendering (Recharts)
 * - React component preview via CDN iframe
 * - HTML/SVG/Markdown preview
 * - Copy, Download, Export PDF
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  XMarkIcon,
  ClipboardIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  CodeBracketIcon,
  EyeIcon,
  DocumentTextIcon,
  ArrowsPointingOutIcon,
  ChartBarIcon,
  CubeIcon,
} from '@heroicons/react/24/outline';
import { useArtifactStore, type Artifact, type ArtifactType } from '../../store/artifactStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

type ViewMode = 'code' | 'preview' | 'split';

const DEFAULT_COLORS = [
  '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe',
  '#00c49f', '#ffbb28', '#ff8042', '#a4de6c', '#d0ed57',
];

export function ArtifactPanel() {
  const activeArtifact = useArtifactStore((state) => {
    if (!state.activeArtifactId) return null;
    return state.artifacts.find((a) => a.id === state.activeArtifactId) || null;
  });
  const artifacts = useArtifactStore((state) => state.artifacts);
  const openArtifact = useArtifactStore((state) => state.openArtifact);
  const closeArtifact = useArtifactStore((state) => state.closeArtifact);
  const updateArtifactContent = useArtifactStore((state) => state.updateArtifactContent);

  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [editableContent, setEditableContent] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync editable content when artifact changes
  useEffect(() => {
    if (activeArtifact) {
      setEditableContent(activeArtifact.content);
    }
  }, [activeArtifact?.id, activeArtifact?.content]);

  const handleContentChange = useCallback((newContent: string) => {
    setEditableContent(newContent);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (activeArtifact) {
        updateArtifactContent(activeArtifact.id, newContent);
      }
    }, 300);
  }, [activeArtifact?.id, updateArtifactContent]);

  const handleCopy = async () => {
    if (!activeArtifact) return;
    await navigator.clipboard.writeText(editableContent || activeArtifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!activeArtifact) return;
    const extMap: Record<string, string> = {
      html: '.html', svg: '.svg', markdown: '.md', mermaid: '.mmd',
      chart: '.json', react: '.jsx',
    };
    const ext = extMap[activeArtifact.type]
      || (activeArtifact.language === 'python' ? '.py'
        : activeArtifact.language === 'javascript' ? '.js'
        : activeArtifact.language === 'typescript' ? '.ts'
        : '.txt');

    const blob = new Blob([editableContent || activeArtifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeArtifact.title.replace(/\s+/g, '_').toLowerCase()}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canPreview = activeArtifact
    ? ['html', 'svg', 'markdown', 'mermaid', 'chart', 'react'].includes(activeArtifact.type)
    : false;

  const canSplit = canPreview;

  if (!activeArtifact) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-3 border-b border-border-primary flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Artifacts
          </h3>
        </div>
        {artifacts.length > 0 ? (
          <div className="p-2 space-y-1">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => openArtifact(artifact)}
                className="w-full text-left p-2 rounded-lg hover:bg-background-hover transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <ArtifactTypeIcon type={artifact.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate">{artifact.title}</p>
                    <p className="text-xs text-text-quaternary">{artifact.type}{artifact.language ? ` (${artifact.language})` : ''}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center px-3">
            <CodeBracketIcon className="h-10 w-10 text-text-quaternary mb-2" />
            <p className="text-xs text-text-quaternary">No artifacts yet.</p>
            <p className="text-xs text-text-quaternary mt-1">
              Code blocks and documents will appear here.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-border-primary flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-text-primary truncate flex-1">
            {activeArtifact.title}
          </h3>
          <button
            onClick={() => closeArtifact()}
            className="p-1 text-text-quaternary hover:text-text-primary transition-colors"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-quaternary">
            {activeArtifact.type}{activeArtifact.language ? ` / ${activeArtifact.language}` : ''}
          </span>
          <div className="flex-1" />

          {/* View mode toggle */}
          <div className="flex rounded-md border border-border-primary overflow-hidden">
            <button
              onClick={() => setViewMode('code')}
              className={`px-2 py-0.5 text-xs ${viewMode === 'code' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-tertiary hover:text-text-primary'}`}
            >
              Code
            </button>
            {canSplit && (
              <button
                onClick={() => setViewMode('split')}
                className={`px-2 py-0.5 text-xs ${viewMode === 'split' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-tertiary hover:text-text-primary'}`}
              >
                Split
              </button>
            )}
            {canPreview && (
              <button
                onClick={() => setViewMode('preview')}
                className={`px-2 py-0.5 text-xs ${viewMode === 'preview' ? 'bg-brand-primary/10 text-brand-primary' : 'text-text-tertiary hover:text-text-primary'}`}
              >
                Preview
              </button>
            )}
          </div>

          <button onClick={handleCopy} className="p-1 text-text-quaternary hover:text-text-primary" title="Copy">
            {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-400" /> : <ClipboardIcon className="h-3.5 w-3.5" />}
          </button>
          <button onClick={handleDownload} className="p-1 text-text-quaternary hover:text-text-primary" title="Download">
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'split' && canSplit ? (
          <div className="h-full grid grid-cols-2 divide-x divide-border-primary">
            <div className="overflow-auto">
              <CodeEditor content={editableContent} onChange={handleContentChange} language={activeArtifact.language || activeArtifact.type} />
            </div>
            <div className="overflow-auto">
              <ArtifactPreview artifact={{ ...activeArtifact, content: editableContent }} />
            </div>
          </div>
        ) : viewMode === 'preview' && canPreview ? (
          <div className="h-full overflow-auto">
            <ArtifactPreview artifact={{ ...activeArtifact, content: editableContent }} />
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <CodeEditor content={editableContent} onChange={handleContentChange} language={activeArtifact.language || activeArtifact.type} />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// CODE EDITOR
// ============================================================================

function CodeEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (value: string) => void;
  language: string;
}) {
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className="w-full h-full p-3 text-xs font-mono text-text-primary bg-background-tertiary resize-none focus:outline-none leading-relaxed"
      style={{ tabSize: 2 }}
    />
  );
}

// ============================================================================
// ARTIFACT PREVIEW (Dispatcher)
// ============================================================================

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  switch (artifact.type) {
    case 'html':
      return <HTMLPreview content={artifact.content} title={artifact.title} />;
    case 'svg':
      return <SVGPreview content={artifact.content} />;
    case 'markdown':
      return <MarkdownPreview content={artifact.content} />;
    case 'mermaid':
      return <MermaidPreview content={artifact.content} />;
    case 'chart':
      return <ChartPreview content={artifact.content} />;
    case 'react':
      return <ReactPreview content={artifact.content} title={artifact.title} />;
    default:
      return (
        <pre className="p-3 text-xs font-mono text-text-primary whitespace-pre-wrap break-words leading-relaxed">
          {artifact.content}
        </pre>
      );
  }
}

// ============================================================================
// HTML PREVIEW
// ============================================================================

function HTMLPreview({ content, title }: { content: string; title: string }) {
  return (
    <iframe
      srcDoc={content}
      className="w-full h-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin"
      title={title}
    />
  );
}

// ============================================================================
// SVG PREVIEW
// ============================================================================

function SVGPreview({ content }: { content: string }) {
  return (
    <div
      className="p-4 flex items-center justify-center"
      dangerouslySetInnerHTML={{ __html: content }}
    />
  );
}

// ============================================================================
// MARKDOWN PREVIEW
// ============================================================================

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="p-4 prose prose-sm prose-invert max-w-none prose-p:text-text-secondary prose-headings:text-text-primary prose-li:text-text-secondary prose-code:text-brand-primary">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

// ============================================================================
// MERMAID PREVIEW
// ============================================================================

function MermaidPreview({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgOutput, setSvgOutput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const renderIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const currentId = ++renderIdRef.current;

    async function renderMermaid() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
          fontFamily: 'ui-monospace, monospace',
        });

        const id = `mermaid-${currentId}-${Date.now()}`;
        const { svg } = await mermaid.render(id, content.trim());
        if (!cancelled) {
          setSvgOutput(svg);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to render Mermaid diagram');
          setSvgOutput('');
        }
      }
    }

    if (content.trim()) {
      renderMermaid();
    }

    return () => { cancelled = true; };
  }, [content]);

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs font-medium text-red-400 mb-1">Mermaid Parse Error</p>
          <pre className="text-xs text-red-300 whitespace-pre-wrap">{error}</pre>
        </div>
      </div>
    );
  }

  if (!svgOutput) {
    return (
      <div className="flex items-center justify-center p-8 text-text-quaternary text-xs">
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="p-4 flex items-center justify-center overflow-auto"
      dangerouslySetInnerHTML={{ __html: svgOutput }}
    />
  );
}

// ============================================================================
// CHART PREVIEW (Recharts)
// ============================================================================

interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'area';
  title?: string;
  data: Record<string, any>[];
  xKey?: string;
  yKeys?: string[];
  colors?: string[];
}

function ChartPreview({ content }: { content: string }) {
  const [error, setError] = useState<string | null>(null);

  const spec = useMemo<ChartSpec | null>(() => {
    try {
      const parsed = JSON.parse(content);
      if (!parsed.type || !parsed.data || !Array.isArray(parsed.data)) {
        setError('Chart spec must have "type" and "data" array.');
        return null;
      }
      setError(null);
      return parsed as ChartSpec;
    } catch (err: any) {
      setError(`Invalid JSON: ${err.message}`);
      return null;
    }
  }, [content]);

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs font-medium text-red-400 mb-1">Chart Error</p>
          <pre className="text-xs text-red-300 whitespace-pre-wrap">{error}</pre>
        </div>
      </div>
    );
  }

  if (!spec) return null;

  const colors = spec.colors || DEFAULT_COLORS;
  const firstRow = spec.data[0] as Record<string, any> | undefined;
  const xKey: string = spec.xKey || (firstRow ? Object.keys(firstRow)[0] : undefined) || 'name';
  const yKeys = spec.yKeys || (firstRow
    ? Object.keys(firstRow).filter(k => k !== xKey && typeof firstRow[k] === 'number')
    : ['value']);

  return (
    <div className="p-4">
      {spec.title && (
        <h4 className="text-sm font-medium text-text-primary mb-3 text-center">{spec.title}</h4>
      )}
      <ResponsiveContainer width="100%" height={320}>
        {spec.type === 'bar' ? (
          <BarChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey={xKey} stroke="#888" tick={{ fontSize: 11 }} />
            <YAxis stroke="#888" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {yKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={colors[i % colors.length]} />
            ))}
          </BarChart>
        ) : spec.type === 'line' ? (
          <LineChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey={xKey} stroke="#888" tick={{ fontSize: 11 }} />
            <YAxis stroke="#888" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {yKeys.map((key, i) => (
              <Line key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} />
            ))}
          </LineChart>
        ) : spec.type === 'area' ? (
          <AreaChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey={xKey} stroke="#888" tick={{ fontSize: 11 }} />
            <YAxis stroke="#888" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {yKeys.map((key, i) => (
              <Area key={key} type="monotone" dataKey={key} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.3} />
            ))}
          </AreaChart>
        ) : spec.type === 'scatter' ? (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey={xKey} stroke="#888" tick={{ fontSize: 11 }} name={xKey} />
            <YAxis dataKey={yKeys[0]} stroke="#888" tick={{ fontSize: 11 }} name={yKeys[0]} />
            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Scatter data={spec.data} fill={colors[0]} />
          </ScatterChart>
        ) : spec.type === 'pie' ? (
          <PieChart>
            <Pie
              data={spec.data}
              dataKey={yKeys[0] || 'value'}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius={120}
              label={(entry: any) => entry[xKey]}
            >
              {spec.data.map((_entry, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : (
          <BarChart data={spec.data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey={xKey} stroke="#888" />
            <YAxis stroke="#888" />
            <Tooltip />
            {yKeys.map((key, i) => (
              <Bar key={key} dataKey={key} fill={colors[i % colors.length]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================================
// REACT COMPONENT PREVIEW (CDN Iframe)
// ============================================================================

function ReactPreview({ content, title }: { content: string; title: string }) {
  const iframeDoc = useMemo(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #111; }
    #root { }
    .error { color: #e53e3e; background: #fff5f5; border: 1px solid #feb2b2; border-radius: 8px; padding: 12px; font-size: 13px; white-space: pre-wrap; }
  </style>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script crossorigin src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module">
    try {
      ${content}

      // Try to find and render the default component
      // Look for common export patterns
      const componentNames = [${getComponentNameGuesses(content)}];
      let Component = null;
      for (const name of componentNames) {
        try { Component = eval(name); if (Component) break; } catch(e) {}
      }

      if (Component && typeof Component === 'function') {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(React.createElement(Component));
      } else {
        document.getElementById('root').innerHTML = '<div class="error">Could not find a React component to render. Make sure your code defines a component function.</div>';
      }
    } catch (err) {
      document.getElementById('root').innerHTML = '<div class="error">Render Error: ' + err.message + '</div>';
    }
  </script>
</body>
</html>`;
  }, [content]);

  return (
    <iframe
      srcDoc={iframeDoc}
      className="w-full h-full border-0 bg-white"
      sandbox="allow-scripts"
      title={title}
    />
  );
}

function getComponentNameGuesses(code: string): string {
  // Extract function/const component names from JSX code
  const names: string[] = [];
  const funcMatches = code.matchAll(/(?:function|const|let|var)\s+([A-Z][a-zA-Z0-9]*)/g);
  for (const m of funcMatches) {
    names.push(`"${m[1]}"`);
  }
  // Add common defaults
  names.push('"App"', '"Component"', '"Main"', '"Default"');
  return names.join(', ');
}

// ============================================================================
// ARTIFACT TYPE ICON
// ============================================================================

function ArtifactTypeIcon({ type }: { type: ArtifactType | string }) {
  switch (type) {
    case 'html':
      return <EyeIcon className="h-4 w-4 text-orange-400" />;
    case 'svg':
      return <EyeIcon className="h-4 w-4 text-green-400" />;
    case 'markdown':
      return <DocumentTextIcon className="h-4 w-4 text-blue-400" />;
    case 'mermaid':
      return <ArrowsPointingOutIcon className="h-4 w-4 text-pink-400" />;
    case 'chart':
      return <ChartBarIcon className="h-4 w-4 text-yellow-400" />;
    case 'react':
      return <CubeIcon className="h-4 w-4 text-cyan-400" />;
    default:
      return <CodeBracketIcon className="h-4 w-4 text-purple-400" />;
  }
}
