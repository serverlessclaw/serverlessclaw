# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents ↗](./docs/AGENTS.md) | [Memory ↗](./docs/MEMORY.md) | [LLM / Reasoning ↗](./docs/LLM.md) | [Tools ↗](./docs/TOOLS.md) | [Safety ↗](./docs/SAFETY.md)

This document covers the AWS topology and data flow. For agent logic and orchestration, see [docs/AGENTS.md](./docs/AGENTS.md).

## Design Philosophy

**Serverless Claw** is built to be:

1.  **Stateless**: The core execution is entirely stateless, with persistence offloaded to highly available managed services (DynamoDB). Utilizes a **Tiered Retention Policy** (TTL) and Global Secondary Index (GSI) for high-performance context recall.
2.  **Extensible**: Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
3.  **Low Latency**: Optimized for fast startup times to minimize "time-to-first-token". Implements **Real-time Streaming** via IoT Core (MQTT) to provide instantaneous feedback to human users during long-running reasoning tasks.
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

## Input Adapter Layer

Serverless Claw uses a pluggable **Input Adapter** architecture to receive events from external systems. All adapters implement the `InputAdapter` interface, normalizing diverse webhook payloads into a common `InboundMessage` format.

```text
[ External System ]        [ Input Adapter ]        [ InboundMessage ]
+----------------+         +----------------+       +------------------+
| Telegram       | ------> | TelegramAdapter| ----> | { source, userId,|
| Webhook        |         |                |       |   sessionId, text}|
+----------------+         +----------------+       |   attachments,   |
                                                   |   metadata }     |
+----------------+         +----------------+       +--------|---------+
| GitHub         | ------> | GitHubAdapter  | ---->          |
| Webhook/API    |         |                |                v
+----------------+         +----------------+       +------------------+
| Jira           | ------> | JiraAdapter    | ----> | SuperClaw.process|
| Webhook/API    |         |                |       +------------------+
+----------------+         +----------------+
| Generic HTTP   | ------> | GenericHTTP    |
| Webhook        |         | Adapter        |
+----------------+         +----------------+
```

### Adapter Directory Structure

```
core/adapters/
├── input/                 # Input adapters (external -> internal)
│   ├── types.ts          # InputAdapter interface, InboundMessage schema
│   ├── telegram.ts       # Telegram webhook parser + media processing
│   ├── github.ts         # GitHub webhooks (issues, PRs, comments) + API
│   ├── jira.ts           # Jira webhooks (issues, comments) + API
│   ├── generic-http.ts   # Generic HTTP webhook receiver
│   └── index.ts          # Barrel exports
└── output/               # Output adapters (internal -> external)
    ├── types.ts          # OutputAdapter interface, OutboundMessage schema
    └── index.ts          # Barrel exports
```

### Adding a New Input Adapter

1. Create `core/adapters/input/<name>.ts` implementing the `InputAdapter` interface
2. Define a Zod schema for the external payload format
3. Implement `parse(raw: unknown): InboundMessage` to normalize the payload
4. Optionally implement `processMedia(message)` for attachment handling
5. Optionally add API methods (e.g., `createIssue`, `addComment`) for outbound actions
6. Export from `core/adapters/input/index.ts`
7. Add tests to `core/adapters/__tests__/adapters.test.ts`

### Splitting Adapters to Separate Repos

Adapters are designed to be extractable into separate npm packages when needed:

**Signs it's time to split:**

- Different release cadence than core
- External contributor/maintainer
- Independent deployment lifecycle

**How to split:**

1. Move adapter file to new repo (e.g., `serverlessclaw-integration-github`)
2. Publish as `@claw/integration-github`
3. Update core to import from package instead of local file
4. No other code changes needed — interface remains the same

---

## Message Processing Flow

