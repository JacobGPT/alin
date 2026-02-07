/**
 * FilePreview - Enhanced file preview with thumbnails, code preview, and metadata
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  XMarkIcon,
  DocumentTextIcon,
  PhotoIcon,
  CodeBracketIcon,
  TableCellsIcon,
  DocumentIcon,
  ArrowsPointingOutIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';

interface FilePreviewProps {
  file: File;
  onRemove: () => void;
  compact?: boolean;
}

const FILE_TYPE_ICONS: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
  image: PhotoIcon,
  code: CodeBracketIcon,
  text: DocumentTextIcon,
  data: TableCellsIcon,
  default: DocumentIcon,
};

const CODE_EXTENSIONS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp',
  'h', 'css', 'scss', 'html', 'xml', 'json', 'yaml', 'yml', 'toml',
  'sh', 'bash', 'sql', 'md', 'mdx', 'svelte', 'vue', 'php',
]);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const DATA_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'json', 'xml']);

function getFileCategory(filename: string, mimeType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.has(ext) || mimeType.startsWith('image/')) return 'image';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DATA_EXTENSIONS.has(ext)) return 'data';
  if (mimeType.startsWith('text/')) return 'text';
  return 'default';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FilePreview: React.FC<FilePreviewProps> = ({ file, onRemove, compact = false }) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [codePreview, setCodePreview] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [csvData, setCsvData] = useState<string[][] | null>(null);

  const category = getFileCategory(file.name, file.type);
  const Icon = FILE_TYPE_ICONS[category] ?? DocumentIcon;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';

  useEffect(() => {
    // Generate image thumbnail
    if (category === 'image') {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }

    // Generate code preview
    if (category === 'code' || category === 'text') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setCodePreview(text.slice(0, 500));
      };
      reader.readAsText(file);
    }

    // Parse CSV preview
    if (ext === 'csv' || ext === 'tsv') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const separator = ext === 'tsv' ? '\t' : ',';
        const rows = text.split('\n').slice(0, 5).map(row => row.split(separator));
        setCsvData(rows);
      };
      reader.readAsText(file);
    }

    return undefined;
  }, [file, category, ext]);

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="inline-flex items-center gap-1.5 px-2 py-1 bg-background-tertiary rounded-lg border border-border-primary text-xs group"
      >
        {preview ? (
          <img src={preview} alt={file.name} className="w-5 h-5 rounded object-cover" />
        ) : (
          <Icon className="w-4 h-4 text-text-tertiary" />
        )}
        <span className="text-text-secondary max-w-[120px] truncate">{file.name}</span>
        <span className="text-text-tertiary">{formatFileSize(file.size)}</span>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <XMarkIcon className="w-3.5 h-3.5 text-text-tertiary hover:text-red-400" />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="relative bg-background-tertiary rounded-xl border border-border-primary overflow-hidden"
      style={{ maxWidth: expanded ? '100%' : '240px' }}
    >
      {/* Preview Content */}
      {category === 'image' && preview && (
        <div className="relative">
          <img
            src={preview}
            alt={file.name}
            className={`w-full object-cover ${expanded ? 'max-h-96' : 'max-h-32'}`}
          />
          <button
            onClick={() => setExpanded(!expanded)}
            className="absolute top-1 right-1 p-1 bg-black/50 rounded-md text-white/80 hover:text-white"
          >
            <ArrowsPointingOutIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {category === 'code' && codePreview && (
        <div className="relative">
          <pre className={`p-2 text-[10px] leading-tight text-text-secondary font-mono overflow-hidden ${
            expanded ? 'max-h-64' : 'max-h-20'
          }`}>
            {codePreview}
          </pre>
          {codePreview.length >= 500 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="absolute bottom-1 right-1 p-0.5 bg-background-primary/80 rounded text-[10px] text-text-tertiary hover:text-text-primary"
            >
              <EyeIcon className="w-3 h-3" />
            </button>
          )}
          <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-background-primary/80 rounded text-[10px] text-text-tertiary">
            {ext}
          </div>
        </div>
      )}

      {csvData && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <tbody>
              {csvData.map((row, i) => (
                <tr key={i} className={i === 0 ? 'bg-background-primary/50 font-medium' : ''}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-1.5 py-0.5 border-r border-border-primary text-text-secondary truncate max-w-[100px]">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* File Info Bar */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-border-primary">
        <Icon className="w-4 h-4 text-text-tertiary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-primary truncate">{file.name}</p>
          <p className="text-[10px] text-text-tertiary">{formatFileSize(file.size)}</p>
        </div>
        <button
          onClick={onRemove}
          className="p-1 rounded hover:bg-background-primary transition-colors"
        >
          <XMarkIcon className="w-4 h-4 text-text-tertiary hover:text-red-400" />
        </button>
      </div>
    </motion.div>
  );
};

export default FilePreview;
