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

## 🏗️ Managed Integration Workspaces

For specialized or heavy integrations, adapters are maintained in dedicated workspaces within the monorepo to ensure isolation while sharing core types:

- **GitHub**: `@serverlessclaw/integration-github` (lives in `packages/integration-github`)
- **Slack**: `@serverlessclaw/integration-slack` (planned consolidation)
- **Jira**: Logic currently remains in `core` but follows the `IssueTrackerAction` interface.

### Shared Utilities

Common logic for external communication is centralized in `core/lib/utils/webhook.ts`:

- `verifyHmacSignature()`: Standard HMAC verification for GitHub/Slack style webhooks.
- `verifySecret()`: Constant-time comparison for sensitive headers (Jira).

---

## 🔌 Tool Protocols & Multi-Server Orchestration

The Hand represents the agency silo of Serverless Claw, managed through the **Model Context Protocol (MCP)**. Serverless Claw uses a **Unified Multiplexer** architecture to consolidate external servers into a single, high-performance execution environment.

### 1. Unified MCP Multiplexer

The Multiplexer provides a standardized interface for interacting with multiple MCP servers (AST, WebSearch, Memory):

- **Resource Management**: Efficiently pools connections and resolves tools across distributed servers.
- **Tool Mapping**: Maps LLM tool calls to MCP protocol requests, ensuring multi-modal data fidelity.
- **Proactive Warm-up**: Minimize cold-start latency through smart warm-up triggers during agent resolution.

### 2. Persona Prompting (Skill Strategies)

Agents use specialized persona prompts to maintain consistency and expertise within their manipulated environments:

- **Coder**: Focused on structural integrity, TDD, and modularity.
- **Strategic Planner**: High-level orchestration, dependency management, and milestone tracking.
- **Cognition Reflector**: Self-auditing and finding detection.

### 3. Skill Discovery

Skills are dynamically discovered and registered in the `AgentRegistry`:

- **Heuristic Scanning**: Persona descriptions are scanned to automatically identify and provision required tools.
- **Deduplication**: Local tools always take priority over external MCP tools with the same name to ensure system stability.
- **Schema Validation**: All tool calls are validated against JSON schemas before execution.

### 4. Tool Resilience & Concurrency

To ensure stability in high-concurrency swarm environments, the system enforces strict execution rules:

- **Sequential Execution**: Tools from the `git` and `filesystem` servers are automatically marked as `sequential`. The `ToolExecutor` will never run these in parallel, preventing repository lock failures and file-system race conditions.
- **Discovery Locks**: MCP tool discovery is protected by a distributed lock with a 60-second TTL and stable `ownerId` (Lambda log stream). This prevents "Thundering Herd" API calls to the Hub while ensuring quick recovery if a node crashes.
- **Global Circuit Breaker**: MCP connections utilize a global failure counter in DynamoDB. If a server fails 3 times within 1 minute, it is marked as `down` globally, preventing cascading timeouts across the fleet.

### Layered Transport Architecture

To ensure high availability and low latency, the system employs a tiered approach to tool connection:

```text
    [ Call Tool ]
          |
    +-----v-----+
    |  Unified  | (Primary - Lambda Invoke)
    | Multiplexer [15s Timeout / 5s Hub]
    | (Lambda)  | [Routing: x-mcp-server + custom path]
    +-----+-----+
          |
    (Fail / Timeout)
          |
    +-----v-----+
    | Local NPX | (Fallback - Stdio)
    | (Lambda)  | [15s Timeout] [Connection TTL: 15min]
    +-----------+
```

- **Timeouts**: Connection timeout is 15s for standard servers, 5s for MCP Hub. Tool execution has a 2-minute timeout (configurable via `TOOL_EXECUTION_TIMEOUT_MS`).
- **Connection Lifecycle**: MCP clients are cached with a 15-minute TTL (configurable via `MCP_CONNECTION_TTL_MS`). Stale connections are automatically evicted.
- **Identification**: The `MCPMultiplexer` handles server discovery and caches definitions in DynamoDB.
- **Validation**: All tool inputs are validated against JSON schemas before execution.
- **Safety**: Tools performing Class C actions (Writes/Deletes) require human approval (via `SafetyEngine`).
- **Telemetry**: Success rates and latencies are tracked in the `MemoryTable` to enable cost-aware reputation routing.
