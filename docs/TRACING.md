# Neural Path Tracing Architecture

> **Navigation**: [← Index Hub](../INDEX.md)

Serverless Claw uses a **Branched Neural Path Tracing** model to visualize complex, parallel multi-agent workflows.

## Trace Graph Model

Instead of a linear log, the system records a **Directed Acyclic Graph (DAG)** of execution nodes.

### Standard Evolution Path

```text
 [ User Msg ] 
      |
   (root) 
  SuperClaw
      |
      +---------------------------+
      |                           |
  (node_A)                    (node_B)
  Planner Agent               Coder Agent
      |                           |
   [Research]                  [Fix Code]
      |                           |
      +------------+--------------+
                   |
                (node_C)
                QA Agent
```

### Council of Agents Path (High-Impact Plans)

When the Strategic Planner detects high impact/risk/complexity (≥ 8), it dispatches three parallel Critic Agent reviews before proceeding to the Coder:

```text
 [ User Msg ] 
      |
   (root) 
  SuperClaw
      |
  (node_A)
  Planner Agent
      |
   [Plan Design]
      |
      +--- PARALLEL_TASK_DISPATCH ---+
      |                               |
      +--- (node_B1)                  |
      |    Critic (Security)          |
      +--- (node_B2)                  |
      |    Critic (Performance)       |
      +--- (node_B3)                  |
           Critic (Architect)         |
      |                               |
      +--- (node_C) <-----------------+
           Aggregation
           [agent_guided]
              |
              +-----------+-----------+
              |                       |
        [APPROVED]            [REJECTED/CONDITIONAL]
              |                       |
        (node_D)              (node_A2)
        Coder Agent           Planner (revise)
        [Fix Code]            [Re-plan]
              |
        (node_E)
        QA Agent
```

1. **Trace ID Propagation**: A global `traceId` links all nodes in a single request lifecycle.
2. **Node Branching**: When an agent uses `dispatchTask`, a child `nodeId` is generated, linked to the `parentId`.
3. **DAG Visualization**: The ClawCenter dashboard renders this as a neural map, allowing users to drill down into specific parallel execution branches.

## Storage Optimization

To support efficient retrieval of entire execution graphs, the **TraceTable** (DynamoDB) uses a **Composite Primary Key**:
- **Hash Key (`traceId`)**: Links all nodes in a single user request.
- **Range Key (`nodeId`)**: Identifies individual agent executions or parallel branches.

This structure allows a single `Query` operation to retrieve the complete neural path for visualization.

## Trace Types Reference

The system records various trace types to capture the full lifecycle of agent-to-agent communication:

### Standard Trace Types

| Trace Type | Description | Content Example |
|------------|-------------|-----------------|
| `llm_call` | Agent reasoning request | `{ messages: [...], model: 'gpt-4' }` |
| `llm_response` | Agent reasoning output | `{ content: '...', tool_calls: [...] }` |
| `tool_call` | Tool execution request | `{ tool: 'runShellCommand', args: {...} }` |
| `tool_result` | Tool execution result | `{ result: 'output...' }` |
| `error` | Execution error | `{ errorMessage: '...' }` |

### Agent Communication Trace Types

| Trace Type | Description | Content Example |
|------------|-------------|-----------------|
| `clarification_request` | Agent pauses for clarification | `{ question: '...', agentId: 'coder' }` |
| `clarification_response` | Clarification provided | `{ answer: '...', agentId: 'superclaw' }` |
| `parallel_dispatch` | Fan-out to parallel agents | `{ tasks: [...], aggregationType: 'summary' }` |
| `parallel_barrier` | Waiting for parallel agents | `{ pendingAgents: [...], completedAgents: [...] }` |
| `parallel_completed` | Parallel aggregation done | `{ result: '...', completedTasks: 3 }` |
| `council_review` | Council of Agents review | `{ decision: 'APPROVED', reviews: [...] }` |
| `continuation` | Task result routing | `{ taskResult: '...', targetAgent: 'superclaw' }` |
| `plan_generated` | Strategic plan generated | `{ planId: '...', coveredGaps: [...], planSnippet: '...' }` |

### System Event Trace Types

