# Agent Registry & Orchestration

> **Agent Context Loading**: Load this file when you need to understand the agent roles, their prompts, and how they coordinate via the AgentBus.
, or add a new sub-agent.

## 🤖 Agent Roster

We distinguish between **Autonomous Agents** (LLM-powered decision-makers) and **System Handlers** (deterministic logic for monitoring and recovery).

### 1. Autonomous Agents (LLM-Powered)

| Agent | Runtime | Config Source | Responsibilities |
|-------|---------|---------------|-----------------|
| **SuperClaw** | `core/handlers/webhook.ts` | `core/agents/superclaw.ts` | Interprets user intent, delegates, deploys |
| **Coder Agent** | `core/agents/coder.ts` | `AgentRegistry` (Backbone) | Writes code, runs pre-flight checks |
| **Agent Runner** | `core/handlers/agent-runner.ts` | `AgentRegistry` (Dynamic) | Generic runner for any user-defined agent |
| **Strategic Planner** | `core/agents/strategic-planner.ts` | `AgentRegistry` (Backbone) | Designs strategic evolution plans |
| **Cognition Reflector** | `core/agents/cognition-reflector.ts` | `AgentRegistry` (Backbone) | Distills memory and extracts gaps |
| **QA Auditor** | `core/agents/qa.ts` | `AgentRegistry` (Backbone) | Verifies satisfaction of deployed changes |
| **Critic Agent** | `core/agents/critic.ts` | `AgentRegistry` (Backbone) | Peer review for Council of Agents (security/performance/architect) |

### 2. System Handlers (Logic-Powered)

| Component | Runtime | Trigger | Responsibilities |
|-----------|---------|---------|------------------|
| **Build Monitor** | `core/handlers/monitor.ts` | CodeBuild Event | Observes builds, updates gap status, circuit breaking |
| **Dead Man's Switch** | `core/handlers/recovery.ts` | EventBridge Schedule (`rate(15 minutes)`) | Deep health checks and emergency rollback orchestration |
| **Event Handler** | `core/handlers/events.ts` | AgentBus System Events | Routes build/health/result/continuation/clarification signals |
| **Notifier** | `core/handlers/notifier.ts` | AgentBus Event | Formats and sends messages to Telegram/Slack |
| **Real-time Bridge** | `core/handlers/bridge.ts` | AgentBus Event | Bridges EventBridge signals to AWS IoT Core (MQTT) |
| **Parallel Handler** | `core/handlers/events/parallel-handler.ts` | `PARALLEL_TASK_DISPATCH` | Handles fan-out to multiple agents with barrier timeout |
| **Cancellation Handler** | `core/handlers/events/cancellation-handler.ts` | `TASK_CANCELLED` | Manages DynamoDB-backed task cancellation flags |
| **Deployer** | AWS CodeBuild | `buildspec.yml` | Runs `make deploy ENV=$SST_STAGE` in isolated environment |

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

Unlike a standard handoff, the Clarification Protocol allows a sub-agent to pause and seek directions from its initiator without failing the task. It includes built-in timeout resilience and automated retries.

```text
Initiator (Planner)     AgentBus (EB)       Follower (Coder)      Scheduler (EB)
      |                      |                      |                    |
      +--- dispatchTask ---->|                      |                    |
      |                      +---- coder_task ----->|                    |
      |                 [TERMINATE]                 |                    |
      |                      |               [THINK: Ambiguity!]         |
      |                      |<-- seekClarification-+                    |
      |      [EH ROUTE]      |   (question, task)   |                    |
      |                      |       [PAUSE/TERMINATE]                   |
      |                      |                      |                    |
      |                      +--- scheduleTimeout ---------------------->|
      |                      |                      |                    |
      |<-- CONTINUATION_TASK-+                      |                    |
      | (CLARIFICATION_REQUEST)                     |                    |
      |                      |                      |                    |
      |            [ IF TIMEOUT FIRES ]             |                    |
      |                      |<------------------- CLARIFICATION_TIMEOUT +
      |                      |                      |                    |
      |            [ IF RETRY < MAX ]               |                    |
      |                      +-- CLARIFICATION_REQUEST (RETRY) --------->|
      |                      |                      |                    |
      |            [ IF RETRY >= MAX ]              |                    |
      |                      +-- TASK_FAILED ------>|                    |
      |                      +-- OUTBOUND (User)    |                    |
      |                      |                      |                    |
      |            [ IF ANSWERED ]                  |                    |
      +-- provideClarification                      |                    |
      |   (answer) --------->|                      |                    |
      |                      +-- CONTINUATION_TASK->|                    |
      |                 [TERMINATE]                 |                    |
      |                      |              [RESUME with Answer]         |
      |                      |                      |                    |
```

