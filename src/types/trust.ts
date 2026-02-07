/**
 * Trust System Types - Trust-Based Autonomy Model
 *
 * ALIN uses a trust-based system to manage autonomy levels.
 * Trust is earned through successful task completion and can be
 * spent on autonomous actions or revoked after failures.
 */

// ============================================================================
// TRUST BALANCE & LEVELS
// ============================================================================

export enum TrustLevel {
  NONE = 'none',                        // No trust - all actions require approval
  MINIMAL = 'minimal',                  // Limited autonomy
  LOW = 'low',                          // Basic autonomous actions
  MODERATE = 'moderate',                // Standard operations
  HIGH = 'high',                        // Extended autonomy
  FULL = 'full',                        // Complete trust (rare)
}

export interface TrustBalance {
  // Current trust score
  current: number;                      // 0-1000
  level: TrustLevel;

  // Trust breakdown by category
  categories: Map<TrustCategory, CategoryTrust>;

  // Historical
  allTimeEarned: number;
  allTimeSpent: number;
  allTimeRevoked: number;

  // Velocity
  recentTrend: 'increasing' | 'stable' | 'decreasing';
  weeklyChange: number;
  monthlyChange: number;

  // Timestamps
  lastUpdated: number;
  lastEarned?: number;
  lastSpent?: number;
  lastRevoked?: number;
}

export enum TrustCategory {
  CODE_EXECUTION = 'code_execution',
  FILE_OPERATIONS = 'file_operations',
  NETWORK_ACCESS = 'network_access',
  SYSTEM_CHANGES = 'system_changes',
  DEPLOYMENTS = 'deployments',
  DATA_ACCESS = 'data_access',
  EXTERNAL_APIS = 'external_apis',
  AUTONOMOUS_TASKS = 'autonomous_tasks',
}

export interface CategoryTrust {
  category: TrustCategory;
  score: number;                        // 0-100
  level: TrustLevel;

  // History for this category
  successCount: number;
  failureCount: number;
  successRate: number;                  // 0-1

  // Permissions
  allowedOperations: string[];
  restrictedOperations: string[];

  // Metadata
  lastActivity?: number;
  notes?: string[];
}

// ============================================================================
// TRUST TRANSACTIONS
// ============================================================================

export enum TrustTransactionType {
  EARNED = 'earned',                    // Gained through successful action
  SPENT = 'spent',                      // Used for autonomous action
  REVOKED = 'revoked',                  // Lost due to failure/violation
  GRANTED = 'granted',                  // Manually given by user
  DECAYED = 'decayed',                  // Natural decay over time
  RECOVERED = 'recovered',              // Recovered after correction
  BONUS = 'bonus',                      // Bonus for exceptional work
  PENALTY = 'penalty',                  // Penalty for violation
}

export interface TrustTransaction {
  id: string;
  type: TrustTransactionType;

  // Amount
  amount: number;                       // Positive or negative
  previousBalance: number;
  newBalance: number;

  // Context
  category: TrustCategory;
  reason: string;
  description: string;

  // Source
  sourceType: TrustSourceType;
  sourceId?: string;                    // TBWO ID, conversation ID, etc.
  sourceName?: string;

  // Evaluation
  confidenceScore?: number;             // How confident the system is
  verifiedBy?: string;                  // Who/what verified this

  // Timestamps
  timestamp: number;
  expiresAt?: number;                   // Some trust grants expire
}

export enum TrustSourceType {
  TBWO_COMPLETION = 'tbwo_completion',
  TBWO_FAILURE = 'tbwo_failure',
  CHECKPOINT_APPROVAL = 'checkpoint_approval',
  USER_GRANT = 'user_grant',
  USER_REVOKE = 'user_revoke',
  SYSTEM_PENALTY = 'system_penalty',
  TIME_DECAY = 'time_decay',
  QUALITY_BONUS = 'quality_bonus',
  RECOVERY_ACTION = 'recovery_action',
  POLICY_VIOLATION = 'policy_violation',
}

// ============================================================================
// TRUST SPENDING
// ============================================================================

