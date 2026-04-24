# System Vertical: Regeneration & Technical Debt Metabolism

> **Navigation**: [← Index Hub](../../INDEX.md) | [Audit Framework](../governance/AUDIT.md#7-the-metabolism-regenerative-repair--bloat-management)

Silo 7 is the **Regenerative Repair Engine** of the Serverless Claw swarm. It ensures architectural longevity by autonomously identifying and recycling "Metabolic Waste" (stale state, dead code, and technical debt).

## The Regenerative Cycle

The metabolism operates on two distinct loops:

1. **Periodic Audit Cycle**: A continuous feedback loop that bridges observation (Audit) and action (Repair), ensuring the system remains lean.
2. **Live Remediation Path**: An event-driven bridge that triggers repairs _immediately_ upon failure detection in critical surfaces (like the Dashboard).

#### 1. Periodic Audit (Continuous)

```text
          .-----------------------------------------.
         /        REGENERATIVE METABOLISM         \
        |             (SILO 7 ENGINE)              |
         \_________________________________________/
                        |
                        v
          .--------------------------------.
         /       COGNITION REFLECTOR      /|
        /   (Audit Protocol Execution)    / |
       +--------------------------------+  |
       |                                |  |
       |  "Perform While Auditing"      |  |
       |                                |  /
       +--------------------------------+ /
                |              |
                | (Repair)     | (Propagate)
                v              v
       .----------------.    .----------------.
      /  METABOLISM    /|   /   STRATEGIC    /|
     /    SERVICE     / |  /    PLANNER     / |
    +----------------+  | +----------------+  |
    |  - Prune Tools |  | |  - Execute P1  |  |
    |  - Cull Gaps   |  | |    Maintenance |  |
    |  - AIReady MCP |  / |    Gaps        |  /
    +----------------+ /  +----------------+ /
           ^                  |
           |                  |
           '------------------'
           (Architectural Decay Recycled)
```

#### 2. Live Remediation (Event-Driven)

```text
 [ Dashboard Interaction ]
          |
          v
 [ ClawTracer.failTrace() ]
          |
    (TASK_FAILED Event)
          |
          v
 [ DashboardFailureHandler ]
          |
          v
 [ MetabolismService ] -- (Surgical ID) --> [ AgentRegistry.pruneAgentTool ]
          |                                (Atomic Remedy via P13)
          '----------- (Complex/HITL) ---------> [ EvolutionScheduler ]
                                                   (Awaiting Human)
```

## Metabolic State Transitions

The lifecycle of systemic "Waste" follows a strict entropy-reversal path:

```text
 [ ACTIVE STATE ] ---- (90-Day Stasis) ----> [ METABOLIC WASTE ]
      |                                           |
      |                                           |
      |                                  (Silo 7 Detection)
      |                                           |
      v                                           v
 [ PRODUCTIVE ] <---- (Re-Integration) ---- [ ARCHIVAL/CULL ]
```

## Core Components

### 1. Metabolism Service (`MetabolismService`)

The central coordinator that manages the lifecycle of metabolic audits. It prioritizes "live state" repairs (Registry/Memory) before delegating deep code analysis to specialized MCP servers.

### 2. Autonomous Repair Protocols

- **Surgical Atomic Pruning**: An event-driven bridge for live remediation. If a tool fails in the dashboard, the metabolism service identifies the specific tool and delegates an atomic removal to `AgentRegistry.pruneAgentTool`. (Enforces **Principle 13**).
- **Tool Pruning**: Automatically removes dynamic tool overrides from the `AgentRegistry` if they have 0 executions over a configurable window (default 30 days). Supports both workspace-scoped agents (when `workspaceId` provided) and backbone agents (when `workspaceId` undefined).
- **Per-Workspace Tool Usage**: Tool usage is tracked across three dimensions:
  - Global: `tool_usage_global` - system-wide tool popularity
  - Per-agent: `tool_usage_{agentId}` - agent-specific usage
  - Per-workspace: `WS#{workspaceId}#tool_usage` - workspace-isolated tracking (new)
- **Memory Culling**: Purges knowledge gaps in `DONE` or `DEPLOYED` status that are older than **60 days** (configurable via `GAPS_RETENTION_DAYS`). Both archival (stale OPEN gaps >30 days) and culling (resolved gaps >60 days) run in the periodic maintenance cycle.
- **Feature Flag Pruning**: Automatically removes stale feature flags that have either expired (`expiresAt` timestamp in past) or exceeded the age threshold (default 30 days). Integrates with `FeatureFlags.pruneStaleFlags()` during the periodic maintenance cycle.
- **Native Fallback**: A resilient scanner that performs basic debt identification (e.g., scanning for orphans or TODOs) even when the AIReady MCP server is offline. Scan depth is configurable via `AUDIT_SCAN_DEPTH` (default: 3 levels).

## Principle 10: Lean Evolution

> "Every line of code is a maintenance liability."

Silo 7 is the primary enforcement mechanism for Principle 10. By treating technical debt as a metabolic byproduct that must be recycled, the system ensures that its autonomous growth does not lead to "Architectural Cancer" (unbounded complexity and bloat).

## Interaction Topology

```text
[ Nerve Center UI ] <--- Trigger --- [ Human/Operator ]  (Manual "Repair")
        |
        v
[ /api/system/metabolism ]
        |
        v
[ Metabolism Service ]
    |
    |-- [ AgentRegistry ] : pruneLowUtilizationTools()
    |-- [ MemoryProvider ] : cullResolvedGaps()
    |-- [ FeatureFlags ] : pruneStaleFlags()
    |
    v
[ UI Blocks / Toast ] <--- (Findings: Pruned 5 tools, Culled 2 gaps)
```

---

[ Real-time Failure ] --- Trigger --- [ Dashboard/Agent ] (Immediate)
|
v
[ DashboardFailureHandler ]
|
v
[ MetabolismService ] : remediateDashboardFailure()
|
|-- (Fixable?) ----> [ Autonomous Repair ]
'-- (Complex?) ----> [ EvolutionScheduler ] (HITL)

```

## Operational Safeguards

- **Multi-Tenant Isolation**: All repairs utilize `workspaceId` to ensure the metabolism of one tenant never leaks into or deletes another's memory.
- **Atomic State Integrity**: Registry pruning and memory culling use **Field-Level Atomic Filtering** via `ConfigManager.atomicRemoveFromMapList`. This ensures that maintenance tasks never overwrite active agent configurations, even in highly concurrent swarm environments.
```
