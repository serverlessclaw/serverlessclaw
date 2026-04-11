# System Audit & Exploration: A Silo-Based Perspective

> **For Agents**: This is a **thinking framework**, not a checklist. Do not treat silos as tasks to "complete." Each silo is a lens — choose an angle, go deep, follow interesting threads, and report what you find. Creativity and lateral thinking are expected. If a silo leads you to an unexpected weakness in another area, pursue it. The cross-silo perspectives exist precisely because the most interesting failures live at the boundaries.

## Table of Contents

- [How to Use This Document](#how-to-use-this-document)
- [Severity Guide](#severity-guide)
- [🏗️ Deep-Dive Silos](#-deep-dive-silos)
- [🔗 Cross-Silo Perspectives](#-cross-silo-perspectives)
- [🛠️ Verification Strategy](#-verification-strategy)
- [⚙️ Automated Audit Configuration](#-automated-audit-configuration)
- [📖 Glossary](file:///Users/pengcao/projects/serverlessclaw/docs/governance/GLOSSARY.md)

This document establishes a framework for auditing **Serverless Claw** through focused "Silos" and "Cross-Silo Perspectives." Unlike a traditional phased checklist, this approach encourages creative, deep-dive explorations that prioritize architectural spirit, resilience, and evolution over simple file-based verification.

---

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

| Silo  | Name       | Primary Code Focus                                                                                                                                                                                         |
| :---- | :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The Spine  | [routing/AgentRouter.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/routing/AgentRouter.ts), [backbone.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/backbone.ts)                 |
| **2** | The Hand   | [mcp.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/mcp.ts), [executor.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/agent/executor.ts)                                           |
| **3** | The Shield | [safety-engine.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/safety/safety-engine.ts), [circuit-breaker.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/safety/circuit-breaker.ts) |
| **4** | The Brain  | `core/lib/memory/`, `core/lib/rag/`                                                                                                                                                                        |
| **5** | The Eye    | [judge.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/verify/judge.ts), `core/lib/metrics/`                                                                                                    |
| **6** | The Scales | [safety-engine.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/safety/safety-engine.ts) (TrustScore)                                                                                            |
| **7** | The Scythe | [registry/AgentRegistry.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/registry/AgentRegistry.ts) (Pruning/Cleanup)                                                                            |

---

## 🏗️ Deep-Dive Silos

Each silo represents a core functional domain. Reviews within a silo should adopt a specific "Angle" to uncover both explicit bugs and latent architectural weaknesses.

### 1. The Spine (Nervous System & Flow)

**Perspective**: _How does the system ensure the signal never dies?_

- **Angle**: Audit the journey of events through the asynchronous backbone. Look for "dead ends," race conditions in the distributed lock, and the effectiveness of **Conflict Resolution Timeouts** during agent handoffs.
- **Key Concepts**: Event routing, recursion limits, strategic tie-break logic, and adapter normalization (Telegram/GitHub/Jira).

### 2. The Hand (Agency & Skill Mastery)

**Perspective**: _How effectively can the system manipulate its environment?_

- **Angle**: Explore the boundary between agent intent and tool execution. Review the "creative" prompts of personas like `Coder` and `Planner` and the reliability of the "Unified MCP Multiplexer" under heavy load.
- **Key Concepts**: Prompt engineering, skill discovery, tool schema consistency, and MCP resource efficiency.

### 3. The Shield (Survival & Perimeter)

**Perspective**: _What happens when things break or the perimeter is breached?_

- **Angle**: Stress-test the "survival instincts" of the platform. Audit IAM least-privilege policies and the effectiveness of **Proactive Trunk Evolution** for autonomous infrastructure changes.
- **Key Concepts**: Safety guardrails, recovery logic (Dead Man's Switch), Class C blast-radius limits, and real-time security signaling.

### 4. The Brain (Memory, Identity & Continuity)

**Perspective**: _How does the system maintain its "sense of self" and history?_

- **Angle**: Investigate the continuity of context across multi-turn sessions. Audit the multi-tenant Workspace isolation and the efficiency of the **Hybrid Memory Model** (Hot DynamoDB + Semantic Vector Memory) for high-speed recall and strategic reflection.
- **Key Concepts**: Tiered retention (TTL), Vector RAG efficiency, RBAC (Owner/Admin/Collab), and strategic gap identification.

### 5. The Eye (Self-Perception & Truth)

**Perspective**: _Is the system’s view of itself accurate?_

- **Angle**: Audit the feedback loops. Review the Playwright E2E suite and the **LLM-as-a-Judge** semantic evaluation layer to ensure "truth" matches backend state. Evaluate the CI/CD pipelines as the "ultimate truth" of the deployment lifecycle.
- **Key Concepts**: Dashboard tracing accuracy, LLM-as-a-Judge consistency, build-monitor signaling, and autonomous test suite evolution.

### 6. The Scales (Trust & Calibration)

**Perspective**: _Is the system grading its own homework too leniently?_

- **Angle**: Audit the `SafetyEngine` and the LLM-as-a-Judge semantic evaluation layer to ensure `TrustScore` calculations are resistant to artificial inflation (gaming the metrics). Verify that failures accurately and immediately penalize the trust score.
- **Key Concepts**: Trust decay rates, metric gaming, false-positive evaluations, and mode-shift thrashing.

### 7. The Scythe (Bloat & Debt)

**Perspective**: _What can be removed without losing capability?_

- **Angle**: Audit the workspace for generated sprawl. Identify redundant tools, overlapping logic, and "dark" code that is never executed but adds cognitive load to agents. Evaluate if abstraction layers have become too thick and if pattern consolidation is overdue.
- **Key Concepts**: Pattern consolidation, tool pruning (`core/lib/lifecycle/pruning.ts`), cyclomatic complexity reduction, and semantic compression.

---

## 🔗 Cross-Silo Perspectives

These perspectives intentionally span multiple silos to identify integration gaps and emergent system behaviors.

### A. The "Life of a Message" (Spine ↔ Brain ↔ Eye)

Track a single user message from the initial Webhook entry, through memory retrieval and agent reasoning, to the final real-time UI push via MQTT.

### B. The "Evolution Cycle" (Hand ↔ Shield ↔ Eye)

Review the end-to-end flow of self-evolution: from a Strategic Plan to code generation, safety verification, and finally the atomic deployment sync to the trunk.

### C. The "Identity Journey" (Brain ↔ Spine ↔ Shield)

Audit how a user's identity and workspace permissions are propagated and enforced across the entire stack—from API Gateway auth to individual tool execution.

---

## 🛠️ Verification Strategy

Future reviews should utilize a "Probe and Verify" method rather than a simple pass/fail:

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

## 🔍 Investigation Path

- Started at: [File/Component]
- Followed: [Event/Trace]
- Observed: [Behavior]

## 🚨 Findings

| ID  | Title             | Severity | Recommended Action |
| :-- | :---------------- | :------- | :----------------- |
| 1   | Brief description | P1       | Fix X in file Y    |

## 💡 Architectural Reflections

Any high-level notes on debt or potential consolidations.
```

---

## ⚙️ Automated Audit Configuration

The system supports automated audits triggered by code growth thresholds or major events.

### Configuration ([config-defaults.ts](file:///Users/pengcao/projects/serverlessclaw/core/lib/config/config-defaults.ts))

| Config Key                     | Default    | Description                                                                           |
| :----------------------------- | :--------- | :------------------------------------------------------------------------------------ |
| `audit_code_growth_threshold`  | 0.10 (10%) | Code growth percentage that triggers a system audit                                   |
| `audit_event_triggers_enabled` | true       | Enable audit triggers on PRE_FLIGHT_READY, TRUST_SCORE_DROP, and MAJOR_SWARM_COMPLETE |

> [!TIP]
> To adjust thresholds, modify the values in `config-defaults.ts` or provide stage-specific overrides in `infra/config/`.

### Trigger Mechanisms

1. **Code Growth Threshold**: When code growth exceeds 10% (configurable), the Strategic Planner triggers an audit
2. **Event-Based (Shift-Left)**: On `PRE_FLIGHT_READY` (to catch P0s before trunk sync) or `MAJOR_SWARM_COMPLETE` events
3. **Trust-Based**: On `TRUST_SCORE_DROP` (if systemic trust drops > 15% in a single cycle, instantly trigger the Cognition Reflector)
4. **Manual**: Invoke with task "system audit" to the Cognition Reflector

### Agent Responsibilities

| Agent                   | Audit Focus                                        |
| :---------------------- | :------------------------------------------------- |
| **Strategic Planner**   | Code growth tracking, threshold triggers           |
| **Cognition Reflector** | Knowledge gaps, memory consistency, trace analysis |
| **QA Auditor**          | Deployment validation, feature-gap alignment       |
| **Critic**              | Security, performance, architectural debt          |

### Audit Flow

```
Trigger (Code Growth, PRE_FLIGHT_READY, TRUST_SCORE_DROP)
                              ↓
                      Strategic Planner (Orchestrator)
                              ↓
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
           Critic        QA Auditor    Cognition Reflector
      (Security/Perf)   (Deploy/Gaps)   (Memory/Traces)
              ↓               ↓               ↓
              └───────────────┼───────────────┘
                              ↓
                    Compile Audit Report
                              ↓
                [ ToolPruner Analysis ]
                (Suggest Pruning Gaps)
                              ↓
                 P0 Alerts / Block PRE_FLIGHT
```
