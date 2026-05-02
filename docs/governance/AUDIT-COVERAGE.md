# Audit Coverage Matrix

## Overview

This document tracks which system silos and cross-silo perspectives have been audited across all rounds. It helps identify under-audited areas and guide future audit efforts.

Last Updated: 2026-05-02

---

## Silo Coverage (1-7)

| Silo  | Name           | Primary Code Paths                              | Audit Count | Last Audited | Risk Level |
| :---- | :------------- | :---------------------------------------------- | :---------- | :----------- | :--------- |
| **1** | The Spine      | `core/handlers/events.ts`, `core/lib/bus.ts`    | 18          | 2026-05-02   | Low        |
| **2** | The Hand       | `core/lib/mcp.ts`, `core/lib/agent/executor.ts` | 10          | 2026-05-01   | Low        |
| **3** | The Shield     | `core/lib/safety/safety-engine.ts`              | 18          | 2026-05-02   | Low        |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`             | 16          | 2026-05-02   | Low        |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/`         | 15          | 2026-05-02   | Low        |
| **6** | The Scales     | `core/lib/safety/trust-manager.ts`              | 15          | 2026-05-02   | Low        |
| **7** | The Metabolism | `core/lib/maintenance/metabolism.ts`            | 9           | 2026-05-02   | Low        |

---

## Cross-Silo Perspectives (A-F) Coverage

| Perspective | Name              | Description            | Usage Count | Last Tested |
| :---------- | :---------------- | :--------------------- | :---------- | :---------- |
| **A**       | Life of a Message | Spine → Brain → Eye    | 9           | 2026-05-02  |
| **B**       | Evolution Cycle   | Hand → Shield → Scales | 7           | 2026-04-29  |
| **C**       | Identity Journey  | Brain → Spine → Shield | 10          | 2026-05-01  |
| **D**       | Trust Loop        | Eye → Scales → Spine   | 12          | 2026-05-02  |
| **E**       | Recovery Path     | Shield → Spine → Brain | 10          | 2026-05-02  |
| **F**       | Metabolic Loop    | Metabolism ↔ Scales ↔ Spine | 1           | 2026-05-02  |

---

## Audit Reports History

