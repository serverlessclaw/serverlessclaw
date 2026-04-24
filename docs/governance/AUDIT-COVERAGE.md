# Audit Coverage Matrix

## Overview

This document tracks which system silos and cross-silo perspectives have been audited across all rounds. It helps identify under-audited areas and guide future audit efforts.

Last Updated: 2026-04-24

---

## Silo Coverage Summary

| Silo  | Name           | Primary Focus                                   | Audit Count | Last Audited | Risk Level |
| :---- | :------------- | :---------------------------------------------- | :---------: | :----------- | :--------- |
| **1** | The Spine      | `core/lib/routing/`, `core/lib/backbone.ts`     |     8+      | 2026-04-24   | Medium     |
| **2** | The Hand       | `core/lib/mcp.ts`, `core/lib/agent/executor.ts` |      4      | 2026-04-24   | Medium     |
| **3** | The Shield     | `core/lib/safety/safety-engine.ts`              |     7+      | 2026-04-24   | High       |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`             |      4      | 2026-04-24   | Medium     |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/`         |      4      | 2026-04-24   | Medium     |
| **6** | The Scales     | `core/lib/safety/trust-manager.ts`              |      5      | 2026-04-24   | High       |
| **7** | The Metabolism | `core/lib/maintenance/metabolism.ts`            |      2      | 2026-04-15   | Low        |

---

## Cross-Silo Perspectives (A-E) Coverage

| Perspective | Name              | Description            | Usage Count | Last Tested |
| :---------- | :---------------- | :--------------------- | :---------- | :---------- |
| **A**       | Life of a Message | Spine → Brain → Eye    | 2           | 2026-04-23  |
| **B**       | Evolution Cycle   | Hand → Shield → Scales | 3           | 2026-04-24  |
| **C**       | Identity Journey  | Brain → Spine → Shield | 3           | 2026-04-24  |
| **D**       | Trust Loop        | Eye → Scales → Spine   | 3           | 2026-04-24  |
| **E**       | Recovery Path     | Shield → Spine → Brain | 2           | 2026-04-22  |

---

## Audit Reports History

| Date       | Report                                        | Silos Covered         | Cross-Silo      | Key Findings                                           |
| :--------- | :-------------------------------------------- | :-------------------- | :-------------- | :----------------------------------------------------- |
| 2026-04-24 | `audit-2026-04-24-trust-loop.md`              | Eye, Scales, Spine    | D               | P1 Global agent metrics leak, Non-scoped persistence   |
| 2026-04-24 | `audit-2026-04-24-evolution-cycle.md`        | Hand, Shield, Scales  | B               | P0 Global safety policies, Broken trust feedback       |
| 2026-04-24 | `audit-2026-04-24-identity-journey.md`        | Brain, Spine, Shield  | C               | P0 Unauthenticated webhooks, Missing agent perms       |
| 2026-04-23 | `audit-2026-04-23-trust-loop.md`              | Scales, Spine         | D               | FIXED: Multi-tenant leaks in TrustManager, AgentRouter |
| 2026-04-23 | `AUDIT-2026-04-23-HAND-EVOLUTION-IDENTITY.md` | Hand                  | B, C            | FIXED: Truncated Class C list, Broken evolution loop   |
| 2026-04-23 | `audit-2026-04-23-multi-tenant-integrity.md`  | Brain, Scales         | A, D            | P0 Knowledge leakage, Broken trust loop isolation      |
| 2026-04-22 | `audit-2026-04-22-evolution-recovery.md`      | Shield                | E               | Dropped tool context, IDOR on approval                 |
| 2026-04-20 | `audit-2026-04-20-system-integrity.md`        | Spine, Shield, Scales | C, D, E         | Broken multi-tenancy, Dead trust loop, Ghost fix       |
| 2026-04-16 | `audit-2026-04-16-shield-scales.md`           | Shield, Scales        | Evolution Cycle | Double-execution of Class C actions                    |
| 2026-04-16 | `audit-2026-04-16-the-spine.md`               | The Spine             | -               | Fail-open rate limiting, missing handlers              |
| 2026-04-17 | `security-audit-report.md`                    | Dependencies          | N/A             | 8 dependency vulnerabilities                           |

---

## Principle Enforcement Status

| Principle | Name                   | Automated Check | Manual Only | Violation Count (30d) |
| :-------- | :--------------------- | :-------------: | :---------- | :-------------------- |
| **13**    | Atomic State Integrity |       ❌        | ✅          | 4                     |
| **14**    | Selection Integrity    |       ✅        | ✅          | 2                     |
| **15**    | Monotonic Progress     |       ❌        | ✅          | 2                     |
| **9**     | Trust-Driven Mode      |       ❌        | ✅          | 1                     |
| **10**    | Lean Evolution         |       ❌        | ✅          | 1                     |

---

## Gap Analysis

### High Priority (Needs Re-Audit)

1. **The Hand** (Silo 2) - Only 2 audits, needs Hand -> Brain validation.
2. **Perspective B: Evolution Cycle** - Only 1 audit, needs verification of Hand -> Shield -> Scales loop.

### Medium Priority (Rarely Audited)

1. **The Eye** (Silo 5) - Last audited 8 days ago, needs validation of metric aggregation integrity.
2. **Perspective C: Identity Journey** - Only 1 audit, needs deeper trace analysis.

### High Risk (Most Violations)

1. **The Brain** (Silo 4) - Fixed P0 isolation leaks in this round. Needs monitoring to ensure no regression.
2. **The Scales** (Silo 6) - Reputation and metrics were found to be global. Fixed in this round but needs scale testing.
3. **The Shield** (Silo 3) - Recurring issues with dropped context and IDOR (Fixed 2026-04-22).

---

## Recommendations

1. **Mandatory Cross-Silo**: Every audit MUST verify at least ONE cross-silo perspective
2. **Focus on C, D, E**: These have never been tested - prioritize in next round
3. **Add Automated Checks**: Principles 13, 14, 15 should be verified automatically
4. **Track Recurrence**: Add "related issues" field to find patterns

---

## Anti-Patterns Identified

See `docs/governance/ANTI-PATTERNS.md` for recurring issues to avoid.
