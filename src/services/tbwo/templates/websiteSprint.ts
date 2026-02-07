import { nanoid } from 'nanoid';
import type {
  TBWO,
  ExecutionPlan,
  Phase,
  Task,
  AgentPod,
  TBWOScope,
  TimeBudget,
  WebsiteSprintConfig,
  PodRole,
  PodAllocationStrategy,
  Risk,
  Deliverable,
} from '../../../types/tbwo';
import {
  TBWOType,
  TBWOStatus,
  QualityTarget,
  PodRole as PodRoleEnum,
  PodStatus,
  AuthorityLevel,
  Operation,
} from '../../../types/tbwo';

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

export const DEFAULT_WEBSITE_SPRINT_CONFIG: WebsiteSprintConfig = {
  pages: [
    {
      name: 'Home',
      path: '/index.html',
      isInMainNav: true,
      navOrder: 0,
      metaDescription: 'Welcome to our website',
      sections: [
        { type: 'hero' },
        { type: 'features' },
        { type: 'about' },
        { type: 'cta' },
        { type: 'footer' },
      ],
    },
    {
      name: 'About',
      path: '/about.html',
      isInMainNav: true,
      navOrder: 1,
      metaDescription: 'Learn about us',
      sections: [
        { type: 'hero' },
        { type: 'about' },
        { type: 'team' },
        { type: 'footer' },
      ],
    },
    {
      name: 'Contact',
      path: '/contact.html',
      isInMainNav: true,
      navOrder: 2,
      metaDescription: 'Get in touch',
      sections: [
        { type: 'hero' },
        { type: 'cta' },
        { type: 'footer' },
      ],
    },
  ],
  navigation: {
    style: 'horizontal',
    sticky: true,
    logoText: 'My Site',
    footerLinks: [],
    socialLinks: [],
  },
  outputStructure: {
    rootFolder: 'output/tbwo/website',
    siteFolder: 'site',
    assetsFolder: 'assets',
    cssFile: 'site/styles.css',
    includeReadme: true,
    includeReceipt: true,
    includeDeployScript: false,
  },
  aesthetic: 'modern',
  framework: 'static',
  includeAnimations: true,
  includeContactForm: true,
  includeBlog: false,
  seoOptimized: true,
  responsive: true,
  includeDeployConfig: false,
};

// ============================================================================
// HELPERS
// ============================================================================

/** Build the output root path from config + objective */
function getOutputRoot(config: WebsiteSprintConfig, objective?: string): string {
  if (config.outputStructure.rootFolder && config.outputStructure.rootFolder !== 'output/tbwo/website') {
    return config.outputStructure.rootFolder;
  }
  const slug = objective
    ? objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    : 'website';
  return `output/tbwo/${slug}`;
}

/** Build the full list of nav pages for prompt context */
function buildNavDescription(config: WebsiteSprintConfig): string {
  const navPages = config.pages
    .filter(p => p.isInMainNav)
    .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  if (navPages.length === 0) return 'No main navigation pages defined.';
  return navPages.map(p => `- "${p.name}" → ${p.path}`).join('\n');
}

/** Build the output structure description for prompts */
function buildOutputDescription(config: WebsiteSprintConfig, root: string): string {
  const out = config.outputStructure;
  const lines = [
    `${root}/`,
    `  ${out.siteFolder}/`,
    `    index.html`,
    ...config.pages.filter(p => p.path !== '/index.html' && p.path !== '/').map(p => {
      const fname = p.path.startsWith('/') ? p.path.slice(1) : p.path;
      return `    ${fname.endsWith('.html') ? fname : fname + '.html'}`;
    }),
    `    ${out.cssFile.replace(out.siteFolder + '/', '')}`,
    `    script.js`,
    `  ${out.assetsFolder}/`,
    `    images/`,
    `    icons/`,
  ];
  if (out.includeReadme) lines.push(`  README.md`);
  if (out.includeReceipt) lines.push(`  receipt.json`);
  if (out.includeDeployScript) {
    lines.push(`  deploy.sh`);
    if (config.deployTarget === 'netlify') lines.push(`  netlify.toml`);
    if (config.deployTarget === 'vercel') lines.push(`  vercel.json`);
    if (config.deployTarget === 'cloudflare') lines.push(`  wrangler.toml`);
  }
  return lines.join('\n');
}

// ============================================================================
// POD FACTORY
// ============================================================================

