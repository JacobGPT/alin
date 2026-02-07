/**
 * TBWO (Time-Budgeted Work Order) Types
 * 
 * Complete type definitions for the autonomous agent execution system.
 * This is ALIN's flagship feature for bounded, inspectable, parallel execution.
 */

// ============================================================================
// CORE TBWO TYPES
// ============================================================================

export enum TBWOStatus {
  DRAFT = 'draft',                    // Being configured
  PLANNING = 'planning',              // ALIN is creating execution plan
  AWAITING_APPROVAL = 'awaiting_approval', // Plan ready for user review
  EXECUTING = 'executing',            // Work in progress
  PAUSED = 'paused',                  // Paused at checkpoint
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

  // Metadata
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
  tier: 'free' | 'pro' | 'team' | 'enterprise';
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
  MOTION = 'motion',                  // Animations
  QA = 'qa',                          // Quality assurance
  RESEARCH = 'research',              // Research & analysis
  DATA = 'data',                      // Data processing
  DEPLOYMENT = 'deployment',          // Deployment & ops
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
}
