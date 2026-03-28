# Test Coverage Improvement Plan

## Current State

| Area           | Test Files | Source Files | Coverage |
| -------------- | ---------- | ------------ | -------- |
| core/          | 131        | ~187         | ~70%     |
| dashboard/src/ | 20         | ~99          | ~20%     |
| infra/         | 7          | 8            | ~88%     |
| e2e/           | 10 specs   | N/A          | N/A      |
| **Total**      | **168**    | **~294**     | **~57%** |

**Thresholds**: 50% lines, 40% functions/branches, 48% statements.

---

## Phase 1: Critical Path Tests (core/handlers/events/)

**Goal**: Cover 7 untested event sub-handlers that control critical agent workflows.

### 1.1 `parallel-handler.ts` (269 lines)

- Tests: `core/handlers/events/parallel-handler.test.ts`
- Cover: `handleParallelDispatch()`, dependency graph validation, barrier timeout scheduling, task dispatch via DynamicScheduler
- Mocks: `sst`, `@aws-sdk/client-dynamodb`, `@aws-sdk/client-eventbridge`, `DynamicScheduler`, `ConfigManager`
- Pattern: Follow `build-handler.test.ts` (vi.hoisted mocks, inline mock factories)

### 1.2 `parallel-barrier-timeout-handler.ts`

- Tests: `core/handlers/events/parallel-barrier-timeout-handler.test.ts`
- Cover: Barrier expiry, aggregation trigger, partial completion handling

### 1.3 `parallel-task-completed-handler.ts`

- Tests: `core/handlers/events/parallel-task-completed-handler.test.ts`
- Cover: Task completion tracking, barrier check, result aggregation

### 1.4 `escalation-handler.ts`

- Tests: `core/handlers/events/escalation-handler.test.ts`
- Cover: Escalation routing, severity thresholds, notification dispatch

### 1.5 `clarification-handler.ts`

- Tests: `core/handlers/events/clarification-handler.test.ts`
- Cover: Clarification request processing, timeout scheduling

### 1.6 `clarification-timeout-handler.ts`

- Tests: `core/handlers/events/clarification-timeout-handler.test.ts`
- Cover: Timeout expiry behavior, fallback actions

### 1.7 `health-handler.ts`

- Tests: `core/handlers/events/health-handler.test.ts`
- Cover: Health event processing, status aggregation

**Acceptance**: All 7 handlers have at least happy-path + 1 error-path test each.

---

## Phase 2: Tool Definitions Smoke Tests (core/tools/definitions/)

**Goal**: Validate that 14 tool definition files export expected structures.

### Approach

- Create `core/tools/definitions/definitions-smoke.test.ts`
- Import each definition module and assert:
  - Exported tool arrays are non-empty
  - Each tool has required fields: `name`, `description`, `parameters`
  - Parameter schemas are valid JSON Schema (have `type`)
- Single test file covers all definitions (fast, low maintenance)

### Files to cover

- `definitions/agent.ts`, `definitions/clarification.ts`, `definitions/collaboration.ts`
- `definitions/config.ts`, `definitions/deployment.ts`, `definitions/git.ts`
- `definitions/knowledge.ts`, `definitions/mcp.ts`, `definitions/metadata.ts`
- `definitions/orchestration.ts`, `definitions/scheduler.ts`, `definitions/skills.ts`
- `definitions/system.ts`, `definitions/index.ts`

**Acceptance**: Smoke test passes, CI enforces definition structure.

---

## Phase 3: Dashboard Coverage (dashboard/src/)

**Goal**: Increase dashboard from ~20% to ~50% file coverage.

### 3.1 API Routes (highest priority)

| File                             | Test File       | Focus                            |
| -------------------------------- | --------------- | -------------------------------- |
| `app/api/collaboration/route.ts` | `route.test.ts` | GET/POST handlers, error cases   |
| `app/api/agents/route.ts`        | Already exists  | Enhance with PUT/DELETE coverage |

### 3.2 Utility/Library Files

