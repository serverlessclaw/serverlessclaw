# Audit Report: Life of a Message (Spine → Brain → Eye) - 2026-04-26

## 🎯 Objective

Verify the consistent propagation of context (identity, trace, and tenant) and the integrity of state transitions as a message moves through the system backbone (Spine), into persistent memory (Brain), and finally into observability sinks (Eye).

## 🎯 Finding Type

- Bug (Fail-Open Strategy Violation)
- Race Condition (Atomic State Integrity Violation)
- Architectural Drift (Inconsistent Multi-tenancy)

## 🔍 Investigation Path

- Started at: `core/handlers/events.ts` (Silo 1: The Spine).
- Followed: Traced the message flow through `FlowController` and `DistributedState` for rate limiting.
- Observed: Identified a fail-open fallback in `DistributedState.consumeToken`.
- Followed: Examined `TrustManager` (Silo 6: The Scales) to see how successful/failed messages update agent reputation.
- Observed: Identified a non-atomic "Get-Calculate-Put" pattern violating Principle 15.
- Followed: Analyzed `core/lib/metrics/metrics.ts` (Silo 5: The Eye) for tenant-scoped observability.
- Observed: Identified several critical metrics that lack `WorkspaceId` dimensions.

## 🚨 Findings

| ID  | Title                                           | Type | Severity | Location                                   | Recommended Action                                                                                                                                                    |
| :-- | :---------------------------------------------- | :--- | :------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fail-Open Rate Limiting Fallback                | Bug  | P1       | `core/lib/utils/distributed-state.ts:223` | Change `return true` to `return false` when rate limit state initialization fails to enforce Principle 13 (Fail-Closed).                                            |
| 2   | Non-Atomic Trust Score Updates (Principle 15)   | Race | P1       | `core/lib/safety/trust-manager.ts:161-163` | Use atomic increments (DynamoDB `ADD` or `atomicIncrementMapField`) for trust score updates to prevent lost updates under high concurrency.                           |
| 3   | Telemetry Blindness (Missing WorkspaceId)       | Gap  | P2       | `core/lib/metrics/metrics.ts:220, 230`     | Add `WorkspaceId` dimension to `RateLimitExceeded`, `CircuitBreakerTriggered`, and `TaskDispatchLatency` metrics to enable tenant-specific alerting.                  |
| 4   | Race Condition in Session Metadata Updates      | Race | P2       | `core/lib/memory/session-operations.ts:210`| Refactor `saveConversationMeta` to use field-level `UpdateExpression` only for the fields provided in the `meta` object, rather than a full-field overwrite.         |
| 5   | Inconsistent Isolation in Registry Pruning      | Drift| P3       | `core/lib/registry/AgentRegistry.ts:365`   | Refactor `pruneLowUtilizationTools` to use the `workspaceId` option in `ConfigManager.getRawConfig` instead of manual key prefixing to maintain architectural purity. |

## 💡 Architectural Reflections

The transition from a single-tenant to a multi-tenant system has left some gaps in the "Eye" (observability). While the "Spine" (routing) and "Brain" (memory) have largely adopted `WorkspaceId` scoping, the core system metrics remain global. This creates a risk where one tenant's erratic behavior (e.g., hitting rate limits) triggers global alarms but remains difficult to attribute to a specific source without manual log analysis.

Furthermore, the violation of **Principle 15 (Monotonic Progress)** in `TrustManager` indicates that while the system *can* be atomic (via `ConfigManager.atomicUpdateMapEntity`), developers are still falling back to snapshot-based calculations in the application layer. We should expose a dedicated `atomicIncrementMapField` utility to make Principle 15 enforcement easier.
