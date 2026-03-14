# Agent Architecture & Orchestration

> **Agent Context Loading**: Load this file when you need to modify agent logic, prompts, communication patterns, or add a new sub-agent.

## 🤖 Agent Roster

We distinguish between **Autonomous Agents** (LLM-powered decision-makers) and **System Handlers** (deterministic logic for monitoring and recovery).

### 1. Autonomous Agents (LLM-Powered)

| Agent | Runtime | Config Source | Responsibilities |
|-------|---------|---------------|-----------------|
| **SuperClaw** | `core/handlers/webhook.ts` | `core/agents/superclaw.ts` | Interprets user intent, delegates, deploys |
| **Coder Agent** | `core/agents/coder.ts` | `AgentRegistry` (Backbone) | Writes code, runs pre-flight checks |
| **Worker Agent** | `core/agents/worker.ts` | `AgentRegistry` (Dynamic) | Generic runner for any user-defined agent |
| **Strategic Planner** | `core/agents/strategic-planner.ts` | `AgentRegistry` (Backbone) | Designs strategic evolution plans |
| **Cognition Reflector** | `core/agents/cognition-reflector.ts` | `AgentRegistry` (Backbone) | Distills memory and extracts gaps |
| **QA Auditor** | `core/agents/qa.ts` | `AgentRegistry` (Backbone) | Verifies satisfaction of deployed changes |

### 2. System Handlers (Logic-Powered)

| Component | Runtime | Trigger | Responsibilities |
|-----------|---------|---------|------------------|
| **Build Monitor** | `core/handlers/monitor.ts` | CodeBuild Event | Observes builds, updates gap status, circuit breaking |
| **Dead Man's Switch** | `core/handlers/recovery.ts` | EventBridge Schedule | Hourly health checks, emergency git rollback |
| **Notifier** | `core/handlers/notifier.ts` | AgentBus Event | Formats and sends messages to Telegram/Slack |
| **Real-time Bridge** | `core/handlers/bridge.ts` | AgentBus Event | Bridges EventBridge signals to AWS IoT Core (MQTT) |
| **Deployer** | AWS CodeBuild | `buildspec.yml` | Runs `sst deploy` in isolated environment |

---

## Orchestration Flow (Asynchronous "Pause and Resume")

Serverless Claw uses an asynchronous, non-blocking orchestration pattern. Agents do not wait for results; they emit tasks and terminate, resuming only when a completion event is routed back to them.

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

### Clarification Protocol (Conversational Mid-task Coordination)

Unlike a standard handoff, the Clarification Protocol allows a sub-agent to pause and seek directions from its initiator without failing the task.

```text
Initiator (Planner)     AgentBus (EB)       Follower (Coder)
      |                      |                      |
      +--- dispatchTask ---->|                      |
      |                      +---- coder_task ----->|
      |                 [TERMINATE]                 |
      |                      |               [THINK: Ambiguity!]
      |                      |<-- seekClarification-+
      |      [EH ROUTE]      |   (question, task)   |
      |                      |       [PAUSE/TERMINATE]
      |<-- CONTINUATION_TASK-+                      |
      | (CLARIFICATION_REQ)  |                      |
      |                      |                      |
      | [THINK: Answer]      |                      |
      |                      |                      |
      +-- provideClarification                      |
      |   (answer) --------->|                      |
      |                      +-- CONTINUATION_TASK->|
      |                 [TERMINATE]                 |
      |                      |              [RESUME with Answer]
      |                      |                      |
```

### Routing Metadata
Every event on the `AgentBus` carries critical routing metadata:
- **`traceId`**: Consolidates all agent steps into a single unified timeline.
- **`initiatorId`**: The ID of the agent that started the task (used to route results back).
- **`depth`**: Current recursion level. The system automatically terminates tasks exceeding the **Recursion Limit** (Default: 50) to prevent infinite loops. This limit is hot-swappable in the Dashboard Settings.

---

## Co-Management & Evolution

Agents are not just autonomous; they are **co-managed** via the ClawCenter dashboard, structured into four sectors: **Intelligence**, **Evolution**, **Infrastructure**, and **Observability**.

### 1. Neural Agent Registry (Evolution)
Users can register and configure agents in the **Evolution** sector. 
- **Persona**: Define the system prompt (instructions) for the agent.
- **Dynamic Scoping**: Toggle tools on/off for specific agents without redeploying.
- **Immediate Availability**: Once registered, the SuperClaw can immediately delegate tasks to the new node via `dispatchTask`.

### 2. Global Optimization Policy (Infrastructure)
Users can set a global `optimization_policy` to control system-wide reasoning depth:
- **AGGRESSIVE**: Forces `DEEP` reasoning for all nodes (Highest Quality, Highest Cost).
- **CONSERVATIVE**: Forces `FAST` reasoning (Lowest Latency, Lowest Cost).
- **BALANCED**: Respects the task's intended profile.

---

## 🔄 Autonomous Expansion (The Discovery Loop)

Serverless Claw agents are capable of self-provisioning new tools when they encounter a `strategic_gap` that requires external capabilities.

```text
       [ SuperClaw ]
             |
      1. discoverSkills("git management")
             |
      2. registerMCPServer("mcp-server-git", "npx ...")
             |
      3. installSkill("git_push", agentId: "coder")
             |
    +--------V--------+
    |   Coder Agent   | <--- Now equipped with structured Git pushing
    +-----------------+
```

