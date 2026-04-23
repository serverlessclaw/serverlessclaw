# Audit Report: The Trust Loop (Perspective D) - 2026-04-23

## 🎯 Objective

Verify the feedback loop from observation (Eye) through trust (Scales) to action (Spine) to ensure multi-tenant isolation and accurate routing based on reputation.

## 🎯 Finding Type

- Bug / Inconsistency / Gap

## 🔍 Investigation Path

- Started at: `core/lib/metrics/metrics.ts` and `core/lib/safety/trust-manager.ts`
- Followed: Event emission (`REPUTATION_UPDATE`) -> `core/handlers/events/reputation-handler.ts` -> `core/lib/memory/reputation-operations.ts` -> `core/lib/routing/AgentRouter.ts`
- Observed: While reputation metrics correctly use `workspaceId` for scoped tracking, the underlying `TrustManager` and `AgentRouter` drop the scope, resulting in global state modifications and reads.

## 🚨 Findings

| ID  | Title             | Type | Severity | Location   | Recommended Action |
| :-- | :---------------- | :--- | :------- | :--------- | :----------------- |
| 1   | Global Trust Score Penalty Leak | Bug | P0 | `core/lib/safety/trust-manager.ts` (updateTrustScore) | Pass `TrustContext` down to `updateTrustScore` and use `options: { workspaceId }` when calling `AgentRegistry.getAgentConfig` and `AgentRegistry.atomicAddAgentField`. |
| 2   | Global Agent Selection By Router | Bug | P1 | `core/lib/routing/AgentRouter.ts` (selectBestAgent) | Pass `workspaceId` (from scope) when fetching `configs` via `AgentRegistry.getAgentConfig(id)` to correctly respect workspace-level `enabled` overrides. |
| 3   | Global Trust History & Penalty Logging | Gap | P2 | `core/lib/safety/trust-manager.ts` (logPenalty, recordHistory) | Use scoped keys (e.g., `WS#workspaceId#trust:score_history#agentId`) instead of globally shared keys for appending lists in ConfigManager. |

## 💡 Architectural Reflections

The recent fix for global reputation and metrics ("Fixed in this round") was a **Siloed Fix (Anti-Pattern 8)**. While `reputation-operations.ts` now uses `reputationKey` with a hierarchical scope, the adjacent components (`TrustManager` in Silo 6 and `AgentRouter` in Silo 1) were not fully updated to respect this scope. As a result, a failure by an agent in Workspace A still globally penalizes the agent's `trustScore`, and disabled agents in a workspace can still be selected by the router if they are globally enabled. This breaks the multi-tenancy requirement of the Trust Loop.
