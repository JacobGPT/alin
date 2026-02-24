/**
 * TBWO (Time-Budgeted Work Order) Types
 *
 * Complete type definitions for the autonomous agent execution system.
 * This is ALIN's flagship feature for bounded, inspectable, parallel execution.
 */

import type { RenderMode, Section3DConfig } from '../products/sites/3d/types';

// ============================================================================
// CORE TBWO TYPES
// ============================================================================

export enum TBWOStatus {
  DRAFT = 'draft',                    // Being configured
  PLANNING = 'planning',              // ALIN is creating execution plan
  AWAITING_APPROVAL = 'awaiting_approval', // Plan ready for user review
  EXECUTING = 'executing',            // Work in progress
  PAUSED = 'paused',                  // Paused at checkpoint
  PAUSED_WAITING_FOR_USER = 'paused_waiting_for_user', // Hard pause — waiting for user input
  CHECKPOINT = 'checkpoint',          // At a checkpoint, awaiting decision
  COMPLETING = 'completing',          // Finalizing and generating receipts
  COMPLETED = 'completed',            // Successfully finished
  FAILED = 'failed',                  // Failed with error
  CANCELLED = 'cancelled',            // User cancelled
  TIMEOUT = 'timeout',                // Time budget exceeded
}

export enum QualityTarget {
  DRAFT = 'draft',                    // Quick, functional
  STANDARD = 'standard',              // Production-ready
  PREMIUM = 'premium',                // Polished, professional
  APPLE_LEVEL = 'apple_level',        // Exceptional quality, extreme attention to detail
}

/** User-facing display labels for quality targets */
export const QUALITY_DISPLAY_NAMES: Record<QualityTarget, string> = {
  [QualityTarget.DRAFT]: 'Draft',
  [QualityTarget.STANDARD]: 'Standard',
  [QualityTarget.PREMIUM]: 'Premium',
  [QualityTarget.APPLE_LEVEL]: 'Maximum',
};

export interface TBWO {
  id: string;
  type: TBWOType;
  status: TBWOStatus;
  
  // Configuration
  objective: string;
  timeBudget: TimeBudget;
  qualityTarget: QualityTarget;
  scope: TBWOScope;
  
  // Execution plan
  plan?: ExecutionPlan;
  
  // Runtime state
  executionAttemptId?: string; // Unique per execution attempt — idempotency key
  startedAt?: number;
  completedAt?: number;
  currentPhase?: string;
  progress: number; // 0-100
  
  // Pods
  pods: Map<string, AgentPod>;
  activePods: Set<string>;
  
  // Artifacts
  artifacts: Artifact[];
  
  // Receipts
  receipts?: TBWOReceipts;

  // Contract
  contractId?: string;

  // Checkpoints
  checkpoints: Checkpoint[];
  currentCheckpoint?: number;
  
  // Authority
  authorityLevel: AuthorityLevel;
  permissionGates: PermissionGate[];
  
  // Chat - linked conversation for TBWO dashboard chat tab
  chatConversationId?: string;

  // Pause-and-Ask
  pauseRequests: PauseRequest[];
  activePauseId?: string;             // Currently pending pause (only one at a time)

  // Extensible metadata (wizard configs, domain-specific data)
  metadata?: Record<string, unknown>;

  // Timestamps & ownership
  createdAt: number;
  updatedAt: number;
  userId: string;
  conversationId?: string;

  // Cost tracking
  estimatedCost?: number;
  actualCost?: number;
  resourceUsage?: ResourceUsage;
}

// ============================================================================
// TBWO TYPES (Predefined Templates)
// ============================================================================

export enum TBWOType {
  WEBSITE_SPRINT = 'website_sprint',
  CODE_PROJECT = 'code_project',
  RESEARCH_REPORT = 'research_report',
  DATA_ANALYSIS = 'data_analysis',
  CONTENT_CREATION = 'content_creation',
  DESIGN_SYSTEM = 'design_system',
  API_INTEGRATION = 'api_integration',
  MARKET_RESEARCH = 'market_research',
  DUE_DILIGENCE = 'due_diligence',
  SEO_AUDIT = 'seo_audit',
  BUSINESS_PLAN = 'business_plan',
  CONTENT_STRATEGY = 'content_strategy',
  NEWSLETTER = 'newsletter',
  BET_TRACKER = 'bet_tracker',
  ROAST_PAGE = 'roast_page',
  TRIBUTE_PAGE = 'tribute_page',
  DEBATE_PAGE = 'debate_page',
  TIME_CAPSULE = 'time_capsule',
  SCOREBOARD = 'scoreboard',
  CUSTOM = 'custom',
}

export interface TBWOTemplate {
  type: TBWOType;
  name: string;
  description: string;
  icon: string;
  
