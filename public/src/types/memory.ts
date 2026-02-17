/**
 * Memory System Types - 8-Layer Cognitive Architecture
 * 
 * Comprehensive type definitions for ALIN's memory system.
 * Memory is identity-forming, not just logging.
 */

// ============================================================================
// MEMORY LAYERS
// ============================================================================

export enum MemoryLayer {
  SHORT_TERM = 'short_term',          // Current context
  LONG_TERM = 'long_term',            // Autobiographical
  SEMANTIC = 'semantic',              // Facts and knowledge
  RELATIONAL = 'relational',          // People and relationships
  PROCEDURAL = 'procedural',          // Learned skills
  WORKING = 'working',                // Active reasoning
  EPISODIC = 'episodic',              // Specific events
  META = 'meta',                      // Memory about memory
}

/**
 * Base memory entry interface
 */
export interface MemoryEntry {
  id: string;
  layer: MemoryLayer;
  
  // Content
  content: string;
  embedding?: number[];              // Vector embedding
  
  // Metadata
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  accessCount: number;
  
  // Salience
  salience: number;                  // 0-1, importance score
  decayRate: number;                 // How fast salience decreases
  
  // Relationships
  relatedMemories: string[];         // IDs of related memories
  sourceMessages?: string[];         // Message IDs this came from
  
  // State
  isConsolidated: boolean;
  isArchived: boolean;
  isPinned: boolean;
  
  // Tags and categorization
  tags: string[];
  category?: string;
  
  // User control
  userModified: boolean;
  editHistory?: MemoryEdit[];
}

export interface MemoryEdit {
  timestamp: number;
  previousContent: string;
  newContent: string;
  reason?: string;
}

// ============================================================================
// SHORT-TERM MEMORY
// ============================================================================

export interface ShortTermMemory extends MemoryEntry {
  layer: MemoryLayer.SHORT_TERM;
  
  // Context
  conversationId: string;
  messageIds: string[];
  
  // Lifespan
  expiresAt: number;
  
  // Promotion eligibility
  promotionScore?: number;
  promotedTo?: string;              // ID of long-term memory if promoted
}

// ============================================================================
// LONG-TERM MEMORY (Autobiographical)
// ============================================================================

export interface LongTermMemory extends MemoryEntry {
  layer: MemoryLayer.LONG_TERM;
  
  // Event details
  eventType: EventType;
  significance: Significance;
  
  // Narrative structure
  narrative?: string;                // Story-form representation
  keyMoments: string[];
  
  // Emotional context
  emotionalTone?: EmotionalTone;
  
  // Consolidation
  consolidatedFrom: string[];        // IDs of short-term memories
  lastConsolidation: number;
}

export enum EventType {
  CONVERSATION = 'conversation',
  ACCOMPLISHMENT = 'accomplishment',
  DECISION = 'decision',
  PROMISE = 'promise',
  MILESTONE = 'milestone',
  CONFLICT = 'conflict',
  INSIGHT = 'insight',
  ERROR = 'error',
  FEEDBACK = 'feedback',
}

export enum Significance {
  TRIVIAL = 'trivial',
  MINOR = 'minor',
  MODERATE = 'moderate',
  IMPORTANT = 'important',
  CRITICAL = 'critical',
}

export enum EmotionalTone {
  POSITIVE = 'positive',
  NEGATIVE = 'negative',
  NEUTRAL = 'neutral',
  MIXED = 'mixed',
}

// ============================================================================
// SEMANTIC MEMORY (Facts & Knowledge)
// ============================================================================

export interface SemanticMemory extends MemoryEntry {
  layer: MemoryLayer.SEMANTIC;
  
  // Knowledge structure
  subject: string;
  predicate: string;
  object: string;
  
  // Confidence
  confidence: number;                // 0-1
  sources: string[];                 // Where this knowledge came from
  
  // Verification
  verified: boolean;
  lastVerified?: number;
  conflictsWith?: string[];          // IDs of conflicting memories
}

// ============================================================================
// RELATIONAL MEMORY (People & Relationships)
// ============================================================================

export interface RelationalMemory extends MemoryEntry {
  layer: MemoryLayer.RELATIONAL;
  
  // Entity
  entityId: string;
  entityType: EntityType;
  entityName: string;
  
  // Attributes
  attributes: Map<string, unknown>;
  
  // Relationships
  relationshipType?: RelationshipType;
  relationshipStrength?: number;     // 0-1
  
  // Interaction patterns
  interactionFrequency: number;
  lastInteraction: number;
  communicationStyle?: CommunicationStyle;
  
  // Preferences & boundaries
  preferences: Map<string, unknown>;
  boundaries: string[];
  trustLevel: number;                // 0-1
}

export enum EntityType {
  USER = 'user',
  TEAM_MEMBER = 'team_member',
  ORGANIZATION = 'organization',
  PROJECT = 'project',
  TOOL = 'tool',
  CONCEPT = 'concept',
}

