/**
 * Settings Store - User Preferences and Configuration
 * 
 * Manages all user settings:
 * - API keys
 * - Model preferences
 * - UI preferences
 * - Keyboard shortcuts
 * - Privacy settings
 * - Performance settings
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist } from 'zustand/middleware';

import { ModelProvider } from '../types/chat';
import type { ModelConfig } from '../types/chat';
import { Theme } from '../types/ui';

// ============================================================================
// SETTINGS TYPES
// ============================================================================

export interface APIKeys {
  openai: string;
  anthropic: string;
  brave?: string;
  localEndpoint?: string;
}

export interface ModelPreferences {
  defaultProvider: ModelProvider;
  defaultModel: ModelConfig;
  fallbackModel?: ModelConfig;
  temperature: number;
  maxTokens: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface UIPreferences {
  theme: Theme;
  fontSize: 'small' | 'medium' | 'large';
  fontFamily: 'system' | 'mono';
  density: 'compact' | 'comfortable' | 'spacious';
  animationsEnabled: boolean;
  soundEnabled: boolean;
  accentColor: string;
}

export interface ChatPreferences {
  autoScroll: boolean;
  showTimestamps: boolean;
  showTokenCount: boolean;
  showThinking: boolean;
  codeTheme: 'github-dark' | 'monokai' | 'dracula' | 'nord';
  syntaxHighlighting: boolean;
  lineNumbers: boolean;
  wordWrap: boolean;
  markdownRendering: boolean;
}

export interface VoicePreferences {
  enabled: boolean;
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'rachel' | 'drew' | 'bella' | 'josh' | 'adam' | 'sam';
  speed: number; // 0.25 - 4.0
  autoPlay: boolean;
  pushToTalk: boolean;
  ttsProvider: 'auto' | 'elevenlabs' | 'openai' | 'browser'; // auto = ElevenLabs → OpenAI → Browser
}

export interface TBWOPreferences {
  defaultQuality: 'draft' | 'standard' | 'premium' | 'apple_level';
  defaultTimeBudget: number; // minutes
  autoApprove: boolean;
  verboseReceipts: boolean;
  showPodVisualization: boolean;
  modelRouting: import('../types/tbwo').ModelRoutingConfig;
}

export interface MemoryPreferences {
  enabled: boolean;
  autoConsolidate: boolean;
  consolidationInterval: number; // minutes
  retentionPeriod: number; // days, 0 = forever
  maxMemories: number;
}

export interface PrivacySettings {
  analytics: boolean;
  crashReporting: boolean;
  usageData: boolean;
  shareImprove: boolean;
  localStorageOnly: boolean;
}

export interface PerformanceSettings {
  hardwareAcceleration: boolean;
  gpuOffloading: boolean;
  maxConcurrentRequests: number;
  cacheSize: number; // MB
  prefetchEnabled: boolean;
}

export interface ExperimentalFeatures {
  enableLocalModels: boolean;
  enableImageGeneration: boolean;
  enableVoice: boolean;
  enableTBWO: boolean;
  enableMemory: boolean;
  enableHardwareMonitoring: boolean;
  enableCodeExecution: boolean;
  enableWebResearch: boolean;
}

// ============================================================================
// STORE STATE TYPE
// ============================================================================

// Model mode type
export type ModelMode = 'claude' | 'gpt' | 'gemini' | 'deepseek' | 'both' | 'auto' | 'hybrid' | 'local';

// Available model versions
export interface ModelVersions {
  claude: string;
  gpt: string;
  gemini: string;
  deepseek: string;
  bothClaude: string;
  bothGPT: string;
  hybridPlanner: string;
  hybridExecutor: string;
}

interface SettingsState {
  // API Configuration
  apiKeys: APIKeys;

  // Model Mode (Claude, GPT, Both, Auto, Hybrid, Local)
  modelMode: ModelMode;

  // Selected model versions for each provider
  selectedModelVersions: ModelVersions;

  // Extended thinking toggle (like Claude.ai / ChatGPT thinking toggle)
  enableThinking: boolean;
  thinkingBudget: number; // Claude thinking budget in tokens (1000-50000)
  reasoningEffort: 'low' | 'medium' | 'high'; // GPT o-series reasoning effort

  // Claude specialized tools
  enableComputerUse: boolean;
  enableTextEditor: boolean;

  // Auto-continuation (when response hits token limit)
  enableAutoContinuation: boolean;
  maxContinuationRounds: number; // 1-5, default 3

  // Preferences
  model: ModelPreferences;
  ui: UIPreferences;
  chat: ChatPreferences;
  voice: VoicePreferences;
  tbwo: TBWOPreferences;
  memory: MemoryPreferences;
  privacy: PrivacySettings;
  performance: PerformanceSettings;
  experimental: ExperimentalFeatures;

  // Metadata
  version: string;
  lastUpdated: number;
}

interface SettingsActions {
  // API Keys
  setAPIKey: (provider: keyof APIKeys, key: string) => void;
  clearAPIKey: (provider: keyof APIKeys) => void;

  // Model Mode
  setModelMode: (mode: ModelMode) => void;

  // Model Version Selection
  setModelVersion: (provider: keyof ModelVersions, version: string) => void;

  // Thinking Toggle
  toggleThinking: () => void;
  setThinking: (enabled: boolean) => void;
  setThinkingBudget: (budget: number) => void;
  setReasoningEffort: (effort: 'low' | 'medium' | 'high') => void;

  // Claude specialized tools
  toggleComputerUse: () => void;
  toggleTextEditor: () => void;

  // Auto-continuation
  setAutoContinuation: (enabled: boolean) => void;
  setMaxContinuationRounds: (rounds: number) => void;

  // Model Preferences
  updateModelPreferences: (updates: Partial<ModelPreferences>) => void;
  setDefaultModel: (model: ModelConfig) => void;
  
  // UI Preferences
  updateUIPreferences: (updates: Partial<UIPreferences>) => void;
  
  // Chat Preferences
  updateChatPreferences: (updates: Partial<ChatPreferences>) => void;
  
  // Voice Preferences
  updateVoicePreferences: (updates: Partial<VoicePreferences>) => void;
  
  // TBWO Preferences
  updateTBWOPreferences: (updates: Partial<TBWOPreferences>) => void;
  
  // Memory Preferences
  updateMemoryPreferences: (updates: Partial<MemoryPreferences>) => void;
  
  // Privacy Settings
  updatePrivacySettings: (updates: Partial<PrivacySettings>) => void;
  
  // Performance Settings
  updatePerformanceSettings: (updates: Partial<PerformanceSettings>) => void;
  
  // Experimental Features
  toggleExperimentalFeature: (feature: keyof ExperimentalFeatures) => void;
  
  // Bulk operations
  resetToDefaults: () => void;
  exportSettings: () => string;
  importSettings: (data: string) => boolean;
}

// ============================================================================
// DEFAULT SETTINGS
// ============================================================================

const DEFAULT_API_KEYS: APIKeys = {
  openai: '',
  anthropic: '',
  brave: '',
};

const DEFAULT_MODEL_PREFERENCES: ModelPreferences = {
  defaultProvider: ModelProvider.ANTHROPIC,
  defaultModel: {
    provider: ModelProvider.ANTHROPIC,
    modelId: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.5',
    maxContextTokens: 200000,
    supportsVision: true,
    supportsTools: true,
    supportsStreaming: true,
  },
  temperature: 0.7,
  maxTokens: 16384,
};

const DEFAULT_UI_PREFERENCES: UIPreferences = {
  theme: Theme.DARK,
  fontSize: 'medium',
  fontFamily: 'system',
  density: 'comfortable',
  animationsEnabled: true,
  soundEnabled: false,
  accentColor: '#6366f1',
};

const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  autoScroll: true,
  showTimestamps: false,
  showTokenCount: true,
  showThinking: true,
  codeTheme: 'github-dark',
  syntaxHighlighting: true,
  lineNumbers: true,
  wordWrap: true,
  markdownRendering: true,
};

const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  enabled: false,
  voice: 'rachel',
  speed: 1.0,
  autoPlay: false,
  pushToTalk: true,
  ttsProvider: 'auto',
};

const DEFAULT_TBWO_PREFERENCES: TBWOPreferences = {
  defaultQuality: 'premium',
  defaultTimeBudget: 60,
  autoApprove: false,
  verboseReceipts: true,
  showPodVisualization: true,
  modelRouting: {
    enabled: true,
    rules: [
      { podRole: 'design' as any, provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Creative design' },
      { podRole: 'frontend' as any, provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Code generation' },
      { podRole: 'copy' as any, provider: 'openai', model: 'gpt-4o', reason: 'Natural language copy' },
      { podRole: 'qa' as any, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', reason: 'Fast validation' },
      { podRole: 'animation' as any, provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Animation code' },
      { podRole: 'three_d' as any, provider: 'anthropic', model: 'claude-sonnet-4-6', reason: '3D scene code' },
      { podRole: 'deployment' as any, provider: 'anthropic', model: 'claude-haiku-4-5-20251001', reason: 'Config generation' },
      { podRole: 'orchestrator' as any, provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'Good reasoning, cost-effective' },
    ],
    fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  },
};

const DEFAULT_MEMORY_PREFERENCES: MemoryPreferences = {
  enabled: true,
  autoConsolidate: true,
  consolidationInterval: 30,
  retentionPeriod: 0,
  maxMemories: 10000,
};

const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  analytics: false,
  crashReporting: true,
  usageData: false,
  shareImprove: false,
  localStorageOnly: true,
};

const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  hardwareAcceleration: true,
  gpuOffloading: true,
  maxConcurrentRequests: 3,
  cacheSize: 100,
  prefetchEnabled: true,
};

const DEFAULT_EXPERIMENTAL_FEATURES: ExperimentalFeatures = {
  enableLocalModels: false,
  enableImageGeneration: true,
  enableVoice: true,
  enableTBWO: true,
  enableMemory: true,
  enableHardwareMonitoring: true,
  enableCodeExecution: true,
  enableWebResearch: true,
};

// ============================================================================
// ZUSTAND STORE
// ============================================================================

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    immer((set, get) => ({
      // ========================================================================
      // INITIAL STATE
      // ========================================================================
      
      apiKeys: DEFAULT_API_KEYS,
      modelMode: 'claude' as ModelMode,
      selectedModelVersions: {
        claude: 'claude-sonnet-4-6',
        gpt: 'gpt-5',
        gemini: 'gemini-2.5-flash',
        deepseek: 'deepseek-chat',
        bothClaude: 'claude-sonnet-4-6',
        bothGPT: 'gpt-5',
        hybridPlanner: 'claude-sonnet-4-6',
        hybridExecutor: 'gpt-5',
      },
      enableThinking: true,
      thinkingBudget: 10000,
      reasoningEffort: 'medium' as const,
      enableComputerUse: false,
      enableTextEditor: false,
      enableAutoContinuation: true,
      maxContinuationRounds: 3,
      model: DEFAULT_MODEL_PREFERENCES,
      ui: DEFAULT_UI_PREFERENCES,
      chat: DEFAULT_CHAT_PREFERENCES,
      voice: DEFAULT_VOICE_PREFERENCES,
      tbwo: DEFAULT_TBWO_PREFERENCES,
      memory: DEFAULT_MEMORY_PREFERENCES,
      privacy: DEFAULT_PRIVACY_SETTINGS,
      performance: DEFAULT_PERFORMANCE_SETTINGS,
      experimental: DEFAULT_EXPERIMENTAL_FEATURES,
      version: '1.0.0',
      lastUpdated: Date.now(),
      
      // ========================================================================
      // API KEYS
      // ========================================================================
      
      setAPIKey: (provider, key) => {
        set((state) => {
          state.apiKeys[provider] = key;
          state.lastUpdated = Date.now();
        });
      },
      
      clearAPIKey: (provider) => {
        set((state) => {
          state.apiKeys[provider] = '';
          state.lastUpdated = Date.now();
        });
      },

      // ========================================================================
      // MODEL MODE
      // ========================================================================

      setModelMode: (mode) => {
        set((state) => {
          state.modelMode = mode;
          state.lastUpdated = Date.now();
        });
      },

      setModelVersion: (provider, version) => {
        set((state) => {
          state.selectedModelVersions[provider] = version;
          state.lastUpdated = Date.now();
        });
      },

      // ========================================================================
      // THINKING TOGGLE
      // ========================================================================

      toggleThinking: () => {
        set((state) => {
          state.enableThinking = !state.enableThinking;
          state.lastUpdated = Date.now();
        });
      },

      setThinking: (enabled) => {
        set((state) => {
          state.enableThinking = enabled;
          state.lastUpdated = Date.now();
        });
      },

      setThinkingBudget: (budget) => {
        set((state) => {
          state.thinkingBudget = Math.max(1000, Math.min(50000, budget));
          state.lastUpdated = Date.now();
        });
      },

      setReasoningEffort: (effort) => {
        set((state) => {
          state.reasoningEffort = effort;
          state.lastUpdated = Date.now();
        });
      },

      toggleComputerUse: () => {
        set((state) => {
          state.enableComputerUse = !state.enableComputerUse;
          state.lastUpdated = Date.now();
        });
      },

      toggleTextEditor: () => {
        set((state) => {
          state.enableTextEditor = !state.enableTextEditor;
          state.lastUpdated = Date.now();
        });
      },

      setAutoContinuation: (enabled) => {
        set((state) => {
          state.enableAutoContinuation = enabled;
          state.lastUpdated = Date.now();
        });
      },

      setMaxContinuationRounds: (rounds) => {
        set((state) => {
          state.maxContinuationRounds = Math.max(1, Math.min(5, rounds));
          state.lastUpdated = Date.now();
        });
      },

      // ========================================================================
      // MODEL PREFERENCES
      // ========================================================================
      
      updateModelPreferences: (updates) => {
        set((state) => {
          state.model = { ...state.model, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      setDefaultModel: (model) => {
        set((state) => {
          state.model.defaultModel = model;
          state.model.defaultProvider = model.provider;
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // UI PREFERENCES
      // ========================================================================
      
      updateUIPreferences: (updates) => {
        set((state) => {
          state.ui = { ...state.ui, ...updates };
          state.lastUpdated = Date.now();
        });
        
        // Apply theme change immediately
        if (updates.theme) {
          const root = document.documentElement;
          root.setAttribute('data-theme', updates.theme);
        }
      },
      
      // ========================================================================
      // CHAT PREFERENCES
      // ========================================================================
      
      updateChatPreferences: (updates) => {
        set((state) => {
          state.chat = { ...state.chat, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // VOICE PREFERENCES
      // ========================================================================
      
      updateVoicePreferences: (updates) => {
        set((state) => {
          state.voice = { ...state.voice, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // TBWO PREFERENCES
      // ========================================================================
      
      updateTBWOPreferences: (updates) => {
        set((state) => {
          state.tbwo = { ...state.tbwo, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // MEMORY PREFERENCES
      // ========================================================================
      
      updateMemoryPreferences: (updates) => {
        set((state) => {
          state.memory = { ...state.memory, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // PRIVACY SETTINGS
      // ========================================================================
      
      updatePrivacySettings: (updates) => {
        set((state) => {
          state.privacy = { ...state.privacy, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // PERFORMANCE SETTINGS
      // ========================================================================
      
      updatePerformanceSettings: (updates) => {
        set((state) => {
          state.performance = { ...state.performance, ...updates };
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // EXPERIMENTAL FEATURES
      // ========================================================================
      
      toggleExperimentalFeature: (feature) => {
        set((state) => {
          state.experimental[feature] = !state.experimental[feature];
          state.lastUpdated = Date.now();
        });
      },
      
      // ========================================================================
      // BULK OPERATIONS
      // ========================================================================
      
      resetToDefaults: () => {
        if (
          confirm(
            'This will reset all settings to defaults. This action cannot be undone. Continue?'
          )
        ) {
          set({
            apiKeys: DEFAULT_API_KEYS,
            model: DEFAULT_MODEL_PREFERENCES,
            ui: DEFAULT_UI_PREFERENCES,
            chat: DEFAULT_CHAT_PREFERENCES,
            voice: DEFAULT_VOICE_PREFERENCES,
            tbwo: DEFAULT_TBWO_PREFERENCES,
            memory: DEFAULT_MEMORY_PREFERENCES,
            privacy: DEFAULT_PRIVACY_SETTINGS,
            performance: DEFAULT_PERFORMANCE_SETTINGS,
            experimental: DEFAULT_EXPERIMENTAL_FEATURES,
            lastUpdated: Date.now(),
          });
        }
      },
      
      exportSettings: () => {
        const state = get();
        
        // Don't export API keys for security
        const exportData = {
          version: state.version,
          model: state.model,
          ui: state.ui,
          chat: state.chat,
          voice: state.voice,
          tbwo: state.tbwo,
          memory: state.memory,
          privacy: state.privacy,
          performance: state.performance,
          experimental: state.experimental,
          exportedAt: Date.now(),
        };
        
        return JSON.stringify(exportData, null, 2);
      },
      
      importSettings: (data) => {
        try {
          const imported = JSON.parse(data);
          
          // Validate version (basic check)
          if (!imported.version) {
            throw new Error('Invalid settings file');
          }
          
          // Import settings
          set({
            model: imported.model || DEFAULT_MODEL_PREFERENCES,
            ui: imported.ui || DEFAULT_UI_PREFERENCES,
            chat: imported.chat || DEFAULT_CHAT_PREFERENCES,
            voice: imported.voice || DEFAULT_VOICE_PREFERENCES,
            tbwo: imported.tbwo || DEFAULT_TBWO_PREFERENCES,
            memory: imported.memory || DEFAULT_MEMORY_PREFERENCES,
            privacy: imported.privacy || DEFAULT_PRIVACY_SETTINGS,
            performance: imported.performance || DEFAULT_PERFORMANCE_SETTINGS,
            experimental: imported.experimental || DEFAULT_EXPERIMENTAL_FEATURES,
            lastUpdated: Date.now(),
          });
          
          return true;
        } catch (error) {
          console.error('Failed to import settings:', error);
          return false;
        }
      },
    })),
    {
      name: 'alin-settings-storage',
      // Don't persist API keys for security
      partialize: (state) => {
        const { apiKeys, ...rest } = state;
        return rest;
      },
      merge: (persisted: any, current: any) => {
        const merged = { ...current, ...persisted };
        // Deep-merge selectedModelVersions so new fields get defaults
        if (persisted?.selectedModelVersions) {
          merged.selectedModelVersions = {
            ...current.selectedModelVersions,
            ...persisted.selectedModelVersions,
          };
        }
        return merged;
      },
    }
  )
);

// ============================================================================
// DB SYNC VIA SUBSCRIBE (debounced, non-API-key settings only)
// ============================================================================

import * as dbService from '../api/dbService';

const _settingsDbSyncKeys = [
  'modelMode', 'selectedModelVersions', 'enableThinking', 'thinkingBudget',
  'reasoningEffort', 'enableComputerUse', 'enableTextEditor',
  'enableAutoContinuation', 'maxContinuationRounds',
  'model', 'ui', 'chat', 'voice', 'tbwo', 'memory',
  'privacy', 'performance', 'experimental',
] as const;

let _settingsDbTimer: ReturnType<typeof setTimeout> | null = null;
useSettingsStore.subscribe((state) => {
  if (_settingsDbTimer) clearTimeout(_settingsDbTimer);
  _settingsDbTimer = setTimeout(() => {
    _settingsDbTimer = null;
    for (const key of _settingsDbSyncKeys) {
      const val = (state as any)[key];
      if (val !== undefined) {
        dbService.setSetting(key, val).catch(() => {});
      }
    }
  }, 500);
});

// ============================================================================
// INITIALIZATION
// ============================================================================

// API keys are now server-side only (.env, not VITE_ prefixed).
// No client-side key loading needed — all AI calls go through /api/chat/stream.