````text
User Event      Webhook         AgentBus         LLM Agent        Memory           IoT Bridge       Dashboard
    |              |                |                |                |                 |               |
    +------------->|                |                |                |                 |               |
    |              +--------------->|                |                |                 |               |
    |              |   (Msg Event)  |                |                |                 |               |
    |              |                +--------------->|                |                 |               |
    |              |                |  (Task Event)  |                |                 |               |
    |              |                |                +--------------->|                 |               |
    |              |                |                |  (Get History) |                 |               |
    |              |                |                |<---------------+                 |               |
    |              |                |                |                |                 |               |
    |              |                |                +--------------------------------->|               |
    |              |                |                |       (Emit Signaling Event)    |               |
    |              |                |                |                |                 +-------------->|
    |              |                |                |                |                 |    (Push)     |
    |              |                |                |                |                 |               |
    |              |<---------------+                |                |                 |               |
    |<-------------+  (HTTP 200)    |                |                |                 |               |
Response

### Multi-Modal Storage & Reasoning Flow

Serverless Claw supports native vision and file analysis by staging media in S3 and providing JIT base64 or URL pointers to multi-modal LLMs.

```text
User (Media)      Webhook (Lambda)      S3 Staging       DynamoDB (Mem)      LLM Agent
     |                 |                   |                 |                 |
     +--- (Image) ---->|                   |                 |                 |
     |                 +--- (1) Download ->|                 |                 |
     |                 +--- (2) Upload --->|                 |                 |
     |                 |                   |                 |                 |
     |                 +--- (3) Record Metadata (URL/Type) ->|                 |
     |                 |                   |                 |                 |
     |                 |             [ LATER: Reasoning ]    |                 |
     |                 |                   |                 +--- (4) Fetch -->|
     |                 |                   |                 |      History    |
     |                 |                   |                 |                 |
     |                 |                   |<--- (5) JIT Data/Base64 ----------+
     |                 |                   |                 |                 |
     |                 |                   |                 +--- (6) Vision ->|
     |                 |                   |                 |      Analysis   |
```

---

## Distributed Concurrency & LLM Locking
Serverless Claw uses **Distributed Locking** via DynamoDB to ensure session integrity in a stateless environment.

### 1. LLM Reasoning Lock
To prevent multiple agents from simultaneously modifying the same session history (which leads to corrupted context), the system implements a **Session-Level Reasoning Lock** in `processEventWithAgent`.

- **Mechanism**: Before an agent starts its reasoning loop, it attempts to acquire a lock via `SessionStateManager.acquireProcessing(sessionId)`.
- **Busy State**: If the lock is held by another agent, the incoming task is automatically added to the session's `pendingMessages` queue and marked as `[QUEUED]`.
- **Automatic Release**: The lock is guaranteed to be released in a `finally` block, even if the agent crashes or exceeds its timeout.

### 2. Deep Dive
- **Concurrency Implementation**: [Concurrency & Locking ↗](./docs/CONCURRENCY.md)

---

## 💰 Token Budgeting & Cost Control
Serverless Claw implements a multi-tier budgeting system to prevent runaway costs during complex, multi-agent reasoning cycles.

### 1. Per-Agent Configuration
Agents can be configured with a default `tokenBudget` and `costLimit` in their `IAgentConfig`. These limits represent the maximum consumption allowed for a single reasoning turn.

### 2. Continuation Tracking
For long-running tasks that span multiple Lambda invocations (via `CONTINUATION_TASK`), the system tracks cumulative consumption through the `priorTokenUsage` object. This ensures that the total budget is enforced across the entire task lifecycle.

- **`inputTokens`**: Cumulative tokens sent to the LLM.
- **`outputTokens`**: Cumulative tokens generated by the LLM.
- **`totalTokens`**: Sum of input and output tokens.

### 3. Enforcement
The `Agent` executor monitors real-time usage. If a task exceeds its allocated budget or cost limit, the execution is paused or failed based on the agent's `timeoutBehavior` policy, and a `TASK_FAILED` or `TASK_PAUSED` event is emitted with a descriptive budget-exceeded message.

---

## Multi-Agent Orchestration (EventBridge)

