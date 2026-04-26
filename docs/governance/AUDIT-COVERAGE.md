# Audit Coverage Matrix

## Overview

This document tracks which system silos and cross-silo perspectives have been audited across all rounds. It helps identify under-audited areas and guide future audit efforts.

Last Updated: 2026-04-26

---

## Silo Coverage Summary

| Silo  | Name           | Primary Focus                                   | Audit Count | Last Audited | Risk Level |
| :---- | :------------- | :---------------------------------------------- | :---------: | :----------- | :--------- |
| **1** | The Spine      | `core/lib/routing/`, `core/lib/backbone.ts`     |     16+     | 2026-04-26   | Low        |
| **2** | The Hand       | `core/lib/mcp.ts`, `core/lib/agent/executor.ts` |      8      | 2026-04-26   | Low        |
| **3** | The Shield     | `core/lib/safety/safety-engine.ts`              |     15+     | 2026-04-26   | Medium     |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`             |     11      | 2026-04-26   | Medium     |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/`         |     11      | 2026-04-26   | Low        |
| **6** | The Scales     | `core/lib/safety/trust-manager.ts`              |     12      | 2026-04-26   | Low        |
| **7** | The Metabolism | `core/lib/maintenance/metabolism.ts`            |      2      | 2026-04-15   | Low        |

---

## Cross-Silo Perspectives (A-E) Coverage

| Perspective | Name              | Description            | Usage Count | Last Tested |
| :---------- | :---------------- | :--------------------- | :---------- | :---------- |
| **A**       | Life of a Message | Spine → Brain → Eye    | 4           | 2026-04-26  |
| **B**       | Evolution Cycle   | Hand → Shield → Scales | 5           | 2026-04-26  |
| **C**       | Identity Journey  | Brain → Spine → Shield | 4           | 2026-04-26  |
| **D**       | Trust Loop        | Eye → Scales → Spine   | 5           | 2026-04-26  |
| **E**       | Recovery Path     | Shield → Spine → Brain | 5           | 2026-04-26  |

---

## Audit Reports History

