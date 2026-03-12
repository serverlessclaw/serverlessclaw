# Agent Architecture & Orchestration

> **Agent Context Loading**: Load this file when you need to modify agent logic, prompts, communication patterns, or add a new sub-agent.

## Agent Roster

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

## Orchestration Flow

```
User (Telegram)       Dashboard (Web/IoT)
      │                      ▲
      ▼                      │ (Push: IoT Core)
POST /webhook → SuperClaw (Lambda)
      │
      ├──dispatchTask(agentId, task)─► EventBridge AgentBus
      │                                         │
      │                                         ├──► Worker Agent (Lambda)
      │                                         │      │ 1. Load Persona (Registry)
      │                                         │      │ 2. Load Tools (Registry)
      │                                         │      └─► 3. Execute & Report
      │                                         │
      │                                         └──► Real-time Bridge (Lambda)
      │                                                │
      │                                                └─► Publish to users/{id}/signal
      │
      ├──triggerDeployment──► CodeBuild Deployer
      │                               │
      │      (ON SUCCESS)             ▼
      │      └────────────────── Build Monitor Handler ──► system.build.success (Bus)
      │                                                   │
      │                                                   ▼
      │                                             QA Auditor (Audit & Verify)
      │
      ├──manageGap──────────► DynamoDB Gap Status Update (OPEN -> PLANNED -> PROGRESS -> DEPLOYED -> DONE)
      │
      └──checkHealth──► GET /health (src/handlers/health.ts)
              ├── OK  → notify user, reward counter
              └── FAIL → triggerRollback → notify user
```

---

## Communication Protocol (EventBridge)

- **Bus name**: `AgentBus` (SST resource)
- **Event source**: `main.agent`
- **Detail type pattern**: `<agentId>_task` (e.g. `coder_task`, `researcher_task`)
- **Event payload**:
  ```json
  { "userId": "<string>", "task": "<natural language task description>" }
  ```

All inter-agent discovery is handled by the **AgentRegistry** (`src/lib/registry.ts`), which merges backbone logic with user-defined personas from **DynamoDB**.

---

## Hot Configuration & Dynamic Providers

Serverless Claw supports zero-downtime model switching via the `ProviderManager`.

- **Mechanism**: The `ProviderManager` checks `ConfigTable` (DynamoDB) for `active_provider` and `active_model` before every LLM call.
- **Fallbacks**: If no config is found in the database, it falls back to SST `Resource` secrets.
- **Provider Hubs**:
    - **OpenAI**: Native access to GPT-5.4 and GPT-5-mini.
    - **Bedrock**: High-performance, AWS-native Claude 4.6 Sonnet.
    - **OpenRouter**: Cost-effective hub for Gemini 3 Flash, GLM-5, and Minimax 2.5.

---

## SuperClaw System Prompt (Summary)

Key obligations (see `src/agent.ts` for the full prompt):
1. **delegate** complex changes via `dispatchTask`
2. **deploy then verify**: `triggerDeployment` → `checkHealth`
3. **rollback on failure**: `CIRCUIT_BREAKER_ACTIVE` or `HEALTH_FAILED` → `triggerRollback`
4. **HITL**: Stop and ask human on Telegram for any `MANUAL_APPROVAL_REQUIRED`
5. **protect core**: 3 confirmations to delete `AgentBus` or `MemoryTable`

---

## Coder Agent System Prompt (Summary)

Key obligations (see `src/coder.ts` for the full prompt):
1. **pre-flight**: Call `validateCode` after every `fileWrite`
2. **protected files**: Return `MANUAL_APPROVAL_REQUIRED` — never bypass
3. **atomicity**: Don't leave codebase in a broken state
4. **documentation**: Update relevant `docs/*.md` in the same step as code changes

---

## Co-Management & Evolution

Agents are not just autonomous; they are **co-managed** via the ClawCenter dashboard.

### 1. Neural Agent Registry
Users can register new specialized agents at `/settings`. 
- **Persona**: Define the system prompt (instructions) for the agent.
- **Dynamic Scoping**: Toggle tools on/off for specific agents without redeploying.
- **Immediate Availability**: Once registered, the SuperClaw can immediately delegate tasks to the new node via `dispatchTask`.

### 2. Dynamic Toolsets
Instead of a static roster, every agent loads its tools from the `AgentRegistry` on every execution.
- **Control**: Users can hot-swap prompts and tools in the dashboard.
- **Optimization**: The Planner Agent can also propose updates to these registries based on performance telemetry.