export interface TrustSpend {
  id: string;

  // What was done
  action: TrustAction;
  actionDescription: string;

  // Cost
  trustCost: number;
  category: TrustCategory;

  // Authorization
  requiresApproval: boolean;
  approvalStatus?: 'pending' | 'approved' | 'denied';
  approvedBy?: string;

  // Result
  status: 'pending' | 'executing' | 'success' | 'failed' | 'reverted';
  result?: TrustSpendResult;

  // Metadata
  requestedAt: number;
  executedAt?: number;
  completedAt?: number;

  // Tracking
  tbwoId?: string;
  podId?: string;
}

export interface TrustAction {
  type: TrustActionType;
  target: string;
  parameters: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export enum TrustActionType {
  EXECUTE_CODE = 'execute_code',
  WRITE_FILE = 'write_file',
  DELETE_FILE = 'delete_file',
  MODIFY_CONFIG = 'modify_config',
  NETWORK_REQUEST = 'network_request',
  DEPLOY = 'deploy',
  INSTALL_PACKAGE = 'install_package',
  DATABASE_WRITE = 'database_write',
  EXTERNAL_API_CALL = 'external_api_call',
  SYSTEM_COMMAND = 'system_command',
}

export interface TrustSpendResult {
  success: boolean;
  outcome: string;

  // Impact assessment
  filesModified?: number;
  linesChanged?: number;
  resourcesUsed?: number;

  // Trust adjustment
  trustRefund?: number;                 // Partial refund if stopped early
  trustBonus?: number;                  // Bonus for excellent execution
  trustPenalty?: number;                // Penalty for issues

  // Errors if any
  errors?: string[];
  warnings?: string[];
}

// ============================================================================
// TRUST POLICIES
// ============================================================================

export interface TrustPolicy {
  id: string;
  name: string;
  description: string;

  // When this policy applies
  category: TrustCategory;
  actionTypes: TrustActionType[];

  // Requirements
  minimumTrustLevel: TrustLevel;
  minimumTrustScore: number;
  requiresApproval: boolean;

  // Cost
  baseTrustCost: number;
  riskMultiplier: number;

  // Limits
  maxPerHour?: number;
  maxPerDay?: number;
  cooldownMinutes?: number;

  // Active
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TrustLevelThresholds {
  [TrustLevel.NONE]: number;            // 0
  [TrustLevel.MINIMAL]: number;         // 100
  [TrustLevel.LOW]: number;             // 250
  [TrustLevel.MODERATE]: number;        // 500
  [TrustLevel.HIGH]: number;            // 750
  [TrustLevel.FULL]: number;            // 950
}

// ============================================================================
// TRUST RECOVERY
// ============================================================================

export interface TrustRecovery {
  id: string;

  // What went wrong
  violationType: ViolationType;
  violationDescription: string;
  trustLost: number;

  // Recovery plan
  recoveryActions: RecoveryAction[];
  recoveryProgress: number;             // 0-100

  // Status
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt?: number;
  completedAt?: number;

  // Trust restoration
  trustRecovered: number;
  remainingToRecover: number;
}

export enum ViolationType {
  SCOPE_VIOLATION = 'scope_violation',
  PERMISSION_EXCEEDED = 'permission_exceeded',
  QUALITY_FAILURE = 'quality_failure',
  TIMEOUT_EXCEEDED = 'timeout_exceeded',
  RESOURCE_ABUSE = 'resource_abuse',
  DATA_MISHANDLING = 'data_mishandling',
  UNEXPECTED_BEHAVIOR = 'unexpected_behavior',
}

export interface RecoveryAction {
  id: string;
  order: number;

  // Action details
  type: RecoveryActionType;
  description: string;

  // Status
  status: 'pending' | 'completed' | 'skipped';
  completedAt?: number;