export function createWebsiteSprintPods(
  tbwoId: string
): Map<string, AgentPod> {
  const pods = new Map<string, AgentPod>();

  const podConfigs: Array<{ role: PodRole; name: string; tools: string[] }> = [
    {
      role: PodRoleEnum.ORCHESTRATOR,
      name: 'Orchestrator',
      tools: ['scan_directory', 'memory_store', 'memory_recall', 'file_list'],
    },
    {
      role: PodRoleEnum.DESIGN,
      name: 'Design Pod',
      tools: ['code_search', 'memory_recall', 'file_write', 'file_read'],
    },
    {
      role: PodRoleEnum.FRONTEND,
      name: 'Frontend Pod',
      tools: ['file_write', 'file_read', 'execute_code', 'file_list', 'edit_file'],
    },
    {
      role: PodRoleEnum.COPY,
      name: 'Copy Pod',
      tools: ['memory_recall', 'web_search', 'file_write', 'file_read'],
    },
    {
      role: PodRoleEnum.MOTION,
      name: 'Motion Pod',
      tools: ['file_write', 'file_read', 'edit_file'],
    },
    {
      role: PodRoleEnum.QA,
      name: 'QA Pod',
      tools: ['file_read', 'execute_code', 'file_list', 'scan_directory'],
    },
    {
      role: PodRoleEnum.DEPLOYMENT,
      name: 'Deployment Pod',
      tools: ['file_write', 'file_read', 'file_list', 'scan_directory'],
    },
  ];

  for (const config of podConfigs) {
    const id = nanoid();
    const pod: AgentPod = {
      id,
      role: config.role,
      name: config.name,
      status: PodStatus.INITIALIZING,
      health: {
        status: 'healthy',
        lastHeartbeat: Date.now(),
        errorCount: 0,
        consecutiveFailures: 0,
        warnings: [],
      },
      modelConfig: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
        temperature: 0.7,
        maxTokens: 4096,
      },
      toolWhitelist: config.tools,
      memoryScope: [],
      taskQueue: [],
      completedTasks: [],
      outputs: [],
      resourceUsage: {
        cpuPercent: 0,
        memoryMB: 0,
        tokensUsed: 0,
        apiCalls: 0,
        executionTime: 0,
      },
      messageLog: [],
      createdAt: Date.now(),
      tbwoId,
    };
    pods.set(id, pod);
  }

  return pods;
}

// ============================================================================
// PLAN FACTORY
// ============================================================================

