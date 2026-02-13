/**
 * dbInit.ts — Startup orchestrator for SQLite backend
 *
 * Called once from App.tsx on mount. Loads all stores from DB in parallel.
 * If backend is unavailable, logs warning and continues with localStorage data.
 */

import { isBackendAvailable } from './dbService';
import * as db from './dbService';
import { useChatStore } from '../store/chatStore';
import { useSettingsStore } from '../store/settingsStore';
import { useAuditStore } from '../store/auditStore';
import { useMemoryStore } from '../store/memoryStore';
import { useImageStore } from '../store/imageStore';
import { useArtifactStore } from '../store/artifactStore';
import { useTBWOStore } from '../store/tbwoStore';

// ============================================================================
// STORE LOADERS
// ============================================================================

async function loadChatFromDb(): Promise<void> {

  const conversations = await db.listConversations(0, 500);
  if (conversations.length === 0) return; // nothing in DB, keep localStorage data

  // Fetch messages for each conversation
  const convMap = new Map<string, any>();
  const msgFetches = conversations.map(async (conv) => {
    try {
      const result = await db.getConversation(conv.id);
      const fullConv = {
        id: conv.id,
        title: conv.title,
        mode: conv.mode,
        model: result.conversation.model ? { modelId: result.conversation.model, provider: conv.provider } : useChatStore.getState().defaultModel,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        isFavorite: conv.isFavorite,
        isArchived: conv.isArchived,
        isPinned: conv.isPinned || false,
        tags: [],
        temperature: 0.7,
        maxTokens: 4096,
        messages: result.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          conversationId: conv.id,
          model: m.model,
          tokens: { input: m.tokens_input || 0, output: m.tokens_output || 0, total: (m.tokens_input || 0) + (m.tokens_output || 0) },
          cost: m.cost,
          isEdited: m.isEdited,
          parentId: m.parent_id,
          metadata: m.metadata,
        })),
      };
      convMap.set(conv.id, fullConv);
    } catch (e) {
      console.warn(`[dbInit] Failed to load conversation ${conv.id}:`, e);
    }
  });

  await Promise.allSettled(msgFetches);

  if (convMap.size > 0) {
    useChatStore.setState((state: any) => {
      state.conversations = convMap;
    });
    console.log(`[dbInit] Loaded ${convMap.size} conversations from DB`);
  }
}

async function loadSettingsFromDb(): Promise<void> {

  const settings = await db.getAllSettings();
  if (!settings || Object.keys(settings).length === 0) return;

  // Merge DB settings into store (don't overwrite API keys)
  const store = useSettingsStore.getState();
  const settingKeys = [
    'modelMode', 'selectedModelVersions', 'enableThinking', 'thinkingBudget',
    'reasoningEffort', 'enableComputerUse', 'enableTextEditor',
    'model', 'ui', 'chat', 'voice', 'tbwo', 'memory',
    'privacy', 'performance', 'experimental',
  ];

  for (const key of settingKeys) {
    if (settings[key] !== undefined) {
      (store as any)[key] = settings[key];
    }
  }
  console.log(`[dbInit] Loaded settings from DB`);
}

async function loadAuditFromDb(): Promise<void> {

  const entries = await db.listAuditEntries();
  if (!entries || entries.length === 0) return;

  // Convert DB format → AuditEntry format
  const auditEntries = entries.map((e: any) => ({
    id: e.id,
    timestamp: e.timestamp,
    conversationId: e.conversation_id || '',
    messageId: e.message_id || '',
    provider: 'anthropic' as const,
    model: e.model,
    tokens: {
      prompt: e.tokens_prompt,
      completion: e.tokens_completion,
      total: e.tokens_total,
    },
    cost: e.cost,
    toolsUsed: Array.isArray(e.tools_used) ? e.tools_used : [],
    durationMs: e.duration_ms,
  }));

  useAuditStore.setState({ entries: auditEntries });
  console.log(`[dbInit] Loaded ${auditEntries.length} audit entries from DB`);
}