Agents communicate asynchronously using **AWS EventBridge (The AgentBus)**. This is the **spine** of the system, allowing components to remain decoupled.

 ```text
 [ Messaging ]     [ ClawCenter ]
      |                 |
      +--------+--------+
               |
      _________V_________
     |                   |
     |   SUPERCLAW       | <---------------------------------------+
     | (Orchestrator)    |                                         |
     |___________________|                                         |
               |                                                   |
     (1) DISPATCH_TASK (via AgentBus)                              |
               |                                                   |
       ________V_________           (3) [ BUILD_MONITOR ]          |
      |    EVENT_BUS     | <-------  (Signals Build Status)        |
      |   (AgentBus)     |                                         |
      |__________________|          (4) [ STANDARD BUCKET ]        |
          |         |                (QA / Facilitator)            |
          |         |                 |                            |
     (2) [ HIGH BUCKET ]              +-- triggerTrunkSync ------> [ CODEBUILD ]
         (Coder/Researcher)                                        (Sync Only)
          |         |                                              |
          |         |               (5) [ LIGHT BUCKET ]           |
          |         |                (Critic/Merger/Reflector)     |
          |         |                                              |
          +---------+-----> [ EVENT_HANDLER_ROUTER ] --------------+
                    (build/continuation/task-result/parallel)
                    (STRATEGIC_TIE_BREAK / PROACTIVE_EVOLUTION)
                    (DAG_TASK_COMPLETED / DAG_TASK_FAILED)
                    (DAG_SUPERVISOR_HANDLER)
                    (signalOrchestration routes)
                    (Recursion Guard + Trace Propagation)
````

- **Pattern**: Standardized events (`CODER_TASK`, `EVOLUTION_PLAN`, `TASK_COMPLETED`, `TASK_FAILED`, `PARALLEL_TASK_DISPATCH`, `TASK_CANCELLED`) flow through the Bus.
- **DAG Supervisor**: A specialized `DAG_SUPERVISOR_HANDLER` manages dependency-aware parallel workflows. It processes `DAG_TASK_COMPLETED` signals to update the central graph state and dispatch the next set of ready tasks, ensuring efficient, non-blocking execution of complex plans.

---

## 🔒 Distributed Locking & Reliability

Serverless Claw implements multiple layers of coordination and storage reliability to handle high-concurrency agentic workflows in a stateless environment.

### 1. Lock Heartbeat Mechanism

To prevent session "dead zones" caused by crashed or timed-out Lambda processes, the system uses a **Heartbeat-enabled Leasing** model for session locks.

- **Dynamic Renewal**: While an agent is processing, a background heartbeat periodically (every 60s) renews the session lock in DynamoDB.
- **Crash Recovery**: If an execution environment fails, the heartbeat stops, and the lock naturally expires within a few minutes, allowing the session to remain responsive to new signals without manual intervention.

### 2. Result Sharding (Aggregation Scaling)

To overcome DynamoDB's 400KB item size limit during large-scale parallel fan-outs (e.g., researching hundreds of topics simultaneously), the `ParallelAggregator` implements **Automatic Sharding**.

- **Spill-to-Shard**: When the main aggregation record approaches the size limit, new results are "spilled" into separate DynamoDB items (`PARALLEL_SHARD#`).
- **Transparent Merging**: The system automatically fetches and merges these shards when retrieving the overall state, allowing for virtually unlimited scaling of parallel agent results.

### 3. Session Concurrency & Queuing

The `SessionStateManager` ensures that only one agent is modifying a session's "brain" at any given time.

