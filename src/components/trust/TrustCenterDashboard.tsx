/**
 * Trust Center Dashboard
 *
 * Comprehensive view of the trust system showing:
 * - Current trust balance and level
 * - Trust history and trends
 * - Category breakdown
 * - Recent transactions
 * - Active policies
 */

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrustLevel,
  TrustCategory,
  TrustTransactionType,
  TrustBalance,
  TrustTransaction,
  TrustAnalytics,
  TrustHistoryPoint,
  CategoryTrust,
  TrustNotification,
  TrustMilestone,
  TrustPolicy,
} from '@/types/trust';

// ============================================================================
// CONFIGURATION
// ============================================================================

const TRUST_LEVEL_CONFIG: Record<TrustLevel, {
  label: string;
  color: string;
  bgColor: string;
  icon: string;
  description: string;
}> = {
  [TrustLevel.NONE]: {
    label: 'No Trust',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    icon: '🔒',
    description: 'All actions require explicit approval',
  },
  [TrustLevel.MINIMAL]: {
    label: 'Minimal',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    icon: '🔴',
    description: 'Very limited autonomous actions',
  },
  [TrustLevel.LOW]: {
    label: 'Low',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    icon: '🟠',
    description: 'Basic read and simple operations',
  },
  [TrustLevel.MODERATE]: {
    label: 'Moderate',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    icon: '🟡',
    description: 'Standard development operations',
  },
  [TrustLevel.HIGH]: {
    label: 'High',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    icon: '🟢',
    description: 'Extended autonomy for complex tasks',
  },
  [TrustLevel.FULL]: {
    label: 'Full Trust',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    icon: '💎',
    description: 'Complete autonomous operation',
  },
};

const CATEGORY_CONFIG: Record<TrustCategory, {
  label: string;
  icon: string;
  color: string;
}> = {
  [TrustCategory.CODE_EXECUTION]: {
    label: 'Code Execution',
    icon: '⚡',
    color: 'text-purple-400',
  },
  [TrustCategory.FILE_OPERATIONS]: {
    label: 'File Operations',
    icon: '📁',
    color: 'text-blue-400',
  },
  [TrustCategory.NETWORK_ACCESS]: {
    label: 'Network Access',
    icon: '🌐',
    color: 'text-cyan-400',
  },
  [TrustCategory.SYSTEM_CHANGES]: {
    label: 'System Changes',
    icon: '⚙️',
    color: 'text-orange-400',
  },
  [TrustCategory.DEPLOYMENTS]: {
    label: 'Deployments',
    icon: '🚀',
    color: 'text-green-400',
  },
  [TrustCategory.DATA_ACCESS]: {
    label: 'Data Access',
    icon: '🗄️',
    color: 'text-yellow-400',
  },
  [TrustCategory.EXTERNAL_APIS]: {
    label: 'External APIs',
    icon: '🔌',
    color: 'text-pink-400',
  },
  [TrustCategory.AUTONOMOUS_TASKS]: {
    label: 'Autonomous Tasks',
    icon: '🤖',
    color: 'text-indigo-400',
  },
};

const TRANSACTION_TYPE_CONFIG: Record<TrustTransactionType, {
  label: string;
  icon: string;
  color: string;
}> = {
  [TrustTransactionType.EARNED]: { label: 'Earned', icon: '✨', color: 'text-green-400' },
  [TrustTransactionType.SPENT]: { label: 'Spent', icon: '💸', color: 'text-blue-400' },
  [TrustTransactionType.REVOKED]: { label: 'Revoked', icon: '❌', color: 'text-red-400' },
  [TrustTransactionType.GRANTED]: { label: 'Granted', icon: '🎁', color: 'text-purple-400' },
  [TrustTransactionType.DECAYED]: { label: 'Decayed', icon: '📉', color: 'text-gray-400' },
  [TrustTransactionType.RECOVERED]: { label: 'Recovered', icon: '🔄', color: 'text-cyan-400' },
  [TrustTransactionType.BONUS]: { label: 'Bonus', icon: '🌟', color: 'text-yellow-400' },
  [TrustTransactionType.PENALTY]: { label: 'Penalty', icon: '⚠️', color: 'text-orange-400' },
};

// ============================================================================
// MOCK DATA
// ============================================================================

