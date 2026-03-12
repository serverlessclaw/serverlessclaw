# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents ↗](./docs/AGENTS.md) | [Memory ↗](./docs/MEMORY.md) | [LLM / Reasoning ↗](./docs/LLM.md) | [Tools ↗](./docs/TOOLS.md) | [Safety ↗](./docs/SAFETY.md)

This document covers the AWS topology and data flow. For agent logic and orchestration, see [docs/AGENTS.md](./docs/AGENTS.md).

## Design Philosophy

**Serverless Claw** is built to be:
1.  **Stateless**: The core execution is entirely stateless, with persistence offloaded to highly available managed services (DynamoDB).
2.  **Extensible**: Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
3.  **Low Latency**: Optimized for fast startup times to minimize "time-to-first-token".

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
                            | (Co-Management Hub)   |                 |
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
```

---

## Concurrency & Session Isolation

Unlike traditional agent servers that process messages serially, Serverless Claw uses **Distributed Locking** via DynamoDB to ensure session integrity in a stateless environment.

```text
[User Msg A] -> [Lambda 1] -> [Acquire Lock] -> [ EXECUTE ]
[User Msg B] -> [Lambda 2] -> [ Lock Check ] -> [ FAIL/EXIT ]
[User Msg C] -> [Lambda 3] -> [ Lock Check ] -> [ FAIL/EXIT ]
```

- **Mechanism**: A `LOCK#<chatId>` item is created in `MemoryTable` with a TTL.
- **Observability**: The Dashboard's `SESSION_TRAFFIC` tab monitors these locks.
- **Self-Healing**: If a Lambda crashes, the lock can be manually cleared or will auto-expire, preventing session deadlocks.

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
     |   SUPERCLAW    |
     |___________________|
               |
     (1) DISPATCH_TASK (via AgentBus)
               |
       _________V_________           (3) [ BUILD_MONITOR HANDLER ]
      |    EVENT_BUS      | <-------  (Observes CodeBuild)
      |   (AgentBus)      |
      |___________________|          (4) [ REFLECTOR_AGENT ]
          |         |                 (Mechanical Audit via Traces)
          |         |
     (2) CODER_AGENT|                (5) [ PLANNER_AGENT ]
         (Writes Code)                (Designs STRATEGIC_PLAN)
                    |
                    |                (6) [ NOTIFIER_HANDLER ]
                    +-----------------> (Listens for OUTBOUND_MESSAGE)
                    |                    (Sends to Telegram/Slack)
                    |
                    |                (7) [ WORKER_AGENT ]
                    +-----------------> (Generic Runner for Custom Nodes)
                                         (Loads Persona from AgentRegistry)
 ```

- **Pattern**: The SuperClaw emits a `coder_task` or `custom_task` event. Specialized tasks go to backbone agents, while generic tasks are picked up by the **Worker Agent**.
- **Discovery**: The `AgentRegistry` merges backbone logic with user-defined personas from DynamoDB.
- **Visualization**: The **ClawCenter Dashboard** (`SYSTEM_PULSE`) fetches a unified graph via `/api/infrastructure` and renders it using React Flow.

---

## 🧠 Self-Aware Topology Discovery

Serverless Claw implements a **Self-Aware Infrastructure** model. Rather than relying on hardcoded diagrams, the system discovers its own topology post-deployment.

### The Discovery Flow
1. **Deployment**: The `Coder Agent` triggers a CodeBuild deployment.
2. **Observation**: The `Build Monitor` receives the `SUCCEEDED` event.
3. **Scan**: The monitor calls `discoverSystemTopology()`, which:
    - Scans the SST `Resource` object for infrastructure (S3, DynamoDB, EventBridge).
    - Scans the `AgentRegistry` for LLM agents and logical handlers.
    - Resolves connections based on the `connectionProfile` defined in `core/lib/backbone.ts`.
4. **Persistence**: The resulting JSON graph (nodes + edges) is saved to the `ConfigTable` under the `system_topology` key.
5. **Visualization**: The dashboard updates **automatically** without any frontend code changes.

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
- **Mechanism**: Every agent call triggers `getAgentTools(agentId)`.
- **Registry**: The `AgentRegistry` stores the allowed tool names and system prompts for each agent, pulling from `backbone.ts`.
- **Standard Support Profile**: Dynamic agents are automatically injected with core tools (`recallKnowledge`, `listAgents`, `dispatchTask`) to ensure baseline intelligence and collaboration.
- **Co-Management**: The **ClawCenter** dashboard serves as the UI for the registry, allowing zero-downtime hot-swaps.

### 4. Memory Adapters
While the default uses DynamoDB, the system can be adapted to use:
- **Redis (Upstash)** for even lower latency.
- **PostgreSQL (Drizzle/Prisma)** for complex relational memory.
- **S3** for long-term archival.

## 📡 Real-time Communication (IoT Core)

To ensure the **ClawCenter Dashboard** receives instantaneous updates without polling, we use a **Real-time Bridge** pattern over AWS IoT Core.

```text
 [ Agent / Handler ]
          |
   (Publish Event)
          |
          v
 [ AgentBus (EventBridge) ]
          |
      (Rule Match)
          |
          v
 [ Realtime Bridge (Lambda) ]
          |
   (re-wrap & publish)
          |
          v
 [ AWS IoT Core (MQTT) ] ----> [ Dashboard (React Flow) ]
 (Topic: users/{id}/signal)      (Instant Neural Pulse)