1. **Discovery**: When an agent realizes it lacks a specific capability (e.g., "I need to query a Postgres DB"), it uses `discoverSkills` to search for relevant MCP servers.
2. **Registration**: The agent uses `registerMCPServer` to add the MCP server to the global configuration. This tells the `MCPBridge` how to spawn the server (usually via `npx`).
3. **Equipment**: The agent uses `installSkill` to add specific tools from the new server to its own toolset or the toolset of a specialized peer (like the Coder).
4. **Persistence & Telemetry**: These changes are saved atomically to the `ConfigTable`. Every subsequent tool execution is recorded (`tool_usage`), providing the data signature needed for future audits.

### 🔄 The Efficiency Loop (Dynamic Pruning)

To balance rapid expansion, the system implements a long-term **Efficiency Loop** to identify and remove deadweight.

```text
       [ ConfigTable ] 
              |
       1. RECORD_USAGE (per tool call)
              |
       2. AUDIT_TELEMETRY (48-hr Strategic Review)
              |
       3. SUGGEST_PRUNING (Refiner/Planner)
              |
    +---------+---------+
    |   Human Admin     | <--- Approve/Execute removal via Dashboard
    +-------------------+
```

- **Deterministic Auditing**: Every 48 hours (or after 20 gaps), the Strategic Planner analyzes the `tool_usage` telemetry.
- **Redundancy Detection**: If two MCP servers provide overlapping capabilities, or if a tool hasn't been used in 30 days, the Planner suggests a `PRUNE_CAPABILITY` plan.
- **Manual Intervention**: Humans can instantly unregister servers or uninstall skills via the **Evolution** sector in the Dashboard.

### 3. Evolutionary Lifecycle (Verified Satisfaction)

Serverless Claw is a **self-evolving system** that identifies its own weaknesses and implements its own upgrades.

```text
    +-------------------+       1. OBSERVE        +-------------------+
    |   Cognition       |<------------------------|   Conversations   |
    |   Reflector       |      (Signals)          |   (User context)  |
    +---------+---------+                         +-------------------+
              |
              | 2. LOG STRATEGIC_GAP (DDB: OPEN)
              v
    +---------+---------+       3. DESIGN         +-------------------+
    |   Strategic       |------------------------>|   Strategic Plan  |
    |   Planner         |      (DDB: PLANNED)     |   (Proposal)      |
    +---------+---------+                         +-------------------+
              |                                             |
              | 4. DISPATCH_TASK (if auto/approved)         | (Notify)
              |    [APPROVAL GATE]                          v
              v                                     +-------------------+
    +---------+---------+       5. IMPLEMENT        |   Human Admin     |
    |   Coder           |------------------------>|   (HITL Mode)     |
    |   Agent           |      (DDB: PROGRESS)      +-------------------+
    +---------+---------+                         
              |
              | 6. TRIGGER_DEPLOYMENT (SST)
              |    [CIRCUIT BREAKER]
              v
    +---------+---------+       7. MONITOR         +-------------------+
    |   Build           |------------------------>|   Gap Status      |
    |   Monitor         |      (DDB: DEPLOYED)    |   (Live in AWS)   |
    +---------+---------+                         +-------------------+
              |
              | 8. AUDIT & VERIFY (Reflector Audit)
              v
    +---------+---------+       9. SATISFACTION    +-------------------+
    |   QA Auditor      |------------------------>|   Status: DONE    |
    |   Agent           |      (User Feedback)    |   (Loop Closed)   |
    +-------------------+                         +-------------------+
```

1.  **Observation**: The **Cognition Reflector** analyzes interactions to find "I can't do that" moments or complex failures.
2.  **Gap Analysis**: Failures are logged as `strategic_gap` items in DynamoDB, ranked by **Impact** and **Urgency**.
3.  **Efficiency Audit**: Every 48 hours, the **Strategic Planner** reviews the `tool_usage` telemetry and all open gaps.
4.  **Strategic Planning**: The Planner designs a STRATEGIC_PLAN (Expansion or Pruning) and moves gaps to `PLANNED`.
5.  **Execution**: Once approved, the **Coder Agent** moves gaps to `PROGRESS`, writes code/config, and triggers a deploy.
6.  **Technical Success**: The **Build Monitor** detects a successful build and moves gaps to `DEPLOYED`.
7.  **Verified Satisfaction**: The **QA Auditor** verifies the fix. If successful, the Reflector marks it `DONE`.

---

## 🦾 The Backbone Registry

The system identity is defined in `core/lib/backbone.ts`. This centralized registry acts as the "genetic code" of the stack. The **Build Monitor** uses this registry to dynamically generate the neural map visualized in the dashboard.

### Permissions vs. Topology

- **Topology Connectivity**: Declared in `backbone.ts` (for backbone nodes) or via the Dashboard (for custom nodes). This is used only for **visualization** in System Pulse.
- **IAM Permissions**: Managed in `infra/agents.ts` via the `link` property. This is the **hard security layer**.

> [!WARNING]
> Adding a connection in the Dashboard or `backbone.ts` does **NOT** automatically grant AWS permissions. You must still modify `infra/agents.ts` to link new resources.

## 🛠️ Adding a New Agent

To evolve the system with a new specialized node:

1. **Implement**: Create `core/agents/<name>.ts` with the agent's logic and tools.
2. **Register Identity**: Add the agent to `BACKBONE_REGISTRY` in `core/lib/backbone.ts`.
3. **Link Infra**: In `infra/agents.ts`, create the Lambda function and link necessary resources.
4. **Subscribe**: Ensure the agent is subscribed to its task type in the EventBus.
5. **Deploy**: Run `sst deploy`. The **Build Monitor** will automatically discover the new agent.
