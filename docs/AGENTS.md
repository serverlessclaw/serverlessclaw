# Agent Registry & Orchestration

> **Navigation**: [← Index Hub](../INDEX.md)

> **Agent Context Loading**: Load this file when you need to understand the agent roles, their prompts, and how they coordinate via the AgentBus.
> , or add a new sub-agent.

## 🤖 Agent Roster

We distinguish between **Autonomous Agents** (LLM-powered decision-makers) and **System Handlers** (deterministic logic for monitoring and recovery).

### 1. Autonomous Agents (LLM-Powered)

| Agent                   | Runtime                              | Config Source              | Responsibilities                                                                |
| ----------------------- | ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------- |
| **SuperClaw**           | `core/handlers/webhook.ts`           | `core/agents/superclaw.ts` | Interprets user intent, delegates, deploys, self-decomposes missions            |
| **Coder Agent**         | `core/agents/coder.ts`               | `AgentRegistry` (Backbone) | Writes code, runs pre-flight checks                                             |
| **Agent Runner**        | `core/handlers/agent-runner.ts`      | `AgentRegistry` (Dynamic)  | Generic runner for any user-defined agent                                       |
| **Strategic Planner**   | `core/agents/strategic-planner.ts`   | `AgentRegistry` (Backbone) | Designs strategic evolution plans                                               |
| **Cognition Reflector** | `core/agents/cognition-reflector.ts` | `AgentRegistry` (Backbone) | Distills memory and extracts gaps                                               |
| **QA Auditor**          | `core/agents/qa.ts`                  | `AgentRegistry` (Backbone) | Verifies satisfaction of deployed changes                                       |
| **Critic Agent**        | `core/agents/critic.ts`              | `AgentRegistry` (Backbone) | Peer review for Council of Agents (security/performance/architect)              |
| **Facilitator**         | `core/agents/prompts/facilitator.md` | `AgentRegistry` (Backbone) | Moderates multi-party collaboration sessions, drives consensus, closes sessions |
| **Merger Agent**        | `core/agents/merger.ts`              | `AgentRegistry` (Backbone) | Structural code reconciliation for parallel evolution tasks                     |

### 2. System Handlers (Logic-Powered)

| Component                | Runtime                                        | Trigger                                   | Responsibilities                                              |
| ------------------------ | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| **Build Monitor**        | `core/handlers/monitor.ts`                     | CodeBuild Event                           | Observes builds, updates gap status, circuit breaking         |
| **Dead Man's Switch**    | `core/handlers/recovery.ts`                    | EventBridge Schedule (`rate(15 minutes)`) | Deep health checks and emergency rollback orchestration       |
| **Event Handler**        | `core/handlers/events.ts`                      | AgentBus System Events                    | Routes build/health/result/continuation/clarification signals |
| **Notifier**             | `core/handlers/notifier.ts`                    | AgentBus Event                            | Formats and sends messages to Telegram/Slack                  |
| **Real-time Bridge**     | `core/handlers/bridge.ts`                      | AgentBus Event                            | Bridges EventBridge signals to AWS IoT Core (MQTT)            |
| **Parallel Handler**     | `core/handlers/events/parallel-handler.ts`     | `PARALLEL_TASK_DISPATCH`                  | Handles fan-out to multiple agents with barrier timeout       |
| **Cancellation Handler** | `core/handlers/events/cancellation-handler.ts` | `TASK_CANCELLED`                          | Manages DynamoDB-backed task cancellation flags               |
| **Deployer**             | AWS CodeBuild                                  | `buildspec.yml`                           | Runs `make deploy ENV=$SST_STAGE` in isolated environment     |

### 3. Structural Merger Agent (Evolution)

Specialized agent for AST-aware patch reconciliation. Used during parallel evolution tracks to merge code changes that would cause standard git conflicts.

---

## 🔍 Research & Discovery Mode

The system features a specialized **Research Agent** (Researcher) designed for deep technical exploration, library analysis, and pattern discovery. It can be triggered by the **Strategic Planner** or **SuperClaw** using the `requestResearch` tool.

### Research Workflow

Research operates in two primary modes based on the complexity of the goal:

#### 1. Single Search (Linear)

For straightforward questions, the Researcher performs a standard iterative reasoning loop, using MCP tools (Search, Fetch, Puppeteer) sequentially to reach a conclusion.

