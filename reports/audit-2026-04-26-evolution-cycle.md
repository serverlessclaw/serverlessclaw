# Audit Report: Perspective B: Evolution Cycle - 2026-04-26

## 🎯 Objective

Verify the "Evolution Cycle" (Perspective B: Hand → Shield → Scales), focusing on how the system's execution (Hand), safety enforcement (Shield), and trust scoring (Scales) interact to enable autonomous evolution (Principle 10) while maintaining strict multi-tenant isolation and security.

## 🎯 Finding Type

- Bug
- Vulnerability
- Principle Violation

## 🔍 Investigation Path

- Started at: `docs/governance/AUDIT-COVERAGE.md` which highlighted Perspective B as needing verification of loop integrity.
- Examined Hand: `core/lib/agent/tool-executor.ts` to see how tool results trigger trust updates.
- Examined Shield: `core/lib/safety/safety-engine.ts` and `core/lib/safety/safety-base.ts` for safety evaluation and violation logging.
- Examined Scales: `core/lib/safety/trust-manager.ts` and `core/lib/registry/AgentRegistry.ts` for trust score persistence.
- Examined Evolution Loop: `core/agents/qa.ts` to see how high-level verification rewards or penalizes initiators.
- Observed: Significant multi-tenant isolation leaks in the trust and violation persistence layers.

## 🚨 Findings

| ID  | Title | Type | Severity | Location | Recommended Action |
| :-- | :--- | :--- | :------- | :------- | :----------------- |
| 1 | Global Trust Updates via SafetyEngine | Bug | P0 | `core/lib/safety/safety-base.ts:18` | Update `SafetyBase.recordSuccess` and `recordFailure` to accept and propagate `workspaceId` to `TrustManager`. |
| 2 | Global Safety Violation Persistence | Bug | P0 | `core/lib/safety/safety-base.ts:114` | Update `SafetyBase.persistViolation` to include `workspaceId` in the Partition Key if present. |
| 3 | QA Agent Workspace Context Leak | Bug | P0 | `core/agents/qa.ts:42` | Destructure `workspaceId`, `teamId`, and `staffId` from payload and pass them to trust recording methods. |
| 4 | Inconsistent Initiator Scoping in Evolution | Bug | P1 | `core/lib/safety/safety-engine.ts:511` | Ensure `handleClassCAction` loads agent config using the correct `workspaceId` when checking blast radius limits. |

## 💡 Architectural Reflections

### The Trust Scoping Gap
While `TrustManager` and `ConfigManager` support workspace-scoped configurations, the `SafetyEngine` (Shield) abstraction layers drop this context. This is a critical failure in the "Evolution Cycle" because an agent's trust score is its "reputation" that earns it autonomy (Principle 9). 

If a `Coder` agent performs poorly in Workspace A but well in Workspace B, their global reputation is averaged if the context is dropped. Even worse, if the updates are global, an agent might reach the `AUTONOMY_THRESHOLD` (90) globally based on data from other tenants, granting it bypasses (God Mode) in a sensitive production workspace where it hasn't yet earned that trust.

### Persistence Key Fragmentation
The `SafetyBase.persistViolation` method manually constructs Partition Keys instead of using the unified `BaseMemoryProvider.getScopedUserId` utility. This led directly to the P0 isolation bug where safety violations are stored in a global bucket.

**Related Anti-Patterns**: 
- **Siloed Context**: The Hand (`ToolExecutor`) was fixed to pass context, but the Shield (`SafetyEngine`) and the Evolution loop (`QA Agent`) were missed, creating an inconsistent system state.
- **Missing Principle 14 (Selection Integrity)**: Trust updates through `SafetyEngine` implicitly select the global config instead of the workspace config.
