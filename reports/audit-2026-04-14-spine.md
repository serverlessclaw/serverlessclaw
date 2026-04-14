# Audit Report: The Spine (Nervous System & Flow) - 2026-04-14

## 🎯 Objective
A deep-dive investigation into the **Spine** vertical (Event Routing, Concurrency, and Recursion) and **Eye** vertical (Observation) to identify functional failures and architectural gaps.

## 🎯 Finding Type
**Bug / Gap / Inconsistency**

---

## 🔍 Investigation Path
- **Started at**: `core/lib/backbone.ts` to map system agents.
- **Followed**: Event flow through `core/handlers/agent-multiplexer.ts` and `core/handlers/agent-runner.ts`.
- **Analyzed**: Concurrency and safety guards in `core/lib/lock/lock-manager.ts`, `core/lib/recursion-tracker.ts`, and `core/lib/session/session-state.ts`.
- **Observed**: Inconsistencies between the "Mirror" (Silo 6) principles and actual implementation.

---

## 🚨 Findings & Resolutions

| ID | Title | Type | Severity | Status | Resolution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **`AgentRunner` Resets Recursion Depth** | Bug | P1 | **FIXED** | Removed per-agent recursion stack clearing to preserve monotonic depth across traces (Principle 15). |
| **2** | **Race Condition on Tie-Break** | Bug | P1 | **FIXED** | `AgentMultiplexer` now halts task processing when a collaboration timeout occurs to avoid race conditions with tie-break logic. |
| **3** | **Dynamic Agent Dead End** | Gap | P2 | **FIXED** | Added explicit routing for dynamic `dynamic_*` agents in `AgentMultiplexer` to `AgentRunner`. |
| **4** | **Bypass of Selection Integrity** | Inconsistency | P2 | **FIXED** | `AgentRouter` now strictly enforces `enabled === true` for all selection methods (Principle 14). |
| **5** | **Ghost Trace Remediation Gap** | Gap | P2 | **FIXED** | `ClawTracer.failTrace` now emits a recovery event for ALL failures, not just dashboard sources. |
| **6** | **SLO Metric Drift** | Inconsistency | P2 | **FIXED** | `SLOTracker` now uses 1.25x average as a proxy for p95 latency when raw p95 data is missing. |

---

## 💡 Architectural Reflections

1.  **Recursion Safety**: Fixed violation of **Principle 15**. Swarm-based recursion must be tracked at the trace level, not reset by individual runners.
2.  **Selection Integrity**: Aligned `AgentRouter` with **Principle 14**. Selection status is now verified at the gateway for both async and sync selection paths.
3.  **Resilience**: `AgentMultiplexer` now correctly yields to the Facilitator during conflict resolution, preventing split-brain execution.
4.  **Observability**: Unified failure reporting ensures the Metabolism silo can respond to backend failures as effectively as dashboard user interactions.