| Date       | Report                                             | Silos Covered                    | Cross-Silo | Key Findings                                                                                                    |
| :--------- | :------------------------------------------------- | :------------------------------- | :--------- | :-------------------------------------------------------------------------------------------------------------- |
| 2026-05-02 | `audit-2026-05-02-metabolic-loop.md`               | Metabolism, Scales, Spine        | F          | FIXED: P1 Disconnected autonomous mode shift, P1 Global backbone metabolism blind spot, P2 S3 listing efficiency. |
| 2026-05-02 | `audit-2026-05-02-life-of-a-message.md`            | Spine, Brain, Eye                | A          | FIXED: P1 Non-atomic snapshots & tracer updates, P2 In-memory multi-tenant filtering, P2 Observability gaps.    |
| 2026-05-02 | `audit-2026-05-02-recovery-path.md`                | Shield, Spine, Brain             | E          | FIXED: P1 Non-idempotent session resumption, P2 DLQ retry data loss window. Improved error classification.      |
| 2026-05-02 | `audit-2026-05-02-trust-loop.md`                   | Eye, Scales, Spine               | D          | FIXED: P2 Blind Tool Hallucinations (missing tool penalty), P2 Trust update observability gaps.                 |
| 2026-05-02 | `audit-2026-05-02-tool-acquisition.md`             | Hand                             | B          | FIXED: P2 Missing Tool Acquisition Cost Estimation and Budget Enforcement                                       |
| 2026-05-01 | `audit-2026-05-01-identity-journey-refactoring.md` | Spine, Brain, Shield, Metabolism | C, D       | FIXED: P1 Critical AI Context Overflow in Config module via inheritance-based refactoring. Verified isolation.  |
| 2026-05-01 | `audit-2026-05-01-brain-isolation.md`              | Brain, Hand, Spine               | A          | FIXED: P1 Critical Memory Isolation Leakage, P2 Global Item Invisibility in workspaces. Verified Silo 2 Budget. |
| 2026-05-01 | `audit-2026-05-01-recovery-path.md`                | Shield, Spine, Brain             | E          | FIXED: P1 Sticky Recovery Counter, P2 Conservative lock cleanup, P2 Global remediation bypass.                  |
| 2026-05-01 | `audit-2026-05-01-identity-journey.md`             | Brain, Spine, Shield             | C          | FIXED: P1 Fail-Open RBAC Bypass in IdentityManager. Updated tests to enforce workspace isolation.               |
| 2026-05-01 | `audit-2026-05-01-shield-metabolism.md`            | Shield, Metabolism               | C, D, E    | FIXED: P1 Race Condition in Trust Clamping, P2 S3 Reclamation Telemetry Blindness, P2 Lock Release Race         |
| 2026-05-01 | `audit-2026-05-01-the-shield-identity.md`          | Shield                           | C          | FIXED: P0 Fail-Open RBAC Viewer Bypass, P1 Fail-Open Policy Fallback, P1 Blind Tool Failures                    |
| 2026-04-30 | `audit-2026-04-30-cognitive-safety-guards.md`      | Shield, Eye                      | D          | FIXED: P1 Fail-open Cognitive Trace Coherence, P2 Inconsistent Priority                                         |
| 2026-04-30 | `audit-2026-04-30-identity-journey.md`             | Brain, Spine, Shield             | C          | FIXED: P1 Identity Leak in selection boundary, P2 Unauthorized agent invitation (Anti-Pattern 10)               |
| 2026-04-30 | `audit-2026-04-30-metabolism-repairs.md`           | Metabolism                       | E          | FIXED: P1 Direct Object-Level Overwrite (Anti-Pattern 6), P1 False Positive Pruning Success, P1 Crash fallback  |
| 2026-04-30 | `audit-20260430-trust-loop.md`                     | Eye, Scales, Metabolism          | D          | FIXED: P1 Disconnected Cognitive Eye, P2 Passive Mode Shifting, P2 Multi-tenant Health Gaps                     |
| 2026-04-30 | `audit-2026-04-30-the-shield.md`                   | Shield                           | C          | FIXED: P1 Fail-open Class C Blast Radius on Concurrent Writes (Anti-Pattern 1)                                  |
| 2026-04-29 | `audit-2026-04-29-perspective-a-v4.md`             | Spine, Brain, Eye                | A          | FIXED: P1 DLQ multi-tenant blindness, P1 missing metrics scope, P2 deployment/traffic telemetry gaps            |
| 2026-04-29 | `audit-2026-04-29-trust-loop-v2.md`                | Scales, Eye, Spine               | D          | FIXED: P1 Missing collab context summary (Anti-Pattern 8), P1 Collab Creation Race Condition (Anti-Pattern 11)  |
| 2026-04-29 | `audit-2026-04-29-identity-metabolism.md`          | Brain, Shield, Metabolism        | C, D       | FIXED: P1 Global telemetry blindness in evolution metrics, P1 Missing workspaceId in Tool ROI.                  |
| 2026-04-29 | `audit-2026-04-29-evolution-cycle-v2.md`           | Hand, Shield, Scales             | B          | FIXED: P1 Blind Tool Failures (JSON/Zod), P1 Adaptive Mode routing bug, P1 Selection Integrity                  |
| 2026-04-29 | `audit-2026-04-29-life-of-a-message-v3.md`         | Spine, Brain, Eye                | A          | FIXED: P1 Telemetry blindness in spine, P1 DLQ multi-tenant leak, P1 Cross-tenant trace leak                    |
| 2026-04-29 | `audit-2026-04-29-recovery-path.md`                | Shield, Spine, Brain             | E          | FIXED: P1 Fail-open CB state, P1 Multi-tenant Session PK gap, P1 Unscoped Distributed Locks                     |
| 2026-04-29 | `audit-2026-04-29-identity-journey-v3.md`          | Shield, Brain                    | C          | FIXED: P1 Fail-open agent selection in collaborations, P2 Orphaned fail-open circuit breaker                    |
| 2026-04-29 | `audit-2026-04-29-metabolism-identity.md`          | Metabolism, Identity             | C, D       | FIXED: P1 Registry partial update, P1 Participant index collision, P1 S3 Reclamation telemetry                  |
| 2026-04-29 | `audit-2026-04-29-evolution-hand.md`               | Hand, Scales                     | B          | FIXED: P1 Blind Security Failures, P1 Blind Execution Crashes, P1 Inconsistent Success Detection                |
| 2026-04-29 | `audit-2026-04-29-message-metabolism.md`           | Eye, Metabolism                  | A          | FIXED: P1 Collaboration race condition, P1 Telemetry blindness, P2 Stale tool pruning gap                       |
| 2026-04-27 | `audit-2026-04-27-evolution-scoping.md`            | Hand, Brain                      | B          | FIXED: P1 Tenant-Blind Config Load, P1 Unscoped Activation Chain                                                |
| 2026-04-27 | `audit-2026-04-27-identity-journey-v2.md`          | Brain, Hand                      | C          | FIXED: P0 Global Identity Leakage, P0 Dashboard Bypass, P0 AST Tool Bypass                                      |
| 2026-04-27 | `audit-2026-04-27-metabolism-evolution.md`         | Metabolism, Evolution            | B, E       | FIXED: P1 Cross-Tenant Evolution, P1 Global S3 Pruning, P2 Scoping Inconsistencies                              |
| 2026-04-27 | `audit-2026-04-27-perspective-a-remediation.md`    | Spine, Brain, Eye                | A          | FIXED: P1 Spine Telemetry Blindness, P1 Fragmented Metrics Partition, P2 Non-GSI Compliance                     |
| 2026-04-27 | `audit-2026-04-27-life-of-a-message-v2.md`         | Spine, Brain, Eye                | A          | FIXED: P1 Missing metrics in non-streaming path, P1 Non-atomic persistence, P2 Multi-tenant regex               |
| 2026-04-27 | `audit-2026-04-27-trust-loop.md`                   | Scales, Eye                      | D          | FIXED: P1 Cognitive metric collisions, P1 Trust history inconsistency, P1 Multi-tenant decay gap                |
| 2026-04-27 | `audit-2026-04-27-perspective-a.md`                | Spine, Eye                       | A          | FIXED: Telemetry Blindness in metrics, Scoping bugs in events, Cognitive data loss                              |
| 2026-04-27 | `audit-2026-04-27-metabolism-recovery.md`          | Metabolism, Recovery             | E          | FIXED: P1 Tool usage count loss, P1 LKG record collision, P2 Config atomicity, P2 Sample task threshold         |
| 2026-04-27 | `audit-2026-04-27-identity-journey.md`             | Brain, Spine, Shield             | C          | FIXED: P1 Identity race condition, P2 Safety bypasses, P2 Adaptive failure                                      |
| 2026-04-26 | `audit-2026-04-26-identity-journey.md`             | Brain, Spine, Shield             | C          | PASSED: Verified Principle 12, 13, 14, 15 across silos.                                                         |
| 2026-04-26 | `audit-2026-04-26-trust-loop.md`                   | Eye, Scales, Spine               | D          | FIXED: Disconnected trust engine, Telemetry data loss                                                           |
| 2026-04-26 | `audit-2026-04-26-evolution-cycle.md`              | Hand, Shield, Scales             | B          | FIXED: Selection Integrity (Sh10), JSON Mode enforcement (Sh9)                                                  |
| 2026-04-26 | `audit-2026-04-26-life-of-a-message.md`            | Spine, Brain, Eye                | A          | FIXED: Fail-Closed rate limiting, Atomic session updates                                                        |

---

## Gap Analysis

### High Priority (Needs Re-Audit)

1. **None at this time.** (Silo 4 vector store was audited and confirmed as a future milestone gap).

### Medium Priority (Rarely Audited)

1. **None at this time.** (Silo 2 Hand tool acquisition cost verified).

---

### High Risk (Most Violations)

1. **All core silos (1-7) have been significantly hardened as of 2026-05-01.** Risk levels have been downgraded based on comprehensive remediation of cross-silo leaks, race conditions, and cognitive safety gaps.

---

## Audit Best Practices for Future Agents

1. **Principle 13/15 First**: Prioritize checking `ConditionExpression` and `ADD` patterns in DynamoDB.
2. **Multi-Tenancy Scoping**: Verify `workspaceId` propagation in all cross-silo events.
3. **Automated Verification**: Always run `pnpm principles` and update the rule list in `scripts/quality/verify-principles.ts` to include new patterns.
4. **Track Recurrence**: Use `ANTI-PATTERNS.md` to prevent regression of fixed P1 issues.

---

## Anti-Patterns Identified

See `docs/governance/ANTI-PATTERNS.md` for recurring issues to avoid.
