# Audit Report: Trust Loop (Eye → Scales → Spine) - 2026-04-26

## 🎯 Objective

Verify the integrity of the system's "Trust Loop" (Perspective D), ensuring that performance telemetry from the Eye correctly feeds reputation updates in the Scales, which then authoritative influence routing decisions in the Spine.

## 🎯 Finding Type

- Bug (Telemetry Data Loss)
- Architectural Drift (Disconnected Trust Loop)
- Principle Violation (Non-Atomic Updates)

## 🔍 Investigation Path

- Started at: `core/lib/metrics/token-usage.ts` (Silo 5: The Eye).
- Followed: Traced how token usage and success/failure records are rolled up and queried.
- Observed: Identified that `TokenTracker.updateRollup` writes to `GLOBAL#...` for scoped data, but `getRollupRange` (used by the Router) never reads from this partition, causing global analysis to ignore tenant-specific successes/failures.
- Followed: Analyzed `core/lib/routing/AgentRouter.ts` (Silo 1: The Spine) to see how it uses trust and reputation.
- Observed: Discovered that `AgentRouter` ignores the `trustScore` (calculated by `TrustManager` in Silo 6) and instead only uses `reputation` (calculated in Silo 4). These two systems are disconnected, leading to inconsistent agent selection.
- Followed: Examined `core/lib/memory/reputation-operations.ts` (Silo 4: The Brain).
- Observed: Identified that `updateReputation` uses a Get-Calculate-Put pattern, violating **Principle 15 (Monotonic Progress)**.

## 🚨 Findings

| ID  | Title                                           | Type | Severity | Location                                   | Recommended Action                                                                                                                                                    |
| :-- | :---------------------------------------------- | :--- | :------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Telemetry Fragmentation (Metrics Data Loss)     | Bug  | P1       | `core/lib/metrics/token-usage.ts:160, 285` | Update `getRollupRange` to query `GLOBAL#TOKEN_ROLLUP#` when no scope is provided, ensuring all tenant data is aggregated for global routing decisions.             |
| 2   | Disconnected Trust Loop (Scales bypassed)       | Drift| P1       | `core/lib/routing/AgentRouter.ts:175, 305` | Incorporate agent `trustScore` into the composite score calculation in `AgentRouter`, ensuring that tool-level trust penalties actually impact agent selection.       |
| 3   | Non-Atomic Reputation Updates (Principle 15)    | Race | P2       | `core/lib/memory/reputation-operations.ts` | Refactor `updateReputation` to use atomic DynamoDB `ADD` operations for counts and latency, rather than application-layer calculations based on stale reads.        |
| 4   | Missing Trust-Driven Mode Enforcement           | Gap  | P2       | `core/lib/agent.ts`                        | Implement the "Trust < 95" threshold logic to force HITL (Human-in-the-Loop) mode for agents with degraded reputation, as described in `ARCHITECTURE.md`.            |

## 💡 Architectural Reflections

The system currently maintains two parallel "truth" sources for agent reliability: **Reputation** (task-level) and **TrustScore** (tool-level). While these serve different granularities, they are currently silos that do not talk to each other. This creates a risk where an agent that fails 50% of its tool calls (low trust) but eventually finishes its tasks (high reputation) is still favored by the router, leading to inefficient "looping" behavior and wasted tokens.

To resolve this, we should unify Silo 6 (The Scales) and Silo 4 (The Brain: Reputation) into a single authoritative **Trust Engine** that feeds the Spine.
