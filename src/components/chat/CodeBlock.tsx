/**
 * CodeBlock - Syntax Highlighted Code Display
 * 
 * Features:
 * - Syntax highlighting (highlight.js)
 * - Copy to clipboard
 * - Language badge
 * - Line numbers
 * - Filename display
 * - Execution support (future)
 */

import { useState, useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';

// Import languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';

// Import theme
import 'highlight.js/styles/github-dark.css';

import { ClipboardIcon, CheckIcon, PlayIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

import { copyToClipboard } from '@utils/cn';
import { useSettingsStore } from '@store/settingsStore';
import { useArtifactStore, type ArtifactType } from '../../store/artifactStore';
import { useUIStore } from '@store/uiStore';
import { RightPanelContent } from '../../types/ui';
import { nanoid } from 'nanoid';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('markdown', markdown);

// ============================================================================
// CODEBLOCK COMPONENT
// ============================================================================

interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
  showLineNumbers?: boolean;
  allowExecution?: boolean;
}

export function CodeBlock({
  code,
  language,
  filename,
  showLineNumbers = true,
  allowExecution = false,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [executing, setExecuting] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  
  const chatPreferences = useSettingsStore((state) => state.chat);
  
  // ========================================================================
  // SYNTAX HIGHLIGHTING
  // ========================================================================
  
  useEffect(() => {
    if (codeRef.current && chatPreferences.syntaxHighlighting) {
      hljs.highlightElement(codeRef.current);
    }
  }, [code, language, chatPreferences.syntaxHighlighting]);
  
  // ========================================================================
  // HANDLERS
  // ========================================================================
  
  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  const handleExecute = async () => {
    setExecuting(true);
    // TODO: Implement code execution
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setExecuting(false);
  };

  const handleOpenArtifact = () => {
    const typeMap: Record<string, ArtifactType> = {
      html: 'html', htm: 'html',
      svg: 'svg',
      markdown: 'markdown', md: 'markdown',
      mermaid: 'mermaid',
      jsx: 'react', tsx: 'react', react: 'react',
      chart: 'chart',
    };
    const artifactType = typeMap[language.toLowerCase()] || 'code';
    const title = filename || `${language.toUpperCase()} snippet`;

    useArtifactStore.getState().openArtifact({
      id: nanoid(),
      title,
      type: artifactType,
      language: artifactType === 'code' ? language : undefined,
      content: code,
    });
    useUIStore.getState().setRightPanel(RightPanelContent.ARTIFACT, true);
  };
  
  // ========================================================================
  // RENDER
  // ========================================================================
  
  // Split code into lines for line numbers
  const lines = code.split('\n');
  const shouldShowLineNumbers = showLineNumbers && chatPreferences.lineNumbers;
  
  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-border-primary bg-background-tertiary">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-primary bg-background-elevated px-4 py-2">
        <div className="flex items-center gap-3">
          {/* Language Badge */}
          <span className="rounded bg-background-tertiary px-2 py-1 text-xs font-medium text-text-secondary">
            {language.toUpperCase()}
          </span>
          
          {/* Filename */}
          {filename && (
            <span className="text-xs text-text-tertiary">{filename}</span>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Execute Button */}
          {allowExecution && (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-background-hover hover:text-text-primary disabled:opacity-50"
            >
              <PlayIcon className="h-3.5 w-3.5" />
              {executing ? 'Running...' : 'Run'}
            </button>
          )}
          
          {/* Open as Artifact */}
          <button
            onClick={handleOpenArtifact}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-background-hover hover:text-text-primary"
            title="Open in Artifact panel"
          >
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            Artifact
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-background-hover hover:text-text-primary"
          >
            {copied ? (
              <>
                <CheckIcon className="h-3.5 w-3.5 text-semantic-success" />
                Copied
              </>
            ) : (
              <>
                <ClipboardIcon className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Code */}
      <div className="relative overflow-x-auto">
        <pre className={`!m-0 !bg-transparent ${shouldShowLineNumbers ? 'pl-12' : 'pl-4'} pr-4 py-4`}>
          {/* Line Numbers */}
          {shouldShowLineNumbers && (
            <div className="absolute left-0 top-0 flex h-full flex-col border-r border-border-primary bg-background-secondary px-3 py-4 text-right text-xs text-text-quaternary select-none">
              {lines.map((_, index) => (
                <div key={index} className="leading-6">
                  {index + 1}
                </div>
              ))}
            </div>
          )}
          
          {/* Code Content */}
          <code
            ref={codeRef}
            className={`language-${language} !bg-transparent !p-0 text-sm leading-6 ${
              chatPreferences.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          >
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}