const generateMockBalance = (): TrustBalance => ({
  current: 687,
  level: TrustLevel.MODERATE,
  categories: new Map([
    [TrustCategory.CODE_EXECUTION, {
      category: TrustCategory.CODE_EXECUTION,
      score: 78,
      level: TrustLevel.HIGH,
      successCount: 156,
      failureCount: 8,
      successRate: 0.95,
      allowedOperations: ['run_script', 'execute_command', 'run_tests'],
      restrictedOperations: ['system_level_commands'],
      lastActivity: Date.now() - 1000 * 60 * 30,
    }],
    [TrustCategory.FILE_OPERATIONS, {
      category: TrustCategory.FILE_OPERATIONS,
      score: 85,
      level: TrustLevel.HIGH,
      successCount: 342,
      failureCount: 12,
      successRate: 0.97,
      allowedOperations: ['read', 'write', 'create', 'delete'],
      restrictedOperations: ['modify_system_files'],
      lastActivity: Date.now() - 1000 * 60 * 5,
    }],
    [TrustCategory.NETWORK_ACCESS, {
      category: TrustCategory.NETWORK_ACCESS,
      score: 62,
      level: TrustLevel.MODERATE,
      successCount: 89,
      failureCount: 7,
      successRate: 0.93,
      allowedOperations: ['fetch_api', 'download_resource'],
      restrictedOperations: ['arbitrary_network_requests'],
      lastActivity: Date.now() - 1000 * 60 * 120,
    }],
    [TrustCategory.SYSTEM_CHANGES, {
      category: TrustCategory.SYSTEM_CHANGES,
      score: 45,
      level: TrustLevel.LOW,
      successCount: 23,
      failureCount: 3,
      successRate: 0.88,
      allowedOperations: ['modify_config'],
      restrictedOperations: ['install_packages', 'modify_env'],
      lastActivity: Date.now() - 1000 * 60 * 60 * 24,
    }],
    [TrustCategory.DEPLOYMENTS, {
      category: TrustCategory.DEPLOYMENTS,
      score: 58,
      level: TrustLevel.MODERATE,
      successCount: 15,
      failureCount: 2,
      successRate: 0.88,
      allowedOperations: ['preview_deploy'],
      restrictedOperations: ['production_deploy'],
      lastActivity: Date.now() - 1000 * 60 * 60 * 48,
    }],
    [TrustCategory.DATA_ACCESS, {
      category: TrustCategory.DATA_ACCESS,
      score: 72,
      level: TrustLevel.MODERATE,
      successCount: 67,
      failureCount: 4,
      successRate: 0.94,
      allowedOperations: ['read_data', 'query_database'],
      restrictedOperations: ['delete_data', 'modify_schema'],
      lastActivity: Date.now() - 1000 * 60 * 45,
    }],
    [TrustCategory.EXTERNAL_APIS, {
      category: TrustCategory.EXTERNAL_APIS,
      score: 55,
      level: TrustLevel.MODERATE,
      successCount: 34,
      failureCount: 5,
      successRate: 0.87,
      allowedOperations: ['call_whitelisted_apis'],
      restrictedOperations: ['arbitrary_api_calls'],
      lastActivity: Date.now() - 1000 * 60 * 90,
    }],
    [TrustCategory.AUTONOMOUS_TASKS, {
      category: TrustCategory.AUTONOMOUS_TASKS,
      score: 68,
      level: TrustLevel.MODERATE,
      successCount: 28,
      failureCount: 3,
      successRate: 0.90,
      allowedOperations: ['simple_tbwo', 'research_tasks'],
      restrictedOperations: ['complex_tbwo', 'long_running_tasks'],
      lastActivity: Date.now() - 1000 * 60 * 180,
    }],
  ]),
  allTimeEarned: 2450,
  allTimeSpent: 1520,
  allTimeRevoked: 243,
  recentTrend: 'increasing',
  weeklyChange: 45,
  monthlyChange: 187,
  lastUpdated: Date.now(),
  lastEarned: Date.now() - 1000 * 60 * 30,
  lastSpent: Date.now() - 1000 * 60 * 60,
});