### Parallel Dispatch Protocol (Fan-out/Fan-in)

The Parallel Dispatch Protocol enables an agent to delegate multiple independent sub-tasks concurrently. It uses a barrier timeout to ensure the system remains responsive even if some sub-agents stall. 

It supports two aggregation modes for result processing:
- **Summary**: (Default) Aggregates results into a structured Markdown summary for the initiator.
- **Agent-guided**: Invokes an aggregator agent to synthesize results and determine the next logical action based on an optional `aggregationPrompt`.

```text
Initiator (Planner)     AgentBus (EB)       Sub-Agents (xN)      Aggregator (DDB)
      |                      |                      |                    |
      +--- dispatchTask ---->|                      |                    |
      |                      +-- PARALLEL_DISPATCH -+------------------->|
      |                      |                      |             [INIT State]
      |                      +-- <agent>_task (1) ->|                    |
      |                      +-- <agent>_task (2) ->|                    |
      |                      +-- <agent>_task (N) ->|                    |
      |                      |                      |                    |
      |             [ AS SUB-TASKS COMPLETE ]       |                    |
      |                      |<-- TASK_COMPLETED ---+                    |
      |                      +----------------------+------------------->|
      |                      |                      |             [ADD Result]
      |                      |                      |             [IF COMPLETE]
      |                      |<-- PARALLEL_COMPLETED+<-------------------+
      |                      |                      |                    |
      |             [ IF BARRIER TIMEOUT FIRES ]    |                    |
      |                      |<-- BARRIER_TIMEOUT --+                    |
      |                      +----------------------+------------------->|
      |                      |                      |             [TIMEOUT Missing]
      |                      |<-- PARALLEL_COMPLETED+<-------------------+
      |                      |                      |                    |
      |<-- CONTINUATION_TASK-+                      |                    |
      | (PARALLEL_COMPLETED) |                      |                    |
```

### Council of Agents (Peer Review Gate)

For high-impact strategic plans, the system introduces a **Council of Agents** — a peer review gate that dispatches the plan to three specialized **Critic Agents** for independent review before execution.

#### Trigger Conditions

The Council is activated when any of these metrics exceed the threshold (default: 8/10):

| Metric | Source | Threshold |
|--------|--------|-----------|
| **Impact** | Gap metadata | ≥ 8 |
| **Risk** | Gap metadata | ≥ 8 |
| **Complexity** | Gap metadata | ≥ 8 |

If all metrics are below the threshold, the Planner dispatches directly to the Coder (bypassing Council).

#### Review Modes

The Critic Agent operates in three modes, each dispatched as a parallel task:

| Mode | Focus | Red Flags |
|------|-------|-----------|
| **Security** | Injection, auth bypass, data exposure | Unsanitized inputs, hardcoded secrets, overly permissive IAM |
| **Performance** | Latency, memory, cold start, cost | Unbounded loops, missing pagination, N+1 queries |
| **Architect** | Design coherence, dependencies, blast radius | Circular dependencies, tight coupling, missing error handling |

#### Flow

```text
Planner (impact >= 8)
    |
    +--- (1) createCollab ("Council Review")
    |
    +--- (2) writeToCollab (Strategic Plan)
    |
    +--- (3) PARALLEL_TASK_DISPATCH (3 critic tasks + collabId)
    |         |
    |         +--- [Security Review] ----+
    |         +--- [Performance Review] -+---> [Aggregation (agent_guided)]
    |         +--- [Architect Review] --+      (Reads shared session context)
    |                                               |
    |                                               v
    +--- (4) [EH ROUTE] <------------------ [CONTINUATION_TASK]
    |         |
    |         v
    +--- (5) [THINK: Verdict?]
    |         |
    |         +--- (6) closeCollab (Archive)
    |         |
    |         +-----------+-----------+
    |         |                       |
    |   [APPROVED]              [REJECTED/CONDITIONAL]
    |         |                       |
    |         v                       v
    |   [dispatch to Coder]      [revise plan or escalate to HITL]
```

#### Aggregation

The Council uses `agent_guided` aggregation with a prompt that synthesizes all three reviews:

- **APPROVED**: No critical or high severity findings
- **REJECTED**: Any critical finding exists — the plan MUST NOT proceed
- **CONDITIONAL**: High severity findings that can be mitigated — proceed with fixes

#### Auto vs HITL Delineation