  // Default configuration
  defaultTimeBudget: TimeBudget;
  defaultQuality: QualityTarget;
  requiredInputs: TBWOInput[];
  optionalInputs: TBWOInput[];
  
  // Capabilities
  supportedPods: PodRole[];
  requiredTools: string[];
  
  // Pricing
  tier: 'free' | 'spark' | 'pro' | 'agency';
}

export interface TBWOInput {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'multi-select' | 'file' | 'url';
  required: boolean;
  placeholder?: string;
  options?: string[];
  validation?: (value: unknown) => boolean;
}

// ============================================================================
// TIME BUDGET
// ============================================================================

export interface TimeBudget {
  total: number; // Total minutes allocated
  elapsed: number; // Minutes used so far
  remaining: number; // Minutes left
  
  // Phase allocation
  phases: Map<string, PhaseTimeBudget>;
  
  // Warnings
  warningThreshold: number; // Percentage (e.g., 80)
  criticalThreshold: number; // Percentage (e.g., 95)
}

export interface PhaseTimeBudget {
  name: string;
  allocated: number;
  used: number;
  status: 'pending' | 'active' | 'complete' | 'overrun';
}

// ============================================================================
// SCOPE DEFINITION
// ============================================================================

export interface TBWOScope {
  // What can be modified
  allowedOperations: Operation[];
  
  // File system boundaries
  workingDirectory: string;
  allowedPaths: string[];
  forbiddenPaths: string[];
  
  // Network access
  allowNetworkAccess: boolean;
  allowedDomains?: string[];
  
  // Tool permissions
  allowedTools: string[];
  forbiddenTools: string[];
  
  // Resource limits
  maxFileSize: number;
  maxTotalStorage: number;
  maxConcurrentPods: number;
  
  // External services
  allowedAPIs: string[];
  canDeploy: boolean;
  canModifyDatabase: boolean;
}

export enum Operation {
  READ_FILE = 'read_file',
  WRITE_FILE = 'write_file',
  DELETE_FILE = 'delete_file',
  EXECUTE_CODE = 'execute_code',
  NETWORK_REQUEST = 'network_request',
  CREATE_DIRECTORY = 'create_directory',
  INSTALL_DEPENDENCY = 'install_dependency',
  RUN_COMMAND = 'run_command',
  MODIFY_CONFIG = 'modify_config',
}

// ============================================================================
// EXECUTION PLAN
// ============================================================================

export interface ExecutionPlan {
  id: string;
  tbwoId: string;
  
  // Plan overview
  summary: string;
  estimatedDuration: number; // minutes
  confidence: number; // 0-1
  
  // Phases
  phases: Phase[];
  
  // Pod allocation
  podStrategy: PodAllocationStrategy;
  
  // Risk assessment
  risks: Risk[];
  assumptions: string[];
  
  // Deliverables
  deliverables: Deliverable[];
  
  // Approval
  requiresApproval: boolean;
  approvedAt?: number;
  approvedBy?: string;
}

export interface Phase {
  id: string;
  name: string;
  description: string;
  order: number;
  
  // Timing
  estimatedDuration: number;
  startedAt?: number;
  completedAt?: number;
  
  // Dependencies
  dependsOn: string[]; // Phase IDs
  
  // Work
  tasks: Task[];
  
  // Assigned pods
  assignedPods: string[];
  
  // Status
  status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';
  progress: number; // 0-100
}

export interface Task {
  id: string;
  name: string;
  description?: string;
  assignedPod?: string;
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
  estimatedDuration: number;
  actualDuration?: number;
  output?: unknown;
  dependsOn?: string[];
}

export interface Deliverable {
  name: string;
  description: string;
  type: 'file' | 'artifact' | 'report' | 'deployment';
  path?: string;
  required: boolean;
}

export interface Risk {
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation?: string;
}

// ============================================================================
// AGENT PODS
// ============================================================================

export enum PodRole {
  ORCHESTRATOR = 'orchestrator',      // Main coordinator
  DESIGN = 'design',                  // UI/UX design
  FRONTEND = 'frontend',              // Frontend development
  BACKEND = 'backend',                // Backend development
  COPY = 'copy',                      // Content writing
  MOTION = 'motion',                  // CSS/JS micro-interactions & transitions
  ANIMATION = 'animation',            // Advanced scroll animations & cinematic motion
  THREE_D = 'three_d',               // 3D scenes, WebGL, Three.js
  QA = 'qa',                          // Quality assurance
  RESEARCH = 'research',              // Research & analysis
  DATA = 'data',                      // Data processing
  DEPLOYMENT = 'deployment',          // Deployment & ops
}