#### 2. Parallel Exploration (Swarm)

For complex comparisons or broad discovery, the Researcher **self-decomposes** the goal into parallel sub-tasks. These are dispatched to multiple Researcher instances, aggregated via DynamoDB, and synthesized into a final report.

### Research Flow Diagram

```text
    [ INITIATOR ] (Strategic Planner / SuperClaw)
          |
          v
   ( RESEARCH_TASK ) ----> [ RESEARCH HANDLER ]
          |                       |
          |           /-----------+-----------\
          |           |                       |
          |    [ MODE: SINGLE ]       [ MODE: PARALLEL ]
          |           |               (Goal Decomposition)
          |           |                       |
          |    ( Sequential )        ( Parallel Dispatch )
          |    ( Tool Calls )        /        |        \
          |           |       [Sub-T1]    [Sub-T2]    [Sub-T3]
          |           |          |           |           |
          |           |          \-----------+-----------/
          |           |                      |
          |           |             [ DYNAMO AGGREGATOR ]
          |           |                      |
          |           |             [ RESEARCH SYNTHESIS ]
          |           |                      |
          \-----------+----------------------/
                      |
                      v
             [ WAKEUP INITIATOR ]
             ( TASK_COMPLETED )
                      |
                      v
    [ INITIATOR ] (Resumes with Research Findings)
```

### Key Technical Features

- **Polymorphic Return**: The system uses a stable `taskId` and routes completion back to the initiator via `TASK_COMPLETED`, ensuring the orchestration chain is never broken.
- **Knowledge Persistence**: All synthesized research is automatically stored in the `research_finding` memory category for future reuse.
- **Parallel Tooling**: The Researcher is configured for `parallelToolCalls: true`, allowing it to fire multiple search or fetch requests in a single turn.
- **Extended Budget**: Research missions have an increased time budget (default 10 minutes) to accommodate deep exploration.

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

## 🌊 Swarm Orchestration (Stellar Harbor)

The system supports recursive, asynchronous task decomposition. Any agent can act as a **Mission Commander** by returning a plan with structured markers.

### 1. Mission Decomposition

When an agent returns a response containing:

- `### Goal: [AgentType] - [Task]`
- `### Step: [Task]`

The `AgentRunner` automatically intercepts this, pauses the initiator, and dispatches $N$ parallel tasks via the `AgentBus`.

### 2. Recursive Depth Control

To prevent runaway loops, the system enforces a strict recursive depth limit defined in `SWARM.MAX_RECURSIVE_DEPTH`.

- **Default Limit**: 5 levels (e.g., Strategic Planner -> Coder -> Researcher -> Sub-Researcher -> Specialist).
- **Enforcement**: If a task is received at the maximum depth, further decomposition is disabled and the agent must complete the task atomically.

### 3. Worker Feedback Toggle

During massive swarms, sub-agents (workers) can create significant dashboard noise.

- **Config Key**: `worker_feedback_enabled` (Default: `true`)
- **Behavior**: If `false`, agents initiated by anyone other than the `orchestrator` (e.g., sub-agents) will skip MQTT chunk emission.
- **Root Recognition**: `SuperClaw` and any agent initiated directly by the `orchestrator` are always considered **Root** and will always emit feedback regardless of this toggle.

---

## 👥 Workspace & Multi-Human Collaboration

The system supports multi-human multi-agent collaboration through **Workspaces** — a shared context primitive with role-based access control.

### Workspace Architecture

```text
+-------------------+       +-----------------------+
|   Human A         +<----->+    Workspace          |
|   (Telegram)      |       |                       |
+-------------------+       |  Members:             |
                            |  - Human A (owner)    |
+-------------------+       |  - Human B (collab)   |
|   Human B         +<----->+  - Agent Coder (edit) |
|   (Dashboard)     |       |  - Agent QA (observer)|
+-------------------+       |                       |
                            |  Sessions:            |
+-------------------+       |  - Collab#abc123      |
|   Agent Swarm     +<----->+  - Collab#def456      |
|   (AgentBus)      |       |                       |
+-------------------+       +-----------------------+
```

### Member Roles

| Role             | Permissions                                           |
| ---------------- | ----------------------------------------------------- |
| **Owner**        | Full access, can delete workspace, manage all members |
| **Admin**        | Can invite/remove members, manage collaborations      |
| **Collaborator** | Can participate in sessions, write to shared context  |
| **Observer**     | Read-only access to sessions and history              |

