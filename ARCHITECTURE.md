# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents ↗](./docs/AGENTS.md) | [Memory ↗](./docs/MEMORY.md) | [LLM / Reasoning ↗](./docs/LLM.md) | [Tools ↗](./docs/TOOLS.md) | [Safety ↗](./docs/SAFETY.md)

This document covers the AWS topology and data flow. For agent logic and orchestration, see [docs/AGENTS.md](./docs/AGENTS.md).

## Design Philosophy

**Serverless Claw** is built to be:
1.  **Stateless**: The core execution is entirely stateless, with persistence offloaded to highly available managed services (DynamoDB). Utilizes a **Tiered Retention Policy** (TTL) and Global Secondary Index (GSI) for high-performance context recall.
2.  **Extensible**: Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
3.  **Low Latency**: Optimized for fast startup times to minimize "time-to-first-token".
4.  **Safety-First**: Implements nested guardrails including Circuit Breakers, Recursion Limits, and Protected Scopes.

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
                            |                       |                 |
                            |   Managed Services    |                 |
                            | (DynamoDB / S3)       |                 |
                            |                       |                 |
                            +-----------+-----------+                 |
                                        |                             |
                                        v                             |
                            +-----------+-----------+                 |
                            |                       |                 |
                            |  IoT Core (Realtime)  |<----------------+
                            |     (Dashboard)       |
                            |                       |
                            +-----------------------+
```

---

## Message Processing Flow

```text
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

---

## Multi-Modal Storage Flow

When a user sends media (photos, documents, voice) via Telegram, the system bridges it to internal storage before agent processing.

```text
User Event      Webhook         Telegram API      Staging Bucket (S3)    SuperClaw (Agent)
    |              |                |                    |                      |
    +------------->|                |                    |                      |
    |  (Media Msg) |                |                    |                      |
    |              +--------------->|                    |                      |
    |              | (Get File URL) |                    |                      |
    |              |<---------------+                    |                      |
    |              |                |                    |                      |
    |              +--------------->|                    |                      |
    |              |  (Download)    |                    |                      |
    |              |<---------------+                    |                      |
    |              |                |                    |                      |
    |              +------------------------------------>|                      |
    |              |         (S3 Upload / lifecycle)     |                      |
    |              |                |                    |                      |
    |              +----------------------------------------------------------->|
    |              |                |                    |    (Process w/ URL)  |
```

- **S3 Staging**: Media is stored in the `StagingBucket` with a 30-day TTL lifecycle policy.
- **Vision Integration**: For small images, the Webhook provides a Base64 string directly to the agent's Vision context for zero-latency analysis.

### Outbound Multi-Modal Flow
When an agent generates a result containing media (e.g., a Python chart or a screenshot), it is relayed via the AgentBus to the Notifier and the Dashboard.

```text
SuperClaw (Agent)      AgentBus (EB)         Notifier (Lambda)      Telegram API       Dashboard (IoT)
      |                    |                     |                     |                  |
      +------------------->|                     |                     |                  |
      | (OUTBOUND_MESSAGE) |                     |                     |                  |
      |  w/ Attachments    +-------------------->|                     |                  |
      |                    |                     |                     |                  |
      |                    |                     +-------------------->|                  |
      |                    |                     |   (Store in DDB)    |                  |
      |                    |                     |                     |                  |
      |                    |                     +-------------------->|                  |
      |                    |                     |    (sendMedia)      |                  |
      |                    |                     |                     +----------------->|
      |                    |                     |                     |   (MQTT Push)    |
```

- **Persistence**: Outbound attachments are stored in the `MemoryTable` along with the message text, enabling long-term recall and dashboard rendering.
- **Rendering**: The Dashboard component automatically detects attachment types and renders previews or download links based on MIME types.
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
      |__________________|          (4) [ REFLECTOR_AGENT ]        |
          |         |                (Signals Evolution Plans)     |
          |         |                                              |
     (2) CODER_AGENT|               (5) [ PLANNER_AGENT ]          |
         (Signals   |                (Signals Coder Tasks)         |
          Results)  |                                              |
          |         |               (6) [ WORKER_AGENT ]           |
          |         |                (Signals Dynamic Results)     |
          |         |                                              |
          +---------+-----> [ EVENT_HANDLER ] ---------------------+
                                (Callback & Relay)
                                (Recursion Guard)
                                (Trace Propagation)
                                        |
                                        +-----> [ NOTIFIER ]
                                        |       (Telegram/Slack)
                                        |
                                        +-----> [ REALTIME_BRIDGE ]
                                                (Dashboard IoT)
 ```

- **Pattern**: Standardized events (`CODER_TASK`, `EVOLUTION_PLAN`, `TASK_COMPLETED`, `TASK_FAILED`) flow through the Bus. 
- **Relay Loop**: When a sub-agent emits `TASK_COMPLETED` or `TASK_FAILED`, the `EventHandler` routes it back to the `initiatorId` as a `CONTINUATION_TASK`.
- **Metadata**: Every event carries a standardized `traceId` (for visual DAG tracing) and a `depth` counter (for loop protection).
- **Recursion Control**: The `EventHandler` enforces a **Recursion Limit** (Default: 5), aborting flows that exceed it.
- **Discovery**: The `AgentRegistry` and `topology.ts` utility perform post-deployment discovery, merging backbone logic with user-defined personas.
- **Visualization**: The **System Pulse** map in ClawCenter renders a unified, resilient graph of these interactions, covering the full stack from API Gateway to individual agent tools.


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
 Internal          External  Model Native
 (Lambda)          (Bridge)  (Provider)
    |                 |        |
 - deploy          - github  - python
 - memory          - slack   - search
 - health          - sql     - files
```

