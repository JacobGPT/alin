import type { Artifact } from '../../types/tbwo';

const BACKEND_URL = 'http://localhost:3002';

interface FileGenerationResult {
  success: boolean;
  filesCreated: string[];
  filesUpdated: string[];
  errors: Array<{ path: string; error: string }>;
  totalSize: number;
}

interface FileEntry {
  path: string;
  content: string;
  type: 'create' | 'update';
}

export class FileGenerator {
  private generatedFiles: Map<string, string> = new Map(); // path -> content
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  // Generate all files from artifacts
  async generateFromArtifacts(artifacts: Artifact[]): Promise<FileGenerationResult> {
    const result: FileGenerationResult = {
      success: true,
      filesCreated: [],
      filesUpdated: [],
      errors: [],
      totalSize: 0,
    };

    for (const artifact of artifacts) {
      if (!artifact.path || !artifact.content) continue;
      if (typeof artifact.content !== 'string') continue;

      const fullPath = this.resolvePath(artifact.path);
      try {
        // Ensure directory exists
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (dir) await this.ensureDirectory(dir);

        // Write file
        const existed = this.generatedFiles.has(fullPath);
        await this.writeFile(fullPath, artifact.content as string);
        this.generatedFiles.set(fullPath, artifact.content as string);

        if (existed) result.filesUpdated.push(fullPath);
        else result.filesCreated.push(fullPath);

        result.totalSize += (artifact.content as string).length;
      } catch (error: any) {
        result.errors.push({ path: fullPath, error: error.message });
        result.success = false;
      }
    }

    return result;
  }