const generateMockTransactions = (): TrustTransaction[] => [
  {
    id: 'tx-1',
    type: TrustTransactionType.EARNED,
    amount: 15,
    previousBalance: 672,
    newBalance: 687,
    category: TrustCategory.CODE_EXECUTION,
    reason: 'TBWO completed successfully',
    description: 'Website Sprint completed with high quality score',
    sourceType: 'tbwo_completion' as any,
    sourceId: 'tbwo-123',
    sourceName: 'Website Sprint - Landing Page',
    confidenceScore: 0.95,
    timestamp: Date.now() - 1000 * 60 * 30,
  },
  {
    id: 'tx-2',
    type: TrustTransactionType.SPENT,
    amount: -8,
    previousBalance: 680,
    newBalance: 672,
    category: TrustCategory.FILE_OPERATIONS,
    reason: 'Autonomous file modification',
    description: 'Modified 12 files during TBWO execution',
    sourceType: 'tbwo_completion' as any,
    sourceId: 'tbwo-122',
    timestamp: Date.now() - 1000 * 60 * 60,
  },
  {
    id: 'tx-3',
    type: TrustTransactionType.BONUS,
    amount: 25,
    previousBalance: 655,
    newBalance: 680,
    category: TrustCategory.AUTONOMOUS_TASKS,
    reason: 'Exceptional quality bonus',
    description: 'Achieved 98% quality score on complex task',
    sourceType: 'quality_bonus' as any,
    timestamp: Date.now() - 1000 * 60 * 60 * 3,
  },
  {
    id: 'tx-4',
    type: TrustTransactionType.EARNED,
    amount: 10,
    previousBalance: 645,
    newBalance: 655,
    category: TrustCategory.DATA_ACCESS,
    reason: 'Successful data analysis',
    description: 'Completed research report with accurate findings',
    sourceType: 'tbwo_completion' as any,
    timestamp: Date.now() - 1000 * 60 * 60 * 6,
  },
  {
    id: 'tx-5',
    type: TrustTransactionType.REVOKED,
    amount: -15,
    previousBalance: 660,
    newBalance: 645,
    category: TrustCategory.NETWORK_ACCESS,
    reason: 'Timeout exceeded',
    description: 'API request exceeded allocated time budget',
    sourceType: 'tbwo_failure' as any,
    timestamp: Date.now() - 1000 * 60 * 60 * 12,
  },
  {
    id: 'tx-6',
    type: TrustTransactionType.GRANTED,
    amount: 50,
    previousBalance: 610,
    newBalance: 660,
    category: TrustCategory.CODE_EXECUTION,
    reason: 'User trust grant',
    description: 'Manual trust boost after successful demonstration',
    sourceType: 'user_grant' as any,
    timestamp: Date.now() - 1000 * 60 * 60 * 24,
  },
];

const generateMockHistory = (): TrustHistoryPoint[] => {
  const points: TrustHistoryPoint[] = [];
  let score = 500;

  for (let i = 30; i >= 0; i--) {
    const earned = Math.floor(Math.random() * 20) + 5;
    const spent = Math.floor(Math.random() * 15);
    const revoked = Math.random() > 0.8 ? Math.floor(Math.random() * 10) : 0;
    const net = earned - spent - revoked;
    score = Math.max(0, Math.min(1000, score + net));

    points.push({
      timestamp: Date.now() - i * 24 * 60 * 60 * 1000,
      score,
      level: score >= 750 ? TrustLevel.HIGH :
             score >= 500 ? TrustLevel.MODERATE :
             score >= 250 ? TrustLevel.LOW : TrustLevel.MINIMAL,
      earned,
      spent,
      revoked,
      net,
    });
  }

  return points;
};

const generateMockMilestones = (): TrustMilestone[] => [
  {
    id: 'm-1',
    name: 'First Steps',
    description: 'Complete your first TBWO',
    requiredActions: 1,
    achieved: true,
    achievedAt: Date.now() - 1000 * 60 * 60 * 24 * 15,
    progress: 100,
    reward: { type: 'trust_bonus', value: 25, description: '+25 Trust Bonus' },
  },
  {
    id: 'm-2',
    name: 'Trust Builder',
    description: 'Reach 500 trust score',
    requiredScore: 500,
    achieved: true,
    achievedAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    progress: 100,
    reward: { type: 'unlock_feature', value: 'autonomous_file_ops', description: 'Unlock autonomous file operations' },
  },
  {
    id: 'm-3',
    name: 'Reliable Partner',
    description: 'Complete 25 TBWOs successfully',
    requiredActions: 25,
    achieved: true,
    achievedAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
    progress: 100,
    reward: { type: 'badge', value: 'reliable', description: 'Reliable Partner badge' },
  },
  {
    id: 'm-4',
    name: 'High Trust',
    description: 'Reach High trust level (750+)',
    requiredScore: 750,
    achieved: false,
    progress: 91.6, // 687/750
    reward: { type: 'capability', value: 'extended_autonomy', description: 'Extended autonomy capabilities' },
  },
  {
    id: 'm-5',
    name: 'Century Club',
    description: 'Complete 100 successful tasks',
    requiredActions: 100,
    achieved: false,
    progress: 75,
    reward: { type: 'trust_bonus', value: 100, description: '+100 Trust Bonus' },
  },
];

// ============================================================================
// COMPONENTS
// ============================================================================

type TabType = 'overview' | 'categories' | 'transactions' | 'milestones' | 'policies';