| Trace Type | Description | Content Example |
|------------|-------------|-----------------|
| `circuit_breaker` | Circuit breaker state change | `{ previousState: 'closed', newState: 'open' }` |
| `cancellation` | Task cancellation | `{ reason: 'User requested', cancelledBy: 'user' }` |
| `memory_operation` | Memory save/load | `{ operation: 'save', memoryType: 'fact', key: '...' }` |

### Agent State Trace Types

| Trace Type | Description | Content Example |
|------------|-------------|-----------------|
| `agent_waiting` | Agent paused waiting | `{ reason: 'Waiting for clarification', agentId: 'coder' }` |
| `agent_resumed` | Agent resumed execution | `{ resumedFrom: 'clarification', agentId: 'coder' }` |

## Clarification Protocol Trace Flow

When an agent encounters ambiguity, it pauses execution and requests clarification:

```text
 (node_A)
 Coder Agent
     |
 [Start Task]
     |
 [CLARIFICATION_REQUEST] ──────→ Question sent to initiator
     |
 [AGENT_WAITING] ─────────────→ Agent paused, waiting for response
     |
 [AGENT_RESUMED] ←─────────────── User provides clarification
     |
 [Continue Task]
```

### Trace Data Structure

```json
{
  "traceId": "req-abc123",
  "nodeId": "node-coder-1",
  "steps": [
    {
      "type": "clarification_request",
      "content": {
        "question": "Should this function handle null inputs?",
        "agentId": "coder",
        "originalTask": "Implement input validation"
      }
    },
    {
      "type": "agent_waiting",
      "content": {
        "reason": "Waiting for user clarification",
        "waitingFor": "user-input",
        "agentId": "coder"
      }
    },
    {
      "type": "agent_resumed",
      "content": {
        "resumedFrom": "clarification",
        "agentId": "coder",
        "context": "User confirmed null handling is required"
      }
    }
  ]
}
```

## Parallel Dispatch Trace Flow

When a task is dispatched to multiple agents in parallel:

```text
 (root)
 SuperClaw
     |
 [PARALLEL_DISPATCH] ─────────→ Fan-out to 3 agents
     |
     +─── (node_B1) ──── Critic Security
     |        [llm_call] → [llm_response]
     |
     +─── (node_B2) ──── Critic Performance
     |        [llm_call] → [llm_response]
     |
     +─── (node_B3) ──── Critic Architect
              [llm_call] → [llm_response]
     |
 [PARALLEL_BARRIER] ─────────→ Waiting for all agents
     |
 [PARALLEL_COMPLETED] ────────→ Aggregation complete
     |
 [CONTINUATION] ───────────────→ Result sent to initiator
```

### Trace Data Structure

```json
{
  "traceId": "req-abc123",
  "nodeId": "root",
  "steps": [
    {
      "type": "parallel_dispatch",
      "content": {
        "tasks": [
          { "agentId": "critic-security", "task": "Security review" },
          { "agentId": "critic-performance", "task": "Performance review" },
          { "agentId": "critic-architect", "task": "Architecture review" }
        ],
        "aggregationType": "agent_guided"
      }
    },
    {
      "type": "parallel_barrier",
      "content": {
        "status": "waiting",
        "pendingAgents": ["critic-security", "critic-performance"],
        "completedAgents": ["critic-architect"]
      }
    },
    {
      "type": "parallel_completed",
      "content": {
        "result": "All reviews passed with minor suggestions",
        "completedTasks": 3,
        "totalTasks": 3
      }
    }
  ]
}
```

## Plan Decomposition Trace Flow

When the Strategic Planner decomposes a complex plan into sub-tasks, each sub-task is tracked as a child node in the trace DAG:

```text
(root)
Strategic Planner
     |
 [PLAN_GENERATED] ───────────→ Plan decomposed into 3 sub-tasks
     |
     +─── PARALLEL_TASK_DISPATCH ────+
     |                                |
     +─── (child-1) ──── Coder Agent
     |        [sub-task 1: Update User model]
     |        [llm_call] → [llm_response] → [tool_call]
     |
     +─── (child-2) ──── Coder Agent
     |        [sub-task 2: Create verification endpoint]
     |        [llm_call] → [llm_response] → [tool_call]
     |
     +─── (child-3) ──── Coder Agent
              [sub-task 3: Update login flow]
              [llm_call] → [llm_response] → [tool_call]
     |
 [PARALLEL_BARRIER] ──────────────→ Waiting for all sub-tasks
     |
 [PARALLEL_COMPLETED] ─────────────→ All sub-tasks complete
     |
 [CONTINUATION] ───────────────────→ Aggregated results
```