| Condition | Behavior |
|-----------|----------|
| `impact < 8` AND `evolution_mode = AUTO` | Skip Council → dispatch directly to Coder |
| `impact >= 8` OR `risk >= 8` OR `complexity >= 8` | Council Required → parallel review |
| `evolution_mode = HITL` | Council + Human Approval |
| Any Critical finding | Auto-REJECT → back to Planner |

### Multi-Party Collaboration (Shared Sessions)

For complex tasks that require negotiation, peer review, or iterative brainstorming between multiple agents (and humans), the system provides a **Shared Collaboration Session** model. Unlike the default transactional handoff, this model allows all participants to share a persistent conversation history.

#### Roles and Responsibilities
- **Owner (Moderator)**: The agent that created the session. Responsible for driving consensus, extracting the final structured result, and closing the session.
- **Participant**: An agent or human invited to the session. Can read history and append messages.

#### Flow

```text
Initiator (Planner)     Collaboration Tool      AgentBus (EB)       Sub-Agents (xN)      Shared Session (DDB)
      |                      |                      |                      |                    |
      +-- createCollab ----->|                      |                      |                    |
      |   (Owner: Planner) --+----------------------+----------------------+------------------->|
      |                      |                      |                      |             [INIT shared#collab#ID]
      |                      |                      |                      |                    |
      +-- inviteParticipant -+----------------------+----------------------+------------------->|
      |   (Agent: Coder) ----+                      |                      |             [ADD Participant]
      |                      |                      |                      |                    |
      +-- writeToCollab -----+----------------------+----------------------+------------------->|
      |   (Initial Prompt) --+                      |                      |             [ADD Message]
      |                      |                      |                      |                    |
      |                      |             [ AS AGENTS ARE NOTIFIED ]      |                    |
      |                      |                      |<--- TASK_EVENT ------+                    |
      |                      |                      | (collabId)           |                    |
      |                      |                      |                      +-- joinCollab ----->|
      |                      |                      |                      |                    |
      |                      |                      |                      +-- getHistory <-----+
      |                      |                      |                      |                    |
      |                      |                      |                      +-- writeResult ---->|
      |                      |                      |                      |                    |
      |             [ ITERATIVE DISCUSSION ]        |                      |                    |
      |                      |                      |                      |                    |
      +-- closeCollab <------+----------------------+----------------------+--------------------+
          (Final decision)                                                               [ARCHIVE Session]
```

#### When to use
- **Council of Agents**: Shared discussion between Security, Performance, and Architect critics.
- **Human-in-the-loop Debugging**: Real-time collaboration between a human and multiple specialized agents.
- **Ambiguity Resolution**: When a task is too complex for a single transactional exchange.

### Granular HITL Tool Approval (Tool-level Gates)

For security-sensitive operations (e.g., deleting data, triggering deployments), tools can be marked with `requiresApproval: true`. The `AgentExecutor` automatically pauses before executing such tools, allowing for granular human oversight without pausing the entire session.

```text
User (Dashboard)       Agent (Lambda)       AgentBus (EB)       High-Risk Tool (DDB)
      |                      |                    |                    |
      +---- "Delete DB" ---->|                    |                    |
      |                      |--- [LLM Thought] ->|                    |
      |                      |                    |                    |
      |                      |--- (1) Emit CHUNK (Thought) ----------->|
      |                      |                    |                    |
      |                      |--- (2) Check Tool: deleteDatabase ---->|
      |                      |        [requiresApproval: true]         |
      |                      |                    |                    |
      |                      |<-- (3) TASK_PAUSED (APPROVAL_REQUIRED) -|
      |                      |                    |                    |
      |<--- [UI: Approve?] --|--- (4) Emit CHUNK (with Options) ------>|
      |                      |                    |                    |
      +---- [APPROVE] ------>|                    |                    |
      |                      |--- (5) Resume Loop (approvedCalls:[ID])|
      |                      |                    |                    |
      |                      |--- (6) EXECUTE ------------------------>|
      |                      |                    |                    |
      |<--- [UI: Success] ---|--- (7) Emit TASK_COMPLETED ------------>|
      v                      |                    v                    v
```

### Dual-Mode Communication (Intent-Based Orchestration)

To balance deterministic coordination with natural user interaction, the system supports two communication modes, toggled via `AgentProcessOptions.communicationMode`.

| Mode | Target | Protocol | Benefit |
|------|--------|----------|---------|
| **JSON** | Agents / System | Native JSON Schema (`strict: true`) | Guaranteed parsing, automated state updates, zero regex. |
| **Text** | Humans (Chat) | Natural Language | Empathy, nuance, and lower token latency. |

