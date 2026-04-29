# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents Registry ↗](./docs/intelligence/AGENTS.md) | [Events Bus ↗](./docs/interface/EVENTS.md) | [Memory ↗](./docs/intelligence/MEMORY.md) | [Tools ↗](./docs/intelligence/TOOLS.md)

This document covers the AWS topology and data flow. For operational instructions and agent checklists, see the [Agent Instructions & Checklist hub](./INDEX.md#agent-instructions-checklist). For agent logic and orchestration, see [docs/intelligence/AGENTS.md](./docs/intelligence/AGENTS.md).

## Design Philosophy

**Serverless Claw** is built to be:

1.  **Stateless**: The core execution is entirely stateless, with persistence offloaded to highly available managed services (DynamoDB). Utilizes a **Tiered Retention Policy** (TTL) and Global Secondary Index (GSI) for high-performance context recall.
2.  **Extensible**: Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
3.  **Low Latency**: Optimized for fast startup times to minimize "time-to-first-token". Implements **Real-time Streaming (AG-UI Protocol)** via IoT Core (MQTT) to provide instantaneous feedback to human users during long-running reasoning tasks. Tokens are published directly to IoT Core from the execution environment to bypass EventBridge overhead. See [Streaming Flow ↗](./docs/intelligence/STREAMING.md) for architectural details.
4.  **Safety-First**: Implements nested guardrails including Circuit Breakers, Recursion Limits, and Protected Scopes.
5.  **Co-managed Autonomy**: Employs a **Dynamic Trust Loop** where agents and humans collaborate on autonomy levels (HITL vs AUTO). Trust is earned through sustained success and weighted by implementation quality, while being penalized for failures, cognitive anomalies (reasoning loops, degradation), or SLO breaches via a centralized **TrustManager**.
6.  **Proactive & Efficient**: Agents can self-schedule future tasks, but the system prioritizes a **Trigger-on-Message** warm-up strategy.
7.  **AI-Native**: Optimized for agent-human pair programming by prioritizing semantic transparency, strict neural typing, and direct schema definitions over traditional boilerplate indirection.
8.  **Adaptive UI**: The dashboard implements a theme-agnostic design system using semantic CSS variables, ensuring full functional and aesthetic parity between Light and Dark modes while maintaining the signature "cyber" identity.
9.  **Multi-Lingual**: Implements a "Baseline English Prompt" strategy. Agents maintain high reasoning quality via English core prompts while communicating in the user's preferred language (English/Chinese) via dynamic runtime instruction injection.
10. **JIT File Staging**: Implements a Just-In-Time media pipeline that intercept uploads, stages them in S3, and provides optimized cognitive context (base64/URLs) to agents, ensuring peak vision performance and trace-aware file management.
11. **Shared Real-time Handshakes (Singleton UI Connectivity)**: To minimize AWS IoT Core authorizer costs and prevent "connection storms" during local development (HMR), the dashboard utilizes a singleton `RealtimeProvider`. This architecture ensures that regardless of the number of active components (Chat, Canvas, Agents), only **one physical WebSocket connection** is established per tab, reducing Lambda Authorizer invocations by >80%.
12. **Mission Control Experience**: The dashboard transforms the standard chat interface into a high-fidelity "War Room". By integrating real-time telemetry (Trust, Stability, Budget) and operational phase tracking directly into the mission view, it reduces cognitive load and ensures the human remains the authoritative commander of the agentic swarm. This experience is fully dynamic, driven by session-specific metadata for persistent cross-session state.
13. **Multi-Human & Agent Presence**: Implements a real-time presence layer using MQTT `presence` signals. This allows multiple humans and agents to maintain shared awareness within a workspace, tracking who is active, their current status, and collaborative actions.

---

## 🌀 Total Quality & Evolution Loop

Serverless Claw operates on a self-correcting feedback loop that bridges real-time observability with autonomous evolution:

```text
  [ REAL-TIME SIGNALS ]
          |
          +--> [ Mission Control HUD ] <---+
          |    (Trust / Stability / ROI)   |
          |                                |
          +--> [ System Pulse HUD ] ----+--+
          |    (Health / Persistence)   |  |
          |                             |  |
          +--> [ Resilience HUD ] ------+--+---> [ CIRCUIT BREAKER ]
          |    (CB State / Burn-Rate)   |        (Block / Allow Deploys)
          |                             |
          +--> [ Cognitive HUD ] -------+---> [ METABOLISM SERVICE ]
          |    (Audit / Prune / Cull)   |     (Recycle Debt / Bloat)
          |                             |
          +--> [ Tool ROI Hub ] --------+---> [ NEGATIVE MEMORY ]
          |    (Value / Cost / Success) |     (Avoid Repeat Failure)
          |                             |
          +--> [ Static Analysis Feed ] +---> [ ENV CONSTRAINTS ]
          |    (package.json / deps)    |     (Cognitive Resilience)
          v                             v
  [ STRATEGIC PLANNING ] <------- [ ANOMALY DETECTED ]
          |
          v
  [ EVOLUTION PIPELINE ] <------- [ CAPABILITY GAPS ]
```

---

## 🧪 Simulation & Health Hub

To support autonomous swarm growth, the system provides a dual-purpose environment for experimentation and maintenance:

```text
       [ COGNITIVE HUB ]
               |
      +--------+--------+
      |                 |
[ PLAYGROUND ]   [ NERVE CENTER ]
      |                 |
(Simulation)       (Metabolism)
      |                 |
+-----+-----+     +-----+-----+
| Swarm Team |    | Audit     |
| Tuning     |    | Repair    |
| Isolated   |    | Prune     |
+-----------+     +-----------+
```

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

### Mission Control Layout (War Room)

The primary interaction interface implements a three-column "War Room" model, synchronized via session metadata:

```text
+-----------------------+-----------------------------+-----------------------+
|    [ MISSION HUB ]    |      [ CENTRAL CORE ]       |  [ MISSION CONTROL ]  |
|                       |                             |                       |
|  - Collaborators      |  - Collaborative Chat       |  - Cognitive HUD      |
|    (Presence Layer)   |  - Agent Thought Stream     |    (Trust/Stability)  |
|                       |  - Real-time Signals        |                       |
|  - Mission Briefing   |  - Inline Tool Execution    |  - Nerve Center       |
|    (Goal/Status)      |                             |    (Activity Ticker)  |
|                       |  - Metadata-Driven UI       |                       |
|  - Operational Phases |    (Session Persistence)    |  - Autonomy Protocol  |
|    (Analysis->Deploy) |                             |    (HITL/AUTO/Ovr)    |
+-----------------------+-----------------------------+-----------------------+
```

---

## 🏗️ The Distributed Spine & Shield

The system architecture follows a **Distributed Spine** model where all critical state (routing, safety, trust) is synchronized via DynamoDB to ensure consistency across serverless execution boundaries.

````text
  [ Inbound Event ]
          |
          v
  [ Silo 1: The Spine (EventHandler) ]
          |-- (1) Strict Payload Validation (Required: traceId, sessionId)
          |-- (2) FlowControl (FlowController: Fail-Closed Rate Limit / Circuit Breaker)
          |-- (3) Stable Idempotency Guard (Content-aware deduplication)
          |-- (4) Trace-Aware Recursion Guard (Atomic monotonic increment)
          v
  [ Agent Multiplexer (Gateway) ]
          |-- (5) Dynamic Selection (AgentRouter.selectBestAgent)
          |-- (6) Selection Integrity (Verify agent.enabled === true)
          v
   [ Agent Execution (Silo 2: The Hand) ]
           |-- (7) Unified Config (ConfigManager: 60s Cached Dynamic Lookups)
           |-- (8) Security Enforcement (ToolSecurityValidator: Safety/RBAC/Breaker)
           |-- (9) Budget Enforcement (BudgetEnforcer + TokenBudgetEnforcer: Session + Task-level Tokens/Cost)
           |-- (10) Isolated Workspace (/tmp/claw-workspaces/<traceId>)
          v
  [ Outcome (Success/Failure) ]
          |
          v
  [ Silo 6: The Scales (TrustManager) ]
          |-- (11) Quality-Weighted Reputation Update
          |-- (12) Atomic History Recording (list_append with WorkspaceId isolation)
          |-- (13) Atomic Trust Score (Conditional atomicIncrementMapField)
          |-- (14) Fail-Closed Integrity (Throw on update failure)
          |-- (15) Capability Graduation (PromotionManager: PENDING -> PROMOTED)
          v
  [ ConfigTable (DDB) ] <--- (Feedback Loop for Selection Integrity)

---

## 🧠 Brain & Evolution Lifecycle

To support autonomous swarm growth while maintaining the "Trunk is Sacred" rule, the system implements a multi-stage evolution pipeline:

1. **Strategic Planning**: The Reflector and Planner identify and plan fixes for `strategic_gap` records.

```mermaid
graph TD
    A[Conversation Finished] --> B{Reflector Agent}
    B --> C[Fetch Execution Trace]
    B --> D[Build Reflection Prompt]
    D --> E[LLM: Generate Reflection Report]
    E --> F[Processor: Handle Insights]
    F --> G[Update Facts in Memory]
    F --> H[Add Lessons]
    F --> I[Identify/Update Gaps]
    I --> J{EventBridge}
    J --> K[Evolution Plan Event]
    K --> L[Planner Agent]
    F --> M[Resolve Gaps]
````

2. **Pre-flight Verification**: The **`verifyChanges`** tool executes the full project quality suite (`make check && make test`) locally in the agent's worker context. Passing this suite is a mandatory **Definition of Done (DoD)** requirement for staging or pushing code.
3. **Trunk Integration**: Verified changes are pushed to `main` and deployed to `prod`.
4. **Promotion Manager**: Post-deployment, the `PromotionManager` graduates capabilities from shadow mode (`SafetyTier.LOCAL`) to full autonomy (`SafetyTier.PROD`) based on sustained trust and verified live metrics.

To ensure high-performance auditability and automatic data aging (Principle 1), all transient safety telemetry is persisted in the **MemoryTable**:

1. **Safety Violations, Sessions & Locks**: Every blocked action, active session state, and distributed lock is logged with its respective prefix (`SAFETY#VIOLATION#`, `SESSION_STATE#`, `LOCK#SESSION#`) and a appropriate TTL. **Multi-tenant isolated via `WS#<workspaceId>` Partition Key.**
2. **Collision Guard**: Log persistence uses conditional writes with millisecond jitter to prevent overwrites under high concurrency.
3. **Blast Radius Tracking**: Class C action frequency is tracked per agent/action using the `SAFETY#BLAST_RADIUS#` prefix with a **1-hour rolling window (TTL)**.
4. **Storage Strategy**: This migration from `ConfigTable` to `MemoryTable` ensures that audit logs do not pollute persistent configuration state and are automatically reclaimed by DynamoDB after their operational relevance expires.

````

## 🛡️ Security & RBAC Enforcement

To ensure enterprise-grade multi-tenancy and prevent privilege escalation, the system enforces a strict security perimeter:

1. **Identity Hardening**: `getUserId` in the dashboard (`dashboard/src/lib/auth-utils.ts`) verifies both the session ID and a dedicated auth marker cookie. It explicitly blacklists the `SYSTEM` identity to prevent spoofing of internal agent credentials.
2. **Permission-Gated API Routes**: All critical dashboard API routes (`/api/chat`, `/api/agents`) verify the requesting user's permissions via the `IdentityManager`.
   - **`TASK_CREATE`**: Required to initiate new chat sessions or tasks.
   - **`AGENT_VIEW / UPDATE / DELETE`**: Required to manage agent configurations.
3. **Workspace Isolation**: Permission checks are scoped to a specific `workspaceId` (passed via headers or query params), ensuring users cannot access or modify resources belonging to other tenants.
4. **Token Budgeting**: The `TokenBudgetEnforcer` prevents runaway LLM costs by monitoring per-session token consumption and blocking requests that exceed the allocated budget.

---

## ⚙️ Unified Configuration System

To satisfy **Principle 5 (Low Latency)** and **Principle 10 (Lean Evolution)**, Serverless Claw implements a unified, hot-swappable configuration layer:

1. **Modular Architecture**: The `ConfigManager` (`core/lib/registry/config.ts`) is refactored into specialized sub-modules within `core/lib/registry/config/` using an inheritance chain:
   ```text
   [ ConfigBase ] -> [ ConfigClient ] -> [ ConfigList ] -> [ ConfigMap ] -> [ ConfigManager ]
````

This ensures high neural cohesion and stays within AI context limits during systemic audits. 2. **Cached Dynamic Lookups**: Maintains a 60-second in-memory cache for all configuration keys. This reduces DynamoDB read IOPS by >90% during high-concurrency swarm missions. 3. **Authoritative Async Bridge**: The `getDynamicConfigValue` utility provides a type-safe, non-blocking interface for fetching hot-swappable settings. 4. **Atomic Writes & Invalidation**: Configuration updates use DynamoDB conditional writes to prevent lost updates. **Supports Principle 15 (Monotonic Progress) via `atomicIncrementMapField` for numeric counters.** 5. **Centralized Table Resolution**: Table names are resolved via `ddb-client.ts`, supporting environment variable overrides for robust stage alignment.

---

## 🧠 Modular Memory Engine (DynamoMemory)

To comply with AI context budgets and prevent "God Class" bloat, the `DynamoMemory` implementation is decomposed into a tiered inheritance chain. Each layer encapsulates a specific domain of the `IMemory` interface:

```text
[ BaseMemoryProvider ]
          |
          v
[ DynamoMemoryBase ] -------- (Core DDB Utils, listByPrefix)
          |
          v
[ DynamoMemoryGaps ] -------- (Strategic Gaps, Locks)
          |
          v
[ DynamoMemoryInsights ] ---- (Lessons, Knowledge, Failure Patterns)
          |
          v
[ DynamoMemorySessions ] ---- (History, Summary, LKG Hashes)
          |
          v
[ DynamoMemoryCollaboration ] (Collaboration, Clarifications)
          |
          v
[ DynamoMemory ] ------------ (Thin Wrapper, Cache Stats)
```

1. **Inheritance over Composition**: Uses inheritance to preserve a flat, performant `IMemory` interface while keeping source files under 500 lines.
2. **Transitive Efficiency**: Dashboard routes and light clients can import `BaseMemoryProvider` directly to avoid pulling the full dependency graph of the entire memory engine, reducing context budget from 112k to <5k tokens.

---

## ⚡ Distributed Safety & Selection Integrity

To maintain a **Stateless Core** (Principle 1) while ensuring systemic safety, the system externalizes all operational state:

1.  **Distributed Flow Control**: The `FlowController` centralizes backbone circuit breakers and rate limiters using DynamoDB atomic counters. It enforces a **Fail-Closed** strategy (Principle 13): if the system cannot verify safety state (including corrupted state fallbacks), the operation is rejected to preserve system integrity.
2.  **Surgical Security Enforcement**: The `ToolSecurityValidator` decouples security logic from tool execution. It enforces the "Shield" (SafetyEngine) rules, RBAC permissions, and system-level circuit breakers before any tool interaction occurs.
3.  **Strict Payload Validation**: The `EventHandler` enforces mandatory presence of `traceId` and `sessionId` at the entry point, preventing malformed signals from polluting the backbone.
4.  **Stable Idempotency**: Implements content-aware deduplication in the Spine. Uses a stable hash of the event payload to catch application-level double-emissions, preventing redundant processing of destructive actions.
5.  **Budget Guardrails**: Operationalized via the centralized `BudgetEnforcer` together with `TokenBudgetEnforcer`. Provides two-tier enforcement: (1) **Session-level** budgets tracked across multi-turn conversations via DynamoDB-persisted counters (prevents budget poisoning), and (2) **Task-level** token/cost thresholds checked each loop iteration. Soft warnings at 80% usage, hard stops when limits are exceeded. Configured via `CONFIG_KEYS` (`SESSION_TOKEN_BUDGET`, `SESSION_COST_LIMIT`, `GLOBAL_TOKEN_BUDGET`, `GLOBAL_COST_LIMIT`).
6.  **Selection Integrity**: The `AgentMultiplexer` acts as the authoritative gateway. It performs a mandatory configuration check for every agent before invocation, ensuring that `enabled: false` status is strictly enforced regardless of the event source.
7.  **Dynamic Routing**: The `AgentRouter` uses historical success rates and reputation scores to dynamically select the best agent for a given task, prioritizing capability match over marginal token cost differences (Principle 10).
8.  **Monotonic Recursion Tracking**: Cross-session recursion depth is managed via atomic increments in the `recursion-tracker`, preventing loop-bypass attacks in concurrent swarm scenarios.
9.  **Adaptive Mode Enforcement**: To satisfy **Principle 10 (Lean Evolution)**, all agent-to-agent processes are forced into structured `json` mode. This eliminates conversational filler and optimizes for machine-readable feedback loops.
10. **Unified Security Constants**: Protection patterns are consolidated into a single source of truth (`core/lib/constants/safety.ts`), ensuring consistent enforcement across the filesystem and cloud resources.

---

## 📈 Budget & Trace Isolation Flow

To ensure "small" sessions are never blocked by unrelated runaway background tasks, the system decouples message identity from budget context.

```text
[ Inbound Message ]
        |
        +----(1) traceId provided? --- [YES] ---> [ Use traceId ]
        |                              [NO ] ---> [ check sessionId ] --+
        |                                                                |
        v                                                                |
[ traceId Resolution ] <-------------------------------------------------+
(ProviderManager)
        |
        +----(2) [ workspaceId provided? ] --- [YES] ---> [ Filter Traces by WSID ]
        |                                      [NO ] ---> [ Global Trace Access ]
        |
        +---- Falls back to 'session-<id>' if missing (Session Isolation)
        |
        v
[ SystemGuard ]
        |
        +----(2) Fetch Trace Budget from MemoryTable (RECURSION_STACK#<traceId>)
        |
        +----(3) [ trace consumed >= 1.0M ? ] --- [YES] ---> [ HALT: BUDGET_EXCEEDED ]
        |                                   [NO ] ---> [ CONTINUE ]
        |
        +----(4) Check Session Budget via TokenBudgetEnforcer ---[EXCEEDED]---> [ HALT: SESSION_BUDGET_EXCEEDED ]
        |
        v
[ Provider Execution ]
        |
        +----(5) Update Trace Buckets Atomically (+ prompt_tokens + completion_tokens)
        |
        v
[ Dashboard ] (Refresh and continue turn)
```

---

## 🧠 Nimble Context Architecture (AI-Ready Hardening)

To maintain an AIReady score > 80 and prevent "Context Black Holes" in complex handlers (e.g., `parallel-task-completed-handler`), the system utilizes a **Just-in-Time Dependency Staging** model:

```text
  [ Event Entry ]
         |
         v
  [ Lean Imports ] <--- (Standard: types, schemas, logger)
         |
         v
  { Logical Branch }
         |
  [ Dynamic Staging ] <--- (await import: Agents, Registries, Tools)
         |
         v
  [ Targeted Execution ]
```

### Key Optimizations:

1.  **Lazy Tool Aggregation**: The `ToolRegistry` is empty by default. Tools are dynamically imported into the registry only when `getAgentTools` is invoked, preventing tool logic from leaking into non-tool handlers.
2.  **Isolated Agent Instantiation**: Heavy agent classes (e.g., `SuperClaw`) are imported dynamically within the specific switch branches that require them (e.g., result aggregation).
3.  **Transitive Tree Pruning**: By externalizing heavy registries into dynamic buckets, we've reduced the **Import Depth** across the core handler layer by ~40%, ensuring AI agents can fully ground the current file without being overwhelmed by unrelated transitive code.

---

## 🤝 Human-in-the-Loop: Signal Flow

Interactive signals act as the "Brake & Steering" of the system, allowing humans to intervene in high-risk tool loops.

```text
[ User (ClawCenter) ] -------- (Click: Reject Tool) --------> [ IoT Bridge ]
                                                                   |
                                                                   v
[ AgentBus ] <----------------- (REJECT_TOOL_CALL:call_1) ---- [ Webhook ]
      |
      v
[ SuperClaw Agent ] ----------- (Context Loading) -----------> [ Workspace ]
                                                                   |
                                                                   v
[ BaseExecutor ] <------------- (Intercept Signal) ----------- [ runLoop ]
      |
      v (Inject Message)
[ Conversation History ] <----- (role: TOOL, content: USER_REJECTED...)
      |
      v (Next Iteration)
[ LLM Provider ] <------------- (Context with Intervention)
```

1. **Signal Interception**: The `BaseExecutor` intercepts `APPROVE_TOOL_CALL`, `REJECT_TOOL_CALL`, and `CLARIFY_TOOL_CALL` signals before the next LLM turn.
2. **Context Injection**: Rejections and clarifications are injected as `TOOL` role messages, providing the agent with the semantic reason for the intervention.
3. **Loop Continuation**: The agent then re-evaluates its strategy based on the human feedback, maintaining the reasoning chain without loss of state.

---

## ⚡ Real-time Connectivity: Shared Singleton Model

The dashboard implements a **Singleton Connectivity** model via the `RealtimeProvider` to optimize performance and reduce AWS operational costs.

```text
[ Dashboard Components ]
   | (useRealtime Hook)
   +-------------------+-------------------+
   |                   |                   |
   v                   v                   v
[ Chat ]           [ Canvas ]        [ Agents ]
   |                   |                   |
   +---------+---------+---------+---------+
             |
             v
     [ RealtimeProvider ]  <--- (Context Gateway)
             |
             | (Single WebSocket Connection)
             v
     [ AWS IoT Core ]      <--- (1 Auth Hit per Session)
             |
             +---- [ user/123/signal ]
             +---- [ workspaces/abc/signal ]
             +---- [ workspaces/def/signal ]
```

1. **Singleton Gateway**: All dashboard features share a single MQTT client instance provided via React Context.
2. **Batch Subscriptions**: Subscription requests from multiple components are batched and deduplicated to minimize signaling overhead.
3. **Tab Isolation**: Each browser tab maintains its own connection with a unique `clientId` (derived from a shared session token), preventing connection flapping while allowing parallel development.
4. **Leak Prevention**: Handshake lifecycle management ensures that connections are cleanly terminated even during rapid client-side hydration cycles or HMR resets.

---

## ⚖️ The Dynamic Trust Loop (Silo 5 ↔ Silo 6)

The system maintains a continuous feedback loop between execution observability, trust calibration, and routing selection:

```text
  [ PERFORMANCE ]                     [ TRUST ]                         [ SELECTION ]
        |                                |                                    |
  (Silo 5: Eye)                    (Silo 6: Scales)                     (Silo 1: Spine)
        |                                |                                    |
  +-----------+                    +------------+                      +-------------+
  | Telemetry | --(Anomaly/SLO)--> | TrustScore | --(Weighted Score)-->| AgentRouter |
  | (Tracer)  | <--(Success/Fail)- | (Manager)  | <---(Select best)----| (Multiplexer)|
  +-----------+                    +------------+                      +-------------+
        ^                                |                                    |
        |                                v                                    |
        +----------------------- [ Registry Overrides ] <---------------------+
```

1. **Silo 5: The Eye (Observability & Health)**
   - **Collector**: Buffers raw cognitive telemetry (success, latency, tokens, coherence) with **strict tenant isolation** using `WS#<workspaceId>` prefixes. Implements **Unique Timestamp Jittering** (micro-offsets) to prevent telemetry data loss from concurrent emissions.
   - **Analyzer**: Aggregates trends over time windows to feed Silo 6.
   - **Detector**: Identifies reasoning loops, degradation, and performance anomalies.
2. **Silo 6: The Scales (Trust & Reputation)**
   - **TrustManager**: Authoritative agent reputation scoring. Enforces **Fail-Closed Integrity** (Principle 13) during trust updates to prevent silent penalty drops.
   - **Metabolism (Silo 7)**: Periodically decays trust scores across all workspaces to ensure continuous earning of autonomy.
3. **Perspective D (Trust Loop)**: The **AgentRouter** uses these scores to bias selection toward high-performing workers, ensuring "Selection Integrity" (Principle 14) is data-driven.

````

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
| **Real-time Streaming**   | [docs/intelligence/STREAMING.md](./docs/intelligence/STREAMING.md) |

---

## 👥 Collaboration & Workspaces

The system supports multi-human multi-agent coordination through **Moderated Sessions** and **Workspaces**.

- **Workspaces**: Identity management, RBAC, and multi-tenant isolation. Every workspace acts as a sandbox for a specific swarm of agents and humans.
- **Identity Management**: A centralized `IdentityManager` (`core/lib/session/identity/manager.ts`) handles user provisioning, RBAC, and secure credential verification. The implementation is modularized into specialized operations for Users, Sessions, and Access Control to optimize for AI grounding.
- **Collaboration**: Facilitator-moderated sessions for strategic peer review, now scoped per workspace to prevent data leakage.

### 5. Multi-Human Shared Awareness
The system enables seamless multi-human & multi-agent collaboration via a tiered MQTT signaling strategy:

- **Session Topic**: `users/{userId}/sessions/{sessionId}/signal` (Legacy/Isolated)
- **Workspace Topic**: `workspaces/{workspaceId}/signal` (Enterprise Shared Awareness)

When an agent operates within a Workspace, all real-time signals (chunks, thoughts, tool calls) are broadcast to the Workspace Topic. This ensures that every human currently viewing the workspace has immediate visual parity with the agent's progress, regardless of who initiated the request.

#### Collision Prevention
To prevent "race-to-the-finish" bugs in shared sessions, the system utilizes **Distributed Locking**:
- **Agent Lock**: Prevents multiple agents from processing the same session concurrently.
- **Dashboard API Lock**: Prevents multiple humans from triggering concurrent agent loops in the same session.

```text
[ IdentityManager ] <---> [ Auth API ] <---> [ Dashboard Login ]
         |                       |
         +--> [ User Table ]     +--> [ JWT / Cookie Session ]
         |
         +--> [ Workspace Memberships ]
```

For detailed role hierarchies, user management workflows, and coordination diagrams, see [docs/interface/COLLABORATION.md](./docs/interface/COLLABORATION.md).

---

## 🛡️ Stability & Self-Healing

The system is designed for autonomous survival and continuous optimization through a multi-layered stability framework.

- **Distributed Locking**: DynamoDB-backed session integrity using `LockManager`. Ensures atomic execution across stateless boundaries.
- **Dead Man's Switch**: Automated recovery sequence (`RECOVERY` agent) for severe failure, including emergency git-reverts and health probes.
- **Autonomous Metabolism (Silo 7)**: Implements the **Regenerative Metabolism** philosophy. The `MetabolismService` autonomously identifies and repairs system debt:
  - **Surgical Pruning**: Atomically removes failing or low-utilization tool overrides from agent configurations (Principle 10).
  - **Memory Recycling**: Autonomously archives stale gaps and culls resolved inconsistencies from the knowledge base.
  - **Live Remediation**: Intercepts dashboard failure events to perform real-time registry repairs, maintaining system "flow" without human intervention.
- **Self-Evolution**: Continuous optimization loops based on telemetry and reputation, allowing the system to design its own upgrades.

### Silo 7: Regenerative Metabolism Flow

```text
[ Dashboard / Eye ] ---- (Failure Event + WSID) ----> [ MetabolismService ]
                                                             |
                                                    [ Strategy Selection ]
                                                             |
          +-------------------------+----------------+-------------------------+
          |                         |                                          |
[ Tool Pruning ]           [ Memory Recycling ]               [ Evolution Scheduling ]
(WS-Scoped Atomic)         (Gap/Insight Sync)                 (HITL Fallback)
          |                         |                                          |
          +-------------------------+----------------+-------------------------+
                                    |
                          [ System Flow Restored ]
````

| Component                 | Deep Dive                                                    |
| :------------------------ | :----------------------------------------------------------- |
| **Concurrency**           | [docs/system/CONCURRENCY.md](./docs/system/CONCURRENCY.md)   |
| **Evolution**             | [docs/system/EVOLUTION.md](./docs/system/EVOLUTION.md)       |
| **Resilience & Recovery** | [docs/system/RESILIENCE.md](./docs/system/RESILIENCE.md)     |
| **Metabolism**            | [docs/system/METABOLISM.md](./docs/system/METABOLISM.md)     |
| **Provisioning**          | [docs/system/PROVISIONING.md](./docs/system/PROVISIONING.md) |

For deep dives into these evolutionary mechanisms, see [docs/system/EVOLUTION.md](./docs/system/EVOLUTION.md) and [docs/system/RESILIENCE.md](./docs/system/RESILIENCE.md).

```

```
