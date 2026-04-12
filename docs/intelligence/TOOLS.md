# Agent Tool Registry

> **Navigation**: [← Index Hub](../../INDEX.md)

> **Agent Context Loading**: Load this file when you need to understand the tools available to agents or how to add new ones.

## 🛠️ Available Tools

| Tool                      | Purpose                                                                                         | Protected? | Writes to Cloud? |
| ------------------------- | ----------------------------------------------------------------------------------------------- | :--------: | :--------------: |
| `requestResearch`         | Dispatches a technical research mission to the Researcher Agent. Standardized parallel fan-out. |     —      |        ✅        |
| `dispatchTask`            | Sends a task to EventBridge → Specialized Agent                                                 |     —      |        ✅        |
| `seekClarification`       | Pauses current agent and requests directions from initiator                                     |     —      |        ✅        |
| `provideClarification`    | Answers a request and resumes the target agent                                                  |     —      |        ✅        |
| `triggerDeployment`       | Starts a CodeBuild deploy (circuit-breaker protected, supports Atomic Sync)                     |     ✅     |        ✅        |
| `checkHealth`             | Deep cognitive probe of AgentBus, Core Tools, and LLM Providers                                 |     —      |        ✅        |
| `runCognitiveHealthCheck` | Runs deep cognitive health check on agents (reasoning, memory, anomalies)                       |     —      |        ✅        |
| `rollbackDeployment`      | Emergency Git revert + redeploy                                                                 |     —      |        ✅        |
| `reportGap`               | Records a capability gap or technical failure                                                   |     —      |        ✅        |
| `manageGap`               | Updates or lists capability gaps in the system                                                  |     —      |        ✅        |
| `recallKnowledge`         | JIT retrieval of distilled facts/lessons                                                        |     —      |        —         |
| `listAgents`              | Discovers available specialized agents                                                          |     —      |        —         |
| `discoverSkills`          | Searches MCP marketplace for new capabilities                                                   |     —      |        —         |
| `registerMCPServer`       | Dynamically connects a new MCP bridge                                                           |     —      |        ✅        |
| `deleteMcpServer`         | Removes an MCP connection                                                                       |     —      |        ✅        |
| `installSkill`            | Adds a tool to an agent's roster                                                                |     —      |        ✅        |
| `uninstallSkill`          | Removes a tool from an agent's roster                                                           |     —      |        ✅        |
| `discoverPeers`           | Discovers peer agents in the swarm (filter by capability/category)                              |     —      |        —         |
| `registerPeer`            | Registers a bidirectional peer connection in swarm topology                                     |     —      |        ✅        |
| `requestConsensus`        | Requests swarm consensus (majority/unanimous/weighted modes)                                    |     —      |        ✅        |
| `createWorkspace`         | Creates a new multi-human multi-agent workspace                                                 |     —      |        ✅        |
| `inviteMember`            | Invites a human or agent to a workspace (admin/owner only)                                      |     —      |        ✅        |
| `updateMemberRole`        | Updates a member's role within a workspace                                                      |     —      |        ✅        |
| `removeMember`            | Removes a member from a workspace (cannot remove owner)                                         |     —      |        ✅        |
| `getWorkspace`            | Retrieves workspace details including all members                                               |     —      |        —         |
| `listWorkspaces`          | Lists all workspace IDs in the system                                                           |     —      |        —         |
| `createCollaboration`     | Creates a multi-party collaboration session (supports workspaceId)                              |     —      |        ✅        |
| `joinCollaboration`       | Joins an existing collaboration to access shared context                                        |     —      |        ✅        |
| `getCollaborationContext` | Gets shared session conversation history                                                        |     —      |        —         |
| `writeToCollaboration`    | Writes a message to the shared collaboration session                                            |     —      |        ✅        |
| `closeCollaboration`      | Closes a collaboration session                                                                  |     —      |        ✅        |
| `listMyCollaborations`    | Lists all collaborations for the current agent                                                  |     —      |        —         |
| `broadcastMessage`        | Broadcasts a message to all active participants in a session                                    |     —      |        ✅        |
| `getMessages`             | Retrieves messages from a specific conversation or session                                      |     —      |        —         |
| `getMcpConfig`            | Retrieves the current MCP servers configuration                                                 |     —      |        —         |
| `debugAgent`              | Sets debug level and captures detailed traces for a specific agent                              |     —      |        ✅        |
| `switchModel`             | Hot-swaps the LLM provider or model for the current agent                                       |     —      |        ✅        |
| `cancelGoal`              | Cancels a scheduled proactive goal or task                                                      |     —      |        ✅        |
| `listSchedules`           | Lists all active proactive goals and scheduled tasks                                            |     —      |        —         |
| `signalOrchestration`     | Deterministic signal to move a goal to the next state (supports active `emit` for EventBridge)  |     —      |        ✅        |
| `voteOnProposal`          | Submits a vote for an active consensus proposal                                                 |     —      |        ✅        |
| `checkReputation`         | Retrieves an agent's rolling 7-day performance metrics (success rate, latency, score)           |     —      |        —         |
| `mcp-filesystem-*`        | MCP-driven file operations (read/write/list/search)                                             |     ✅     |        —         |
| `git-status` / `git-diff` | Version control awareness (MCP)                                                                 |     —      |        —         |
| `google-search`           | Real-time global intelligence (MCP)                                                             |     —      |        —         |
| `puppeteer-*`             | Browser automation & UI vision (MCP)                                                            |     ✅     |        —         |
| `fetch`                   | Deep reading of docs/web pages (MCP)                                                            |     —      |        —         |
| `aws-*`                   | Infrastructure auditing & logs (MCP)                                                            |     ✅     |        —         |
| `renderComponent`         | Renders a specialized UI component in the dashboard session                                     |     —      |        —         |
| `navigateTo`              | Navigates the user to a dashboard path (SuperClaw ONLY)                                         |     ✅     |        —         |
| `uiAction`                | Triggers a specific UI event or state change (modal, sidebar, etc.)                             |     —      |        —         |
| `renderCodeDiff`          | Renders a code diff/patch component for code review and interaction                             |     —      |        —         |
| `renderPlanEditor`        | Renders an interactive JSON editor for strategic plan review and modification                   |     —      |        —         |

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
 Domains        Multiplexer   Native
 (Lambda)         (Lambda)    (Provider)
    |          +------+------+ |
    |          |             | |
 - infra/      v             v - python
 - knowledge/ [ Git ] ----> [ FS ] - search
 - system/    [ S3  ]       [ AWS] - files
 - collab/
