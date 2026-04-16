# Audit Report: Silo 7 (The Metabolism) - 2026-04-14

## 🎯 Objective

Investigate the Regenerative Metabolism system vertical (Silo 7) to identify bugs, gaps, and inconsistencies. The overarching goal is to clean up architectural debt, prevent overengineering, and simplify where possible, adhering to Principle 10 (Lean Evolution) and Principle 13 (Atomic State Integrity).

## 🎯 Finding Type

- Bug / Inconsistency / Refactor Opportunities

## 🔍 Investigation Path

- Started at: `docs/system/METABOLISM.md` and `core/lib/maintenance/metabolism.ts`
- Followed: `AgentRegistry.pruneLowUtilizationTools` and `AgentRegistry.getAgentConfig` in `core/lib/registry/AgentRegistry.ts`
- Observed: 
  - How low-utilization tools are identified and pruned.
  - How live remediation (`remediateDashboardFailure`) triggers metabolic actions.
  - How expired tools are handled during configuration retrieval (`getAgentConfig`).
  - Gap tracking locking mechanisms in `core/lib/memory/gap-operations.ts`.

## 🚨 Findings

| ID  | Title | Type | Severity | Location | Recommended Action |
| :-- | :--- | :--- | :------- | :------- | :----------------- |
| 1 | **Read-Side Side-Effects (Race Condition)** | Bug | P1 | `core/lib/registry/AgentRegistry.ts:140` | Removed `saveRawConfig` side-effects from `getAgentConfig`. Tool pruning during reads should filter in-memory only, leaving persistence to atomic metabolism tasks. |
| 2 | **Premature Tool Pruning (Force Prune Bug)** | Bug | P1 | `core/lib/maintenance/metabolism.ts:169` | Updated `daysThreshold` from `0` to `1` in `remediateDashboardFailure`. A threshold of 0 indiscriminately deletes brand new tools with 0 usage immediately during unrelated dashboard errors. |
| 3 | **Global vs Per-Agent Usage Inconsistency** | Inconsistency | P2 | `core/lib/registry/AgentRegistry.ts:583` | `pruneLowUtilizationTools` checks global `TOOL_USAGE` instead of per-agent stats, conflicting with its own tests. Rewrite to respect per-agent usage metrics. |
| 4 | **Non-Atomic Tool Array Overwrites** | Refactor | P2 | `core/lib/registry/AgentRegistry.ts:619` | `pruneLowUtilizationTools` overwrites the tool array using `saveRawConfig`, violating Principle 13. Needs an atomic field update mechanism for `<agentId>_tools`. |
| 5 | **Over-engineered Gap Locks** | Refactor | P3 | `core/lib/memory/gap-operations.ts:465` | `acquireGapLock`/`releaseGapLock` duplicate the conflict detection already provided natively by DynamoDB conditional transitions (`TRANSITION_GUARDS` in `updateGapStatus`). Removing them would simplify the architecture. |

## 💡 Architectural Reflections

The config subsystem shows significant "Architectural Debt" through fragmentation. Agent tools are stored across three disjoint layers: `AGENTS_CONFIG` (backbone), `AGENT_TOOL_OVERRIDES` (batch overrides), and `<agentId>_tools` (per-agent). This fragmentation prevents the use of standard atomic updates like `atomicUpdateAgentField` across all tool configurations, forcing the codebase into unprotected object-level overwrites and overengineered read-side aggregations. Unifying the configuration storage would natively resolve the race conditions and align with the system's "Stateless Core" and "Atomic State Integrity" principles.

### Applied Live Remediations
1. **Removed Read-Side Side-Effects:** Modified `AgentRegistry.getAgentConfig` to filter expired tools strictly in-memory, rather than persisting `saveRawConfig` calls during reads, eliminating a major P1 race condition vector.
2. **Fixed Force-Prune Bug:** Adjusted `MetabolismService.remediateDashboardFailure` to pass a `1`-day threshold to `pruneLowUtilizationTools` to prevent the instant deletion of newly assigned tools.