| Date       | Report                                        | Silos Covered         | Cross-Silo | Key Findings                                                   |
| :--------- | :-------------------------------------------- | :-------------------- | :--------- | :------------------------------------------------------------- |
| 2026-04-26 | `audit-2026-04-26-trust-loop.md`              | Eye, Scales, Spine    | D          | FIXED: Disconnected trust engine, Telemetry data loss          |
| 2026-04-26 | `audit-2026-04-26-evolution-cycle.md`         | Hand, Shield, Scales  | B          | FIXED: Selection Integrity (Sh10), JSON Mode enforcement (Sh9) |
| 2026-04-26 | `audit-2026-04-26-life-of-a-message.md`       | Spine, Brain, Eye     | A          | FIXED: Fail-Closed rate limiting, Atomic session updates       |
| 2026-04-26 | `audit-2026-04-26-identity-journey.md`        | Brain, Spine, Shield  | C          | FIXED: RBAC Bypass (Missing userRole), System Whitelist fix    |
| 2026-04-26 | `audit-2026-04-26-recovery-path.md`           | Shield, Spine, Brain  | E          | FIXED: Warmup feedback loop, Brain notification on success     |
| 2026-04-25 | `audit-2026-04-25-perspective-a.md`           | Spine, Brain, Eye     | A          | FIXED: Systematic tenant context threading, Stable hash dedup  |
| 2026-04-25 | `audit-2026-04-25-evolution-cycle.md`         | Hand, Shield, Scales  | B          | FIXED: Proactive "God Mode" bypass (P0 Security)               |
| 2026-04-25 | `audit-2026-04-25-recovery-path.md`           | Shield, Spine, Brain  | E          | P1 Double trigger prevention, Multiplexer selection integrity  |
| 2026-04-25 | `audit-2026-04-25-trust-loop-scales.md`       | Eye, Scales, Spine    | D          | P1 Cognitive metrics isolation, TrustScore fail-closed         |
| 2026-04-24 | `audit-2026-04-24-mcp-isolation.md`           | Hand, Shield          | B, C       | P0 Global tool cache leak, Global client map leak              |
| 2026-04-24 | `audit-2026-04-24-recovery-path.md`           | Shield, Spine, Brain  | E          | P0 Global trace coherence scan, Global circuit breaker         |
| 2026-04-24 | `audit-2026-04-24-trust-loop.md`              | Eye, Scales, Spine    | D          | P1 Global agent metrics leak, Non-scoped persistence           |
| 2026-04-24 | `audit-2026-04-24-evolution-cycle.md`         | Hand, Shield, Scales  | B          | P0 Global safety policies, Broken trust feedback               |
| 2026-04-24 | `audit-2026-04-24-identity-journey.md`        | Brain, Spine, Shield  | C          | P0 Unauthenticated webhooks, Missing agent perms               |
| 2026-04-23 | `audit-2026-04-23-trust-loop.md`              | Scales, Spine         | D          | FIXED: Multi-tenant leaks in TrustManager, AgentRouter         |
| 2026-04-23 | `AUDIT-2026-04-23-HAND-EVOLUTION-IDENTITY.md` | Hand                  | B, C       | FIXED: Truncated Class C list, Broken evolution loop           |
| 2026-04-23 | `audit-2026-04-23-multi-tenant-integrity.md`  | Brain, Scales         | A, D       | P0 Knowledge leakage, Broken trust loop isolation              |
| 2026-04-22 | `audit-2026-04-22-evolution-recovery.md`      | Shield                | E          | Dropped tool context, IDOR on approval                         |
| 2026-04-20 | `audit-2026-04-20-system-integrity.md`        | Spine, Shield, Scales | C, D, E    | Broken multi-tenancy, Dead trust loop, Ghost fix               |
| 2026-04-16 | `audit-2026-04-16-shield-scales.md`           | Shield, Scales        | B          | Double-execution of Class C actions                            |
| 2026-04-16 | `audit-2026-04-16-the-spine.md`               | The Spine             | -          | Fail-open rate limiting, missing handlers                      |
| 2026-04-17 | `security-audit-report.md`                    | Dependencies          | N/A        | 8 dependency vulnerabilities                                   |

---

## Principle Enforcement Status

| Principle | Name                   | Automated Check | Manual Only | Violation Count (30d) |
| :-------- | :--------------------- | :-------------: | :---------- | :-------------------- |
| **13**    | Atomic State Integrity |       ✅        | ✅          | 6                     |
| **14**    | Selection Integrity    |       ✅        | ✅          | 3                     |
| **15**    | Monotonic Progress     |       ✅        | ✅          | 2                     |
| **9**     | Trust-Driven Mode      |       ❌        | ✅          | 1                     |
| **10**    | Lean Evolution         |       ❌        | ✅          | 1                     |

---

## Gap Analysis

### High Priority (Needs Re-Audit)

1. **The Metabolism** (Silo 7) - Only 2 audits, needs verification of pruning logic and resource reclamation.

### Medium Priority (Rarely Audited)

1. **Perspective A: Life of a Message** - Needs verification of full-stack observability with the new unified metrics partition.

### High Risk (Most Violations)

1. **All core silos (1-6) have been significantly hardened on 2026-04-26.** Risk levels have been downgraded based on comprehensive remediation of cross-silo leaks and race conditions.

---

## Recommendations

1. **Mandatory Cross-Silo**: Every audit MUST verify at least ONE cross-silo perspective
2. **Focus on Silo 7**: This is now the least-tested area.
3. **Add Automated Checks**: Expand Principle 15 check to include DynamoDB `ADD` pattern.
4. **Track Recurrence**: Use `ANTI-PATTERNS.md` to prevent regression of fixed P1 issues.

---

## Anti-Patterns Identified

See `docs/governance/ANTI-PATTERNS.md` for recurring issues to avoid.
