# Agent Registry & Roles

> **Navigation**: [← Index Hub](../../INDEX.md)

This document serves as the central registry for both autonomous agents and system handlers. It defines their roles, hosting tiers, and the process for expanding the swarm.

## 🤖 Agent Roster

We distinguish between **Autonomous Agents** (LLM-powered decision-makers) and **System Handlers** (deterministic logic for monitoring and recovery).

### 1. Autonomous Agents (LLM-Powered)

| Agent                   | Host (Tier)  | Responsibilities                                                                                                     |
| :---------------------- | :----------- | :------------------------------------------------------------------------------------------------------------------- |
| **SuperClaw**           | `Standard`   | **Nimble Orchestrator**. See [`core/agents/superclaw.ts`](../../core/agents/superclaw.ts).                           |
| **Coder Agent**         | `High-Power` | Writes code, validates deployments. See [`core/agents/coder.ts`](../../core/agents/coder.ts).                        |
| **Researcher**          | `High-Power` | Deep exploration. See [RESEARCH.md](./RESEARCH.md) & [`core/agents/researcher.ts`](../../core/agents/researcher.ts). |
| **Strategic Planner**   | `High-Power` | **Technical Auditor**. See [`core/agents/strategic-planner.ts`](../../core/agents/strategic-planner.ts).             |
| **QA Auditor**          | `Standard`   | Verifies changes. See [`core/agents/qa.ts`](../../core/agents/qa.ts).                                                |
| **Facilitator**         | `Standard`   | **Session Moderator**. See [`core/agents/facilitator.ts`](../../core/agents/facilitator.ts).                         |
| **Merger**              | `Standard`   | **Code Integration**. See [`core/agents/merger.ts`](../../core/agents/merger.ts).                                    |
| **Critic**              | `Standard`   | **Logic Oversight**. See [`core/agents/critic.ts`](../../core/agents/critic.ts).                                     |
| **Cognition Reflector** | `Light`      | **Knowledge Custodian**. See [`core/agents/cognition-reflector.ts`](../../core/agents/cognition-reflector.ts).       |

### 2. System Handlers (Logic-Powered)

| Component            | Trigger         | Responsibilities                                                                  |
| :------------------- | :-------------- | :-------------------------------------------------------------------------------- |
| **Build Monitor**    | CodeBuild Event | Observes builds, updates gap status, circuit breaking.                            |
| **Recovery Handler** | Health Failure  | Automated rollback orchestration. See [RESILIENCE.md](../system/RESILIENCE.md).   |
| **Event Handler**    | AgentBus Event  | Routes system signals and manages recursion depth.                                |
| **Real-time Bridge** | AgentBus Event  | Bridges signals to AWS IoT (MQTT). See [DASHBOARD.md](../interface/DASHBOARD.md). |

---

## 🦾 The Backbone Registry

The system identity is defined in `core/lib/backbone.ts`. This centralized registry acts as the "genetic code" of the stack.

### Topology vs. Permissions

- **Topology Connectivity**: Declared in `backbone.ts` for visualization in the System Pulse dashboard sector.
- **IAM Permissions**: Managed in `infra/agents.ts` via the `link` property. This is the **hard security layer**.

> [!WARNING]
> Visualizing a connection in the dashboard does **NOT** grant AWS permissions. You must modify `infra/agents.ts` to grant actual resource access.

---

## 🛠️ Adding a New Agent

To evolve the system with a new specialized node:

1.  **Implement**: Create `core/agents/<name>.ts` with agent logic and tools.
2.  **Register Identity**: Add the agent to `BACKBONE_REGISTRY` in `core/lib/backbone.ts`.
3.  **Link Infra**: In `infra/agents.ts`, create the Lambda and link necessary resources.
4.  **Subscribe**: Ensure the agent is subscribed to its task type in the EventBus.

---

## 🧪 Testing Agent Interfaces

To ensure coordination doesn't break, follow a **Contract-First** pattern:

1.  **Define Schema**: Update `core/lib/schema/events.ts` with any new event types.
2.  **Standard Defaults**: Leverage `BASE_EVENT_SCHEMA` for shared metadata.
3.  **Contract Test**: Add a test case to `core/tests/contract.test.ts`.

---

## 📥 Related Documentation

- **[SWARM.md](./SWARM.md)**: Orchestration, mission decomposition, and parallel dispatch.
- **[RESEARCH.md](./RESEARCH.md)**: Specialized research agent workflows.
- **[COLLABORATION.md](../interface/COLLABORATION.md)**: Multi-human workspaces and moderated sessions.
- **[STANDARDS.md](../governance/STANDARDS.md)**: Engineering standards for agent and human contributors.
