# ALIN Architecture Constitution

This document defines the canonical layer boundaries, import rules, and architectural invariants for the ALIN codebase.

---

## 1. The 6 Canonical Layers

| Layer | Directory | Responsibility | May Import From |
|-------|-----------|---------------|----------------|
| **Shared** | `src/shared/`, `src/types/` | Type definitions, pure utilities | Nothing (leaf layer) |
| **Kernel** | `src/alin-kernel/`, `src/api/` | Infrastructure adapters: DB, LLM clients, transport, file sandbox, search | Shared |
| **Executive** | `src/alin-executive/`, `src/store/tbwo*.ts`, `src/services/` | Orchestration: execution engine, contracts, receipts, intent detection, product registry | Shared, Kernel |
| **Memory** | `src/alin-memory/`, `src/store/memory*.ts`, `src/store/project*.ts` | Memory stores, self-model service | Shared, Kernel |
| **Surface** | `src/alin-surface/`, `src/components/`, `src/store/{ui,chat,settings,auth,status,mode,audit,image,artifact,workspace}*.ts` | React components, UI stores, product UI registry | Shared, Kernel, Executive, Memory |
| **Products** | `src/products/` | Product-specific code (templates, wizards, prompts) | Shared, Kernel, Executive, Memory, Surface |

### Import Direction (allowed)

```
Products → Surface → Executive → Kernel → Shared
                  ↘   Memory  ↗
```

### Import Direction (forbidden)

- Shared cannot import from any layer
- Kernel cannot import from Executive, Memory, Surface, or Products
- Executive cannot import from Surface or Products (and NEVER imports React)
- Memory cannot import from Surface or Products
- Core layers (Kernel, Executive, Memory) cannot import from Products

---

## 2. The Product Boundary

**Core NEVER imports products. Products register via registries.**

Products are self-contained feature domains (e.g., Website Sprint). They register themselves into two registries at bootstrap:

1. **`productRegistry`** (executive layer) - Pure orchestration data: template factories, plan factories, pod factories, validators, deploy hooks. **Zero React imports.**

2. **`productUIRegistry`** (surface layer) - React wizard components for product-specific creation flows.

### How Core Uses Products

Core code uses `productRegistry.get(type)` to access product factories dynamically. It never imports product files directly. Example:

```ts
// In tbwoStore.ts (executive layer)
const product = productRegistry.get(TBWOType.WEBSITE_SPRINT);
const pods = product.podsFactory(tbwoId);
const plan = product.planFactory(tbwoId, config, pods, objective);
```

### How Surface Uses Products

Surface code uses `productUIRegistry.getWizard(type)` to render product-specific wizards. Example:

```tsx
// In TemplateSelector.tsx (surface layer)
const WizardComponent = productUIRegistry.getWizard(selectedTemplate.type);
if (WizardComponent) return <WizardComponent onComplete={onSelect} />;
```

---

## 3. How to Add a New Product

1. Create a directory: `src/products/<product-name>/`
2. Create template/factory files (pure TypeScript, no React)
3. Create wizard component (React)
4. Create `index.ts` with a `register<Product>()` function that:
   - Calls `productRegistry.register(...)` with orchestration data
   - Calls `productUIRegistry.registerWizard(...)` with the React wizard
5. Call `register<Product>()` in `src/main.tsx` (before `root.render()`)

Registration is **idempotent** - calling it twice is safe (HMR, double-mount).

---

## 4. Pause-and-Ask (Executive Primitive)

Pause-and-Ask is a first-class execution primitive, NOT a UI feature.
It lives in the executive layer (`executionEngine.ts` + `tbwoStore.ts`).

When a pod encounters a critical unknown during execution, it calls
the `request_pause_and_ask` tool. This:

1. Creates a `PauseRequest` with reason, question, required fields
2. Sets TBWO status to `PAUSED_WAITING_FOR_USER`
3. Hard-stops all execution (no tool calls, no pod spawns, no task reruns)
4. Waits for user response via chat or store
5. Tags the response content (`USER_PROVIDED` / `INFERRED` / `PLACEHOLDER`)
6. Resumes execution from the exact checkpoint

### Invariants Enforced

- `PAUSED_WAITING_FOR_USER` blocks all forward progress
- Completed tasks are never re-executed after resume (`completedTaskIds` set prevents replay)
- No tool calls while paused (tool loop checks status)
- No pod spawns while paused (`spawnPods()` only called at phase start)
- Every pause event is logged in `TBWOReceipts.pauseEvents`
- Content tags propagate to all artifacts derived from pause responses

### Content Tags