| File                          | Test File                  | Focus                               |
| ----------------------------- | -------------------------- | ----------------------------------- |
| `lib/api-handler.ts`          | `api-handler.test.ts`      | Error wrapping, response formatting |
| `lib/tool-utils.ts`           | `tool-utils.test.ts`       | Tool filtering, categorization      |
| `lib/constants.ts`            | `constants.test.ts`        | Export validation                   |
| `lib/theme.ts`                | `theme.test.ts`            | Theme object structure              |
| `lib/tool-definitions.ts`     | `tool-definitions.test.ts` | Definition completeness             |
| `app/capabilities/actions.ts` | `actions.test.ts`          | Server actions                      |

### 3.3 Complex Components

| File                                   | Test File                   | Focus                     |
| -------------------------------------- | --------------------------- | ------------------------- |
| `components/Chat/ChatContent.tsx`      | `ChatContent.test.tsx`      | Render, state transitions |
| `components/Chat/ChatMessageList.tsx`  | `ChatMessageList.test.tsx`  | Message rendering, scroll |
| `components/Chat/ChatSidebar.tsx`      | `ChatSidebar.test.tsx`      | Session list, selection   |
| `components/Chat/useChatConnection.ts` | `useChatConnection.test.ts` | WebSocket lifecycle       |
| `components/Sidebar.tsx`               | `Sidebar.test.tsx`          | Navigation, active state  |

### 3.4 Capabilities Components (lower priority)

- `CapabilitiesView.tsx`, `AgentsTab.tsx`, `MCPTab.tsx` -- smoke render tests

**Pattern**: Follow `dashboard/src/app/api/agents/route.test.ts` pattern:

- Mock `sst`, AWS SDK, and `@claw/core` imports
- Use `NextRequest` for API route tests
- Use `@testing-library/react` + `jsdom` for component tests

**Acceptance**: Dashboard coverage reaches ~50% file coverage.

---

## Phase 4: Raise Coverage Thresholds

**Goal**: Gradually enforce higher coverage standards.

### Step 1 (after Phase 1-2 complete)

```typescript
// vitest.config.ts
thresholds: {
  lines: 55,
  functions: 45,
  branches: 45,
  statements: 53,
}
```

### Step 2 (after Phase 3 complete)

```typescript
thresholds: {
  lines: 60,
  functions: 50,
  branches: 50,
  statements: 58,
}
```

### Step 3 (follow-up sprint)

```typescript
thresholds: {
  lines: 70,
  functions: 60,
  branches: 60,
  statements: 68,
}
```

---

## Phase 5: Shared Mock Infrastructure

**Goal**: Reduce test boilerplate and improve consistency.

### 5.1 Create `__mocks__/` directory

```
core/__mocks__/
  sst.ts              -- Standard SST Resource mock
  dynamodb.ts         -- DynamoDBClient + DocumentClient mock
  eventbridge.ts      -- EventBridgeClient mock
  bedrock.ts          -- BedrockRuntimeClient mock
```

### 5.2 Update `vitest.config.ts`

Add `__mocks__/` to module resolution so tests auto-resolve mocks.

### 5.3 Migrate existing tests

- Refactor `build-handler.test.ts` and similar to use shared mocks
- Keep `vi.hoisted()` for test-specific mock state

**Acceptance**: New tests import from `__mocks__/` instead of inline mocking.

---

## Execution Order

1. **Phase 1** (critical paths) -- no dependencies, can start immediately
2. **Phase 2** (tool definitions) -- no dependencies, can parallelize with Phase 1
3. **Phase 3** (dashboard) -- can start after Phase 1 pattern is established
4. **Phase 4** (thresholds) -- after Phase 1-2 pass CI
5. **Phase 5** (shared mocks) -- refactor opportunity after new tests exist

---

## Verification

After each phase:

1. `make test` -- all tests pass
2. `make test-coverage` -- thresholds enforced
3. `make gate` -- full quality gate passes (lint + format + typecheck + coverage + aiready)