export enum RelationshipType {
  PRIMARY_USER = 'primary_user',
  COLLABORATOR = 'collaborator',
  STAKEHOLDER = 'stakeholder',
  OBSERVER = 'observer',
}

export interface CommunicationStyle {
  formality: 'casual' | 'neutral' | 'formal';
  verbosity: 'concise' | 'balanced' | 'detailed';
  technicalLevel: 'beginner' | 'intermediate' | 'expert';
  preferredTone: 'professional' | 'friendly' | 'humorous' | 'serious';
}

// ============================================================================
// PROCEDURAL MEMORY (Skills & Patterns)
// ============================================================================

export interface ProceduralMemory extends MemoryEntry {
  layer: MemoryLayer.PROCEDURAL;
  
  // Skill definition
  skillName: string;
  skillType: SkillType;
  
  // Procedure
  steps: ProcedureStep[];
  
  // Performance
  successRate: number;
  averageExecutionTime: number;
  timesExecuted: number;
  
  // Learning
  learnedFrom: string[];             // Memory IDs or sources
  refinements: SkillRefinement[];
}

export enum SkillType {
  CODE_PATTERN = 'code_pattern',
  PROBLEM_SOLVING = 'problem_solving',
  COMMUNICATION = 'communication',
  RESEARCH_METHOD = 'research_method',
  CREATIVE_TECHNIQUE = 'creative_technique',
  WORKFLOW = 'workflow',
}

export interface ProcedureStep {
  order: number;
  action: string;
  expectedOutcome?: string;
  commonPitfalls?: string[];
}

export interface SkillRefinement {
  timestamp: number;
  improvement: string;
  triggeredBy: string;              // Event that led to refinement
}

// ============================================================================
// WORKING MEMORY (Active Reasoning)
// ============================================================================

export interface WorkingMemory extends MemoryEntry {
  layer: MemoryLayer.WORKING;
  
  // Current task
  taskId: string;
  taskType: string;
  
  // Active variables
  variables: Map<string, unknown>;
  
  // Reasoning chain
  reasoningSteps: ReasoningStep[];
  currentStep: number;
  
  // Hypotheses
  hypotheses: Hypothesis[];
  
  // Lifespan
  expiresAt: number;
}

export interface ReasoningStep {
  step: number;
  thought: string;
  action?: string;
  observation?: string;
  conclusion?: string;
}

export interface Hypothesis {
  statement: string;
  confidence: number;
  evidence: string[];
  counterEvidence: string[];
  status: 'active' | 'confirmed' | 'rejected';
}

// ============================================================================
// EPISODIC MEMORY (Specific Events)
// ============================================================================

export interface EpisodicMemory extends MemoryEntry {
  layer: MemoryLayer.EPISODIC;
  
  // Event details
  eventDescription: string;
  eventTimestamp: number;
  
  // Context
  participants: string[];            // Entity IDs
  location?: string;
  
  // Sensory details
  sensoryDetails?: SensoryDetails;
  
  // Outcome
  outcome?: string;
  lessonsLearned?: string[];
  
  // Connection to narrative
  narrativePosition: number;         // Position in overall story
  beforeEvent?: string;              // Previous event ID
  afterEvent?: string;               // Next event ID
}

export interface SensoryDetails {
  visual?: string;
  auditory?: string;
  contextual?: string;
}

// ============================================================================
// META-MEMORY (Self-Awareness)
// ============================================================================

export interface MetaMemory extends MemoryEntry {
  layer: MemoryLayer.META;
  
  // Self-knowledge
  memoryStatistics: MemoryStatistics;
  strengthsWeaknesses: Map<string, string>;
  
  // Learning about learning
  learningPatterns: string[];
  effectiveStrategies: string[];
  knownGaps: string[];
  
  // Self-monitoring
  performanceMetrics: Map<string, number>;
  improvementGoals: string[];
}

export interface MemoryStatistics {
  totalMemories: number;
  byLayer: Map<MemoryLayer, number>;
  averageSalience: number;
  consolidationRate: number;
  retrievalAccuracy: number;
}

// ============================================================================
// MEMORY OPERATIONS
// ============================================================================

export interface MemoryQuery {
  // Search
  query?: string;
  embedding?: number[];
  
  // Filters
  layers?: MemoryLayer[];
  tags?: string[];
  dateRange?: { start: number; end: number };
  minSalience?: number;
  
  // Options
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
  
  // Ranking
  sortBy?: 'salience' | 'recency' | 'access_count' | 'relevance';
  sortOrder?: 'asc' | 'desc';
}

export interface MemorySearchResult {
  memory: MemoryEntry;
  score: number;                     // Relevance score
  highlights?: string[];             // Matched text snippets
}

export interface MemoryConsolidation {
  id: string;
  startedAt: number;
  completedAt?: number;
  
  // Input
  sourceMemories: string[];
  
  // Output
  consolidatedMemories: string[];
  
  // Process
  method: ConsolidationMethod;
  compressionRatio: number;
  informationRetained: number;       // 0-1
  