async function loadMemoriesFromDb(): Promise<void> {

  const memories = await db.listMemories();
  if (!memories || memories.length === 0) return;

  const memMap = new Map<string, any>();
  for (const m of memories) {
    memMap.set(m.id, {
      id: m.id,
      layer: m.layer,
      content: m.content,
      salience: m.salience,
      decayRate: m.decay_rate,
      accessCount: m.access_count,
      isConsolidated: m.is_consolidated,
      isArchived: m.is_archived,
      isPinned: m.is_pinned,
      userModified: m.user_modified,
      tags: m.tags,
      relatedMemories: m.related_memories,
      editHistory: m.edit_history,
      metadata: m.metadata,
      lastAccessedAt: m.last_accessed_at,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    });
  }

  if (memMap.size > 0) {
    useMemoryStore.setState((state: any) => {
      state.memories = memMap;
    });
    // Trigger index rebuild by calling refreshStats
    useMemoryStore.getState().refreshStats?.();
    console.log(`[dbInit] Loaded ${memMap.size} memories from DB`);
  }
}

async function loadImagesFromDb(): Promise<void> {

  const images = await db.listImages(100);
  if (!images || images.length === 0) return;

  const imageEntries = images.map((img: any) => ({
    id: img.id,
    url: img.url,
    prompt: img.prompt,
    revisedPrompt: img.revised_prompt,
    model: img.model,
    size: img.size,
    quality: img.quality,
    style: img.style,
    timestamp: img.created_at,
    conversationId: img.conversation_id,
    messageId: img.message_id,
  }));

  useImageStore.setState({ images: imageEntries });
  console.log(`[dbInit] Loaded ${imageEntries.length} images from DB`);
}

async function loadArtifactsFromDb(): Promise<void> {

  const artifacts = await db.listArtifacts({ limit: 20 });
  if (!artifacts || artifacts.length === 0) return;

  const artifactEntries = artifacts.map((a: any) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    language: a.language,
    content: a.content,
    timestamp: a.updated_at || a.created_at,
    editable: a.editable,
  }));

  useArtifactStore.setState({ artifacts: artifactEntries });
  console.log(`[dbInit] Loaded ${artifactEntries.length} artifacts from DB`);
}

async function loadTBWOsFromDb(): Promise<void> {

  const tbwos = await db.listTBWOs(100);
  if (!tbwos || tbwos.length === 0) return;

  // Each TBWO is stored as JSON with the same serialization format as localStorage
  // The server stores nested Maps/Sets as arrays, same as localStorage setItem
  // Reuse the same reconstitution logic
  const tbwoMap = new Map<string, any>();
  for (const tbwo of tbwos) {
    try {
      tbwoMap.set(tbwo.id, {
        ...tbwo,
        pods: new Map(Array.isArray(tbwo.pods) ? tbwo.pods as any : []),
        activePods: new Set(Array.isArray(tbwo.activePods) ? tbwo.activePods as any : []),
        timeBudget: tbwo.timeBudget ? {
          ...(tbwo.timeBudget as any),
          phases: new Map(Array.isArray((tbwo.timeBudget as any).phases) ? (tbwo.timeBudget as any).phases : []),
        } : { total: 60, elapsed: 0, remaining: 60, phases: new Map(), warningThreshold: 80, criticalThreshold: 95 },
        plan: tbwo.plan ? {
          ...(tbwo.plan as any),
          podStrategy: (tbwo.plan as any).podStrategy ? {
            ...(tbwo.plan as any).podStrategy,
            dependencies: new Map(Array.isArray((tbwo.plan as any).podStrategy?.dependencies) ? (tbwo.plan as any).podStrategy.dependencies : []),
          } : (tbwo.plan as any).podStrategy,
        } : tbwo.plan,
        receipts: tbwo.receipts ? {
          ...(tbwo.receipts as any),
          podReceipts: new Map(Array.isArray((tbwo.receipts as any).podReceipts) ? (tbwo.receipts as any).podReceipts : []),
        } : tbwo.receipts,
      });
    } catch (e) {
      console.warn(`[dbInit] Failed to reconstitute TBWO ${tbwo.id}:`, e);
    }
  }

  if (tbwoMap.size > 0) {
    useTBWOStore.setState((state: any) => {
      state.tbwos = tbwoMap;
    });
    console.log(`[dbInit] Loaded ${tbwoMap.size} TBWOs from DB`);
  }
}

