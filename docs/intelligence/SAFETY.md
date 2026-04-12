# Safety Guardrails & Policy Enforcement

> **Navigation**: [← Index Hub](../../INDEX.md)

This document defines the safety boundaries and policy enforcement mechanisms that prevent autonomous agents from performing high-risk actions without oversight.

## 🛡️ Guardrail Overview

The system employs a multi-layered safety architecture:

| Guardrail              | Where Implemented           | Trigger                                                        |
| :--------------------- | :-------------------------- | :------------------------------------------------------------- |
| **Resource Labeling**  | `core/tools`                | Any write to a protected file (e.g., `.git`, `sst.config.ts`). |
| **Safety Engine**      | `core/lib/safety-engine.ts` | Multi-dimensional policy enforcement (Tiers, Rates, Time).     |
| **Recursion Guard**    | `core/handlers/events.ts`   | Prevents infinite loops (Depth > 15).                          |
| **Human-in-the-Loop**  | `AgentExecutor`             | Pauses execution for sensitive tools (e.g., `deleteDatabase`). |
| **Context Compaction** | `core/lib/context.ts`       | Prevents context overflow during long autonomous missions.     |

---

## 🚦 Granular Safety Tiers

Agents operate under different trust levels, defining which actions require explicit human approval. Serverless Claw uses a trunk-based development model with two primary tiers:

| Tier        | Description                           |    Deployments    |  Shell Commands   |     MCP Tools     |
| :---------- | :------------------------------------ | :---------------: | :---------------: | :---------------: |
| **`local`** | Local development/testing environment |   Auto-Approved   |   Auto-Approved   |   Auto-Approved   |
| **`prod`**  | Production environment (default)      | Approval Required | Approval Required | Approval Required |

> [!NOTE]
> The default tier is `prod` to ensure all production changes undergo human review. The `local` tier is used for development and testing where autonomous execution is safe.

### Tier Selection

- **LOCAL**: Used for development, testing, and CI/CD pipelines
- **PROD**: Used for production deployments and user-facing interactions

The safety tier is configured per agent in `core/lib/backbone.ts` via the `safetyTier` property.

---

## 🧠 Deep Cognitive Health

The system monitors its own "state of mind" to detect degradation or hallucination trends.

- **Completion Rate**: Tracks the ratio of successful vs. failed missions.
- **Reasoning Coherence**: Agents score each other's reasoning quality.
- **Anomaly Detection**: Triggers alerts if the failure rate spikes or token efficiency drops. Thresholds for loops, latency, and frequency are **dynamically resolved** based on the agent's `SafetyTier` (LOCAL vs. PROD) via the `SafetyConfigManager`.

---

## 🖇️ Resource Protection

Writes to the following resources are blocked by default and require **Manual Approval**:

- `sst.config.ts` (Stack definition)
- `infra/**` (Infrastructure resources)
- `core/tools/index.ts` (Safety gate implementation)
- `.git/**` (Version control)

---

## 🔄 Proactive Evolution (Class C Actions)

Highly sensitive changes, such as IAM modifications or memory retention policy shifts, are classified as **Class C**. These are never executed immediately but are scheduled with a **1-hour cooling period** for manual audit.

---

## 📡 Related Documentation

- **[RESILIENCE.md](../system/RESILIENCE.md)**: Dead Man's Switch, Self-healing, and persistent Circuit Breakers.
- **[SWARM.md](./SWARM.md)**: Recursive task safety and depth limits.
- **[STANDARDS.md](../governance/STANDARDS.md)**: Quality gates and audit standards.
