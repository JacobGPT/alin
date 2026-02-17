import type { LightingPresetId, LightingConfig } from './types';

export const LIGHTING_PRESETS: Record<LightingPresetId, LightingConfig> = {
  studio: {
    ambient: { color: '#ffffff', intensity: 0.4 },
    directional: [
      {
        type: 'directional',
        color: '#ffffff',
        intensity: 0.8,
        position: [5, 5, 5],
        castShadow: true,
      },
      {
        type: 'directional',
        color: '#ffffff',
        intensity: 0.4,
        position: [-3, 3, -2],
        castShadow: false,
      },
    ],
    point: [
      {
        type: 'point',
        color: '#ffffff',
        intensity: 0.3,
        position: [0, 3, -3],
      },
    ],
    spot: [],
  },
  natural: {
    ambient: { color: '#fff5e6', intensity: 0.5 },
    directional: [
      {
        type: 'directional',
        color: '#fffbe6',
        intensity: 0.9,
        position: [8, 10, 4],
        castShadow: true,
      },
    ],
    point: [],
    spot: [],
  },
  dramatic: {
    ambient: { color: '#ffffff', intensity: 0.1 },
    directional: [
      {
        type: 'directional',
        color: '#ffffff',
        intensity: 1.2,
        position: [-4, 6, 2],
        castShadow: true,
      },
    ],
    point: [
      {
        type: 'point',
        color: '#ff9944',
        intensity: 0.6,
        position: [2, 1, 3],
      },
    ],
    spot: [],
  },
  neon: {
    ambient: { color: '#111111', intensity: 0.2 },
    directional: [],
    point: [
      {
        type: 'point',
        color: '#00ffff',
        intensity: 1.0,
        position: [-3, 2, 2],
      },
      {
        type: 'point',
        color: '#ff00ff',
        intensity: 1.0,
        position: [3, 2, -2],
      },
    ],
    spot: [],
  },
  minimal: {
    ambient: { color: '#ffffff', intensity: 0.6 },
    directional: [
      {
        type: 'directional',
        color: '#ffffff',
        intensity: 0.5,
        position: [2, 4, 3],
        castShadow: false,
      },
    ],
    point: [],
    spot: [],
  },
  warm: {
    ambient: { color: '#ffcc88', intensity: 0.5 },
    directional: [
      {
        type: 'directional',
        color: '#ffaa66',
        intensity: 0.7,
        position: [4, 5, 3],
        castShadow: true,
      },
    ],
    point: [
      {
        type: 'point',
        color: '#ff8844',
        intensity: 0.4,
        position: [-2, 2, 2],
      },
    ],
    spot: [],
  },
  cool: {
    ambient: { color: '#8888ff', intensity: 0.4 },
    directional: [
      {
        type: 'directional',
        color: '#aaccff',
        intensity: 0.7,
        position: [3, 5, 4],
        castShadow: true,
      },
    ],
    point: [
      {
        type: 'point',
        color: '#6688ff',
        intensity: 0.4,
        position: [-2, 2, -2],
      },
    ],
    spot: [],
  },
};