export function TrustCenterDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [balance] = useState<TrustBalance>(generateMockBalance);
  const [transactions] = useState<TrustTransaction[]>(generateMockTransactions);
  const [history] = useState<TrustHistoryPoint[]>(generateMockHistory);
  const [milestones] = useState<TrustMilestone[]>(generateMockMilestones);

  const levelConfig = TRUST_LEVEL_CONFIG[balance.level];
  const nextLevel = getNextLevel(balance.level);
  const progressToNextLevel = nextLevel ? getProgressToNextLevel(balance.current, balance.level, nextLevel) : 100;

  return (
    <div className="flex h-full flex-col bg-background-primary">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-border-primary bg-background-secondary px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">Trust Center</h1>
            <p className="mt-1 text-sm text-text-secondary">
              Manage autonomy levels and track trust metrics
            </p>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-sm text-text-tertiary">Weekly Change</div>
              <div className={`text-lg font-semibold ${balance.weeklyChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {balance.weeklyChange >= 0 ? '+' : ''}{balance.weeklyChange}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-text-tertiary">Monthly Change</div>
              <div className={`text-lg font-semibold ${balance.monthlyChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {balance.monthlyChange >= 0 ? '+' : ''}{balance.monthlyChange}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Trust Score */}
        <aside className="w-80 flex-shrink-0 overflow-y-auto border-r border-border-primary bg-background-secondary p-6">
          {/* Trust Score Card */}
          <div className="mb-6 rounded-xl bg-background-tertiary p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-text-secondary">Trust Score</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${levelConfig.bgColor} ${levelConfig.color}`}>
                {levelConfig.icon} {levelConfig.label}
              </span>
            </div>

            {/* Score Display */}
            <div className="mb-4">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-text-primary">{balance.current}</span>
                <span className="text-lg text-text-tertiary">/ 1000</span>
              </div>
            </div>

            {/* Progress to Next Level */}
            {nextLevel && (
              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">Progress to {TRUST_LEVEL_CONFIG[nextLevel].label}</span>
                  <span className="text-text-secondary">{progressToNextLevel.toFixed(0)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background-primary">
                  <motion.div
                    className="h-full rounded-full bg-brand-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressToNextLevel}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
              </div>
            )}

            <p className="text-xs text-text-tertiary">{levelConfig.description}</p>
          </div>

          {/* Trust Trend */}
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-medium text-text-secondary">30-Day Trend</h3>
            <TrustSparkline data={history} />
          </div>

          {/* Quick Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-background-tertiary p-3">
              <div className="text-xs text-text-tertiary">All-Time Earned</div>
              <div className="text-lg font-semibold text-green-400">+{balance.allTimeEarned}</div>
            </div>
            <div className="rounded-lg bg-background-tertiary p-3">
              <div className="text-xs text-text-tertiary">All-Time Spent</div>
              <div className="text-lg font-semibold text-blue-400">-{balance.allTimeSpent}</div>
            </div>
            <div className="rounded-lg bg-background-tertiary p-3">
              <div className="text-xs text-text-tertiary">All-Time Revoked</div>
              <div className="text-lg font-semibold text-red-400">-{balance.allTimeRevoked}</div>
            </div>
            <div className="rounded-lg bg-background-tertiary p-3">
              <div className="text-xs text-text-tertiary">Net Change</div>
              <div className="text-lg font-semibold text-text-primary">
                {balance.allTimeEarned - balance.allTimeSpent - balance.allTimeRevoked}
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <h3 className="mb-3 text-sm font-medium text-text-secondary">Recent Activity</h3>
            <div className="space-y-2">
              {transactions.slice(0, 3).map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-lg bg-background-tertiary p-2"
                >
                  <div className="flex items-center gap-2">
                    <span>{TRANSACTION_TYPE_CONFIG[tx.type].icon}</span>
                    <span className="text-sm text-text-secondary">{tx.reason}</span>
                  </div>
                  <span className={`text-sm font-medium ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {tx.amount >= 0 ? '+' : ''}{tx.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex-shrink-0 border-b border-border-primary bg-background-secondary px-6">
            <nav className="flex gap-1">
              {[
                { key: 'overview', label: 'Overview' },
                { key: 'categories', label: 'Categories' },
                { key: 'transactions', label: 'Transactions' },
                { key: 'milestones', label: 'Milestones' },
                { key: 'policies', label: 'Policies' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as TabType)}
                  className={`relative px-4 py-3 text-sm font-medium transition-colors
                    ${activeTab === key
                      ? 'text-brand-primary'
                      : 'text-text-secondary hover:text-text-primary'
                    }`}
                >
                  {label}
                  {activeTab === key && (
                    <motion.div
                      layoutId="trust-tab-indicator"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary"
                    />
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <AnimatePresence mode="wait">
              {activeTab === 'overview' && (
                <OverviewTab balance={balance} history={history} />
              )}
              {activeTab === 'categories' && (
                <CategoriesTab balance={balance} />
              )}
              {activeTab === 'transactions' && (
                <TransactionsTab transactions={transactions} />
              )}
              {activeTab === 'milestones' && (
                <MilestonesTab milestones={milestones} />
              )}
              {activeTab === 'policies' && (
                <PoliciesTab />
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// TAB COMPONENTS
// ============================================================================

function OverviewTab({ balance, history }: { balance: TrustBalance; history: TrustHistoryPoint[] }) {
  const categories = Array.from(balance.categories.values());

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* Trust Level Ladder */}
      <div className="rounded-xl bg-background-secondary p-6">
        <h3 className="mb-4 text-lg font-medium text-text-primary">Trust Level Progress</h3>
        <TrustLevelLadder currentScore={balance.current} currentLevel={balance.level} />
      </div>

      {/* History Chart */}
      <div className="rounded-xl bg-background-secondary p-6">
        <h3 className="mb-4 text-lg font-medium text-text-primary">Trust History (30 Days)</h3>
        <TrustChart data={history} />
      </div>

      {/* Category Overview */}
      <div className="rounded-xl bg-background-secondary p-6">
        <h3 className="mb-4 text-lg font-medium text-text-primary">Category Summary</h3>
        <div className="grid grid-cols-4 gap-4">
          {categories.map((cat) => {
            const config = CATEGORY_CONFIG[cat.category];
            const levelConfig = TRUST_LEVEL_CONFIG[cat.level];

            return (
              <div key={cat.category} className="rounded-lg bg-background-tertiary p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xl">{config.icon}</span>
                  <span className="text-sm font-medium text-text-primary">{config.label}</span>
                </div>
                <div className="mb-2">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-text-primary">{cat.score}</span>
                    <span className="text-xs text-text-tertiary">/ 100</span>
                  </div>
                </div>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-background-primary">
                  <div
                    className={`h-full rounded-full ${config.color.replace('text-', 'bg-')}`}
                    style={{ width: `${cat.score}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className={`${levelConfig.color}`}>{levelConfig.label}</span>
                  <span className="text-text-tertiary">{(cat.successRate * 100).toFixed(0)}% success</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function CategoriesTab({ balance }: { balance: TrustBalance }) {
  const categories = Array.from(balance.categories.values());
  const [selectedCategory, setSelectedCategory] = useState<TrustCategory | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      <div className="grid grid-cols-2 gap-4">
        {categories.map((cat) => {
          const config = CATEGORY_CONFIG[cat.category];
          const levelConfig = TRUST_LEVEL_CONFIG[cat.level];
          const isSelected = selectedCategory === cat.category;

          return (
            <motion.div
              key={cat.category}
              onClick={() => setSelectedCategory(isSelected ? null : cat.category)}
              className={`cursor-pointer rounded-xl bg-background-secondary p-6 transition-all
                ${isSelected ? 'ring-2 ring-brand-primary' : 'hover:bg-background-tertiary'}`}
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              {/* Header */}
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.icon}</span>
                  <div>
                    <h4 className="font-medium text-text-primary">{config.label}</h4>
                    <span className={`text-xs ${levelConfig.color}`}>{levelConfig.label}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-text-primary">{cat.score}</div>
                  <div className="text-xs text-text-tertiary">/ 100</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="mb-4 h-2 overflow-hidden rounded-full bg-background-primary">
                <motion.div
                  className={`h-full rounded-full ${config.color.replace('text-', 'bg-')}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${cat.score}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-lg font-semibold text-green-400">{cat.successCount}</div>
                  <div className="text-xs text-text-tertiary">Successes</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-red-400">{cat.failureCount}</div>
                  <div className="text-xs text-text-tertiary">Failures</div>
                </div>
                <div>
                  <div className="text-lg font-semibold text-text-primary">
                    {(cat.successRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-text-tertiary">Success Rate</div>
                </div>
              </div>

              {/* Expanded Details */}
              <AnimatePresence>
                {isSelected && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-4 overflow-hidden border-t border-border-primary pt-4"
                  >
                    <div className="space-y-3">
                      <div>
                        <div className="mb-1 text-xs font-medium text-text-secondary">Allowed Operations</div>
                        <div className="flex flex-wrap gap-1">
                          {cat.allowedOperations.map((op) => (
                            <span
                              key={op}
                              className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400"
                            >
                              {op}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-medium text-text-secondary">Restricted Operations</div>
                        <div className="flex flex-wrap gap-1">
                          {cat.restrictedOperations.map((op) => (
                            <span
                              key={op}
                              className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400"
                            >
                              {op}
                            </span>
                          ))}
                        </div>
                      </div>
                      {cat.lastActivity && (
                        <div className="text-xs text-text-tertiary">
                          Last activity: {formatRelativeTime(cat.lastActivity)}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function TransactionsTab({ transactions }: { transactions: TrustTransaction[] }) {
  const [filter, setFilter] = useState<TrustTransactionType | 'all'>('all');

  const filteredTransactions = filter === 'all'
    ? transactions
    : transactions.filter((tx) => tx.type === filter);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Filters */}
      <div className="flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
            ${filter === 'all'
              ? 'bg-brand-primary text-white'
              : 'bg-background-secondary text-text-secondary hover:text-text-primary'
            }`}
        >
          All
        </button>
        {Object.entries(TRANSACTION_TYPE_CONFIG).map(([type, config]) => (
          <button
            key={type}
            onClick={() => setFilter(type as TrustTransactionType)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
              ${filter === type
                ? 'bg-brand-primary text-white'
                : 'bg-background-secondary text-text-secondary hover:text-text-primary'
              }`}
          >
            {config.icon} {config.label}
          </button>
        ))}
      </div>

      {/* Transactions List */}
      <div className="rounded-xl bg-background-secondary">
        {filteredTransactions.map((tx, index) => {
          const typeConfig = TRANSACTION_TYPE_CONFIG[tx.type];
          const categoryConfig = CATEGORY_CONFIG[tx.category];

          return (
            <motion.div
              key={tx.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`flex items-center gap-4 p-4
                ${index > 0 ? 'border-t border-border-primary' : ''}`}
            >
              {/* Icon */}
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                tx.amount >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'
              }`}>
                <span className="text-xl">{typeConfig.icon}</span>
              </div>

              {/* Details */}
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{tx.reason}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs ${categoryConfig.color} bg-background-tertiary`}>
                    {categoryConfig.icon} {categoryConfig.label}
                  </span>
                </div>
                <div className="text-sm text-text-tertiary">{tx.description}</div>
                <div className="mt-1 text-xs text-text-tertiary">
                  {formatRelativeTime(tx.timestamp)}
                  {tx.sourceName && ` • ${tx.sourceName}`}
                </div>
              </div>

              {/* Amount */}
              <div className="text-right">
                <div className={`text-xl font-bold ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {tx.amount >= 0 ? '+' : ''}{tx.amount}
                </div>
                <div className="text-xs text-text-tertiary">
                  {tx.previousBalance} → {tx.newBalance}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function MilestonesTab({ milestones }: { milestones: TrustMilestone[] }) {
  const achieved = milestones.filter((m) => m.achieved);
  const inProgress = milestones.filter((m) => !m.achieved);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-6"
    >
      {/* In Progress */}
      <div>
        <h3 className="mb-4 text-lg font-medium text-text-primary">In Progress</h3>
        <div className="grid grid-cols-2 gap-4">
          {inProgress.map((milestone) => (
            <div
              key={milestone.id}
              className="rounded-xl bg-background-secondary p-6"
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-text-primary">{milestone.name}</h4>
                  <p className="text-sm text-text-tertiary">{milestone.description}</p>
                </div>
                <div className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
                  In Progress
                </div>
              </div>

              <div className="mb-2">
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">Progress</span>
                  <span className="text-text-secondary">{milestone.progress.toFixed(0)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-background-primary">
                  <motion.div
                    className="h-full rounded-full bg-brand-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${milestone.progress}%` }}
                  />
                </div>
              </div>

              {milestone.reward && (
                <div className="mt-4 rounded-lg bg-background-tertiary p-3">
                  <div className="text-xs text-text-tertiary">Reward</div>
                  <div className="text-sm font-medium text-brand-primary">
                    {milestone.reward.description}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Achieved */}
      <div>
        <h3 className="mb-4 text-lg font-medium text-text-primary">Achieved</h3>
        <div className="grid grid-cols-3 gap-4">
          {achieved.map((milestone) => (
            <div
              key={milestone.id}
              className="rounded-xl bg-background-secondary p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-2xl">🏆</span>
                <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                  Achieved
                </span>
              </div>
              <h4 className="font-medium text-text-primary">{milestone.name}</h4>
              <p className="text-xs text-text-tertiary">{milestone.description}</p>
              {milestone.achievedAt && (
                <div className="mt-2 text-xs text-text-tertiary">
                  {new Date(milestone.achievedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function PoliciesTab() {
  const policies: TrustPolicy[] = [
    {
      id: 'p-1',
      name: 'File Write Policy',
      description: 'Controls when files can be written autonomously',
      category: TrustCategory.FILE_OPERATIONS,
      actionTypes: [],
      minimumTrustLevel: TrustLevel.MODERATE,
      minimumTrustScore: 500,
      requiresApproval: false,
      baseTrustCost: 2,
      riskMultiplier: 1.5,
      maxPerHour: 50,
      maxPerDay: 200,
      isActive: true,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24,
    },
    {
      id: 'p-2',
      name: 'Code Execution Policy',
      description: 'Governs autonomous code execution',
      category: TrustCategory.CODE_EXECUTION,
      actionTypes: [],
      minimumTrustLevel: TrustLevel.HIGH,
      minimumTrustScore: 700,
      requiresApproval: true,
      baseTrustCost: 5,
      riskMultiplier: 2.0,
      maxPerHour: 20,
      maxPerDay: 50,
      isActive: true,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 7,
    },
    {
      id: 'p-3',
      name: 'Network Access Policy',
      description: 'Controls external network requests',
      category: TrustCategory.NETWORK_ACCESS,
      actionTypes: [],
      minimumTrustLevel: TrustLevel.MODERATE,
      minimumTrustScore: 450,
      requiresApproval: false,
      baseTrustCost: 3,
      riskMultiplier: 1.8,
      maxPerHour: 100,
      maxPerDay: 500,
      isActive: true,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      updatedAt: Date.now(),
    },
    {
      id: 'p-4',
      name: 'Deployment Policy',
      description: 'Restricts production deployments',
      category: TrustCategory.DEPLOYMENTS,
      actionTypes: [],
      minimumTrustLevel: TrustLevel.FULL,
      minimumTrustScore: 900,
      requiresApproval: true,
      baseTrustCost: 25,
      riskMultiplier: 3.0,
      maxPerHour: 2,
      maxPerDay: 5,
      isActive: true,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 14,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <p className="text-sm text-text-secondary">
        Policies define the rules for autonomous actions. These determine trust costs, limits, and approval requirements.
      </p>

      <div className="space-y-4">
        {policies.map((policy) => {
          const categoryConfig = CATEGORY_CONFIG[policy.category];
          const levelConfig = TRUST_LEVEL_CONFIG[policy.minimumTrustLevel];

          return (
            <div key={policy.id} className="rounded-xl bg-background-secondary p-6">
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{categoryConfig.icon}</span>
                  <div>
                    <h4 className="font-medium text-text-primary">{policy.name}</h4>
                    <p className="text-sm text-text-tertiary">{policy.description}</p>
                  </div>
                </div>
                <div className={`rounded-full px-2 py-0.5 text-xs font-medium
                  ${policy.isActive ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}
                >
                  {policy.isActive ? 'Active' : 'Inactive'}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-4">
                <div className="rounded-lg bg-background-tertiary p-3">
                  <div className="text-xs text-text-tertiary">Min Trust Level</div>
                  <div className={`text-sm font-medium ${levelConfig.color}`}>
                    {levelConfig.icon} {levelConfig.label}
                  </div>
                </div>
                <div className="rounded-lg bg-background-tertiary p-3">
                  <div className="text-xs text-text-tertiary">Min Score</div>
                  <div className="text-sm font-medium text-text-primary">{policy.minimumTrustScore}</div>
                </div>
                <div className="rounded-lg bg-background-tertiary p-3">
                  <div className="text-xs text-text-tertiary">Trust Cost</div>
                  <div className="text-sm font-medium text-text-primary">{policy.baseTrustCost}</div>
                </div>
                <div className="rounded-lg bg-background-tertiary p-3">
                  <div className="text-xs text-text-tertiary">Hourly Limit</div>
                  <div className="text-sm font-medium text-text-primary">{policy.maxPerHour || '∞'}</div>
                </div>
                <div className="rounded-lg bg-background-tertiary p-3">
                  <div className="text-xs text-text-tertiary">Approval</div>
                  <div className={`text-sm font-medium ${policy.requiresApproval ? 'text-yellow-400' : 'text-green-400'}`}>
                    {policy.requiresApproval ? 'Required' : 'Auto'}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ============================================================================
// VISUALIZATION COMPONENTS
// ============================================================================

function TrustSparkline({ data }: { data: TrustHistoryPoint[] }) {
  const width = 240;
  const height = 60;
  const padding = 4;

  const minScore = Math.min(...data.map((d) => d.score));
  const maxScore = Math.max(...data.map((d) => d.score));
  const range = maxScore - minScore || 1;

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.score - minScore) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const lastPoint = data[data.length - 1];
  const trend = lastPoint.score > data[0].score ? 'up' : lastPoint.score < data[0].score ? 'down' : 'stable';

  return (
    <div className="rounded-lg bg-background-tertiary p-3">
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          <linearGradient id="sparkline-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#6b7280'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#6b7280'} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <polygon
          points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
          fill="url(#sparkline-gradient)"
        />

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#6b7280'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* End dot */}
        <circle
          cx={width - padding}
          cy={height - padding - ((lastPoint.score - minScore) / range) * (height - padding * 2)}
          r="4"
          fill={trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#6b7280'}
        />
      </svg>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="text-text-tertiary">{data[0].score}</span>
        <span className={`font-medium ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-text-secondary'}`}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {lastPoint.score}
        </span>
      </div>
    </div>
  );
}

function TrustChart({ data }: { data: TrustHistoryPoint[] }) {
  const width = 800;
  const height = 200;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const minScore = Math.min(...data.map((d) => d.score)) - 20;
  const maxScore = Math.max(...data.map((d) => d.score)) + 20;
  const range = maxScore - minScore;

  const getX = (i: number) => padding.left + (i / (data.length - 1)) * chartWidth;
  const getY = (score: number) => padding.top + chartHeight - ((score - minScore) / range) * chartHeight;

  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.score)}`).join(' ');

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
        const y = padding.top + chartHeight * (1 - pct);
        const value = Math.round(minScore + range * pct);
        return (
          <g key={pct}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="var(--border-primary)"
              strokeDasharray="4 4"
            />
            <text
              x={padding.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-text-tertiary text-xs"
            >
              {value}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <defs>
        <linearGradient id="chart-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path
        d={`${linePath} L ${getX(data.length - 1)} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`}
        fill="url(#chart-gradient)"
      />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke="var(--brand-primary)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Data points */}
      {data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map((d, i) => (
        <circle
          key={i}
          cx={getX(data.indexOf(d))}
          cy={getY(d.score)}
          r="4"
          fill="var(--bg-primary)"
          stroke="var(--brand-primary)"
          strokeWidth="2"
        />
      ))}

      {/* X-axis labels */}
      {data.filter((_, i) => i % 7 === 0).map((d, i) => (
        <text
          key={i}
          x={getX(data.indexOf(d))}
          y={height - 8}
          textAnchor="middle"
          className="fill-text-tertiary text-xs"
        >
          {new Date(d.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </text>
      ))}
    </svg>
  );
}

function TrustLevelLadder({ currentScore, currentLevel }: { currentScore: number; currentLevel: TrustLevel }) {
  const levels = [
    { level: TrustLevel.FULL, threshold: 950 },
    { level: TrustLevel.HIGH, threshold: 750 },
    { level: TrustLevel.MODERATE, threshold: 500 },
    { level: TrustLevel.LOW, threshold: 250 },
    { level: TrustLevel.MINIMAL, threshold: 100 },
    { level: TrustLevel.NONE, threshold: 0 },
  ];

  return (
    <div className="flex items-center gap-2">
      {levels.reverse().map((l, index) => {
        const config = TRUST_LEVEL_CONFIG[l.level];
        const isActive = currentLevel === l.level;
        const isPassed = currentScore >= l.threshold;

        return (
          <div key={l.level} className="flex items-center gap-2">
            <div
              className={`relative rounded-lg p-4 transition-all
                ${isActive
                  ? `${config.bgColor} ring-2 ring-brand-primary`
                  : isPassed
                    ? config.bgColor
                    : 'bg-background-tertiary opacity-50'
                }`}
            >
              <div className="text-center">
                <span className="text-2xl">{config.icon}</span>
                <div className={`text-xs font-medium ${isPassed ? config.color : 'text-text-tertiary'}`}>
                  {config.label}
                </div>
                <div className="text-xs text-text-tertiary">{l.threshold}+</div>
              </div>

              {isActive && (
                <motion.div
                  className="absolute -bottom-2 left-1/2 -translate-x-1/2"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                >
                  <div className="h-0 w-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-brand-primary" />
                </motion.div>
              )}
            </div>

            {index < levels.length - 1 && (
              <div className={`h-1 w-8 rounded ${isPassed ? 'bg-brand-primary' : 'bg-background-tertiary'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getNextLevel(current: TrustLevel): TrustLevel | null {
  const order = [
    TrustLevel.NONE,
    TrustLevel.MINIMAL,
    TrustLevel.LOW,
    TrustLevel.MODERATE,
    TrustLevel.HIGH,
    TrustLevel.FULL,
  ];
  const currentIndex = order.indexOf(current);
  return currentIndex < order.length - 1 ? order[currentIndex + 1] : null;
}

function getProgressToNextLevel(score: number, current: TrustLevel, next: TrustLevel): number {
  const thresholds: Record<TrustLevel, number> = {
    [TrustLevel.NONE]: 0,
    [TrustLevel.MINIMAL]: 100,
    [TrustLevel.LOW]: 250,
    [TrustLevel.MODERATE]: 500,
    [TrustLevel.HIGH]: 750,
    [TrustLevel.FULL]: 950,
  };

  const currentThreshold = thresholds[current];
  const nextThreshold = thresholds[next];
  const range = nextThreshold - currentThreshold;

  return Math.min(100, ((score - currentThreshold) / range) * 100);
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export default TrustCenterDashboard;
