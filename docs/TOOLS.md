# Agent Tool Registry

> **Agent Context Loading**: Load this file when you need to add, modify, or understand any tool.

## 🛠️ Available Tools

| Tool | Purpose | Protected? | Writes to Cloud? |
|------|---------|:---:|:---:|
| `dispatchTask` | Sends a task to EventBridge → Specialized Agent | — | ✅ |
| `triggerDeployment` | Starts a CodeBuild deploy (circuit-breaker protected) | ✅ | ✅ |
| `checkHealth` | Hits `/health` and rewards successful evolution | — | ✅ |
| `triggerRollback` | Emergency Git revert + redeploy | — | ✅ |
| `reportGap` | Records a capability gap or technical failure | — | ✅ |
| `manageGap` | Updates gap status (QA Verification) | — | ✅ |
| `recallKnowledge` | JIT retrieval of distilled facts/lessons | — | — |
| `listAgents` | Discovers available specialized agents | — | — |
| `discoverSkills` | Searches MCP marketplace for new capabilities | — | — |
| `registerMCPServer` | Dynamically connects a new MCP bridge | — | ✅ |
| `unregisterMCPServer` | Removes an MCP connection | — | ✅ |
| `installSkill` | Adds a tool to an agent's roster | — | ✅ |
| `uninstallSkill` | Removes a tool from an agent's roster | — | ✅ |
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
1. **Minimal Default Toolset**: Agents start with a core set of "Essential Skills" (Recall, Discovery, Dispatch).
2. **Just-in-Time Discovery**: If an agent needs a capability they don't have, they use `discoverSkills` to search the marketplace.
3. **Dynamic Installation**: They can then use `installSkill` to temporarily or permanently add that capability to their logic core.

### Adding a New Skill
1. Implement the tool in `core/tools/`.
2. Add the definition to `core/tools/definitions.ts`.
3. It is now automatically discoverable by all agents via `discoverSkills`.

---

## 🏗️ Adding a New Tool

1. Open `core/tools/index.ts`.
2. Add an entry to the `tools` record following the `ITool` interface.
3. If this should be available to a backbone agent by default, add it to their `tools` array in `core/lib/backbone.ts`.
4. Run `validateCode` to check for regressions.
5. Update the table above.
6. Update `src/lib/tools.test.ts` to include the new tool name.

### Dynamic Scoping (Evolution Sector)
Agents no longer receive all tools by default. They call `getAgentTools(agentId)` which:
1. Checks the `AgentRegistry` (Backbone + DynamoDB overrides).
2. Returns a subset of tools assigned to that specific agent.
3. Users can grant/revoke tools for any agent in the **ClawCenter** dashboard under the **Evolution** sector (`/capabilities`).

### ITool Interface

```typescript
export interface ITool {
  name: string;
  description: string; // Shown to the LLM — be precise!
  parameters: {        // JSON Schema for the args
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
  execute: (args: any) => Promise<string>; // Always returns a string result
}
```

---

## 🛡️ Protected Files

The `fileWrite` tool blocks writes to these files to prevent accidental system destruction:

```
sst.config.ts
core/tools/index.ts
core/agents/superclaw.ts
core/lib/agent.ts
buildspec.yml
infra/**
```

Any attempt returns `PERMISSION_DENIED` and the Coder Agent **must** request `MANUAL_APPROVAL_REQUIRED` from the human on Telegram/Slack.

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

1. **Bootloader Phase**: Agents start with a minimal "Essential" toolset (Discovery, Recall, Dispatch). This keeps initial token costs low and focus high.
2. **Just-in-Time (JIT) Expansion**: Agents use `discoverSkills` to find specialized local tools or external MCP capabilities only when the task requires them.
3. **Usage Tracking**: Every successful tool execution is recorded atomically in the `ConfigTable` (`tool_usage` key), tracking both the total `count` and the `lastUsed` timestamp.
4. **Selective Discovery Mode**: When enabled, the system automatically prunes an agent's toolset back to the "Core 4" (Dispatch, Recall, Discovery, Config) if it hasn't used a tool recently or if the toolset exceeds a complexity threshold.
5. **MCP Server Pruning**: The **ClawCenter Dashboard** provides usage analytics for MCP servers, allowing humans or the SuperClaw to `unregisterMCPServer` if it's no longer providing value to the system.

### Performance Impact
- **Context Reduction**: Up to 70% reduction in system prompt size.
- **Reasoning Accuracy**: Significant reduction in "Tool Confusion" (LLM picking the wrong tool) by limiting choices.
- **Cost Efficiency**: Lower input token costs due to smaller tool definitions.

---

## 📡 Deploy Lifecycle (Tool Sequence)

```text
dispatchTask (coder) → mcp-filesystem-write → [human approves if protected]
                                                     ↓
                                           triggerDeployment
                                                     ↓
                                             checkHealth (Health Probe)
                                          ↓            ↓
                                      OK (–1 count)  FAILED → triggerRollback
```
