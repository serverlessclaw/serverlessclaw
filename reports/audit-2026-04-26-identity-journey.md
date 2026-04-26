# Audit Report: Identity Journey (Silo 3: The Shield) - 2026-04-26

## 🎯 Objective

Verify identity and permissions propagate correctly across all surfaces, specifically focusing on Perspective C: The "Identity Journey" (Brain → Spine → Shield). The goal was to ensure that identity constraints and RBAC rules are strictly enforced by the `SafetyEngine` when agent actions are executed.

## 🎯 Finding Type

- Bug (Fail-Open RBAC Bypass)

## 🔍 Investigation Path

- Started at: `core/lib/safety/safety-engine.ts` (Silo 3: The Shield).
- Followed: Traced the `evaluateAction` method signature to see how user identity (`userId` and `userRole`) is processed and validated within the `SafetyEngine`.
- Observed: I noticed that `SafetyEngine.validateRBAC` uses `ctx.userRole` to enforce access controls. If `!role` is true, it immediately returns `{ allowed: true, requiresApproval: false }`, intending to whitelist SYSTEM tasks.
- Followed: Traced upstream to where `evaluateAction` is called in the agent execution flow.
- Observed: In `core/lib/agent/tool-security.ts`, the `ToolSecurityValidator.validate` method builds a `context` object to pass to `safety.evaluateAction`. Although `ToolExecutionContext` contains the `userRole` property, it is omitted when constructing the context object for the `SafetyEngine`. Consequently, `ctx.userRole` evaluates to `undefined`, which triggers the fallback in `validateRBAC` and allows unauthorized execution of restricted `Class C` actions (e.g., `iam_change`) by any user, including `VIEWER`.

## 🚨 Findings

| ID  | Title                                           | Type | Severity | Location                                   | Recommended Action                                                                                                                                                    |
| :-- | :---------------------------------------------- | :--- | :------- | :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Fail-Open RBAC Bypass due to missing `userRole` | Bug  | P0       | `core/lib/agent/tool-security.ts:44`       | Pass `userRole: execContext.userRole` into the context object provided to `safety.evaluateAction` in `ToolSecurityValidator.validate`.                                |
| 2   | Implicit System Whitelist causes Fail-Open      | Bug  | P1       | `core/lib/safety/safety-engine.ts:258-260` | Require an explicit `ctx.userId === 'SYSTEM'` match instead of implicitly treating `!role` as a system bypass in `validateRBAC` to enforce default-deny mechanisms. |

## 💡 Architectural Reflections

The integration boundary between The Hand (`ToolExecutor` / `ToolSecurityValidator`) and The Shield (`SafetyEngine`) currently relies on loosely typed implicit context object mapping. Because TypeScript did not enforce that all optional properties mapped faithfully across boundaries, the omission of `userRole` went unnoticed, causing a fail-open state. 

This is a classic manifestation of Anti-Pattern #8 (Siloed Fixes leading to broken contracts) combined with a fail-open security bypass. To resolve this holistically, we should enforce strict cross-silo identity types (e.g., standardizing an `IdentityContext` interface that both `ToolExecutionContext` and `SafetyEngine` require explicitly).