- **Atomic Acquisition**: Uses DynamoDB conditional updates to ensure mutually exclusive access.
- **Intelligent Queuing**: If a session is busy when a new message arrives, the message is durably queued in `pendingMessages`, ensuring no user or system signal is lost during heavy processing.
- **Strategic Coordination**: Initiator agents use the `signalOrchestration` tool to provide deterministic logic when sub-agents report completion or failure. This tool acts as the state-machine for complex, multi-turn goals.
- **Atomic Trunk Sync**: The system follows a "Verification-First" sync model. Code lands in the trunk (Git) only after the `QA Auditor` has successfully verified the live environment and called `triggerTrunkSync`.
- **Relay Loop**: When a sub-agent emits `TASK_COMPLETED` or `TASK_FAILED`, the `EventHandler` routes it back to the `initiatorId` as a `CONTINUATION_TASK`.
- **Metadata**: Every event carries a standardized `traceId`, `taskId`, and `sessionId`. These are now automatically generated by `BASE_EVENT_SCHEMA` if not provided, ensuring visual DAG tracing and isolation across all agentic flows. A `depth` counter is also included for loop protection.
- **Recursion Control**: The `EventHandler` enforces a **Recursion Limit** (Default: 15), aborting flows that exceed it.

### Secure Event Routing Allowlist

To protect against misconfigured or tampered runtime routing, the `EventHandler` now validates all DDB-loaded `event_routing_table` entries against a hardcoded allowlist derived from `DEFAULT_EVENT_ROUTING`.

```text
[ConfigTable: event_routing_table]
            |
            v
   [EventHandler Routing Load]
            |
            v
 [Allowlist Check Against DEFAULT_EVENT_ROUTING Modules]
       |                               |
       | valid                         | unrecognized
       v                               v
 [Use DDB Entry]                 [Block + Warn + Use Default]
       \_______________________________/
                     |
                     v
               [Dynamic Handler Import]
```

- **Discovery**: The `AgentRegistry` and `topology.ts` utility perform post-deployment discovery, merging backbone logic with user-defined personas.
- **Visualization**: The **System Pulse** map in ClawCenter renders a unified, resilient graph of these interactions, covering the full stack from API Gateway to individual agent tools.

- **DAG-Based Dependencies**: Sub-tasks can declare `dependsOn` edges for sequential execution
- **Complexity Estimation**: Each sub-task gets a complexity score (1-10) for resource allocation
- **Parallel Dispatch**: Sub-tasks dispatched via `PARALLEL_TASK_DISPATCH` event
- **Trace Linking**: Parent-child relationships tracked via `traceId` DAG

---

## Multi-Party Collaboration (Facilitator-Moderated Sessions)

When tasks require negotiation or peer review between multiple agents, the system creates a **Shared Collaboration Session** moderated by the **Facilitator Agent**. The Facilitator is automatically injected as an `editor` participant and woken up via `emitTypedEvent` on every collaboration creation.

```text
 Initiator (Planner)       createCollab()         AgentBus (EB)        Facilitator           Sub-Agents (xN)       DynamoDB
        |                      |                      |                    |                      |                    |
        +-- (1) createCollab ->|                      |                    |                      |                    |
        |                      +--- [AUTO-INJECT] --->|                    |                      |                    |
        |                      |   Facilitator as     |                    |                      |                    |
        |                      |   'editor'           |                    |                      |                    |
        |                      |                      +-- facilitator_task>|                      |                    |
        |                      |                      |   (Wake Up)        |                      |                    |
        |                      +------------------------------------------+--------------------->|                    |
        |                      |                      |                    |                 [CREATE Session]          |
        |                      |                      |                    |                      |                    |
        +-- (2) writeTo ->     |                      |                    +-- getCollabCtx ---->|                    |
        |    (Plan/Prompt)     |                      |                    |                    +-- join ----------->|
        |                      |                      |                    |                    |                    |
        |                      |                      |           [MODERATOR LOOP]              |                    |
        |                      |                      |                    +-- getCollabCtx --->|                    |
        |                      |                      |                    +-- writeTo ------->|  [READ Context]    |
        |                      |                      |                    |  (Summaries,      |                    |
        |                      |                      |                    |   turn prompts)   |  [WRITE Verdict]   |
        |                      |                      |                    |                    |                    |
        |             [ CONSENSUS REACHED ]           |                    |                    |                    |
        |                      |                      |                    |                    |                    |
        +-- (3) closeCollab -->|                      |                    +--------------------+--------------------+
        |    (Owner only)      |                      |                    |                    |              [ARCHIVE]
        v                      v                      v                    v                      v                    v
```

