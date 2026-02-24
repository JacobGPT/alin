/**
 * TBWO Templates - Pre-configured workflow templates
 */

import { TBWOType, QualityTarget, PodRole } from '../types/tbwo';

export interface TBWOTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  type: TBWOType;
  defaultTimeBudget: number; // minutes
  defaultQuality: QualityTarget;
  pods: Array<{
    role: PodRole;
    name: string;
    description: string;
  }>;
  requiredInputs: Array<{
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'number';
    placeholder?: string;
    required: boolean;
    options?: string[];
    defaultValue?: string | number;
  }>;
  phases: Array<{
    name: string;
    description: string;
    durationPercent: number;
    podRoles: PodRole[];
  }>;
}

export const TBWO_TEMPLATES: TBWOTemplate[] = [
  {
    id: 'website-sprint',
    name: 'Website Sprint',
    description: 'Design and build a complete website with multiple pages, responsive design, and modern aesthetics.',
    icon: '🌐',
    type: TBWOType.WEBSITE_SPRINT,
    defaultTimeBudget: 60,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.DESIGN, name: 'Design Pod', description: 'Visual design and layout' },
      { role: PodRole.FRONTEND, name: 'Frontend Pod', description: 'HTML/CSS/JS implementation' },
      { role: PodRole.COPY, name: 'Copy Pod', description: 'Content writing and copywriting' },
      { role: PodRole.MOTION, name: 'Motion Pod', description: 'Animations and interactions' },
      { role: PodRole.QA, name: 'QA Pod', description: 'Testing and quality assurance' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Website Purpose', type: 'textarea', placeholder: 'Describe the website you want built...', required: true },
      { key: 'pages', label: 'Number of Pages', type: 'number', defaultValue: 3, required: true },
      { key: 'aesthetic', label: 'Aesthetic Style', type: 'select', options: ['Minimal', 'Modern', 'Corporate', 'Creative', 'Brutalist', 'Glassmorphism'], required: false },
      { key: 'framework', label: 'Framework', type: 'select', options: ['Vanilla HTML/CSS', 'React', 'Next.js', 'Vue', 'Svelte'], defaultValue: 'React', required: false },
    ],
    phases: [
      { name: 'Research & Discovery', description: 'Analyze requirements and references', durationPercent: 10, podRoles: [PodRole.DESIGN] },
      { name: 'Design', description: 'Visual design and layout', durationPercent: 20, podRoles: [PodRole.DESIGN, PodRole.COPY] },
      { name: 'Development', description: 'Build pages and components', durationPercent: 45, podRoles: [PodRole.FRONTEND, PodRole.MOTION] },
      { name: 'QA & Polish', description: 'Testing and refinement', durationPercent: 20, podRoles: [PodRole.QA, PodRole.FRONTEND] },
      { name: 'Delivery', description: 'Final packaging', durationPercent: 5, podRoles: [PodRole.FRONTEND] },
    ],
  },
  {
    id: 'blender-sprint',
    name: 'Blender Sprint',
    description: 'Create 3D assets, models, materials, and animations using Blender scripting.',
    icon: '🎨',
    type: TBWOType.DESIGN_SYSTEM,
    defaultTimeBudget: 45,
    defaultQuality: QualityTarget.PREMIUM,
    pods: [
      { role: PodRole.DESIGN, name: 'Modeling Pod', description: '3D modeling and geometry' },
      { role: PodRole.FRONTEND, name: 'Material Pod', description: 'Shaders and materials' },
      { role: PodRole.BACKEND, name: 'Rigging Pod', description: 'Armatures and rigging' },
      { role: PodRole.MOTION, name: 'Animation Pod', description: 'Keyframes and motion' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'What to Create', type: 'textarea', placeholder: 'Describe the 3D asset or scene...', required: true },
      { key: 'style', label: 'Style', type: 'select', options: ['Realistic', 'Stylized', 'Low-poly', 'Cartoon', 'Sci-fi'], required: false },
      { key: 'animated', label: 'Include Animation?', type: 'select', options: ['Yes', 'No'], defaultValue: 'No', required: false },
    ],
    phases: [
      { name: 'Concept & Reference', description: 'Gather references and plan', durationPercent: 10, podRoles: [PodRole.DESIGN] },
      { name: 'Modeling', description: 'Create 3D geometry', durationPercent: 35, podRoles: [PodRole.DESIGN] },
      { name: 'Materials & Texturing', description: 'Apply materials and textures', durationPercent: 25, podRoles: [PodRole.FRONTEND] },
      { name: 'Rigging & Animation', description: 'Rig and animate', durationPercent: 25, podRoles: [PodRole.BACKEND, PodRole.MOTION] },
      { name: 'Render & Export', description: 'Final render', durationPercent: 5, podRoles: [PodRole.DESIGN] },
    ],
  },
  {
    id: 'video-production',
    name: 'Video Production',
    description: 'Script, plan, and produce video content with editing, sound design, and color grading.',
    icon: '🎬',
    type: TBWOType.CONTENT_CREATION,
    defaultTimeBudget: 90,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Script Pod', description: 'Scriptwriting and storyboarding' },
      { role: PodRole.RESEARCH, name: 'Footage Pod', description: 'Source footage and assets' },
      { role: PodRole.FRONTEND, name: 'Edit Pod', description: 'Video editing and assembly' },
      { role: PodRole.MOTION, name: 'Sound Pod', description: 'Sound design and music' },
      { role: PodRole.DESIGN, name: 'Color Pod', description: 'Color grading and finishing' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Video Concept', type: 'textarea', placeholder: 'Describe the video you want to produce...', required: true },
      { key: 'duration', label: 'Target Duration', type: 'select', options: ['30 seconds', '1 minute', '3 minutes', '5 minutes', '10+ minutes'], required: true },
      { key: 'style', label: 'Video Style', type: 'select', options: ['Documentary', 'Tutorial', 'Commercial', 'Social Media', 'Cinematic'], required: false },
      { key: 'voiceover', label: 'Include Voiceover Script?', type: 'select', options: ['Yes', 'No'], defaultValue: 'Yes', required: false },
    ],
    phases: [
      { name: 'Scripting', description: 'Write script and storyboard', durationPercent: 20, podRoles: [PodRole.COPY] },
      { name: 'Asset Gathering', description: 'Source footage and media', durationPercent: 15, podRoles: [PodRole.RESEARCH] },
      { name: 'Rough Edit', description: 'Assembly and rough cut', durationPercent: 30, podRoles: [PodRole.FRONTEND] },
      { name: 'Sound Design', description: 'Audio and music', durationPercent: 15, podRoles: [PodRole.MOTION] },
      { name: 'Color & Finish', description: 'Color grading and export', durationPercent: 20, podRoles: [PodRole.DESIGN] },
    ],
  },
  {
    id: 'app-development',
    name: 'App Development',
    description: 'Architect, build, and test a full application with frontend, backend, and quality assurance.',
    icon: '📱',
    type: TBWOType.CODE_PROJECT,
    defaultTimeBudget: 120,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.ORCHESTRATOR, name: 'Architecture Pod', description: 'System design and architecture' },
      { role: PodRole.FRONTEND, name: 'Frontend Pod', description: 'UI components and pages' },
      { role: PodRole.BACKEND, name: 'Backend Pod', description: 'API and business logic' },
      { role: PodRole.QA, name: 'QA Pod', description: 'Testing and validation' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'App Description', type: 'textarea', placeholder: 'Describe the application you want built...', required: true },
      { key: 'stack', label: 'Tech Stack', type: 'select', options: ['React + Node.js', 'Next.js Full-stack', 'Vue + Express', 'React + Python/Flask', 'Vanilla JS'], defaultValue: 'React + Node.js', required: false },
      { key: 'features', label: 'Key Features', type: 'textarea', placeholder: 'List the main features (one per line)...', required: false },
      { key: 'auth', label: 'Authentication', type: 'select', options: ['None', 'Email/Password', 'OAuth', 'JWT'], defaultValue: 'None', required: false },
    ],
    phases: [
      { name: 'Architecture', description: 'System design and planning', durationPercent: 15, podRoles: [PodRole.ORCHESTRATOR] },
      { name: 'Frontend', description: 'Build UI components', durationPercent: 30, podRoles: [PodRole.FRONTEND] },
      { name: 'Backend', description: 'Build API and services', durationPercent: 30, podRoles: [PodRole.BACKEND] },
      { name: 'Integration & QA', description: 'Connect and test', durationPercent: 20, podRoles: [PodRole.QA, PodRole.FRONTEND, PodRole.BACKEND] },
      { name: 'Deployment', description: 'Package and deploy', durationPercent: 5, podRoles: [PodRole.BACKEND] },
    ],
  },
  {
    id: 'research-report',
    name: 'Research Report',
    description: 'Conduct thorough research, analyze findings, synthesize insights, and produce a cited report.',
    icon: '📊',
    type: TBWOType.RESEARCH_REPORT,
    defaultTimeBudget: 60,
    defaultQuality: QualityTarget.PREMIUM,
    pods: [
      { role: PodRole.RESEARCH, name: 'Gather Pod', description: 'Information gathering and sourcing' },
      { role: PodRole.DATA, name: 'Analyze Pod', description: 'Data analysis and interpretation' },
      { role: PodRole.COPY, name: 'Synthesize Pod', description: 'Writing and synthesis' },
      { role: PodRole.QA, name: 'Cite Pod', description: 'Citation and fact-checking' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Research Topic', type: 'textarea', placeholder: 'What do you want researched?', required: true },
      { key: 'depth', label: 'Research Depth', type: 'select', options: ['Overview', 'Moderate', 'Deep Dive', 'Comprehensive'], defaultValue: 'Moderate', required: false },
      { key: 'format', label: 'Output Format', type: 'select', options: ['Report', 'Executive Brief', 'White Paper', 'Literature Review'], defaultValue: 'Report', required: false },
      { key: 'sources', label: 'Preferred Sources', type: 'textarea', placeholder: 'Any specific sources or domains to prioritize...', required: false },
    ],
    phases: [
      { name: 'Gather', description: 'Collect information from sources', durationPercent: 30, podRoles: [PodRole.RESEARCH] },
      { name: 'Analyze', description: 'Analyze and interpret findings', durationPercent: 25, podRoles: [PodRole.DATA] },
      { name: 'Synthesize', description: 'Write and structure the report', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Cite & Review', description: 'Add citations and fact-check', durationPercent: 15, podRoles: [PodRole.QA] },
    ],
  },
  // ── Research ────────────────────────────────────────────────
  {
    id: 'market-research',
    name: 'Market Research',
    description: 'Web research, competitor analysis, and synthesized market intelligence report.',
    icon: '📈',
    type: TBWOType.MARKET_RESEARCH,
    defaultTimeBudget: 35,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.RESEARCH, name: 'Web Research Pod', description: 'Parallel web search and data gathering' },
      { role: PodRole.DATA, name: 'Analysis Pod', description: 'Competitor and market analysis' },
      { role: PodRole.COPY, name: 'Synthesis Pod', description: 'Report writing and synthesis' },
      { role: PodRole.QA, name: 'Review Pod', description: 'Fact-checking and quality review' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Research Question', type: 'textarea', placeholder: 'What market or topic do you want researched?', required: true },
      { key: 'industry', label: 'Industry / Sector', type: 'text', placeholder: 'e.g. SaaS, Fintech, Healthcare', required: false },
      { key: 'competitors', label: 'Known Competitors', type: 'textarea', placeholder: 'List any known competitors (one per line)', required: false },
      { key: 'depth', label: 'Research Depth', type: 'select', options: ['Overview', 'Moderate', 'Deep Dive'], defaultValue: 'Moderate', required: false },
    ],
    phases: [
      { name: 'Define Scope', description: 'Clarify research boundaries', durationPercent: 10, podRoles: [PodRole.RESEARCH] },
      { name: 'Web Research', description: 'Parallel web search and data collection', durationPercent: 30, podRoles: [PodRole.RESEARCH] },
      { name: 'Competitor Analysis', description: 'Analyze competitor landscape', durationPercent: 25, podRoles: [PodRole.DATA] },
      { name: 'Synthesis', description: 'Synthesize findings into insights', durationPercent: 25, podRoles: [PodRole.COPY] },
      { name: 'Report Generation', description: 'Format and finalize report', durationPercent: 10, podRoles: [PodRole.QA, PodRole.COPY] },
    ],
  },
  {
    id: 'due-diligence',
    name: 'Due Diligence',
    description: 'Subject research, public records analysis, news coverage, and risk-scored report.',
    icon: '🔍',
    type: TBWOType.DUE_DILIGENCE,
    defaultTimeBudget: 45,
    defaultQuality: QualityTarget.PREMIUM,
    pods: [
      { role: PodRole.RESEARCH, name: 'Research Pod', description: 'Subject and public records research' },
      { role: PodRole.DATA, name: 'News Pod', description: 'News and media analysis' },
      { role: PodRole.COPY, name: 'Risk Pod', description: 'Risk assessment and scoring' },
      { role: PodRole.QA, name: 'Summary Pod', description: 'Final summary and verification' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Subject', type: 'textarea', placeholder: 'Company name, person, or entity to investigate...', required: true },
      { key: 'context', label: 'Context', type: 'textarea', placeholder: 'Why is this due diligence needed? (e.g. investment, partnership)', required: false },
      { key: 'focus', label: 'Focus Areas', type: 'select', options: ['Financial', 'Legal', 'Reputation', 'Comprehensive'], defaultValue: 'Comprehensive', required: false },
    ],
    phases: [
      { name: 'Subject Research', description: 'Background and entity research', durationPercent: 25, podRoles: [PodRole.RESEARCH] },
      { name: 'Public Records', description: 'Search public filings and records', durationPercent: 20, podRoles: [PodRole.RESEARCH] },
      { name: 'News Analysis', description: 'Media coverage and sentiment', durationPercent: 20, podRoles: [PodRole.DATA] },
      { name: 'Risk Assessment', description: 'Risk scoring and red flags', durationPercent: 20, podRoles: [PodRole.COPY] },
      { name: 'Summary Report', description: 'Executive summary with risk scores', durationPercent: 15, podRoles: [PodRole.QA] },
    ],
  },
  {
    id: 'seo-audit',
    name: 'SEO Audit',
    description: 'URL crawl, structure analysis, keyword gaps, competitor comparison, and action plan.',
    icon: '🔎',
    type: TBWOType.SEO_AUDIT,
    defaultTimeBudget: 30,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.RESEARCH, name: 'Crawl Pod', description: 'URL crawling and structure mapping' },
      { role: PodRole.DATA, name: 'Analysis Pod', description: 'Keyword and competitor analysis' },
      { role: PodRole.COPY, name: 'Report Pod', description: 'Action plan writing' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Website URL', type: 'text', placeholder: 'https://example.com', required: true },
      { key: 'competitors', label: 'Competitor URLs', type: 'textarea', placeholder: 'Competitor URLs to compare against (one per line)', required: false },
      { key: 'keywords', label: 'Target Keywords', type: 'textarea', placeholder: 'Keywords you want to rank for (one per line)', required: false },
    ],
    phases: [
      { name: 'URL Crawl', description: 'Crawl site structure and pages', durationPercent: 20, podRoles: [PodRole.RESEARCH] },
      { name: 'Structure Analysis', description: 'Analyze technical SEO', durationPercent: 20, podRoles: [PodRole.DATA] },
      { name: 'Keyword Gap', description: 'Identify keyword opportunities', durationPercent: 20, podRoles: [PodRole.DATA] },
      { name: 'Competitor Comparison', description: 'Compare against competitors', durationPercent: 20, podRoles: [PodRole.DATA] },
      { name: 'Priority Action Plan', description: 'Ranked list of improvements', durationPercent: 20, podRoles: [PodRole.COPY] },
    ],
  },

  // ── Documents ──────────────────────────────────────────────
  {
    id: 'business-plan',
    name: 'Business Plan',
    description: 'Market research, competitive analysis, financial projections, and full business plan.',
    icon: '📋',
    type: TBWOType.BUSINESS_PLAN,
    defaultTimeBudget: 50,
    defaultQuality: QualityTarget.PREMIUM,
    pods: [
      { role: PodRole.RESEARCH, name: 'Market Pod', description: 'Market and industry research' },
      { role: PodRole.DATA, name: 'Financial Pod', description: 'Financial modeling and projections' },
      { role: PodRole.COPY, name: 'Writer Pod', description: 'Plan drafting and narrative' },
      { role: PodRole.QA, name: 'Review Pod', description: 'Review and coherence check' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Business Idea', type: 'textarea', placeholder: 'Describe your business idea or venture...', required: true },
      { key: 'stage', label: 'Stage', type: 'select', options: ['Idea', 'Pre-seed', 'Seed', 'Series A', 'Established'], defaultValue: 'Idea', required: false },
      { key: 'market', label: 'Target Market', type: 'text', placeholder: 'e.g. US small businesses, Gen-Z consumers', required: false },
      { key: 'revenue', label: 'Revenue Model', type: 'select', options: ['SaaS', 'Marketplace', 'E-commerce', 'Services', 'Advertising', 'Other'], required: false },
    ],
    phases: [
      { name: 'Market Research', description: 'Industry and market analysis', durationPercent: 20, podRoles: [PodRole.RESEARCH] },
      { name: 'Competitive Analysis', description: 'Competitor landscape', durationPercent: 20, podRoles: [PodRole.RESEARCH, PodRole.DATA] },
      { name: 'Financial Projections', description: 'Revenue and cost models', durationPercent: 20, podRoles: [PodRole.DATA] },
      { name: 'Plan Drafting', description: 'Write the full business plan', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Review & Polish', description: 'Final review and formatting', durationPercent: 10, podRoles: [PodRole.QA] },
    ],
  },
  {
    id: 'content-strategy',
    name: 'Content Strategy',
    description: 'Brand analysis, audience research, strategy document, and 90-day content calendar.',
    icon: '📅',
    type: TBWOType.CONTENT_STRATEGY,
    defaultTimeBudget: 40,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.RESEARCH, name: 'Research Pod', description: 'Brand and audience research' },
      { role: PodRole.DATA, name: 'Audit Pod', description: 'Competitor content audit' },
      { role: PodRole.COPY, name: 'Strategy Pod', description: 'Strategy writing and calendar' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Brand / Product', type: 'textarea', placeholder: 'Describe your brand, product, or business...', required: true },
      { key: 'audience', label: 'Target Audience', type: 'text', placeholder: 'Who are you trying to reach?', required: false },
      { key: 'channels', label: 'Channels', type: 'select', options: ['Blog', 'Social Media', 'Email', 'All Channels'], defaultValue: 'All Channels', required: false },
      { key: 'competitors', label: 'Competitor Brands', type: 'textarea', placeholder: 'Competitors to analyze (one per line)', required: false },
    ],
    phases: [
      { name: 'Brand Analysis', description: 'Understand brand voice and positioning', durationPercent: 15, podRoles: [PodRole.RESEARCH] },
      { name: 'Audience Research', description: 'Identify audience segments', durationPercent: 20, podRoles: [PodRole.RESEARCH] },
      { name: 'Competitor Content Audit', description: 'Analyze competitor content', durationPercent: 20, podRoles: [PodRole.DATA] },
      { name: 'Strategy Document', description: 'Write content strategy', durationPercent: 25, podRoles: [PodRole.COPY] },
      { name: 'Content Calendar', description: '90-day editorial calendar', durationPercent: 20, podRoles: [PodRole.COPY] },
    ],
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    description: 'Research, outline, draft, and produce a publish-ready HTML newsletter.',
    icon: '✉️',
    type: TBWOType.NEWSLETTER,
    defaultTimeBudget: 20,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.RESEARCH, name: 'Research Pod', description: 'Topic research and sourcing' },
      { role: PodRole.COPY, name: 'Writer Pod', description: 'Drafting and editing' },
      { role: PodRole.FRONTEND, name: 'Format Pod', description: 'HTML email formatting' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Newsletter Topic', type: 'textarea', placeholder: 'What should this newsletter be about?', required: true },
      { key: 'tone', label: 'Tone', type: 'select', options: ['Professional', 'Casual', 'Witty', 'Educational'], defaultValue: 'Professional', required: false },
      { key: 'length', label: 'Length', type: 'select', options: ['Short (500 words)', 'Medium (1000 words)', 'Long (2000+ words)'], defaultValue: 'Medium (1000 words)', required: false },
    ],
    phases: [
      { name: 'Topic Research', description: 'Research and gather sources', durationPercent: 20, podRoles: [PodRole.RESEARCH] },
      { name: 'Outline', description: 'Structure and outline', durationPercent: 15, podRoles: [PodRole.COPY] },
      { name: 'Draft', description: 'Write the full newsletter', durationPercent: 40, podRoles: [PodRole.COPY] },
      { name: 'Polish & Format', description: 'Edit and produce HTML email', durationPercent: 25, podRoles: [PodRole.COPY, PodRole.FRONTEND] },
    ],
  },
  // ── Ephemeral Fun ────────────────────────────────────────────
  {
    id: 'roast-page',
    name: 'Roast Page',
    description: 'A comedic roast page with escalating humor, rebuttal section, and shareable link.',
    icon: '🔥',
    type: TBWOType.ROAST_PAGE,
    defaultTimeBudget: 8,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Comedy Pod', description: 'Comedic writing and roast material' },
      { role: PodRole.FRONTEND, name: 'Builder Pod', description: 'HTML/CSS page construction' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Who & Material', type: 'textarea', placeholder: 'Who are you roasting? Give us some material to work with...', required: true },
      { key: 'tone', label: 'Roast Intensity', type: 'select', options: ['Light', 'Medium', 'No Mercy'], required: true },
    ],
    phases: [
      { name: 'Gather Material', description: 'Craft comedy beats and roast lines', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Build Page', description: 'Create the roast page', durationPercent: 50, podRoles: [PodRole.FRONTEND] },
      { name: 'Polish', description: 'Add animations and share buttons', durationPercent: 20, podRoles: [PodRole.FRONTEND] },
    ],
  },
  {
    id: 'tribute-page',
    name: 'Tribute Page',
    description: 'An elegant tribute celebrating a person with specific memories and warm storytelling.',
    icon: '💐',
    type: TBWOType.TRIBUTE_PAGE,
    defaultTimeBudget: 12,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Writer Pod', description: 'Warm, personal storytelling' },
      { role: PodRole.FRONTEND, name: 'Builder Pod', description: 'Elegant page design' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Person\'s Name', type: 'text', placeholder: 'Who is this tribute for?', required: true },
      { key: 'relationship', label: 'Your Relationship', type: 'text', placeholder: 'e.g. Best friend, Mom, Mentor', required: true },
      { key: 'memories', label: 'Specific Memories', type: 'textarea', placeholder: 'Share 3-5 specific memories or stories about this person...', required: true },
    ],
    phases: [
      { name: 'Gather Memories', description: 'Structure stories and messaging', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Build Page', description: 'Create the tribute page', durationPercent: 50, podRoles: [PodRole.FRONTEND] },
      { name: 'Polish', description: 'Elegant typography and animations', durationPercent: 20, podRoles: [PodRole.FRONTEND] },
    ],
  },
  {
    id: 'bet-tracker',
    name: 'Bet Tracker',
    description: 'Track a bet between two parties with countdown, terms, and evidence section.',
    icon: '🤝',
    type: TBWOType.BET_TRACKER,
    defaultTimeBudget: 10,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Contract Pod', description: 'Bet terms and rules' },
      { role: PodRole.FRONTEND, name: 'Builder Pod', description: 'Countdown and tracker UI' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Party 1 Name', type: 'text', placeholder: 'First person in the bet', required: true },
      { key: 'party2', label: 'Party 2 Name', type: 'text', placeholder: 'Second person in the bet', required: true },
      { key: 'terms', label: 'Bet Terms', type: 'textarea', placeholder: 'What exactly is the bet? What are the stakes?', required: true },
      { key: 'criteria', label: 'Resolution Criteria', type: 'textarea', placeholder: 'How will the winner be determined?', required: true },
      { key: 'deadline', label: 'Deadline', type: 'text', placeholder: 'e.g. March 31, 2026', required: true },
    ],
    phases: [
      { name: 'Setup & Content', description: 'Structure bet terms and countdown', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Build Page', description: 'Create the tracker page', durationPercent: 50, podRoles: [PodRole.FRONTEND] },
      { name: 'Polish', description: 'Countdown timer and share buttons', durationPercent: 20, podRoles: [PodRole.FRONTEND] },
    ],
  },
  {
    id: 'debate-page',
    name: 'Debate Page',
    description: 'Split-screen point/counterpoint debate with voting and fair treatment of both sides.',
    icon: '⚖️',
    type: TBWOType.DEBATE_PAGE,
    defaultTimeBudget: 12,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Debate Pod', description: 'Arguments for both sides' },
      { role: PodRole.FRONTEND, name: 'Builder Pod', description: 'Split-screen layout and voting' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Debate Topic', type: 'textarea', placeholder: 'What\'s the debate about?', required: true },
      { key: 'side_a', label: 'Side A', type: 'text', placeholder: 'e.g. "Pineapple belongs on pizza"', required: true },
      { key: 'side_b', label: 'Side B', type: 'text', placeholder: 'e.g. "Pineapple does NOT belong on pizza"', required: true },
    ],
    phases: [
      { name: 'Structure Debate', description: 'Build arguments for both sides', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Build Page', description: 'Create the debate page', durationPercent: 50, podRoles: [PodRole.FRONTEND] },
      { name: 'Polish', description: 'Voting UI and share buttons', durationPercent: 20, podRoles: [PodRole.FRONTEND] },
    ],
  },
  {
    id: 'time-capsule',
    name: 'Time Capsule',
    description: 'Sealed messages with a reveal-date countdown that auto-unlocks.',
    icon: '📦',
    type: TBWOType.TIME_CAPSULE,
    defaultTimeBudget: 10,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Writer Pod', description: 'Compose sealed messages' },
      { role: PodRole.FRONTEND, name: 'Builder Pod', description: 'Countdown and reveal UI' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Capsule Title', type: 'text', placeholder: 'e.g. "Class of 2026 Time Capsule"', required: true },
      { key: 'messages', label: 'Messages to Seal', type: 'textarea', placeholder: 'Write the messages to seal inside (one per paragraph)...', required: true },
      { key: 'reveal_date', label: 'Reveal Date', type: 'text', placeholder: 'e.g. January 1, 2027', required: true },
    ],
    phases: [
      { name: 'Compose Messages', description: 'Structure sealed content', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Build Page', description: 'Create the time capsule page', durationPercent: 50, podRoles: [PodRole.FRONTEND] },
      { name: 'Polish', description: 'Countdown, blur effects, reveal animation', durationPercent: 20, podRoles: [PodRole.FRONTEND] },
    ],
  },
  {
    id: 'scoreboard',
    name: 'Scoreboard',
    description: 'A mobile-first leaderboard with podium treatment and prominent scoring rules.',
    icon: '🏆',
    type: TBWOType.SCOREBOARD,
    defaultTimeBudget: 8,
    defaultQuality: QualityTarget.STANDARD,
    pods: [
      { role: PodRole.COPY, name: 'Rules Pod', description: 'Scoring rules and descriptions' },
      { role: PodRole.FRONTEND, name: 'Builder Pod', description: 'Leaderboard and podium UI' },
    ],
    requiredInputs: [
      { key: 'objective', label: 'Competition Name', type: 'text', placeholder: 'e.g. "Office Fantasy Football 2026"', required: true },
      { key: 'participants', label: 'Participants & Scores', type: 'textarea', placeholder: 'List participants and their scores (one per line, e.g. "Alice: 42")...', required: true },
      { key: 'scoring_rules', label: 'Scoring Rules', type: 'textarea', placeholder: 'How are points earned? What are the rules?', required: true },
    ],
    phases: [
      { name: 'Define Rules', description: 'Structure scoring and participants', durationPercent: 30, podRoles: [PodRole.COPY] },
      { name: 'Build Page', description: 'Create the scoreboard page', durationPercent: 50, podRoles: [PodRole.FRONTEND] },
      { name: 'Polish', description: 'Podium treatment and mobile optimization', durationPercent: 20, podRoles: [PodRole.FRONTEND] },
    ],
  },
];

export function getTemplate(id: string): TBWOTemplate | undefined {
  return TBWO_TEMPLATES.find(t => t.id === id);
}

export function getTemplatesByType(type: TBWOType): TBWOTemplate[] {
  return TBWO_TEMPLATES.filter(t => t.type === type);
}
