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
} from '../../types/tbwo';
import {
  TBWOType,
  TBWOStatus,
  QualityTarget,
  PodRole as PodRoleEnum,
  PodStatus,
  AuthorityLevel,
  Operation,
} from '../../types/tbwo';
import type { SiteBrief } from '../../api/dbService';
import { planPods, specsToAgentPods } from './podPlanner';

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
    rootFolder: '',
    siteFolder: '',
    assetsFolder: 'assets',
    cssFile: 'styles.css',
    includeReadme: true,
    includeReceipt: true,
    includeDeployScript: false,
  },
  aesthetic: 'modern',
  framework: 'static',
  motionIntensity: 'standard',
  renderMode: 'standard',
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

/** Build the full list of nav pages for prompt context */
function buildNavDescription(config: WebsiteSprintConfig): string {
  const navPages = config.pages
    .filter(p => p.isInMainNav)
    .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  if (navPages.length === 0) return 'No main navigation pages defined.';
  return navPages.map(p => `- "${p.name}" → ${pageFilename(p.path)}`).join('\n');
}

/** Normalize a page path to a simple filename like "about.html" */
function pageFilename(pagePath: string): string {
  if (pagePath === '/' || pagePath === '/index.html') return 'index.html';
  const name = pagePath.startsWith('/') ? pagePath.slice(1) : pagePath;
  return name.endsWith('.html') ? name : name.replace(/\/?$/, '.html').replace('.html.html', '.html');
}

/** Map section type to descriptive prompt text */
function sectionDescription(type: string, heading?: string): string {
  const headingNote = heading ? ` (heading: "${heading}")` : '';
  switch (type) {
    case 'hero': return `Hero${headingNote}: full-width banner with headline, subheadline, CTA button, background gradient or image`;
    case 'features': return `Features${headingNote}: responsive grid of feature cards (icon + title + description), minimum 3 cards`;
    case 'about': return `About${headingNote}: two-column layout (text + image placeholder) or single-column rich text`;
    case 'testimonials': return `Testimonials${headingNote}: grid of quote cards with avatar placeholder, name, title, star rating`;
    case 'cta': return `CTA${headingNote}: full-width section with contrasting background, headline, subtext, prominent button`;
    case 'gallery': return `Gallery${headingNote}: responsive image grid with placeholder images and descriptive alt text`;
    case 'pricing': return `Pricing${headingNote}: 2-4 tier cards with name, price, feature list, CTA, "popular" badge option`;
    case 'faq': return `FAQ${headingNote}: accordion with <details>/<summary> elements, smooth open/close`;
    case 'team': return `Team${headingNote}: grid of member cards with photo placeholder, name, role, short bio`;
    case 'blog': return `Blog${headingNote}: grid of article preview cards with image, date, title, excerpt, read-more link`;
    case 'footer': return `Footer${headingNote}: multi-column links, social icons, copyright, semantic <footer>`;
    case 'custom': return `Custom section${headingNote}`;
    default: return `${type} section${headingNote}`;
  }
}

// ============================================================================
// EXPECTED FILES MANIFEST — Used for README.md generation and validation
// ============================================================================

export function getExpectedFiles(config: WebsiteSprintConfig): Array<{ path: string; description: string }> {
  const files: Array<{ path: string; description: string }> = [];

  // Core CSS
  files.push({ path: 'styles.css', description: 'Main stylesheet' });
  files.push({ path: 'variables.css', description: 'CSS custom properties / design tokens' });

  // Pages from config
  for (const page of config.pages) {
    const filename = pageFilename(page.path);
    files.push({ path: filename, description: `${page.name} page` });
  }

  // Scripts
  files.push({ path: 'script.js', description: 'Main interactivity script' });

  // Animations
  if (config.includeAnimations) {
    files.push({ path: 'animations.css', description: 'Animation keyframes and transitions' });
  }

  // 3D
  if (config.scene3DEnabled || config.renderMode === 'immersive' || config.renderMode === 'enhanced') {
    files.push({ path: 'scene-loader.js', description: '3D scene initialization and rendering' });
  }

  // Blog
  if (config.includeBlog) {
    files.push({ path: 'blog.html', description: 'Blog listing page' });
  }

  // Contact form
  if (config.includeContactForm) {
    files.push({ path: 'form-handler.js', description: 'Contact form validation and handling' });
  }

  // README
  files.push({ path: 'README.md', description: 'Project specification and file manifest' });

  return files;
}

// ============================================================================
// POD FACTORY — 3 pods: Frontend, QA, Delivery
// ============================================================================

