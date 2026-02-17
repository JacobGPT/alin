/**
 * Website Sprint Wizard — Full Pipeline Intake Flow
 *
 * Flow: Input → Extract → Questions (if needed) → Review Brief → Generate → Preview → Deploy
 *
 * Step 1: "What are we building?"
 *   - Paste a thread/conversation (primary)
 *   - Write a short description (fallback)
 *   - Optional context hints (ecom, services, creator, etc.)
 *
 * Step 2: "We need a few more details" (optional — only if blocking questions)
 *   - Shows blocking questions from brief extraction
 *   - User answers fill in brief fields
 *
 * Step 3: "Here's what I think you want."
 *   - Shows extracted Site Brief for approve/edit
 *   - Edits stored as USER_PROVIDED
 *
 * Step 4: "Building your site..."
 *   - Live pipeline stage progress (validate → repair → package)
 *   - Monitors TBWO execution + sandbox pipeline
 *
 * Step 5: "Preview & Deploy"
 *   - File tree, validation report, deploy button
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftIcon,
  RocketLaunchIcon,
  ChatBubbleLeftRightIcon,
  PencilIcon,
  SparklesIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  GlobeAltIcon,
  QuestionMarkCircleIcon,
  DocumentTextIcon,
  FolderIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';

// Store
import { useTBWOStore } from '../../store/tbwoStore';
import { useUIStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';

// Components
import { Button } from '../../components/ui/Button';

// Types & Factory
import { QualityTarget, TBWOStatus } from '../../types/tbwo';
import type { NavigationConfig, OutputStructure, WebsiteSprintConfig, PageMediaAsset, ALINSuggestion, ColorScheme, TypographyPreferences } from '../../types/tbwo';
import { createWebsiteSprintTBWO } from './template';

// API
import * as dbService from '../../api/dbService';
import type { SiteBrief, MissingQuestion, SandboxPipelineStatus, ValidationReport, FileTreeNode } from '../../api/dbService';

// Suggestion engine
import { generateSuggestions } from './suggestionEngine';

// Model tier presets
import { MODEL_TIER_PRESETS, type ModelTier } from '../../services/tbwo/modelRouter';

// Cognitive subsystem (lazy — imported at use site)
import type { CognitiveBrief } from './cognitive/types';

// ============================================================================
// TYPES
// ============================================================================

interface WebsiteSprintWizardProps {
  onComplete?: (tbwoId: string) => void;
}

type WizardPhase = 'input' | 'extracting' | 'questions' | 'brief' | 'design-media' | 'animation-effects' | 'launching' | 'generating' | 'preview' | 'deploying' | 'deployed';

type SourceType = 'THREAD' | 'DESCRIPTION';

const CONTEXT_HINTS = [
  { value: 'local-service', label: 'Local Service' },
  { value: 'creator', label: 'Creator / Personal' },
  { value: 'ecom', label: 'E-commerce' },
  { value: 'saas', label: 'App / SaaS' },
  { value: 'agency', label: 'Agency / Portfolio' },
  { value: 'nonprofit', label: 'Nonprofit' },
] as const;

const PIPELINE_STAGES = ['init', 'validate', 'repair', 'package'] as const;

// ============================================================================
// WIZARD COMPONENT
// ============================================================================

export function WebsiteSprintWizard({ onComplete }: WebsiteSprintWizardProps) {
  // Phase state
  const [phase, setPhase] = useState<WizardPhase>('input');

  // Input state
  const [sourceType, setSourceType] = useState<SourceType>('DESCRIPTION');
  const [sourceText, setSourceText] = useState('');
  const [contextHint, setContextHint] = useState('');

  // Brief state
  const [brief, setBrief] = useState<SiteBrief | null>(null);
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set());
  const [provenance, setProvenance] = useState<Record<string, string>>({});
  const [missingQuestions, setMissingQuestions] = useState<MissingQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});

  // Launch state
  const [qualityTarget, setQualityTarget] = useState(QualityTarget.PREMIUM);
  const [timeBudget, setTimeBudget] = useState(60);
  const [modelTier, setModelTier] = useState<'budget' | 'pro' | 'max'>('pro');
  const [launchedTbwoId, setLaunchedTbwoId] = useState<string | null>(null);

  // Preview state
  const [fileTree, setFileTree] = useState<FileTreeNode[] | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<SandboxPipelineStatus | null>(null);

  // Deploy state
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  // Design & Media state (Step 3)
  const [colorScheme, setColorScheme] = useState<ColorScheme | null>(null);
  const [typography, setTypography] = useState<TypographyPreferences | null>(null);
  const [selectedAesthetic, setSelectedAesthetic] = useState<WebsiteSprintConfig['aesthetic']>('modern');
  const [pageMedia, setPageMedia] = useState<PageMediaAsset[]>([]);
  const [brandLogoUrl, setBrandLogoUrl] = useState('');
  const [brandGuidelinesText, setBrandGuidelinesText] = useState('');

  // Animation & Effects state (Step 4)
  const [motionIntensity, setMotionIntensity] = useState<'minimal' | 'standard' | 'premium'>('standard');
  const [animationStyles, setAnimationStyles] = useState<string[]>([]);
  const [scene3DEnabled, setScene3DEnabled] = useState(false);
  const [selectedScenePreset, setSelectedScenePreset] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ALINSuggestion[]>([]);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set());
  const [rejectedSuggestions, setRejectedSuggestions] = useState<Set<string>>(new Set());

  // Cognitive analysis state
  const [cognitiveBrief, setCognitiveBrief] = useState<CognitiveBrief | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  const setActiveTBWO = useTBWOStore((state) => state.setActiveTBWO);
  const closeModal = useUIStore((state) => state.closeModal);
  const showSuccess = useUIStore((state) => state.showSuccess);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleExtract = async () => {
    if (sourceText.trim().length < 10) {
      setError('Please enter at least a couple of sentences.');
      return;
    }
    setError(null);
    setPhase('extracting');

    try {
      const selectedModel = useSettingsStore.getState().selectedModelVersions?.claude;
      const result = await dbService.extractBrief(
        sourceText.trim(),
        sourceType,
        contextHint || undefined,
        selectedModel || undefined,
      );
      setBrief(result.brief);
      setProvenance(result.provenance);

      // Run cognitive analysis on the extracted brief (fail-safe)
      let cogClarifications: MissingQuestion[] = [];
      try {
        const { runCognitiveAnalysis } = await import('./cognitive');
        const cogResult = await runCognitiveAnalysis(result, sourceText.trim());
        setCognitiveBrief(cogResult);

        // Merge blocking cognitive clarifications into missingQuestions
        cogClarifications = (cogResult.clarifications || [])
          .filter((c: any) => c.impact === 'blocking' && !c.answered)
          .map((c: any) => ({
            id: c.id || c.field || `cog-${Math.random().toString(36).slice(2, 8)}`,
            question: c.question,
            reason: c.reason || 'Cognitive analysis identified this as blocking',
            blocking: true,
          }));
      } catch (cogErr) {
        console.warn('[Wizard] Cognitive analysis failed (non-blocking):', cogErr);
      }

      // Combine extraction questions + cognitive clarifications
      const allQuestions = [...result.missingQuestions, ...cogClarifications];
      setMissingQuestions(allQuestions);

      // Route: if blocking questions exist → questions phase, else → brief
      const blockingQuestions = allQuestions.filter(q => q.blocking);
      if (blockingQuestions.length > 0) {
        setPhase('questions');
      } else {
        setPhase('brief');
      }
    } catch (err) {
      const msg = (err as Error).message || 'Failed to extract brief';
      if (msg.includes('502') || msg.includes('overload') || msg.includes('529') || msg.includes('503') || msg.includes('unavailable')) {
        setError('AI provider is temporarily unavailable. Please wait a moment and try again.');
      } else {
        setError(msg);
      }
      setPhase('input');
    }
  };

  const handleAnswerQuestion = (questionId: string, answer: string) => {
    setQuestionAnswers(prev => ({ ...prev, [questionId]: answer }));

    // Update brief field directly
    if (brief) {
      setBrief({ ...brief, [questionId]: answer });
      setEditedFields(prev => new Set(prev).add(questionId));
      setProvenance(prev => ({ ...prev, [questionId]: 'USER_PROVIDED' }));
    }
  };

  const handleQuestionsComplete = () => {
    setPhase('brief');
  };

  const handleEditBrief = (field: string, value: unknown) => {
    if (!brief) return;
    setBrief({ ...brief, [field]: value });
    setEditedFields(prev => new Set(prev).add(field));
    setProvenance(prev => ({ ...prev, [field]: 'USER_PROVIDED' }));
  };

  // Transition from Brief → Design & Media (Step 3)
  const handleApproveBrief = () => {
    if (!brief) return;
    // Derive aesthetic from brief's designDirection
    const aestheticMap: Record<string, WebsiteSprintConfig['aesthetic']> = {
      minimal: 'minimal', modern: 'modern', classic: 'classic',
      bold: 'bold', elegant: 'elegant', luxury: 'elegant',
      playful: 'bold', professional: 'modern', clean: 'minimal',
    };
    const dirLower = (brief.designDirection || '').toLowerCase();
    const detectedAesthetic = Object.entries(aestheticMap).find(([k]) => dirLower.includes(k))?.[1] || 'modern';
    setSelectedAesthetic(detectedAesthetic);

    // Generate suggestions for Step 4
    const sug = generateSuggestions(brief);
    setSuggestions(sug);

    setPhase('design-media');
  };

  // Transition from Design & Media → Animation & Effects (Step 4)
  const handleDesignMediaNext = () => {
    setPhase('animation-effects');
  };

  // Toggle an animation style checkbox
  const toggleAnimationStyle = (style: string) => {
    setAnimationStyles(prev =>
      prev.includes(style) ? prev.filter(s => s !== style) : [...prev, style]
    );
  };

  // Accept/reject a suggestion
  const handleAcceptSuggestion = (id: string) => {
    setAcceptedSuggestions(prev => { const next = new Set(prev); next.add(id); return next; });
    setRejectedSuggestions(prev => { const next = new Set(prev); next.delete(id); return next; });
  };
  const handleRejectSuggestion = (id: string) => {
    setRejectedSuggestions(prev => { const next = new Set(prev); next.add(id); return next; });
    setAcceptedSuggestions(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  // Final launch — creates TBWO with all wizard state merged
  const handleFinalLaunch = async () => {
    if (!brief) return;
    setPhase('launching');

    try {
      const logoText = brief.productName || brief.businessType || 'My Site';

      const navigation: NavigationConfig = {
        style: 'horizontal',
        sticky: true,
        logoText,
        footerLinks: [],
        socialLinks: [],
      };

      const outputStructure: OutputStructure = {
        rootFolder: '',
        siteFolder: '',
        assetsFolder: 'assets',
        cssFile: 'styles.css',
        includeReadme: true,
        includeReceipt: true,
        includeDeployScript: false,
      };

      const navPages = brief.navPages?.length ? brief.navPages : brief.pages;
      const pages = navPages.map((pageName, idx) => {
        const lower = pageName.toLowerCase();
        const isHome = idx === 0 || lower === 'home';

        // Map page name to appropriate sections based on page type
        type SType = 'hero' | 'features' | 'about' | 'testimonials' | 'cta' | 'footer' | 'gallery' | 'pricing' | 'faq' | 'team' | 'blog' | 'custom';
        let sections: Array<{ type: SType }>;
        if (isHome) {
          sections = [{ type: 'hero' }, { type: 'features' }, { type: 'about' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('pricing') || lower.includes('plans')) {
          sections = [{ type: 'hero' }, { type: 'pricing' }, { type: 'faq' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('about') || lower.includes('story') || lower.includes('team')) {
          sections = [{ type: 'hero' }, { type: 'about' }, { type: 'team' }, { type: 'footer' }];
        } else if (lower.includes('contact') || lower.includes('support')) {
          sections = [{ type: 'hero' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('testimonial') || lower.includes('review') || lower.includes('case stud')) {
          sections = [{ type: 'hero' }, { type: 'testimonials' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('feature') || lower.includes('product') || lower.includes('service') || lower.includes('solution')) {
          sections = [{ type: 'hero' }, { type: 'features' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('blog') || lower.includes('news') || lower.includes('article')) {
          sections = [{ type: 'hero' }, { type: 'blog' }, { type: 'footer' }];
        } else if (lower.includes('faq') || lower.includes('help')) {
          sections = [{ type: 'hero' }, { type: 'faq' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('gallery') || lower.includes('portfolio') || lower.includes('showcase')) {
          sections = [{ type: 'hero' }, { type: 'gallery' }, { type: 'footer' }];
        } else if (lower.includes('demo') || lower.includes('trial') || lower.includes('signup') || lower.includes('register')) {
          sections = [{ type: 'hero' }, { type: 'features' }, { type: 'cta' }, { type: 'footer' }];
        } else if (lower.includes('integration') || lower.includes('partner') || lower.includes('ecosystem')) {
          sections = [{ type: 'hero' }, { type: 'features' }, { type: 'cta' }, { type: 'footer' }];
        } else {
          // Default: hero + about + cta + footer
          sections = [{ type: 'hero' }, { type: 'about' }, { type: 'cta' }, { type: 'footer' }];
        }

        return {
          name: pageName,
          path: isHome ? '/' : `/${pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          sections,
          links: [],
          isInMainNav: true,
          navOrder: idx,
        };
      });

      const config: Partial<WebsiteSprintConfig> = {
        pages,
        navigation,
        outputStructure,
        aesthetic: selectedAesthetic,
        framework: 'static',
        includeAnimations: true,
        includeContactForm: brief.features.some(f => f.toLowerCase().includes('contact')),
        seoOptimized: true,
        responsive: true,
        includeDeployConfig: true,
        deployTarget: 'cloudflare',
        // Step 3: Design & Media config
        ...(colorScheme ? { colorScheme } : {}),
        ...(typography ? { typography } : {}),
        brandAssets: {
          ...(brandLogoUrl ? { logoUrl: brandLogoUrl } : {}),
          ...(brandGuidelinesText ? { brandGuidelinesText } : {}),
        },
        pageMedia: pageMedia.length > 0 ? pageMedia : undefined,
        // Step 4: Animation & Effects config
        motionIntensity,
        animationStyles: animationStyles.length > 0 ? animationStyles : undefined,
        scene3DEnabled,
        scenePreset: selectedScenePreset || undefined,
        acceptedSuggestions: acceptedSuggestions.size > 0 ? Array.from(acceptedSuggestions) : undefined,
        rejectedSuggestions: rejectedSuggestions.size > 0 ? Array.from(rejectedSuggestions) : undefined,
      };

      const displayName = brief.productName || brief.businessType;
      const objective = `Build the ${displayName} website: ${brief.oneLinerPositioning || brief.goal}`;

      const tbwo = createWebsiteSprintTBWO(objective, config, {
        timeBudget,
        qualityTarget,
        brief,
      });

      const tbwoId = useTBWOStore.getState().createTBWO({
        type: tbwo.type,
        objective: tbwo.objective,
        timeBudgetMinutes: timeBudget,
        qualityTarget,
      });

      // Build full provenance map
      const fullProvenance: Record<string, string> = { ...provenance };
      for (const field of editedFields) {
        fullProvenance[field] = 'USER_PROVIDED';
      }

      // Apply model tier routing rules
      const tierPreset = MODEL_TIER_PRESETS[modelTier];
      const modelRoutingConfig = {
        enabled: true,
        rules: tierPreset.rules.map(r => ({
          podRole: r.podRole as any,
          provider: r.provider,
          model: r.model,
          reason: r.reason,
        })),
        fallback: tierPreset.fallback,
      };

      // Store routing config in settings so modelRouter picks it up
      useSettingsStore.getState().updateTBWOPreferences({ modelRouting: modelRoutingConfig });

      useTBWOStore.getState().updateTBWO(tbwoId, {
        plan: tbwo.plan,
        pods: tbwo.pods,
        scope: tbwo.scope,
        status: tbwo.status,
        estimatedCost: tbwo.estimatedCost,
        authorityLevel: tbwo.authorityLevel,
        metadata: {
          ...(tbwo.metadata || {}),  // Merge factory-generated metadata (e.g. motionSpec)
          siteBrief: brief,
          sprintConfig: config,
          sourceType,
          sourceTextLength: sourceText.length,
          contextHint,
          provenance: fullProvenance,
          rawSourceArtifact: sourceText.length > 1000 ? '[stored separately]' : sourceText,
          modelTier,
          ...(cognitiveBrief ? { cognitiveBrief } : {}),
        },
      });

      // Pre-populate Pause & Ask questions from requiredUnknowns
      // Only include truly critical questions that ALIN cannot infer.
      // Questions about style, layout, colors, fonts etc. are auto-decided by pods.
      const AUTO_DECIDABLE_PATTERNS = /color|font|style|layout|aesthetic|icon|image|animation|section order|typography|spacing|tone/i;
      const unknowns = brief.requiredUnknowns?.filter(
        (u: any) => {
          if (u.required === false || u.answer) return false;
          const q = typeof u === 'string' ? u : u.question || '';
          // Filter out questions that ALIN can auto-decide
          return !AUTO_DECIDABLE_PATTERNS.test(q);
        }
      ) || [];
      if (unknowns.length > 0) {
        const { nanoid } = await import('nanoid');
        const { PauseReason } = await import('../../types/tbwo');
        // Cap at 3 questions max to reduce friction
        for (let i = 0; i < Math.min(unknowns.length, 3); i++) {
          const u = unknowns[i]!;
          const fieldName = (typeof u === 'string' ? `question_${i}` : u.id) || `question_${i}`;
          const question = typeof u === 'string' ? u : u.question;
          useTBWOStore.getState().addPauseRequest(tbwoId, {
            id: nanoid(),
            tbwoId,
            podId: 'pre-execution',
            phase: 'pre-execution',
            contextPath: fieldName,
            reason: PauseReason.MISSING_CRITICAL_FACT,
            question,
            requiredFields: [fieldName],
            canInferFromVagueAnswer: true,
            resumeCheckpointId: '',
            status: 'pending',
            createdAt: Date.now(),
          });
        }
      }

      setActiveTBWO(tbwoId);
      setLaunchedTbwoId(tbwoId);
      onComplete?.(tbwoId);
      // Close the wizard modal so user sees the TBWO dashboard immediately
      closeModal();
    } catch (err) {
      console.error('[WebsiteSprintWizard] Launch failed:', err);
      setError((err as Error).message || 'Failed to create sprint');
      setPhase('brief');
    }
  };

  // Monitor TBWO completion
  useEffect(() => {
    if (phase !== 'generating' || !launchedTbwoId) return;

    const interval = setInterval(() => {
      const tbwo = useTBWOStore.getState().getTBWOById(launchedTbwoId);
      if (!tbwo) return;

      if (tbwo.status === TBWOStatus.COMPLETED) {
        // Fetch sandbox pipeline status
        dbService.getSandboxStatus(launchedTbwoId).then(status => {
          setPipelineStatus(status);
          if (status.currentStage === 'completed' || status.currentStage === 'none') {
            setPhase('preview');
            clearInterval(interval);
          }
        }).catch(() => {
          // No sandbox pipeline — go straight to preview
          setPhase('preview');
          clearInterval(interval);
        });
      } else if (tbwo.status === TBWOStatus.FAILED) {
        setError('Site generation failed. Check the TBWO dashboard for details.');
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [phase, launchedTbwoId]);

  // Poll sandbox pipeline status during generation
  useEffect(() => {
    if (phase !== 'generating' || !launchedTbwoId) return;

    const interval = setInterval(async () => {
      try {
        const status = await dbService.getSandboxStatus(launchedTbwoId);
        setPipelineStatus(status);
      } catch {
        // Ignore — pipeline may not have started yet
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [phase, launchedTbwoId]);

  // Fetch preview data when entering preview phase
  useEffect(() => {
    if (phase !== 'preview' || !launchedTbwoId) return;

    (async () => {
      try {
        const [manifest, validation] = await Promise.all([
          dbService.getWorkspaceManifest(launchedTbwoId),
          dbService.validateWorkspace(
            launchedTbwoId,
            brief?.navPages || brief?.pages,
          ),
        ]);
        setFileTree(manifest.manifest);
        setValidationReport(validation);
      } catch (err) {
        console.warn('[Wizard] Failed to load preview data:', err);
      }
    })();
  }, [phase, launchedTbwoId, brief]);

  const handleDeploy = useCallback(async () => {
    if (!launchedTbwoId) return;
    setPhase('deploying');
    try {
      const result = await dbService.deploySandbox(launchedTbwoId);
      setDeployUrl(result.url);
      setPhase('deployed');
      showSuccess('Site deployed successfully!');
    } catch (err) {
      setError((err as Error).message || 'Deploy failed');
      setPhase('preview');
    }
  }, [launchedTbwoId, showSuccess]);

  // ========================================================================
  // STEP CONFIG
  // ========================================================================

  const steps = [
    { id: 'input', label: 'Input' },
    ...(missingQuestions.some(q => q.blocking) ? [{ id: 'questions', label: 'Questions' }] : []),
    { id: 'brief', label: 'Brief' },
    { id: 'design-media', label: 'Design' },
    { id: 'animation-effects', label: 'Effects' },
    { id: 'generating', label: 'Generate' },
    { id: 'preview', label: 'Preview' },
  ];

  const currentStepIdx = steps.findIndex(s =>
    s.id === phase ||
    (phase === 'extracting' && s.id === 'input') ||
    (phase === 'launching' && s.id === 'animation-effects') ||
    (phase === 'deploying' && s.id === 'preview') ||
    (phase === 'deployed' && s.id === 'preview')
  );

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="flex flex-col max-h-[80vh]">
      {/* Phase indicator */}
      <div className="border-b border-border-primary bg-background-secondary px-6 py-4 rounded-t-xl">
        <div className="flex items-center gap-3">
          {steps.map((step, idx) => {
            const isCurrent = idx === currentStepIdx;
            const isDone = idx < currentStepIdx;
            return (
              <div key={step.id} className="flex items-center">
                {idx > 0 && <div className={`mx-2 h-px w-8 ${isDone ? 'bg-brand-primary' : 'bg-border-primary'}`} />}
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                    isDone ? 'bg-brand-primary text-white' : isCurrent ? 'border-2 border-brand-primary text-brand-primary' : 'border border-border-primary text-text-quaternary'
                  }`}>
                    {isDone ? <CheckCircleIcon className="h-4 w-4" /> : idx + 1}
                  </div>
                  <span className={`text-sm font-medium ${isCurrent || isDone ? 'text-text-primary' : 'text-text-quaternary'}`}>{step.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {phase === 'input' && (
              <InputPhase
                sourceType={sourceType}
                setSourceType={setSourceType}
                sourceText={sourceText}
                setSourceText={setSourceText}
                contextHint={contextHint}
                setContextHint={setContextHint}
              />
            )}
            {phase === 'extracting' && <ExtractingPhase />}
            {phase === 'questions' && (
              <QuestionsPhase
                questions={missingQuestions}
                answers={questionAnswers}
                onAnswer={handleAnswerQuestion}
                onContinue={handleQuestionsComplete}
              />
            )}
            {phase === 'brief' && brief && (
              <BriefPhase
                brief={brief}
                editedFields={editedFields}
                onEdit={handleEditBrief}
                qualityTarget={qualityTarget}
                setQualityTarget={setQualityTarget}
                timeBudget={timeBudget}
                setTimeBudget={setTimeBudget}
                provenance={provenance}
                modelTier={modelTier}
                setModelTier={setModelTier}
              />
            )}
            {phase === 'design-media' && brief && (
              <DesignMediaPhase
                brief={brief}
                colorScheme={colorScheme}
                setColorScheme={setColorScheme}
                typography={typography}
                setTypography={setTypography}
                selectedAesthetic={selectedAesthetic}
                setSelectedAesthetic={setSelectedAesthetic}
                pageMedia={pageMedia}
                setPageMedia={setPageMedia}
                brandLogoUrl={brandLogoUrl}
                setBrandLogoUrl={setBrandLogoUrl}
                brandGuidelinesText={brandGuidelinesText}
                setBrandGuidelinesText={setBrandGuidelinesText}
              />
            )}
            {phase === 'animation-effects' && (
              <AnimationEffectsPhase
                motionIntensity={motionIntensity}
                setMotionIntensity={setMotionIntensity}
                animationStyles={animationStyles}
                toggleAnimationStyle={toggleAnimationStyle}
                scene3DEnabled={scene3DEnabled}
                setScene3DEnabled={setScene3DEnabled}
                selectedScenePreset={selectedScenePreset}
                setSelectedScenePreset={setSelectedScenePreset}
                suggestions={suggestions}
                acceptedSuggestions={acceptedSuggestions}
                rejectedSuggestions={rejectedSuggestions}
                onAccept={handleAcceptSuggestion}
                onReject={handleRejectSuggestion}
              />
            )}
            {phase === 'launching' && <LaunchingPhase />}
            {phase === 'generating' && (
              <GeneratingPhase
                tbwoId={launchedTbwoId}
                pipelineStatus={pipelineStatus}
              />
            )}
            {phase === 'preview' && (
              <PreviewPhase
                fileTree={fileTree}
                validationReport={validationReport}
                tbwoId={launchedTbwoId}
              />
            )}
            {phase === 'deploying' && <DeployingPhase />}
            {phase === 'deployed' && <DeployedPhase url={deployUrl} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mb-2 flex items-center gap-2 rounded-lg bg-semantic-error/10 border border-semantic-error/20 px-3 py-2">
          <ExclamationTriangleIcon className="h-4 w-4 text-semantic-error flex-shrink-0" />
          <p className="text-xs text-semantic-error flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-semantic-error underline">Dismiss</button>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between border-t border-border-primary bg-background-secondary px-6 py-3 rounded-b-xl">
        {phase === 'input' && (
          <>
            <div />
            <Button
              variant="primary"
              size="sm"
              onClick={handleExtract}
              disabled={sourceText.trim().length < 10}
              leftIcon={<SparklesIcon className="h-4 w-4" />}
            >
              Extract Brief
            </Button>
          </>
        )}
        {phase === 'extracting' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPhase('input')} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>
              Cancel
            </Button>
            <div />
          </>
        )}
        {phase === 'questions' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPhase('input')} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleQuestionsComplete}
              disabled={missingQuestions.filter(q => q.blocking).some(q => !questionAnswers[q.id]?.trim())}
            >
              Continue
            </Button>
          </>
        )}
        {phase === 'brief' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPhase(missingQuestions.some(q => q.blocking) ? 'questions' : 'input')} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleApproveBrief}
              leftIcon={<SparklesIcon className="h-4 w-4" />}
            >
              Next: Design & Media
            </Button>
          </>
        )}
        {phase === 'design-media' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPhase('brief')} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleDesignMediaNext}
            >
              Next: Effects
            </Button>
          </>
        )}
        {phase === 'animation-effects' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setPhase('design-media')} leftIcon={<ArrowLeftIcon className="h-4 w-4" />}>
              Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleFinalLaunch}
              leftIcon={<RocketLaunchIcon className="h-4 w-4" />}
            >
              Approve & Create Sprint
            </Button>
          </>
        )}
        {(phase === 'launching' || phase === 'generating') && (
          <>
            <div />
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              {phase === 'launching' ? 'Creating...' : 'Building...'}
            </div>
          </>
        )}
        {phase === 'preview' && (
          <>
            <Button variant="ghost" size="sm" onClick={closeModal}>
              Close
            </Button>
            <div className="flex gap-2">
              {launchedTbwoId && (
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                  onClick={() => {
                    window.open(`/api/tbwo/${launchedTbwoId}/workspace/zip`, '_blank');
                  }}
                >
                  Download ZIP
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={handleDeploy}
                disabled={validationReport ? !validationReport.canDeploy : true}
                leftIcon={<GlobeAltIcon className="h-4 w-4" />}
              >
                Deploy to Cloudflare
              </Button>
            </div>
          </>
        )}
        {phase === 'deploying' && (
          <>
            <div />
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
              Deploying...
            </div>
          </>
        )}
        {phase === 'deployed' && (
          <>
            <div />
            <Button variant="primary" size="sm" onClick={closeModal}>
              Done
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// PHASE 1: INPUT
// ============================================================================

function InputPhase({
  sourceType,
  setSourceType,
  sourceText,
  setSourceText,
  contextHint,
  setContextHint,
}: {
  sourceType: SourceType;
  setSourceType: (t: SourceType) => void;
  sourceText: string;
  setSourceText: (t: string) => void;
  contextHint: string;
  setContextHint: (h: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">What are we building?</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Paste your idea, notes, or a full conversation. Messy is fine.
        </p>
      </div>

      {/* Source type toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setSourceType('THREAD')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
            sourceType === 'THREAD'
              ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
              : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
          }`}
        >
          <ChatBubbleLeftRightIcon className="h-5 w-5" />
          I'm pasting a thread
        </button>
        <button
          onClick={() => setSourceType('DESCRIPTION')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
            sourceType === 'DESCRIPTION'
              ? 'border-brand-primary bg-brand-primary/10 text-text-primary'
              : 'border-border-primary text-text-secondary hover:border-brand-primary/50'
          }`}
        >
          <PencilIcon className="h-5 w-5" />
          I'm writing a description
        </button>
      </div>

      {/* Text input */}
      <div>
        <textarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder={
            sourceType === 'THREAD'
              ? 'Paste your conversation, email thread, Slack messages, or brainstorm notes here...'
              : 'Describe what you want to build. A few sentences is enough...'
          }
          className="h-40 w-full rounded-lg border border-border-primary bg-background-tertiary px-4 py-3 text-sm text-text-primary placeholder:text-text-quaternary focus:border-brand-primary focus:outline-none resize-none"
        />
        <div className="mt-1 flex justify-between text-xs text-text-quaternary">
          <span>{sourceText.length > 0 ? `${sourceText.length.toLocaleString()} characters` : ''}</span>
          {sourceText.length > 25000 && (
            <span className="text-semantic-warning">Large input — will be chunked for analysis</span>
          )}
        </div>
      </div>

      {/* Context hints */}
      <div>
        <label className="mb-2 block text-sm font-medium text-text-secondary">This is for:</label>
        <div className="flex flex-wrap gap-2">
          {CONTEXT_HINTS.map((hint) => (
            <button
              key={hint.value}
              onClick={() => setContextHint(contextHint === hint.value ? '' : hint.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                contextHint === hint.value
                  ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30'
                  : 'bg-background-tertiary text-text-tertiary border border-border-primary hover:border-brand-primary/30'
              }`}
            >
              {hint.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// EXTRACTING PHASE
// ============================================================================

function ExtractingPhase() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative mb-6">
        <div className="h-16 w-16 rounded-full border-4 border-brand-primary/20" />
        <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-brand-primary border-t-transparent animate-spin" />
        <SparklesIcon className="absolute inset-0 m-auto h-6 w-6 text-brand-primary" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary">Analyzing your input...</h3>
      <p className="mt-2 text-sm text-text-secondary">ALIN is extracting a structured site brief</p>
    </div>
  );
}