  // Generate a complete website structure
  async generateWebsiteStructure(config: {
    name: string;
    pages: Array<{ name: string; path: string; sections: string[] }>;
    designTokens?: string;
    animations?: string;
    copy?: Map<string, string>;
  }): Promise<FileGenerationResult> {
    const files: FileEntry[] = [];

    // index.html
    files.push({
      path: 'index.html',
      content: this.generateIndexHTML(config),
      type: 'create',
    });

    // CSS files
    if (config.designTokens) {
      files.push({
        path: 'css/variables.css',
        content: config.designTokens,
        type: 'create',
      });
    }
    files.push({
      path: 'css/styles.css',
      content: this.generateBaseCSS(),
      type: 'create',
    });
    if (config.animations) {
      files.push({
        path: 'css/animations.css',
        content: config.animations,
        type: 'create',
      });
    }

    // JS
    files.push({
      path: 'js/main.js',
      content: this.generateBaseJS(config.pages),
      type: 'create',
    });

    // Additional pages
    for (const page of config.pages) {
      if (page.path !== '/' && page.path !== '/index.html') {
        files.push({
          path:
            page.path.replace(/^\//, '') +
            (page.path.endsWith('.html') ? '' : '.html'),
          content: this.generatePageHTML(page, config),
          type: 'create',
        });
      }
    }

    // Write all files
    return this.writeFiles(files);
  }

  // Write multiple files
  async writeFiles(files: FileEntry[]): Promise<FileGenerationResult> {
    const result: FileGenerationResult = {
      success: true,
      filesCreated: [],
      filesUpdated: [],
      errors: [],
      totalSize: 0,
    };

    for (const file of files) {
      const fullPath = this.resolvePath(file.path);
      try {
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (dir) await this.ensureDirectory(dir);
        await this.writeFile(fullPath, file.content);
        this.generatedFiles.set(fullPath, file.content);

        if (file.type === 'update') result.filesUpdated.push(fullPath);
        else result.filesCreated.push(fullPath);

        result.totalSize += file.content.length;
      } catch (error: any) {
        result.errors.push({ path: fullPath, error: error.message });
        result.success = false;
      }
    }

    return result;
  }

  // Private helpers
  private resolvePath(relativePath: string): string {
    if (relativePath.startsWith('/') || relativePath.includes(':'))
      return relativePath;
    return `${this.baseDir}/${relativePath}`.replace(/\/\//g, '/');
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const response = await fetch(`${BACKEND_URL}/api/files/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to write file: ${path}`);
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    // Backend file write auto-creates directories, but we can verify
    try {
      await fetch(`${BACKEND_URL}/api/files/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
    } catch {
      // Directory may not exist yet, that's ok - file write will create it
    }
  }

  private generateIndexHTML(config: any): string {
    // Generate a complete, well-structured index.html
    // Include links to CSS files, meta tags, semantic HTML structure
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${config.name} - Built with ALIN TBWO">
  <title>${config.name}</title>
  <link rel="stylesheet" href="css/variables.css">
  <link rel="stylesheet" href="css/styles.css">
  <link rel="stylesheet" href="css/animations.css">
</head>
<body>
  <header class="site-header">
    <nav class="nav">
      <a href="/" class="nav__logo">${config.name}</a>
      <ul class="nav__links">
        ${(config.pages || [])
          .map((p: any) => `<li><a href="${p.path}">${p.name}</a></li>`)
          .join('\n        ')}
      </ul>
    </nav>
  </header>

  <main>
    ${(config.pages?.[0]?.sections || ['hero', 'features', 'cta'])
      .map(
        (s: string) => `<section class="section section--${s}" id="${s}">
      <div class="container">
        <h2>${s.charAt(0).toUpperCase() + s.slice(1)}</h2>
      </div>
    </section>`
      )
      .join('\n    ')}
  </main>

  <footer class="site-footer">
    <div class="container">
      <p>&copy; ${new Date().getFullYear()} ${config.name}. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/main.js" type="module"></script>
</body>
</html>`;
  }

  private generatePageHTML(page: any, config: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.name} - ${config.name}</title>
  <link rel="stylesheet" href="css/variables.css">
  <link rel="stylesheet" href="css/styles.css">
  <link rel="stylesheet" href="css/animations.css">
</head>
<body>
  <header class="site-header">
    <nav class="nav">
      <a href="/" class="nav__logo">${config.name}</a>
    </nav>
  </header>
  <main>
    ${(page.sections || [])
      .map(
        (s: string) => `<section class="section section--${s}" id="${s}">
      <div class="container">
        <h2>${s.charAt(0).toUpperCase() + s.slice(1)}</h2>
      </div>
    </section>`
      )
      .join('\n    ')}
  </main>
  <footer class="site-footer">
    <div class="container">
      <p>&copy; ${new Date().getFullYear()} ${config.name}</p>
    </div>
  </footer>
  <script src="js/main.js" type="module"></script>
</body>
</html>`;
  }

  private generateBaseCSS(): string {
    return `/* Base Styles */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html { font-size: 16px; scroll-behavior: smooth; }

body {
  font-family: var(--font-body, system-ui, -apple-system, sans-serif);
  line-height: var(--line-height-body, 1.6);
  color: var(--color-text, #1a1a2e);
  background: var(--color-background, #ffffff);
}

.container { max-width: var(--max-width, 1200px); margin: 0 auto; padding: 0 var(--spacing-md, 1.5rem); }

/* Navigation */
.nav { display: flex; align-items: center; justify-content: space-between; padding: var(--spacing-sm, 1rem) var(--spacing-md, 1.5rem); }
.nav__logo { font-weight: 700; font-size: 1.25rem; text-decoration: none; color: var(--color-primary, #6366f1); }
.nav__links { display: flex; list-style: none; gap: var(--spacing-md, 1.5rem); }
.nav__links a { text-decoration: none; color: var(--color-text-secondary, #64748b); transition: color 0.2s; }
.nav__links a:hover { color: var(--color-primary, #6366f1); }

/* Sections */
.section { padding: var(--spacing-2xl, 5rem) 0; }
.section h2 { font-size: var(--font-size-h2, 2.5rem); margin-bottom: var(--spacing-lg, 2rem); }

/* Footer */
.site-footer { padding: var(--spacing-xl, 3rem) 0; border-top: 1px solid var(--color-border, #e2e8f0); text-align: center; color: var(--color-text-secondary, #64748b); }

/* Responsive */
@media (max-width: 768px) {
  .nav { flex-direction: column; gap: var(--spacing-sm, 1rem); }
  .nav__links { flex-wrap: wrap; justify-content: center; }
  .section h2 { font-size: 1.75rem; }
}`;
  }

  private generateBaseJS(_pages: any[]): string {
    return `// Main JavaScript
document.addEventListener('DOMContentLoaded', () => {
  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Intersection Observer for scroll animations
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.section').forEach(section => {
    observer.observe(section);
  });

  console.log('Site initialized');
});`;
  }

  // State accessors
  getGeneratedFiles(): Map<string, string> {
    return new Map(this.generatedFiles);
  }

  getFileCount(): number {
    return this.generatedFiles.size;
  }

  getTotalSize(): number {
    let size = 0;
    this.generatedFiles.forEach((content) => (size += content.length));
    return size;
  }
}