### Identity & Access Layer

The `IdentityManager` (`core/lib/identity.ts`) provides:

- **Authentication**: Session-based auth via Telegram, Dashboard, or API key
- **RBAC**: Role-based permission enforcement
- **Workspace Membership**: Users can belong to multiple workspaces
- **Resource Access Control**: Fine-grained access to agents, traces, and configs

### Workspace Operations

| Tool               | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `createWorkspace`  | Creates a new workspace with owner        |
| `inviteMember`     | Invites human or agent (admin/owner only) |
| `updateMemberRole` | Changes a member's role                   |
| `removeMember`     | Removes member (cannot remove owner)      |
| `getWorkspace`     | Retrieves workspace details               |
| `listWorkspaces`   | Lists all workspace IDs                   |

### Multi-Human Collaboration Flow

```text
Human A (Telegram)    Human B (Dashboard)    Facilitator (Agent)    AgentBus (EB)    Sub-Agents
      |                      |                      |                    |                |
      +-- createCollab ----->|                      |                    |                |
      |   (participants: A,B,|                      |                    |                |
      |    agents: Coder, QA)|                      |                    |                |
      |                      |<-- [NOTIFY: invite] -+                    |                |
      |                      |                      +-- facilitator_task->|                |
      |                      |                      +-- coder_task ------>|                |
      |                      |                      +-- qa_task --------->|                |
      |                      |                      |                    |                |
      |             [ TURNS: A speaks ]             |                    |                |
      +-- writeToCollab ---->|                      |                    |                |
      |                      |             [ TURNS: B responds ]        |                |
      |                      +-- writeToCollab ---->|                    |                |
      |                      |             [ CONFLICT DETECTED ]        |                |
      |                      |                      +-- ESCALATE ------->|                |
      |<-- [CONFLICT: please resolve] --------------+                    |                |
      +-- resolveConflict -->|                      |                    |                |
```

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
5. **Deploy**: Run `make deploy ENV=prod` (or `make dev` for local stage work). The **Build Monitor** will automatically discover the new agent.

## 🧪 Testing Interfaces (Contract-First)

To ensure coordination doesn't break as we add more agents, follow a **Contract-First** development pattern:

1. **Define Schema**: Add or update the `zod` schema in `core/lib/schema/events.ts` for any new event types or field changes.
2. **Update Types**: Ensure `core/lib/types/agent.ts` matches the schema.
3. **Add Contract Test**: Add a test case to `core/tests/contract.test.ts` to verify your new event pattern.
4. **Verify Handler**: Ensure your agent's handler uses `.parse()` and the correct schema to validate incoming `eventDetail`.

// turbo

```bash
npx vitest core/tests/contract.test.ts
```

```text
 Initiator (Planner)       decomposePlan()        AgentBus (EB)        Coder Agent (xN)         Trace DAG (DDB)
        |                      |                      |                      |                      |
        +-- (1) decompose ---->|                      |                      |                      |
        |                      +-- (2) CODER_TASK --->|                      |                      |
        |                      +-- (2) CODER_TASK --->|                      |                      |
        |                      +-- (2) CODER_TASK --->|                      |                      |
        |                      |                      |                      |                      |
        |                      |    [ALL COMPLETE]    |                      |                      |
        |<-- (3) CONTINUATION--+                      |                      |                      |
        |    (aggregated results) |                      |                      |                      |
```

### DAG-Based Dependencies

Sub-tasks can declare dependencies using `dependsOn` edges, enabling sequential execution when needed:

```typescript
interface PlanSubTask {
  subTaskId: string; // Unique identifier
  planId: string; // Parent plan ID
  task: string; // Specific instruction for Coder Agent
  gapIds: string[]; // Gap IDs addressed
  order: number; // Execution order (0-based)
  dependencies: number[]; // Sub-tasks that must complete first
  complexity: number; // Estimated complexity 1-10
}
```

### Configuration

- **Minimum Plan Length**: 500 characters (plans shorter are dispatched as-is)
- **Maximum Sub-Tasks**: 5 (remaining segments are appended to last sub-task)
- **Default Dependencies**: Sequential (each sub-task depends on the previous one)

### Example

A complex plan like:

```
1. Update the User model to add emailVerified field
2. Create verification endpoint at /api/verify-email
3. Update login flow to check emailVerified
4. Write comprehensive tests
5. Deploy and verify health endpoint
```