// ============================================================================
// QUESTIONS PHASE (NEW)
// ============================================================================

function QuestionsPhase({
  questions,
  answers,
  onAnswer,
  onContinue,
}: {
  questions: MissingQuestion[];
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  onContinue: () => void;
}) {
  const blocking = questions.filter(q => q.blocking);
  const optional = questions.filter(q => !q.blocking);
  const [showOptional, setShowOptional] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">A few quick questions</h2>
        <p className="mt-1 text-sm text-text-secondary">
          We need these to avoid making things up on your site.
        </p>
      </div>

      {/* Blocking questions */}
      <div className="space-y-4">
        {blocking.map((q) => (
          <div key={q.id} className="rounded-lg border border-border-primary bg-background-secondary p-4">
            <div className="flex items-start gap-3">
              <QuestionMarkCircleIcon className="h-5 w-5 text-brand-primary flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{q.question}</p>
                <p className="mt-0.5 text-xs text-text-tertiary">{q.reason}</p>
                <input
                  type="text"
                  value={answers[q.id] || ''}
                  onChange={(e) => onAnswer(q.id, e.target.value)}
                  placeholder="Type your answer..."
                  className="mt-2 w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Optional questions (collapsible) */}
      {optional.length > 0 && (
        <div>
          <button
            onClick={() => setShowOptional(!showOptional)}
            className="text-xs text-text-tertiary hover:text-text-secondary flex items-center gap-1"
          >
            {showOptional ? 'Hide' : 'Show'} {optional.length} optional question{optional.length > 1 ? 's' : ''}
          </button>
          {showOptional && (
            <div className="mt-2 space-y-3">
              {optional.map((q) => (
                <div key={q.id} className="rounded-lg border border-border-primary/50 bg-background-tertiary p-3">
                  <p className="text-sm text-text-secondary">{q.question}</p>
                  <input
                    type="text"
                    value={answers[q.id] || ''}
                    onChange={(e) => onAnswer(q.id, e.target.value)}
                    placeholder="Optional — skip if unsure"
                    className="mt-1.5 w-full rounded-lg border border-border-primary bg-background-secondary px-3 py-1.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LAUNCHING PHASE
// ============================================================================

function LaunchingPhase() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative mb-6">
        <div className="h-16 w-16 rounded-full border-4 border-brand-primary/20" />
        <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-brand-primary border-t-transparent animate-spin" />
        <RocketLaunchIcon className="absolute inset-0 m-auto h-6 w-6 text-brand-primary" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary">Creating your Website Sprint...</h3>
      <p className="mt-2 text-sm text-text-secondary">Setting up pods and execution plan</p>
    </div>
  );
}

// ============================================================================
// GENERATING PHASE (NEW — live pipeline progress)
// ============================================================================

function GeneratingPhase({
  tbwoId,
  pipelineStatus,
}: {
  tbwoId: string | null;
  pipelineStatus: SandboxPipelineStatus | null;
}) {
  return (
    <div className="space-y-6 py-4">
      <div className="text-center">
        <div className="relative inline-block mb-4">
          <div className="h-16 w-16 rounded-full border-4 border-brand-primary/20" />
          <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-brand-primary border-t-transparent animate-spin" />
          <RocketLaunchIcon className="absolute inset-0 m-auto h-6 w-6 text-brand-primary" />
        </div>
        <h2 className="text-lg font-bold text-text-primary">Building your site...</h2>
        <p className="mt-1 text-sm text-text-secondary">
          {tbwoId ? `TBWO: ${tbwoId.slice(0, 8)}...` : 'Initializing...'}
        </p>
      </div>

      {/* Stage progress bar */}
      {pipelineStatus && pipelineStatus.stageLog.length > 0 && (
        <div className="space-y-4">
          <div className="flex gap-1">
            {PIPELINE_STAGES.map((stage) => {
              const log = pipelineStatus.stageLog.find(l => l.stage === stage);
              const color = log?.status === 'completed'
                ? 'bg-brand-primary'
                : log?.status === 'running'
                  ? 'bg-brand-primary/50 animate-pulse'
                  : log?.status === 'failed'
                    ? 'bg-semantic-error'
                    : 'bg-border-primary';
              return <div key={stage} className={`h-1.5 flex-1 rounded ${color}`} />;
            })}
          </div>

          {/* Stage log */}
          <div className="space-y-2">
            {pipelineStatus.stageLog.map((log) => (
              <div key={log.stage} className="flex items-center gap-3 text-sm">
                {log.status === 'completed' ? (
                  <CheckCircleIcon className="h-4 w-4 text-brand-primary flex-shrink-0" />
                ) : log.status === 'running' ? (
                  <ArrowPathIcon className="h-4 w-4 text-brand-primary animate-spin flex-shrink-0" />
                ) : log.status === 'failed' ? (
                  <ExclamationTriangleIcon className="h-4 w-4 text-semantic-error flex-shrink-0" />
                ) : (
                  <div className="h-4 w-4 rounded-full border border-border-primary flex-shrink-0" />
                )}
                <span className="font-medium capitalize text-text-primary">{log.stage}</span>
                {log.duration !== undefined && (
                  <span className="text-text-quaternary">{(log.duration / 1000).toFixed(1)}s</span>
                )}
                {log.fileCount !== undefined && (
                  <span className="text-text-quaternary">{log.fileCount} files</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallback: no pipeline status yet */}
      {(!pipelineStatus || pipelineStatus.stageLog.length === 0) && (
        <div className="text-center text-sm text-text-tertiary">
          Pods are generating your site files...
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PREVIEW PHASE (NEW — file tree + validation)
// ============================================================================

function PreviewPhase({
  fileTree,
  validationReport,
  tbwoId,
}: {
  fileTree: FileTreeNode[] | null;
  validationReport: ValidationReport | null;
  tbwoId: string | null;
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Your site is ready</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Review the generated files and validation results before deploying.
        </p>
      </div>

      {/* Validation Report Card */}
      {validationReport && (
        <div className={`rounded-lg border p-4 ${
          validationReport.canDeploy
            ? 'border-brand-primary/30 bg-brand-primary/5'
            : 'border-semantic-error/30 bg-semantic-error/5'
        }`}>
          <div className="flex items-center gap-3 mb-3">
            {validationReport.canDeploy ? (
              <CheckCircleIcon className="h-5 w-5 text-brand-primary" />
            ) : (
              <ExclamationTriangleIcon className="h-5 w-5 text-semantic-error" />
            )}
            <span className="text-sm font-semibold text-text-primary">
              {validationReport.canDeploy ? 'All checks passed' : `${validationReport.blockers.length} issue(s) found`}
            </span>
            <span className="ml-auto text-xs text-text-tertiary">
              Score: {validationReport.score}/100
            </span>
          </div>

          {/* Blockers */}
          {validationReport.blockers.length > 0 && (
            <div className="space-y-1">
              {validationReport.blockers.map((blocker, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-semantic-error">
                  <span>-</span>
                  <span>{blocker}</span>
                </div>
              ))}
            </div>
          )}

          {/* Completeness */}
          <div className="mt-2 flex gap-4 text-xs text-text-tertiary">
            <span>{validationReport.completeness.htmlFiles} HTML pages</span>
            <span>{validationReport.completeness.totalFiles} total files</span>
            {validationReport.violations.length > 0 && (
              <span>{validationReport.violations.length} trust violations (auto-repaired)</span>
            )}
          </div>
        </div>
      )}

      {/* File Tree */}
      {fileTree && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
            <FolderIcon className="h-4 w-4" />
            Generated Files
          </h3>
          <div className="space-y-0.5 text-xs font-mono">
            {fileTree.map((node) => (
              <FileTreeNodeView
                key={node.path}
                node={node}
                depth={0}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
                tbwoId={tbwoId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {!fileTree && !validationReport && (
        <div className="flex items-center justify-center py-8">
          <ArrowPathIcon className="h-5 w-5 text-text-tertiary animate-spin mr-2" />
          <span className="text-sm text-text-tertiary">Loading preview...</span>
        </div>
      )}
    </div>
  );
}

function FileTreeNodeView({
  node,
  depth,
  expandedDirs,
  toggleDir,
  tbwoId,
}: {
  node: FileTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  tbwoId: string | null;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const indent = depth * 16;

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => toggleDir(node.path)}
          className="flex items-center gap-1.5 py-0.5 text-text-secondary hover:text-text-primary w-full text-left"
          style={{ paddingLeft: indent }}
        >
          <FolderIcon className="h-3.5 w-3.5 text-brand-primary" />
          <span>{node.name}/</span>
        </button>
        {isExpanded && node.children?.map((child) => (
          <FileTreeNodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            toggleDir={toggleDir}
            tbwoId={tbwoId}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1.5 py-0.5 text-text-tertiary"
      style={{ paddingLeft: indent }}
    >
      <DocumentTextIcon className="h-3.5 w-3.5" />
      <span>{node.name}</span>
      {node.size !== undefined && (
        <span className="text-text-quaternary ml-auto">{formatBytes(node.size)}</span>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// DEPLOYING PHASE
// ============================================================================

function DeployingPhase() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative mb-6">
        <div className="h-16 w-16 rounded-full border-4 border-brand-primary/20" />
        <div className="absolute inset-0 h-16 w-16 rounded-full border-4 border-brand-primary border-t-transparent animate-spin" />
        <GlobeAltIcon className="absolute inset-0 m-auto h-6 w-6 text-brand-primary" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary">Deploying to Cloudflare...</h3>
      <p className="mt-2 text-sm text-text-secondary">Your site is going live</p>
    </div>
  );
}

// ============================================================================
// DEPLOYED PHASE (NEW)
// ============================================================================

function DeployedPhase({ url }: { url: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <CheckCircleIcon className="h-16 w-16 text-brand-primary mb-4" />
      <h2 className="text-xl font-bold text-text-primary">Your site is live!</h2>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-sm text-brand-primary hover:underline flex items-center gap-1"
        >
          <GlobeAltIcon className="h-4 w-4" />
          {url}
        </a>
      )}
      {!url && (
        <p className="mt-3 text-sm text-text-secondary">
          Deployment completed. Check your Cloudflare dashboard for the URL.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// PHASE: BRIEF REVIEW
// ============================================================================

function BriefPhase({
  brief,
  editedFields,
  onEdit,
  qualityTarget,
  setQualityTarget,
  timeBudget,
  setTimeBudget,
  provenance,
  modelTier,
  setModelTier,
}: {
  brief: SiteBrief;
  editedFields: Set<string>;
  onEdit: (field: string, value: unknown) => void;
  qualityTarget: QualityTarget;
  setQualityTarget: (q: QualityTarget) => void;
  timeBudget: number;
  setTimeBudget: (t: number) => void;
  provenance: Record<string, string>;
  modelTier: ModelTier;
  setModelTier: (t: ModelTier) => void;
}) {
  const getFieldTag = (field: string): string | null => {
    if (editedFields.has(field)) return 'Edited';
    const tag = provenance[field];
    if (tag === 'PLACEHOLDER') return 'Needs input';
    return null;
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Here's what I think you want</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Review and edit. Changes you make are tagged as <span className="text-brand-primary font-medium">your input</span>.
          {Object.values(provenance).some(v => v === 'PLACEHOLDER') && (
            <span className="text-semantic-warning ml-1">Fields marked "Needs input" may generate placeholder content.</span>
          )}
        </p>
      </div>

      {/* Product Identity */}
      <div className="grid grid-cols-2 gap-4">
        <BriefField
          label="Product / Brand Name"
          value={brief.productName || brief.businessType}
          tag={getFieldTag('productName')}
          onChange={(v) => onEdit('productName', v)}
        />
        <BriefField
          label="Tagline"
          value={brief.tagline || ''}
          tag={getFieldTag('tagline')}
          onChange={(v) => onEdit('tagline', v)}
        />
      </div>

      <BriefField
        label="One-Liner Positioning"
        value={brief.oneLinerPositioning || brief.goal}
        tag={getFieldTag('oneLinerPositioning')}
        onChange={(v) => onEdit('oneLinerPositioning', v)}
      />

      {/* Audience & Goal */}
      <div className="grid grid-cols-2 gap-4">
        <BriefField
          label="Target Audience"
          value={brief.targetAudience || brief.icpGuess}
          tag={getFieldTag('targetAudience')}
          onChange={(v) => onEdit('targetAudience', v)}
        />
        <BriefField
          label="Primary Pain Point"
          value={brief.primaryPain || ''}
          tag={getFieldTag('primaryPain')}
          onChange={(v) => onEdit('primaryPain', v)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <BriefField
          label="Tone / Voice"
          value={brief.toneStyle || brief.tone}
          tag={getFieldTag('toneStyle')}
          onChange={(v) => onEdit('toneStyle', v)}
        />
        <BriefField
          label="Design Direction"
          value={brief.designDirection}
          tag={getFieldTag('designDirection')}
          onChange={(v) => onEdit('designDirection', v)}
        />
      </div>

      {/* Pages */}
      <BriefListField
        label="Pages to Build"
        items={brief.navPages?.length ? brief.navPages : brief.pages}
        edited={editedFields.has('navPages')}
        onChange={(v) => { onEdit('navPages', v); onEdit('pages', v); }}
      />

      {/* Primary CTA */}
      <BriefField
        label="Primary CTA"
        value={brief.primaryCTA || (brief.ctas?.[0] || '')}
        tag={getFieldTag('primaryCTA')}
        onChange={(v) => onEdit('primaryCTA', v)}
      />

      {/* Features */}
      <BriefListField
        label="Features"
        items={brief.features}
        edited={editedFields.has('features')}
        onChange={(v) => onEdit('features', v)}
      />

      {/* Pricing (editable) */}
      {brief.pricing && (
        <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            Pricing
            {editedFields.has('pricing') && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary">Edited</span>
            )}
          </h3>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input type="checkbox" checked={brief.pricing.hasFreePlan}
                onChange={(e) => onEdit('pricing', { ...brief.pricing, hasFreePlan: e.target.checked })}
                className="accent-brand-primary" />
              Free plan
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input type="checkbox" checked={brief.pricing.trial?.enabled || false}
                onChange={(e) => onEdit('pricing', { ...brief.pricing, trial: { ...brief.pricing.trial, enabled: e.target.checked } })}
                className="accent-brand-primary" />
              Free trial
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input type="checkbox" checked={brief.pricing.annual?.enabled || false}
                onChange={(e) => onEdit('pricing', { ...brief.pricing, annual: { ...brief.pricing.annual, enabled: e.target.checked } })}
                className="accent-brand-primary" />
              Annual billing
            </label>
          </div>
          {(brief.pricing?.tiers?.length ?? 0) > 0 && (
            <div className="space-y-2">
              {brief.pricing.tiers.map((tier, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-text-secondary">
                  <span className="font-medium text-text-primary w-20 truncate">{tier.name}</span>
                  <span>${tier.priceMonthly}/mo</span>
                  <span className="text-text-quaternary">— {tier.limitLabel}</span>
                  {tier.isMostPopular && <span className="text-brand-primary text-[10px]">Popular</span>}
                </div>
              ))}
            </div>
          )}
          {(!brief.pricing?.tiers || brief.pricing.tiers.length === 0) && (
            <p className="text-xs text-text-quaternary italic">No pricing tiers specified. Pods will ask during execution.</p>
          )}
        </div>
      )}

      {/* Trust Constraints */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-2">
        <h3 className="text-sm font-semibold text-text-primary">Trust Guardrails</h3>
        <p className="text-xs text-text-quaternary">These prevent AI from fabricating content you didn't provide.</p>
        <div className="space-y-1.5">
          {[
            { key: 'NO_FABRICATED_STATS', label: 'No fabricated stats or numbers' },
            { key: 'NO_RENAME_WITHOUT_APPROVAL', label: 'No renaming brand without approval' },
            { key: 'NO_SECURITY_CLAIMS_UNLESS_PROVIDED', label: 'No security/compliance claims unless provided' },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-xs text-text-secondary">
              <input type="checkbox"
                checked={brief.constraints?.[key as keyof typeof brief.constraints] ?? true}
                onChange={(e) => onEdit('constraints', { ...(brief.constraints || {}), [key]: e.target.checked })}
                className="accent-brand-primary" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Required Unknowns */}
      {(brief.requiredUnknowns?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-semantic-warning/30 bg-semantic-warning/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <ExclamationTriangleIcon className="h-4 w-4 text-semantic-warning" />
            <span className="text-sm font-medium text-semantic-warning">Will be asked during execution:</span>
          </div>
          <ul className="space-y-1">
            {brief.requiredUnknowns.map((item, i) => {
              const question = typeof item === 'string' ? item : item.question;
              return (
                <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                  <span className="text-text-quaternary mt-0.5">-</span>
                  {question}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-text-tertiary">
            Execution will hard-pause for each of these via Pause-and-Ask.
          </p>
        </div>
      )}

      {/* Assumptions */}
      {(brief.assumptions?.length ?? 0) > 0 && (
        <div className="rounded-lg bg-background-tertiary p-4">
          <span className="text-xs font-medium text-text-tertiary block mb-1">Assumptions:</span>
          <ul className="space-y-0.5">
            {brief.assumptions.map((item, i) => (
              <li key={i} className="text-xs text-text-quaternary">- {item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Execution Settings */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-4">
        <h3 className="text-sm font-semibold text-text-primary">Execution Settings</h3>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">Quality Target</label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { value: QualityTarget.DRAFT, label: 'Draft', desc: 'Quick prototype' },
              { value: QualityTarget.STANDARD, label: 'Standard', desc: 'Professional' },
              { value: QualityTarget.PREMIUM, label: 'Premium', desc: 'High polish' },
              { value: QualityTarget.APPLE_LEVEL, label: 'Apple', desc: 'Pixel perfect' },
            ].map((option) => (
              <button key={option.value} onClick={() => setQualityTarget(option.value)}
                className={`rounded-lg border-2 p-2 text-left transition-all ${qualityTarget === option.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
                <div className="text-xs font-semibold text-text-primary">{option.label}</div>
                <div className="text-[10px] text-text-tertiary">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Model Tier */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-secondary">AI Model Tier</label>
          <div className="grid grid-cols-3 gap-2">
            {(['budget', 'pro', 'max'] as const).map((tier) => {
              const preset = MODEL_TIER_PRESETS[tier];
              return (
                <button key={tier} onClick={() => setModelTier(tier)}
                  className={`rounded-lg border-2 p-3 text-left transition-all ${modelTier === tier ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-text-primary">{preset.label}</div>
                    <div className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${tier === 'budget' ? 'bg-green-500/10 text-green-400' : tier === 'pro' ? 'bg-blue-500/10 text-blue-400' : 'bg-amber-500/10 text-amber-400'}`}>
                      {preset.priceLabel}
                    </div>
                  </div>
                  <div className="text-[10px] text-text-tertiary mt-1">{preset.description}</div>
                </button>
              );
            })}
          </div>

          {/* Show model breakdown for selected tier */}
          <div className="mt-2 rounded-lg bg-background-tertiary p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {MODEL_TIER_PRESETS[modelTier].rules.map((rule) => (
                <div key={rule.podRole} className="flex items-center justify-between text-[10px]">
                  <span className="text-text-secondary capitalize">{rule.podRole}</span>
                  <span className="text-text-tertiary">{rule.reason.match(/rec: (.+)\)/)?.[1] || rule.model}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ============================================================================
// PHASE: DESIGN & MEDIA (Step 3)
// ============================================================================

const COLOR_PRESETS: { name: string; colors: ColorScheme }[] = [
  { name: 'Ocean', colors: { primary: '#0EA5E9', secondary: '#06B6D4', accent: '#F59E0B', background: '#0F172A', text: '#F8FAFC' } },
  { name: 'Forest', colors: { primary: '#22C55E', secondary: '#16A34A', accent: '#FBBF24', background: '#14532D', text: '#F0FDF4' } },
  { name: 'Sunset', colors: { primary: '#F97316', secondary: '#EF4444', accent: '#A855F7', background: '#1C1917', text: '#FEF2F2' } },
  { name: 'Minimal', colors: { primary: '#18181B', secondary: '#3F3F46', accent: '#6366F1', background: '#FFFFFF', text: '#18181B' } },
  { name: 'Royal', colors: { primary: '#7C3AED', secondary: '#A855F7', accent: '#EC4899', background: '#0F0B1E', text: '#F5F3FF' } },
  { name: 'Corporate', colors: { primary: '#2563EB', secondary: '#1D4ED8', accent: '#10B981', background: '#FFFFFF', text: '#1E293B' } },
];

const FONT_PRESETS = [
  { name: 'Classic', heading: 'Georgia, serif', body: 'Inter, sans-serif' },
  { name: 'Modern', heading: 'Montserrat, sans-serif', body: 'Open Sans, sans-serif' },
  { name: 'Tech', heading: 'JetBrains Mono, monospace', body: 'Inter, sans-serif' },
  { name: 'Elegant', heading: 'Playfair Display, serif', body: 'Lato, sans-serif' },
  { name: 'Bold', heading: 'Bebas Neue, sans-serif', body: 'Roboto, sans-serif' },
];

const AESTHETICS: { value: WebsiteSprintConfig['aesthetic']; label: string; desc: string }[] = [
  { value: 'minimal', label: 'Minimal', desc: 'Clean lines, lots of whitespace' },
  { value: 'modern', label: 'Modern', desc: 'Contemporary, rounded corners' },
  { value: 'classic', label: 'Classic', desc: 'Traditional, timeless design' },
  { value: 'bold', label: 'Bold', desc: 'Strong colors, large type' },
  { value: 'elegant', label: 'Elegant', desc: 'Refined, luxury aesthetic' },
];

function DesignMediaPhase({
  brief,
  colorScheme,
  setColorScheme,
  typography,
  setTypography,
  selectedAesthetic,
  setSelectedAesthetic,
  pageMedia,
  setPageMedia,
  brandLogoUrl,
  setBrandLogoUrl,
  brandGuidelinesText,
  setBrandGuidelinesText,
}: {
  brief: SiteBrief;
  colorScheme: ColorScheme | null;
  setColorScheme: (c: ColorScheme | null) => void;
  typography: TypographyPreferences | null;
  setTypography: (t: TypographyPreferences | null) => void;
  selectedAesthetic: WebsiteSprintConfig['aesthetic'];
  setSelectedAesthetic: (a: WebsiteSprintConfig['aesthetic']) => void;
  pageMedia: PageMediaAsset[];
  setPageMedia: (m: PageMediaAsset[]) => void;
  brandLogoUrl: string;
  setBrandLogoUrl: (u: string) => void;
  brandGuidelinesText: string;
  setBrandGuidelinesText: (t: string) => void;
}) {
  const pages = brief.navPages?.length ? brief.navPages : brief.pages;

  const addPageMedia = (pageIndex: number) => {
    const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setPageMedia([...pageMedia, {
      id,
      type: 'image',
      placement: 'hero',
      pageIndex,
      altText: '',
    }]);
  };

  const updatePageMedia = (id: string, updates: Partial<PageMediaAsset>) => {
    setPageMedia(pageMedia.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const removePageMedia = (id: string) => {
    setPageMedia(pageMedia.filter(m => m.id !== id));
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Design & Media</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Set the visual direction. Everything here is optional — pods will make sensible defaults.
        </p>
      </div>

      {/* Aesthetic */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-secondary">Visual Style</label>
        <div className="grid grid-cols-5 gap-2">
          {AESTHETICS.map((a) => (
            <button key={a.value} onClick={() => setSelectedAesthetic(a.value)}
              className={`rounded-lg border-2 p-2 text-left transition-all ${selectedAesthetic === a.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'}`}>
              <div className="text-xs font-semibold text-text-primary">{a.label}</div>
              <div className="text-[10px] text-text-tertiary">{a.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Color Scheme */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-secondary">Color Palette</label>
        {/* Quick Presets */}
        <div className="grid grid-cols-3 gap-2">
          {COLOR_PRESETS.map((preset) => (
            <button key={preset.name}
              onClick={() => setColorScheme(preset.colors)}
              className={`flex items-center gap-2 rounded-lg border-2 p-2 transition-all ${
                colorScheme?.primary === preset.colors.primary && colorScheme?.secondary === preset.colors.secondary
                  ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'
              }`}>
              <div className="flex gap-0.5">
                {[preset.colors.primary, preset.colors.secondary, preset.colors.accent || preset.colors.text].map((c, i) => (
                  <div key={i} className="h-5 w-5 rounded" style={{ backgroundColor: c }} />
                ))}
              </div>
              <span className="text-xs font-medium text-text-primary">{preset.name}</span>
            </button>
          ))}
        </div>
        {/* Per-role color pickers with HSL wheel */}
        <div className="mt-3 space-y-2">
          {colorScheme ? (
            <>
              {(['primary', 'secondary', 'accent', 'background', 'text'] as const).map((role) => (
                <div key={role} className="flex items-center gap-3">
                  <span className="w-20 text-xs font-medium capitalize text-text-secondary">{role}</span>
                  <div className="relative">
                    <input
                      type="color"
                      value={colorScheme[role] || '#000000'}
                      onChange={(e) => setColorScheme({ ...colorScheme, [role]: e.target.value })}
                      className="h-8 w-8 cursor-pointer rounded border border-border-primary bg-transparent p-0"
                    />
                  </div>
                  <input
                    type="text"
                    value={colorScheme[role] || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setColorScheme({ ...colorScheme, [role]: val });
                    }}
                    placeholder="#000000"
                    className="w-20 rounded border border-border-primary bg-background-tertiary px-2 py-1 text-xs font-mono text-text-primary"
                  />
                </div>
              ))}
              {/* Live preview strip */}
              <div className="mt-2 flex h-6 overflow-hidden rounded-lg border border-border-primary">
                {['primary', 'secondary', 'accent', 'background', 'text'].map((role) => (
                  <div key={role} className="flex-1" style={{ backgroundColor: (colorScheme as unknown as Record<string, string>)[role] || '#000' }} />
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-text-tertiary">Select a preset above or click any color to start customizing</p>
          )}
        </div>
      </div>

      {/* Typography */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-secondary">Font Pairing</label>
        <div className="grid grid-cols-5 gap-2">
          {FONT_PRESETS.map((preset) => (
            <button key={preset.name}
              onClick={() => setTypography(
                typography?.headingFont === preset.heading ? null : { headingFont: preset.heading, bodyFont: preset.body, scale: 'medium' }
              )}
              className={`rounded-lg border-2 p-2 text-center transition-all ${
                typography?.headingFont === preset.heading ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'
              }`}>
              <div className="text-xs font-semibold text-text-primary" style={{ fontFamily: preset.heading }}>{preset.name}</div>
              <div className="text-[10px] text-text-tertiary" style={{ fontFamily: preset.body }}>Body text</div>
            </button>
          ))}
        </div>
      </div>

      {/* Brand Assets */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Brand Assets (optional)</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-tertiary">Logo URL</label>
            <input type="url" value={brandLogoUrl} onChange={(e) => setBrandLogoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-tertiary">Brand Guidelines</label>
            <input type="text" value={brandGuidelinesText} onChange={(e) => setBrandGuidelinesText(e.target.value)}
              placeholder="Brief brand notes..."
              className="w-full rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none" />
          </div>
        </div>
      </div>

      {/* Per-Page Media */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary">Page Media (optional)</h3>
        <p className="text-xs text-text-tertiary">Attach images or video URLs to specific pages. Pods will use them in the build.</p>
        {pages.map((pageName, pageIdx) => {
          const mediaForPage = pageMedia.filter(m => m.pageIndex === pageIdx);
          return (
            <div key={pageIdx} className="border-t border-border-primary pt-2 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-text-primary">{pageName}</span>
                <button onClick={() => addPageMedia(pageIdx)}
                  className="flex items-center gap-1 text-[10px] text-brand-primary hover:text-brand-primary/80">
                  <PlusIcon className="h-3 w-3" /> Add media
                </button>
              </div>
              {mediaForPage.map((media) => (
                <div key={media.id} className="flex items-center gap-2 mb-1.5">
                  <select value={media.type} onChange={(e) => updatePageMedia(media.id, { type: e.target.value as 'image' | 'video' | '3d' })}
                    className="rounded border border-border-primary bg-background-tertiary px-1.5 py-1 text-[10px] text-text-primary">
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                    <option value="3d">3D</option>
                  </select>
                  <input type="url" value={media.url || ''} onChange={(e) => updatePageMedia(media.id, { url: e.target.value })}
                    placeholder={media.type === 'video' ? 'Video URL...' : media.type === '3d' ? '3D model URL...' : 'Image URL...'}
                    className="flex-1 rounded border border-border-primary bg-background-tertiary px-2 py-1 text-[10px] text-text-primary focus:border-brand-primary focus:outline-none" />
                  <label className="flex cursor-pointer items-center gap-1 rounded border border-brand-primary/30 bg-brand-primary/5 px-1.5 py-1 text-[10px] text-brand-primary hover:bg-brand-primary/10">
                    <ArrowUpTrayIcon className="h-3 w-3" />
                    Upload
                    <input type="file" accept="image/*,video/*,.glb,.gltf,.obj" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const { uploadAsset } = await import('../../api/dbService');
                          const result = await uploadAsset(file);
                          updatePageMedia(media.id, { url: (result as any).url || (result as any).key || '' });
                        } catch (err) {
                          console.warn('Upload failed, using local preview:', err);
                          updatePageMedia(media.id, { url: URL.createObjectURL(file) });
                        }
                      }} />
                  </label>
                  <select value={media.placement} onChange={(e) => updatePageMedia(media.id, { placement: e.target.value as PageMediaAsset['placement'] })}
                    className="rounded border border-border-primary bg-background-tertiary px-1.5 py-1 text-[10px] text-text-primary">
                    <option value="hero">Hero</option>
                    <option value="feature">Feature</option>
                    <option value="background">Background</option>
                    <option value="inline">Inline</option>
                    <option value="gallery">Gallery</option>
                  </select>
                  <button onClick={() => removePageMedia(media.id)} className="text-text-quaternary hover:text-semantic-error">
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// PHASE: ANIMATION & EFFECTS (Step 4)
// ============================================================================

const MOTION_LEVELS = [
  { value: 'minimal' as const, label: 'Minimal', desc: 'Subtle transitions, fast loads. Best for content-heavy sites.' },
  { value: 'standard' as const, label: 'Standard', desc: 'Scroll reveals, hover effects, smooth transitions. Good balance.' },
  { value: 'premium' as const, label: 'Premium', desc: 'Cinematic animations, parallax, staggered reveals. Maximum wow factor.' },
];

const ANIMATION_STYLE_OPTIONS = [
  { id: 'scroll-linked', label: 'Scroll-Linked', desc: 'Animations triggered by scroll position' },
  { id: 'hover-effects', label: 'Hover Effects', desc: 'Interactive hover states on cards and buttons' },
  { id: 'parallax', label: 'Parallax', desc: 'Depth-layered scrolling backgrounds' },
  { id: 'staggered-reveals', label: 'Staggered Reveals', desc: 'Elements appear one after another' },
];

function AnimationEffectsPhase({
  motionIntensity,
  setMotionIntensity,
  animationStyles,
  toggleAnimationStyle,
  scene3DEnabled,
  setScene3DEnabled,
  selectedScenePreset,
  setSelectedScenePreset,
  suggestions,
  acceptedSuggestions,
  rejectedSuggestions,
  onAccept,
  onReject,
}: {
  motionIntensity: 'minimal' | 'standard' | 'premium';
  setMotionIntensity: (v: 'minimal' | 'standard' | 'premium') => void;
  animationStyles: string[];
  toggleAnimationStyle: (id: string) => void;
  scene3DEnabled: boolean;
  setScene3DEnabled: (v: boolean) => void;
  selectedScenePreset: string | null;
  setSelectedScenePreset: (v: string | null) => void;
  suggestions: ALINSuggestion[];
  acceptedSuggestions: Set<string>;
  rejectedSuggestions: Set<string>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-text-primary">Animation & Effects</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Choose how much motion and interactivity your site will have.
        </p>
      </div>

      {/* Motion Intensity */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-secondary">Motion Intensity</label>
        <div className="grid grid-cols-3 gap-3">
          {MOTION_LEVELS.map((level) => (
            <button key={level.value} onClick={() => setMotionIntensity(level.value)}
              className={`rounded-lg border-2 p-3 text-left transition-all ${
                motionIntensity === level.value ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'
              }`}>
              <div className="text-sm font-semibold text-text-primary">{level.label}</div>
              <div className="text-xs text-text-tertiary mt-1">{level.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Animation Styles */}
      <div>
        <label className="mb-2 block text-xs font-medium text-text-secondary">Animation Styles</label>
        <div className="grid grid-cols-2 gap-2">
          {ANIMATION_STYLE_OPTIONS.map((style) => (
            <label key={style.id}
              className={`flex items-start gap-2 rounded-lg border-2 p-3 cursor-pointer transition-all ${
                animationStyles.includes(style.id) ? 'border-brand-primary bg-brand-primary/10' : 'border-border-primary hover:border-brand-primary/50'
              }`}>
              <input type="checkbox" checked={animationStyles.includes(style.id)}
                onChange={() => toggleAnimationStyle(style.id)}
                className="mt-0.5 accent-brand-primary" />
              <div>
                <div className="text-xs font-semibold text-text-primary">{style.label}</div>
                <div className="text-[10px] text-text-tertiary">{style.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* 3D Toggle */}
      <div className="rounded-lg border border-border-primary bg-background-secondary p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-text-primary">3D Elements</div>
            <div className="text-xs text-text-tertiary">Add Three.js 3D scenes to hero sections</div>
          </div>
          <button onClick={() => setScene3DEnabled(!scene3DEnabled)}
            className={`relative h-6 w-11 rounded-full transition-colors ${scene3DEnabled ? 'bg-brand-primary' : 'bg-background-tertiary'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${scene3DEnabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>
        {/* 3D Preset Selector */}
        {scene3DEnabled && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">Scene Preset</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'productSpin', name: 'Product Spin', desc: 'Rotating 3D product showcase', placement: 'hero' },
                { id: 'floatingShowcase', name: 'Floating Showcase', desc: 'Floating geometric elements', placement: 'hero' },
                { id: 'abstractHero', name: 'Abstract Hero', desc: 'Animated abstract geometry', placement: 'hero' },
                { id: 'particleField', name: 'Particle Field', desc: 'Interactive particle background', placement: 'background' },
              ].map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => setSelectedScenePreset(
                    selectedScenePreset === preset.id ? null : preset.id
                  )}
                  className={`rounded-lg border-2 p-3 text-left transition-all ${
                    selectedScenePreset === preset.id
                      ? 'border-brand-primary bg-brand-primary/10'
                      : 'border-border-primary hover:border-brand-primary/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{preset.id === 'productSpin' ? '\uD83D\uDD04' : preset.id === 'floatingShowcase' ? '\uD83D\uDCAB' : preset.id === 'abstractHero' ? '\uD83C\uDF00' : '\u2728'}</span>
                    <div>
                      <div className="text-xs font-semibold text-text-primary">{preset.name}</div>
                      <div className="text-[10px] text-text-tertiary">{preset.desc}</div>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-text-quaternary">Placement: {preset.placement}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ALIN Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-medium text-text-secondary">
            ALIN Recommendations ({suggestions.length})
          </label>
          <div className="space-y-2">
            {suggestions.map((sug) => {
              const isAccepted = acceptedSuggestions.has(sug.id);
              const isRejected = rejectedSuggestions.has(sug.id);
              return (
                <div key={sug.id}
                  className={`rounded-lg border p-3 transition-all ${
                    isAccepted ? 'border-brand-primary/50 bg-brand-primary/5' :
                    isRejected ? 'border-border-primary/50 bg-background-tertiary opacity-50' :
                    'border-border-primary bg-background-secondary'
                  }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">{sug.title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          sug.impact === 'high' ? 'bg-green-500/10 text-green-400' :
                          sug.impact === 'medium' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-gray-500/10 text-gray-400'
                        }`}>
                          {sug.impact}
                        </span>
                        <span className="text-[10px] text-text-quaternary">{sug.pageTarget}{sug.sectionTarget ? ` / ${sug.sectionTarget}` : ''}</span>
                      </div>
                      <p className="text-xs text-text-tertiary mt-0.5">{sug.description}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={() => onAccept(sug.id)}
                        className={`rounded px-2 py-1 text-[10px] font-medium transition-all ${
                          isAccepted ? 'bg-brand-primary text-white' : 'bg-background-tertiary text-text-secondary hover:bg-brand-primary/20'
                        }`}>
                        {isAccepted ? 'Accepted' : 'Accept'}
                      </button>
                      <button onClick={() => onReject(sug.id)}
                        className={`rounded px-2 py-1 text-[10px] font-medium transition-all ${
                          isRejected ? 'bg-red-500/20 text-red-400' : 'bg-background-tertiary text-text-secondary hover:bg-red-500/10'
                        }`}>
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Performance budget indicator */}
      <div className="rounded-lg bg-background-tertiary p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-text-secondary">Performance Budget Estimate</span>
          <span className="text-[10px] text-text-quaternary">
            {motionIntensity === 'minimal' ? 'Lightweight' : motionIntensity === 'standard' ? 'Moderate' : 'Heavy'}
          </span>
        </div>
        <div className="flex gap-1 h-1.5">
          <div className={`rounded ${motionIntensity !== 'minimal' ? 'bg-brand-primary' : 'bg-border-primary'} flex-1`} />
          <div className={`rounded ${animationStyles.length >= 2 ? 'bg-brand-primary' : 'bg-border-primary'} flex-1`} />
          <div className={`rounded ${scene3DEnabled ? 'bg-semantic-warning' : 'bg-border-primary'} flex-1`} />
          <div className={`rounded ${acceptedSuggestions.size >= 3 ? 'bg-semantic-warning' : 'bg-border-primary'} flex-1`} />
        </div>
        <div className="flex justify-between text-[10px] text-text-quaternary mt-1">
          <span>JS: ~{motionIntensity === 'minimal' ? '5' : motionIntensity === 'standard' ? '15' : '30'}KB</span>
          <span>{scene3DEnabled ? 'Three.js: ~150KB' : ''}</span>
          <span>Mobile: {motionIntensity === 'premium' && scene3DEnabled ? 'Heavy' : 'OK'}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// BRIEF FIELD COMPONENTS
// ============================================================================

function BriefField({
  label,
  value,
  tag,
  onChange,
}: {
  label: string;
  value: string;
  tag: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-xs font-medium text-text-secondary">{label}</label>
        {tag && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${
            tag === 'Needs input'
              ? 'bg-semantic-warning/10 text-semantic-warning'
              : 'bg-brand-primary/10 text-brand-primary'
          }`}>
            {tag}
          </span>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none ${
          tag === 'Needs input'
            ? 'border-semantic-warning/30 bg-semantic-warning/5'
            : 'border-border-primary bg-background-tertiary'
        }`}
      />
    </div>
  );
}

function BriefListField({
  label,
  items,
  edited,
  onChange,
}: {
  label: string;
  items: string[];
  edited: boolean;
  onChange: (v: string[]) => void;
}) {
  const addItem = () => onChange([...items, '']);
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, val: string) => onChange(items.map((item, i) => i === idx ? val : item));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-text-secondary">{label}</label>
          {edited && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-primary/10 text-brand-primary">Edited</span>
          )}
        </div>
        <button onClick={addItem} className="flex items-center gap-1 text-xs text-brand-primary hover:text-brand-primary/80">
          <PlusIcon className="h-3 w-3" /> Add
        </button>
      </div>
      <div className="space-y-1.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(idx, e.target.value)}
              className="flex-1 rounded-lg border border-border-primary bg-background-tertiary px-3 py-1.5 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
            />
            <button onClick={() => removeItem(idx)} className="text-text-quaternary hover:text-semantic-error">
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default WebsiteSprintWizard;
