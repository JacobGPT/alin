/**
 * Product UI Registry — Maps product types to React wizard components
 *
 * This registry holds React components for product-specific wizards.
 * Registration is idempotent — safe for HMR and double-calls.
 */

import type { ComponentType } from 'react';

// Maps TBWOType string → React wizard component
const uiRegistry = new Map<string, ComponentType<any>>();

export const productUIRegistry = {
  registerWizard(type: string, component: ComponentType<any>): void {
    if (uiRegistry.has(type)) return; // Idempotent — safe for HMR / double-call
    uiRegistry.set(type, component);
  },
  getWizard(type: string): ComponentType<any> | undefined {
    return uiRegistry.get(type);
  },
  hasWizard(type: string): boolean {
    return uiRegistry.has(type);
  },
};
