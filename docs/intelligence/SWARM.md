# Swarm Orchestration & Mission Decomposition

> **Navigation**: [← Index Hub](../../INDEX.md)

This document describes how Serverless Claw coordinates multiple agents into a "swarm" to solve complex missions through asynchronous orchestration and recursive task decomposition.

## 🌊 Asynchronous Orchestration

Serverless Claw uses a non-blocking, event-driven orchestration pattern. Agents do not wait for results; they emit tasks to the **AgentBus** and terminate. They resume only when a `CONTINUATION_TASK` event is routed back to them.

### Orchestration Flow

```text
User (Telegram)       SuperClaw (Lambda)       AgentBus (EB)       Specialized Agent (Coder)
      |                      |                      |                      |
      +---- "Feature X" ---->|                      |                      |
      |                      +--- dispatchTask ---->|                      |
      |                      | (initiator:SC, dep:0)|                      |
      |                      |                      +---- coder_task ----->|
      |                 [TERMINATE]                 |                      |
      |                      |                      |                      |
      |                      |                      |       [THINK & EXECUTE]
      |                      |                      |                      |
      |                      |                      |<--- TASK_COMPLETED --+
      |                      |                      | (result, traceId, SC)|
      |                      |      [EH ROUTE]      |       [TERMINATE]
      |                      |                      |
      |                      |<-- CONTINUATION_TASK-+
      |                      | (result, depth: 1)   |
      |                      |                      |
      |                      +--- "X Completed" --->|
      v                      |                      v
```

---

## 🎯 Mission Decomposition (The Stellar Harbor)

The system supports recursive task decomposition. Any agent can act as a **Mission Commander** by returning a plan with structured markers.

### 1. Mission Markers

When an agent returns a response containing specific markers, the `AgentRunner` intercepts it and dispatches parallel tasks:

- **`### Goal: [AgentType] - [Task]`**: Defines a high-level goal for a specific agent.
- **`### Step: [Task Description]`**: Defines a sub-task within the goal.

### 2. Parallel Dispatch Protocol

The system enables an agent to delegate multiple independent sub-tasks concurrently. It uses a **Barrier Timeout** to ensure the system remains responsive even if sub-agents stall.

### 3. Aggregation Modes

- **Summary**: Aggregates worker results into a formatted Markdown summary.
- **Agent-Guided**: Invokes an aggregator agent to synthesize results and determine the next step based on an `aggregationPrompt`.

---

## 🚦 Swarm Governance & Safety

### 1. Recursive Depth Control

To prevent "infinite reasoning loops," the system enforces a strict depth limit (Default: **5 levels** for missions, **15 hops** for general events).

- **Enforcement**: The `EventHandler` routing logic proactively checks the `depth` counter on every event.
- **Action**: If a task exceeds the limit, it is aborted, and a message is sent to the initiator.

### 2. Worker Feedback Toggle

During massive swarms, sub-agents (workers) can create significant dashboard noise.

- **Config**: `worker_feedback_enabled` (Default: `true`).
- **Behavior**: If `false`, sub-agents skip MQTT chunk emission, while **Root** agents (SuperClaw) always emit feedback.

### 3. Swarm Consensus Protocol (Voting)

For high-impact strategic decisions, agents use a voting mechanism:

- **Majority**: > 50% YES.
- **Unanimous**: 100% YES.
- **Weighted**: Votes are weighted by the agent's **Reputation Score**.

---

## 📡 Adaptive Communication Hub

Agents dynamically switch their output protocol based on the presence of human participants in a collaboration session.

### 1. Communication Modes

| Mode       | Trigger                   | Protocol                    | Goal                      |
| :--------- | :------------------------ | :-------------------------- | :------------------------ |
| **`text`** | Human Participant Present | Natural Language (Markdown) | Readability & Alignment   |
| **`json`** | Autonomous Swarm Only     | Structured JSON             | Protocol Precision & Cost |

### 2. Mode Selection Logic (Diagram B)

```text
       [ AGENT TRIGGERED ]
               |
      (Is Collaboration?) -- NO --> [ MODE: text ] (Default)
               |
              YES
               |
      [ LOAD Participants ]
               |
      (Contains human?) -- YES --> [ MODE: text ]
               |
               NO
               |
         [ MODE: json ]
```

### 3. Benefits of Adaptive Protocol

- **Protocol Density**: In `json` mode, agents omit conversational filler, reducing token usage by ~30% for inter-agent communication.
- **Audit Integrity**: `text` mode ensures humans can always observe the swarm's reasoning without needing custom parsers.

---

## 🛰️ Backbone Event Roster (Signals)

| Event Type                | Source Agent     | Trigger                              |
| :------------------------ | :--------------- | :----------------------------------- |
| `PARALLEL_TASK_DISPATCH`  | Orchestrator     | Dispatch multiple tasks in parallel  |
| `PARALLEL_TASK_COMPLETED` | Parallel Handler | Aggregated parallel results received |
| `CONTINUATION_TASK`       | Worker           | Sub-task completion reporting back   |
| `ORCHESTRATION_SIGNAL`    | Any              | Active state-machine signal          |
| `REPUTATION_UPDATE`       | EventHandler     | Agent reputation metrics updated     |

---

## 🔄 Coordination Flow

### 3-Tier Agent Multiplexer

The system uses a multiplexer to consolidate execution environments, eliminating cumulative cold-start latency while maintaining resource-aware bucketing (**High-Power**, **Standard**, **Light**).

### Lock Lifecycle

When an agent is triggered, it follows a strict lock lifecycle:

1. **Acquire**: Check DynamoDB for a task lock.
2. **Execute**: Run reasoning loop if lock is acquired.
3. **Release**: Release lock and emit results.
4. **Retry**: If lock is busy, the task is paused and queued for backoff.

---

## 🧪 Simulation Sandbox (Multi-Agent Playground)

The **Simulation Sandbox** (`/playground`) provides a high-fidelity isolated environment for testing complex swarm interactions without production side effects.

### 1. Swarm Simulation Mode

In the playground, you can select multiple agents to form a **Swarm Team**. This mode enables:

- **Multi-Agent Isolation**: All participating agents run with `isIsolated: true`, preventing them from writing to persistent memory or affecting reputation scores.
- **Dynamic Persona Tuning**: You can override the `systemPrompt` for each agent individually within the session.
- **Trace Visualization**: Real-time inspection of the coordination chain, showing how agents hand off tasks or share context.

### 2. Sandbox Interaction Topology

```text
 [ Developer ] ---- (Select Team: [Coder, QA, Researcher]) ----> [ Playground UI ]
                                                                       |
          +------------------------------------------------------------+
          |
          v
 [ Swarm Chat ] ---- (Query) ----> [ multi-agent POST /api/chat ]
                                              |
          +-----------------------------------+-----------------------------------+
          |                                   |                                   |
 [ Coder (Sandbox) ]                 [ QA (Sandbox) ]                 [ Researcher (Sandbox) ]
 (Prompt Override A)                 (Prompt Override B)                 (Prompt Override C)
          |                                   |                                   |
          +-----------------------------------+-----------------------------------+
                                              |
                                     [ Unified Trace Log ]
```