#### Mode Switching Logic
The `Agent` core automatically injects the **Standard Signal Schema** when `communicationMode: 'json'` is requested. It also performs **Intelligent Response Extraction** to ensure human-readable segments (like plans or messages) are still available for logging and dashboards even when the model output is raw JSON.

```text
  [ Task Intent ]
         |
    +----v----+          (communicationMode)
    |  Agent  |----------+----------+
    +---------+          |          |
         |             [JSON]     [TEXT]
         |               |          |
         v               v          v
    [ Executor ]    (Inject Schema) (Standard)
         |               |          |
         v               +----------+
    [ LLM Call ] ----------> [ Response ]
                                |
                    +-----------+-----------+
                    |                       |
             (Extract Text)          (Store JSON)
                    |                       |
             [ User Chat ]           [ System State ]
```

### Standardized Coordination (Enums & Type Safety)

To ensure reliable orchestration across a distributed swarm of agents, Serverless Claw enforces a **Standardized Neural Signal Schema**. Instead of relying on brittle string-based tool calls or event names, all agents utilize centralized enums defined in `core/lib/constants.ts`.

- **`TOOLS`**: Defines the exhaustive list of available agent capabilities (e.g., `dispatchTask`, `triggerDeployment`, `seekClarification`).
- **`TRACE_TYPES`**: Standardizes the phases of agent execution (`LLM_CALL`, `TOOL_RESULT`, `REFLECT`), enabling consistent observability in the dashboard.
- **`MEMORY_KEYS`**: Enforces a strict partition-key strategy for the tiered memory engine (`CONV#`, `FACT#`, `LESSON#`).

This architectural choice minimizes runtime errors, simplifies agent tool-binding, and provides a clear "contract" for any new agent added to the registry.

### Routing Metadata
Every event on the `AgentBus` carries critical routing metadata:
- **`traceId`**: Consolidates all agent steps into a single unified timeline.
- **`initiatorId`**: The ID of the agent that started the task (used to route results back).
- **`depth`**: Current recursion level. The system automatically terminates tasks exceeding the **Recursion Limit** (Default: 15) to prevent infinite loops. This limit is hot-swappable in the Dashboard Settings.

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

1. **Discovery**: When an agent realizes it lacks a specific capability (e.g., "I need to query a Postgres DB"), it uses `discoverSkills` to search for relevant MCP servers via the `MCPToolMapper`.
2. **Registration**: The agent uses `registerMCPServer` to add the MCP server to the global configuration. The `MCPClientManager` then handles the lifecycle of these external connections.
3. **Equipment**: The agent uses `installSkill` to add specific tools from the new server to its own toolset or the toolset of a specialized peer (like the Coder).
4. **Persistence & Telemetry**: These changes are saved atomically to the `ConfigTable` using the `AgentRegistry`. Every subsequent tool execution is recorded (`tool_usage`), providing the data signature needed for future audits.

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

Serverless Claw is a **proactive self-evolving system** that identifies its own weaknesses and implements its own upgrades. Unlike purely reactive systems, it actively scans for optimizations even when no failures occur.

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
              | 6. TRIGGER_DEPLOYMENT (CodeBuild -> make deploy)
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

1.  **Observation**: The **Cognition Reflector** analyzes interactions to find "I can't do that" moments (Gaps) or optimization opportunities (Improvements).
2.  **Gap/Improvement Analysis**: Identified items are logged as `strategic_gap` or `system_improvement` in DynamoDB, ranked by **Impact** and **Urgency**.
3.  **Proactive Review**: Every 48 hours (or triggered by significant signals), the **Strategic Planner** reviews telemetry, failure patterns, and improvements.
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
5. **Deploy**: Run `make deploy ENV=dev` (or `make dev` for local stage work). The **Build Monitor** will automatically discover the new agent.

## 🧪 Testing Interfaces (Contract-First)

To ensure coordination doesn't break as we add more agents, follow a **Contract-First** development pattern:

1. **Define Schema**: Add or update the `zod` schema in `core/lib/schema/events.ts` for any new event types or field changes.
2. **Update Types**: Ensure `core/lib/types/agent.ts` matches the schema.
3. **Add Contract Test**: Add a test case to `core/tests/contract.test.ts` to verify your new event pattern.
4. **Verify Handler**: Ensure your agent's handler uses `.parse()` and the correct schema to validate incoming `eventDetail`.

Run the contract tests:
```bash
npx vitest core/tests/contract.test.ts
```