### DAG-Based Dependencies

Sub-tasks can have explicit dependencies via `dependsOn` edges:

```text
(root)
Strategic Planner
     |
 [PLAN_GENERATED] ───────────→ Plan with dependencies
     |
     +─── PARALLEL_TASK_DISPATCH ────+
     |                                |
     +─── (child-1) ──── Coder Agent
     |        [dependsOn: []]
     |        [sub-task 1: Update User model]
     |
     +─── (child-2) ──── Coder Agent ⏸️ WAITING
     |        [dependsOn: [child-1]]
     |        [sub-task 2: Create endpoint]
     |
     +─── (child-3) ──── Coder Agent ⏸️ WAITING
              [dependsOn: [child-2]]
              [sub-task 3: Update login flow]
     |
 [child-1 COMPLETED] ──────────────→ Triggers child-2
     |
 [child-2 COMPLETED] ──────────────→ Triggers child-3
     |
 [child-3 COMPLETED] ──────────────→ All done
     |
 [PARALLEL_COMPLETED] ─────────────→ Aggregated results
```

### Trace Data Structure

```json
{
  "traceId": "plan-abc123",
  "nodeId": "root",
  "steps": [
    {
      "type": "plan_generated",
      "content": {
        "planId": "plan-abc123",
        "coveredGaps": ["gap-1", "gap-2", "gap-3"],
        "planSnippet": "1. Update User model..."
      }
    },
    {
      "type": "parallel_dispatch",
      "content": {
        "tasks": [
          { "taskId": "plan-abc123-sub-0", "agentId": "coder", "dependsOn": [] },
          { "taskId": "plan-abc123-sub-1", "agentId": "coder", "dependsOn": [0] },
          { "taskId": "plan-abc123-sub-2", "agentId": "coder", "dependsOn": [1] }
        ],
        "hasDependencies": true
      }
    }
  ]
}
```

---

## Circuit Breaker Trace Flow

Circuit breaker state changes are recorded for debugging and monitoring:

```text
 [Deployment Attempt]
     |
 [CIRCUIT_BREAKER] ───────────→ State: closed → open
     |                          Reason: Too many failures
     |
 [Deployment Blocked]
     |
 [Cooldown Period]
     |
 [CIRCUIT_BREAKER] ───────────→ State: open → half_open
     |
 [Probe Deployment]
     |
 [CIRCUIT_BREAKER] ───────────→ State: half_open → closed
```

### Trace Data Structure

```json
{
  "traceId": "deploy-xyz789",
  "nodeId": "root",
  "steps": [
    {
      "type": "circuit_breaker",
      "content": {
        "previousState": "closed",
        "newState": "open",
        "reason": "Too many deployment failures",
        "failureCount": 5
      }
    }
  ]
}
```

## Dashboard Visualization

The ClawCenter dashboard renders traces as an interactive **Neural Map** using React Flow:

- **Trigger Nodes**: Entry points (green)
- **LLM Nodes**: Agent reasoning steps (blue)
- **Tool Nodes**: Tool executions (yellow)
- **Clarification Nodes**: Clarification requests (purple, with question icon)
- **Waiting Nodes**: Agent paused states (yellow, pulsing)
- **Parallel Barrier Nodes**: Parallel dispatch barriers (violet)
- **Council Review Nodes**: Council of Agents reviews (red, shield icon)
- **Continuation Nodes**: Task result routing (teal)
- **Circuit Breaker Nodes**: State changes (orange, circuit icon)
- **Cancellation Nodes**: Task cancellations (rose)
- **Error Nodes**: Execution errors (red, alert icon)
- **Result Nodes**: Final responses (green, checkmark icon)

### Edge Types

- **Green edges**: Normal execution flow
- **Orange dashed edges**: Delegation (dispatchTask)
- **Purple edges**: Clarification request/response
- **Violet edges**: Parallel dispatch
- **Teal edges**: Continuation routing