/** User-facing display labels for pod roles */
export const POD_ROLE_DISPLAY_NAMES: Record<PodRole, string> = {
  [PodRole.ORCHESTRATOR]: 'Orchestrator',
  [PodRole.DESIGN]: 'Design',
  [PodRole.FRONTEND]: 'Frontend',
  [PodRole.BACKEND]: 'Backend',
  [PodRole.COPY]: 'Copywriter',
  [PodRole.MOTION]: 'Motion',
  [PodRole.ANIMATION]: 'Animation',
  [PodRole.THREE_D]: '3D Scene',
  [PodRole.QA]: 'QA',
  [PodRole.RESEARCH]: 'Research',
  [PodRole.DATA]: 'Data',
  [PodRole.DEPLOYMENT]: 'DevOps',
};

/** Get display name for a pod role string */
export function getPodRoleDisplayName(role: string): string {
  return POD_ROLE_DISPLAY_NAMES[role as PodRole] || role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export interface AgentPod {
  id: string;
  role: PodRole;
  name: string;
  
  // State
  status: PodStatus;
  health: PodHealth;
  
  // Configuration
  modelConfig: PodModelConfig;
  toolWhitelist: string[];
  memoryScope: string[];
  
  // Execution
  currentTask?: Task;
  taskQueue: Task[];
  completedTasks: Task[];
  
  // Output
  outputs: PodOutput[];
  
  // Resources
  resourceUsage: PodResourceUsage;
  
  // Communication
  messageLog: PodMessage[];
  
  // Lifecycle
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
  
  // Parent TBWO
  tbwoId: string;
}

export enum PodStatus {
  INITIALIZING = 'initializing',
  IDLE = 'idle',
  WORKING = 'working',
  WAITING = 'waiting',              // Waiting on dependency
  CHECKPOINT = 'checkpoint',        // At checkpoint
  COMPLETE = 'complete',
  FAILED = 'failed',
  TERMINATED = 'terminated',
}

export interface PodHealth {
  status: 'healthy' | 'warning' | 'critical' | 'dead';
  lastHeartbeat: number;
  errorCount: number;
  consecutiveFailures: number;
  warnings: string[];
}

export interface PodModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface PodOutput {
  id: string;
  type: 'file' | 'artifact' | 'log' | 'error';
  content: unknown;
  timestamp: number;
  confidence?: number;
}

export interface PodResourceUsage {
  cpuPercent: number;
  memoryMB: number;
  gpuPercent?: number;
  tokensUsed: number;
  apiCalls: number;
  executionTime: number; // seconds
}

export interface PodMessage {
  timestamp: number;
  from: string; // Pod ID or 'orchestrator'
  to: string;
  type: 'task_assignment' | 'status_update' | 'question' | 'result' | 'error';
  content: unknown;
}

export interface PodAllocationStrategy {
  mode: 'sequential' | 'parallel' | 'hybrid';
  maxConcurrent: number;
  priorityOrder: PodRole[];
  dependencies: Map<PodRole, PodRole[]>;
}

// ============================================================================
// ARTIFACTS
// ============================================================================

export interface Artifact {
  id: string;
  tbwoId: string;
  
  // Metadata
  name: string;
  type: ArtifactType;
  description?: string;
  
  // Content
  content: unknown;
  path?: string;
  url?: string;
  
  // Source
  createdBy: string; // Pod ID
  createdAt: number;
  
  // Versioning
  version: number;
  previousVersion?: string; // Artifact ID
  
  // Status
  status: 'draft' | 'review' | 'approved' | 'rejected' | 'final';
  
  // Validation
  validationResults?: ValidationResult[];
}

export enum ArtifactType {
  FILE = 'file',
  CODE = 'code',
  DESIGN = 'design',
  DOCUMENT = 'document',
  DEPLOYMENT = 'deployment',
  CONFIG = 'config',
  DATA = 'data',
}

export interface ValidationResult {
  validator: string;
  passed: boolean;
  errors?: string[];
  warnings?: string[];
  score?: number;
}

// ============================================================================
// CHECKPOINTS
// ============================================================================

export interface Checkpoint {
  id: string;
  tbwoId: string;
  name: string;
  description?: string;
  order: number;

  // Trigger
  triggerCondition: CheckpointTrigger;

  // State
  status: 'pending' | 'reached' | 'approved' | 'rejected' | 'skipped';
  reachedAt?: number;

  // Review
  summary: string;
  achievements: string[];
  nextSteps: string[];
  outputs?: string[]; // What was completed at this checkpoint

  // Artifacts at this point
  artifacts: string[]; // Artifact IDs

  // User decision
  decision?: CheckpointDecision;
  decidedAt?: number;
}

export enum CheckpointTrigger {
  PHASE_COMPLETE = 'phase_complete',
  TIME_THRESHOLD = 'time_threshold',
  MILESTONE = 'milestone',
  QUALITY_GATE = 'quality_gate',
  USER_REQUESTED = 'user_requested',
  ERROR_THRESHOLD = 'error_threshold',
}

export interface CheckpointDecision {
  action: 'continue' | 'continue_with_changes' | 'redirect' | 'pause' | 'cancel';
  feedback?: string;
  decidedBy: string;
  timestamp: number;
  adjustments?: PlanAdjustment[];
}

export interface PlanAdjustment {
  type: 'add_phase' | 'remove_phase' | 'modify_phase' | 'change_quality' | 'extend_time';
  target: string; // Phase ID or scope
  change: unknown;
}

// ============================================================================
// RECEIPTS
// ============================================================================

export interface TBWOReceipts {
  tbwoId: string;
  
  // Executive summary
  executive: ExecutiveReceipt;
  
  // Technical details
  technical: TechnicalReceipt;
  
  // Pod-level receipts
  podReceipts: Map<string, PodReceipt>;
  
  // Rollback information
  rollback: RollbackReceipt;

  // Pause-and-Ask events
  pauseEvents: PauseEvent[];

  // Generated at
  generatedAt: number;
}

export interface ExecutiveReceipt {
  // What was done
  summary: string;
  accomplishments: string[];
  
  // What changed
  filesCreated: number;
  filesModified: number;
  linesOfCode: number;
  
  // What was compromised (if anything)
  simplifications: string[];
  unfinishedItems: string[];
  
  // Quality assessment
  qualityScore: number; // 0-100
  qualityNotes: string[];
}

export interface TechnicalReceipt {
  // Build information
  buildStatus: 'success' | 'partial' | 'failed';
  buildOutput?: string;
  
  // Dependencies
  dependencies: Dependency[];
  
  // Performance metrics
  performanceMetrics: PerformanceMetrics;
  
  // Test results
  testResults?: TestResults;
  
  // Security scan
  securityScan?: SecurityScanResult;

  // Truth Guard (Website Sprint)
  truthGuard?: {
    passed: boolean;
    violationCount: number;
    criticalCount: number;
    summary: string;
    ranAt: number;
  };
}

export interface PodReceipt {
  podId: string;
  role: PodRole;
  
  // Work summary
  tasksCompleted: number;
  tasksSkipped: number;
  tasksFailed: number;
  
  // Outputs
  artifactsProduced: string[];
  
  // Time
  timeUsed: number;
  timeAllocated: number;
  
  // Confidence
  confidenceNotes: string[];
  warnings: string[];
}

export interface RollbackReceipt {
  canRollback: boolean;
  rollbackInstructions: RollbackInstruction[];
  limitations: string[];
}

export interface RollbackInstruction {
  step: number;
  action: string;
  target: string;
  command?: string;
}

export interface Dependency {
  name: string;
  version: string;
  type: 'npm' | 'pip' | 'system' | 'other';
  required: boolean;
}

export interface PerformanceMetrics {
  buildTime?: number;
  bundleSize?: number;
  loadTime?: number;
  lighthouseScore?: number;
  memoryUsage?: number;
}

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  coverage?: number;
}