### 1. Custom Skills (Internal)
Tools written specifically for the ServerlessClaw environment (e.g., `triggerDeployment`). These run within the agent's AWS Lambda execution context and are defined in `core/tools/`.

### 2. MCP Skills (External Bridge)
Connected via the **Model Context Protocol (MCP)**. This is the primary scaling vector for the system.
- **Lazy Loading (Requested Tool Filtering)**: The `MCPBridge` ensures that external servers are only connected to when an agent's specific toolset requires them. This prevents resource waste and minimizes startup latency for agents that don't need external integrations.
- **Dynamic Spawning**: The `MCPBridge` uses `npx` to fetch and run servers on-demand based on the `mcp_servers` configuration in DynamoDB.
- **Curated Ecosystem**: Includes bootstrapped servers for `aws-ss3`, `google-search`, and `filesystem`.
- **Encapsulated Environments**: Servers run as independent sub-processes, ensuring isolation from the core agent runtime.
- **Persistence & Auditing**: Once an agent calls `registerMCPServer`, the server is recorded in the `ConfigTable`. Every subsequent tool call is tracked (count and last-used timestamp) to enable data-driven pruning.

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

## 📡 Real-time Communication (IoT Core)
To ensure the **ClawCenter Dashboard** receives instantaneous updates, we use a **Real-time Bridge** pattern over AWS IoT Core and MQTT.
- **Deep Dive**: [Real-time Signaling ↗](./docs/REALTIME.md)

### 5. Channel Adapters (Fan-Out)
Instead of hardcoding API requests to a single platform, agents emit an `OUTBOUND_MESSAGE` event onto the AgentBus.
- **Notifier Handler**: A dedicated lightweight Lambda (`src/handlers/notifier.ts`) listens to these events.
- **Multi-Channel**: The Notifier reads user preferences from the `ConfigTable` and fans the message out to the appropriate adapters (Telegram, Slack, and the **Real-time Signal Bridge**).

## 🔄 Self-Evolution & Stability
The system's evolution is a co-managed process between the **Strategic Planner** and the **Human Admin**. Resilience is ensured via **Structured Signaling** (JSON-based status) and **Atomic Deployment Mapping** (direct gap-to-build syncing).
- **Deep Dive**: [Self-Evolution ↗](./docs/EVOLUTION.md)
- **Deep Dive**: [Health & Recovery ↗](./docs/HEALTH.md)

### Evolution Safeguards
- **Structured JSON Hub**: Agents emit deterministic signals (`SUCCESS`, `FAILED`, `REOPEN`) rather than brittle free-text responses.
- **Atomic Metadata Sync**: The `triggerDeployment` tool handles gap-to-build mapping internally to prevent metadata loss.
- **Deep Health Probes**: The Dead Man's Switch verifies both API responsiveness and backbone connectivity (EventBus).


### 4. LLM Providers
Provider-agnostic interface supporting:
- OpenAI (GPT-5.4 / GPT-5-mini)
- Anthropic (Claude 4.6 Sonnet)
- Google (Gemini-3 Flash, GLM-5, Minimax 2.5)
- Local models (via Ollama or AWS Bedrock)

#### Reasoning Engine & Adapters
The system uses a unified **Reasoning Adapter** to map logical "Thinking" states to provider-specific APIs.

```text
 [ ReasoningProfile ]
 (FAST, STANDARD, THINKING, DEEP)
          |
          v
 [ Reasoning Mapper ] -----------------+
 (effort, budget, temp)                |
          |                            |
  +-------+-------+           +--------v--------+
  | OpenAI Adapter|           | Bedrock Adapter |
  | (Responses API)|           | (Converse API)  |
  +-------+-------+           +--------+--------+
          |                            |
          v                            v
   /v1/responses              ConverseCommand
```

For a deep dive into the reasoning profiles and the OpenAI Response API bridge, see [docs/LLM.md](./docs/LLM.md).
