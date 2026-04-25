# Audit Report: Perspective A (Life of a Message) - 2026-04-25

## 🎯 Objective

Verify end-to-end message flow integrity from receipt to response, focusing on the Spine (Events), Brain (Memory/Session), and Eye (Tracing/Metrics).

## 🎯 Finding Type

- Bug / Inconsistency

## 🔍 Investigation Path

- Started at: `core/handlers/events.ts` (The Spine entry point)
- Followed: Event routing to `AgentMultiplexer` and continuation handlers.
- Checked: `core/handlers/events/shared.ts` (wakeupInitiator), `core/lib/session/session-state.ts` (lock release/resume), and `core/handlers/events/task-result-handler.ts`.
- Observed: Systematic loss of tenant isolation fields (`workspaceId`, `teamId`, `staffId`) during event re-emission and continuation.

## 🚨 Findings

| ID | Title | Type | Severity | Location | Recommended Action |
| :-- | :--- | :--- | :------- | :------- | :----------------- |
| 1 | Tenant Context Loss in `wakeupInitiator` | Bug | P1 | `core/handlers/events/shared.ts:128` | Pass `workspaceId`, `teamId`, and `staffId` into the `emitEvent` detail payload. |
| 2 | Tenant Context Loss in `processEventWithAgent` | Bug | P1 | `core/handlers/events/shared.ts:355` | Include `workspaceId`, `teamId`, and `staffId` in the `emitTypedEvent` for `TASK_COMPLETED`. |
| 3 | Tenant Context Loss in Session Resume | Bug | P1 | `core/lib/session/session-state.ts:153` | Add `workspaceId`, `teamId`, and `staffId` to the re-emitted continuation event. |
| 4 | Tenant Context Loss in DAG Task Completion | Bug | P1 | `core/handlers/events/task-result-handler.ts:213` | Include `workspaceId`, `teamId`, and `staffId` in the `emitTypedEvent` for `DAG_TASK_COMPLETED/FAILED`. |
| 5 | Broken Idempotency in Task Result Handler | Bug | P1 | `core/handlers/events/task-result-handler.ts:98` | The handler uses `__envelopeId` or `event.id` as the idempotency key, but EventBridge `id` changes on every emission. This fails to catch application-level double-emissions. | **FIXED** |
| 6 | Tenant Context Loss in `EscalationManager` | Bug | P1 | `core/lib/lifecycle/escalation-manager.ts` | Pass `workspaceId`, `teamId`, and `staffId` through the escalation lifecycle and include them in emitted events. | **FIXED** |

## ✅ Remediation & Verification

### Fixes Applied
- **Tenant Context Threading**: Updated `wakeupInitiator`, `processEventWithAgent`, `AgentMultiplexer`, and `SessionStateManager` to explicitly capture and propagate `workspaceId`, `teamId`, and `staffId`. Identity is now a first-class citizen in the asynchronous event loop.
- **Stable Content Idempotency**: Refactored `task-result-handler.ts` to use content-aware hashing for deduplication, matching the recently hardened main `EventHandler`.
- **Escalation Isolation**: Enhanced the `EscalationManager` to preserve tenant context across time-based escalation levels.

### Verification Results
- **Unit & Integration Tests**: All 3,679 tests in `@serverlessclaw/core` and related packages passed successfully.
- **Improved Dedup Verification**: Updated `task-result-handler.test.ts` to explicitly verify that logical duplicates (same content, no ID) are now correctly suppressed.

## 💡 Architectural Reflections

- **Identity Persistence Anti-Pattern**: Perspective A reveals that "Identity" is treated as a transient property of an event rather than a persistent property of a trace or session. When events are re-emitted (for continuation, retry, resume, or escalation), the identity fields must be manually "threaded" through. A more robust approach would be to have the Spine (`EventHandler`) or the Brain (`SessionStateManager`) automatically inject these fields from the trace/session if missing.
- **Divergent Idempotency Strategies**: Finding #5 shows that `task-result-handler` is still using the old `envelopeId` strategy while the main `EventHandler` has been upgraded to "Stable Content Hash" idempotency. This inconsistency makes the system vulnerable to double-processing of task completions.
- **Silent Failures in Multi-tenancy**: Because `workspaceId` is optional in most schemas, its absence doesn't trigger validation errors, but it silently breaks data isolation in downstream agents (e.g., they might use the 'global' workspace instead of the specific one).