- **Deep Dive**: [Agent Roles & Collaboration ↗](./docs/AGENTS.md)

---

## Workspace Architecture (Multi-Tenant Multi-Human)

The system supports multi-human multi-agent collaboration through **Workspaces** — a shared context primitive with role-based access control.

```text
+-------------------+       +-----------------------+
|   Human A         +<----->+    Workspace          |
|   (Telegram)      |       |                       |
+-------------------+       |  Members:             |
                            |  - Human A (owner)    |
+-------------------+       |  - Human B (collab)   |
|   Human B         +<----->+  - Agent Coder (edit) |
|   (Dashboard)     |       |  - Agent QA (observer)|
+-------------------+       |                       |
                            |  Sessions:            |
+-------------------+       |  - Collab#abc123      |
|   Agent Swarm     +<----->+  - Collab#def456      |
|   (AgentBus)      |       |                       |
+-------------------+       +-----------------------+
```

**Key Components:**

- **IdentityManager** (`core/lib/identity.ts`): Authentication, RBAC, session management
- **Workspace Operations** (`core/lib/memory/workspace-operations.ts`): CRUD for workspaces and members
- **Role Hierarchy**: owner > admin > collaborator > observer
- **Channel Profiles**: Human members have Telegram, Discord, Slack, Dashboard, or Email channels
- **Workspace-Aware Collaboration**: Sessions can be scoped to a workspace, auto-adding all members

**Tools**: `createWorkspace`, `inviteMember`, `updateMemberRole`, `removeMember`, `getWorkspace`, `listWorkspaces`

- **Deep Dive**: [Agent Roles & Collaboration ↗](./docs/AGENTS.md)

---

## 📈 Unified Tracing Architecture

Serverless Claw uses a **Branched Neural Path Tracing** model to visualize complex, parallel multi-agent workflows as a Directed Acyclic Graph (DAG).

- **Deep Dive**: [Tracing & DAG Model ↗](./docs/TRACING.md)

---

## 🦾 Hybrid Skill-Based Tooling

Serverless Claw has evolved from static tools to a **Dynamic Skill Architecture**, supporting three tiers of capabilities.

```text
      [ Agent Brain ]
             |
    _________V_________
   |   Skill Registry  | <--- (Just-in-Time Discovery)
   |___________________|
             |
    +--------+--------+--------+
    |                 |        |
 [ Custom ]        [ MCP ]  [ Built-in ]
 Domains        Multiplexer   Native
 (Lambda)         (Lambda)    (Provider)
    |          +------+------+ |
    |          |             | |
 - infra/      v             v - python
 - knowledge/ [ Git ] ----> [ FS ] - search
 - system/    [ S3  ]       [ AWS] - files
 - collab/
```

### 1. Custom Skills (Internal)

Tools written specifically for the ServerlessClaw environment (e.g., `triggerDeployment`). These run within the agent's AWS Lambda execution context and are defined in `core/tools/`.

### 2. MCP Skills (Unified Multiplexer Model)

Connected via the **Model Context Protocol (MCP)**. This is the primary scaling vector for the system.

- **Unified Multiplexer Architecture (New in June 2026)**: The system consolidates multiple MCP servers (Git, Filesystem, AWS, etc.) into a single **Unified Multiplexer Lambda**. This reduces infrastructure sprawl, minimizes CloudWatch log fragmentation, and improves warming efficiency by keeping a single high-resource execution environment hot.
- **Path-Based Routing**: The bridge routes requests to specific "virtual" servers using URL paths (e.g., `/mcp/git`) or the `x-mcp-server` header.
- **Graceful Local Fallback**: If the external Hub or Multiplexer is unreachable, the system falls back to on-demand `npx` execution within the calling agent's context.
- **Lambda Environment Hardening**:
  - **Memory/Timeout**: The Multiplexer is provisioned with **1024MB** (MEDIUM_LARGE) and **10m** (LONG) timeout to handle concurrent child processes and resource-heavy tools like Puppeteer.
  - **Writable Cache**: Uses `/tmp/mcp-cache` and `/tmp/npm-cache` to ensure `npx` has a writable scratch space in the read-only Lambda environment.
