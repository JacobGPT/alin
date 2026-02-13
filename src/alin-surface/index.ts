/**
 * ALIN Surface Layer — UI facade
 *
 * Exposes UI-concern stores and the product UI registry.
 */

// UI state stores
export { useSettingsStore } from '../store/settingsStore';
export { useAuthStore } from '../store/authStore';
export { useStatusStore } from '../store/statusStore';
export { useModeStore } from '../store/modeStore';
export { useUIStore } from '../store/uiStore';
export { useChatStore } from '../store/chatStore';
export { useAuditStore } from '../store/auditStore';
export { useImageStore } from '../store/imageStore';
export { useArtifactStore } from '../store/artifactStore';
export { useWorkspaceStore } from '../store/workspaceStore';

// Product UI registry (React components)
export { productUIRegistry } from './productUIRegistry';
