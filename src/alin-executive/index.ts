/**
 * ALIN Executive Layer — Orchestration facade
 *
 * The executive layer contains:
 * - Execution engine and orchestration
 * - Contract and receipt services
 * - Decision logic (intent detection, message routing)
 * - Executive stores (TBWO, pod pool)
 * - Product registry (pure data, no React)
 * - Request context
 *
 * The executive NEVER imports:
 * - React or React DOM
 * - Surface components
 * - UI registries
 */

// Execution engine
export { ExecutionEngine, executionEngine } from '../services/tbwo/executionEngine';
export { contractService } from '../services/contractService';
export { receiptGenerator } from '../services/receiptGenerator';

// Executive stores
export { useTBWOStore } from '../store/tbwoStore';
export { usePodPoolStore } from '../store/podPoolStore';

// Product registry (pure data, no React)
export { productRegistry } from './productRegistry';
export type { ProductRegistration } from './productRegistry';

// Request context
export { getRequestContext, setRequestContext } from './requestContext';
export type { RequestContext } from '../types/context';