```

### 1. Custom Skills (Internal)

Tools written specifically for the ServerlessClaw environment (e.g., `triggerDeployment`). These run within the agent's AWS Lambda execution context and are defined in `core/tools/`.

### 2. MCP Skills (Unified Multiplexer Model)

Connected via the **Model Context Protocol (MCP)**. This is the primary scaling vector for the system.

- **Unified Multiplexer Architecture**: The system consolidates multiple MCP servers (Git, Filesystem, AWS, etc.) into a single **Unified Multiplexer Lambda**. This reduces infrastructure sprawl, minimizes CloudWatch log fragmentation, and improves warming efficiency by keeping a single high-resource execution environment hot.
- **Path-Based Routing**: The bridge routes requests to specific "virtual" servers using URL paths (e.g., `/mcp/git`) or the `x-mcp-server` header.
- **Graceful Local Fallback**: If the external Hub or Multiplexer is unreachable, the system falls back to on-demand `npx` execution within the calling agent's context.
- **Lambda Environment Hardening**:
  - **Memory/Timeout**: The Multiplexer is provisioned with **1024MB** and **10m** timeout to handle concurrent child processes and resource-heavy tools.
  - **Writable Cache**: Uses `/tmp/mcp-cache` and `/tmp/npm-cache` to ensure `npx` has a writable scratch space in the read-only Lambda environment.

### 3. Built-in Skills (Model-Native)

Native capabilities provided by the LLM provider (e.g., OpenAI's **Code Interpreter** or Gemini's **Grounded Search**).

---

## 🦾 Skill-Based Architecture (New in 2026)

We have evolved from a static tool registry to a **dynamic Skill-Based Architecture**. This solves the "Context Window Bloat" problem where agents were overwhelmed by too many tool definitions.

### How it works:

1. **Minimal Default Toolset**: Agents start with a core set of "Essential Skills" (`recallKnowledge`, `discoverSkills`, `dispatchTask`).
2. **Just-in-Time Discovery**: If an agent needs a capability they don't have, they use `discoverSkills` to search the marketplace.
3. **Dynamic Installation**: They can then use `installSkill` to temporarily or permanently add that capability to their logic core.

### Adding a New Skill

1. Implement the tool in `core/tools/`.
2. Add the definition to `core/tools/definitions.ts`.
3. It is now automatically discoverable by all agents via `discoverSkills`.

---

## 🦾 Domain-Driven Architecture (Refactored April 2026)

The tool registry has been reorganized into four primary **Action Domains** to improve maintainability and token efficiency:

1. **Knowledge Domain** (`core/tools/knowledge/`): Registry, memory, context, and MCP/Skill management.
2. **Collaboration Domain** (`core/tools/collaboration/`): Workspace management, sessions, and agent-to-human messaging.
3. **Infra Domain** (`core/tools/infra/`): Deployment, scheduling, rollbacks, and system topology.
4. **System Domain** (`core/tools/system/`): Shell execution, git sync, health probes, and runtime configuration.

---

## 🏗️ Adding a New Tool

1. **Identify the Domain**: Choose the appropriate subdirectory in `core/tools/`.
2. **Define the Schema**: Add the tool's `JsonSchema` to the domain's `schema.ts`. Ensure `additionalProperties: false` is set.
3. **Implement the Logic**: Create a new `.ts` file or add to an existing one in that domain.
4. **Register in Domain Index**: Export the new tool from the domain's `index.ts`.
5. **Update Main Registry**: The main `core/tools/index.ts` will automatically pick up the new tool if the domain index is updated.
6. **Verify**: Run `make check` and `make test`.

### Dynamic Scoping (Evolution Sector)

Agents no longer receive all tools by default. They call `getAgentTools(agentId)` which:

1. Checks the `AgentRegistry` (Backbone + DynamoDB overrides).
2. Returns a subset of tools assigned to that specific agent.
3. **[NEW] Nimble Skeleton Mode**: If `discoveryMode: true` is set (Default for SuperClaw), the agent starts with only a **Skeleton** toolset (Messaging, Navigation, Discovery). All other capabilities must be added via `discoverSkills` and `installSkill` JIT.
4. Users can grant/revoke tools for any agent in the **ClawCenter** dashboard under the **Evolution** sector (`/capabilities`).

### ITool Interface

Definitions are now strictly typed using a unified `JsonSchema` interface to ensure compatibility across providers.

- **Interface**: `IToolDefinition` and `JsonSchema` in [`core/lib/types/agent.ts`](../../core/lib/types/agent.ts)

### AI-Native Coding Standards (April 2026 Refresh)

To maximize semantic transparency for both humans and AI agents, follow these rules when defining tools:

1. **Avoid redundant indirection**: Use direct string literals (e.g., `type: 'string'`) instead of local constants like `const TYPE_STRING = 'string'`. Indirection creates "Lookup Friction" for LLMs.
2. **Strict Typing**: Always use `as const` for mock tool definitions in tests to align with the strictly typed union of schema types.
3. **Precise Descriptions**: Tool descriptions are NOT just documentation; they are **Instructions** for the LLM. Be verbose about constraints and edge cases.

---

## 🛡️ Protected Files

The system enforces protection via a centralized `isProtectedPath` utility. All filesystem-related tools (both local and MCP-driven like `filesystem_write_file`) block writes to these files to prevent accidental system destruction:

```
sst.config.ts
core/tools/index.ts
core/agents/superclaw.ts
core/lib/agent.ts
buildspec.yml
infra/**
```

Any attempt without explicit approval returns `PERMISSION_DENIED`. The Coder Agent **must** request `MANUAL_APPROVAL_REQUIRED` from the human on Telegram/Slack. Once approved, the agent can retry with the `manuallyApproved: true` parameter.

---

## 🔄 Tool Lifecycle & Optimization Strategy

To prevent "Context Window Bloat" and maintain high reasoning performance, Serverless Claw employs an autonomous **Tool Lifecycle Strategy**. This ensures agents only "see" the tools they actually need for their current task.

### The Tool Cycle

```text
       [ 1. DISCOVERY ] <-----------------------+
              |                                 |
      (discoverSkills)                          |
              |                                 |
       [ 2. INSTALLATION ]                      |
              |                                 |
       (installSkill)                           |
              |                                 |
       [ 3. EXECUTION ]                         | (6. RE-DISCOVERY)
              |                                 |
      (recordToolUsage)                         |
              |                                 |
       [ 4. MONITORING ]                        |
              |                                 |
      (Usage Analytics)                         |
              |                                 |
       [ 5. PRUNING ] --------------------------+
              |
  (selective_discovery_mode)
```

### Optimization Tiers

1. **Bootloader Phase**: Agents start with a minimal "Essential" toolset (`discoverSkills`, `recallKnowledge`, `dispatchTask`). This keeps initial token costs low and focus high.
2. **Just-in-Time (JIT) Expansion**: Agents use `discoverSkills` to find specialized local tools or external MCP capabilities only when the task requires them.
3. **Usage Tracking**: Every tool execution is recorded atomically in the `MemoryTable` via the `TokenTracker`, capturing the `count`, `successCount`, `totalDurationMs`, and estimated `totalInputTokens` / `totalOutputTokens`.
4. **Anomalous Tool Detection**: During the 48-hour strategic review, the **Strategic Planner** identifies "Anomalous Tools" (those with <80% success rate or >100k token cost in 7 days). It generates `TOOL_OPTIMIZATION` gaps to `PRUNE` or `REPLACE` inefficient capabilities.
5. **Selective Discovery Mode**: When enabled, the system automatically prunes an agent's toolset back to its "Core" defaults if it hasn't used a tool recently or if the toolset exceeds a complexity threshold.
6. **Performance-Based Routing**: When a task is dispatched, the **AgentRouter** (`core/lib/routing/AgentRouter.ts`) computes a composite score for candidate agents: `CapabilityMatch * SuccessRate - (AvgTokens / 10000)`. This ensures tasks are handled by the most reliable and cost-efficient agent.
7. **MCP Server Pruning**: The **ClawCenter Dashboard** provides usage analytics for MCP servers, allowing humans or the SuperClaw to `unregisterMCPServer` if it's no longer providing value to the system.

### Performance Impact

- **Context Reduction**: Up to 70% reduction in system prompt size.
- **Reasoning Accuracy**: Significant reduction in "Tool Confusion" (LLM picking the wrong tool) by limiting choices.
- **Cost Efficiency**: Lower input token costs due to smaller tool definitions.

---

## 🛡️ Distributed MCP Resilience & Process Lifecycle (May 2026 Refresh)

To ensure tools are always available even in unstable network conditions or Lambda cold-starts, the system employs a **Layered Transport & Distributed Safety Architecture**.

```text
    [ Call Tool ]
          |
    +-----v-----+
    |  Unified  | (Primary - Lambda Invoke)
    | Multiplexer [10s Timeout]
    | (Lambda)  | [Routing: x-mcp-server]
    +-----v-----+
          |
    (Fail / Timeout)
          |
    +-----v-----+
    | Local NPX | (Fallback - Stdio)
    | (Lambda)  | [30s Timeout]
    +-----------+
```

### Reliability Guardrails:

1.  **Distributed Discovery Backoff (P1 Fix)**: MCP server failure states and backoff windows are now synchronized via DynamoDB (`mcp_health_<server>`). This prevents "Discovery Blindness" where different Lambda instances repeatedly attempt to connect to a failing server, exhausting resources.
2.  **Explicit Process Lifecycle (P1 Fix)**: The `MCPClientManager` now enforces explicit cleanup of `StdioClientTransport` and `Client` instances on every failure path. This prevents **Zombie Process Bloat** in reused Lambda containers, ensuring that orphaned child processes are strictly killed.
3.  **Trace-Isolated Filesystem Access (P1 Fix)**: All `mcp-filesystem-*` operations are now routed to a strictly isolated, per-trace workspace located at `/tmp/claw-workspaces/<traceId>`. This eliminates **Workspace Cross-Talk** and ensures that concurrent agents in the same container cannot corrupt each other's files.
4.  **Proactive Resource Pruning (P2 Fix)**: Stale workspaces in `/tmp` are proactively pruned if they exceed 24 hours of age or a total size threshold (300MB), maintaining a healthy "Metabolism" and preventing disk exhaustion.
5.  **Physical Resource Headroom**: The Unified Multiplexer is provisioned with `MEDIUM_LARGE` (1024MB) memory to accommodate concurrent tool executions (e.g., Git + Filesystem).

---

## ⚡ Dynamic Selection & Selection Integrity (Active)

The system now enforces **Selection Integrity** at the gateway level. 

1.  **Mandatory Enabled Check (P0 Fix)**: The `AgentMultiplexer` verifies the `enabled` status of every agent in the `AgentRegistry` before invocation. Any attempt to route a task to a disabled agent is rejected immediately.
2.  **Reputation-Aware Routing (P1 Fix)**: Dynamic routing is now active in production. When multiple agents are candidates for a task, the system uses the `AgentRouter` to select the best performer based on historical success rates, latency, and cost: `CapabilityMatch * SuccessRate - (AvgTokens / 10000)`.
3.  **Atomic Trust Orchestration (P1 Fix)**: Agent reputation and `TrustScore` updates utilize atomic DynamoDB operations (`list_append`). This ensures that the feedback loop from Silo 5 (The Eye) to Silo 6 (The Scales) remains consistent even under extreme concurrency.

---

## 📡 Deploy Lifecycle (Tool Sequence)

```text
dispatchTask (coder) → filesystem_write_file → [human approves if protected]
                                                     ↓
                                           triggerDeployment
                                                     ↓
                                             checkHealth (Health Probe)
                                          ↓            ↓
                                      OK (–1 count)  FAILED → rollbackDeployment
```

---

## Reliability Updates (April 2026)

### Merger Payload Safety Cap

`core/agents/merger.ts` now rejects oversized inline patch payloads before sending to the LLM.

- Limit: 100 KB total serialized patch payload.
- Behavior on overflow: emits a failed task result immediately with remediation guidance.

```text
[Parallel patches]
       |
       v
[Merger: JSON serialize]
       |
       v
[Size <= 100KB ?]
   |          |
  yes         no
   |          |
   v          v
[LLM merge] [Emit FAILED + stop]
```

### Tool Resolution Logging

`getAgentTools` in `core/tools/registry-utils.ts` now uses the structured logger (`logger.info`) for tool resolution steps, replacing `console.log` and improving CloudWatch queryability.

---