export interface SecurityScanResult {
  vulnerabilities: Vulnerability[];
  overallScore: number;
  recommendations: string[];
}

export interface Vulnerability {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  package?: string;
  fixAvailable: boolean;
}

// ============================================================================
// PAUSE-AND-ASK SYSTEM
// ============================================================================

export enum PauseReason {
  MISSING_CRITICAL_FACT = 'MISSING_CRITICAL_FACT',         // Required info not in context
  UNCERTAIN_CONTENT = 'UNCERTAIN_CONTENT',                 // Content generated but confidence low
  REQUIRES_USER_PREFERENCE = 'REQUIRES_USER_PREFERENCE',   // Stylistic/subjective choice
  EXTERNAL_DEPENDENCY = 'EXTERNAL_DEPENDENCY',             // Needs external service/credential/URL
}

export enum ContentTag {
  USER_PROVIDED = 'USER_PROVIDED',   // Verbatim from user
  USER_APPROVED = 'USER_APPROVED',   // AI-generated, user confirmed
  INFERRED = 'INFERRED',            // AI-inferred from vague answer
  PLACEHOLDER = 'PLACEHOLDER',       // Not resolved — blocks deploy
}

export interface PauseRequest {
  id: string;
  tbwoId: string;
  podId: string;
  phase: string;
  contextPath: string;               // e.g. "pages.pricing.tiers" — where in the output this matters
  reason: PauseReason;
  question: string;                   // Human-readable question for the user
  requiredFields?: string[];          // Specific fields needed (e.g. ["price", "currency", "interval"])
  canInferFromVagueAnswer: boolean;   // If true, AI can infer structured values from vague text
  resumeCheckpointId: string;         // Checkpoint to resume from after answer
  status: 'pending' | 'answered' | 'inferred' | 'skipped';
  userResponse?: string;              // Raw user response text
  inferredValues?: Record<string, unknown>; // AI-inferred structured values
  contentTag?: ContentTag;            // Tag applied to content derived from this pause
  createdAt: number;
  resolvedAt?: number;
}

