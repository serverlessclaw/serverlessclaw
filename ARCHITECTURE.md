# Serverless Claw: Architecture & Design

> **Navigation**: [← Index Hub](./INDEX.md) | [Agents ↗](./docs/AGENTS.md) | [Tools ↗](./docs/TOOLS.md) | [Safety ↗](./docs/SAFETY.md)

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
|                   |       |                       |       |                   |
| Messaging Client  +<----->+   AWS API Gateway     +------>+   AWS Lambda      |
| (Telegram/Discord)|       | (Webhook Endpoint)    |       | (Agent Brain)     |
|                   |       |                       |       |         +         |
+-------------------+       +-----------+-----------+       +---------|---------+
                                        |                             |
                                        v                             |
                            +-----------+-----------+                 |
                            |                       |                 |
                            |      ClawCenter       |<----------------+
                            |  (Next.js Dashboard)  |                 |
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
User Event      Webhook         LLM Agent        EventBridge        Memory           Tool Plugin
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
 [ Telegram ]      [ ClawCenter ]
      |                 |
      +--------+--------+
               |
      _________V_________
     |                   |
     |   MAIN_MANAGER    |
     |___________________|
               |
    (1) DISPATCH_TASK (via AgentBus)
               |
      _________V_________           (3) [ BUILD_MONITOR ]
     |    EVENT_BUS      | <-------  (Observes CodeBuild)
     |   (AgentBus)      |
     |___________________|          (4) [ EVENT_HANDLER ]
               |                     (Handles Failures)
               |
    (2) CODER_AGENT <-------------- (5) [ RENOBOT ]
        (Writes Code)                (Monitors GitHub/Renovate)
```

- **Pattern**: The Main Agent emits a `coder_task` event. The Coder Agent is subscribed to this event, processes the work, and updates the system state.
- **Visualization**: The `SYSTEM_PULSE` dashboard page provides an interactive node graph of this topography.

---

## Developer Customization

Serverless Claw is designed to be highly customizable at every layer.

### 1. Tool Plugins
Developers can add custom tools by implementing the `Tool` interface.
- **Location**: `src/tools.ts`
- **Capability**: Can reach out to any API or execute any Node.js logic within the Lambda environment.

### 2. Memory Adapters
While the default uses DynamoDB, the system can be adapted to use:
- **Redis (Upstash)** for even lower latency.
- **PostgreSQL (Drizzle/Prisma)** for complex relational memory.
- **S3** for long-term archival.

### 3. Channel Adapters
The webhook handler can be extended to support multiple messaging platforms simultaneously.
- **Routing**: Detect platform from payload headers/body.
- **Formatting**: Platform-specific markdown/rich text conversion.

## Self-Management & Orchestration

Serverless Claw is designed to evolve itself and manage complex agent hierarchies.

### 1. Self-Evolution (The Persistence Loop)

The stack evolves by bridging the gap between temporary Lambda execution and persistent Git storage.

```text
+--------------+       +------------------+       +-------------------+
|  Coder Agent |------>|  Staging Bucket  |<------|   AWS CodeBuild   |
| (Writes Code)| upload|    (S3)          | pull  |     (Deployer)    |
+--------------+       +------------------+       +---------+---------+
                                                            |
                                                            v
+--------------+       +------------------+       +-------------------+
|  Main Agent  +------>|  AWS CodeBuild   +------>|   Agent Stack     |
| (Orchestrator)| trigger| (Deployer)       |  sst  | (Self-Update)     |
+--------------+       +-----------|------+       +---------+---------+
                                   |                        |
                                   v                        v
                        +------------------+      +-------------------+
                        |   EventBridge    |      |   GitHub Repo     |
                        | (Status Updates) |      | (Final Persistence)|
                        +------------------+      +-------------------+
```

### 2. Self-Healing Loop

If a deployment fails or the system becomes unstable, Serverless Claw automatically repairs itself.

```text
    +-----------+           +-----------+
    | Main Agent| <-------+ |  Events   |
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
2. **Main Agent** (via tool) zips the modified workspace and uploads it to the **Staging Bucket** (S3).
3. **Main Agent** calls `trigger_deployment`.
4. **CodeBuild** starts:
    - Pulls the latest code from **GitHub**.
    - Pulls the modified files from the **Staging Bucket** and overwrites the local workspace.
    - Runs `pnpm sst deploy`.
5. **On Success**: CodeBuild uses a `GITHUB_TOKEN` to commit and push the staged changes back to the repository, closing the evolution loop.
6. **On Failure**: `Dead Man's Switch` detects the unhealthy state and reverts the last commit in Git.

---

### 3. Automated Dependency Management (Renovate)

The system maintains its own dependencies through a closed-loop integration with Mend/Renovate.

```text
+----------------+       +------------------+       +-------------------+
|  Renovate Bot  |------>|  GitHub PR       |<------|   Renobot Agent   |
| (Check Daily)  | create|  (Automated)     | notify| (Monitor Webhook) |
+----------------+       +------------------+       +---------+---------+
                                                            |
                                                            v
+----------------+       +------------------+       +-------------------+
|   Main Agent   |<------|  Automerge Flow  |<------|   Telegram User   |
| (Verify/Alert) | report| (CI Validation)  | approve| (Manual/Major)    |
+----------------+       +------------------+       +-------------------+
```

**How it works**:
1. **Renovate**: Runs daily and creates Pull Requests for dependency updates.
2. **Renobot Agent**: Receives webhooks from GitHub, identifies Renovate PRs, and notifies the Admin via Telegram.
3. **Automerge**: Non-major updates are configured to automerge once CI passes, ensuring the system stays modern with zero intervention.
4. **Safety**: Major updates require manual approval and can trigger the `validate_code` tool for autonomous verification before merging.

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
- Google (Gemini 3.1 / Gemini 3 Flash)
- Local models (via Ollama or AWS Bedrock)
