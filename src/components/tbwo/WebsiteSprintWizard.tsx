/**
 * Website Sprint Wizard - TBWO Creation Interface
 *
 * Multi-step wizard for creating Time-Budgeted Work Orders
 * specifically optimized for Website Sprint projects.
 * Uses the createWebsiteSprintTBWO() factory for domain-specific
 * planning with 5 specialized phases and 6 agent pods.
 *
 * Steps:
 * 1. Project Overview (objective, quality, time budget)
 * 2. Pages & Navigation (site map, per-page sections & links)
 * 3. Design Preferences (style, colors, typography)
 * 4. Technical Stack (framework, hosting, features, deployment)
 * 5. Review & Launch
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  RocketLaunchIcon,
  DocumentTextIcon,
  PaintBrushIcon,
  CodeBracketIcon,
  EyeIcon,
  PlusIcon,
  TrashIcon,
  LinkIcon,
  Bars3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';

// Store
import { useTBWOStore } from '../../store/tbwoStore';
import { useUIStore } from '../../store/uiStore';

// Components
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

// Types & Factory
import { QualityTarget } from '../../types/tbwo';
import type { WebsiteSprintConfig, PageLink, NavigationConfig, OutputStructure } from '../../types/tbwo';
import { createWebsiteSprintTBWO } from '../../services/tbwo/templates/websiteSprint';

// ============================================================================
// TYPES
// ============================================================================

interface WebsiteSprintWizardProps {
  onComplete?: (tbwoId: string) => void;
}

interface WizardStep {
  id: string;
  title: string;
  icon: React.ReactNode;
  description: string;
}

type SectionType = 'hero' | 'features' | 'about' | 'testimonials' | 'cta' | 'footer' | 'gallery' | 'pricing' | 'faq' | 'team' | 'blog' | 'custom';

interface WizardPageData {
  id: string;
  name: string;
  path: string;
  description: string;
  isInMainNav: boolean;
  sections: SectionType[];
  links: PageLink[];
}

interface WebsiteSprintData {
  // Step 1: Overview
  objective: string;
  projectName: string;
  qualityTarget: QualityTarget;
  timeBudget: number;

  // Step 2: Pages & Navigation
  pages: WizardPageData[];
  navStyle: 'horizontal' | 'sidebar' | 'hamburger';
  stickyNav: boolean;
  footerLinks: PageLink[];
  socialLinks: Array<{ platform: string; url: string }>;

  // Step 3: Design
  designStyle: 'minimal' | 'modern' | 'classic' | 'bold' | 'elegant';
  primaryColor: string;
  secondaryColor: string;
  typography: 'sans-serif' | 'serif' | 'mono';

  // Step 4: Technical
  framework: 'react' | 'vue' | 'svelte' | 'static';
  features: string[];
  hosting: 'vercel' | 'netlify' | 'cloudflare' | 'custom';
  includeAnimations: boolean;
  includeContactForm: boolean;
  seoOptimized: boolean;
  includeDeployConfig: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SECTION_OPTIONS: Array<{ value: SectionType; label: string; desc: string }> = [
  { value: 'hero', label: 'Hero', desc: 'Large banner with headline & CTA' },
  { value: 'features', label: 'Features', desc: 'Feature cards grid' },
  { value: 'about', label: 'About', desc: 'About section with text & image' },
  { value: 'testimonials', label: 'Testimonials', desc: 'Customer quotes' },
  { value: 'cta', label: 'Call to Action', desc: 'Conversion banner' },
  { value: 'gallery', label: 'Gallery', desc: 'Image/portfolio grid' },
  { value: 'pricing', label: 'Pricing', desc: 'Pricing tier cards' },
  { value: 'faq', label: 'FAQ', desc: 'Expandable questions' },
  { value: 'team', label: 'Team', desc: 'Team member cards' },
  { value: 'blog', label: 'Blog', desc: 'Blog post previews' },
  { value: 'footer', label: 'Footer', desc: 'Footer with links & info' },
  { value: 'custom', label: 'Custom', desc: 'Describe your own section' },
];

const WIZARD_STEPS: WizardStep[] = [
  { id: 'overview', title: 'Project Overview', icon: <DocumentTextIcon className="h-5 w-5" />, description: 'Define your website goals and constraints' },
  { id: 'pages', title: 'Pages & Links', icon: <LinkIcon className="h-5 w-5" />, description: 'Plan pages, sections, and navigation links' },
  { id: 'design', title: 'Design Preferences', icon: <PaintBrushIcon className="h-5 w-5" />, description: 'Set visual style and branding' },
  { id: 'technical', title: 'Technical Stack', icon: <CodeBracketIcon className="h-5 w-5" />, description: 'Choose frameworks and features' },
  { id: 'review', title: 'Review & Launch', icon: <EyeIcon className="h-5 w-5" />, description: 'Review and start execution' },
];

// ============================================================================
// WIZARD COMPONENT
// ============================================================================

export function WebsiteSprintWizard({ onComplete }: WebsiteSprintWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isLaunching, setIsLaunching] = useState(false);
  const [formData, setFormData] = useState<WebsiteSprintData>({
    objective: '',
    projectName: '',
    qualityTarget: QualityTarget.PREMIUM,
    timeBudget: 60,
    pages: [
      { id: '1', name: 'Home', path: '/', description: 'Landing page with hero, features, and CTA', isInMainNav: true, sections: ['hero', 'features', 'about', 'cta', 'footer'], links: [] },
      { id: '2', name: 'About', path: '/about', description: 'About the company or project', isInMainNav: true, sections: ['hero', 'about', 'team', 'footer'], links: [] },
      { id: '3', name: 'Contact', path: '/contact', description: 'Contact form and information', isInMainNav: true, sections: ['hero', 'cta', 'footer'], links: [] },
    ],
    navStyle: 'horizontal',
    stickyNav: true,
    footerLinks: [],
    socialLinks: [],
    designStyle: 'modern',
    primaryColor: '#6366f1',
    secondaryColor: '#a855f7',
    typography: 'sans-serif',
    framework: 'static',
    features: [],
    hosting: 'vercel',
    includeAnimations: true,
    includeContactForm: true,
    seoOptimized: true,
    includeDeployConfig: true,
  });

  const setActiveTBWO = useTBWOStore((state) => state.setActiveTBWO);
  const closeModal = useUIStore((state) => state.closeModal);
  const showSuccess = useUIStore((state) => state.showSuccess);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleNext = () => {
    if (currentStep < WIZARD_STEPS.length - 1) setCurrentStep(currentStep + 1);
  };

  const handlePrevious = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleLaunch = async () => {
    if (isLaunching) return;
    setIsLaunching(true);

    try {
      const projectSlug = (formData.projectName || 'website').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);

      // Build navigation config
      const navigation: NavigationConfig = {
        style: formData.navStyle,
        sticky: formData.stickyNav,
        logoText: formData.projectName || undefined,
        footerLinks: formData.footerLinks,
        socialLinks: formData.socialLinks.filter(s => s.url).map(s => ({
          platform: s.platform as any,
          url: s.url,
        })),
      };

      // Build output structure
      const outputStructure: OutputStructure = {
        rootFolder: `output/tbwo/${projectSlug}`,
        siteFolder: 'site',
        assetsFolder: 'assets',
        cssFile: 'site/styles.css',
        includeReadme: true,
        includeReceipt: true,
        includeDeployScript: formData.includeDeployConfig,
      };

      // Convert wizard pages to config pages
      const config: Partial<WebsiteSprintConfig> = {
        pages: formData.pages.map((p, idx) => ({
          name: p.name,
          path: p.path,
          sections: p.sections.map(s => ({ type: s })),
          links: p.links,
          isInMainNav: p.isInMainNav,
          navOrder: idx,
        })),
        navigation,
        outputStructure,
        aesthetic: formData.designStyle,
        colorScheme: {
          primary: formData.primaryColor,
          secondary: formData.secondaryColor,
          accent: formData.primaryColor,
          background: '#ffffff',
          text: '#0f172a',
        },
        typography: {
          headingFont: formData.typography === 'serif' ? 'Georgia, serif'
            : formData.typography === 'mono' ? 'JetBrains Mono, monospace'
            : 'Inter, system-ui, sans-serif',
          bodyFont: formData.typography === 'serif' ? 'Georgia, serif'
            : formData.typography === 'mono' ? 'JetBrains Mono, monospace'
            : 'Inter, system-ui, sans-serif',
          scale: 'medium' as const,
        },
        framework: formData.framework,
        hosting: formData.hosting as any,
        includeAnimations: formData.includeAnimations,
        includeContactForm: formData.includeContactForm,
        seoOptimized: formData.seoOptimized,
        responsive: true,
        includeDeployConfig: formData.includeDeployConfig,
        deployTarget: formData.hosting as any,
      };

      const fullObjective = formData.projectName
        ? `Build "${formData.projectName}": ${formData.objective}`
        : formData.objective;

      const tbwo = createWebsiteSprintTBWO(fullObjective, config, {
        timeBudget: formData.timeBudget,
        qualityTarget: formData.qualityTarget,
      });

      const tbwoId = useTBWOStore.getState().createTBWO({
        type: tbwo.type,
        objective: tbwo.objective,
        timeBudgetMinutes: formData.timeBudget,
        qualityTarget: formData.qualityTarget,
      });

      useTBWOStore.getState().updateTBWO(tbwoId, {
        plan: tbwo.plan,
        pods: tbwo.pods,
        scope: tbwo.scope,
        status: tbwo.status,
        estimatedCost: tbwo.estimatedCost,
        authorityLevel: tbwo.authorityLevel,
      });

      useTBWOStore.getState().approvePlan(tbwoId);
      setActiveTBWO(tbwoId);
      showSuccess('Website Sprint created! Review the plan and approve to start.');
      closeModal();
      onComplete?.(tbwoId);
    } catch (error) {
      console.error('[WebsiteSprintWizard] Launch failed:', error);
    } finally {
      setIsLaunching(false);
    }
  };

  const addPage = () => {
    setFormData({
      ...formData,
      pages: [...formData.pages, {
        id: Date.now().toString(),
        name: '',
        path: '/',
        description: '',
        isInMainNav: true,
        sections: ['hero', 'footer'],
        links: [],
      }],
    });
  };

  const removePage = (id: string) => {
    setFormData({ ...formData, pages: formData.pages.filter(p => p.id !== id) });
  };

  const updatePage = (id: string, updates: Partial<WizardPageData>) => {
    setFormData({
      ...formData,
      pages: formData.pages.map(p => p.id === id ? { ...p, ...updates } : p),
    });
  };

  const toggleFeature = (feature: string) => {
    setFormData({
      ...formData,
      features: formData.features.includes(feature)
        ? formData.features.filter(f => f !== feature)
        : [...formData.features, feature],
    });
  };

  const canLaunch = formData.objective.trim().length > 0 && formData.pages.length > 0;

  const renderStep = () => {
    switch (WIZARD_STEPS[currentStep]?.id) {
      case 'overview':
        return <OverviewStep formData={formData} setFormData={setFormData} />;
      case 'pages':
        return <PagesStep formData={formData} setFormData={setFormData} addPage={addPage} removePage={removePage} updatePage={updatePage} />;
      case 'design':
        return <DesignStep formData={formData} setFormData={setFormData} />;
      case 'technical':
        return <TechnicalStep formData={formData} setFormData={setFormData} toggleFeature={toggleFeature} />;
      case 'review':
        return <ReviewStep formData={formData} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col">
      {/* Progress Steps */}
      <div className="border-b border-border-primary bg-background-secondary px-4 py-4 rounded-t-xl">
        <div className="flex items-center justify-between">
          {WIZARD_STEPS.map((step, index) => (
            <div key={step.id} className="flex flex-1 items-center">
              <div className="relative flex flex-col items-center">
                <button
                  onClick={() => index < currentStep && setCurrentStep(index)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    index < currentStep
                      ? 'border-brand-primary bg-brand-primary text-white cursor-pointer'
                      : index === currentStep
                      ? 'border-brand-primary bg-background-primary text-brand-primary'
                      : 'border-border-primary bg-background-primary text-text-tertiary'
                  }`}
                >
                  {index < currentStep ? <CheckIcon className="h-5 w-5" /> : step.icon}
                </button>
                <p className={`mt-1.5 text-[10px] font-medium ${index <= currentStep ? 'text-text-primary' : 'text-text-quaternary'}`}>
                  {step.title}
                </p>
              </div>
              {index < WIZARD_STEPS.length - 1 && (
                <div className={`mx-2 h-0.5 flex-1 transition-colors ${index < currentStep ? 'bg-brand-primary' : 'bg-border-primary'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="overflow-y-auto px-4 py-5" style={{ maxHeight: '55vh' }}>
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-border-primary bg-background-secondary px-4 py-3 rounded-b-xl">
        <Button variant="ghost" size="sm" onClick={handlePrevious} disabled={currentStep === 0} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>
          Previous
        </Button>
        <div className="flex items-center gap-1.5">
          {WIZARD_STEPS.map((_, index) => (
            <div key={index} className={`h-1.5 w-1.5 rounded-full transition-colors ${index === currentStep ? 'bg-brand-primary' : index < currentStep ? 'bg-brand-primary/40' : 'bg-border-primary'}`} />
          ))}
        </div>
        {currentStep === WIZARD_STEPS.length - 1 ? (
          <Button variant="primary" size="sm" onClick={handleLaunch} disabled={!canLaunch || isLaunching}
            leftIcon={isLaunching ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <RocketLaunchIcon className="h-4 w-4" />}>
            {isLaunching ? 'Creating...' : 'Launch Sprint'}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={handleNext} rightIcon={<ArrowRightIcon className="h-4 w-4" />}>Next</Button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// STEP 1: OVERVIEW
// ============================================================================

function OverviewStep({ formData, setFormData }: { formData: WebsiteSprintData; setFormData: (d: WebsiteSprintData) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-xl font-bold text-text-primary">Let's Build Your Website</h2>
        <p className="text-sm text-text-secondary">Tell us about your project so ALIN's pods can build exactly what you need</p>
      </div>
      <Input label="Project Name" placeholder="My Awesome Website" value={formData.projectName} onChange={(e) => setFormData({ ...formData, projectName: e.target.value })} />
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">Project Objective <span className="text-semantic-error">*</span></label>
        <textarea value={formData.objective} onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
          placeholder="A modern portfolio site for a photographer, featuring a full-screen gallery, about page, and booking form..."
          className="h-28 w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-2.5 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none resize-none" />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">Quality Target</label>
        <div className="grid grid-cols-4 gap-2">
          {[
            { value: QualityTarget.DRAFT, label: 'Draft', desc: 'Quick prototype' },
            { value: QualityTarget.STANDARD, label: 'Standard', desc: 'Professional' },
            { value: QualityTarget.PREMIUM, label: 'Premium', desc: 'High polish' },
            { value: QualityTarget.APPLE_LEVEL, label: 'Apple-Level', desc: 'Pixel perfect' },
          ].map((option) => (
            <button key={option.value} onClick={() => setFormData({ ...formData, qualityTarget: option.value })}
              className={`rounded-lg border-2 p-3 text-left transition-all ${formData.qualityTarget === option.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
              <div className="text-sm font-semibold text-text-primary">{option.label}</div>
              <div className="text-[10px] text-text-tertiary">{option.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">
          Time Budget: <span className="text-brand-primary font-bold">{formData.timeBudget} minutes</span>
        </label>
        <input type="range" min={15} max={180} step={15} value={formData.timeBudget}
          onChange={(e) => setFormData({ ...formData, timeBudget: parseInt(e.target.value) })} className="w-full accent-brand-primary" />
        <div className="flex justify-between text-[10px] text-text-quaternary"><span>15 min</span><span>1 hr</span><span>3 hrs</span></div>
      </div>
    </div>
  );
}

// ============================================================================
// STEP 2: PAGES & NAVIGATION
// ============================================================================

function PagesStep({ formData, setFormData, addPage, removePage, updatePage }: {
  formData: WebsiteSprintData;
  setFormData: (d: WebsiteSprintData) => void;
  addPage: () => void;
  removePage: (id: string) => void;
  updatePage: (id: string, updates: Partial<WizardPageData>) => void;
}) {
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [showNavSettings, setShowNavSettings] = useState(false);

  const addLinkToPage = (pageId: string) => {
    const page = formData.pages.find(p => p.id === pageId);
    if (!page) return;
    updatePage(pageId, {
      links: [...page.links, { label: '', target: '/', type: 'inline' as const }],
    });
  };

  const updateLink = (pageId: string, linkIdx: number, updates: Partial<PageLink>) => {
    const page = formData.pages.find(p => p.id === pageId);
    if (!page) return;
    const links = page.links.map((l, i) => i === linkIdx ? { ...l, ...updates } : l);
    updatePage(pageId, { links });
  };

  const removeLink = (pageId: string, linkIdx: number) => {
    const page = formData.pages.find(p => p.id === pageId);
    if (!page) return;
    updatePage(pageId, { links: page.links.filter((_, i) => i !== linkIdx) });
  };

  const toggleSection = (pageId: string, section: SectionType) => {
    const page = formData.pages.find(p => p.id === pageId);
    if (!page) return;
    const sections = page.sections.includes(section)
      ? page.sections.filter(s => s !== section)
      : [...page.sections, section];
    updatePage(pageId, { sections });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-xl font-bold text-text-primary">Pages & Navigation</h2>
        <p className="text-sm text-text-secondary">
          Define each page's sections and the links that should appear on it. Pages marked "In Nav" will appear in the main navigation bar.
        </p>
      </div>

      {/* Navigation Settings */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-3">
        <button onClick={() => setShowNavSettings(!showNavSettings)} className="flex items-center justify-between w-full text-left">
          <div className="flex items-center gap-2">
            <Bars3Icon className="h-4 w-4 text-brand-primary" />
            <span className="text-sm font-medium text-text-primary">Navigation Settings</span>
          </div>
          {showNavSettings ? <ChevronUpIcon className="h-4 w-4 text-text-tertiary" /> : <ChevronDownIcon className="h-4 w-4 text-text-tertiary" />}
        </button>
        {showNavSettings && (
          <div className="mt-3 space-y-3 pt-3 border-t border-border-primary">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Nav Style</label>
              <div className="grid grid-cols-3 gap-2">
                {([['horizontal', 'Horizontal Bar'], ['sidebar', 'Sidebar Nav'], ['hamburger', 'Hamburger Menu']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setFormData({ ...formData, navStyle: val })}
                    className={`rounded-lg border p-2 text-xs text-center transition-all ${formData.navStyle === val ? 'border-brand-primary bg-brand-primary/10 text-text-primary' : 'border-border-primary text-text-tertiary hover:border-brand-primary/50'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={formData.stickyNav} onChange={(e) => setFormData({ ...formData, stickyNav: e.target.checked })} className="h-4 w-4 rounded accent-brand-primary" />
              <span className="text-xs text-text-primary">Sticky/fixed navigation bar</span>
            </label>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Social Links</label>
              <div className="space-y-1">
                {['twitter', 'github', 'linkedin', 'instagram'].map(platform => {
                  const existing = formData.socialLinks.find(s => s.platform === platform);
                  return (
                    <div key={platform} className="flex items-center gap-2">
                      <span className="text-xs text-text-tertiary w-16 capitalize">{platform}</span>
                      <input type="text" value={existing?.url || ''} placeholder={`https://${platform}.com/...`}
                        onChange={(e) => {
                          const links = formData.socialLinks.filter(s => s.platform !== platform);
                          if (e.target.value) links.push({ platform, url: e.target.value });
                          setFormData({ ...formData, socialLinks: links });
                        }}
                        className="flex-1 rounded border border-border-primary bg-background-tertiary px-2 py-1 text-xs text-text-primary placeholder:text-text-quaternary" />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pages */}
      <div className="space-y-3">
        {formData.pages.map((page, idx) => {
          const isExpanded = expandedPage === page.id;
          return (
            <div key={page.id} className="rounded-lg border border-border-primary bg-background-secondary overflow-hidden">
              {/* Page Header (always visible) */}
              <div className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-primary/10 text-xs font-bold text-brand-primary">{idx + 1}</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={page.isInMainNav} onChange={(e) => updatePage(page.id, { isInMainNav: e.target.checked })} className="h-3 w-3 rounded accent-brand-primary" />
                    <span className="text-[10px] text-text-tertiary">In Nav</span>
                  </label>
                  <span className="flex-1" />
                  <button onClick={() => setExpandedPage(isExpanded ? null : page.id)} className="text-text-tertiary hover:text-text-primary text-xs flex items-center gap-1">
                    {page.sections.length} sections, {page.links.length} links
                    {isExpanded ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
                  </button>
                  {formData.pages.length > 1 && (
                    <button onClick={() => removePage(page.id)} className="text-text-quaternary hover:text-semantic-error"><TrashIcon className="h-4 w-4" /></button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input label="Page Name" value={page.name} onChange={(e) => updatePage(page.id, { name: e.target.value })} placeholder="Home" />
                  <Input label="URL Path" value={page.path} onChange={(e) => updatePage(page.id, { path: e.target.value })} placeholder="/" />
                </div>
                <div className="mt-2">
                  <Input label="Description" value={page.description} onChange={(e) => updatePage(page.id, { description: e.target.value })} placeholder="What should this page contain?" />
                </div>
              </div>

              {/* Expanded: Sections & Links */}
              {isExpanded && (
                <div className="border-t border-border-primary bg-background-tertiary/30 p-3 space-y-3">
                  {/* Sections */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-text-secondary">Page Sections (in order)</label>
                    <div className="flex flex-wrap gap-1.5">
                      {SECTION_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => toggleSection(page.id, opt.value)}
                          className={`text-xs px-2 py-1 rounded-full transition-all ${page.sections.includes(opt.value) ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30' : 'bg-background-tertiary text-text-tertiary border border-border-primary hover:border-brand-primary/30'}`}
                          title={opt.desc}>
                          {page.sections.includes(opt.value) ? '✓ ' : ''}{opt.label}
                        </button>
                      ))}
                    </div>
                    {page.sections.length > 0 && (
                      <p className="text-[10px] text-text-quaternary mt-1">Order: {page.sections.join(' → ')}</p>
                    )}
                  </div>

                  {/* Links on this page */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-text-secondary">Links on This Page</label>
                    {page.links.length > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {page.links.map((link, linkIdx) => (
                          <div key={linkIdx} className="flex items-center gap-2 rounded border border-border-primary bg-background-secondary p-2">
                            <input type="text" value={link.label} onChange={(e) => updateLink(page.id, linkIdx, { label: e.target.value })}
                              placeholder="Link text" className="flex-1 rounded border border-border-primary bg-background-tertiary px-2 py-1 text-xs text-text-primary placeholder:text-text-quaternary" />
                            <input type="text" value={link.target} onChange={(e) => updateLink(page.id, linkIdx, { target: e.target.value })}
                              placeholder="/about or https://..." className="flex-1 rounded border border-border-primary bg-background-tertiary px-2 py-1 text-xs text-text-primary placeholder:text-text-quaternary" />
                            <select value={link.type} onChange={(e) => updateLink(page.id, linkIdx, { type: e.target.value as PageLink['type'] })}
                              className="rounded border border-border-primary bg-background-tertiary px-1 py-1 text-xs text-text-primary">
                              <option value="inline">Inline</option>
                              <option value="cta">CTA Button</option>
                              <option value="nav">Nav Item</option>
                              <option value="footer">Footer</option>
                            </select>
                            <button onClick={() => removeLink(page.id, linkIdx)} className="text-text-quaternary hover:text-semantic-error"><TrashIcon className="h-3.5 w-3.5" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => addLinkToPage(page.id)} className="text-xs text-brand-primary hover:text-brand-primary/80 flex items-center gap-1">
                      <PlusIcon className="h-3 w-3" /> Add link
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button onClick={addPage} variant="secondary" size="sm" fullWidth leftIcon={<PlusIcon className="h-4 w-4" />}>
        Add Another Page
      </Button>
    </div>
  );
}

// ============================================================================
// STEP 3: DESIGN
// ============================================================================

function DesignStep({ formData, setFormData }: { formData: WebsiteSprintData; setFormData: (d: WebsiteSprintData) => void }) {
  const styles: Array<{ value: WebsiteSprintData['designStyle']; label: string; desc: string }> = [
    { value: 'minimal', label: 'Minimal', desc: 'Clean whitespace, simple lines' },
    { value: 'modern', label: 'Modern', desc: 'Trendy gradients, rounded corners' },
    { value: 'classic', label: 'Classic', desc: 'Timeless professional look' },
    { value: 'bold', label: 'Bold', desc: 'Strong colors, large type' },
    { value: 'elegant', label: 'Elegant', desc: 'Refined luxury aesthetic' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-xl font-bold text-text-primary">Design Your Style</h2>
        <p className="text-sm text-text-secondary">Choose the visual direction for your website</p>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">Aesthetic</label>
        <div className="grid grid-cols-5 gap-2">
          {styles.map(style => (
            <button key={style.value} onClick={() => setFormData({ ...formData, designStyle: style.value })}
              className={`rounded-lg border-2 p-3 text-center transition-all ${formData.designStyle === style.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
              <div className="text-sm font-semibold text-text-primary">{style.label}</div>
              <div className="text-[10px] text-text-tertiary mt-0.5">{style.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-primary">Primary Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={formData.primaryColor} onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })} className="h-10 w-10 cursor-pointer rounded border border-border-primary bg-transparent" />
            <input type="text" value={formData.primaryColor} onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })} className="flex-1 rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary font-mono" />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-primary">Secondary Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={formData.secondaryColor} onChange={(e) => setFormData({ ...formData, secondaryColor: e.target.value })} className="h-10 w-10 cursor-pointer rounded border border-border-primary bg-transparent" />
            <input type="text" value={formData.secondaryColor} onChange={(e) => setFormData({ ...formData, secondaryColor: e.target.value })} className="flex-1 rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary font-mono" />
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="h-8 flex-1 rounded-lg" style={{ background: formData.primaryColor }} />
        <div className="h-8 flex-1 rounded-lg" style={{ background: formData.secondaryColor }} />
        <div className="h-8 flex-1 rounded-lg" style={{ background: `linear-gradient(135deg, ${formData.primaryColor}, ${formData.secondaryColor})` }} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">Typography</label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'sans-serif' as const, label: 'Sans-Serif', preview: 'Inter, Helvetica' },
            { value: 'serif' as const, label: 'Serif', preview: 'Georgia, Times' },
            { value: 'mono' as const, label: 'Monospace', preview: 'JetBrains Mono' },
          ].map(opt => (
            <button key={opt.value} onClick={() => setFormData({ ...formData, typography: opt.value })}
              className={`rounded-lg border-2 p-3 text-left transition-all ${formData.typography === opt.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
              <div className={`text-sm font-semibold text-text-primary ${opt.value === 'serif' ? 'font-serif' : opt.value === 'mono' ? 'font-mono' : 'font-sans'}`}>{opt.label}</div>
              <div className="text-[10px] text-text-tertiary">{opt.preview}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// STEP 4: TECHNICAL
// ============================================================================

function TechnicalStep({ formData, setFormData, toggleFeature }: {
  formData: WebsiteSprintData;
  setFormData: (d: WebsiteSprintData) => void;
  toggleFeature: (f: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="mb-1 text-xl font-bold text-text-primary">Technical Stack</h2>
        <p className="text-sm text-text-secondary">Choose frameworks, features, and deployment</p>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">Framework</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'static', label: 'Vanilla HTML/CSS/JS', desc: 'Simple, fast, no build step' },
            { value: 'react', label: 'React', desc: 'Component-based SPA' },
            { value: 'vue', label: 'Vue', desc: 'Progressive framework' },
            { value: 'svelte', label: 'Svelte', desc: 'Compile-time framework' },
          ].map(fw => (
            <button key={fw.value} onClick={() => setFormData({ ...formData, framework: fw.value as WebsiteSprintData['framework'] })}
              className={`rounded-lg border-2 p-3 text-left transition-all ${formData.framework === fw.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
              <div className="text-sm font-semibold text-text-primary">{fw.label}</div>
              <div className="text-[10px] text-text-tertiary">{fw.desc}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-primary">Features</label>
        <div className="grid grid-cols-2 gap-2">
          {['Contact Form', 'Newsletter Signup', 'Blog', 'E-commerce', 'Dark Mode', 'Analytics', 'Search', 'Image Gallery'].map(feature => (
            <button key={feature} onClick={() => toggleFeature(feature)}
              className={`rounded-lg border-2 p-2.5 text-left text-sm transition-all ${formData.features.includes(feature) ? 'border-brand-primary bg-brand-primary/10 text-text-primary' : 'border-border-primary hover:border-brand-primary/50 text-text-secondary'}`}>
              <span className="mr-1.5">{formData.features.includes(feature) ? '✓' : '○'}</span>{feature}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {[
          { key: 'includeAnimations', label: 'Include Animations & Transitions' },
          { key: 'includeContactForm', label: 'Include Contact Form' },
          { key: 'seoOptimized', label: 'SEO Optimized' },
          { key: 'includeDeployConfig', label: 'Include Deployment Config (deploy.sh + hosting config)' },
        ].map(toggle => (
          <label key={toggle.key} className="flex items-center gap-3 rounded-lg border border-border-primary p-2.5 cursor-pointer hover:bg-background-tertiary transition-colors">
            <input type="checkbox" checked={(formData as any)[toggle.key]} onChange={(e) => setFormData({ ...formData, [toggle.key]: e.target.checked })} className="h-4 w-4 rounded accent-brand-primary" />
            <span className="text-sm text-text-primary">{toggle.label}</span>
          </label>
        ))}
      </div>
      {formData.includeDeployConfig && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-primary">Deploy Target</label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { value: 'vercel', label: 'Vercel' },
              { value: 'netlify', label: 'Netlify' },
              { value: 'cloudflare', label: 'Cloudflare' },
              { value: 'custom', label: 'Custom' },
            ].map(h => (
              <button key={h.value} onClick={() => setFormData({ ...formData, hosting: h.value as WebsiteSprintData['hosting'] })}
                className={`rounded-lg border-2 p-2.5 text-sm text-center transition-all ${formData.hosting === h.value ? 'border-brand-primary bg-brand-primary/10 text-text-primary' : 'border-border-primary text-text-tertiary hover:border-brand-primary/50'}`}>
                {h.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// STEP 5: REVIEW
// ============================================================================

function ReviewStep({ formData }: { formData: WebsiteSprintData }) {
  const navPages = formData.pages.filter(p => p.isInMainNav);
  const totalSections = formData.pages.reduce((sum, p) => sum + p.sections.length, 0);
  const totalLinks = formData.pages.reduce((sum, p) => sum + p.links.length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-1 text-xl font-bold text-text-primary">Review & Launch</h2>
        <p className="text-sm text-text-secondary">Confirm your settings. ALIN will spawn 6 specialized pods to build your website.</p>
      </div>

      <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-text-primary">{formData.projectName || 'Website Sprint'}</h3>
          <p className="text-sm text-text-tertiary mt-0.5">{formData.objective || 'No objective set'}</p>
        </div>

        <div className="grid grid-cols-4 gap-2 text-sm">
          {[
            { label: 'Quality', value: formData.qualityTarget },
            { label: 'Time', value: `${formData.timeBudget} min` },
            { label: 'Pages', value: formData.pages.length },
            { label: 'Sections', value: totalSections },
          ].map(stat => (
            <div key={stat.label} className="rounded-lg bg-background-tertiary p-2">
              <span className="text-text-quaternary text-[10px] block">{stat.label}</span>
              <span className="font-medium text-text-primary">{stat.value}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-lg bg-background-tertiary p-2">
            <span className="text-text-quaternary text-[10px] block">Style</span>
            <span className="font-medium text-text-primary capitalize">{formData.designStyle}</span>
          </div>
          <div className="rounded-lg bg-background-tertiary p-2">
            <span className="text-text-quaternary text-[10px] block">Framework</span>
            <span className="font-medium text-text-primary capitalize">{formData.framework}</span>
          </div>
          <div className="rounded-lg bg-background-tertiary p-2">
            <span className="text-text-quaternary text-[10px] block">Nav Style</span>
            <span className="font-medium text-text-primary capitalize">{formData.navStyle}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-text-quaternary">Colors:</span>
          <div className="h-5 w-5 rounded-full border border-border-primary" style={{ background: formData.primaryColor }} />
          <div className="h-5 w-5 rounded-full border border-border-primary" style={{ background: formData.secondaryColor }} />
        </div>

        {/* Pages with sections & links */}
        <div>
          <span className="text-[10px] text-text-quaternary block mb-1">Site Map ({navPages.length} in nav, {totalLinks} links):</span>
          <div className="space-y-1">
            {formData.pages.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                {p.isInMainNav && <span className="text-[9px] px-1 rounded bg-brand-primary/10 text-brand-primary">NAV</span>}
                <span className="text-text-primary font-medium">{p.name}</span>
                <span className="text-text-quaternary">{p.path}</span>
                <span className="text-text-quaternary ml-auto">{p.sections.length} sections</span>
                {p.links.length > 0 && <span className="text-text-quaternary">{p.links.length} links</span>}
              </div>
            ))}
          </div>
        </div>

        {formData.features.length > 0 && (
          <div>
            <span className="text-[10px] text-text-quaternary block mb-1">Features:</span>
            <div className="flex flex-wrap gap-1.5">
              {formData.features.map(f => (
                <span key={f} className="text-xs px-2 py-0.5 rounded-full bg-semantic-success/10 text-semantic-success">{f}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Output structure preview */}
      <div className="rounded-lg bg-background-tertiary p-3">
        <p className="text-xs font-medium text-text-primary mb-2">Output Bundle:</p>
        <pre className="text-[10px] text-text-secondary font-mono leading-relaxed">{`output/tbwo/${(formData.projectName || 'website').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)}/
  site/           HTML pages + CSS + JS
  assets/         Images, icons, fonts
  README.md       How to deploy
  receipt.json    Build decisions & metrics${formData.includeDeployConfig ? `\n  deploy.sh       Deployment script\n  ${formData.hosting === 'netlify' ? 'netlify.toml' : formData.hosting === 'vercel' ? 'vercel.json' : 'deploy.config'}` : ''}`}</pre>
      </div>

      {/* Pods preview */}
      <div className="rounded-lg bg-brand-primary/5 border border-brand-primary/20 p-3">
        <p className="text-sm font-medium text-brand-primary mb-2">6 Agent Pods Will Execute:</p>
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { name: 'Orchestrator', desc: 'Coordinates all pods' },
            { name: 'Design Pod', desc: 'Visual design system' },
            { name: 'Copy Pod', desc: 'Content & copywriting' },
            { name: 'Frontend Pod', desc: 'HTML/CSS/JS code' },
            { name: 'Motion Pod', desc: 'Animations' },
            { name: 'QA Pod', desc: 'Testing & quality' },
          ].map(pod => (
            <div key={pod.name} className="rounded bg-background-secondary p-2">
              <div className="font-medium text-text-primary">{pod.name}</div>
              <div className="text-text-quaternary text-[10px]">{pod.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