- **Lazy Loading**: External servers are only connected to when an agent's specific toolset requires them.
- **Dynamic Spawning**: Uses `npx` to fetch and run fallback servers on-demand.

### 3. Built-in Skills (Model-Native)

Native capabilities provided by the LLM provider (e.g., OpenAI's **Code Interpreter** or Gemini's **Grounded Search**). The system passes these through while maintaining trace visibility.

### 4. Multi-Modal Capability

Tools can now return **Structured Results** (`ToolResult`) containing text, images, and file metadata, allowing agents to "see" charts generated by Python or screenshots from a browser.

---

## 🧠 Infrastructure Discovery

The system implements a **Self-Aware Infrastructure** model where the topology is discovered post-deployment rather than hardcoded.

```text
 [ ClawCenter ] <--- (Query) --- [ API Gateway ]
                                       |
 [ ConfigTable ] <--- (Store) --- [ Build Monitor ]
                                       |
 [ Infrastructure ] <--- (Scan) -------+
```

- **Deep Dive**: [Infra & Discovery ↗](./docs/INFRASTRUCTURE.md)

---

## Developer Customization

Serverless Claw is designed to be highly customizable at every layer.

### 1. Self-Aware & Evolutionary

Serverless Claw isn't just a collection of scripts; it's a **living system**. It maintains a real-time topology of its own infrastructure and agent connections. The **Build Monitor** automatically scans the stack after every deployment to update the **System Pulse** map. Evolution follows a strict, verified lifecycle (**OPEN** → **PLANNED** → **PROGRESS** → **DEPLOYED** → **DONE**).

### 2. The Smart Recall Tool

Instead of loading all memories into every prompt, agents use `recallKnowledge(query)`.

- **Workflow**: SuperClaw sees a `[MEMORY_INDEX]`. If it needs details, it calls the tool.
- **Efficiency**: Reduces input token costs by up to 90% for long-lived sessions.

### 3. Dynamic Tool Scoping & Discovery

Agents no longer load the entire tool catalog.