```

- **Efficiency**: Reduces latency from seconds (polling) to milliseconds (push).
- **Scale**: Supports thousands of concurrent dashboard users via MQTT.

### 5. Channel Adapters (Fan-Out)
Instead of hardcoding API requests to a single platform, agents emit an `OUTBOUND_MESSAGE` event onto the AgentBus.
- **Notifier Handler**: A dedicated lightweight Lambda (`src/handlers/notifier.ts`) listens to these events.
- **Multi-Channel**: The Notifier reads user preferences from the `ConfigTable` and fans the message out to the appropriate adapters (Telegram, Slack, and the **Real-time Signal Bridge**).

## Self-Management & Orchestration

Serverless Claw is designed to evolve itself and manage complex agent hierarchies.

### 1. Evolution Control (Auto vs HITL)
The `evolution_mode` key in the `ConfigTable` dictates how the system upgrades itself:
- **`hitl` (Default)**: The Planner designs a capability upgrade but requires the user to explicitly reply "APPROVE" on messaging channels.
- **`auto` (Dangerous)**: The Planner agent directly publishes a `CODER_TASK` to the AgentBus, initiating the build immediately and merely notifying the user.

### 2. Self-Evolution (The Persistence Loop)

The stack evolves by bridging the gap between temporary Lambda execution and persistent Git storage.

```text
+--------------+       +------------------+       +-------------------+
|  Coder Agent |------>|  Staging Bucket  |<------|   AWS CodeBuild   |
| (Writes Code)| upload|    (S3)          | pull  |     (Deployer)    |
+--------------+       +------------------+       +---------+---------+
                                                            |
                                                            v
+--------------+       +------------------+       +-------------------+
|  SuperClaw  +------>|  AWS CodeBuild   +------>|   Agent Stack     |
| (Orchestrator)| trigger| (Deployer)       |  sst  | (Self-Update)     |
+--------------+       +-----------|------+       +---------+---------+
                                   |                        |
                                   v                        v
                        +------------------+      +-------------------+
### 3. Capability Evolution (Co-Management)
The system's evolution is a shared responsibility between the **Planner Agent** and the **Human Admin**.
- **The Dashboard (ClawCenter)**: Serves as the Command & Control center for the **Agent Registry**.
- **Dynamic Scoping**: Permissions and **Agent Personas** are managed as data in DynamoDB, not as hardcoded logic.
- **Worker Nodes**: New agents can be registered in the UI and are immediately available for task dispatch via the generic **Worker Agent** Lambda.
- **Pruning**: Human insight is used to "weed" the memory garden, ensuring high-quality self-improvement.
```

### 2. Self-Healing Loop

If a deployment fails or the system becomes unstable, Serverless Claw automatically repairs itself.

```text
    +-----------+           +-----------+
    | SuperClaw| <-------+ |  Events   |
    | (Brain)   |           +-----+-----+
    +-----+-----+                 ^
          |                       |
          v                       |
    +-----+-----+           +-----+-----+
    | Coder Agent|          |   Build   |
    | (Modify)  |           |  Monitor  |
    +-----+-----+           +-----+-----+
          |                       ^
          v                       |
    +-----+-----+                 |
    | Deployer  | ----------------+
    | (CodeBuild)|
    +-----------+
```
```

**How it works**:
1. **Coder Agent** implements changes using `fileWrite` and validates them.
2. **SuperClaw** (via tool) zips the modified workspace and uploads it to the **Staging Bucket** (S3).
3. **SuperClaw** calls `triggerDeployment`.
4. **CodeBuild** starts:
    - Pulls the latest code from **GitHub**.
    - Pulls the modified files from the **Staging Bucket** and overwrites the local workspace.
    - Runs `pnpm sst deploy`.
5. **On Success**: CodeBuild uses a `GITHUB_TOKEN` to commit and push the staged changes back to the repository, closing the evolution loop.
6. **On Failure**: `Dead Man's Switch` detects the unhealthy state and reverts the last commit in Git.

---

### 4. Cost-Effectiveness & Safety (CodeBuild Edition)

Replacing legacy GitHub Actions cost controls with in-AWS equivalents:

1. **Circuit Breaker**: Max 5 deploys/UTC day tracked in DynamoDB. See [docs/SAFETY.md](./docs/SAFETY.md).
2. **Health Probe Reward**: Successful `GET /health` decrements the counter (-1), allowing continued evolution for healthy changes.
3. **Config-as-Data**: Non-structural changes (prompts, tool params) live in DynamoDB — no deploy needed.
4. **Human-in-the-Loop**: Protected files (`sst.config.ts`, etc.) require explicit Telegram approval before any change deploys.

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