export function createWebsiteSprintPods(
  tbwoId: string,
  brief?: SiteBrief,
  config?: WebsiteSprintConfig,
): Map<string, AgentPod> {
  // If brief is provided, use dynamic pod planning
  if (brief && config) {
    const specs = planPods(brief, config);
    return specsToAgentPods(specs, tbwoId);
  }

  // Fallback: static 3-pod layout
  const pods = new Map<string, AgentPod>();

  const podConfigs: Array<{ role: PodRole; name: string; tools: string[] }> = [
    {
      role: PodRoleEnum.FRONTEND,
      name: 'Frontend Pod',
      tools: ['file_write', 'file_read', 'execute_code', 'file_list', 'edit_file', 'scan_directory', 'memory_store', 'memory_recall', 'request_context_snippet', 'request_pause_and_ask'],
    },
    {
      role: PodRoleEnum.QA,
      name: 'QA Pod',
      tools: ['file_read', 'execute_code', 'file_list', 'scan_directory', 'edit_file', 'request_context_snippet', 'request_pause_and_ask'],
    },
    {
      role: PodRoleEnum.DEPLOYMENT,
      name: 'Delivery Pod',
      tools: ['file_write', 'file_read', 'file_list', 'scan_directory'],
    },
  ];

  for (const podCfg of podConfigs) {
    const id = nanoid();
    const pod: AgentPod = {
      id,
      role: podCfg.role,
      name: podCfg.name,
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
      toolWhitelist: podCfg.tools,
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
// PLAN FACTORY — 3 phases: Design Foundation → Build Pages → QA + Delivery
// ============================================================================

export function createWebsiteSprintPlan(
  tbwoId: string,
  config: WebsiteSprintConfig,
  pods: Map<string, AgentPod>,
  objective?: string,
  brief?: SiteBrief,
): ExecutionPlan {
  const podsByRole = new Map<PodRole, string>();
  pods.forEach((pod) => {
    podsByRole.set(pod.role, pod.id);
  });

  const navDesc = buildNavDescription(config);
  const pageCount = config.pages.length;
  const navPages = config.pages
    .filter(p => p.isInMainNav)
    .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));
  const navLinksStr = navPages.map(n => `"${n.name}" → ${pageFilename(n.path)}`).join(', ');

  // -------------------------------------------------------------------------
  // Phase 1: Design Foundation (PageSpec + design tokens + styles + script.js)
  // -------------------------------------------------------------------------

  // Reference site analysis task (only when referenceUrls provided)
  const referenceUrls = (brief as any)?.referenceUrls as string[] | undefined;
  const hasReferences = referenceUrls && referenceUrls.length > 0;

  const pageSpecId = nanoid();
  const referenceAnalysisId = nanoid();

  const phase1Tasks: Task[] = [];

  // Optional: Analyze reference sites
  if (hasReferences) {
    phase1Tasks.push({
      id: referenceAnalysisId,
      name: 'Analyze reference sites',
      description: `Analyze ${referenceUrls!.length} reference site(s) for design intelligence.

URLs to analyze:
${referenceUrls!.map((url, i) => `${i + 1}. ${url}`).join('\n')}

For each URL:
1. Use web_fetch to retrieve the page content
2. Extract: color palette, typography choices, spacing patterns, dark/light theme
3. Identify section structure: what sections appear, their order, layout patterns
4. Analyze tone: formal/casual, headline styles, CTA language
5. Note component patterns: card layouts, hero styles, pricing table designs

Output: ONE file — referenceAnalysis.json with structure:
{
  "sites": [
    {
      "url": "<url>",
      "styleCues": { "colors": [...], "typography": "...", "spacing": "..." },
      "sections": ["hero-centered", "feature-grid-3col", ...],
      "tone": "...",
      "components": ["glass-morphism cards", ...]
    }
  ],
  "synthesis": "Combined design direction based on all reference sites"
}`,
      assignedPod: podsByRole.get(PodRoleEnum.DESIGN) || podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 3,
    });
  }

  // PageSpec generation — structured page specification
  phase1Tasks.push({
    id: pageSpecId,
    name: 'Generate PageSpec',
    description: `Generate a structured page specification that drives all page creation.

Product: ${brief?.productName || config.navigation.logoText || 'Website'}
Pages: ${config.pages.map(p => `${p.name} (${pageFilename(p.path)})`).join(', ')}
Objective: ${objective || 'Build a professional website'}
${brief?.toneStyle ? `Tone: ${brief.toneStyle}` : ''}
${brief?.targetAudience ? `Target Audience: ${brief.targetAudience}` : ''}
${brief?.features?.length ? `Features: ${brief.features.join(', ')}` : ''}
${brief?.pricing?.tiers?.length ? `Pricing Tiers: ${brief.pricing.tiers.map(t => `${t.name} $${t.priceMonthly}/mo`).join(', ')}` : ''}
${hasReferences ? '\nIMPORTANT: Read referenceAnalysis.json and use it to inform section structure, style, and tone.' : ''}

Output THREE files:

FILE 1: pageSpec.json
{
  "version": "1.0",
  "productName": "<exact product name>",
  "routes": [
    {
      "route": "/",
      "fileName": "index.html",
      "title": "Home",
      "goal": "Convert visitors to sign up",
      "sections": [
        { "type": "hero", "headline": "...", "contentBrief": "What this section communicates" },
        { "type": "features", "headline": "...", "contentBrief": "..." },
        ...
      ],
      "cta": { "label": "Get Started", "href": "/pricing.html" },
      "seo": { "title": "...", "description": "..." }
    }
  ],
  "globalNav": { "style": "${config.navigation.style}", "logoText": "${config.navigation.logoText || 'Site'}", "items": [${navPages.map(p => `{"label":"${p.name}","href":"${pageFilename(p.path)}"}`).join(',')}] },
  "globalFooter": { "columns": [], "copyright": "© ${new Date().getFullYear()} ${brief?.productName || 'Company'}" },
  "designTokensRef": "variables.css"
}

FILE 2: copy.json — Section-level copy keyed by route+section:
{
  "/": {
    "hero": { "headline": "...", "subheadline": "...", "ctaText": "..." },
    "features": { "headline": "...", "items": [...] }
  },
  "/about": { ... }
}

FILE 3: routes_manifest.json — Simple route-to-file mapping for validation:
{ "/": "index.html", "/about": "about.html", ... }

RULES:
- Every page in the site config MUST appear in pageSpec.json
- Every section from the page config MUST appear
- Do NOT add pages or sections not in the config
- Use the EXACT product name from the brief
- NEVER fabricate statistics or claims

COPY RULES:
- Use EXACT product name from brief: "${brief?.productName}"
- coreProblem: "${brief?.coreProblem || ''}" — hero headline should address this
- differentiators: ${JSON.stringify(brief?.differentiators || [])} — features section must highlight these
- NEVER fabricate statistics or claims not in the brief
- Mark any assumed content with [ASSUMED] tag for QA to flag`,
    assignedPod: podsByRole.get(PodRoleEnum.DESIGN) || podsByRole.get(PodRoleEnum.FRONTEND),
    status: 'pending',
    estimatedDuration: 4,
    dependsOn: hasReferences ? [referenceAnalysisId] : undefined,
  });

  // Design tokens task
  phase1Tasks.push({
    id: nanoid(),
    name: 'Create design tokens',
      description: `Create variables.css with CSS custom properties:
- Color palette: primary (with shades 50-900), secondary, accent, neutral scale, background, surface, text colors
- Typography: heading font, body font, mono font, type scale (h1-h6, body, small, caption), weights, line-heights
- Spacing: 4px-based scale (xs=4px through 4xl=64px)
- Borders: radius scale (sm, md, lg, full), border widths
- Shadows: sm, md, lg, xl
- Breakpoints as comments (used in styles.css media queries): 320px, 768px, 1024px, 1440px
- Z-index scale: base, dropdown, sticky, modal, toast
- Transitions: duration-fast (150ms), duration-normal (300ms), duration-slow (500ms)
${config.colorScheme ? `\nUse these colors: primary=${config.colorScheme.primary}, secondary=${config.colorScheme.secondary}, background=${config.colorScheme.background}, text=${config.colorScheme.text}${config.colorScheme.accent ? `, accent=${config.colorScheme.accent}` : ''}` : ''}
${config.typography ? `\nTypography: ${config.typography.headingFont ? 'heading font: ' + config.typography.headingFont : ''} ${config.typography.bodyFont ? 'body font: ' + config.typography.bodyFont : ''} scale: ${config.typography.scale || 'medium'}` : ''}

If the objective doesn't specify colors or fonts, use a professional default palette
appropriate for the "${config.aesthetic}" style. Do NOT ask — design tokens are your expertise.

Output: ONE file — variables.css`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 3,
    },
    {
      id: nanoid(),
      name: 'Create styles and script',
      description: `Create TWO files: styles.css and script.js

FILE 1: styles.css
- Use CSS custom properties from variables.css (reference via var(--...))
- CSS reset/normalize base styles
- .container, .section, .grid utility classes
- Navigation: ${config.navigation.sticky ? 'sticky' : 'static'}, ${config.navigation.style} layout, mobile hamburger drawer
- Hero section styles: full-width, gradient/image bg, centered text
- Features grid: responsive card layout (3-col desktop, 2-col tablet, 1-col mobile)
- CTA section: contrasting bg, centered content
- Footer: multi-column grid, social icons
- Team cards, pricing cards, FAQ accordion, contact form styles
- Responsive: mobile-first, breakpoints at 768px and 1024px
${config.includeAnimations ? `- Animations: @keyframes fadeIn, slideUp; .fade-in, .slide-up utility classes
- Card hover: subtle lift (translateY -4px) + shadow increase
- Nav link underline grow from center on hover
- @media (prefers-reduced-motion: reduce) { } wrapping all animations` : ''}
- Print styles (@media print)

FILE 2: script.js
- DOMContentLoaded wrapper
- Hamburger menu toggle with aria-expanded
- Smooth scroll for anchor links
- Active nav link highlighting (checks current filename against href)
- Scroll-to-top button (appears after 300px scroll)
${config.includeAnimations ? '- Intersection Observer for .fade-in/.slide-up elements' : ''}
${config.includeContactForm ? '- Contact form validation (name, email required, email format check, visual error states)' : ''}
${config.navigation.sticky ? '- Header shrink/shadow on scroll' : ''}

Output: TWO files — styles.css and script.js`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 5,
    },
  );

  // Motion system task (if animations enabled)
  if (config.includeAnimations) {
    const motionIntensity = config.motionIntensity || 'standard';
    phase1Tasks.push({
      id: nanoid(),
      name: 'Create motion system',
      description: `Create TWO files: motion-tokens.css and motion.js

FILE 1: motion-tokens.css — CSS custom properties for the "${motionIntensity}" motion intensity level.
Include all motion tokens: timing (instant/fast/normal/slow/dramatic), easing curves (default/enter/exit/spring/bounce), distances (sm/md/lg/xl), stagger delays, scale values, and blur values.
Include a @media (prefers-reduced-motion: reduce) block that zeroes all durations and distances.

FILE 2: motion.js — Self-contained IIFE with:
1. Reduced-motion check at startup (skip all JS animations if prefers-reduced-motion)
2. ScrollReveal via IntersectionObserver — observes [data-motion] elements, adds .motion-visible class
   - Supports data-motion-delay, data-motion-stagger (auto-staggers children)
   - Trigger once by default
3. Micro-interactions via event delegation:
   ${motionIntensity === 'premium' ? '- Ripple effect on button clicks\n   - 3D tilt on [data-motion-tilt] elements' : motionIntensity === 'standard' ? '- Ripple effect on button clicks' : ''}
4. Hero animation: find [data-hero-headline], [data-hero-subheadline], [data-hero-cta] and animate entrance
${motionIntensity === 'premium' ? '5. Parallax: requestAnimationFrame loop for [data-parallax] elements\n6. Scroll progress bar, animated counters [data-counter], smooth anchor scroll' : motionIntensity === 'standard' ? '5. Scroll progress bar, animated counters [data-counter]' : ''}

RULES:
- ZERO external animation libraries
- All animations use transform + opacity ONLY (GPU-composited)
- Respect prefers-reduced-motion at ALL levels
- IntersectionObserver for scroll-triggered animations
- Event delegation for micro-interactions
- requestAnimationFrame for parallax (if enabled)
- Total file size target: <15KB combined

Output: TWO files — motion-tokens.css and motion.js`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 5,
    });
  }

  // 3D scene system task (if enhanced/immersive render mode)
  if (config.renderMode && config.renderMode !== 'standard') {
    phase1Tasks.push({
      id: nanoid(),
      name: 'Create 3D scene system',
      description: `Create THREE files for the 3D scene system (render mode: ${config.renderMode}):

FILE 1: sceneSpec.json — Scene specification describing camera, lighting, material, animations, environment effects, and performance budget. Must follow the SceneSpec schema with version "1.0".

FILE 2: scene-loader.js — Self-contained IIFE that:
1. Detects WebGL support → shows .scene-fallback if unsupported
2. Checks prefers-reduced-motion → shows static frame only if active
3. Detects mobile → applies simplified or disabled mode per performance budget
4. Loads Three.js from CDN: https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js
5. Creates scene, camera, renderer, lighting from spec presets
6. Creates geometry/material from spec presets
7. Sets up animations (rotation, float, scroll-driven, hover interactions)
8. Uses IntersectionObserver to pause rendering when off-screen
9. Uses requestAnimationFrame with FPS cap for animation loop
10. Uses ResizeObserver for responsive sizing
11. Cleans up on page unload

FILE 3: scene.css — Container styles (.scene-container), fallback styles (.scene-fallback), reduced-motion media query, and responsive sizing.

RULES:
- Three.js loaded ONLY from CDN — never inline bundled
- All scene code in a single IIFE — no module imports
- WebGL detection before any Three.js usage
- IntersectionObserver to pause when off-screen
- requestAnimationFrame, NEVER setInterval for animation
- Respect prefers-reduced-motion at ALL levels
- .scene-fallback visible when WebGL unavailable
- aria-label on scene container for accessibility
- Total file size target: scene-loader.js < 20KB, scene.css < 2KB

Output: THREE files — sceneSpec.json, scene-loader.js, scene.css`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 5,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 2: Build Pages (1 task per page, each produces a complete HTML file)
  // -------------------------------------------------------------------------
  const phase2Tasks: Task[] = [];

  for (let pageIdx = 0; pageIdx < config.pages.length; pageIdx++) {
    const page = config.pages[pageIdx]!;
    const fileName = pageFilename(page.path);
    const sections = page.sections.map(s => sectionDescription(s.type, s.heading)).join('\n    - ');

    // Inject user-uploaded media for this page
    const pageMediaItems = config.pageMedia?.filter(m => m.pageIndex === pageIdx) || [];
    const mediaSection = pageMediaItems.length > 0
      ? '\n\nUSER-UPLOADED MEDIA (use these instead of searching for images):\n' +
        pageMediaItems.map(m =>
          `- ${m.type.toUpperCase()} at ${m.placement}: ${m.url || '[no URL yet]'}${m.altText ? ` (alt: "${m.altText}")` : ''}${m.placementHint ? ` — ${m.placementHint}` : ''}`
        ).join('\n')
      : '';

    phase2Tasks.push({
      id: nanoid(),
      name: `Build page: ${page.name}`,
      description: `Create ${fileName} — a complete HTML5 page.${mediaSection}

## PageSpec Reference
Read pageSpec.json to get the exact specification for this page (sections, headlines, CTAs, SEO metadata).
Read copy.json to get the finalized copy for each section on this page.
Build the page to match the PageSpec EXACTLY. Do not add or remove sections.

<!DOCTYPE html> with lang="en", charset UTF-8, viewport meta, title "${page.name}${config.navigation.logoText ? ' | ' + config.navigation.logoText : ''}", meta description: "${page.metaDescription || ''}".
Link to variables.css, styles.css in <head>. script.js at end of <body>.

NAVIGATION (copy exactly on every page):
<nav> with logo "${config.navigation.logoText || 'Site'}", links: ${navLinksStr}
Active page highlight on "${page.name}" link.
Mobile hamburger button with aria-expanded="false".
Skip-to-content link before nav.

SECTIONS FOR THIS PAGE:
    - ${sections}

FOOTER (copy exactly on every page):
Multi-column footer with site links${config.navigation.footerLinks.length > 0 ? ': ' + config.navigation.footerLinks.map(l => `"${l.label}"`).join(', ') : ''}, copyright notice.
${config.navigation.socialLinks?.length ? 'Social links: ' + config.navigation.socialLinks.map(s => s.platform).join(', ') : ''}

CONTENT RULES:
- Write REAL, meaningful content — not lorem ipsum
- Use the EXACT product name from the Site Brief. NEVER rename or substitute it.
- If you don't know specific business details (pricing, team members, phone number, address), use request_pause_and_ask to ask the user
- Headlines: 8 words max, clear value proposition
- Body: short paragraphs (2-3 sentences), scannable
- CTAs: action verbs ("Get Started", "Learn More", "Contact Us")
- NEVER fabricate statistics, user counts, revenue, or percentages. Use honest alternatives:
  "Built for independent creatives", "Designed to replace 5+ tools", "A calmer way to manage clients"
- NEVER add testimonials unless the user provided them. Instead use an "Early Access" or "Built with [audience]" section.
- NEVER claim security certifications (SOC 2, HIPAA, etc.) unless explicitly provided in the Site Brief.
- For the About page, default to first-person founder voice: "I built this because I was tired of juggling X tools..."
- Mark any content you're unsure about with [PLACEHOLDER] — these block deployment

TECHNICAL:
- Semantic HTML: <header>, <nav>, <main> with id="main-content", <section>, <article>, <footer>
- Single <h1> per page, proper heading hierarchy (no skipped levels)
- All images use descriptive alt text
- ARIA labels on nav, forms, hamburger button
${config.includeAnimations ? `- Add data-motion attributes to content sections for scroll animation:
  Hero: data-motion="fade-up" data-motion-delay="0"
  Features: data-motion="fade-up" with data-motion-stagger on the parent grid
  Pricing: data-motion="zoom-in" with data-motion-stagger
  CTA: data-motion="fade-up"
  Testimonials: data-motion="fade-in" with data-motion-stagger
  Hero headline: add data-hero-headline attribute
  Hero subheadline: add data-hero-subheadline attribute
  Hero CTA button: add data-hero-cta attribute
- Link to motion-tokens.css in <head> (after styles.css)
- Link to motion.js at end of <body> (after script.js)
- NEVER add CSS transitions to elements that have data-motion — the motion system handles it` : ''}
${(config.renderMode && config.renderMode !== 'standard') || config.scene3DEnabled ? `- 3D SCENE INTEGRATION:
  Add the scene container in the hero section, positioned BEHIND text via z-index
  Link scene.css in <head> (after motion-tokens.css)
  Link scene-loader.js at end of <body> (after motion.js)
  Include .scene-fallback div inside the scene container
  Add aria-label="3D interactive scene" to scene container
  Add <noscript> fallback describing the 3D content` : ''}
${config.seoOptimized ? '- Include Open Graph meta tags (og:title, og:description, og:type)' : ''}

Output: ONE file — ${fileName}`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 5,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 2b: Content tasks (dynamic — only if pods exist)
  // -------------------------------------------------------------------------
  const phase2bTasks: Task[] = [];

  // If Copywriter pod exists, add copy-review tasks
  const copyPodId = podsByRole.get(PodRoleEnum.COPY);
  if (copyPodId) {
    phase2bTasks.push({
      id: nanoid(),
      name: 'Copy review & polish',
      description: `Review ALL HTML pages for copy quality:
- Headlines: 8 words max, clear value proposition
- Body text: short paragraphs, scannable
- CTAs: action verbs, consistent across pages
- Tone: matches "${brief?.toneStyle || 'professional'}" voice throughout
- Remove any filler or generic copy
- Ensure product name "${brief?.productName || ''}" is used consistently

${brief?.pricing?.tiers?.length ? `Pricing tiers to verify:\n${brief.pricing.tiers.map(t => `  - ${t.name}: $${t.priceMonthly}/mo`).join('\n')}` : ''}

Use edit_file to fix any issues found.`,
      assignedPod: copyPodId,
      status: 'pending',
      estimatedDuration: 4,
    });
  }

  // If SEO/Research pod exists, add blog tasks
  const seoPodId = podsByRole.get(PodRoleEnum.RESEARCH);
  if (seoPodId && (config.includeBlog || brief?.navPages?.some(p => /blog/i.test(p)))) {
    phase2bTasks.push({
      id: nanoid(),
      name: 'Blog outline + starter post',
      description: `Create a blog section with:
1. blog.html page with article listing layout
2. One starter blog post (blog/post-1.html) with real, useful content about:
   - What ${brief?.productName || 'this product'} solves
   - Target audience: ${brief?.targetAudience || 'the target audience'}
   - 500-800 words, SEO-optimized title + meta description
3. Do NOT create more than 1 post. Quality over quantity.

Output: TWO files — blog.html and blog/post-1.html`,
      assignedPod: seoPodId,
      status: 'pending',
      estimatedDuration: 5,
    });
  }

  // Animation Pod tasks — advanced scroll animations, parallax, counters
  const animPodId = podsByRole.get(PodRoleEnum.ANIMATION);
  if (animPodId) {
    phase2bTasks.push({
      id: nanoid(),
      name: 'Build animation system',
      description: `Create TWO files: animation-tokens.css and animation-system.js

FILE 1: animation-tokens.css — CSS custom properties for animation timing, easing, keyframes.
Define reusable animation keyframes: fade-up, blur-in, clip-reveal, scale-in, slide-from-left, slide-from-right.
Define scroll-progress properties for parallax layers.
Include @media (prefers-reduced-motion: reduce) block.

FILE 2: animation-system.js — Self-contained IIFE that orchestrates:
1. Scroll-progress tracking: element.getBoundingClientRect() → normalized 0-1 progress
2. Parallax layers: data-parallax="0.5" (speed multiplier), requestAnimationFrame loop, pause on tab hidden
3. Animated counters: data-counter="1000" with easing, comma formatting, triggered by IntersectionObserver
4. Staggered reveals: data-anim-stagger on parent, configurable delay per child (default 80ms)
5. Hero entrance choreography: sequential reveal (headline 0ms → subheadline 300ms → CTA 600ms → extras 900ms)
6. Text splitting: data-anim="char-reveal" splits text into per-character spans with staggered animation
7. Magnetic buttons: data-anim="magnetic" with cursor proximity detection (max 15px pull)
8. Scroll-velocity-adaptive: faster scroll = faster animation completion
9. Reduced motion: check at init + listen for changes, skip all animations when active
10. Performance: will-change management (add on animate, remove after), rAF throttle, mobile detection

Total file size budget: animation-system.js < 12KB minified, animation-tokens.css < 3KB.

AFTER creating the files, scan ALL existing HTML pages and add data-anim attributes:
- Hero headlines: data-anim="char-reveal"
- Feature cards: data-anim-stagger on parent grid
- Statistics/numbers: data-counter="VALUE"
- Background sections: data-parallax="0.3"
- CTA buttons: data-anim="magnetic"

Use edit_file to add data-anim attributes to existing pages.
Add <link> for animation-tokens.css (after motion-tokens.css) and <script> for animation-system.js (after motion.js) to ALL pages.

Output: animation-tokens.css + animation-system.js + edited HTML pages`,
      assignedPod: animPodId,
      status: 'pending',
      estimatedDuration: 8,
    });
  }

  // 3D Pod tasks — Three.js hero scenes
  const threeDPodId = podsByRole.get(PodRoleEnum.THREE_D);
  if (threeDPodId) {
    const aesthetic = config.aesthetic || 'modern';
    const productName = brief?.productName || 'the product';
    phase2bTasks.push({
      id: nanoid(),
      name: 'Build 3D hero scene',
      description: `Create THREE files: scene-config.json + scene-loader.js + scene.css

The site aesthetic is "${aesthetic}" for "${productName}".

FILE 1: scene-config.json — Declarative scene description.
Choose a scene type based on the aesthetic:
- modern/clean → Floating Geometry (soft-rotating icosahedra/tori with subtle drift)
- bold/vibrant → Particle Field (GPU-instanced particles with noise flow)
- elegant/luxury → Glass Morphism (transparent refractive spheres with blur)
- playful/creative → Abstract Blob (noise-deformed sphere with gradient material)
- tech/futuristic → Wireframe Grid (animated grid plane with wave displacement)

Include:
- Camera config: FOV 60, position, lookAt, optional slow orbit animation
- 2-4 geometries with physical materials (metalness, roughness, color from design tokens)
- 3 lights: ambient + 2 colored point lights matching the site's accent colors
- Optional particles: 300-500 count, small size, subtle drift
- Post-processing: bloom (strength 0.3-0.5), optional vignette
- Mouse interaction: subtle camera pan on mouse move (amplitude 0.3-0.5)
- Performance: maxPixelRatio 2, mobileSimplify true, pauseOffscreen true

FILE 2: scene-loader.js — ES module that:
1. Dynamically imports Three.js from CDN: https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js
2. Fetches and parses scene-config.json
3. Creates WebGLRenderer with alpha:true, antialias:true
4. Builds scene from config (geometries, materials, lights, particles)
5. Runs requestAnimationFrame render loop with delta-time-based animation
6. Handles mouse interaction (normalized device coordinates → subtle camera/object reaction)
7. Uses IntersectionObserver to pause render loop when scene container is off-screen
8. Detects mobile: simplify scene (fewer particles, no post-processing, lower pixelRatio)
9. WebGL detection: check WebGLRenderingContext, show .scene-fallback if unavailable
10. Resize handler with 250ms debounce
11. Memory cleanup on beforeunload (dispose geometries, materials, textures)
12. Error boundary: try/catch around all Three.js init, show fallback on error
13. Reduced motion: when prefers-reduced-motion active, stop rotations/floats, disable particles, static scene

FILE 3: scene.css — Container styling:
.scene-container { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.scene-container canvas { display: block; width: 100%; height: 100%; }
.scene-fallback { /* static gradient matching the hero background, shown when WebGL unavailable */ }
@media (prefers-reduced-motion: reduce) { .scene-container { opacity: 0.7; } }

AFTER creating the files, edit ALL pages that have a hero section:
- Add <div class="scene-container" aria-label="3D interactive scene"><div class="scene-fallback"></div></div> inside the hero
- Add <link rel="stylesheet" href="scene.css"> in <head> (after other stylesheets)
- Add <script type="module" src="scene-loader.js"></script> at end of <body>
- Ensure hero text content has z-index: 1 (above the scene)
- Add <noscript> fallback describing the 3D content

Use edit_file to add scene integration to existing pages.

Output: scene-config.json + scene-loader.js + scene.css + edited HTML pages`,
      assignedPod: threeDPodId,
      status: 'pending',
      estimatedDuration: 10,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 3: QA + Delivery (2-3 tasks)
  // -------------------------------------------------------------------------
  const phase3Tasks: Task[] = [
    {
      id: nanoid(),
      name: 'QA review',
      description: `Review ALL ${pageCount} HTML pages and shared CSS/JS for correctness.

FIRST: Run site_validate to get an automated validation report. Fix all errors it finds.

Pages to review:
${config.pages.map(p => `- ${p.name} (${pageFilename(p.path)})`).join('\n')}

Navigation pages:
${navDesc}

Check each page for:
- Valid HTML5 structure (DOCTYPE, html lang, head, body)
- Proper heading hierarchy (single h1, no skipped levels)
- Semantic elements (header, nav, main, section, article, footer)
- All inter-page nav links point to correct filenames
- All CSS/JS files linked correctly (variables.css, styles.css, script.js)
- Images have alt text
- Forms have proper labels and aria attributes
- Skip-to-content link present
- Consistent navigation and footer across ALL pages
- No broken or missing closing tags
- Responsive meta viewport tag present
${config.includeAnimations ? `- prefers-reduced-motion media query wrapping animations
- Run motion_validate to check motion quality
- Verify prefers-reduced-motion media query exists in motion-tokens.css
- Verify no layout-property animations (width, height, top, left)
- Verify motion.js uses IntersectionObserver (not scroll event listeners)` : ''}
${config.renderMode && config.renderMode !== 'standard' ? `- Run scene_validate to check 3D scene quality
- Verify WebGL fallback: .scene-fallback visible when WebGL unavailable
- Verify reduced-motion: 3D animations stop when prefers-reduced-motion active
- Verify CDN loading: Three.js loaded from cdn.jsdelivr.net
- Verify IntersectionObserver: 3D scene pauses when off-screen` : ''}

Check CSS for:
- All custom properties from variables.css are used
- No unused selectors, consistent naming
- Mobile-first responsive breakpoints

Check JS for:
- No console.log left behind, proper error handling
- All DOM selectors valid and cached

Fix any issues found using edit_file.

## TRUTH & HONESTY CHECK (CRITICAL — DO THIS LAST)
After fixing structural issues, scan ALL generated HTML pages for:
1. **Fabricated statistics**: Any numbers with "+", percentages, dollar amounts, user counts that are NOT in the Site Brief
2. **Trust claims**: "trusted by", "award-winning", "#1", "as seen on", "customers worldwide" — REMOVE unless USER_PROVIDED
3. **Fake testimonials**: Any quote with a name/title that wasn't explicitly provided — REMOVE and replace with "Early Access" section
4. **Security claims**: SOC 2, HIPAA, "bank-level encryption", "99.9% uptime" — REMOVE unless in Site Brief
5. **Brand name mismatch**: Verify the product name matches the Site Brief EXACTLY on every page
6. **Placeholder content**: Any [PLACEHOLDER], Lorem ipsum, example.com, Acme Corp — flag these

For each violation found:
- If removable: use edit_file to replace with honest, non-numeric alternative copy
- If critical (pricing, contact, product name): use request_pause_and_ask to confirm with user
- Report all changes in your summary

Report a summary of all findings.

## POST-BUILD GENERIC CONTENT CHECK
After truth & honesty check, run output_guard to scan for generic content:
- Verify every page references "${brief?.productName || ''}"
- Check no Lorem ipsum or placeholder text remains
- Verify hero headlines are product-specific, not generic ("Welcome to Our Website" = FAIL)
- Verify CTAs are specific, not lazy ("Click here" = FAIL, "Get Started" = WEAK)
- Verify section headings are descriptive, not just type names ("Features" = WEAK)
- Fix any violations found using edit_file`,
      assignedPod: podsByRole.get(PodRoleEnum.QA),
      status: 'pending',
      estimatedDuration: 5,
    },
  ];

  if (config.outputStructure.includeReadme) {
    phase3Tasks.push({
      id: nanoid(),
      name: 'Generate README.md',
      description: `Create README.md with:

# Project Name
> Built with ALIN Website Sprint

## Overview
Brief description: ${pageCount} pages, ${config.aesthetic} aesthetic, responsive, accessible.

## Pages
${config.pages.map(p => `- **${p.name}** (${pageFilename(p.path)}) — ${p.sections.map(s => s.type).join(', ')}`).join('\n')}

## Quick Start
\`\`\`bash
# Open directly
open index.html

# Or serve locally
npx serve .
# or
python3 -m http.server 8080
\`\`\`

## File Structure
List all files with brief descriptions.

## Customization
- Edit variables.css for colors, fonts, spacing
- Edit styles.css for component styling
- Edit individual HTML files for content

## Deployment
Static files — deploy to any web server, CDN, or hosting platform.

---
Generated by ALIN TBWO Engine`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 2,
    });
  }

  if (config.outputStructure.includeReceipt) {
    phase3Tasks.push({
      id: nanoid(),
      name: 'Generate receipt.json',
      description: `Create receipt.json by reading all files created so far and building a JSON receipt:

{
  "project": "Website Sprint",
  "objective": "${objective || '<TBWO objective>'}",
  "generatedAt": "<ISO timestamp>",
  "pages": [
    ${config.pages.map(p => `{ "name": "${p.name}", "path": "${pageFilename(p.path)}", "sections": ${JSON.stringify(p.sections.map(s => s.type))} }`).join(',\n    ')}
  ],
  "files": [
    // List every file created: { "path": "...", "type": "html|css|js|md|json", "lines": <actual line count> }
  ],
  "totalFiles": <count>,
  "totalLines": <count>
}

Use file_list and file_read to scan all created files, count lines, and populate the files array accurately. Do NOT guess — actually read and count.`,
      assignedPod: podsByRole.get(PodRoleEnum.FRONTEND),
      status: 'pending',
      estimatedDuration: 2,
    });
  }

  // -------------------------------------------------------------------------
  // BUILD PHASES
  // -------------------------------------------------------------------------
  const phase1: Phase = {
    id: nanoid(),
    name: 'Design Foundation',
    description: 'Create design tokens (variables.css), stylesheet (styles.css), and interactivity (script.js)',
    order: 0,
    estimatedDuration: phase1Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
    dependsOn: [],
    tasks: phase1Tasks,
    assignedPods: [podsByRole.get(PodRoleEnum.FRONTEND)!],
    status: 'pending',
    progress: 0,
  };

  const phase2: Phase = {
    id: nanoid(),
    name: 'Build Pages',
    description: `Build ${pageCount} complete HTML pages with real content and shared navigation`,
    order: 1,
    estimatedDuration: phase2Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
    dependsOn: [phase1.id],
    tasks: phase2Tasks,
    assignedPods: [podsByRole.get(PodRoleEnum.FRONTEND)!],
    status: 'pending',
    progress: 0,
  };

  const phase3: Phase = {
    id: nanoid(),
    name: 'QA & Delivery',
    description: 'Quality review, README, and receipt generation',
    order: 2,
    estimatedDuration: phase3Tasks.reduce((s, t) => s + t.estimatedDuration, 0),
    dependsOn: [phase2.id],
    tasks: phase3Tasks,
    assignedPods: [podsByRole.get(PodRoleEnum.QA)!, podsByRole.get(PodRoleEnum.FRONTEND)!].filter(Boolean),
    status: 'pending',
    progress: 0,
  };

  const phases: Phase[] = [phase1, phase2];

  // Only add content phase if there are tasks for it
  if (phase2bTasks.length > 0) {
    const contentPods = new Set<string>();
    phase2bTasks.forEach(t => { if (t.assignedPod) contentPods.add(t.assignedPod); });

    const phase2b: Phase = {
      id: nanoid(),
      name: 'Content & Copy',
      description: `Copy review, blog content, and specialized copy tasks`,
      order: 2,
      estimatedDuration: phase2bTasks.reduce((s, t) => s + t.estimatedDuration, 0),
      dependsOn: [phase2.id],
      tasks: phase2bTasks,
      assignedPods: [...contentPods],
      status: 'pending',
      progress: 0,
    };
    phases.push(phase2b);
    // Update phase 3 to depend on phase 2b
    phase3.dependsOn = [phase2b.id];
    phase3.order = 3;
  }

  phases.push(phase3);
  const totalDuration = phases.reduce((sum, p) => sum + p.estimatedDuration, 0);

  // Pod allocation strategy — build priorityOrder dynamically from actual pods
  const allPodRoles = new Set<PodRole>();
  pods.forEach((pod) => allPodRoles.add(pod.role));
  // Ensure core roles are always present
  allPodRoles.add(PodRoleEnum.FRONTEND);
  allPodRoles.add(PodRoleEnum.QA);
  allPodRoles.add(PodRoleEnum.DEPLOYMENT);

  // Order: Frontend first → creative pods → QA → Deployment last
  const creativeOrder = [PodRoleEnum.DESIGN, PodRoleEnum.COPY, PodRoleEnum.RESEARCH,
    PodRoleEnum.ANIMATION, PodRoleEnum.THREE_D, PodRoleEnum.MOTION];
  const orderedRoles: PodRole[] = [PodRoleEnum.FRONTEND];
  for (const role of creativeOrder) {
    if (allPodRoles.has(role)) orderedRoles.push(role);
  }
  // Add any remaining roles not yet included (excluding QA/Deployment which go last)
  for (const role of allPodRoles) {
    if (!orderedRoles.includes(role) && role !== PodRoleEnum.QA && role !== PodRoleEnum.DEPLOYMENT) {
      orderedRoles.push(role);
    }
  }
  orderedRoles.push(PodRoleEnum.QA, PodRoleEnum.DEPLOYMENT);

  const podStrategy: PodAllocationStrategy = {
    mode: 'hybrid',
    maxConcurrent: orderedRoles.length,
    priorityOrder: orderedRoles,
    dependencies: new Map<PodRole, PodRole[]>([
      [PodRoleEnum.ANIMATION, [PodRoleEnum.FRONTEND]],
      [PodRoleEnum.THREE_D, [PodRoleEnum.FRONTEND]],
      [PodRoleEnum.QA, [PodRoleEnum.FRONTEND]],
      [PodRoleEnum.DEPLOYMENT, [PodRoleEnum.FRONTEND]],
    ]),
  };

  // Risks
  const risks: Risk[] = [
    {
      description: 'Missing business content may require pause-and-ask',
      severity: 'medium',
      mitigation: 'Pods use request_pause_and_ask for unknowns instead of guessing',
    },
    {
      description: 'Cross-page navigation inconsistencies',
      severity: 'medium',
      mitigation: 'QA phase verifies all inter-page links',
    },
    {
      description: `${pageCount} pages may exceed time budget`,
      severity: pageCount > 5 ? 'high' : 'low',
      mitigation: 'HTML-first approach ensures pages are the primary output',
    },
  ];

  // Deliverables
  const deliverables: Deliverable[] = [
    {
      name: 'Website HTML pages',
      description: `${pageCount} responsive HTML pages with shared navigation`,
      type: 'file',
      path: '.',
      required: true,
    },
    {
      name: 'CSS stylesheets',
      description: 'Design system variables + main styles + responsive + animations',
      type: 'file',
      path: 'styles.css',
      required: true,
    },
    {
      name: 'JavaScript',
      description: 'Navigation, scroll animations, form validation, interactivity',
      type: 'file',
      path: 'script.js',
      required: true,
    },
    {
      name: 'Motion system',
      description: 'Animation tokens, scroll reveal, micro-interactions, hero motion',
      type: 'file',
      path: 'motion.js',
      required: true,
    },
  ];

  deliverables.push({
    name: 'Animation system',
    description: 'Scroll animations, parallax, counters, choreographed sequences',
    type: 'file',
    path: 'animation-system.js',
    required: true,
  });

  deliverables.push({
    name: '3D scene system',
    description: 'Scene specification, Three.js loader (CDN), container styles',
    type: 'file',
    path: 'scene-loader.js',
    required: true,
  });

  if (config.outputStructure.includeReadme) {
    deliverables.push({
      name: 'README.md',
      description: 'Project overview, setup instructions, deployment guide',
      type: 'report',
      path: 'README.md',
      required: true,
    });
  }

  if (config.outputStructure.includeReceipt) {
    deliverables.push({
      name: 'receipt.json',
      description: 'Build receipt with file listing and line counts',
      type: 'report',
      path: 'receipt.json',
      required: true,
    });
  }

  return {
    id: nanoid(),
    tbwoId,
    summary: `Website Sprint: ${pageCount} pages (${config.pages.map(p => p.name).join(', ')}), ${config.aesthetic} aesthetic, HTML-first 3-phase pipeline`,
    estimatedDuration: totalDuration,
    confidence: 0.9,
    phases,
    podStrategy,
    risks,
    assumptions: [
      'User provides business-specific content when asked via pause-and-ask',
      'No custom backend logic needed (static site)',
      'search_images provides real stock photo URLs for web pages',
      'Static hosting sufficient for deployment',
      'PageSpec drives page structure — QA validates against it',
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
    brief?: SiteBrief;
  } = {}
): TBWO {
  const fullConfig: WebsiteSprintConfig = {
    ...DEFAULT_WEBSITE_SPRINT_CONFIG,
    ...config,
    navigation: { ...DEFAULT_WEBSITE_SPRINT_CONFIG.navigation, ...config.navigation },
    outputStructure: { ...DEFAULT_WEBSITE_SPRINT_CONFIG.outputStructure, ...config.outputStructure },
  };

  const tbwoId = nanoid();
  const pods = createWebsiteSprintPods(tbwoId, options.brief, fullConfig);
  const plan = createWebsiteSprintPlan(tbwoId, fullConfig, pods, objective, options.brief);

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
      'request_context_snippet',
      'request_pause_and_ask',
    ],
    forbiddenTools: ['run_command', 'git'],
    maxFileSize: 1024 * 1024, // 1MB
    maxTotalStorage: 50 * 1024 * 1024, // 50MB
    maxConcurrentPods: 3,
    allowedAPIs: [],
    canDeploy: false,
    canModifyDatabase: false,
  };

  // Generate a default MotionSpec if animations are enabled
  let motionSpec: unknown = null;
  if (fullConfig.includeAnimations) {
    try {
      const { createDefaultMotionSpec } = require('./motion/motionDefaults');
      const sections = (fullConfig.pages || []).flatMap((p: any) =>
        (p.sections || []).map((s: any) => ({ type: s.type || 'default' }))
      );
      const intensity = fullConfig.motionIntensity || 'standard';
      motionSpec = createDefaultMotionSpec(intensity, sections);
    } catch {
      // Motion subsystem unavailable — proceed without spec
    }
  }

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
    pauseRequests: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userId: 'user',
    estimatedCost: plan.estimatedDuration * 0.05,
    metadata: {
      ...(motionSpec ? { motionSpec } : {}),
    },
  };

  return tbwo;
}