export interface PauseEvent {
  pauseId: string;
  reason: PauseReason;
  question: string;
  userResponse?: string;
  inferredValues?: Record<string, unknown>;
  contentTag: ContentTag;
  durationMs: number;                 // How long the pause lasted
  timestamp: number;
}

// ============================================================================
// AUTHORITY & PERMISSIONS
// ============================================================================

export enum AuthorityLevel {
  NO_AUTONOMY = 'no_autonomy',              // Every action requires approval
  GUIDED = 'guided',                        // Checkpoints at major decisions
  SUPERVISED = 'supervised',                // User can observe and intervene
  AUTONOMOUS = 'autonomous',                // Runs independently within scope
}

export interface PermissionGate {
  id: string;
  operation: Operation;
  requiresApproval: boolean;
  requestedAt?: number;
  approved?: boolean;
  approvedAt?: number;
  reason?: string;
}

// ============================================================================
// RESOURCE USAGE
// ============================================================================

export interface ResourceUsage {
  // Compute
  cpuHours: number;
  gpuHours?: number;
  memoryGBHours: number;
  
  // API costs
  apiCalls: number;
  tokensUsed: number;
  estimatedCostUSD: number;
  
  // Storage
  diskSpaceUsed: number;
  filesCreated: number;
  
  // Network
  dataTransferred: number;
  externalRequests: number;
}

// ============================================================================
// WEBSITE SPRINT SPECIFIC
// ============================================================================

export interface WebsiteSprintConfig {
  // Pages
  pages: PageDefinition[];

  // Navigation
  navigation: NavigationConfig;

  // Design preferences
  aesthetic: 'minimal' | 'modern' | 'classic' | 'bold' | 'elegant';
  colorScheme?: ColorScheme;
  typography?: TypographyPreferences;

  // Technical
  framework?: 'static' | 'react' | 'vue' | 'svelte';
  hosting?: 'local' | 'vercel' | 'netlify' | 'custom';

  // Output structure
  outputStructure: OutputStructure;

  // Content
  brandAssets?: BrandAssets;
  references?: string[]; // URLs to reference sites

  // Features
  includeAnimations: boolean;
  includeContactForm: boolean;
  includeBlog: boolean;
  seoOptimized: boolean;
  responsive: boolean;

  // Deployment
  includeDeployConfig: boolean;
  deployTarget?: 'netlify' | 'vercel' | 'cloudflare' | 'github-pages';

  // Motion system intensity
  motionIntensity?: MotionIntensity;

  // 3D render mode
  renderMode?: RenderMode;

  // User-uploaded media (from Wizard Step 3)
  pageMedia?: PageMediaAsset[];

  // ALIN suggestions (from Wizard Step 4)
  acceptedSuggestions?: string[];
  rejectedSuggestions?: string[];

  // Animation style preferences (from Wizard Step 4)
  animationStyles?: string[];  // e.g. ['scroll-linked', 'parallax', 'staggered-reveals']

  // 3D scene config (from Wizard Step 4)
  scene3DEnabled?: boolean;
  scene3DAssetId?: string;
  scene3DImmersive?: boolean;
  scenePreset?: string;
}

export interface PageDefinition {
  name: string;
  path: string;
  sections: PageSection[];
  links?: PageLink[];       // Links that appear on this page (buttons, nav items, CTAs)
  isInMainNav: boolean;     // Whether this page appears in the main navigation bar
  navOrder?: number;        // Order in navigation (lower = first)
  metaDescription?: string; // SEO meta description for this page
}

export interface PageLink {
  label: string;           // Display text
  target: string;          // URL path or external URL
  type: 'nav' | 'cta' | 'footer' | 'inline'; // Where the link appears
  isExternal?: boolean;    // Opens in new tab
}

export interface PageSection {
  type: 'hero' | 'features' | 'about' | 'testimonials' | 'cta' | 'footer' | 'gallery' | 'pricing' | 'faq' | 'team' | 'blog' | 'custom';
  content?: string;
  heading?: string;        // Section heading override
}

export interface NavigationConfig {
  style: 'horizontal' | 'sidebar' | 'hamburger';
  sticky: boolean;         // Fixed/sticky header
  logoText?: string;       // Site name in nav
  footerLinks: PageLink[]; // Links in footer
  socialLinks?: SocialLink[];
}