// ============================================================================
// MIGRATION: localStorage → SQLite
// ============================================================================

async function migrateLocalStorageToDb(): Promise<void> {
  if (localStorage.getItem('alin-db-migrated') === 'true') return;

  console.log('[dbInit] Checking for localStorage → SQLite migration...');

  // Check if DB already has data
  const convs = await db.listConversations(0, 1);
  if (convs.length > 0) {
    // DB already has data, mark as migrated
    localStorage.setItem('alin-db-migrated', 'true');
    return;
  }

  // Migrate chat data
  const chatData = localStorage.getItem('alin-chat-storage');
  if (chatData) {
    try {
      const { state } = JSON.parse(chatData);
      const conversations = state.conversations instanceof Map
        ? Array.from(state.conversations.entries())
        : (Array.isArray(state.conversations) ? state.conversations : []);

      for (const [id, conv] of conversations) {
        try {
          await db.createConversation({
            id,
            title: conv.title || 'New Chat',
            mode: conv.mode || 'regular',
            model: conv.model?.modelId || 'claude-sonnet-4-20250514',
            provider: conv.model?.provider || 'anthropic',
          });

          // Migrate messages
          if (conv.messages && Array.isArray(conv.messages)) {
            for (const msg of conv.messages) {
              await db.createMessage(id, {
                id: msg.id,
                role: msg.role,
                content: msg.content,
                model: msg.model || null,
                tokensInput: msg.tokens?.input || 0,
                tokensOutput: msg.tokens?.output || 0,
                cost: msg.cost || 0,
                parentId: msg.parentId || null,
                metadata: msg.metadata || {},
              });
            }
          }
        } catch (e) {
          console.warn(`[dbInit] Failed to migrate conversation ${id}:`, e);
        }
      }
      console.log(`[dbInit] Migrated ${conversations.length} conversations`);
    } catch (e) {
      console.warn('[dbInit] Failed to migrate chat data:', e);
    }
  }

  // Migrate audit entries
  const auditData = localStorage.getItem('alin-audit-storage');
  if (auditData) {
    try {
      const { state } = JSON.parse(auditData);
      if (state.entries && Array.isArray(state.entries)) {
        for (const entry of state.entries) {
          await db.createAuditEntry({
            id: entry.id,
            conversationId: entry.conversationId,
            messageId: entry.messageId,
            model: entry.model,
            tokensPrompt: entry.tokens?.prompt || 0,
            tokensCompletion: entry.tokens?.completion || 0,
            tokensTotal: entry.tokens?.total || 0,
            cost: entry.cost || 0,
            toolsUsed: entry.toolsUsed || [],
            durationMs: entry.durationMs || 0,
            timestamp: entry.timestamp,
          });
        }
        console.log(`[dbInit] Migrated ${state.entries.length} audit entries`);
      }
    } catch (e) {
      console.warn('[dbInit] Failed to migrate audit data:', e);
    }
  }

  // Migrate memory entries
  const memoryData = localStorage.getItem('alin-memory-storage');
  if (memoryData) {
    try {
      const { state } = JSON.parse(memoryData);
      const memories = Array.isArray(state.memories)
        ? state.memories
        : (state.memories instanceof Map ? Array.from(state.memories.entries()) : []);

      for (const [id, mem] of memories) {
        await db.createMemory({
          id,
          layer: mem.layer,
          content: typeof mem.content === 'string' ? mem.content : JSON.stringify(mem.content),
          salience: mem.salience || 0.5,
          decayRate: mem.decayRate || 0.1,
          accessCount: mem.accessCount || 0,
          isConsolidated: mem.isConsolidated || false,
          isArchived: mem.isArchived || false,
          isPinned: mem.isPinned || false,
          userModified: mem.userModified || false,
          tags: mem.tags || [],
          relatedMemories: mem.relatedMemories || [],
          editHistory: mem.editHistory || [],
          metadata: mem.metadata || {},
          lastAccessedAt: mem.lastAccessedAt,
          createdAt: mem.createdAt || Date.now(),
          updatedAt: mem.updatedAt || Date.now(),
        });
      }
      console.log(`[dbInit] Migrated ${memories.length} memories`);
    } catch (e) {
      console.warn('[dbInit] Failed to migrate memory data:', e);
    }
  }

  // Migrate image metadata
  const imageData = localStorage.getItem('alin-image-storage');
  if (imageData) {
    try {
      const { state } = JSON.parse(imageData);
      if (state.images && Array.isArray(state.images)) {
        for (const img of state.images) {
          await db.createImage({
            id: img.id,
            url: img.url,
            prompt: img.prompt,
            revisedPrompt: img.revisedPrompt,
            model: img.model || 'dall-e-3',
            size: img.size || '1024x1024',
            quality: img.quality || 'standard',
            style: img.style || 'vivid',
            conversationId: img.conversationId,
            messageId: img.messageId,
            createdAt: img.timestamp || Date.now(),
          });
        }
        console.log(`[dbInit] Migrated ${state.images.length} images`);
      }
    } catch (e) {
      console.warn('[dbInit] Failed to migrate image data:', e);
    }
  }

  // Migrate settings
  const settingsData = localStorage.getItem('alin-settings-storage');
  if (settingsData) {
    try {
      const { state } = JSON.parse(settingsData);
      const keysToSync = [
        'modelMode', 'selectedModelVersions', 'enableThinking', 'thinkingBudget',
        'reasoningEffort', 'enableComputerUse', 'enableTextEditor',
        'model', 'ui', 'chat', 'voice', 'tbwo', 'memory',
        'privacy', 'performance', 'experimental',
      ];
      for (const key of keysToSync) {
        if (state[key] !== undefined) {
          await db.setSetting(key, state[key]);
        }
      }
      console.log('[dbInit] Migrated settings');
    } catch (e) {
      console.warn('[dbInit] Failed to migrate settings:', e);
    }
  }

  localStorage.setItem('alin-db-migrated', 'true');
  console.log('[dbInit] Migration complete');
}

