/**
 * Shared Layer — Canonical type re-exports
 *
 * This barrel provides a single import point for all shared types
 * used across ALIN layers. No runtime code — types only.
 */

export * from '../types/chat';
export * from '../types/tbwo';
export * from '../types/memory';
export * from '../types/ui';
export * from '../types/audit';
// Re-export contracts excluding TimeBudget (already exported from tbwo)
export type {
  TaskContract,
  ContractStatus,
  ContractScope,
  QualityRequirements,
  StopCondition,
  ContractViolation,
  ContractValidationResult,
} from '../types/contracts';
export * from '../types/trust';
export * from '../types/context';
