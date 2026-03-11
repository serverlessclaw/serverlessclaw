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
| **Deployer** | AWS CodeBuild | `buildspec.yml` | Runs `sst deploy` in isolated environment |

---

## Orchestration Flow

```
User (Telegram)
      │
      ▼
POST /webhook → SuperClaw (Lambda)
      │
      ├──dispatch_task(agentId, task)─► EventBridge AgentBus
      │                                         │
      │                                         ▼
      │                                  Worker Agent (Lambda)
      │                                    │ 1. Load Persona (Registry)
      │                                    │ 2. Load Tools (Registry)
      │                                    └─► 3. Execute & Report
      │
      ├──trigger_deployment──► CodeBuild Deployer
      │                               │
      │      (ON SUCCESS)             ▼
      │      └────────────────── Build Monitor Handler ──► system.build.success (Bus)
      │                                                   │
      │                                                   ▼
      │                                             QA Auditor (Audit & Verify)
      │
      ├──manage_gap──────────► DynamoDB Gap Status Update (OPEN -> PLANNED -> PROGRESS -> DEPLOYED -> DONE)
      │
      └──check_health──► GET /health (src/handlers/health.ts)
              ├── OK  → notify user, reward counter
              └── FAIL → trigger_rollback → notify user
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
1. **delegate** complex changes via `dispatch_task`
2. **deploy then verify**: `trigger_deployment` → `check_health`
3. **rollback on failure**: `CIRCUIT_BREAKER_ACTIVE` or `HEALTH_FAILED` → `trigger_rollback`
4. **HITL**: Stop and ask human on Telegram for any `MANUAL_APPROVAL_REQUIRED`
5. **protect core**: 3 confirmations to delete `AgentBus` or `MemoryTable`

---

## Coder Agent System Prompt (Summary)

Key obligations (see `src/coder.ts` for the full prompt):
1. **pre-flight**: Call `validate_code` after every `file_write`
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
- **Immediate Availability**: Once registered, the SuperClaw can immediately delegate tasks to the new node via `dispatch_task`.

### 2. Dynamic Toolsets
Instead of a static roster, every agent loads its tools from the `AgentRegistry` on every execution.
- **Control**: Users can hot-swap prompts and tools in the dashboard.
- **Optimization**: The Planner Agent can also propose updates to these registries based on performance telemetry.

### 3. Autonomous Evolution (Auto vs HITL)
- **`hitl` mode**: Agents must request approval on Telegram/Slack for deployments or protected file writes.
- **`auto` mode**: The system self-deploys and self-heals without human intervention.
- **Switch**: Controlled in `/settings`.

### 3. Memory Curation
Users can "Prune" the agent's memory at `/memory` to:
- Delete incorrect tactical lessons.
- Remove hallucinated user preferences.
- Clear stale strategic gaps.

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
6.  **Verified Satisfaction**: The **QA Auditor** (via Reflector Audit) monitors subsequent conversations. If the user successfully uses the new capability or confirms satisfaction, the Reflector marks the gap as `DONE`. In `hitl` mode, this requires a final "YES" from the user via the `manage_gap` tool.

---

## Adding a New Sub-Agent

1. Create `src/<name>.ts` with an `Agent` instance and `export const handler`.
2. Add a new `sst.aws.Function` in `sst.config.ts` with appropriate links.
3. Add a `bus.subscribe('<name>.task', ...)` subscription.
4. Add a new `agentType` enum value in `dispatch_task`'s parameters in `src/tools.ts`.
5. Update this file and `INDEX.md`.