export interface SocialLink {
  platform: 'twitter' | 'github' | 'linkedin' | 'instagram' | 'facebook' | 'youtube' | 'custom';
  url: string;
}

export interface OutputStructure {
  rootFolder: string;      // e.g. "output/tbwo/<project-name>"
  siteFolder: string;      // "site/" — HTML pages and main CSS/JS
  assetsFolder: string;    // "assets/" — images, icons, fonts
  cssFile: string;         // "site/styles.css" or "site/css/"
  includeReadme: boolean;
  includeReceipt: boolean;
  includeDeployScript: boolean;
}

export interface ColorScheme {
  primary: string;
  secondary: string;
  accent?: string;
  background: string;
  text: string;
}

export interface TypographyPreferences {
  headingFont?: string;
  bodyFont?: string;
  scale?: 'small' | 'medium' | 'large';
}

export interface BrandAssets {
  logo?: File;
  colors?: string[];
  fonts?: string[];
  images?: File[];
  logoUrl?: string;
  faviconUrl?: string;
  brandGuidelinesText?: string;
}

// ============================================================================
// PAGE MEDIA & SUGGESTION TYPES (Wizard Steps 3 & 4)
// ============================================================================

export interface PageMediaAsset {
  id: string;
  type: 'image' | 'video' | '3d';
  url?: string;
  placement: 'hero' | 'feature' | 'background' | 'inline' | 'gallery' | 'custom';
  placementHint?: string;
  altText?: string;
  pageIndex: number;
  sectionType?: string;
}

export interface ALINSuggestion {
  id: string;
  type: 'animation' | '3d' | 'motion' | 'layout';
  pageTarget: string;
  sectionTarget?: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  configPatch: Partial<WebsiteSprintConfig>;
}

// ============================================================================
// MODEL ROUTING
// ============================================================================

export interface ModelRoutingRule {
  podRole: PodRole | '*';
  taskPattern?: string;   // regex on task name (optional)
  provider: 'anthropic' | 'openai' | 'gemini' | 'deepseek';
  model: string;
  reason?: string;
}

export interface ModelRoutingConfig {
  enabled: boolean;
  rules: ModelRoutingRule[];
  fallback: { provider: string; model: string };
}

// ============================================================================
// PAGESPEC PIPELINE (Structured Page Generation)
// ============================================================================

export interface PageSpec {
  version: '1.0';
  productName: string;
  routes: RouteSpec[];
  globalNav: NavSpec;
  globalFooter: FooterSpec;
  designTokensRef: string;   // artifact path to variables.css
}

export interface RouteSpec {
  route: string;              // "/", "/about", "/pricing"
  fileName: string;           // "index.html", "about.html"
  title: string;              // "Home", "About Us"
  goal: string;               // "Convert visitors to sign up"
  sections: SectionSpec[];
  cta: { label: string; href: string } | null;
  seo: { title: string; description: string; ogImage?: string };
}

export interface SectionSpec {
  type: string;               // "hero", "features", "pricing", "faq", etc.
  headline?: string;
  subheadline?: string;
  contentBrief: string;       // What this section should communicate
  dataSource?: string;        // e.g., "pricing.tiers" or "features[]"
  layout?: string;            // Layout variant identifier (e.g., "hero-split-left")
  motion?: SectionMotionConfig;
  renderMode?: RenderMode;
  scene?: Section3DConfig;
}

export interface NavSpec {
  style: 'horizontal' | 'sidebar' | 'hamburger';
  logoText: string;
  items: Array<{ label: string; href: string }>;
}

export interface FooterSpec {
  columns: Array<{ heading: string; links: Array<{ label: string; href: string }> }>;
  copyright: string;
  socialLinks?: Array<{ platform: string; url: string }>;
}

// ============================================================================
// MOTION SYSTEM
// ============================================================================

export type MotionIntensity = 'minimal' | 'standard' | 'premium';

export interface MotionSpec {
  intensity: MotionIntensity;
  global: GlobalMotionConfig;
  sections: SectionMotionConfig[];
  heroMotion: HeroMotionConfig;
  microInteractions: MicroInteractionConfig;
  parallax: ParallaxConfig;
  advanced: AdvancedMotionConfig;
}

export interface GlobalMotionConfig {
  scrollRevealEnabled: boolean;
  staggerDelay: number;
  defaultEasing: string;
  defaultDuration: number;
  reducedMotionFallback: 'none' | 'fade-only' | 'instant';
  viewportThreshold: number;
  triggerOnce: boolean;
}