Every value produced from a pause resolution is tagged with a `ContentTag`:

| Tag | Meaning |
|-----|---------|
| `USER_PROVIDED` | User typed a specific value |
| `USER_APPROVED` | User approved an AI suggestion |
| `INFERRED` | AI inferred from a vague user response |
| `PLACEHOLDER` | Temporary value, needs user review |

---

## 5. RequestContext & Data Scoping

### User Scoping (Already Production-Correct)

- Server's `requireAuth` middleware derives `req.user` from JWT
- `user_id TEXT` column on ALL user-data tables
- ALL queries filter by `WHERE user_id = ?` using `req.user.id`
- Client NEVER sends user_id - server derives it from JWT

### Project Scoping (New)

- Client sends `X-Project-Id` header via `dbService.ts` (injected by DI)
- Server validates ownership in `requireAuth`: checks `projects` table
- Falls back to `'default'` if project not owned by user (no error leak)
- Root entities (`conversations`, `tbwo_orders`, `memory_entries`) have `project_id` column
- Child entities (`messages`, `artifacts`) inherit scope via parent FK join

### DI Pattern

Kernel's `dbService` has zero imports from executive. The DI wiring in `main.tsx` passes a closure:

```ts
setProjectProvider(() => getRequestContext().projectId);
```

The closure is called inside `apiCall()` on every request - never cached. Project switching takes effect immediately.

---

## 6. Layer File Membership

| Existing Directory | Canonical Layer |
|-------------------|----------------|
| `src/types/` | Shared |
| `src/api/dbService.ts` | Kernel |
| `src/api/claudeClient.ts` | Kernel |
| `src/api/openaiClient.ts` | Kernel |
| `src/api/serverStreamClient.ts` | Kernel |
| `src/api/contextManager.ts` | Kernel |
| `src/api/fileHandler.ts` | Kernel |
| `src/api/braveSearch.ts` | Kernel |
| `src/api/websocket.ts` | Kernel |
| `src/api/intentDetector.ts` | Executive (decision logic) |
| `src/api/apiService.ts` | Executive (orchestrates LLM calls) |
| `src/services/tbwo/executionEngine.ts` | Executive |
| `src/services/contractService.ts` | Executive |
| `src/services/receiptGenerator.ts` | Executive |
| `src/services/tbwoExecutor.ts` | Executive |
| `src/store/tbwoStore.ts` | Executive |
| `src/store/podPoolStore.ts` | Executive |
| `src/store/memoryStore.ts` | Memory |
| `src/store/projectStore.ts` | Memory |
| `src/services/selfModelService.ts` | Memory |
| `src/store/chatStore.ts` | Surface |
| `src/store/uiStore.ts` | Surface |
| `src/store/settingsStore.ts` | Surface |
| `src/store/authStore.ts` | Surface |
| `src/store/statusStore.ts` | Surface |
| `src/store/modeStore.ts` | Surface |
| `src/store/auditStore.ts` | Surface |
| `src/store/imageStore.ts` | Surface |
| `src/store/artifactStore.ts` | Surface |
| `src/store/workspaceStore.ts` | Surface |
| `src/components/**` | Surface |
| `src/products/sites/` | Products |

---

## 7. Enforcement

### ESLint Overrides (`.eslintrc.cjs`)

4 boundary rules enforced via `no-restricted-imports`:

1. **Rule 1**: Core files cannot import from `**/products/**`
2. **Rule 2**: Shared types cannot import from any layer
3. **Rule 3**: Kernel cannot import stores, services, or surface
4. **Rule 4**: Executive cannot import React or surface

### CI Integration

Add to CI pipeline:
```bash
npx eslint src/alin-executive/ src/alin-kernel/ src/shared/ src/types/
```

### What Each Rule Prevents

| Rule | Prevents |
|------|----------|
| Core-no-products | Product code leaking into core, creating coupling |
| Shared-no-layers | Types depending on runtime code, circular deps |
| Kernel-no-stores | Infrastructure depending on application state |
| Executive-no-React | Orchestration logic coupled to UI framework |

---

## 8. Core Architectural Invariants

1. **Core layers cannot import products** - ESLint enforced
2. **Executive layer cannot import surface/React** - ESLint enforced
3. **Pause-and-Ask deterministically blocks execution until resolved** - `PAUSED_WAITING_FOR_USER` blocks all tool calls, pod spawns, and task re-runs
4. **Receipts reflect actual execution events** - `pauseEvents` array captures real pause/resume data
5. **Content provenance tags exist** - Every pause resolution is tagged via `ContentTag` enum
