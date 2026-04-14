# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents Registry ↗](./docs/intelligence/AGENTS.md) | [Events Bus ↗](./docs/interface/EVENTS.md) | [Memory ↗](./docs/intelligence/MEMORY.md) | [Tools ↗](./docs/intelligence/TOOLS.md)

This document covers the AWS topology and data flow. For operational instructions and agent checklists, see the [Agent Instructions & Checklist hub](./INDEX.md#agent-instructions-checklist). For agent logic and orchestration, see [docs/intelligence/AGENTS.md](./docs/intelligence/AGENTS.md).

## Design Philosophy

**Serverless Claw** is built to be:

1.  **Stateless**: The core execution is entirely stateless, with persistence offloaded to highly available managed services (DynamoDB). Utilizes a **Tiered Retention Policy** (TTL) and Global Secondary Index (GSI) for high-performance context recall.
2.  **Extensible**: Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
3.  **Low Latency**: Optimized for fast startup times to minimize "time-to-first-token". Implements **Real-time Streaming (AG-UI Protocol)** via IoT Core (MQTT) to provide instantaneous feedback to human users during long-running reasoning tasks. Tokens are published directly to IoT Core from the execution environment to bypass EventBridge overhead.
4.  **Safety-First**: Implements nested guardrails including Circuit Breakers, Recursion Limits, and Protected Scopes.
5.  **Co-managed Autonomy**: Employs a **Dynamic Trust Loop** where agents and humans collaborate on autonomy levels (HITL vs AUTO). Trust is earned through sustained success and weighted by implementation quality, while being penalized for failures, cognitive anomalies (reasoning loops, degradation), or SLO breaches via a centralized **TrustManager**.
6.  **Proactive & Efficient**: Agents can self-schedule future tasks, but the system prioritizes a **Trigger-on-Message** warm-up strategy.
7.  **AI-Native**: Optimized for agent-human pair programming by prioritizing semantic transparency, strict neural typing, and direct schema definitions over traditional boilerplate indirection.
8.  **Adaptive UI**: The dashboard implements a theme-agnostic design system using semantic CSS variables, ensuring full functional and aesthetic parity between Light and Dark modes while maintaining the signature "cyber" identity.
9.  **Multi-Lingual**: Implements a "Baseline English Prompt" strategy. Agents maintain high reasoning quality via English core prompts while communicating in the user's preferred language (English/Chinese) via dynamic runtime instruction injection.
10. **JIT File Staging**: Implements a Just-In-Time media pipeline that intercept uploads, stages them in S3, and provides optimized cognitive context (base64/URLs) to agents, ensuring peak vision performance and trace-aware file management.

---

## 📂 JIT File Staging Pipeline

The system handles chat-uploaded media through a decoupled staging layer:

```text
[ User ]        [ Webhook ]        [ Adapter (TG/Slack) ]        [ S3 (Staging) ]        [ LLM Agent ]
    |               |                       |                        |                      |
    +--- Upload --->|                       |                        |                      |
    |               +---- Process Media --->|                        |                      |
    |               |                       +---- Download File ---->|                      |
    |               |                       |                        |                      |
    |               |                       +---- Upload to S3 ----->|                      |
    |               |                       |      (chat-attachments/)|                      |
    |               |                       |                        |                      |
    |               |                       +---- Yield Attachment --+                      |
    |               |                       |   (URL + b64 vision)   |                      |
    |               |                       |                        |                      |
    |               +---------------------> | --------------------- [ INJECT CONTEXT ] ---->|
    |               |                       |                        |                      |
```

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

### 2. Contextual Activity-Based Smart Warmup

The system prioritizes a **Trigger-on-Message** strategy to maintain $0 idle costs while eliminating cold-start perception.

```text
[ User ]        [ Webhook ]        [ Intent Analyzer ]        [ Warmup Manager ]        [ Target (MCP/Agent) ]
    |               |                       |                        |                          |
    +--- Message -->|                       |                        |                          |
    |               +---- Analyze Input --->|                        |                          |
    |               |                       +--- Identify Targets -->|                          |
    |               |                       |   (Coder? FS? Git?)    |                          |
    |               |                       |                        +--- Async Warm Trigger -->|
    |               |                       |                        |                          | [ COLD BOOT ]
    |               |                       |                        |<----- Success/Latency ---+
    |               |                       |                        |                          |
    |               |                       |                        +---- Update WARM State ---+
    |               |                       |                        |      (DynamoDB TTL)      |
    |               |                       |                        |                          |
    +<-- Acknowledge+                       |                        |                          |
    |               |                       |                        |                          |
```

### 3. Trigger-on-Message (Human Activity)

High-memory agents (Coder, Planner) remain idle and cost-free when no user interaction is occurring. Upon receiving a message:

1.  **Webhook Trigger**: The [Webhook Handler](./core/handlers/webhook.ts) immediately checks warm state.
2.  **Proactive Agent Warmup**: The `Agent` class utilizes the unified `triggerSmartWarmup` helper across both `process()` and `stream()` modes to ensure downstream dependencies are ready.
3.  **Smart Check**: Only warms servers/agents that are actually cold (expired TTL).
4.  **Fire-and-Forget**: Warmup signals are asynchronous to avoid blocking user requests.

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

## High-Level System Diagram: The Distributed Spine & Shield

The system architecture follows a **Distributed Spine** model where all critical state (routing, safety, trust) is synchronized via DynamoDB to ensure consistency across serverless execution boundaries.

```text
  [ Inbound Event ]
          |
          v
  [ Silo 1: The Spine (EventHandler) ]
          |-- (1) FlowControl (FlowController: Rate Limit / Circuit Breaker)
          |-- (2) Trace-Aware Recursion Guard (Atomic monotonic increment)
          v
  [ Agent Multiplexer (Gateway) ]
          |-- (3) Dynamic Selection (AgentRouter.selectBestAgent)
          |-- (4) Selection Integrity (Verify agent.enabled === true)
          v
  [ Agent Execution (Silo 2: The Hand) ]
          |-- (5) Security Enforcement (ToolSecurityValidator: Safety/RBAC/Breaker)
          |-- (6) Isolated Workspace (/tmp/claw-workspaces/<traceId>)
          |-- (7) Unified MCP Tool Discovery (Distributed Backoff)
          v
  [ Outcome (Success/Failure) ]
          |
          v
  [ Silo 6: The Scales (TrustManager) ]
          |-- (8) Quality-Weighted Reputation Update
          |-- (9) Atomic History Recording (list_append)
          v
  [ ConfigTable (DDB) ] <--- (Feedback Loop for Selection Integrity)
```

---

## ⚡ Distributed Safety & Selection Integrity

To maintain a **Stateless Core** (Principle 1) while ensuring systemic safety, the system externalizes all operational state:

1.  **Distributed Flow Control**: The `FlowController` centralizes backbone circuit breakers and rate limiters using DynamoDB atomic counters. This prevents "phantom safety" where different Lambda instances have divergent views of system health.
2.  **Surgical Security Enforcement**: The `ToolSecurityValidator` decouples security logic from tool execution. It enforces the "Shield" (SafetyEngine) rules, RBAC permissions, and system-level circuit breakers before any tool interaction occurs.
3.  **Selection Integrity**: The `AgentMultiplexer` acts as the authoritative gateway. It performs a mandatory configuration check for every agent before invocation, ensuring that `enabled: false` status is strictly enforced regardless of the event source.
4.  **Dynamic Routing**: The `AgentRouter` uses historical performance metrics (success rate, latency, cost) to dynamically select the best agent-model combination for a given task.
5.  **Monotonic Recursion Tracking**: Cross-session recursion depth is managed via atomic increments in the `recursion-tracker`, preventing loop-bypass attacks in concurrent swarm scenarios.

---

## ⚖️ The Dynamic Trust Loop (Silo 5 ↔ Silo 6)

The system maintains a continuous feedback loop between execution observability and agent authority.

```text
[ Execution ] ---- (Telemetry) ----> [ Silo 5: The Eye ]
                                     (Cognitive Metrics)
                                             |
                                     [ Anomaly Detected? ]
                                             |
                                             v
[ Council Review ] <--- (Alert) --- [ Silo 6: The Scales ]
       ^                             (TrustManager)
       |                                     |
[ Mode Shift ] <--- (Trust < 95) -----------+
(AUTO -> HITL)
```

1. **Detection**: The `CognitiveHealthMonitor` identifies reasoning loops or degradation.
2. **Calibration**: `TrustManager` applies severity-based penalties or quality-weighted bumps.
3. **Enforcement**: If `TrustScore` drops below the autonomous threshold, the system automatically shifts to `HITL`.

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
- **Hybrid Tooling**: Just-in-Time skill discovery via the **MCPMultiplexer** (Unified MCP Multiplexer architecture).
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
```