### 3. Autonomous Evolution (Auto vs HITL)
- **`hitl` mode**: Agents must request approval on Telegram/Slack for deployments or protected file writes.
- **`auto` mode**: The system self-deploys and self-heals without human intervention.
- **Switch**: Controlled in `/settings`.

### 3. Memory Curation
Users can "Prune" the agent's memory at `/memory` to remove incorrect lessons or stale gaps.

### 4. Dynamic Discovery & Tool Injection
The system is designed for autonomous expansion where new nodes are born "intelligent":
- **`listAgents`**: A core tool enabling any agent to discover other specialized nodes in the system at runtime.
- **Standard Support Profile**: To ensure seamless integration, every dynamic agent is automatically injected with a default toolset (`recallKnowledge`, `listAgents`, `dispatchTask`) if no explicit tools are defined. This ensures every new agent is collaborative and informed from second one.

---

## The Evolutionary Lifecycle (Self-Evolution Loop)

Serverless Claw is not a static agent; it is a **self-evolving system** that identifies its own weaknesses and implements its own upgrades.

### Evolutionary Flow Diagram (Verified Satisfaction)

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

### How it works:
1.  **Observation**: The **Cognition Reflector** analyzes every interaction. It looks for "I can't do that" moments or complex multi-step failures.
2.  **Gap Analysis**: These failures are logged as `strategic_gap` items in DynamoDB, ranked by **Impact** and **Urgency**. Status set to `OPEN`.
3.  **Strategic Planning**: The **Strategic Planner** reviews these gaps during a **deterministic 12-hour review**. It designs a STRATEGIC_PLAN and moves gaps to `PLANNED`.
4.  **Execution**: Once the plan is approved (or automatically triggered in `auto` mode), the **Coder Agent** moves gaps to `PROGRESS`, writes the code, and triggers a deployment.
5.  **Technical Success**: The **Build Monitor** detects a successful CodeBuild run and moves gaps to `DEPLOYED`. The code is live, but not yet verified.
6.  **Verified Satisfaction**: The **QA Auditor** (via Reflector Audit) monitors subsequent conversations. If the user successfully uses the new capability or confirms satisfaction, the Reflector marks the gap as `DONE`. In `hitl` mode, this requires a final "YES" from the user via the `manageGap` tool.

---

## 🦾 The Backbone Registry

The system identity is defined in `core/lib/backbone.ts`. This centralized registry acts as the "genetic code" of the stack:

- **Identity**: Every agent's name, icon, and description.
- **Backbone Status**: Marks agents as core system components.
- **Connection Profile**: Defines which infrastructure nodes the agent interacts with (e.g., `['bus', 'memoryTable']`).

The **Build Monitor** uses this registry to dynamically generate the neural map visualized in the dashboard.

---

### 4. Permissions vs. Topology

It is critical to distinguish between **Topology Connectivity** and **IAM Permissions**:

- **Topology Connectivity**: Declared in `backbone.ts` (for backbone nodes) or via the Dashboard (for custom nodes). This is used only for **visualization** in System Pulse and for providing **context** to agents about what they *should* be able to access.
- **IAM Permissions**: Managed in `infra/agents.ts` via the `link` property. This is the **hard security layer**.

> [!WARNING]
> Adding a connection in the Dashboard or `backbone.ts` does **NOT** automatically grant AWS permissions. If a new agent type requires access to a new resource (e.g., a specific S3 bucket), you must still modify `infra/agents.ts` to link that resource to the `Worker Agent` (for custom agents) or the specific backbone agent.

## 🛠️ Adding a New Agent

To evolve the system with a new specialized node:

1. **Implement**: Create `core/agents/<name>.ts` with the agent's logic and tools.
2. **Register Identity**: Add the agent to `BACKBONE_REGISTRY` in `core/lib/backbone.ts`.
    - Define its `name`, `description`, `icon`, and `connectionProfile`.
3. **Link Infra**: In `infra/agents.ts`, create the Lambda function and link necessary resources (tables, bus).
4. **Subscribe**: Ensure the agent is subscribed to its task type in the EventBus.
5. **Deploy**: Run `sst deploy`. The **Build Monitor** will automatically discover the new agent and add it to the **System Pulse** map.
