# Agent Registry & Orchestration

> **Navigation**: [← Index Hub](../INDEX.md)

> **Agent Context Loading**: Load this file when you need to understand the agent roles, their prompts, and how they coordinate via the AgentBus.
> , or add a new sub-agent.

## 🤖 Agent Roster

We distinguish between **Autonomous Agents** (LLM-powered decision-makers) and **System Handlers** (deterministic logic for monitoring and recovery).

### 1. Autonomous Agents (LLM-Powered)

| Agent                   | Runtime                              | Config Source              | Responsibilities                                                                |
| ----------------------- | ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------- |
| **SuperClaw**           | `core/handlers/webhook.ts`           | `core/agents/superclaw.ts` | Interprets user intent, delegates, deploys                                      |
| **Coder Agent**         | `core/agents/coder.ts`               | `AgentRegistry` (Backbone) | Writes code, runs pre-flight checks                                             |
| **Agent Runner**        | `core/handlers/agent-runner.ts`      | `AgentRegistry` (Dynamic)  | Generic runner for any user-defined agent                                       |
| **Strategic Planner**   | `core/agents/strategic-planner.ts`   | `AgentRegistry` (Backbone) | Designs strategic evolution plans                                               |
| **Cognition Reflector** | `core/agents/cognition-reflector.ts` | `AgentRegistry` (Backbone) | Distills memory and extracts gaps                                               |
| **QA Auditor**          | `core/agents/qa.ts`                  | `AgentRegistry` (Backbone) | Verifies satisfaction of deployed changes                                       |
| **Critic Agent**        | `core/agents/critic.ts`              | `AgentRegistry` (Backbone) | Peer review for Council of Agents (security/performance/architect)              |
| **Facilitator**         | `core/agents/prompts/facilitator.md` | `AgentRegistry` (Backbone) | Moderates multi-party collaboration sessions, drives consensus, closes sessions |
| **Merger Agent**       | `core/agents/merger.ts`              | `AgentRegistry` (Backbone) | Structural code reconciliation for parallel evolution tasks                     |


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

```bash
npx vitest core/tests/contract.test.ts
```

    (aggregated results) |                      |                      |
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

### 2. Robust Lock Management
All agents performing evolution tasks (Planner, Coder) utilize a `try/finally` pattern for gap locks. This ensures that even if a Lambda times out or crashes, the lock is released or at least not orphaned by standard logic paths.

### 3. Failure Recovery (Self-Healing)
The **Coder Agent** implements a "Reset-on-Failure" policy. If a coding task fails (either via LLM signal or system error), any associated gaps are automatically moved back to `OPEN` status, making them eligible for re-planning or retry instead of getting stuck in `PROGRESS`.

### 4. Parallel Dispatch Error Boundaries
The **Parallel Handler** now traps dispatch errors (e.g., EventBridge throughput limits or schema mismatches) and immediately notifies the **Aggregator**. This prevents the system from hanging at a barrier while waiting for sub-tasks that were never actually started.

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
