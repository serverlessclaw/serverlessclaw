# Safety Guardrails & Policy Enforcement

> **Navigation**: [← Index Hub](../../INDEX.md)

This document defines the safety boundaries and policy enforcement mechanisms that prevent autonomous agents from performing high-risk actions without oversight.

## 🛡️ Guardrail Overview

The system employs a multi-layered safety architecture:

| Guardrail              | Where Implemented           | Trigger                                                        |
| :--------------------- | :-------------------------- | :------------------------------------------------------------- |
| **Resource Labeling**  | `core/tools`                | Any write to a protected file (e.g., `.git`, `sst.config.ts`). |
| **Safety Engine**      | `core/lib/safety-engine.ts` | Multi-dimensional policy enforcement (Tiers, Rates, Time).     |
| **Budget Enforcer**    | `core/lib/agent/executor`   | Token and cost limits exceeded (80% warning / 100% stop).      |
| **Recursion Guard**    | `core/handlers/events.ts`   | Prevents infinite loops (Depth > 15).                          |
| **Human-in-the-Loop**  | `AgentExecutor`             | Pauses execution for sensitive tools (e.g., `deleteDatabase`). |
| **Context Compaction** | `core/lib/context.ts`       | Prevents context overflow during long autonomous missions.     |

---

## ⚖️ Agent Trust & Calibration

The Scales silo ensures that the system accurately rewards success and penalizes failure through semantic evaluation.

### 1. LLM-as-a-Judge

The system uses a high-trust persona (the Judge) to semantically evaluate agent outputs based on quality, accuracy, and security adherence.

- **Scoring**: A numerical quality score (0-10) is assigned to each completed task, which weights the subsequent trust bump.

### 2. Trust Calibration Loop

Trust scores are dynamically updated via the **Atomic Field Pattern** in DynamoDB to prevent race conditions:

- **Success Bumps**: Weighted by the Judge's quality score.
- **Failure Penalties**: SLO breaches, QA failures, or anomalies detected result in immediate trust decay.
- **Anomaly Feedback**: Batched anomalies from the `DegradationDetector` are processed into trust penalties.

### 3. Quality-Weighted Trust Formulas

The system applies a non-linear scaling to trust adjustments based on task quality (0-10):

#### Failure Penalty (Decay)

Multiplies the base penalty by a weight in the range **[0.5x, 1.5x]**:

- **Quality 0**: 1.5x penalty (Major failure)
- **Quality 10**: 0.5x penalty (Minor/Expected edge case)
- `multiplier = Math.min(1.5, Math.max(0.5, (10 - qualityScore) / 5 + 0.5))`

#### Success Bump (Growth)

Multiplies the base bump by a weight in the range **[0.0x, 2.0x]**:

- **Quality 0**: 0.0x bump (Low value)
- **Quality 5**: 1.0x bump (Standard)
- **Quality 10**: 2.0x bump (Exceptional)
- `multiplier = Math.min(2, Math.max(0, qualityScore * 0.2))`

---

## 🚦 Binary Safety Tiers

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

Highly sensitive changes, such as IAM modifications or memory retention policy shifts, are classified as **Class C**. By default, these are never executed immediately but are scheduled with a **1-hour cooling period** for manual audit.

**Exception (Principle 9):** If an agent has earned a `TrustScore >= 95` and is operating in `AUTO` mode, the system autonomously promotes the Class C action. In this scenario, the action executes immediately and the 1-hour HITL scheduling queue is bypassed.

---

## 📦 Storage & Retention (Stateless Core)

To ensure high-performance auditability without polluting persistent configuration state, all safety telemetry is persisted in the **MemoryTable** with Time-to-Live (TTL) policies:

| Data Type                  | Prefix                                   | TTL         | Purpose                                            |
| :------------------------- | :--------------------------------------- | :---------- | :------------------------------------------------- |
| **Safety Violations**      | `SAFETY#VIOLATION#<agentId>`             | **30 Days** | Audit trail for blocked or approval-gated actions. |
| **Blast Radius (Class C)** | `SAFETY#BLAST_RADIUS#<agentId>:<action>` | **1 Hour**  | Enforces frequency limits for sensitive changes.   |

This storage strategy adheres to **Principle 1 (Stateless Core)** by externalizing all transient operational state to a TTL-aware storage layer, ensuring the system remains lean and automatically self-cleanses.

---

## 📡 Related Documentation

- **[RESILIENCE.md](../system/RESILIENCE.md)**: Dead Man's Switch, Self-healing, and persistent Circuit Breakers.

### Distributed Circuit Breakers & Jitter

To prevent "Thundering Herd" scenarios in globally distributed agent swarms, the circuit breaker implements **Exponential Backoff with Jitter**:

- **Retry Logic**: When a service is degraded, retries are delayed based on `2^retryCount * baseDelay`.
- **Jitter**: A random jitter (up to 2x base delay) is added to ensure concurrent agents don't retry at the exact same millisecond, which could lead to secondary outages.
- **[SWARM.md](./SWARM.md)**: Recursive task safety and depth limits.
- **[STANDARDS.md](../governance/STANDARDS.md)**: Quality gates and audit standards.
