# Serverless Claw: Architecture & Design

This document outlines the high-level design of Serverless Claw, focusing on its serverless nature and its extensibility for developers.

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
| Messaging Client  +------>+   AWS API Gateway     +------>+   AWS Lambda      |
| (Telegram/Discord)|       | (Webhook Endpoint)    |       | (Agent Brain)     |
|                   |       |                       |       |                   |
+---------+---------+       +-----------------------+       +---------+---------+
          ^                                                           |
          |                  +-----------------------+                |
          |                  |                       |                |
          +------------------+   Messaging API       |<---------------+
                             | (Telegram/Discord)    |
                             |                       |
                             +-----------------------+
                                     |
                                     v
                             +-----------------------+
                             |                       |
                             |   Managed Services    |
                             | (DynamoDB / S3)       |
                             |                       |
                             +-----------------------+
```

---

## Message Processing Flow

```text
User Event      Webhook         LLM Agent         Memory           Tool Plugin
    |              |                |                |                 |
    +------------->|                |                |                 |
    |              +--------------->|                |                 |
    |              |                +--------------->|                 |
    |              |                | (Get History)  |                 |
    |              |                |<---------------+                 |
    |              |                |                |                 |
    |              |                +--------------->|                 |
    |              |                | (Save Message) |                 |
    |              |                |                |                 |
    |              |                +--------------------------------->|
    |              |                |    (Execute Tool if needed)      |
    |              |                |<---------------------------------+
    |              |                |                |                 |
    |              |                +--------------->|                 |
    |              |                | (Save Token)   |                 |
    |              |<---------------+                |                 |
    |<-------------+                |                |                 |
Response
```

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

### 1. Self-Evolution (GitOps)
The agent can manage its own codebase and infrastructure through a Git-centric feedback loop.

```text
+--------------+       +--------------+       +-------------------+
|              |       |              |       |                   |
|  Main Agent  +------>+  GitHub API  +------>+  GitHub Actions   |
| (Lambda)     |       | (Git Commit) |       | (SST Deploy)      |
|              |       |              |       |                   |
+--------------+       +--------------+       +---------+---------+
       ^                                                |
       |               Self-Update Loop                 |
       +------------------------------------------------+
```

1.  **Code Access**: The agent has a `GITHUB_TOKEN` secret.
2.  **Repo Management**: It can modify `sst.config.ts`, tool definitions, or prompt templates.
3.  **Deployment**: Pushing to `main` triggers an SST deployment via GitHub Actions, effectively updating the agent's own infrastructure.

### 3. Cost-Effectiveness & Safety
To prevent excessive GitHub Actions billing and code corruption:

1.  **Pull Request Guardrail**: By default, the agent creates a **Pull Request** instead of pushing to `main`. The user reviews the diff and approves the deployment, preventing "infinite loop" deployments.
2.  **Hot-Reloading (Dynamic Config)**: Non-structural changes (prompts, tool parameters, system messages) are stored in **DynamoDB**. The agent can update these instantly via a tool without triggering a full CI/CD pipeline.
3.  **Change Batching**: The agent is instructed to gather multiple improvements before performing a single "Self-Commit" to minimize build minutes.

### 2. Sub-agent Orchestration
Multi-agent tasks are handled through an event-driven "Manager-Worker" pattern.

```text
[ Main Agent ] --- (Task Event) ---> [ EventBridge Bus ]
                                            |
         +----------------------------------+----------------------------------+
         v                                  v                                  v
[ Researcher Agent ]               [ Coder Agent ]                    [ Reviewer Agent ]
(Lambda / Task A)                  (Lambda / Task B)                  (Lambda / Task C)
```

- **Asynchronous Execution**: The manager emits specialized tasks to an EventBridge bus.
- **State Tracking**: All sub-agent status and results are stored in the Shared DynamoDB MemoryTable, allowing the manager to "wait" or "gather" results across separate invocations.

---

### 4. LLM Providers
Provider-agnostic interface supporting:
- OpenAI (GPT-5.4 / GPT-5-mini)
- Anthropic (Claude 4.6 Sonnet)
- Google (Gemini 3.1 / Gemini 3 Flash)
- Emerging models (GLM 5, MiniMax 2.5)
- Local models (via Ollama tunnel or AWS Bedrock)
