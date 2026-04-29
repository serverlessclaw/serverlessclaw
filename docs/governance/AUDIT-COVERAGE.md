# Audit Coverage Matrix

## Overview

This document tracks which system silos and cross-silo perspectives have been audited across all rounds. It helps identify under-audited areas and guide future audit efforts.

Last Updated: 2026-04-29

---

## Silo Coverage (1-7)

| Silo  | Name           | Primary Code Paths                              | Audit Count | Last Audited | Risk Level |
| :---- | :------------- | :---------------------------------------------- | :---------- | :----------- | :--------- |
| **1** | The Spine      | `core/handlers/events.ts`, `core/lib/bus.ts`    | 14          | 2026-04-26   | Low        |
| **2** | The Hand       | `core/lib/mcp.ts`, `core/lib/agent/executor.ts` | 9           | 2026-04-29   | Low        |
| **3** | The Shield     | `core/lib/safety/safety-engine.ts`              | 15+         | 2026-04-27   | Medium     |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`             | 11          | 2026-04-26   | Medium     |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/`         | 13          | 2026-04-29   | Low        |
| **6** | The Scales     | `core/lib/safety/trust-manager.ts`              | 14          | 2026-04-29   | Low        |
| **7** | The Metabolism | `core/lib/maintenance/metabolism.ts`            | 6           | 2026-04-29   | Low        |

---

## Cross-Silo Perspectives (A-E) Coverage

| Perspective | Name              | Description            | Usage Count | Last Tested |
| :---------- | :---------------- | :--------------------- | :---------- | :---------- |
| **A**       | Life of a Message | Spine → Brain → Eye    | 6           | 2026-04-29  |
| **B**       | Evolution Cycle   | Hand → Shield → Scales | 6           | 2026-04-29  |
| **C**       | Identity Journey  | Brain → Spine → Shield | 7           | 2026-04-29  |
| **D**       | Trust Loop        | Eye → Scales → Spine   | 7           | 2026-04-29  |
| **E**       | Recovery Path     | Shield → Spine → Brain | 7           | 2026-04-29  |

---

## Audit Reports History

| Date       | Report                                          | Silos Covered         | Cross-Silo | Key Findings                                                                                        |
| :--------- | :---------------------------------------------- | :-------------------- | :--------- | :-------------------------------------------------------------------------------------------------- |
| 2026-04-29 | `audit-2026-04-29-recovery-path.md`            | Shield, Spine, Brain  | E          | FIXED: P1 Fail-open CB state, P1 Multi-tenant Session PK gap, P1 Unscoped Distributed Locks       |
| 2026-04-29 | `audit-2026-04-29-identity-journey-v3.md`      | Shield, Brain         | C          | FIXED: P1 Fail-open agent selection in collaborations, P2 Orphaned fail-open circuit breaker      |
| 2026-04-29 | `audit-2026-04-29-metabolism-identity.md`     | Metabolism, Identity  | C, D       | FIXED: P1 Registry partial update, P1 Participant index collision, P1 S3 Reclamation telemetry |
| 2026-04-29 | `audit-2026-04-29-evolution-hand.md`            | Hand, Scales          | B          | FIXED: P1 Blind Security Failures, P1 Blind Execution Crashes, P1 Inconsistent Success Detection    |
| 2026-04-29 | `audit-2026-04-29-message-metabolism.md`        | Eye, Metabolism       | A          | FIXED: P1 Collaboration race condition, P1 Telemetry blindness, P2 Stale tool pruning gap           |
| 2026-04-27 | `audit-2026-04-27-evolution-scoping.md`         | Hand, Brain           | B          | FIXED: P1 Tenant-Blind Config Load, P1 Unscoped Activation Chain                                    |
| 2026-04-27 | `audit-2026-04-27-identity-journey-v2.md`       | Brain, Hand           | C          | FIXED: P0 Global Identity Leakage, P0 Dashboard Bypass, P0 AST Tool Bypass                          |
| 2026-04-27 | `audit-2026-04-27-metabolism-evolution.md`      | Metabolism, Evolution | B, E       | FIXED: P1 Cross-Tenant Evolution, P1 Global S3 Pruning, P2 Scoping Inconsistencies                  |
| 2026-04-27 | `audit-2026-04-27-perspective-a-remediation.md` | Spine, Brain, Eye     | A          | FIXED: P1 Spine Telemetry Blindness, P1 Fragmented Metrics Partition, P2 Non-GSI Compliance         |
| 2026-04-27 | `audit-2026-04-27-life-of-a-message-v2.md`      | Spine, Brain, Eye     | A          | FIXED: P1 Missing metrics in non-streaming path, P1 Non-atomic persistence, P2 Multi-tenant regex   |
| 2026-04-27 | `audit-2026-04-27-trust-loop.md`                | Scales, Eye           | D          | FIXED: P1 Cognitive metric collisions, P1 Trust history inconsistency, P1 Multi-tenant decay gap    |
| 2026-04-27 | `audit-2026-04-27-perspective-a.md`             | Spine, Eye            | A          | FIXED: Telemetry Blindness in metrics, Scoping bugs in events, Cognitive data loss                  |
| 2026-04-27 | `audit-2026-04-27-metabolism-recovery.md`       | Metabolism, Recovery  | E          | FIXED: P1 Tool usage count loss, P1 LKG record collision, P2 Config atomicity, P2 Scan optimization |
| 2026-04-27 | `audit-2026-04-27-identity-journey.md`          | Brain, Spine, Shield  | C          | FIXED: P1 Identity race condition, P2 Safety bypasses, P2 Adaptive failure                          |
| 2026-04-26 | `audit-2026-04-26-identity-journey.md`          | Brain, Spine, Shield  | C          | PASSED: Verified Principle 12, 13, 14, 15 across silos.                                             |
| 2026-04-26 | `audit-2026-04-26-trust-loop.md`                | Eye, Scales, Spine    | D          | FIXED: Disconnected trust engine, Telemetry data loss                                               |
| 2026-04-26 | `audit-2026-04-26-evolution-cycle.md`           | Hand, Shield, Scales  | B          | FIXED: Selection Integrity (Sh10), JSON Mode enforcement (Sh9)                                      |
| 2026-04-26 | `audit-2026-04-26-life-of-a-message.md`         | Spine, Brain, Eye     | A          | FIXED: Fail-Closed rate limiting, Atomic session updates                                            |

---

## Gap Analysis

### High Priority (Needs Re-Audit)

1. **Perspective A: Life of a Message** - Needs verification of full-stack observability with the new unified metrics partition.

### Medium Priority (Rarely Audited)

1. **The Metabolism** (Silo 7) - Now has 4 audits, regenerative logic for tools and trust verified. Next audit should focus on S3 resource reclamation.

### High Risk (Most Violations)

1. **All core silos (1-6) have been significantly hardened on 2026-04-26.** Risk levels have been downgraded based on comprehensive remediation of cross-silo leaks and race conditions.

---

## Audit Best Practices for Future Agents

1. **Principle 13/15 First**: Prioritize checking `ConditionExpression` and `ADD` patterns in DynamoDB.
2. **Multi-Tenancy Scoping**: Verify `workspaceId` propagation in all cross-silo events.
3. **Automated Verification**: Always run `pnpm principles` and update the rule list in `scripts/quality/verify-principles.ts` to include new patterns.
4. **Track Recurrence**: Use `ANTI-PATTERNS.md` to prevent regression of fixed P1 issues.

---

## Anti-Patterns Identified

See `docs/governance/ANTI-PATTERNS.md` for recurring issues to avoid.
