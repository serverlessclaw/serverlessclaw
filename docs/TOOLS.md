# Agent Tool Registry

> **Agent Context Loading**: Load this file when you need to add, modify, or understand any tool.

## Available Tools

| Tool | Purpose | Protected? | Writes to Cloud? |
|------|---------|:---:|:---:|
| `calculator` | Evaluates math expressions | — | — |
| `get_weather` | Returns mock weather (demo) | — | — |
| `dispatch_task` | Sends a task event to EventBridge → Coder Agent | — | ✅ |
| `file_write` | Writes to a file in the codebase | ✅ Labelled | — |
| `validate_code` | Runs `tsc --noEmit` + `eslint` pre-flight | — | — |
| `trigger_deployment` | Starts a CodeBuild deploy (circuit-breaker protected) | ✅ Labelled | ✅ |
| `check_health` | Hits `GET /health`. On success: decrements deploy counter | — | ✅ |
| `trigger_rollback` | `git revert HEAD` + redeploy. Emergency use only | — | ✅ |
| `switch_model` | Updates active provider/model in DynamoDB (Hot Config) | — | ✅ |
| `run_tests` | Executes project unit tests (vitest) | — | — |
| `recall_knowledge` | Retrieves distilled facts/lessons from memory | — | — |
| `list_agents` | Discovers available specialized agents in the system | — | — |

---

## Adding a New Tool

1. Open `core/tools/index.ts`.
2. Add an entry to the `tools` record following the `ITool` interface.
3. If this should be available to a backbone agent by default, add it to their `tools` array in `core/lib/backbone.ts`.
4. Run `validate_code` to check for regressions.
5. Update the table above.
6. Update `src/lib/tools.test.ts` to include the new tool name.

### Dynamic Scoping
Agents no longer receive all tools by default. They call `getAgentTools(agentId)` which:
1. Checks the `AgentRegistry` (Backbone + DynamoDB).
2. Returns a subset of tools assigned to that specific agent.
3. Users can grant/revoke tools for any agent in the **ClawCenter** dashboard under `/settings`.

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

## Protected Files

The `file_write` tool blocks writes to these files:

```
sst.config.ts
src/tools/index.ts
src/agents/superclaw.ts
src/lib/agent.ts
buildspec.yml
infra/**
```

Any attempt returns `PERMISSION_DENIED` and the Coder Agent **must** request `MANUAL_APPROVAL` from the human.

---

## Deploy Lifecycle (Tool Sequence)

```
dispatch_task (coder) → file_write → validate_code → [human approves if protected]
                                                    ↓
                                          trigger_deployment
                                                    ↓
                                            check_health
                                         ↓            ↓
                                     OK (–1 count)  FAILED → trigger_rollback
```