export interface SectionMotionConfig {
  sectionType: string;
  entrance: EntranceAnimation;
  children: ChildrenAnimation;
  custom?: CustomSectionMotion;
}

export interface EntranceAnimation {
  type: 'fade-up' | 'fade-down' | 'fade-left' | 'fade-right' | 'zoom-in' | 'zoom-out'
        | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'blur-in' | 'clip-reveal'
        | 'rotate-in' | 'flip-up' | 'none';
  duration: number;
  delay: number;
  easing: string;
  distance?: number;
  scale?: number;
}

export interface ChildrenAnimation {
  stagger: boolean;
  staggerDelay: number;
  animation: EntranceAnimation;
  selector?: string;
}

export interface HeroMotionConfig {
  headlineAnimation: 'typewriter' | 'word-reveal' | 'char-reveal' | 'fade-up' | 'clip-reveal' | 'none';
  headlineDuration: number;
  subheadlineDelay: number;
  ctaAnimation: 'pulse-glow' | 'slide-up' | 'fade-in' | 'bounce-in' | 'none';
  ctaDelay: number;
  backgroundMotion: 'gradient-shift' | 'parallax' | 'particle-float' | 'none';
  backgroundIntensity: number;
}

export interface MicroInteractionConfig {
  buttonHover: 'lift' | 'glow' | 'fill-slide' | 'scale' | 'none';
  buttonClick: 'ripple' | 'shrink' | 'none';
  cardHover: 'lift-shadow' | 'tilt-3d' | 'border-glow' | 'scale' | 'none';
  linkHover: 'underline-grow' | 'color-shift' | 'highlight' | 'none';
  navHover: 'underline-slide' | 'background-fill' | 'scale' | 'none';
  inputFocus: 'border-glow' | 'label-float' | 'underline-expand' | 'none';
  scrollToTop: 'fade' | 'slide-up' | 'none';
  tooltips: boolean;
}

export interface ParallaxConfig {
  enabled: boolean;
  layers: ParallaxLayer[];
  smoothScrolling: boolean;
  maxSpeed: number;
}

export interface ParallaxLayer {
  selector: string;
  speed: number;
  direction: 'vertical' | 'horizontal';
  clamp: boolean;
}

export interface AdvancedMotionConfig {
  scrollProgressBar: boolean;
  scrollProgressPosition: 'top' | 'bottom';
  scrollProgressColor: string;
  animatedCounters: boolean;
  counterDuration: number;
  counterEasing: 'linear' | 'ease-out' | 'spring';
  cssCarousels: boolean;
  carouselAutoplay: boolean;
  carouselInterval: number;
  blobMorphing: boolean;
  blobColors: string[];
  magneticCursor: boolean;
  magneticStrength: number;
  textGradientAnimation: boolean;
  smoothAnchorScroll: boolean;
  smoothScrollDuration: number;
}

export interface CustomSectionMotion {
  pricingToggle?: 'slide' | 'fade' | 'flip';
  faqAccordion?: 'slide-down' | 'fade-in' | 'height-auto';
  testimonialTransition?: 'slide' | 'fade' | 'flip-card';
  galleryReveal?: 'masonry-fade' | 'stagger-zoom' | 'none';
}

export interface MotionValidationResult {
  passed: boolean;
  score: number;
  issues: MotionValidationIssue[];
  summary: string;
  totalAnimatedElements: number;
  estimatedBundleSize: number;
  reducedMotionCompliant: boolean;
}

export interface MotionValidationIssue {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  file?: string;
  fix?: string;
}

export interface SiteValidationReport {
  passed: boolean;
  score: number;
  issues: SiteValidationIssue[];
  summary: string;
}

export interface SiteValidationIssue {
  severity: 'error' | 'warning' | 'info';
  file: string;
  line?: number;
  rule: string;
  message: string;
  fix?: string;
}

// ============================================================================
// CONVERSION AUDIT
// ============================================================================

export interface ConversionAuditResult {
  overallScore: number;  // 0-100
  scores: {
    clarity: number;
    persuasion: number;
    friction: number;       // 0=no friction, 100=high friction (inverted)
    trustSignals: number;
    visualHierarchy: number;
    pricingPsychology: number;
  };
  pageAudits: ConversionPageAudit[];
  recommendations: ConversionRecommendation[];
  generatedAt: number;
}

export interface ConversionPageAudit {
  page: string;
  route: string;
  sections: ConversionSectionAudit[];
}

export interface ConversionSectionAudit {
  sectionType: string;
  sectionIndex: number;
  scores: { clarity: number; persuasion: number; friction: number };
  issues: string[];
  suggestions: string[];
}