  // Audit
  changeLog: ConsolidationChange[];
}

export enum ConsolidationMethod {
  MERGE = 'merge',                   // Combine similar memories
  SUMMARIZE = 'summarize',           // Create summary from multiple
  PROMOTE = 'promote',               // Short-term → long-term
  ARCHIVE = 'archive',               // Move to long-term storage
}

export interface ConsolidationChange {
  type: 'merged' | 'archived' | 'promoted' | 'deleted';
  memoryIds: string[];
  reason: string;
}

// ============================================================================
// MEMORY RETRIEVAL
// ============================================================================

export interface RetrievalContext {
  // Current context
  conversationId?: string;
  currentTask?: string;
  
  // User context
  userId: string;
  
  // Relevance factors
  timeWeight: number;                // How much to weight recency
  salienceWeight: number;            // How much to weight importance
  semanticWeight: number;            // How much to weight similarity
  
  // Constraints
  maxMemories: number;
  maxTokens?: number;
}

export interface RetrievalResult {
  memories: MemoryEntry[];
  totalRelevance: number;
  retrievalTime: number;
  
  // Context usage
  tokensUsed: number;
  tokensAvailable: number;
  
  // Metadata
  layerDistribution: Map<MemoryLayer, number>;
  averageSalience: number;
}

// ============================================================================
// MEMORY GRAPH
// ============================================================================

export interface MemoryGraph {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  
  // Statistics
  totalNodes: number;
  totalEdges: number;
  density: number;
  clusters: MemoryCluster[];
}

export interface MemoryNode {
  id: string;
  memoryId: string;
  label: string;
  layer: MemoryLayer;
  
  // Visual properties
  size: number;                      // Based on salience
  color: string;                     // Based on layer
  position?: { x: number; y: number; z?: number };
  
  // Graph metrics
  degree: number;                    // Number of connections
  centrality: number;                // Importance in network
}

export interface MemoryEdge {
  source: string;                    // Node ID
  target: string;                    // Node ID
  weight: number;                    // Connection strength
  type: EdgeType;
}

export enum EdgeType {
  SIMILARITY = 'similarity',
  CAUSATION = 'causation',
  TEMPORAL = 'temporal',             // Happened before/after
  REFERENCE = 'reference',           // Mentions/cites
  CONTRADICTION = 'contradiction',
  REFINEMENT = 'refinement',         // Newer version of
}

export interface MemoryCluster {
  id: string;
  label: string;
  nodeIds: string[];
  coherence: number;                 // How tightly clustered
  topic?: string;
}

// ============================================================================
// MEMORY MANAGEMENT
// ============================================================================

export interface MemoryManagerState {
  // System state
  totalMemories: number;
  totalSize: number;                 // In bytes
  
  // Layer breakdown
  layerCounts: Map<MemoryLayer, number>;
  
  // Health metrics
  fragmentationLevel: number;        // 0-1
  consolidationBacklog: number;
  averageRetrievalTime: number;
  
  // Limits
  maxMemories: number;
  maxSize: number;
  storageUsed: number;               // Percentage
  
  // Operations in progress
  activeConsolidations: number;
  pendingArchival: number;
}

export interface MemoryMaintenanceTask {
  type: MaintenanceType;
  priority: number;
  estimatedDuration: number;
  status: 'pending' | 'running' | 'complete' | 'failed';
}

export enum MaintenanceType {
  CONSOLIDATE_SHORT_TERM = 'consolidate_short_term',
  ARCHIVE_OLD_MEMORIES = 'archive_old_memories',
  REBUILD_INDEX = 'rebuild_index',
  UPDATE_EMBEDDINGS = 'update_embeddings',
  PRUNE_LOW_SALIENCE = 'prune_low_salience',
  RESOLVE_CONFLICTS = 'resolve_conflicts',
}

// ============================================================================
// PRIVACY & CONTROL
// ============================================================================

export interface MemoryPrivacySettings {
  // User control
  allowMemoryStorage: boolean;
  allowMemoryConsolidation: boolean;
  allowMemorySharing: boolean;
  
  // Retention
  retentionPeriod: number;           // Days, 0 = forever
  autoArchiveAfter: number;          // Days of inactivity
  
  // Deletion
  deletionPolicy: DeletionPolicy;
  
  // Sensitive data
  redactPII: boolean;
  sensitiveTopics: string[];
}

export enum DeletionPolicy {
  IMMEDIATE = 'immediate',
  SOFT_DELETE = 'soft_delete',       // Mark deleted, remove later
  ANONYMIZE = 'anonymize',           // Remove PII but keep structure
  NEVER = 'never',
}

export interface MemoryExport {
  exportedAt: number;
  format: 'json' | 'csv' | 'markdown';
  includeArchived: boolean;
  includeSensitive: boolean;
  
  // Data
  memories: MemoryEntry[];
  graph?: MemoryGraph;
  statistics: MemoryStatistics;
}