Gets decomposed into 5 sub-tasks, each dispatched independently to Coder Agent(s) via `PARALLEL_TASK_DISPATCH`.

---

## 🛡️ Reliability & Resilience (2026 Remediations)

To achieve production-grade stability, the system implements several critical reliability patterns:

### 1. Atomic Status Transitions

Gaps now enforce strict state guards in `updateGapStatus`. A gap can only transition to a destination state (e.g., `PROGRESS`) if it is in the correct predecessor state (e.g., `PLANNED`). Failures throw explicit errors, preventing race conditions from leaving the system in an inconsistent state.

### 2. Universal Gap Locking

All gap state modifications now require lock acquisition. The **Strategic Planner** acquires locks not only for the primary `gapId` but also for every `coveredGapId` before transitioning them to `PLANNED`. The **Coder Agent** acquires locks before transitioning gaps to `PROGRESS`. Locked gaps are skipped with a warning rather than silently corrupted, preventing race conditions when multiple agents target overlapping gaps.

### Neural Mission Decomposition Flow

When any agent (especially SuperClaw or the Strategic Planner) generates a complex plan using standardized markers (`### Goal:` or `### Step:`), the system automatically decomposes it into parallel sub-tasks via the `AgentRunner`:

### 3. Safe Gap Transitions

The **Coder Agent** moves gaps to `PROGRESS` inside the `try` block (after `initAgent` succeeds), not before it. This ensures the `finally` block can always reset gaps to `OPEN` on failure — even if the LLM processing itself fails. Previously, a Lambda crash during `initAgent` would leave gaps permanently orphaned in `PROGRESS`.

### 4. Safe Metadata Updates (Reflector)

The **Cognition Reflector** uses `updateGapMetadata()` instead of `setGap()` during semantic deduplication. This preserves the existing gap status (`PLANNED`, `PROGRESS`, etc.) while merging updated impact/urgency scores, preventing accidental reversion to `OPEN`.

### 5. Ephemeral Memory TTL

`COUNCIL_PLAN` items use the `TEMP#` prefix so the `RetentionManager` applies the `EPHEMERAL` tier (1-day auto-prune). This prevents accumulation of transient council review data in DynamoDB.

### 6. Failure Recovery (Self-Healing)

The **Coder Agent** implements a "Reset-on-Failure" policy. If a coding task fails (either via LLM signal or system error), any associated gaps are automatically moved back to `OPEN` status, making them eligible for re-planning

### 4. Parallel Dispatch Error Boundaries

The **Parallel Handler** now traps dispatch errors (e.g., EventBridge throughput limits or schema mismatches) and immediately notifies the **Aggregator**. This prevents the system from hanging at a barrier while waiting for sub-tasks that were never actually started.

---

## 📡 End-to-End Execution Tracing

The system provides a unified, end-to-end trace of parallel agentic executions in the **Trace Intelligence** observatory. This view captures the entire lifecycle of a mission, from the initial user query to final synthesis.

### Neural Execution Flow

```text
 [ INITIATOR ] (SuperClaw / Strategic Planner)
       |
       |  (1) Capture Initial Query
       v
[ PARALLEL DISPATCH ] (EventBridge)
       |
       +-- (2) Orchestrater Node (DAG Status)
       |
       +-- [ WORKER 1 ]     [ WORKER 2 ]     [ WORKER N ]
       |       |                |                |
       |   (3) Task 1       (4) Task 2       (5) Task N
       |       |                |                |
       \-------+----------------+----------------/
               |
               v
      [ PENDING AGGREGATOR ] (Synthesis Tier)
               |
               v
       [ FINAL RESPONSE ] (User Notified)
```

### Trace Components

- **Initial Query**: The high-level intent or mission description that triggered the decomposition.
- **Initiator**: The agent or system component that identified the need for parallelization.
- **Neural Workers**: Specialized sub-agents (Coder, Researcher, etc.) assigned to specific sub-tasks.
- **Execution DAG**: The dependency graph representing the order and status of sub-tasks.
- **Pending Aggregator**: The synthesis logic that combines parallel results into a cohesive final output.

---

## 🖥️ Dashboard Co-Management Flows

The ClawCenter dashboard provides real-time co-management interfaces for multi-human multi-agent collaboration.

### Dashboard Collaboration Flow

