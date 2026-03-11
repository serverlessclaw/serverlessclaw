# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents ↗](./docs/AGENTS.md) | [Memory ↗](./docs/MEMORY.md) | [Tools ↗](./docs/TOOLS.md) | [Safety ↗](./docs/SAFETY.md)

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
                            |     (AgentBus)        |
                            |                       |
                            +-----------+-----------+
                                        |
                                        v
                            +-----------+-----------+
                            |                       |
                            |   Managed Services    |
                            | (DynamoDB / S3)       |
                            |                       |
                            +-----------------------+
```

---

## Message Processing Flow

```text
User Event      Webhook         LLM Agent        ConfigTable        Memory           Tool Plugin
    |              |                |                |                |                 |
    +------------->|                |                |                |                 |
    |              +--------------->|                |                |                 |
    |              |                +-------------------------------->|                 |
    |              |                |      (Get History)              |                 |
    |              |                |<--------------------------------+                 |
    |              |                |                |                |                 |
    |              |                +-------------------------------->|                 |
    |              |                |      (Save Message)             |                 |
    |              |                |                |                |                 |
    |              |                +-------------------------------------------------->|
    |              |                |           (Execute Tool if needed)                |
    |              |                |<--------------------------------------------------+
    |              |                |                |                |                 |
    |              |                +--------------->|                |                 |
    |              |                | (Emit Event)   |                |                 |
    |              |                |                |                |                 |
    |              |                +-------------------------------->|                 |
    |              |                | (Save Response)|                |                 |
    |              |<---------------+                |                |                 |
    |<-------------+                |                |                |                 |
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
          |         |                 (Analyzes Convos, Signals)
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
- **Visualization**: The `SYSTEM_PULSE` dashboard page provides an interactive node graph, dynamically rendering both Agent structures and live Infrastructure state polled from DynamoDB (populated by the Monitor Agent post-deployment).

---

## Developer Customization

Serverless Claw is designed to be highly customizable at every layer.

### 1. Evolutionary Memory (Tiered)
The system prevents "prompt bloat" and "identity confusion" through a tiered approach:
- **Long-Term Facts**: High-confidence user identity and permanent preferences.
- **Tactical Lessons**: Short-term heuristics (e.g., "be more direct") that eventually expire or merge.
- **Strategic Gaps**: Missing capabilities (tools/sub-agents) tracked in a backlog with **Estimated ROI**.

### 2. The Smart Recall Tool
Instead of loading all memories into every prompt, agents use `recall_knowledge(query)`.
- **Workflow**: SuperClaw sees a `[MEMORY_INDEX]`. If it needs details, it calls the tool.
- **Efficiency**: Reduces input token costs by up to 90% for long-lived sessions.

### 3. Dynamic Tool Scoping & Discovery
Agents no longer load the entire tool catalog. 
- **Mechanism**: Every agent call triggers `getAgentTools(agentId)`.
- **Registry**: The `AgentRegistry` stores the allowed tool names and system prompts for each agent.
- **Co-Management**: The **ClawCenter** dashboard serves as the UI for the `AgentRegistry`, allowing users to hot-swap prompts and tools without redeploying.
- **Default Scopes**: 
    - `main`: Orchestration & Recall.
    - `coder`: Files & Validation.
    - `planner`: Management & Search.

### 2. Memory Adapters
While the default uses DynamoDB, the system can be adapted to use:
- **Redis (Upstash)** for even lower latency.
- **PostgreSQL (Drizzle/Prisma)** for complex relational memory.
- **S3** for long-term archival.

### 3. Channel Adapters (Fan-Out)
Instead of hardcoding API requests to a single platform, agents emit an `OUTBOUND_MESSAGE` event onto the AgentBus.
- **Notifier Handler**: A dedicated lightweight Lambda (`src/handlers/notifier.ts`) listens to these events.
- **Multi-Channel**: The Notifier reads user preferences from the `ConfigTable` and fans the message out to the appropriate adapters (Telegram, Slack, Dashboard WebSocket).

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
    | Coder Agent|          |  Monitor   |
    | (Modify)  |           | (Health)  |
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
1. **Coder Agent** implements changes using `file_write` and validates them.
2. **SuperClaw** (via tool) zips the modified workspace and uploads it to the **Staging Bucket** (S3).
3. **SuperClaw** calls `trigger_deployment`.
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
