import type { AnimationPresetId, AnimationConfig } from './types';

export const ANIMATION_PRESETS: Record<AnimationPresetId, AnimationConfig> = {
  // Rotation
  'rotate-y': {
    type: 'continuous',
    property: 'rotation.y',
    axis: 'y',
    speed: 0.5,
    range: [-Math.PI, Math.PI],
    easing: 'linear',
  },
  'rotate-x': {
    type: 'continuous',
    property: 'rotation.x',
    axis: 'x',
    speed: 0.3,
    range: [-Math.PI, Math.PI],
    easing: 'linear',
  },
  'rotate-orbit': {
    type: 'continuous',
    property: 'rotation',
    speed: 0.2,
    range: [-Math.PI, Math.PI],
    easing: 'linear',
  },

  // Float
  float: {
    type: 'continuous',
    property: 'position.y',
    axis: 'y',
    speed: 1,
    range: [-0.3, 0.3],
    easing: 'sinusoidal',
  },
  'float-bounce': {
    type: 'continuous',
    property: 'position.y',
    axis: 'y',
    speed: 1.5,
    range: [-0.5, 0.5],
    easing: 'sinusoidal',
  },
  breathe: {
    type: 'continuous',
    property: 'scale',
    speed: 0.8,
    range: [0.95, 1.05],
    easing: 'sinusoidal',
  },

  // Scroll
  'scroll-rotate': {
    type: 'scroll',
    property: 'rotation.y',
    axis: 'y',
    speed: 1,
    range: [0, Math.PI * 2],
    easing: 'linear',
    scrollMap: { start: 0, end: 1 },
  },
  'scroll-zoom': {
    type: 'scroll',
    property: 'position.z',
    axis: 'z',
    speed: 1,
    range: [-2, 2],
    easing: 'linear',
    scrollMap: { start: 0, end: 1 },
  },
  'scroll-parallax': {
    type: 'scroll',
    property: 'position',
    speed: 1,
    range: [-1, 1],
    easing: 'linear',
    scrollMap: { start: 0, end: 1 },
  },

  // Interaction
  'hover-tilt': {
    type: 'interaction',
    property: 'rotation',
    speed: 1,
    range: [-0.1, 0.1],
    easing: 'linear',
    interactionEvent: 'hover',
  },
  'hover-lift': {
    type: 'interaction',
    property: 'position.y',
    axis: 'y',
    speed: 1,
    range: [0, 0.3],
    easing: 'linear',
    interactionEvent: 'hover',
  },
  'click-bounce': {
    type: 'interaction',
    property: 'scale',
    speed: 2,
    range: [0.9, 1.1],
    easing: 'linear',
    interactionEvent: 'click',
  },
};