- **Registry**: The `AgentRegistry` stores the allowed tool names and system prompts for each agent. It merges backbone defaults from `backbone.ts` with dynamic overrides in DynamoDB.
- **Autonomous Expansion**: Agents can use `discoverSkills` to find new capabilities in the marketplace and `installSkill` to permanently add them to their own (and others') rosters.
- **Standard Support Profile**: Dynamic agents are automatically injected with core tools (`recallKnowledge`, `listAgents`, `dispatchTask`, `discoverSkills`) to ensure baseline intelligence and collaboration.
- **Co-Management**: The **ClawCenter** dashboard serves as the UI for the registry, allowing zero-downtime hot-swaps and (coming soon) usage tracking.

### 4. Memory Adapters

While the default uses DynamoDB, the system can be adapted to use:

- **Redis (Upstash)** for even lower latency.
- **PostgreSQL (Drizzle/Prisma)** for complex relational memory.
- **S3** for long-term archival.

### 5. Searchable Memory Model (Flattened)

To support sub-50ms context retrieval across millions of records, the system uses a **Flattened DynamoDB Model**. Searchable fields are projected at the root level to maximize GSI efficiency.

```text
[ Record Root ]
 ├── userId (PK)         <-- Scoped partition
 ├── timestamp (SK)      <-- Unique ID
 ├── type (GSI-PK)       <-- Category
 ├── tags (GSI-Filter)   <-- Consolidated keywords
 ├── orgId               <-- Multi-tenant isolation
 ├── createdAt           <-- Immutable source
 └── [ metadata ]        <-- Strategic scores (confidence, priority)
```

This architecture ensures that agents can perform complex keyword and category searches without expensive table scans or deep-nested attribute filtering.

## 🔄 Self-Evolution & Stability

The system's evolution is a co-managed process between the **Strategic Planner** and the **Human Admin**. Resilience is ensured via **Structured Signaling** (JSON-based status) and **Atomic Deployment Mapping** (direct gap-to-build syncing).

- **Deep Dive**: [Self-Evolution ↗](./docs/EVOLUTION.md)
- **Deep Dive**: [Health & Recovery ↗](./docs/HEALTH.md)

### Self-Optimization Feedback Loop

To ensure the system remains efficient, a continuous optimization loop runs in the background.

```text
    [ Execution ] <----------- (6) selectBestAgent() ----------- [ AgentRouter ]
          |                                                            ^
    (1) recordToolUsage()                                              |
          |                                                   (5) getMetrics()
    +-----v-----+          (7) updateReputation()               +-------+-------+
    |  Token    | <----------- (4) fetchToolUsage() ---+        |  Reputation   |
    |  Tracker  | <---+                                 |        |  (7-day roll) |
    +-----+-----+     |                                 |        +-------+-------+
          |           |                                 |                ^
    (2) recordFailure |                                 |      (8) getReputation()
          |                                                   |                |
    +-----v-----+                                             +        | Reputation    |
    |  Memory   | <----------------------------------------------------| Handler       |
    |  (Insights)|                                                      +-------+-------+
          ^                                                                      ^
          |                                                                      |
          +------------------ [ Strategic Planner ] <----------- (7) REPUTATION_UPDATE
                                (Design Phase)                           |
                                                                 +-------+-------+
                                                                 | EventHandler  |
                                                                 | (on result)   |
                                                                 +---------------+
```

1. **Telemetry**: The `Executor` captures token usage, duration, and success for every tool call.
2. **Failure Learning**: The `Cognition Reflector` captures persistent failure patterns (anti-patterns) in `Memory`.
3. **Pattern Retrieval**: The `Strategic Planner` retrieves relevant failures before designing plans.
4. **Tool Audit**: The `Strategic Planner` identifies anomalous tools (high cost/low success) from `TokenTracker` rollups.
5. **Analytics**: The `AgentRouter` aggregates historical performance metrics from the `TokenTracker`.
6. **Routing**: The `AgentRouter` uses performance rollups AND reputation scores (success rate, latency, recency) to select the best agent. Formula: `(0.6 * performanceScore) + (0.4 * reputationScore)`.
7. **Reputation Tracking**: The `EventHandler` updates agent reputation on every `TASK_COMPLETED` and `TASK_FAILED` event (via `REPUTATION_UPDATE`).
8. Reputation Retrieval: The AgentRouter fetches reputation data for composite routing decisions.

### Evolution Safeguards

- **Intent-Based Dual Mode**: Agents toggle between **JSON Mode** (for strict handoffs and state sync) and **Text Mode** (for user-facing empathy).
- **Structured JSON Hub**: When in JSON mode, agents emit deterministic signals (`SUCCESS`, `FAILED`, `REOPEN`) matching a strict native schema.
- **Atomic Metadata Sync**: The `triggerDeployment` tool handles gap-to-build mapping internally to prevent metadata loss.
- **Deep Health Probes**: The Dead Man's Switch verifies both API responsiveness and backbone connectivity (EventBus).

### Dead Man's Switch Recovery Loop (15-min Cadence)

```text
 [ Scheduler ] --rate(15m)--> [ DeadMansSwitch ]
                     |
                     +--> checkCognitiveHealth()
                     |    (Bus + Tools + Providers)
                     |
                     +--> FAIL: acquire recovery lock (20m TTL)
                        |
                        +--> increment recovery_attempt_count
                        |        |
                        |        +--> >2 attempts: emit OUTBOUND_MESSAGE (critical escalation)
                        |
                        +--> load LKG hash from MemoryTable
                        |
                        +--> CodeBuild StartBuild
                            (EMERGENCY_ROLLBACK=true, LKG_HASH=...)
```
