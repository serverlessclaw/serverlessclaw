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

---

## ⚡ Efficiency: Trigger-on-Message Warm-up

To minimize AWS operational costs, Serverless Claw uses a dynamic warm-up strategy instead of persistent heartbeats:

1. **Passive Idling**: High-memory agents (Coder, Planner) remain idle and cost-free when no user interaction is occurring.
2. **Webhook Trigger**: Upon receiving a message (e.g., from Telegram), the [Webhook Handler](file:///Users/pengcao/projects/serverlessclaw/core/handlers/webhook.ts) immediately invokes a non-blocking `WARMUP` signal to critical agents.
3. **Just-in-Time Readiness**: By the time the `SuperClaw` orchestrator has finished parsing the intent and retrieved initial memory, the sub-agents have finished their cold-starts and are ready for high-speed execution.

---


## High-Level System Diagram

```text
+-------------------+       +-----------------------+       +-------------------+
| Messaging Client  +<----->+   AWS API Gateway     +------>+   AWS Lambda      |
| (Telegram/Slack)  |       | (Webhook Endpoint)    |       | (Agent Brain)     |
|                   |       |                       |       |         +         |
|                   |       |                       |       |         +         |
+-------------------+       +-----------+-----------+       +---------|---------+
                                        |                             |
                                        v                             |
                            +-----------+-----------+                 |
                            |                       |                 |
                            |      ClawCenter       |<----------------+
                            | (Intelligence Sector) |                 |
                            |                       |                 |
                            +-----------+-----------+                 |
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

## Distributed Concurrency
Serverless Claw uses **Distributed Locking** via DynamoDB to ensure session integrity in a stateless environment.
- **Deep Dive**: [Concurrency & Locking ↗](./docs/CONCURRENCY.md)

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
      |__________________|          (4) [ QA AUDITOR ]             |
          |         |                (Verifies Live & Syncs)       |
          |         |                 |                            |
     (2) CODER_AGENT|                 +-- triggerTrunkSync ------> [ CODEBUILD ]
         (Signals   |                                              (Sync Only)
          Results)  |                                              |
          |         |               (5) [ STRATEGIC PLANNER ]      |
          |         |                (Consulted via signalOrch)    |
          |         |                                              |
          |  (6) [ MERGER_AGENT ]                                  |
          |      (Semantic Reconcile)                              |
          |         |                                              |
          +---------+-----> [ EVENT_HANDLER_ROUTER ] --------------+
                    (build/continuation/task-result/parallel)
                    (signalOrchestration routes)
                    (Recursion Guard + Trace Propagation)
````

- **Pattern**: Standardized events (`CODER_TASK`, `EVOLUTION_PLAN`, `TASK_COMPLETED`, `TASK_FAILED`, `PARALLEL_TASK_DISPATCH`, `TASK_CANCELLED`) flow through the Bus.
- **Strategic Coordination**: Initiator agents use the `signalOrchestration` tool to provide deterministic logic when sub-agents report completion or failure. This tool acts as the state-machine for complex, multi-turn goals.
- **Atomic Trunk Sync**: The system follows a "Verification-First" sync model. Code lands in the trunk (Git) only after the `QA Auditor` has successfully verified the live environment and called `triggerTrunkSync`.
- **Relay Loop**: When a sub-agent emits `TASK_COMPLETED` or `TASK_FAILED`, the `EventHandler` routes it back to the `initiatorId` as a `CONTINUATION_TASK`.
- **Metadata**: Every event carries a standardized `traceId` (for visual DAG tracing) and a `depth` counter (for loop protection).
- **Recursion Control**: The `EventHandler` enforces a **Recursion Limit** (Default: 15), aborting flows that exceed it.
- **Discovery**: The `AgentRegistry` and `topology.ts` utility perform post-deployment discovery, merging backbone logic with user-defined personas.
- **Visualization**: The **System Pulse** map in ClawCenter renders a unified, resilient graph of these interactions, covering the full stack from API Gateway to individual agent tools.

### Plan Decomposition Flow

When the Strategic Planner generates a complex plan, it automatically decomposes it into sub-tasks for parallel execution:

```text
Strategic Planner          AgentBus (EB)          Coder Agent (xN)         Trace DAG (DDB)
       |                      |                      |                      |
       +-- decomposePlan ---->|                      |                      |
       |   (3 sub-tasks)      |                      |                      |
       |                      +-- CODER_TASK (1) --->|                      |--> [root-trace]
       |                      +-- CODER_TASK (2) --->|                      |   [child-1]
       |                      +-- CODER_TASK (3) --->|                      |   [child-2]
       |                 [TERMINATE]                 |                      |   [child-3]
       |                      |                      |                      |
       |                      |    [ALL COMPLETE]    |                      |
       |<-- CONTINUATION_TASK-+                      |                      |
       | (aggregated results) |                      |                      |
```

**Key Features:**

- **Automatic Decomposition**: Plans >500 chars are split into max 5 sub-tasks
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
 Domains          External Hub Model Native
 (Lambda)           (SSE)     (Provider)
    |          +------+------+ |
    |          |             | |
 - infra/      v             v - python
 - knowledge/ [ Hub ] ----> [ Local ] - search
 - system/    (Prim)  (Fallback) - files
 - collaboration/
```

### 1. Custom Skills (Internal)

Tools written specifically for the ServerlessClaw environment (e.g., `triggerDeployment`). These run within the agent's AWS Lambda execution context and are defined in `core/tools/`.

### 2. MCP Skills (External & Hybrid)

Connected via the **Model Context Protocol (MCP)**. This is the primary scaling vector for the system.

- **Hub-First Architecture (New in May 2026)**: The system prioritizes high-speed connections to an external MCP Hub via SSE. This minimizes Lambda startup latency (cold starts) and offloads resource-heavy tasks (like browser automation) to external infrastructure.
- **Graceful Local Fallback**: If the external Hub is unreachable or times out (5s limit), the `MCPBridge` seamlessly falls back to local spawning using `StdioClientTransport`.
- **Lambda Environment Hardening**:
  - **Memory/Timeout**: Backbone agents and the Dashboard server are provisioned with **2048MB** (LARGE) and **15m** (MAX) to handle concurrent MCP child processes.
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
