/**
 * Product Registry — Pure orchestration data registration
 *
 * This registry holds product metadata and factory functions.
 * It NEVER imports React — the UI registry (productUIRegistry) handles that.
 * Registration is idempotent — safe for HMR and double-calls.
 */

import type { TBWOType, PodRole } from '../types/tbwo';

export interface ProductRegistration {
  type: TBWOType;
  name: string;
  description: string;
  icon: string;
  // Orchestration factories (variadic — each product defines its own signature)
  templateFactory: (...args: any[]) => any;
  planFactory?: (...args: any[]) => any;
  podsFactory?: (...args: any[]) => any;
  defaultConfig?: any;
  // Validators & hooks
  validators?: Array<(tbwo: any) => { valid: boolean; errors: string[] }>;
  deployHooks?: Array<(tbwo: any, artifacts: any[]) => Promise<void>>;
  // Domain prompts for pod roles
  domainInstructions?: Partial<Record<PodRole, string>>;
  // Metadata
  metadata?: Record<string, unknown>;
}

const registry = new Map<string, ProductRegistration>();

export const productRegistry = {
  register(product: ProductRegistration): void {
    if (registry.has(product.type)) return; // Idempotent — safe for HMR / double-call
    registry.set(product.type, product);
  },
  get(type: string): ProductRegistration | undefined {
    return registry.get(type);
  },
  getAll(): ProductRegistration[] {
    return Array.from(registry.values());
  },
  has(type: string): boolean {
    return registry.has(type);
  },
};