  // Impact
  trustValue: number;                   // How much trust this recovers
}

export enum RecoveryActionType {
  ACKNOWLEDGE = 'acknowledge',          // Acknowledge the issue
  EXPLAIN = 'explain',                  // Explain what happened
  REVERT = 'revert',                    // Revert the changes
  FIX = 'fix',                          // Fix the issue
  VERIFY = 'verify',                    // Verify the fix works
  DEMONSTRATE = 'demonstrate',          // Demonstrate improved behavior
  WAIT = 'wait',                        // Time-based recovery
}

// ============================================================================
// TRUST ANALYTICS
// ============================================================================

export interface TrustAnalytics {
  // Summary metrics
  currentScore: number;
  currentLevel: TrustLevel;
  percentile: number;                   // Where user stands

  // Trends
  dailyHistory: TrustHistoryPoint[];
  weeklyHistory: TrustHistoryPoint[];
  monthlyHistory: TrustHistoryPoint[];

  // Breakdown
  categoryBreakdown: CategoryTrust[];
  transactionBreakdown: TransactionBreakdown;

  // Projections
  projectedScore: number;               // Where score is heading
  projectedLevel: TrustLevel;
  projectionTimeframe: number;          // Days

  // Insights
  insights: TrustInsight[];
  recommendations: string[];
}

export interface TrustHistoryPoint {
  timestamp: number;
  score: number;
  level: TrustLevel;

  // Activity
  earned: number;
  spent: number;
  revoked: number;
  net: number;
}

export interface TransactionBreakdown {
  totalTransactions: number;
  byType: Map<TrustTransactionType, number>;
  byCategory: Map<TrustCategory, number>;

  // Averages
  averageEarned: number;
  averageSpent: number;
  averageRevoked: number;
}

export interface TrustInsight {
  type: 'positive' | 'negative' | 'neutral' | 'warning';
  title: string;
  description: string;
  metric?: string;
  value?: number;
  trend?: 'up' | 'down' | 'stable';
}

// ============================================================================
// TRUST NOTIFICATIONS
// ============================================================================

export interface TrustNotification {
  id: string;
  type: TrustNotificationType;

  // Content
  title: string;
  message: string;

  // Context
  transactionId?: string;
  category?: TrustCategory;

  // State
  read: boolean;
  dismissed: boolean;

  // Timestamps
  createdAt: number;
  readAt?: number;
}

export enum TrustNotificationType {
  LEVEL_UP = 'level_up',
  LEVEL_DOWN = 'level_down',
  TRUST_EARNED = 'trust_earned',
  TRUST_SPENT = 'trust_spent',
  TRUST_REVOKED = 'trust_revoked',
  RECOVERY_STARTED = 'recovery_started',
  RECOVERY_COMPLETED = 'recovery_completed',
  POLICY_CHANGE = 'policy_change',
  MILESTONE_REACHED = 'milestone_reached',
  WARNING = 'warning',
}

// ============================================================================
// TRUST MILESTONES
// ============================================================================

export interface TrustMilestone {
  id: string;
  name: string;
  description: string;

  // Requirement
  requiredScore?: number;
  requiredLevel?: TrustLevel;
  requiredActions?: number;

  // Status
  achieved: boolean;
  achievedAt?: number;
  progress: number;                     // 0-100

  // Reward
  reward?: MilestoneReward;
}

export interface MilestoneReward {
  type: 'trust_bonus' | 'unlock_feature' | 'badge' | 'capability';
  value: number | string;
  description: string;
}

// ============================================================================
// TRUST CONFIGURATION
// ============================================================================

export interface TrustConfiguration {
  // Earning rates
  baseEarnRate: number;                 // Base trust per successful action
  qualityMultiplier: number;            // Bonus for high-quality work
  streakBonus: number;                  // Bonus for consecutive successes

  // Spending
  baseSpendRate: number;
  riskMultipliers: Record<string, number>;

  // Decay
  enableDecay: boolean;
  decayRate: number;                    // Per day
  decayGracePeriod: number;             // Days before decay starts

  // Recovery
  recoveryRate: number;                 // How fast trust can be recovered
  maxRecoveryPerDay: number;

  // Thresholds
  levelThresholds: TrustLevelThresholds;

  // Notifications
  notifyOnLevelChange: boolean;
  notifyOnTransaction: boolean;
  notifyOnMilestone: boolean;
}
