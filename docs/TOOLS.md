# Agent Tool Registry

> **Agent Context Loading**: Load this file when you need to add, modify, or understand any tool.

## 🛠️ Available Tools

| Tool | Purpose | Protected? | Writes to Cloud? |
|------|---------|:---:|:---:|
| `DISPATCH_TASK` | Sends a task to EventBridge → Specialized Agent | — | ✅ |
| `SEEK_CLARIFICATION` | Pauses current agent and requests directions from initiator | — | ✅ |
| `PROVIDE_CLARIFICATION` | Answers a request and resumes the target agent | — | ✅ |
| `TRIGGER_DEPLOYMENT` | Starts a CodeBuild deploy (circuit-breaker protected) | ✅ | ✅ |
| `CHECK_HEALTH` | Hits `/health` and rewards successful evolution | — | ✅ |
| `TRIGGER_ROLLBACK` | Emergency Git revert + redeploy | — | ✅ |
| `REPORT_GAP` | Records a capability gap or technical failure | — | ✅ |
| `MANAGE_GAP` | Updates gap status (QA Verification) | — | ✅ |
| `RECALL_KNOWLEDGE` | JIT retrieval of distilled facts/lessons | — | — |
| `LIST_AGENTS` | Discovers available specialized agents | — | — |
| `DISCOVER_SKILLS` | Searches MCP marketplace for new capabilities | — | — |
| `REGISTER_MCP_SERVER` | Dynamically connects a new MCP bridge | — | ✅ |
| `UNREGISTER_MCP_SERVER` | Removes an MCP connection | — | ✅ |
| `INSTALL_SKILL` | Adds a tool to an agent's roster | — | ✅ |
| `UNINSTALL_SKILL` | Removes a tool from an agent's roster | — | ✅ |
| `mcp-filesystem-*` | MCP-driven file operations (read/write/list/search) | ✅ | — |
| `git-status` / `git-diff` | Version control awareness (MCP) | — | — |
| `google-search` | Real-time global intelligence (MCP) | — | — |
| `puppeteer-*` | Browser automation & UI vision (MCP) | ✅ | — |
| `fetch` | Deep reading of docs/web pages (MCP) | — | — |
| `aws-*` | Infrastructure auditing & logs (MCP) | ✅ | — |

---

## 🦾 Skill-Based Architecture (New in 2026)

We have evolved from a static tool registry to a **dynamic Skill-Based Architecture**. This solves the "Context Window Bloat" problem where agents were overwhelmed by too many tool definitions.

### How it works:
1. **Minimal Default Toolset**: Agents start with a core set of "Essential Skills" (`RECALL_KNOWLEDGE`, `DISCOVER_SKILLS`, `DISPATCH_TASK`).
2. **Just-in-Time Discovery**: If an agent needs a capability they don't have, they use `DISCOVER_SKILLS` to search the marketplace.
3. **Dynamic Installation**: They can then use `INSTALL_SKILL` to temporarily or permanently add that capability to their logic core.

### Adding a New Skill
1. Implement the tool in `core/tools/`.
2. Add the definition to `core/tools/definitions.ts`.
3. It is now automatically discoverable by all agents via `discoverSkills`.

---

## 🏗️ Adding a New Tool

1. Open `core/tools/index.ts`.
2. Add an entry to the `TOOLS` record following the `ITool` interface, using `SCREAMING_SNAKE_CASE` for the key.
3. If this should be available to a backbone agent by default, add it to their `tools` array in `core/lib/backbone.ts`.
4. Run `VALIDATE_CODE` to check for regressions.
5. Update the table above.
6. Update `src/lib/tools.test.ts` to include the new tool name.

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

1. **Bootloader Phase**: Agents start with a minimal "Essential" toolset (`DISCOVER_SKILLS`, `RECALL_KNOWLEDGE`, `DISPATCH_TASK`). This keeps initial token costs low and focus high.
2. **Just-in-Time (JIT) Expansion**: Agents use `DISCOVER_SKILLS` to find specialized local tools or external MCP capabilities only when the task requires them.
3. **Usage Tracking**: Every tool execution is recorded atomically in the `MemoryTable` via the `TokenTracker`, capturing the `count`, `successCount`, `totalDurationMs`, and estimated `totalInputTokens` / `totalOutputTokens`.
4. **Anomalous Tool Detection**: During the 48-hour strategic review, the **Strategic Planner** identifies "Anomalous Tools" (those with <80% success rate or >100k token cost in 7 days). It generates `TOOL_OPTIMIZATION` gaps to `PRUNE` or `REPLACE` inefficient capabilities.
5. **Selective Discovery Mode**: When enabled, the system automatically prunes an agent's toolset back to its "Core" defaults if it hasn't used a tool recently or if the toolset exceeds a complexity threshold.
6. **Performance-Based Routing**: When a task is dispatched, the **AgentRouter** computes a composite score for candidate agents: `CapabilityMatch * SuccessRate - (AvgTokens / 10000)`. This ensures tasks are handled by the most reliable and cost-efficient agent.
7. **MCP Server Pruning**: The **ClawCenter Dashboard** provides usage analytics for MCP servers, allowing humans or the SuperClaw to `UNREGISTER_MCP_SERVER` if it's no longer providing value to the system.

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
    |  MCP Hub  | (Primary - SSE)
    |  (Remote) | [5s Timeout]
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
1. **Physical Resource Headroom**: Agents running MCP tools require `LARGE` (2048MB) memory to avoid OOM crashes during `npx` installations.
2. **Persistence Safeguards**: Any "Connection Interrupted" message is preserved in the UI even during background session refreshes.
3. **Environment Hardening**: Writable cache paths in `/tmp` prevent `npm` from crashing when attempting to write to the read-only Lambda home directory.

---

## 📡 Deploy Lifecycle (Tool Sequence)

```text
dispatchTask (coder) → filesystem_write_file → [human approves if protected]
                                                     ↓
                                           triggerDeployment
                                                     ↓
                                             checkHealth (Health Probe)
                                          ↓            ↓
                                      OK (–1 count)  FAILED → triggerRollback
```
