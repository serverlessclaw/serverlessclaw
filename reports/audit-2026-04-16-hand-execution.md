# Audit Report: Silo 2 (The Hand) - Agent Execution Flow - 2026-04-16

## 🎯 Objective

Deep dive into the Agent Execution Flow (Silo 2) to identify bugs, gaps, and overengineering, with a focus on consolidating redundant logic and hardening interactive signaling.

## 🎯 Finding Type

- Bug / Gap / Inconsistency / Refactor

## 🔍 Investigation Path

- Started at: `core/lib/agent/executor/base-executor.ts`
- Followed: `standard-executor.ts`, `streaming-executor.ts`, `budget-enforcer.ts`, `executor-helper.ts`
- Observed: Significant code duplication, redundant budget checks, and a mismatch in interactive signal handling.

## 🚨 Findings

| ID  | Title | Type | Severity | Location | Recommended Action |
| :-- | :---------------- | :--- | :------- | :--------- | :----------------- |
| 1 | Signal Mismatch | Bug | P1 | base-executor.ts:145 | Consolidate interactive signal prefixes with button values. |
| 2 | Budget Redundancy | Refactor | P2 | executor-helper.ts:160 | Remove duplicate `checkBudgets` in favor of `BudgetEnforcer`. |
| 3 | Loop Duplication | Refactor | P2 | streaming-executor.ts | Consolidate semantic loop detection into a shared utility or base class. |
| 4 | Redundant Budgeting | Refactor | P3 | standard-executor.ts | Consolidate pre-loop and post-call budget checks into a single authoritative call. |
| 5 | Shared Clamping | Refactor | P3 | base-executor.ts | Extract token clamping and context management into `BaseExecutor` or shared helper. |

## 💡 Architectural Reflections

The execution flow has suffered from "feature creep" where individual executors (`Standard` vs `Streaming`) have independently implemented identical logic (budgeting, loop detection, context management). This creates a maintenance burden and increases the risk of drift. 

Consolidating these into `BaseExecutor` or a specialized `ExecutionOrchestrator` will simplify the codebase significantly while ensuring consistency across streaming and non-streaming modes.

---
> [!IMPORTANT]
> The mismatch between button values (`REJECT_TOOL_CALL`) and signal handlers (`TOOL_REJECTION:`) is a P1 bug that likely prevents human-in-the-loop (HITL) actions from being correctly processed by the agent.
