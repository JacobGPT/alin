import type { InteractionConfig } from './types';

export const INTERACTION_PRESETS: Record<string, InteractionConfig> = {
  'hover-tilt': {
    event: 'hover',
    property: 'rotation',
    sensitivity: 0.1,
    damping: 0.05,
    resetOnLeave: true,
  },
  'hover-lift': {
    event: 'hover',
    property: 'position.y',
    sensitivity: 0.3,
    damping: 0.08,
    resetOnLeave: true,
  },
  'click-bounce': {
    event: 'click',
    property: 'scale',
    sensitivity: 1,
    damping: 0.1,
    resetOnLeave: true,
  },
  'drag-rotate': {
    event: 'drag',
    property: 'rotation',
    sensitivity: 0.5,
    damping: 0.05,
    resetOnLeave: false,
  },
};
