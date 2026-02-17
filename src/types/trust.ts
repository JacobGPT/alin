/**
 * Trust System Types — Trust scoring, levels, and transaction tracking
 */

export enum TrustLevel {
  NONE = 'none',
  MINIMAL = 'minimal',
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  FULL = 'full',
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

export enum TrustTransactionType {
  EARNED = 'earned',
  SPENT = 'spent',
  REVOKED = 'revoked',
  GRANTED = 'granted',
  DECAYED = 'decayed',
  RECOVERED = 'recovered',
  BONUS = 'bonus',
  PENALTY = 'penalty',
}

export interface CategoryTrust {
  category: TrustCategory;
  score: number;
  level: TrustLevel;
  successCount: number;
  failureCount: number;
  successRate: number;
  allowedOperations: string[];
  restrictedOperations: string[];
  lastActivity: number;
}

export interface TrustBalance {
  current: number;
  level: TrustLevel;
  categories: Map<TrustCategory, CategoryTrust>;
  allTimeEarned: number;
  allTimeSpent: number;
  allTimeRevoked: number;
  recentTrend: 'increasing' | 'decreasing' | 'stable';
  weeklyChange: number;
  monthlyChange: number;
  lastUpdated: number;
  lastEarned: number;
  lastSpent: number;
}

export interface TrustTransaction {
  id: string;
  type: TrustTransactionType;
  amount: number;
  previousBalance: number;
  newBalance: number;
  category: TrustCategory;
  reason: string;
  description?: string;
  sourceType: string;
  sourceId?: string;
  sourceName?: string;
  confidenceScore?: number;
  timestamp: number;
}

export interface TrustHistoryPoint {
  timestamp: number;
  score: number;
  level: TrustLevel;
  earned: number;
  spent: number;
  revoked: number;
  net: number;
}

export interface TrustMilestone {
  id: string;
  name: string;
  description: string;
  requiredScore?: number;
  requiredActions?: number;
  achieved: boolean;
  achievedAt?: number;
  progress: number;
  reward?: {
    type: string;
    value: string | number;
    description: string;
  };
}

export interface TrustPolicy {
  id: string;
  name: string;
  description: string;
  category: TrustCategory;
  actionTypes: string[];
  minimumTrustLevel: TrustLevel;
  minimumTrustScore: number;
  requiresApproval: boolean;
  baseTrustCost: number;
  riskMultiplier: number;
  maxPerHour: number;
  maxPerDay: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TrustNotification {
  id: string;
  type: string;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface TrustAnalytics {
  totalTransactions: number;
  averageDaily: number;
  peakScore: number;
  lowestScore: number;
}
