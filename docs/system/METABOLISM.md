# System Vertical: Silo 7 — Regenerative Metabolism

Silo 7 is the **Regenerative Repair Engine** of the Serverless Claw swarm. It ensures architectural longevity by autonomously identifying and recycling "Metabolic Waste" (stale state, dead code, and technical debt).

## The Regenerative Cycle

The metabolism operates on a continuous feedback loop that bridges observation (Audit) and action (Repair), ensuring the system remains lean and self-correcting.

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

- **Tool Pruning**: Automatically removes dynamic tool overrides from the `AgentRegistry` if they have 0 executions over a 30-day window.
- **Memory Culling**: Purges knowledge gaps in `DONE` or `DEPLOYED` status that are older than 90 days.
- **Native Fallback**: A resilient scanner that performs basic debt identification (e.g., scanning for orphans or TODOs) even when the AIReady MCP server is offline.

## Principle 10: Lean Evolution

> "Every line of code is a maintenance liability."

Silo 7 is the primary enforcement mechanism for Principle 10. By treating technical debt as a metabolic byproduct that must be recycled, the system ensures that its autonomous growth does not lead to "Architectural Cancer" (unbounded complexity and bloat).

## Interaction Topology

```text
[ Governance Tool ] <--- Trigger --- [ Human/Operator ]
        |
        v
[ Metabolism Service ]
    |
    |-- [ AgentRegistry ] : prune()
    |-- [ MemoryProvider ] : cull()
    |-- [ MCPMultiplexer ] : check(AIReady)
    |
    v
[ Audit Findings ] ---> [ Strategic Planner ] (if P1/P2)
```

## Operational Safeguards

- **Multi-Tenant Isolation**: All repairs utilize `workspaceId` to ensure the metabolism of one tenant never leaks into or deletes another's memory.
- **Atomicity**: Registry pruning and memory culling use conditional DynamoDB updates to prevent race conditions in highly concurrent environments.
