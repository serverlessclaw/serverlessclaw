# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents Registry ↗](./docs/intelligence/AGENTS.md) | [Events Bus ↗](./docs/interface/EVENTS.md) | [Memory ↗](./docs/intelligence/MEMORY.md) | [Tools ↗](./docs/intelligence/TOOLS.md)

This document covers the AWS topology and data flow. For operational instructions and agent checklists, see the [Agent Instructions & Checklist hub](./INDEX.md#agent-instructions-checklist). For agent logic and orchestration, see [docs/intelligence/AGENTS.md](./docs/intelligence/AGENTS.md).

## Design Philosophy

**Serverless Claw** is built to be:

1.  **Stateless**: The core execution is entirely stateless, with persistence offloaded to highly available managed services (DynamoDB). Utilizes a **Tiered Retention Policy** (TTL) and Global Secondary Index (GSI) for high-performance context recall.
2.  **Extensible**: Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
3.  **Low Latency**: Optimized for fast startup times to minimize "time-to-first-token". Implements **Real-time Streaming (AG-UI Protocol)** via IoT Core (MQTT) to provide instantaneous feedback to human users during long-running reasoning tasks. Tokens are published directly to IoT Core from the execution environment to bypass EventBridge overhead.
4.  **Safety-First**: Implements nested guardrails including Circuit Breakers, Recursion Limits, and Protected Scopes.
5.  **Proactive & Efficient**: Agents can self-schedule future tasks, but the system prioritizes a **Trigger-on-Message** warm-up strategy to achieve near-zero idling costs while maintaining low-latency responsiveness.
6.  **AI-Native**: Optimized for agent-human pair programming by prioritizing semantic transparency, strict neural typing, and direct schema definitions over traditional boilerplate indirection.
7.  **Adaptive UI**: The dashboard implements a theme-agnostic design system using semantic CSS variables, ensuring full functional and aesthetic parity between Light and Dark modes while maintaining the signature "cyber" identity.
8.  **Multi-Lingual**: Implements a "Baseline English Prompt" strategy. Agents maintain high reasoning quality via English core prompts while communicating in the user's preferred language (English/Chinese) via dynamic runtime instruction injection.

---

## 🌍 Localization: Baseline English Strategy

To prevent translation drift and maintain peak reasoning performance, Serverless Claw uses a dynamic localization model:

1. **Static English Core**: All agent system prompts are authored and maintained in English.
2. **Runtime Locale Injection**: The `initAgent` helper fetches the `active_locale` from the `ConfigTable` and appends locale-specific communication instructions (`LOCALE_INSTRUCTIONS`) to the system prompt before invocation.
3. **Localized Error Sensing**: The `detectFailure` utility is cross-lingual, scanning for both English ("FAILED") and Chinese ("失败") terminators to ensure robust workflow coordination.
4. **Dashboard Context**: A global `TranslationsProvider` wraps the dashboard, allowing hot-swapping between English and Chinese UI strings without page reloads.

```text
[ ConfigTable ] ---- (active_locale: cn) ----+
                                             |
                                             v
[ Base Prompt (EN) ] + [ CN Instructions ] ----> [ LLM Agent ] ---- (CN Response) ----> [ User ]
                                             ^
                                             |
[ Error Defs (EN/CN) ] <---------------------+ (Failure Sensing)
```

---

## ⚡ Efficiency: Smart Warm-up Strategy

To minimize AWS operational costs and reduce cold-start latency, Serverless Claw implements a **Contextual, Activity-Based Smart Warmup** instead of rigid scheduling or persistent heartbeats:

### 1. Intent-Based Detection (Human Trigger)

When a message is received at the Webhook, the system uses a lightweight **Intent Analyzer** (keywords + session history) to selectively identify and warm only the required cognitive multiplexer buckets. This ensures that the right environment is hot before the delegator even dispatches the task.

### 2. Self-Aware Feedback Loop

The system tracks warm state in DynamoDB using `WARM#<tierName>` keys with a 15-minute TTL. Once a Multiplexer successfully warms up, it records its own state, allowing subsequent interactions within the TTL window to skip warmup entirely:

```text
Key: WARM#<high|standard|light>
Value: {
  server: string,
  lastWarmed: string (ISO timestamp),
  warmedBy: 'webhook' | 'scheduler' | 'recovery',
  ttl: number (Unix timestamp),
  latencyMs: number,
  coldStart: boolean
}
```

### 2. Trigger-on-Message (Human Activity)

High-memory agents (Coder, Planner) remain idle and cost-free when no user interaction is occurring. Upon receiving a message:

1. **Webhook Trigger**: The [Webhook Handler](./core/handlers/webhook.ts) immediately checks warm state
2. **Smart Check**: Only warms servers/agents that are actually cold (expired TTL)
3. **Fire-and-Forget**: Warmup signals are asynchronous to avoid blocking user requests

### 3. Recovery Warmup

During emergency recovery sequences, the [Recovery Handler](./core/handlers/recovery.ts) automatically warms critical agents and MCP servers to ensure they're ready for recovery operations.

### 4. Health Reporting

The [Health Handler](./core/handlers/health.ts) includes warm state information in health responses, allowing dashboard visualization of which servers are currently warm.

### 5. Cost Impact

| Scenario        | Old (Scheduler)             | New (Smart)                   |
| --------------- | --------------------------- | ----------------------------- |
| Idle (no users) | ~50 Lambda invocations/hour | 0 invocations                 |
| Active session  | 50 + 5 agents/hour          | ~5 agents/hour (only on cold) |

**Estimated savings**: 60-80% reduction in warmup Lambda invocations

---

## 🔄 Issue-Driven Sync (IDS) Protocol

The IDS protocol manages the evolutionary synchronization between the **Mother Hub** (ServerlessClaw OSS) and its **Spokes** (Managed instances or Forks).

```text
+--------------+      +--------------+      +--------------+      +--------------+
|  Spoke Repo  |      |  Nerve CLI/  |      |     Sync     |      |  Mother Hub  |
|   (GitHub)   |      |   Webhook    |      | Orchestrator |      |    (OSS)     |
+------+-------+      +------+-------+      +------+-------+      +------+-------+
       |                     |                     |                     |
       |--- Label Issue ---->|                     |                     |
       |    (evol-sync)      |                     |                     |
       |                     |                     |                     |
       |--- Webhook Event -->|                     |                     |
       |                     |                     |                     |
       |                     |----- Trigger ------>|                     |
       |                     |      Pull           |                     |
       |                     |                     |                     |
       |                     |                     |-- Acquire Lock --+  |
       |                     |                     |                  |  |
       |                     |                     |<-----------------+  |
       |                     |                     |                     |
       |                     |                     |------- Fetch ------>|
       |                     |                     |      Evolution      |
       |                     |                     |                     |
       |                     |                     |<----- Blueprint ----|
       |                     |                     |       Updates       |
       |                     |                     |                     |
       |                     |                     |-- Subtree/Fork --+  |
       |                     |                     |      Merge       |  |
       |                     |                     |<-----------------+  |
       |                     |                     |                     |
       |                     |   [ If Conflict ]   |                     |
       |<--------- Post Conflict Report -----------|                     |
       |                     |                     |                     |
       |                     |   [ Else Success ]  |                     |
       |<--------- Confirm Sync (Commit) ----------|                     |
       |                     |                     |                     |
       |                     |                     |-- Release Lock --+  |
       |                     |                     |                  |  |
       |                     |                     |<-----------------+  |
       |                     |                     |                     |
```

### Key Components

- **Sync Lock**: Prevents repository corruption by ensuring atomic Git operations per prefix (via `FileSystemSyncLock` or DynamoDB).
- **Merge Policies**: Automated conflict resolution prioritizing the Hub for `core/` logic to maintain canonical alignment.
- **Contribution Loop**: Spokes promote local innovations back to the Hub via `evolution-contribution` labels, triggering a `subtree push`.

For detailed fork strategies, see [FORK_STRATEGY.md](docs/governance/FORK_STRATEGY.md).

---

## High-Level System Diagram

```text
+-------------------+       +-----------------------+       +-------------------+
| Messaging Client  +<----->+   AWS API Gateway     +------>+   Input Adapters  |
| (Telegram/Slack/  |       | (Webhook Endpoint)    |       | (Telegram, GitHub,|
|  GitHub/Jira)     |       |                       |       |  Jira, Generic)   |
+-------------------+       +-----------+-----------+       +---------|---------+
                                        |                             |
                                        v                             v
                            +-----------+-----------+       +---------|---------+
                            |                       |       |   AWS Lambda      |
                            |      ClawCenter       |       | Agent Multiplexer |
                            | (Intelligence Sector) |       | [ High | Std | Lt]|
                            |                       |       |         +         |
                            +-----------+-----------+       +---------|---------+
                                        |                             |
                                        v                             |
                            +-----------+-----------+                 |
                            |                       |                 |
                            |   EventBridge Bus     |<----------------+
                            |     (AgentBus)        |                 |
                            |           +           |                 |
                            +-----------|-----------+                 |
                                        |                             |
                                        v                             |
                            +-----------+-----------+                 |
                                        |                             |
                                        v                             |
              +-------------------------+-------------------------+   |
              |                         |                         |   |
    +---------v---------+     +---------v---------+     +---------v---v-----+
    |                   |     |                   |     |                   |
    |  Managed Services |     |   AWS Scheduler   +<----+  HeartbeatHandler |
    | (DynamoDB / S3)   |     | (Dynamic Goals)   |     | (Proactive Pulse) |
    |                   |     |                   |     |                   |
    +---------+---------+     +-------------------+     +-------------------+
              |                         |                             |
              v                         v                             |
    +---------+---------+   +-----------+-----------+                 |
    |                   |   |                       |                 |
    |   Observability   |   |  IoT Core (Realtime)  |<----------------+
    | (CloudWatch/SLO)  |   |     (Dashboard)       |
    |                   |   |                       |
    +-------------------+   +-----------------------+
```

---

---

## 🔌 Adapter & Processing Layer

The system uses a pluggable **Adapter Architecture** to communicate with external environments while maintaining a normalized internal message flow.

- **Input Adapters**: Normalize diverse payloads (Telegram, Slack, GitHub, Jira) into a common `InboundMessage`.
- **Message Flow**: Orchestrates JIT media staging and asynchronous processing via the AgentBus.

For detailed adapter schema and implementation rules, see [docs/interface/PROTOCOL.md](./docs/interface/PROTOCOL.md).

---

## ⚡ Agent Orchestration (The AgentBus)

Agents communicate asynchronously using **AWS EventBridge (The AgentBus)**. This is the **spine** of the system, enabling decoupled multi-agent coordination.

- **Agent Multiplexer**: Consolidates cognitive environments into high-performance buckets.
- **DAG Supervisor**: Manages dependency-aware parallel workflows.
- **Trace Propagation**: Ensures observability across asynchronous boundaries.

For detailed event schemas and routing logic, see [docs/interface/EVENTS.md](./docs/interface/EVENTS.md).

---

## 🧠 Cognitive Frameworks

Serverless Claw utilizes a tiered logic system to ensure efficiency and cost-control.

- **LLM Reasoning**: Provider-agnostic adapters for 2026-grade reasoning profiles (Thinking Budgets, Responses API).
- **Hybrid Tooling**: Just-in-Time skill discovery and MCP Multiplexer architecture.
- **Memory & Context**: Flattened DynamoDB model for sub-50ms context retrieval.

| Component                 | Deep Dive                                                    |
| :------------------------ | :----------------------------------------------------------- |
| **LLM Reasoning**         | [docs/intelligence/LLM.md](./docs/intelligence/LLM.md)       |
| **Dynamic Tools**         | [docs/intelligence/TOOLS.md](./docs/intelligence/TOOLS.md)   |
| **Memory Strategy**       | [docs/intelligence/MEMORY.md](./docs/intelligence/MEMORY.md) |
| **Resource Provisioning** | [docs/system/PROVISIONING.md](./docs/system/PROVISIONING.md) |

---

## 👥 Collaboration & Workspaces

The system supports multi-human multi-agent coordination through **Moderated Sessions** and **Workspaces**.

- **Workspaces**: Identity management, RBAC, and multi-tenant isolation.
- **Collaboration**: Facilitator-moderated sessions for strategic peer review.

For detailed role hierarchies and coordination diagrams, see [docs/interface/COLLABORATION.md](./docs/interface/COLLABORATION.md).

---

## 🛡️ Stability & Self-Healing

The system is designed for autonomous survival in unstable conditions.

- **Distributed Locking**: DynamoDB-backed session integrity.
- **Dead Man's Switch**: Automated recovery sequence for severe failure.
- **Self-Evolution**: Continuous optimization loops based on telemetry and reputation.

| Component                 | Deep Dive                                                    |
| :------------------------ | :----------------------------------------------------------- |
| **Concurrency**           | [docs/system/CONCURRENCY.md](./docs/system/CONCURRENCY.md)   |
| **Evolution**             | [docs/system/EVOLUTION.md](./docs/system/EVOLUTION.md)       |
| **Resilience & Recovery** | [docs/system/RESILIENCE.md](./docs/system/RESILIENCE.md)     |
| **Provisioning**          | [docs/system/PROVISIONING.md](./docs/system/PROVISIONING.md) |

For deep dives into these evolutionary mechanisms, see [docs/system/EVOLUTION.md](./docs/system/EVOLUTION.md) and [docs/system/RESILIENCE.md](./docs/system/RESILIENCE.md).
