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

### 4. LLM Providers
Provider-agnostic interface supporting:
- OpenAI (GPT-4o/o1)
- Anthropic (Claude 3.5 Sonnet)
- DeepSeek (V3/R1)
- Local models (via Ollama tunnel or AWS Bedrock)
