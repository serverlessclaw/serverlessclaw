# Audit Coverage Matrix

## Overview

This document tracks which system silos and cross-silo perspectives have been audited across all rounds. It helps identify under-audited areas and guide future audit efforts.

Last Updated: 2026-04-17

---

## Silo Coverage Summary

| Silo  | Name           | Primary Focus                                   | Audit Count | Last Audited | Risk Level |
| :---- | :------------- | :---------------------------------------------- | :---------: | :----------- | :--------- |
| **1** | The Spine      | `core/lib/routing/`, `core/lib/backbone.ts`     |     6+      | 2026-04-16   | Medium     |
| **2** | The Hand       | `core/lib/mcp.ts`, `core/lib/agent/executor.ts` |      2      | 2026-04-06   | Medium     |
| **3** | The Shield     | `core/lib/safety/safety-engine.ts`              |     4+      | 2026-04-16   | High       |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`             |      2      | 2026-04-06   | Medium     |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/`         |      3      | 2026-04-15   | Medium     |
| **6** | The Scales     | `core/lib/safety/trust-manager.ts`              |      2      | 2026-04-16   | High       |
| **7** | The Metabolism | `core/lib/maintenance/metabolism.ts`            |      2      | 2026-04-15   | Low        |

---

## Cross-Silo Perspectives (A-E) Coverage

| Perspective | Name              | Description            | Usage Count | Last Tested |
| :---------- | :---------------- | :--------------------- | :---------- | :---------- |
| **A**       | Life of a Message | Spine → Brain → Eye    | 1           | 2026-04-16  |
| **B**       | Evolution Cycle   | Hand → Shield → Scales | 1           | 2026-04-16  |
| **C**       | Identity Journey  | Brain → Spine → Shield | 1           | 2026-04-20  |
| **D**       | Trust Loop        | Eye → Scales → Spine   | 1           | 2026-04-20  |
| **E**       | Recovery Path     | Shield → Spine → Brain | 1           | 2026-04-20  |

---

## Audit Reports History

| Date       | Report                              | Silos Covered           | Cross-Silo      | Key Findings                                      |
| :--------- | :---------------------------------- | :---------------------- | :-------------- | :------------------------------------------------ |
| 2026-04-20 | `audit-2026-04-20-system-integrity.md` | Spine, Shield, Scales | C, D, E         | Broken multi-tenancy, Dead trust loop, Ghost fix  |
| 2026-04-16 | `audit-2026-04-16-shield-scales.md` | Shield, Scales          | Evolution Cycle | Double-execution of Class C actions               |
| 2026-04-16 | `audit-2026-04-16-the-spine.md`     | The Spine               | -               | Fail-open rate limiting, missing handlers         |
| 2026-04-17 | `security-audit-report.md`          | Dependencies            | N/A             | 8 dependency vulnerabilities                      |

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
2. **The Brain** (Silo 4) - Only 2 audits, needs RAG integrity check.
3. **The Scales** (Silo 6) - Significant findings in recent audits (Dead Loop, Contamination).

### Medium Priority (Rarely Audited)

1. **Perspective A: Life of a Message** - Only 1 audit.
2. **Perspective B: Evolution Cycle** - Only 1 audit.

### High Risk (Most Violations)

1. **The Shield** (Silo 3) - Safety violations, identity leakage, global rate limits.
2. **The Spine** (Silo 1) - Identity context dropping in delegation.
3. **The Scales** (Silo 6) - Race conditions, trust drift, disconnected routing.

---

## Recommendations

1. **Mandatory Cross-Silo**: Every audit MUST verify at least ONE cross-silo perspective
2. **Focus on C, D, E**: These have never been tested - prioritize in next round
3. **Add Automated Checks**: Principles 13, 14, 15 should be verified automatically
4. **Track Recurrence**: Add "related issues" field to find patterns

---

## Anti-Patterns Identified

See `docs/governance/ANTI-PATTERNS.md` for recurring issues to avoid.