// ============================================================================
// MAIN INIT
// ============================================================================

export async function initializeDatabase(): Promise<void> {
  const available = await isBackendAvailable();
  if (!available) {
    console.warn('[dbInit] Backend not available, using localStorage only');
    return;
  }

  console.log('[dbInit] Backend available, initializing SQLite persistence...');

  // Run migration first (if needed)
  try {
    await migrateLocalStorageToDb();
  } catch (e) {
    console.warn('[dbInit] Migration failed (non-fatal):', e);
  }

  // Load all stores from DB in parallel
  const results = await Promise.allSettled([
    loadChatFromDb(),
    loadSettingsFromDb(),
    loadAuditFromDb(),
    loadMemoriesFromDb(),
    loadImagesFromDb(),
    loadArtifactsFromDb(),
    loadTBWOsFromDb(),
  ]);

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.warn(`[dbInit] ${failures.length} store(s) failed to load from DB:`,
      failures.map((f: any) => f.reason?.message || f.reason));
  }

  // Auto-resume interrupted TBWOs (status stuck as 'executing' after refresh)
  try {
    const tbwoStore = useTBWOStore.getState();
    const allTBWOs = Array.from(tbwoStore.tbwos.values());
    const interrupted = allTBWOs.filter(t => t.status === 'executing');

    if (interrupted.length > 0) {
      for (const tbwo of interrupted) {
        // Clear stale activePods (those pod instances are gone after refresh)
        useTBWOStore.setState((state: any) => {
          const t = state.tbwos.get(tbwo.id);
          if (t) {
            t.activePods = new Set();
          }
        });
      }

      // Auto-resume after a delay to let the app finish initializing
      setTimeout(() => {
        for (const tbwo of interrupted) {
          console.log(`[dbInit] Auto-resuming interrupted TBWO: ${tbwo.objective}`);
          useTBWOStore.getState().resumeExecution(tbwo.id);
        }
      }, 3000);
    }
  } catch (e) {
    console.warn('[dbInit] TBWO auto-resume check failed (non-fatal):', e);
  }

  console.log('[dbInit] Database initialization complete');
}
