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
];

export function getTemplate(id: string): TBWOTemplate | undefined {
  return TBWO_TEMPLATES.find(t => t.id === id);
}

export function getTemplatesByType(type: TBWOType): TBWOTemplate[] {
  return TBWO_TEMPLATES.filter(t => t.type === type);
}
