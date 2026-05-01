# Audit Report: The Brain & Identity Journey - 2026-05-01

## 🎯 Objective

Audit the "Identity Journey (Brain → Spine → Shield)" (Perspective C) with a focus on workspace multi-tenant isolation, RBAC leakage, and Identity manager integrity.

## 🎯 Finding Type

- Bug

## 🔍 Investigation Path

- Started at: `core/lib/session/identity/manager.ts` (The Brain / Identity)
- Followed: Identity checks in `hasPermission` through `validateRBAC` in `core/lib/safety/safety-engine.ts` (The Shield) and `core/handlers/events.ts` (The Spine).
- Observed: Missing validation constraint leading to fail-open workspace permission evaluation.

```text
[ Identity Journey: Perspective C ]

  (Spine)  Event Envelope { traceId, workspaceId: "WS-A" }
             |
             v
  (Shield) SafetyEngine.evaluateAction(context: { workspaceId: "WS-A" })
             |
             v
  (Shield) ToolSecurityValidator.validate()
             |
             v
  (Brain)  IdentityManager.hasPermission(userId, perm, workspaceId: "WS-A")
             |
             +--- [ BEFORE FIX ] ---+
             |  if (workspaceId && scoped) checkMembership()
             |  else return true; <--- FAIL-OPEN if workspaceId missing!
             |
             +--- [ AFTER FIX  ] ---+
                if (scoped) {
                   if (!workspaceId) return false; <--- FAIL-CLOSED (P1 Fix)
                   return membershipCheck();
                }
```

## 🚨 Findings

| ID  | Title             | Type | Severity | Location   | Recommended Action |
| :-- | :---------------- | :--- | :------- | :--------- | :----------------- |
| 1   | Fail-Open RBAC Bypass | Bug  | P1       | `core/lib/session/identity/manager.ts` (hasPermission) | FIXED. Ensure `workspaceId` existence is validated when evaluating workspace-scoped permissions. |
| 2   | Over-restrictive VIEWER Role | Bug | P2 | `core/lib/safety/safety-engine.ts` (validateRBAC) | The Shield unconditionally blocks all actions for VIEWER roles (Class B and Class A), which contradicts the intent to allow purely observational (Class A) actions. Recommend explicitly defining `CLASS_A_ACTIONS` and allowing them for VIEWERs. |

## 💡 Architectural Reflections

- **Fail-Open Anti-Pattern**: The vulnerability in `hasPermission` falls directly into Anti-Pattern #1 (Fail-Open Safety Checks). If `workspaceId` was omitted in an API call or event context, the system would erroneously evaluate the workspace check as passing (by skipping it and returning true). This allows cross-tenant permission escalation. The logic has been patched to fail-closed if `workspaceId` is missing for a workspace-scoped permission.
- **Safety Base Taxonomy**: We noticed that `CLASS_A_ACTIONS` is not formally defined in `core/lib/constants/safety.ts`, resulting in the `validateRBAC` method applying a blanket denial to `VIEWER` roles, breaking intended observational functionality. A clear definition for `CLASS_A_ACTIONS` (e.g. `inspectTrace`, `checkConfig`) should be added to `core/lib/constants/safety.ts`.