```text
 Human (Browser)        Dashboard UI           API Routes          AgentBus (EB)       Agent Swarm
      |                      |                      |                    |                |
      +-- Open Collab Tab -->|                      |                    |                |
      |                      +-- GET /collaboration>|                    |                |
      |                      |<-- ActiveDispatches -+                    |                |
      |                      |                      |                    |                |
      |                      +-- Subscribe MQTT --->|                    |                |
      |                      |<-- Realtime Updates -+                    |                |
      |                      |                      |                    |                |
      |   [View DAG Status]  |                      |                    |                |
      |<-- Render Flow ------|                      |                    |                |
      |   (nodes + edges)    |                      |                    |                |
      |                      |                      |                    |                |
      |   [Task Completed]   |                      |                    |                |
      |                      |<-- task_completed ---|<-- Result ---------|<-- Agent Done  |
      |                      +-- Refresh Canvas --->|                    |                |
```

### Human-in-the-Loop Handoff Flow

```text
 Agent (Autonomous)     AgentBus (EB)       Dashboard UI           Human (Browser)
      |                      |                      |                      |
      +-- [Escalation] ----->|                      |                      |
      |   TASK_HANDOFF       |                      |                      |
      |                      +-- handoff event ---->|                      |
      |                      |                      +-- Show Panel ------->|
      |                      |                      |   (orange border)    |
      |                      |                      |                      |
      |                      |                      |   [Task Details]     |
      |                      |                      |<-- Display ---------|
      |                      |                      |   - taskId           |
      |                      |                      |   - agentId          |
      |                      |                      |   - reason           |
      |                      |                      |                      |
      |                      |                      |   [Awaiting Input]   |
      |                      |                      |<-- Show Buttons ----|
      |                      |                      |   Approve|Send|Reject|
      |                      |                      |                      |
      |                      |                      |   [Human Responds]   |
      |                      |                      +-- POST /chat ------>|
      |                      |                      |   {handoffResponse}  |
      |                      |<-- HANDOFF_RESOLVED -+                      |
      |<-- Resume Task ------|                      |                      |
      |   (with response)    |                      |                      |
```

### Workspace Member Management Flow

```text
 Admin (Dashboard)      Dashboard UI          API Routes          Workspace Store
      |                      |                      |                      |
      +-- Expand Workspace ->|                      |                      |
      |                      +-- GET /workspaces -->|                      |
      |                      |<-- Workspace List ---+                      |
      |                      |                      |                      |
      |   [Invite Member]    |                      |                      |
      |<-- Click Invite -----|                      |                      |
      |                      |                      |                      |
      |   [Fill Form]        |                      |                      |
      |<-- Modal Opens ------|                      |                      |
      |   - memberId         |                      |                      |
      |   - role (dropdown)  |                      |                      |
      |                      |                      |                      |
      |   [Submit]           |                      |                      |
      +-- POST /workspaces ->|                      |                      |
      |   {action:invite}    +-- inviteMember() --->|                      |
      |                      |                      +-- Update Members --->|
      |                      |<-- Success -----------|                      |
      |<-- Refresh List -----|                      |                      |
```

---

## 🛠️ Engineering Standards (Agent & Human)

To maintain the high technical integrity of the swarm, all contributors (both human and autonomous agents) MUST adhere to these standards when adding or modifying features:

1. **Test-First Development**:
   - **New Features**: Must include at least one unit test file (`.test.ts`) and, if applicable, an integration/contract test.
   - **Bug Fixes**: Must include a regression test that demonstrates the fix.
   - **Coverage**: Maintain or improve existing test coverage.

2. **Documentation Parity**:
   - **Update MDs**: Any change to agent roles, event types, or memory tiers must be immediately reflected in `docs/AGENTS.md`, `docs/MEMORY.md`, or `ARCHITECTURE.md`.
   - **ASCII Diagrams**: Complex flows (especially those involving new event patterns) must be documented with an updated ASCII sequence diagram.

3. **Schema Integrity**:
   - Always update `core/lib/schema/` and `core/lib/types/` before implementing logic.
   - Use strict typing and avoid `any` wherever possible.

4. **Telemetry & Audit**:
   - Ensure all new tools and handlers emit appropriate telemetry (TokenUsage, Reputation signals).
   - Failed autonomous operations must be recorded in the **Negative Memory** tier (`FAILED_PLAN#`).
