import type { AssetEntry } from './types';

export const BUILTIN_ASSETS: AssetEntry[] = [
  // Free tier primitives
  { id: 'primitive-cube', name: 'Cube', type: 'primitive', tier: 'free', category: 'primitive', polycount: 12, primitiveType: 'BoxGeometry' },
  { id: 'primitive-sphere', name: 'Sphere', type: 'primitive', tier: 'free', category: 'primitive', polycount: 2048, primitiveType: 'SphereGeometry' },
  { id: 'primitive-torus', name: 'Torus', type: 'primitive', tier: 'free', category: 'primitive', polycount: 1536, primitiveType: 'TorusGeometry' },
  { id: 'primitive-torusknot', name: 'Torus Knot', type: 'primitive', tier: 'free', category: 'primitive', polycount: 3840, primitiveType: 'TorusKnotGeometry' },
  // Free tier abstract builtins
  { id: 'abstract-blob', name: 'Abstract Blob', type: 'builtin', tier: 'free', category: 'abstract', polycount: 5000, cdnUrl: '/assets/3d/abstract-blob.glb' },
  { id: 'abstract-wave', name: 'Abstract Wave', type: 'builtin', tier: 'free', category: 'abstract', polycount: 4000, cdnUrl: '/assets/3d/abstract-wave.glb' },
  { id: 'abstract-ring', name: 'Abstract Ring', type: 'builtin', tier: 'free', category: 'abstract', polycount: 3000, cdnUrl: '/assets/3d/abstract-ring.glb' },
  // Pro tier devices
  { id: 'device-laptop', name: 'Laptop', type: 'builtin', tier: 'pro', category: 'device', polycount: 15000, cdnUrl: '/assets/3d/laptop.glb' },
  { id: 'device-phone', name: 'Phone', type: 'builtin', tier: 'pro', category: 'device', polycount: 8000, cdnUrl: '/assets/3d/phone.glb' },
  { id: 'device-headphones', name: 'Headphones', type: 'builtin', tier: 'pro', category: 'device', polycount: 12000, cdnUrl: '/assets/3d/headphones.glb' },
  { id: 'device-speaker', name: 'Speaker', type: 'builtin', tier: 'pro', category: 'device', polycount: 10000, cdnUrl: '/assets/3d/speaker.glb' },
];

const TIER_HIERARCHY: Record<string, string[]> = {
  free: ['free'],
  spark: ['free', 'spark'],
  pro: ['free', 'spark', 'pro'],
  agency: ['free', 'spark', 'pro', 'agency'],
  admin: ['free', 'spark', 'pro', 'agency'],
};

export function getAssetById(id: string): AssetEntry | undefined {
  return BUILTIN_ASSETS.find((asset) => asset.id === id);
}

export function getAssetsForTier(tier: 'free' | 'spark' | 'pro' | 'agency'): AssetEntry[] {
  const allowedTiers = TIER_HIERARCHY[tier];
  return BUILTIN_ASSETS.filter((asset) => allowedTiers.includes(asset.tier));
}

export function isAssetAvailable(assetId: string, tier: 'free' | 'spark' | 'pro' | 'agency'): boolean {
  const asset = getAssetById(assetId);
  if (!asset) return false;
  const allowedTiers = TIER_HIERARCHY[tier];
  return allowedTiers.includes(asset.tier);
}
