/**
 * 3D Scene System Types
 *
 * Type definitions for tiered 3D generation: standard (DOM-only),
 * enhanced (3D hero/sections), and immersive (full 3D site).
 */

// ============================================================================
// PRESET IDS
// ============================================================================

export type RenderMode = 'standard' | 'enhanced' | 'immersive';

export type SceneTemplateId =
  | 'productSpin'
  | 'floatingShowcase'
  | 'abstractHero'
  | 'deviceTilt'
  | 'scrollReveal';

export type CameraPresetId =
  | 'orbit-default'
  | 'orbit-close'
  | 'orbit-far'
  | 'fixed-front'
  | 'fixed-angle'
  | 'fixed-top'
  | 'scroll-dolly'
  | 'scroll-pan'
  | 'scroll-orbit';

export type LightingPresetId =
  | 'studio'
  | 'natural'
  | 'dramatic'
  | 'neon'
  | 'minimal'
  | 'warm'
  | 'cool';

export type MaterialPresetId =
  | 'default'
  | 'glass'
  | 'metal'
  | 'plastic'
  | 'holographic'
  | 'wireframe'
  | 'gradient'
  | 'fresnel'
  | 'matcap';

export type AnimationPresetId =
  | 'rotate-y'
  | 'rotate-x'
  | 'rotate-orbit'
  | 'float'
  | 'float-bounce'
  | 'breathe'
  | 'scroll-rotate'
  | 'scroll-zoom'
  | 'scroll-parallax'
  | 'hover-tilt'
  | 'hover-lift'
  | 'click-bounce';

export type EnvironmentEffectId =
  | 'particles-float'
  | 'particles-rain'
  | 'particles-sparkle'
  | 'fog-depth'
  | 'gradient-bg'
  | 'light-rays';

// ============================================================================
// SCENE SPECIFICATION
// ============================================================================

export interface SceneSpec {
  version: '1.0';
  renderMode: RenderMode;
  template: SceneTemplateId;
  asset: SceneAssetRef;
  camera: CameraPresetId;
  lighting: LightingPresetId;
  material: MaterialPresetId;
  animations: AnimationPresetId[];
  environment: EnvironmentEffectId[];
  overrides?: SceneOverrides;
  performance: PerformanceBudget;
}

export interface SceneAssetRef {
  type: 'builtin' | 'uploaded' | 'primitive';
  id: string;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export interface SceneOverrides {
  backgroundColor?: string;
  accentColor?: string;
  ambientIntensity?: number;
  cameraDistance?: number;
  animationSpeed?: number;
  particleCount?: number;
}

export interface PerformanceBudget {
  maxPolycount: number;
  maxTextureResolution: number;
  targetFPS: number;
  enableLOD: boolean;
  mobileMode: 'simplified' | 'disable' | 'full';
}

// ============================================================================
// SECTION / PAGE INTEGRATION
// ============================================================================

export interface Section3DConfig {
  renderMode: RenderMode;
  sceneSpec?: SceneSpec;
}

// ============================================================================
// IMMERSIVE MODE
// ============================================================================

export interface ImmersiveSceneGraph {
  sections: ImmersiveSectionPlane[];
  scrollMapping: 'linear' | 'eased' | 'snapped';
  totalScrollHeight: number;
  domOverlayEnabled: boolean;
}

export interface ImmersiveSectionPlane {
  sectionId: string;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  scrollStart: number;
  scrollEnd: number;
  assets: SceneAssetRef[];
}

// ============================================================================
// ASSET REGISTRY
// ============================================================================

export interface AssetEntry {
  id: string;
  name: string;
  type: 'builtin' | 'uploaded' | 'primitive';
  tier: 'free' | 'spark' | 'pro' | 'agency';
  category: string;
  polycount: number;
  thumbnailUrl?: string;
  cdnUrl?: string;
  primitiveType?: string;
}

// ============================================================================
// VALIDATION
// ============================================================================

export interface SceneValidationResult {
  passed: boolean;
  score: number;
  issues: SceneValidationIssue[];
  summary: string;
  totalPolycount: number;
  estimatedBundleSize: number;
  reducedMotionCompliant: boolean;
  mobileFallbackPresent: boolean;
}

export interface SceneValidationIssue {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
  file?: string;
  fix?: string;
}

// ============================================================================
// TIER GATING
// ============================================================================

export interface Tier3DLimits {
  maxTemplates: number;
  allowUpload: boolean;
  allowImmersive: boolean;
  allowShaders: boolean;
  allowMultiAsset: boolean;
  maxUploadSizeMB: number;
  maxPolycountPerAsset: number;
}

// ============================================================================
// PRESET CONFIGS (used by preset modules)
// ============================================================================

export interface CameraConfig {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  near: number;
  far: number;
  controlsType: 'orbit' | 'fixed' | 'scroll';
  damping: number;
  autoRotate: boolean;
  autoRotateSpeed?: number;
}

export interface LightConfig {
  type: 'ambient' | 'directional' | 'point' | 'spot';
  color: string;
  intensity: number;
  position?: [number, number, number];
  castShadow?: boolean;
  angle?: number;
  penumbra?: number;
}

export interface LightingConfig {
  ambient: { color: string; intensity: number };
  directional: LightConfig[];
  point: LightConfig[];
  spot: LightConfig[];
}

export interface MaterialConfig {
  type: 'MeshStandardMaterial' | 'MeshPhysicalMaterial' | 'MeshBasicMaterial';
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  transparent: boolean;
  envMapIntensity: number;
  wireframe: boolean;
  shaderUniforms?: Record<string, { value: number | string }>;
}

export interface AnimationConfig {
  type: 'continuous' | 'scroll' | 'interaction';
  property: string;
  axis?: 'x' | 'y' | 'z';
  speed: number;
  range: [number, number];
  easing: string;
  scrollMap?: { start: number; end: number };
  interactionEvent?: 'hover' | 'click' | 'drag';
}

export interface InteractionConfig {
  event: 'hover' | 'click' | 'drag';
  property: string;
  sensitivity: number;
  damping: number;
  resetOnLeave: boolean;
}

export interface SceneTemplate {
  id: SceneTemplateId;
  name: string;
  description: string;
  tier: 'free' | 'spark' | 'pro' | 'agency';
  defaultCamera: CameraPresetId;
  defaultLighting: LightingPresetId;
  defaultMaterial: MaterialPresetId;
  defaultAnimations: AnimationPresetId[];
  defaultEnvironment: EnvironmentEffectId[];
  defaultAsset: SceneAssetRef;
  defaultPerformance: PerformanceBudget;
}

export interface PerformanceCheckResult {
  passed: boolean;
  polycount: number;
  maxPolycount: number;
  textureResolution: number;
  maxTextureResolution: number;
  animationCount: number;
  maxAnimationCount: number;
  particleCount: number;
  maxParticleCount: number;
  estimatedJSSize: number;
  maxJSSize: number;
  hasMobileFallback: boolean;
  hasLOD: boolean;
  issues: string[];
}
