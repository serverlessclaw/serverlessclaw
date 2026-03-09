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

### 1. Self-Evolution (3-Agent + CodeBuild Loop)

The stack deploys **itself**. There is no GitHub Actions CI/CD — all deployments are triggered programmatically by the Main Agent via AWS CodeBuild.

```text
+--------------+       +------------------+       +-------------------+
|              |       |                  |       |                   |
|  Main Agent  +------>+  AWS CodeBuild   +------>+   Agent Stack     |
| (Lambda)     | start | (Deployer)       |  sst  | (Self-Update)     |
|              | build |  buildspec.yml   | deploy|                   |
+--------------+       +------------------+       +-------------------+
       |                        |
       | Protected (no writes)  |
       +------------------------+
       |     Bootstrap Stack    |
       |  (CodeBuild + Roles)   |
       +------------------------+
```

**How it works**:
1. Main Agent calls `trigger_deployment` (circuit-breaker guarded, max 5/day).
2. CodeBuild runs `pnpm sst deploy` from the repo using `buildspec.yml`.
3. Main Agent calls `check_health` → `GET /health` to confirm success.
4. On failure: `trigger_rollback` reverts the last Git commit and redeploys.

**Stack Isolation** (loop prevention):
- **Bootstrap Stack**: defines CodeBuild, IAM roles. **Agent cannot modify this.**
- **Agent Stack**: everything else — Lambda, DynamoDB, API Gateway. The agent can evolve this.
- The agent's IAM role only allows `codebuild:StartBuild` for the Agent Stack project. It cannot touch the Bootstrap Stack.

### 3. Cost-Effectiveness & Safety (CodeBuild Edition)

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
