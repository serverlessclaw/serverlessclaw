# Agent Tool Registry

> **Navigation**: [← Index Hub](../INDEX.md)

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
| `debugAgent`              | Sets debug level and captures detailed traces for a specific agent                              |     —      |        ✅        |
| `switchModel`             | Hot-swaps the LLM provider or model for the current agent                                       |     —      |        ✅        |
| `cancelGoal`              | Cancels a scheduled proactive goal or task                                                      |     —      |        ✅        |
| `listSchedules`           | Lists all active proactive goals and scheduled tasks                                            |     —      |        —         |
| `signalOrchestration`     | Deterministic signal to move a goal to the next state                                           |     —      |        ✅        |
| `voteOnProposal`          | Submits a vote for an active consensus proposal                                                 |     —      |        ✅        |
| `checkReputation`         | Retrieves an agent's rolling 7-day performance metrics (success rate, latency, score)           |     —      |        —         |
| `mcp-filesystem-*`        | MCP-driven file operations (read/write/list/search)                                             |     ✅     |        —         |
| `git-status` / `git-diff` | Version control awareness (MCP)                                                                 |     —      |        —         |
| `google-search`           | Real-time global intelligence (MCP)                                                             |     —      |        —         |
| `puppeteer-*`             | Browser automation & UI vision (MCP)                                                            |     ✅     |        —         |
| `fetch`                   | Deep reading of docs/web pages (MCP)                                                            |     —      |        —         |
| `aws-*`                   | Infrastructure auditing & logs (MCP)                                                            |     ✅     |        —         |

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
3. Users can grant/revoke tools for any agent in the **ClawCenter** dashboard under the **Evolution** sector (`/capabilities`).

### ITool Interface

Definitions are now strictly typed using a unified `JsonSchema` interface to ensure compatibility across providers.

```typescript
export interface JsonSchema {
  /** The data type (e.g., 'string', 'object', 'array'). */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: boolean;
}

export interface IToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  // ...
}
```

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
6. **Performance-Based Routing**: When a task is dispatched, the **AgentRouter** computes a composite score for candidate agents: `CapabilityMatch * SuccessRate - (AvgTokens / 10000)`. This ensures tasks are handled by the most reliable and cost-efficient agent.
7. **MCP Server Pruning**: The **ClawCenter Dashboard** provides usage analytics for MCP servers, allowing humans or the SuperClaw to `unregisterMCPServer` if it's no longer providing value to the system.

### Performance Impact

- **Context Reduction**: Up to 70% reduction in system prompt size.
- **Reasoning Accuracy**: Significant reduction in "Tool Confusion" (LLM picking the wrong tool) by limiting choices.
- **Cost Efficiency**: Lower input token costs due to smaller tool definitions.

---

## 🛡️ MCP Reliability & Transport (May 2026 Refresh)

To ensure tools are always available even in unstable network conditions or Lambda cold-starts, the system employs a **Layered Transport Architecture**.

```text
    [ Call Tool ]
          |
    +-----v-----+
    |  Unified  | (Primary - Lambda Invoke)
    | Multiplexer [10s Timeout]
    | (Lambda)  | [Routing: x-mcp-server]
    +-----+-----+
          |
    (Fail / Timeout)
          |
    +-----v-----+
    | Local NPX | (Fallback - Stdio)
    | (Lambda)  | [30s Timeout]
    +-----------+
```

### Reliability Guardrails:

1. **Physical Resource Headroom**: The Unified Multiplexer is provisioned with `MEDIUM_LARGE` (1024MB) memory to accommodate concurrent tool executions (e.g., Git + Filesystem).
2. **Persistence Safeguards**: Tool results are cached in the `MemoryTable` via the `mcp_tools_cache_<server>` key to avoid redundant discovery calls.
3. **Environment Hardening**: Writable cache paths in `/tmp` prevent `npm` from crashing when attempting to write to the read-only Lambda home directory.
4. **Log Consolidation**: All tool invocations are logged with a `[MCP-MULTIPLEXER]` prefix, enabling unified tracing of complex tool sequences.

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

## 📊 Agent Reputation System (April 2026)

The `checkReputation` tool provides visibility into agent reliability by surfacing rolling 7-day performance metrics.

### Scoring Weights

The composite score (0-1) is calculated as:

```
Score = (successRate × 0.6) + (latencyComponent × 0.25) + (recencyComponent × 0.15)
```

| Component    | Weight | Calculation                                               |
| ------------ | ------ | --------------------------------------------------------- |
| Success Rate | 60%    | `tasksCompleted / totalTasks`                             |
| Latency      | 25%    | `max(0, 1 - avgLatencyMs / 15000)` (5s baseline, 15s cap) |
| Recency      | 15%    | `max(0, 1 - hoursSinceActive / 24)` (decays over 24h)     |

### Update Trigger

Reputation is automatically updated on every `TASK_COMPLETED` or `TASK_FAILED` event via `core/handlers/events/task-result-handler.ts`. The rolling window resets after 7 days of inactivity.

### Usage

```
checkReputation({ agentId: "coder" })
```

Returns: Composite score, success rate, tasks completed/failed, average latency, and last active timestamp.

---

## 📊 Agent Reputation System (April 2026)

The `checkReputation` tool provides visibility into agent reliability by surfacing rolling 7-day performance metrics.

### Scoring Weights

The composite score (0-1) is calculated as:

```
Score = (successRate × 0.6) + (latencyComponent × 0.25) + (recencyComponent × 0.15)
```

| Component    | Weight | Calculation                                               |
| ------------ | ------ | --------------------------------------------------------- |
| Success Rate | 60%    | `tasksCompleted / totalTasks`                             |
| Latency      | 25%    | `max(0, 1 - avgLatencyMs / 15000)` (5s baseline, 15s cap) |
| Recency      | 15%    | `max(0, 1 - hoursSinceActive / 24)` (decays over 24h)     |

### Update Trigger

Reputation is automatically updated on every `TASK_COMPLETED` or `TASK_FAILED` event via `core/handlers/events/task-result-handler.ts`. The rolling window resets after 7 days of inactivity.

### Usage

```
checkReputation({ agentId: "coder" })
```

Returns: Composite score, success rate, tasks completed/failed, average latency, and last active timestamp.
