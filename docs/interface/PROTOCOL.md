# External Protocols & Adapters

> **Navigation**: [← Index Hub](../../INDEX.md)

Serverless Claw uses a pluggable **Adapter Architecture** to communicate with external systems. This layer normalizes diverse third-party payloads into standardized internal models used by the AgentBus.

## 📥 Input Adapters (External → Internal)

Input adapters receive events from external systems (via webhooks or API polling) and normalize them into a common `InboundMessage` format.

### Normalization Flow

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
+----------------+         +----------------+       +------------------+
```

### Implementing a New Adapter

1.  **Define Schema**: Create a Zod schema for the external payload format.
2.  **Implement Interface**: Create a class implementing the `InputAdapter` interface in `core/adapters/`.
3.  **Normalize**: Implement the `parse()` method to return an `InboundMessage`.
4.  **Register**: Export the adapter from `core/adapters/input/index.ts`.

---

## 🏗️ Managed Integration Repositories

For specialized or heavy integrations, adapters are maintained in separate repositories under the `serverlessclaw` organization:

- **GitHub**: [serverlessclaw-integration-github](https://github.com/serverlessclaw/serverlessclaw-integration-github)
- **Slack**: [serverlessclaw-integration-slack](https://github.com/serverlessclaw/serverlessclaw-integration-slack)
- **Jira**: [serverlessclaw-integration-jira](https://github.com/serverlessclaw/serverlessclaw-integration-jira)

---

## 🔌 Tool Protocols (MCPMultiplexer)

Agents communicate with technical environments (Git, Shell, Browser) via the **Model Context Protocol (MCP)**. Serverless Claw uses a **Unified Multiplexer** architecture to consolidate external servers into a single, high-performance execution environment.

### Layered Transport Architecture

To ensure high availability and low latency, the system employs a tiered approach to tool connection:

```text
    [ Call Tool ]
          |
    +-----v-----+
    |  Unified  | (Primary - Lambda Invoke)
    | Multiplexer [10s Timeout]
    | (Lambda)  | [Routing: x-mcp-server + custom path]
    +-----+-----+
          |
    (Fail / Timeout)
          |
    +-----v-----+
    | Local NPX | (Fallback - Stdio)
    | (Lambda)  | [30s Timeout] [Writable /tmp cache]
    +-----------+
```

- **Identification**: The `MCPMultiplexer` handles server discovery and caches definitions in DynamoDB.
- **Validation**: All tool inputs are validated against JSON schemas before execution.
- **Safety**: Tools performing Class C actions (Writes/Deletes) require human approval (via `SafetyEngine`).
- **Telemetry**: Success rates and latencies are tracked in the `MemoryTable` to enable cost-aware reputation routing.