export interface ConversionRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  category: 'clarity' | 'persuasion' | 'friction' | 'trust' | 'visual' | 'pricing';
  page: string;
  section: string;
  currentIssue: string;
  recommendation: string;
  estimatedImpact: string;
  autoFixable: boolean;
  fixAction?: {
    type: 'rewrite_section' | 'add_element' | 'restructure' | 'restyle';
    sectionSelector: string;
    instruction: string;
  };
}

// ============================================================================
// SECTION REGENERATION
// ============================================================================

export interface SectionRegenerationRequest {
  tbwoId: string;
  artifactPath: string;
  sectionSelector: string;
  sectionHtml: string;
  action: SectionRegenerationAction;
  customInstruction?: string;
}

export type SectionRegenerationAction =
  | 'improve_conversion' | 'rewrite_tone' | 'make_premium' | 'make_aggressive'
  | 'shorten_copy' | 'add_social_proof' | 'add_urgency' | 'switch_layout' | 'custom';

export interface SectionRegenerationResult {
  success: boolean;
  originalHtml: string;
  newHtml: string;
  action: SectionRegenerationAction;
  artifactPath: string;
  sectionSelector: string;
}

// ============================================================================
// LAYOUT VARIANTS
// ============================================================================

export interface LayoutVariant {
  id: string;
  sectionType: string;
  name: string;
  description: string;
  cssHints: string;
  htmlStructure: string;
}

// ============================================================================
// SITE IMPROVEMENT REPORT
// ============================================================================

export interface SiteImprovementReport {
  id: string;
  tbwoId: string;
  generatedAt: number;
  overallScore: number;
  audits: {
    conversion: ConversionAuditResult;
    seo: SEOAuditResult;
    clarity: ClarityAuditResult;
    trust: TrustAuditResult;
    cta: CTAAuditResult;
    messaging: MessagingCohesionResult;
  };
  improvements: SiteImprovement[];
  appliedCount: number;
  totalCount: number;
}

export interface SiteImprovement {
  id: string;
  auditSource: 'conversion' | 'seo' | 'clarity' | 'trust' | 'cta' | 'messaging';
  priority: 'high' | 'medium' | 'low';
  page: string;
  section: string;
  description: string;
  currentIssue: string;
  proposedFix: string;
  enabled: boolean;
  applied: boolean;
  fixAction: {
    type: 'rewrite_section' | 'add_element' | 'add_meta' | 'restructure' | 'restyle';
    sectionSelector: string;
    instruction: string;
  };
}

export interface SEOAuditResult {
  score: number;
  issues: Array<{ page: string; issue: string; fix: string; severity: 'high' | 'medium' | 'low' }>;
}

export interface ClarityAuditResult {
  score: number;
  issues: Array<{ page: string; section: string; issue: string; fix: string }>;
}

export interface TrustAuditResult {
  score: number;
  issues: Array<{ page: string; issue: string; fix: string }>;
}

export interface CTAAuditResult {
  score: number;
  issues: Array<{ page: string; section: string; issue: string; fix: string }>;
}

export interface MessagingCohesionResult {
  score: number;
  issues: Array<{ pages: string[]; issue: string; fix: string }>;
}

// ============================================================================
// VIDEO UX ANALYSIS
// ============================================================================

export interface VideoUXAnalysis {
  id: string;
  videoName: string;
  frameCount: number;
  overallScore: number;  // 0-100
  scores: {
    layout: number;
    uxFlow: number;
    accessibility: number;
    copyClarity: number;
    designConsistency: number;
    frictionLevel: number;  // 0=no friction, 100=high friction
  };
  frameAnalyses: FrameAnalysis[];
  overallRecommendations: string[];
  criticalIssues: string[];
  generatedAt: number;
}

export interface FrameAnalysis {
  frameIndex: number;
  timestamp: number;  // seconds into video
  description: string;
  issues: string[];
  suggestions: string[];
  score: number;
}

// ============================================================================
// EPHEMERAL FUN TYPES
// ============================================================================

const EPHEMERAL_TYPES = new Set([
  TBWOType.BET_TRACKER, TBWOType.ROAST_PAGE, TBWOType.TRIBUTE_PAGE,
  TBWOType.DEBATE_PAGE, TBWOType.TIME_CAPSULE, TBWOType.SCOREBOARD,
]);

export function isEphemeralType(type: TBWOType): boolean {
  return EPHEMERAL_TYPES.has(type);
}

const REPORT_TYPES = new Set([
  TBWOType.RESEARCH_REPORT, TBWOType.MARKET_RESEARCH, TBWOType.DUE_DILIGENCE,
  TBWOType.SEO_AUDIT, TBWOType.BUSINESS_PLAN, TBWOType.CONTENT_STRATEGY,
]);

export function isReportType(type: TBWOType): boolean {
  return REPORT_TYPES.has(type as TBWOType);
}
