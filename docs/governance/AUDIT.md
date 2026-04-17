# System Audit & Exploration: A Silo-Based Perspective

> **For Agents**: This is a **thinking framework**, not a checklist. Do not treat silos as tasks to "complete." Each silo is a lens — choose an angle, go deep, follow interesting threads, and report what you find. Creativity and lateral thinking are expected. If a silo leads you to an unexpected weakness in another area, pursue it. The cross-silo perspectives exist precisely because the most interesting failures live at the boundaries.

## Table of Contents

- [Finding Type Taxonomy](#finding-type-taxonomy)
- [How to Use This Document](#how-to-use-this-document)
- [Audit Angle Selection](#audit-angle-selection)
- [Severity Guide](#severity-guide)
- [🏗️ Deep-Dive Silos](#-deep-dive-silos)
- [🔗 Cross-Silo Perspectives](#-cross-silo-perspectives)
- [🛠️ Verification Strategy](#-verification-strategy)
- [📝 Documenting Your Findings](#-documenting-your-findings)
- [📖 Glossary](../../docs/governance/GLOSSARY.md)

This document establishes a framework for auditing **Serverless Claw** through focused "Silos" and "Cross-Silo Perspectives." Unlike a traditional phased checklist, this approach encourages creative, deep-dive explorations that prioritize architectural spirit, resilience, and evolution over simple file-based verification.

---

## Finding Type Taxonomy

Every audit finding falls into one of four categories. Classifying findings correctly ensures appropriate prioritization and response.

### 🐛 Bugs (Functional Failures)

**Definition**: Something that works incorrectly, produces wrong results, or fails to meet documented behavior.

**Characteristics**:

- Functions that produce incorrect output
- Error handling that silently fails or produces misleading errors
- Race conditions that cause data corruption
- Missing validation that allows invalid state
- Logic errors that produce opposite behavior

**Examples**:

- Authentication bypass due to missing scope validation
- Sort order reversed in memory retrieval
- Lock not released on timeout causing deadlock
- Exception swallowed hiding real error

**Audit Approach**: Compare actual behavior against documented requirements. Trace code paths through happy and error cases.

### gaps (Missing Functionality)

**Definition**: Something that should exist but doesn't—intentional or unintentional omissions that limit system capability.

**Characteristics**:

- Missing error handling for expected conditions
- Features described in docs but not implemented
- Edge cases with no handling strategy
- Missing logging for critical operations
- Incomplete feature flags

**Examples**:

- No retry logic for transient failures
- Missing rate limiting on new endpoints
- No TTL on growing data structures
- Unhandled webhook event types

**Audit Approach**: Review expected behavior from docs, user requests, and system requirements. Compare against actual implementation.

### ⚡ Inconsistencies (State Drift)

**Definition**: Contradictions between components, expected vs actual behavior, or drifted state that should be synchronized.

**Characteristics**:

- Configuration not applied uniformly
- Metrics that don't add up
- Cache vs database state divergence
- UI displaying different data than backend
- Duplicate or conflicting logic in multiple places

**Examples**:

- Trust score calculation differs from display
- Backend returns different response than API contract
- Cached stale data beyond TTL
- Two implementations of same feature diverge

**Audit Approach**: Trace data through multiple components. Compare state at different points in the flow.

### 🛠️ Refactor Opportunities (Technical Debt)

**Definition**: Code that works but could be improved—patterns that create maintenance burden, duplication, or future fragility.

**Characteristics**:

- Repeated patterns that could be extracted
- Magic values that should be configuration
- Functions doing too many things
- Missing abstractions creating fragility
- Optimizations that hurt readability

**Examples**:

- Same validation logic copied in multiple handlers
- Hardcoded time windows instead of constants
- Functions 500+ lines without decomposition
- Tight coupling preventing extension
- Missing interfaces for testability

**Audit Approach**: Look for "code smells" and violation of design principles. Evaluate maintenance burden vs complexity.

## How to Use This Document

### What This Is

- A set of **provocations** to guide your exploration
- A way to discover **latent weaknesses** that tests won't catch
- An invitation to **question assumptions** baked into the architecture
- A framework for **cross-disciplinary thinking** — the best findings live between silos

### What This Is Not

- A pass/fail checklist
- A list of files to read
- Something you "complete" and move on from
- A substitute for running `make check` and `make test`

### Recommended Approach

1. **Pick one silo** that matches your current context or curiosity
2. **Adopt the perspective** — literally think from that angle
3. **Follow the evidence** — if you find something interesting, chase it even if it leads outside the silo
4. **Document findings** in `reports/audit-<YYYY-MM-DD>-<topic>.md` with:
   - What you looked at
   - What you expected to find
   - What you actually found
   - Severity assessment (P0/P1/P2/P3)
   - Recommended action or further investigation

> [!IMPORTANT]
> **Every audit MUST verify at least ONE Cross-Silo Perspective** (A-E). Siloed audits miss integration bugs. See [Audit Coverage Matrix](AUDIT-COVERAGE.md) for which perspectives have been tested.
>
> **Track Pattern Recurrence**: When documenting findings, include `related_issues` field to link to past similar issues. See [Anti-Patterns](ANTI-PATTERNS.md) for known recurring issues to watch for.

---

## Audit Angle Selection

An "angle" is your investigative lens. Choosing the right angle determines what you find.

### How to Choose Your Angle

**Start with context**:

- Recent incidents or failures suggest investigating related silos
- New features should be audited for completeness (gap analysis)
- Performance issues point to the Eye or Spine
- User reports of inconsistency point to cross-silo investigation

**Look for asymmetry**:

- Fast paths vs slow paths may reveal optimization opportunities
- Happy paths vs error paths often have different quality
- Admin vs user surfaces may have privilege escalation
- Test vs production behavior often diverges

**Follow dependencies**:

- External API changes may break assumptions
- Library upgrades may introduce regressions
- Config changes may invalidate workarounds
- New integrations may have unmodeled interactions

### Good Investigation Paths

A good path is:

- **Observable**: You can verify the finding exists
- **Specific**: You can trace to a component or line
- **Actionable**: Someone can fix it

A poor path is:

- Too vague to verify ("the code looks messy")
- Cannot be traced to anything concrete
- No clear owner or fix approach

### When to Pivot

- If your angle yields nothing after 30 minutes, try a different silo
- If you find something surprising, chase it—even outside the current silo
- If two silos both have issues, the interaction is likely the real problem

### Severity Guide

| Level  | Meaning                                                     | Response                       | Example Scenario                                                        |
| ------ | ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| **P0** | Active data loss, security breach, or system compromise     | Fix immediately, block deploys | IAM policy allowing unauthorized access to secret keys.                 |
| **P1** | Reliability issue that will cause failures under load       | Fix in current sprint          | Race condition in the distributed lock manager under concurrent writes. |
| **P2** | Architectural debt that will cause problems as system grows | Plan and schedule              | Missing TTL or indexing strategy for a high-growth telemetry table.     |
| **P3** | Observation or improvement idea                             | Track for future consideration | Suggesting a more efficient prompt structure for the Coder agent.       |

---

## 🗺️ Silo-to-Code Quick Reference

Use this table to map high-level silos to the primary code areas that should be investigated.

| Silo  | Name           | Primary Code Focus                              | Implementation Vertical                   |
| :---- | :------------- | :---------------------------------------------- | :---------------------------------------- |
| **1** | The Spine      | `core/lib/routing/`, `core/lib/backbone.ts`     | [EVENTS.md](../interface/EVENTS.md)       |
| **2** | The Hand       | `core/lib/mcp.ts`, `core/lib/agent/executor.ts` | [PROTOCOL.md](../interface/PROTOCOL.md)   |
| **3** | The Shield     | `core/lib/safety/safety-engine.ts`              | [RESILIENCE.md](../system/RESILIENCE.md)  |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`             | [MEMORY.md](../intelligence/MEMORY.md)    |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/`         | [DASHBOARD.md](../interface/DASHBOARD.md) |
| **6** | The Scales     | `core/lib/safety/trust-manager.ts`              | [SAFETY.md](../intelligence/SAFETY.md)    |
| **7** | The Metabolism | `core/lib/maintenance/metabolism.ts`            | [METABOLISM.md](../system/METABOLISM.md)  |

---

## 🏗️ Deep-Dive Silos

Each silo represents a core functional domain. Reviews within a silo should adopt a specific "Angle" to uncover both explicit bugs and latent architectural weaknesses.

### 1. The Spine (Nervous System & Flow)

**Perspective**: _How does the system ensure the signal never dies?_

- **Angle**: Audit the journey of events through the asynchronous backbone. Look for "dead ends," race conditions in the distributed lock, and the effectiveness of **Conflict Resolution Timeouts** during agent handoffs.
- **Baseline**: Hardened April 2026. DistributedState utilizes atomic conditional updates for circuit breakers and fail-closed rate limiting. AgentRouter enforces explicit selection integrity.

### 2. The Hand (Agency & Skill Mastery)

**Perspective**: _How effectively can the system manipulate its environment?_

- **Angle**: Explore the boundary between agent intent and tool execution. Review the "creative" prompts of personas like `Coder` and `Planner`.

### 3. The Shield (Security & Baseline)

The Shield acts as the authoritative gate for all tool executions, enforcing least-privilege resource access and Class C blast-radius limits.

- **Angle**: Audit the safety engine for least-privilege enforcement and blast-radius limits. Look for ways to bypass the "Shield Gate" or gaps in resource-level validation.

### 4. The Brain (Memory, Identity & Continuity)

**Perspective**: _How does the system maintain its "sense of self" and history?_

- **Angle**: Audit the memory system for tenant isolation and data consistency. Look for race conditions in metadata updates or leaks across workspace boundaries.

### 5. The Eye (Observation & Consistency)

**Perspective**: _Does the system's internal trace state match what is reported to the user?_

- **Angle**: Contrast the system's internal telemetry with its outward reporting. Look for "telemetry blindness" or drift between metrics, logs, and user-facing dashboards.

### 6. The Scales (Trust & Calibration)

**Perspective**: _Is the system accurately penalizing failure and rewarding success?_

- **Angle**: Evaluate the system's ability to accurately reward performance and penalize failure. Look for oscillations in trust scores or bypasses in reputation-weighted logic.

### 7. The Metabolism (Regenerative Repair & Bloat Management)

**Perspective**: _Is the system capable of autonomously healing its own debt and recycling waste?_

- **Angle**: Audit the system through the lens of **Regenerative Metabolism**. Unlike passive audits, Silo 7 operates on the "Perform while Auditing" philosophy — identifying metabolic waste (dead overrides, memory bloat) and executing repairs in real-time.
- **Angle**: Audit the system through the lens of **Regenerative Metabolism**. Look for metabolic waste (dead overrides, memory bloat) and evaluate the system's ability to autonomously heal its own debt.

---

## 🔗 Cross-Silo Perspectives

These perspectives intentionally span multiple silos to identify integration gaps and emergent system behaviors. Cross-silo findings often represent the most critical architectural issues because they reveal broken contracts between components.

### A. The "Life of a Message" (Spine ↔ Brain ↔ Eye)

**Objective**: Verify end-to-end message flow integrity from receipt to response.

### B. The "Evolution Cycle" (Hand ↔ Shield ↔ Scales)

**Objective**: Verify autonomous evolution maintains safety and trust integrity.

### C. The "Identity Journey" (Brain ↔ Spine ↔ Shield)

**Objective**: Verify identity and permissions propagate correctly across all surfaces.

### D. The "Trust Loop" (Eye ↔ Scales ↔ Spine)

**Objective**: Verify the feedback loop from observation through trust to action.

### E. The "Recovery Path" (Shield ↔ Spine ↔ Brain)

**Objective**: Verify system recovery maintains consistency.

---

## 🛠️ Verification Strategy

Future reviews should utilize a "Probe and Verify" method rather than a simple pass/fail:

### Core Probes

- **Static Probes**: `make check` for structural health (Linting/Types).
- **Dynamic Probes**: `make test` and `npx vitest` for behavioral health (Unit/Integration).
- **Holistic Probes**: `npx playwright test` to verify the user-facing reality (E2E).
- **Observational Probes**: Reviewing `Trace Intelligence` in the dashboard or via `TOOLS.inspectTrace` to visualize the "creative" paths taken during complex tasks.

---

## 📝 Documenting Your Findings

Use the following template when creating reporting artifacts in the `reports/` directory.

```markdown
# Audit Report: [Topic/Silo] - [YYYY-MM-DD]

## 🎯 Objective

Brief description of what you were looking for.

## 🎯 Finding Type

Specify the primary finding type (see [Finding Type Taxonomy](#finding-type-taxonomy)):

- Bug / Gap / Inconsistency / Refactor

## 🔍 Investigation Path

- Started at: [File/Component]
- Followed: [Event/Trace]
- Observed: [Behavior]

## 🚨 Findings

| ID  | Title             | Type | Severity | Location   | Recommended Action |
| :-- | :---------------- | :--- | :------- | :--------- | :----------------- |
| 1   | Brief description | Bug  | P1       | file.ts:42 | Fix X in file Y    |

## 💡 Architectural Reflections

Any high-level notes on debt or potential consolidations.
```
