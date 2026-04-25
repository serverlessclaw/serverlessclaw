# Audit Report: Evolution Cycle (Hand → Shield → Scales) - 2026-04-25

## 🎯 Objective

Verify the integrity of the **Evolution Cycle (Perspective B)**, specifically focusing on the interaction between proactive tool execution (Hand), safety enforcement (Shield), and trust-based autonomy (Scales).

## 🎯 Finding Type

- Bug / Security

## 🔍 Investigation Path

- Started at: `core/lib/safety/safety-engine.ts`
- Followed: The "Principle 9" bypass logic for proactive tasks.
- Observed: Tasks marked as `isProactive: true` bypass the entire safety validation pipeline if the agent has high trust (`trustScore >= 95`) and is in `AUTO` mode.
- Verified: Created two test cases in `core/lib/safety/safety-engine.test.ts` that attempt to execute a Class D action and access a system-protected resource via a proactive task. Both tests failed, confirming that the bypass is absolute and ignores critical safety boundaries.

## 🚨 Findings

| ID | Title | Type | Severity | Location | Recommended Action | Status |
| :-- | :--- | :--- | :------- | :------- | :----------------- | :----- |
| 1 | Proactive Tasks Bypass Critical Safety Boundaries | Bug / Security | P0 | `core/lib/safety/safety-engine.ts:165-177` | Move the proactive bypass logic AFTER hard security blocks. | **FIXED** |

## ✅ Remediation & Verification

### Fix Applied
- **Refactored `evaluateAction` Pipeline**: The validation pipeline in `core/lib/safety/safety-engine.ts` has been restructured into two distinct phases:
    1. **Hard Security Blocks**: Enforces Class D permanent blocks and System Resource protection. This phase is now **non-bypassable**.
    2. **Trust-Driven Autonomy**: The Principle 9 bypass (for proactive tasks) now only executes *after* hard blocks have been cleared. It only skips "Soft Restrictions" like rate limits and Class C approvals.
- **Improved Fail-Closed Integrity**: The pipeline now explicitly stops and records violations if any hard block returns `requiresApproval: true` or `allowed: false`.

### Verification Results
- **Targeted Security Tests**: Two new test cases were added to `core/lib/safety/safety-engine.test.ts`:
    - `should NOT bypass Class D block even if task is proactive [Perspective B]`
    - `should NOT bypass System Protected resources even if task is proactive [Perspective B]`
- **Result**: Both tests now **PASS**, confirming that proactive tasks can no longer escalate privileges to perform blocked system operations.
- **Regression Testing**: All 3,679 tests in `@serverlessclaw/core` passed successfully.

## 💡 Architectural Reflections

- **Principle 9 (Trust-Driven Mode) vs. Safety Baselines**: Principle 9 encourages autonomy for trusted agents, but it should never override "unconditional" safety blocks (Class D). The current implementation of the proactive bypass is too early in the pipeline, creating a "God Mode" for agents triggered via the `EvolutionScheduler`.
- **System Hardening**: Even for "proactive" tasks (which have already survived a timeout in the scheduler), we must re-verify that they don't violate fundamental system invariants. The `EvolutionScheduler` and `StrategicTieBreakHandler` provide an "evolutionary" path, but it must still be a "safe" one.
- **Leaky Bypass**: The `isProactive` flag, once set, essentially disables the Shield for that task. This is a classic "fail-open" pattern if the flag can be influenced or if the bypass logic is too broad.