export function createWebsiteSprintPlan(
  tbwoId: string,
  config: WebsiteSprintConfig,
  pods: Map<string, AgentPod>,
  objective?: string
): ExecutionPlan {
  const podsByRole = new Map<PodRole, string>();
  pods.forEach((pod) => {
    podsByRole.set(pod.role, pod.id);
  });

  const outputRoot = getOutputRoot(config, objective);
  const out = config.outputStructure;
  const siteDir = `${outputRoot}/${out.siteFolder}`;
  const assetsDir = `${outputRoot}/${out.assetsFolder}`;
  const navDesc = buildNavDescription(config);
  const outputDesc = buildOutputDescription(config, outputRoot);
  const pageCount = config.pages.length;

  // -------------------------------------------------------------------------
  // Phase 1: Design System
  // -------------------------------------------------------------------------
  const phase1Tasks: Task[] = [
    {
      id: nanoid(),
      name: 'Create design tokens',
      description: `Create a comprehensive CSS custom properties file at ${siteDir}/variables.css with:
- Color palette: primary, secondary, accent, neutral scale (50-900), background, surface, text colors for the "${config.aesthetic}" aesthetic
- Typography: font families (heading + body), type scale (h1-h6, body-sm, body-lg, caption), weights, line-heights
- Spacing: 4px-based scale (xs=4px through 4xl=64px)
- Borders: radius scale (sm, md, lg, full), border widths
- Shadows: sm, md, lg, xl elevations
- Breakpoints: mobile (320px), tablet (768px), desktop (1024px), wide (1440px)
- Z-index scale: base, dropdown, sticky, modal, toast
- Transitions: duration-fast (150ms), duration-normal (300ms), duration-slow (500ms)
${config.colorScheme ? `Use these colors: primary=${config.colorScheme.primary}, secondary=${config.colorScheme.secondary}, background=${config.colorScheme.background}, text=${config.colorScheme.text}${config.colorScheme.accent ? `, accent=${config.colorScheme.accent}` : ''}` : ''}
${config.typography ? `Typography: ${config.typography.headingFont ? 'heading font: ' + config.typography.headingFont : ''} ${config.typography.bodyFont ? 'body font: ' + config.typography.bodyFont : ''} scale: ${config.typography.scale || 'medium'}` : ''}`,
      assignedPod: podsByRole.get(PodRoleEnum.DESIGN),
      status: 'pending',
      estimatedDuration: 4,
    },
    {
      id: nanoid(),
      name: 'Design component specs',
      description: `Write a design specification document to ${siteDir}/design-spec.md covering component designs for:
- Navigation bar (${config.navigation.style} style, ${config.navigation.sticky ? 'sticky' : 'static'}, logo="${config.navigation.logoText || 'Site'}")
- Hero section (full-width, gradient/image background options, centered text + CTA)
- Feature cards (icon + title + description, grid layout)
- CTA sections (heading + subtext + button, contrasting background)
- Footer (multi-column: links, social, copyright)
- Team member cards (photo placeholder, name, role, bio)
- Pricing cards (tier name, price, features list, CTA button, "popular" highlight)
- FAQ accordion (question + expandable answer)
- Gallery grid (responsive masonry or grid)
- Testimonial cards (quote, avatar, name, title, star rating)
- Contact form (name, email, subject, message, submit button)
Include hover/active/focus states for all interactive elements.
Use BEM naming convention for all CSS classes.`,
      assignedPod: podsByRole.get(PodRoleEnum.DESIGN),
      status: 'pending',
      estimatedDuration: 5,
    },
  ];

  // -------------------------------------------------------------------------
  // Phase 2: Content Creation
  // -------------------------------------------------------------------------
  const phase2Tasks: Task[] = [];

  // One content task per page for better quality
  for (const page of config.pages) {
    const sectionList = page.sections.map(s => {
      const heading = s.heading ? ` (heading: "${s.heading}")` : '';
      return `${s.type}${heading}`;
    }).join(', ');

    phase2Tasks.push({
      id: nanoid(),
      name: `Write content: ${page.name}`,
      description: `Write all content for the "${page.name}" page (${page.path}). This page has these sections: ${sectionList}.
${page.metaDescription ? `Meta description: "${page.metaDescription}"` : ''}

For each section, write:
- Compelling headlines and subheadlines
- Body text (real content, NOT lorem ipsum)
- CTA button text (action-oriented, specific)
- Any list items, feature descriptions, or card content
- Alt text for any images

Content guidelines:
- Write for scanners: short paragraphs (2-3 sentences), front-load key info
- Headlines: 8 words max, clear value proposition
- CTAs: action verbs ("Get Started", "Learn More", "Contact Us")
- Tone: professional and approachable

Save content as structured markdown to ${siteDir}/content/${page.name.toLowerCase().replace(/\s+/g, '-')}-content.md`,
      assignedPod: podsByRole.get(PodRoleEnum.COPY),
      status: 'pending',
      estimatedDuration: 3,
    });
  }

  // SEO content
  if (config.seoOptimized) {
    phase2Tasks.push({
      id: nanoid(),
      name: 'Write SEO meta content',
      description: `Write SEO metadata for ALL ${pageCount} pages:
${config.pages.map(p => `- ${p.name}: title tag (50-60 chars), meta description (150-160 chars), Open Graph tags`).join('\n')}
Save to ${siteDir}/content/seo-meta.md`,
      assignedPod: podsByRole.get(PodRoleEnum.COPY),
      status: 'pending',
      estimatedDuration: 2,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 3: Shared Components & Navigation
  // -------------------------------------------------------------------------
  const phase3Tasks: Task[] = [
    {
      id: nanoid(),
      name: 'Create main stylesheet',
      description: `Create the main CSS file at ${siteDir}/styles.css that:
- Imports variables.css
- CSS reset/normalize
- Base styles (body, headings, paragraphs, links, lists)
- Utility classes (.container, .section, .grid, .flex, .sr-only, .text-center, etc.)
- Navigation component styles:
  - ${config.navigation.style} layout
  - ${config.navigation.sticky ? 'Position: sticky with backdrop blur' : 'Position: static'}
  - Mobile hamburger menu with slide-in/fade-in drawer
  - Active page indicator
  - Logo/brand area
- Footer component styles (multi-column grid, social icons, copyright)
- All component styles from the design spec
- Responsive styles for 320px, 768px, 1024px, 1440px breakpoints
- Print styles
Use CSS custom properties from variables.css throughout. Mobile-first approach (min-width queries).`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 8,
    },
    {
      id: nanoid(),
      name: 'Create shared JavaScript',
      description: `Create the main JS file at ${siteDir}/script.js with:
- Mobile hamburger menu toggle (open/close with accessible aria-expanded)
- Smooth scroll for anchor links
- Active nav link highlighting based on current page
- Intersection Observer for scroll-triggered animations (.fade-in, .slide-up classes)
- Scroll-to-top button (appears after 300px scroll)
${config.includeContactForm ? '- Contact form validation (name, email required, email format check, visual error states)' : ''}
${config.navigation.sticky ? '- Header shrink/shadow on scroll' : ''}
- All event listeners use addEventListener (no inline handlers)
- All DOM queries cached at the top
- Wrap in DOMContentLoaded listener`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 5,
    },
  ];

  // -------------------------------------------------------------------------
  // Phase 4: Page Development (build each HTML page)
  // -------------------------------------------------------------------------
  const phase4Tasks: Task[] = [];

  for (const page of config.pages) {
    const fileName = page.path === '/' || page.path === '/index.html'
      ? 'index.html'
      : (page.path.startsWith('/') ? page.path.slice(1) : page.path).replace(/\/?$/, '.html').replace('.html.html', '.html');

    const sectionDescriptions = page.sections.map(s => {
      switch (s.type) {
        case 'hero': return 'Hero: full-width banner with headline, subheadline, CTA button, background gradient or image';
        case 'features': return 'Features: responsive grid of feature cards (icon placeholder + title + description)';
        case 'about': return 'About: two-column layout (text + image placeholder) or single-column rich text';
        case 'testimonials': return 'Testimonials: carousel or grid of quote cards with avatar, name, title, star rating';
        case 'cta': return 'CTA: full-width section with contrasting background, headline, subtext, prominent button';
        case 'gallery': return 'Gallery: responsive image grid/masonry with lightbox-ready markup';
        case 'pricing': return 'Pricing: 2-4 tier cards with name, price, feature list, CTA, "popular" badge option';
        case 'faq': return 'FAQ: accordion with <details>/<summary> elements, smooth open/close';
        case 'team': return 'Team: grid of member cards with photo placeholder, name, role, short bio';
        case 'blog': return 'Blog: grid of article preview cards with image, date, title, excerpt, read-more link';
        case 'footer': return 'Footer: multi-column links, social icons, copyright, built on semantic <footer>';
        case 'custom': return `Custom section: "${s.heading || s.content || 'custom content'}"`;
        default: return `${s.type} section`;
      }
    }).join('\n    - ');

    // Build inter-page link context
    const navPages = config.pages.filter(p => p.isInMainNav).sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
    const pageLinks = page.links?.map(l => `"${l.label}" → ${l.target} (${l.type}${l.isExternal ? ', external' : ''})`).join(', ') || 'none';

    phase4Tasks.push({
      id: nanoid(),
      name: `Build page: ${page.name}`,
      description: `Create ${siteDir}/${fileName} — a complete, semantic HTML5 page.

Structure:
<!DOCTYPE html> with lang="en", proper <head> (charset, viewport, title, meta description, CSS links, favicon)

Shared components (same on every page):
- Navigation bar with logo "${config.navigation.logoText || 'Site'}" and links: ${navPages.map(n => `"${n.name}" → ${n.path === '/' || n.path === '/index.html' ? 'index.html' : n.path.replace(/^\//, '')}`).join(', ')}
- Active page highlight on "${page.name}"
- Mobile hamburger menu
- Footer with ${config.navigation.footerLinks.length > 0 ? config.navigation.footerLinks.map(l => `"${l.label}"`).join(', ') : 'site links, copyright'}
${config.navigation.socialLinks?.length ? '- Social links: ' + config.navigation.socialLinks.map(s => s.platform).join(', ') : ''}

Page-specific sections:
    - ${sectionDescriptions}

Page-specific links: ${pageLinks}

Requirements:
- Use content from ${siteDir}/content/${page.name.toLowerCase().replace(/\s+/g, '-')}-content.md
- Link to styles.css and script.js (relative paths)
- All images use placeholder src with descriptive alt text
- Semantic HTML: <header>, <nav>, <main>, <section>, <article>, <footer>
- ARIA labels on nav, skip-to-content link, proper heading hierarchy (single h1)
- Add .fade-in or .slide-up classes on sections for scroll animation triggers
${config.seoOptimized ? '- Include Open Graph meta tags from seo-meta.md' : ''}`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 6,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 5: Motion & Animation (optional)
  // -------------------------------------------------------------------------
  const phase5Tasks: Task[] = config.includeAnimations
    ? [
        {
          id: nanoid(),
          name: 'Implement animations',
          description: `Add CSS animations and JS-driven motion to all pages. Edit ${siteDir}/styles.css to add:

CSS animations:
- @keyframes fadeIn (opacity 0→1)
- @keyframes slideUp (translate Y 30px→0 + fade)
- @keyframes slideInLeft / slideInRight
- Hero text entrance with staggered children (50-100ms delay between elements)
- Smooth color transitions on hover for all buttons and links (300ms ease)
- Card hover: subtle lift (translateY -4px) + shadow increase
- Nav link underline grow from center on hover

Scroll animations via .fade-in and .slide-up classes:
- Initial state: opacity 0, transform translateY(30px)
- Active state: opacity 1, transform translateY(0)
- Trigger via Intersection Observer in script.js (already set up)

Loading:
- Page fade-in on load
- Skeleton shimmer for image placeholders if desired

CRITICAL: Wrap ALL animations in @media (prefers-reduced-motion: no-preference) { }
Use only transform and opacity for animations (never animate width/height/top/left).
Timing: 150-300ms for micro-interactions, 300-500ms for section animations.
Easing: ease-out for entrances, ease-in-out for hovers.`,
          assignedPod: podsByRole.get(PodRoleEnum.MOTION),
          status: 'pending',
          estimatedDuration: 5,
        },
        {
          id: nanoid(),
          name: 'Add page transitions',
          description: `Enhance script.js with smooth page transition effects:
- Add transition overlay element in each page
- On internal link click: fade-out current page (200ms), navigate, fade-in new page
- Stagger content section appearances on page load (each section delays 100ms more)
- Add scroll-triggered counter animations for any statistics/numbers
${config.includeContactForm ? '- Form submission: button loading state animation, success checkmark animation' : ''}
- Hamburger menu: animate icon to X, slide-in drawer with backdrop fade`,
          assignedPod: podsByRole.get(PodRoleEnum.MOTION),
          status: 'pending',
          estimatedDuration: 4,
        },
      ]
    : [];

  // -------------------------------------------------------------------------
  // Phase 6: Deliverable Bundle (README, receipt, deploy config)
  // -------------------------------------------------------------------------
  const phase6Tasks: Task[] = [];

  if (config.outputStructure.includeReadme) {
    phase6Tasks.push({
      id: nanoid(),
      name: 'Generate README.md',
      description: `Create ${outputRoot}/README.md with:

# Project Name
> Built with ALIN Website Sprint

## Overview
Brief description of the website: ${pageCount} pages, ${config.aesthetic} aesthetic.

## Pages
${config.pages.map(p => `- **${p.name}** (${p.path}) — ${p.sections.map(s => s.type).join(', ')}`).join('\n')}

## Quick Start
\`\`\`bash
# Option 1: Open directly
open ${out.siteFolder}/index.html

# Option 2: Serve locally
npx serve ${out.siteFolder}
# or
python3 -m http.server 8080 --directory ${out.siteFolder}
\`\`\`

## Project Structure
${buildOutputDescription(config, '.')}

## Deployment
${config.deployTarget ? `Configured for ${config.deployTarget}. See deploy.sh for one-click deployment.` : 'Static files — deploy to any web server, CDN, or hosting platform.'}

### Deploy to Netlify
\`\`\`bash
npx netlify deploy --dir=${out.siteFolder} --prod
\`\`\`

### Deploy to Vercel
\`\`\`bash
npx vercel ${out.siteFolder}
\`\`\`

### Deploy to GitHub Pages
Upload the contents of the \`${out.siteFolder}/\` directory.

## Customization
- Edit \`${out.siteFolder}/variables.css\` for colors, fonts, and spacing
- Edit \`${out.siteFolder}/styles.css\` for component styling
- Edit individual HTML files for content changes

## Browser Support
Chrome, Firefox, Safari, Edge (latest 2 versions). Mobile responsive.

## Accessibility
WCAG 2.1 AA compliant: proper color contrast, keyboard navigation, screen reader support, reduced motion fallbacks.

---
Generated by ALIN TBWO Engine`,
      assignedPod: podsByRole.get(PodRoleEnum.DEPLOYMENT),
      status: 'pending',
      estimatedDuration: 3,
    });
  }

  if (config.outputStructure.includeReceipt) {
    phase6Tasks.push({
      id: nanoid(),
      name: 'Generate receipt.json',
      description: `Create ${outputRoot}/receipt.json by reading all files created so far and building a JSON receipt:

{
  "project": "Website Sprint",
  "objective": "<TBWO objective>",
  "generatedAt": "<ISO timestamp>",
  "timeBudget": { "allocated": <minutes>, "used": <minutes>, "remaining": <minutes> },
  "quality": "${config.pages.length > 3 ? 'premium' : 'standard'}",
  "pages": [
    ${config.pages.map(p => `{ "name": "${p.name}", "path": "${p.path}", "sections": ${JSON.stringify(p.sections.map(s => s.type))} }`).join(',\n    ')}
  ],
  "files": [
    // List every file created with: { "path": "...", "type": "html|css|js|md|json", "lines": <count> }
  ],
  "decisions": [
    // Key design/technical decisions made during execution
  ],
  "checksRun": [
    // QA checks performed: { "check": "...", "result": "pass|fail|skip", "notes": "..." }
  ],
  "missing": [
    // Anything that couldn't be completed: { "item": "...", "reason": "..." }
  ],
  "navigation": {
    "style": "${config.navigation.style}",
    "pages": ${JSON.stringify(config.pages.filter(p => p.isInMainNav).map(p => p.name))}
  },
  "totalFiles": <count>,
  "totalLines": <count>
}

Use file_list and file_read to scan all created files, count lines, and populate the files array accurately. Do NOT guess — actually read and count.`,
      assignedPod: podsByRole.get(PodRoleEnum.DEPLOYMENT),
      status: 'pending',
      estimatedDuration: 3,
    });
  }

  if (config.outputStructure.includeDeployScript && config.deployTarget) {
    phase6Tasks.push({
      id: nanoid(),
      name: 'Generate deploy configuration',
      description: `Create deployment configuration for ${config.deployTarget}:

${config.deployTarget === 'netlify' ? `Create ${outputRoot}/netlify.toml:
[build]
  publish = "${out.siteFolder}"
  command = "echo 'Static site - no build needed'"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200` : ''}
${config.deployTarget === 'vercel' ? `Create ${outputRoot}/vercel.json:
{
  "outputDirectory": "${out.siteFolder}",
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}` : ''}
${config.deployTarget === 'cloudflare' ? `Create ${outputRoot}/wrangler.toml:
name = "website"
type = "webpack"
[site]
bucket = "./${out.siteFolder}"` : ''}

Also create ${outputRoot}/deploy.sh:
#!/bin/bash
set -e
echo "Deploying to ${config.deployTarget}..."
${config.deployTarget === 'netlify' ? `npx netlify deploy --dir=${out.siteFolder} --prod` : ''}
${config.deployTarget === 'vercel' ? `npx vercel ${out.siteFolder} --yes` : ''}
${config.deployTarget === 'cloudflare' ? `npx wrangler pages publish ${out.siteFolder}` : ''}
${config.deployTarget === 'github-pages' ? `# Copy files to docs/ folder for GitHub Pages\ncp -r ${out.siteFolder}/* docs/\ngit add docs/\ngit commit -m "Deploy website"\ngit push` : ''}
echo "Deploy complete!"`,
      assignedPod: podsByRole.get(PodRoleEnum.DEPLOYMENT),
      status: 'pending',
      estimatedDuration: 2,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 7: QA & Polish
  // -------------------------------------------------------------------------
  const phase7Tasks: Task[] = [
    {
      id: nanoid(),
      name: 'HTML validation & structure review',
      description: `Review ALL ${pageCount} HTML pages for correctness:
${config.pages.map(p => `- ${p.name} (${p.path})`).join('\n')}

Check each page for:
- Valid HTML5 structure (DOCTYPE, html lang, head, body)
- Proper heading hierarchy (single h1, no skipped levels)
- Semantic elements used correctly (header, nav, main, section, article, footer)
- All links work (inter-page links use correct relative paths)
- All CSS/JS files are linked correctly
- Images have alt text
- Forms have proper labels and aria attributes
- Skip-to-content link present
- Meta viewport tag present
- Consistent navigation across ALL pages
- No broken or missing closing tags

Report issues and fix them using edit_file.`,
      assignedPod: podsByRole.get(PodRoleEnum.QA),
      status: 'pending',
      estimatedDuration: 4,
    },
    {
      id: nanoid(),
      name: 'Cross-page navigation verification',
      description: `Verify the navigation system works correctly across all pages:
- Read every HTML page and check that nav links point to correct files
- Verify active page highlighting works (correct page has active class)
- Check footer links are consistent across all pages
- Verify all inter-page links in content sections are valid
- Check that logo/brand link returns to index.html
- Verify mobile menu markup is consistent across pages

Navigation pages:
${navDesc}

Fix any broken links or inconsistencies using edit_file.`,
      assignedPod: podsByRole.get(PodRoleEnum.QA),
      status: 'pending',
      estimatedDuration: 3,
    },
    {
      id: nanoid(),
      name: 'Responsive & accessibility audit',
      description: `Audit all pages for responsive design and accessibility:

Responsive:
- Verify CSS has breakpoints at 320px, 768px, 1024px, 1440px
- Check navigation collapses to hamburger on mobile
- Verify grids stack vertically on narrow screens
- Check font sizes are readable at all widths (use clamp() where appropriate)
- Images are responsive (max-width: 100%, height: auto)

Accessibility:
- Color contrast: all text/background combos meet WCAG AA (4.5:1 body, 3:1 large)
- Keyboard navigation: Tab through all interactive elements, Enter activates buttons
- ARIA: nav has aria-label, hamburger has aria-expanded, form inputs have labels
- Focus styles: visible focus indicator on all interactive elements
- prefers-reduced-motion: all animations wrapped in media query check
- Screen reader: content makes sense when read linearly

Fix any issues found using edit_file.`,
      assignedPod: podsByRole.get(PodRoleEnum.QA),
      status: 'pending',
      estimatedDuration: 4,
    },
    {
      id: nanoid(),
      name: 'Final polish & consistency check',
      description: `Final review pass across all files:
- CSS: no unused selectors, consistent naming (BEM), all custom properties used
- JS: no console.log, proper error handling, all selectors valid
- Content: no lorem ipsum, no TODO/FIXME, no placeholder text
- Spacing and layout: consistent padding/margins, proper whitespace
- Cross-page consistency: same header, footer, and styles on every page
- File organization: everything in correct folders per output structure

Output structure should be:
${outputDesc}

Verify all files exist in the correct locations. Report a final summary of the site quality.`,
      assignedPod: podsByRole.get(PodRoleEnum.QA),
      status: 'pending',
      estimatedDuration: 3,
    },
  ];

  // -------------------------------------------------------------------------
  // BUILD PHASES
  // -------------------------------------------------------------------------
  const phases: Phase[] = [
    {
      id: nanoid(),
      name: 'Design System',
      description: 'Create visual design foundation: tokens, component specs',
      order: 0,
      estimatedDuration: phase1Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: phase1Tasks,
      assignedPods: [podsByRole.get(PodRoleEnum.DESIGN)!],
      status: 'pending',
      progress: 0,
    },
    {
      id: nanoid(),
      name: 'Content Creation',
      description: `Write content for all ${pageCount} pages`,
      order: 1,
      estimatedDuration: phase2Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
      dependsOn: [],
      tasks: phase2Tasks,
      assignedPods: [podsByRole.get(PodRoleEnum.COPY)!],
      status: 'pending',
      progress: 0,
    },
  ];

  // Phase 3: Shared Components (depends on Design)
  const phase3 = {
    id: nanoid(),
    name: 'Shared Components & Styles',
    description: 'CSS, JavaScript, navigation, and footer',
    order: 2,
    estimatedDuration: phase3Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
    dependsOn: [phases[0]!.id], // depends on Design System
    tasks: phase3Tasks,
    assignedPods: [podsByRole.get(PodRoleEnum.FRONTEND)!],
    status: 'pending' as const,
    progress: 0,
  };
  phases.push(phase3);

  // Phase 4: Page Development (depends on Design + Content + Shared Components)
  const phase4 = {
    id: nanoid(),
    name: 'Page Development',
    description: `Build ${pageCount} HTML pages with full content and navigation`,
    order: 3,
    estimatedDuration: phase4Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
    dependsOn: [phases[0]!.id, phases[1]!.id, phase3.id],
    tasks: phase4Tasks,
    assignedPods: [podsByRole.get(PodRoleEnum.FRONTEND)!],
    status: 'pending' as const,
    progress: 0,
  };
  phases.push(phase4);

  // Phase 5: Motion (optional, depends on Page Development)
  if (config.includeAnimations && phase5Tasks.length > 0) {
    phases.push({
      id: nanoid(),
      name: 'Motion & Animation',
      description: 'Animations, transitions, and micro-interactions',
      order: 4,
      estimatedDuration: phase5Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
      dependsOn: [phase4.id],
      tasks: phase5Tasks,
      assignedPods: [podsByRole.get(PodRoleEnum.MOTION)!],
      status: 'pending',
      progress: 0,
    });
  }

  // Phase 6: Deliverable Bundle (depends on Page Development + optional Motion)
  if (phase6Tasks.length > 0) {
    const bundleDeps = [phase4.id];
    const motionPhase = phases.find(p => p.name === 'Motion & Animation');
    if (motionPhase) bundleDeps.push(motionPhase.id);

    phases.push({
      id: nanoid(),
      name: 'Deliverable Bundle',
      description: 'README, receipt.json, and deployment configuration',
      order: phases.length,
      estimatedDuration: phase6Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
      dependsOn: bundleDeps,
      tasks: phase6Tasks,
      assignedPods: [podsByRole.get(PodRoleEnum.DEPLOYMENT)!],
      status: 'pending',
      progress: 0,
    });
  }

  // Phase 7: QA (depends on ALL previous phases)
  phases.push({
    id: nanoid(),
    name: 'QA & Polish',
    description: 'Validation, accessibility, responsive testing, and final polish',
    order: phases.length,
    estimatedDuration: phase7Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
    dependsOn: phases.map(p => p.id), // depends on everything
    tasks: phase7Tasks,
    assignedPods: [podsByRole.get(PodRoleEnum.QA)!],
    status: 'pending',
    progress: 0,
  });

  const totalDuration = phases.reduce((sum, p) => sum + p.estimatedDuration, 0);

  // Build pod allocation strategy
  const podStrategy: PodAllocationStrategy = {
    mode: 'hybrid',
    maxConcurrent: 3,
    priorityOrder: [
      PodRoleEnum.ORCHESTRATOR,
      PodRoleEnum.DESIGN,
      PodRoleEnum.COPY,
      PodRoleEnum.FRONTEND,
      PodRoleEnum.MOTION,
      PodRoleEnum.DEPLOYMENT,
      PodRoleEnum.QA,
    ],
    dependencies: new Map<PodRole, PodRole[]>([
      [PodRoleEnum.FRONTEND, [PodRoleEnum.DESIGN, PodRoleEnum.COPY]],
      [PodRoleEnum.MOTION, [PodRoleEnum.FRONTEND]],
      [PodRoleEnum.DEPLOYMENT, [PodRoleEnum.FRONTEND]],
      [PodRoleEnum.QA, [PodRoleEnum.FRONTEND, PodRoleEnum.MOTION, PodRoleEnum.DEPLOYMENT]],
    ]),
  };

  // Build risks
  const risks: Risk[] = [
    {
      description: 'Design iterations may exceed time budget',
      severity: 'medium',
      mitigation: 'Use pre-defined design system as starting point',
    },
    {
      description: 'Content may need revision after integration',
      severity: 'low',
      mitigation: 'Draft content in parallel with design, refine during QA',
    },
    {
      description: 'Cross-page navigation inconsistencies',
      severity: 'medium',
      mitigation: 'Build shared nav component first, copy to all pages, verify in QA',
    },
    {
      description: `${pageCount} pages may exceed time budget`,
      severity: pageCount > 5 ? 'high' : 'low',
      mitigation: 'Prioritize home page, parallelize remaining pages if possible',
    },
  ];

  // Build deliverables
  const deliverables: Deliverable[] = [
    {
      name: 'Website HTML pages',
      description: `${pageCount} responsive HTML pages with shared navigation`,
      type: 'file',
      path: siteDir,
      required: true,
    },
    {
      name: 'CSS stylesheet',
      description: 'Design system variables + main styles + responsive + animations',
      type: 'file',
      path: `${siteDir}/styles.css`,
      required: true,
    },
    {
      name: 'JavaScript',
      description: 'Navigation, scroll animations, form validation, interactivity',
      type: 'file',
      path: `${siteDir}/script.js`,
      required: true,
    },
    {
      name: 'Assets folder',
      description: 'Images, icons, and fonts directory structure',
      type: 'file',
      path: assetsDir,
      required: true,
    },
  ];

  if (config.outputStructure.includeReadme) {
    deliverables.push({
      name: 'README.md',
      description: 'Project overview, setup instructions, deployment guide',
      type: 'report',
      path: `${outputRoot}/README.md`,
      required: true,
    });
  }

  if (config.outputStructure.includeReceipt) {
    deliverables.push({
      name: 'receipt.json',
      description: 'Build receipt with time budget, decisions, files, checks, and gaps',
      type: 'report',
      path: `${outputRoot}/receipt.json`,
      required: true,
    });
  }

  if (config.outputStructure.includeDeployScript && config.deployTarget) {
    deliverables.push({
      name: 'Deploy configuration',
      description: `deploy.sh + ${config.deployTarget} config`,
      type: 'deployment',
      path: `${outputRoot}/deploy.sh`,
      required: false,
    });
  }

  return {
    id: nanoid(),
    tbwoId,
    summary: `Website Sprint: ${pageCount} pages (${config.pages.map(p => p.name).join(', ')}), ${config.aesthetic} aesthetic, ${config.navigation.style} nav, ${config.framework || 'static'} — output to ${outputRoot}/`,
    estimatedDuration: totalDuration,
    confidence: 0.85,
    phases,
    podStrategy,
    risks,
    assumptions: [
      'Client approves generated design system or provides brand guidelines',
      'No custom backend logic needed (static site)',
      'Image placeholders acceptable (actual images not generated)',
      'Static hosting sufficient for deployment',
    ],
    deliverables,
    requiresApproval: true,
  };
}

// ============================================================================
// MAIN FACTORY
// ============================================================================

export function createWebsiteSprintTBWO(
  objective: string,
  config: Partial<WebsiteSprintConfig> = {},
  options: {
    timeBudget?: number;
    qualityTarget?: QualityTarget;
    authorityLevel?: AuthorityLevel;
    workingDirectory?: string;
  } = {}
): TBWO {
  const fullConfig: WebsiteSprintConfig = {
    ...DEFAULT_WEBSITE_SPRINT_CONFIG,
    ...config,
    navigation: { ...DEFAULT_WEBSITE_SPRINT_CONFIG.navigation, ...config.navigation },
    outputStructure: { ...DEFAULT_WEBSITE_SPRINT_CONFIG.outputStructure, ...config.outputStructure },
  };

  // Update output root based on objective
  const slug = objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  fullConfig.outputStructure.rootFolder = `output/tbwo/${slug}`;

  const tbwoId = nanoid();
  const pods = createWebsiteSprintPods(tbwoId);
  const plan = createWebsiteSprintPlan(tbwoId, fullConfig, pods, objective);

  const timeBudgetMinutes = options.timeBudget || 60;
  const timeBudget: TimeBudget = {
    total: timeBudgetMinutes,
    elapsed: 0,
    remaining: timeBudgetMinutes,
    phases: new Map(),
    warningThreshold: 80,
    criticalThreshold: 95,
  };

  // Allocate time per phase proportionally
  for (const phase of plan.phases) {
    timeBudget.phases.set(phase.id, {
      name: phase.name,
      allocated: Math.round(
        timeBudgetMinutes * (phase.estimatedDuration / plan.estimatedDuration)
      ),
      used: 0,
      status: 'pending',
    });
  }

  const scope: TBWOScope = {
    allowedOperations: [
      Operation.READ_FILE,
      Operation.WRITE_FILE,
      Operation.CREATE_DIRECTORY,
      Operation.EXECUTE_CODE,
    ],
    workingDirectory:
      options.workingDirectory || '/tmp/alin-tbwo/' + tbwoId,
    allowedPaths: [
      options.workingDirectory || '/tmp/alin-tbwo/' + tbwoId,
    ],
    forbiddenPaths: [
      '/etc',
      '/usr',
      '/var',
      'C:\\Windows',
      'C:\\Program Files',
    ],
    allowNetworkAccess: false,
    allowedTools: [
      'file_write',
      'file_read',
      'file_list',
      'execute_code',
      'code_search',
      'memory_recall',
      'memory_store',
      'scan_directory',
      'web_search',
      'edit_file',
    ],
    forbiddenTools: ['run_command', 'git'],
    maxFileSize: 1024 * 1024, // 1MB
    maxTotalStorage: 50 * 1024 * 1024, // 50MB
    maxConcurrentPods: 7,
    allowedAPIs: [],
    canDeploy: false,
    canModifyDatabase: false,
  };

  const tbwo: TBWO = {
    id: tbwoId,
    type: TBWOType.WEBSITE_SPRINT,
    status: TBWOStatus.AWAITING_APPROVAL,
    objective,
    timeBudget,
    qualityTarget: options.qualityTarget || QualityTarget.STANDARD,
    scope,
    plan,
    progress: 0,
    pods,
    activePods: new Set(),
    artifacts: [],
    checkpoints: [],
    authorityLevel: options.authorityLevel || AuthorityLevel.SUPERVISED,
    permissionGates: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userId: 'user',
    estimatedCost: plan.estimatedDuration * 0.05,
  };

  return tbwo;
}
