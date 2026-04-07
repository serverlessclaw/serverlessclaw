# Safety Guardrails & Recursion Control

> **Navigation**: [← Index Hub](../INDEX.md)

> [!WARNING]
> Manual approval is required before executing any deployment, modifying protected files, or when the circuit breaker is active.

## Guardrail Overview

| Guardrail                  | Where Implemented                         | Trigger                                 |
| -------------------------- | ----------------------------------------- | --------------------------------------- |
| **Resource Labeling**      | `core/tools/index.ts → fileWrite`         | Any write to a protected file           |
| **Daily Limit**            | `core/lib/deploy-stats.ts`                | > N deployments/day (UTC)               |
| **Circuit Breaker**        | `core/lib/circuit-breaker.ts`             | Failures in sliding window              |
| **Self-Healing Loop**      | `core/handlers/monitor.ts`                | CodeBuild FAILED event + Enrichment     |
| **Dead Man's Switch**      | `core/handlers/recovery.ts`               | 15-min health probe failure             |
| **Pre-flight Validation**  | `core/tools/index.ts → validateCode`      | Called by Coder Agent after writes      |
| **Health Probe**           | `core/handlers/health.ts` → `GET /health` | API endpoint for external probes        |
| **Self-Reporting (New)**   | `core/lib/health.ts → reportHealthIssue`  | Internal component violation detection  |
| **Rollback Signal**        | `core/tools/index.ts → triggerRollback`   | Circuit breaker active or health failed |
| **Human-in-the-Loop**      | SuperClaw system prompt                   | `MANUAL_APPROVAL_REQUIRED` returned     |
| **Dashboard Auth**         | `dashboard/src/proxy.ts`                  | Unauthorized access to ClawCenter       |
| **Recursion Guard**        | `core/handlers/events.ts`                 | Agent-to-agent hop depth > default (15) |
| **Granular Safety Engine** | `core/lib/safety-engine.ts`               | Multi-dimensional policy enforcement    |
| **Deep Cognitive Health**  | `core/lib/cognitive-metrics.ts`           | Agent reasoning/memory degradation      |

---

## Deep Cognitive Health

The system monitors agent cognitive health through the `CognitiveHealthMonitor` class, which analyzes reasoning quality, memory health, and detects anomalies.

### Architecture

```text
    [ Dead Man's Switch ] (every 15 min)
              |
    +---------+---------+---------+
    |         |         |         |
  [API]    [AgentBus] [Tools]  [LLM Provider]
  /health  ListBuses  ping    latency check
    |         |         |         |
    v         v         v         v
  HEALTH#api  HEALTH#bus  HEALTH#tools  HEALTH#llm
    |         |         |         |
    +---------+---------+---------+
              |
    [ ALL OK? ] --NO--> [ ALERT + ROLLBACK ]
```

### Components

| Component                  | Class                    | Purpose                                   |
| -------------------------- | ------------------------ | ----------------------------------------- |
| **MetricsCollector**       | `MetricsCollector`       | Buffers and persists cognitive metrics    |
| **DegradationDetector**    | `DegradationDetector`    | Detects anomalies from aggregated metrics |
| **HealthTrendAnalyzer**    | `HealthTrendAnalyzer`    | Analyzes trends and aggregates metrics    |
| **CognitiveHealthMonitor** | `CognitiveHealthMonitor` | Main orchestrator with health scoring     |

### Health Scoring

The overall cognitive health score (0-100) is calculated using:

| Factor               | Weight | Description                                |
| -------------------- | ------ | ------------------------------------------ |
| Task Completion Rate | 40%    | Percentage of successfully completed tasks |
| Reasoning Coherence  | 30%    | Quality of agent reasoning (0-10 scale)    |
| Error Rate           | 20%    | Percentage of failed tasks                 |
| Memory Fragmentation | 10%    | Memory health (lower is better)            |

### Anomaly Detection

The system detects the following anomaly types:

| Anomaly Type            | Severity        | Trigger                                      |
| ----------------------- | --------------- | -------------------------------------------- |
| `TASK_FAILURE_SPIKE`    | HIGH/CRITICAL   | Completion rate drops below 70%              |
| `REASONING_DEGRADATION` | MEDIUM/CRITICAL | Coherence score drops below 5.0              |
| `MEMORY_FRAGMENTATION`  | MEDIUM/HIGH     | Fragmentation exceeds 70%                    |
| `TOKEN_OVERUSE`         | MEDIUM          | Token efficiency below 0.5 tasks/1000 tokens |

### Usage

Run a cognitive health check via the `runCognitiveHealthCheck` tool:

```typescript
// Basic check
const result = await runCognitiveHealthCheck.execute({});

// Check specific agents
const result = await runCognitiveHealthCheck.execute({
  agentIds: ['coder', 'strategic-planner'],
});

// Verbose output with full metrics
const result = await runCognitiveHealthCheck.execute({
  verbose: true,
});
```

### Health Status Indicators

| Score Range | Status                  | Indicator                             |
| ----------- | ----------------------- | ------------------------------------- |
| 80-100      | Optimal                 | ✅ System cognitive health is optimal |
| 60-79       | Minor Degradation       | ⚠️ Minor degradation detected         |
| 0-59        | Significant Degradation | 🚨 Immediate attention required       |

---

## Granular Safety Tiers

The system implements fine-grained safety controls through the `SafetyEngine` class, which evaluates actions against comprehensive policies.

### Architecture

```
    [ Agent Action ]
          |
    +-----v----------+
    | SafetyEngine   |
    +-----+----------+
          |
    +-----+-----+-----+-----+-----+
    |     |     |     |     |     |
 [Tier] [Tool] [Resource] [Time] [Rate]
  Check  Check   Check    Check  Limit
    |     |     |     |     |
    v     v     v     v     v
 [Policy Evaluation Chain]
          |
    +-----v-----+
    |  Result   |
    +-----------+
    | allowed   |
    | approval  |
    | reason    |
    +-----------+
```

### Safety Tiers (Enhanced)

| Tier         | Code Changes | Deployments |  Files   |  Shell   | MCP Tools | Default Rate Limits          |
| ------------ | :----------: | :---------: | :------: | :------: | :-------: | ---------------------------- |
| `sandbox`    |   Approval   |  Approval   | Approval | Approval | Approval  | 2 deploys/day, 10 shell/hour |
| `staged`     |     Auto     |  Approval   |   Auto   |   Auto   |   Auto    | 5 deploys/day, 50 shell/hour |
| `autonomous` |     Auto     |    Auto     |   Auto   |   Auto   |   Auto    | 10 deploys/day, 200 shell/hr |

### Policy Dimensions

The SafetyEngine evaluates multiple dimensions:

1. **Tier-based approval**: Core approval requirements per tier
2. **Resource-level controls**: File path and API endpoint restrictions
3. **Tool-specific overrides**: Per-tool approval and rate limits
4. **Time-based windows**: Business hours or weekend restrictions (timezone-aware via `Intl.DateTimeFormat`)
5. **Rate limiting**: Hourly and daily usage caps (DynamoDB atomic counters for cross-Lambda persistence)

> **Note**: `SafetyEngine.evaluateAction()` is `async` because rate limit checks use DynamoDB atomic counters. When no `BaseMemoryProvider` is provided, falls back to in-memory counters. All rate limit checks fail-open on DynamoDB errors.

### Usage

```typescript
import { SuperClaw } from './agents/superclaw';
import { SafetyTier } from './types/agent';

// Check if an action requires approval (async)
const needsApproval = await SuperClaw.requiresApproval(agentConfig, 'deployment', {
  traceId: 'abc123',
  userId: 'user1',
});

// Get detailed evaluation result (async)
const result = await SuperClaw.evaluateAction(agentConfig, 'file_operation', {
  resource: 'src/app.ts',
  toolName: 'fileWrite',
});

// Get detailed evaluation result
const result = SuperClaw.evaluateAction(agentConfig, 'file_operation', {
  resource: 'src/app.ts',
  toolName: 'fileWrite',
});

// Configure custom policy
SuperClaw.configureSafetyPolicy(SafetyTier.STAGED, {
  maxDeploymentsPerDay: 10,
  requireFileApproval: true,
});

// Set tool-specific override
SuperClaw.setToolSafetyOverride({
  toolName: 'triggerDeployment',
  requireApproval: true,
  maxUsesPerDay: 3,
});

// Get violation history
const violations = SuperClaw.getSafetyViolations(50);

// Get statistics
const stats = SuperClaw.getSafetyStats();
```

### Protected Resources

The following resources are blocked by default across all tiers:

- `.git/**` - Git repository internals
- `.env*` - Environment files
- `package-lock.json`, `pnpm-lock.yaml` - Lock files
- `node_modules/**` - Dependencies

### Time-Based Restrictions

- **SANDBOX**: Weekends require approval for deployments and shell commands
- **STAGED**: Weekday business hours (9 AM - 5 PM ET) require approval for deployments
- **AUTONOMOUS**: No time restrictions

### Violation Logging

All safety violations are logged with:

- Unique violation ID
- Timestamp
- Agent ID and safety tier
- Action attempted
- Tool and resource involved
- Outcome (blocked, approval_required)
- Trace and user ID for correlation

Access violations via:

```typescript
const violations = SuperClaw.getSafetyViolations();
const stats = SuperClaw.getSafetyStats();
```

---

## Proactive Evolution Scheduling (Class C Actions)

Certain actions are classified as **Class C** (highly sensitive changes) and require proactive evolution instead of immediate execution.

### Class C Action Types:

- `iam_change`: Modifications to IAM roles, policies, or permissions.
- `infra_topology`: Changes to infrastructure architecture or connections.
- `memory_retention`: Alterations to TTL or archival policies.
- `security_guardrail`: Modifications to safety policies or protected files.
- `code_change`: Structural changes that pass quality gates but impact core logic.

### Scheduling Lifecycle:

1.  **Detection**: The `SafetyEngine` identifies an action as Class C.
2.  **Scheduling**: The `EvolutionScheduler` records the action in DynamoDB (`PLAN#evolution`).
3.  **Queueing**: The action is held for a 1-hour cooling period to allow manual human audit.
4.  **Maintenance**: The `MaintenanceHandler` (running every 5 minutes) scans for matured evolution tasks.
5.  **Execution**: If no human rejection is received, the task is dispatched as `PROACTIVE_EVOLUTION`.

---

## Recursion Safety Detail

To prevent infinite loops during autonomous multi-agent coordination, Serverless Claw enforces a strict **Recursion Depth Limit**.

1. **Hop Tracking**: Every event carries a `depth` counter.
2. **Increment**: The `EventHandler` increments this counter before dispatching a `CONTINUATION_TASK`.
3. **Threshold**: The maximum allowed depth is **15 hops** (configurable via `recursion_limit` in ConfigTable).
4. **Intervention**: If `depth >= recursion_limit`:
   - The `EventHandler` immediately logs a critical loop warning.
   - The task is terminated.
   - The `SuperClaw` is notified to inform the user of the "Infinite Loop Detected" and request manual intervention.

---

## Daily Deploy Limit (UTC-Safe Counter)

`incrementDeployCount` now uses a two-step conditional write path to correctly handle UTC day boundaries and avoid carrying over yesterday's count.

```text
[incrementDeployCount(today, limit)]
            |
            v
 [Step 1: same-day increment]
 Condition: lastReset == today AND count < limit
            |
     +------+------+
     |             |
   pass          fail (CCE)
     |             |
     v             v
 [allow]   [Step 2: new-day reset to 1]
           Condition: lastReset missing OR lastReset != today
                     |
              +------+------+
              |             |
            pass          fail (race/limit)
              |             |
              v             v
           [allow]   [retry same-day once]
                             |
                      +------+------+
                      |             |
                    pass          fail
                      |             |
                      v             v
                   [allow]      [block]
```

---

## Handoff TTL Safety Control

Human handoff window is now runtime-configurable via `handoff_ttl_seconds` in ConfigTable.

- If config exists and is positive, it is used.
- Otherwise, the system falls back to 120 seconds.

```text
[requestHandoff(user)]
          |
          v
[ConfigManager.getRawConfig('handoff_ttl_seconds')]
          |
    +-----+-----+
    |           |
 valid number   missing/invalid/error
    |           |
    v           v
 [use config] [use 120s default]
      \         /
       \       /
        v     v
 [Write HANDOFF#user expiresAt]
```

---

## Dead Man's Switch

1. **Schedule**: An EventBridge Scheduler triggers the `DeadMansSwitch` Lambda every 15 minutes.
2. **Probe**: It performs a `GET /health` on the Webhook API.
3. **Emergency Action**: If the probe fails (5xx) or times out, it triggers a CodeBuild deployment with the `EMERGENCY_ROLLBACK=true` flag.
4. **Git Revert**: The CodeBuild process automatically performs a `git revert HEAD` before deploying.
5. **Persistence**: The recovery is logged in DynamoDB (`DISTILLED#RECOVERY`).
6. **Acknowledge**: On the next user message, the SuperClaw detects the log, informs the user, and clears the flag.

---

## Self-Healing Loop

```text
    +-------------------+           +-----------+
    |   SuperClaw      | <-------+ |  Events   |
    | (Brain/Lambda)    |           +-----------+
    +---------+---------+                 ^
              |                           |
              v                           |
    +---------+---------+           +-----+-----+
    |   Coder Agent     |           |  Monitor  |
    | (Repair/Fix)      |           | (Health)  |
    +---------+---------+           +-----+-----+
              |                           ^
              v                           |
    +---------+---------+                 |
    |   Deployer        | ----------------+
    | (CodeBuild/SST)   |
    +-------------------+
```

1. **Detection**: `BuildMonitor` Lambda captures `FAILED` state changes from CodeBuild.
2. **Context Enrichment**: `BuildMonitor` retrieves the `traceId` of the reasoning session that initiated the build and the list of related `gapIds`.
3. **Diagnosis**: `BuildMonitor` fetches the last 3000 chars of CloudWatch logs for immediate error extraction.
4. **Notification**: Dispatches an enriched `system_build_failed` event to the `AgentBus`.
5. **Action**: `EventHandler` invokes the SuperClaw, which explicitly instructs the recovery agent to review the `breakingTraceId` to understand the previous failure reasoning.

This loop is still subject to the **Circuit Breaker** to prevent infinite repair attempts.

---

## Circuit Breaker Detail

Serverless Claw employs a two-layer safety architecture to prevent runaway autonomous deployments and protect system integrity.

### Layer 1: Daily Deployment Limit

**State**: Stored in DynamoDB `MemoryTable` under key `SYSTEM#DEPLOY_STATS`.

**Logic**:

- Enforces an absolute cap on deployments per UTC day.
- **Default**: 5 deployments / day.
- **Reward**: Successful `checkHealth` calls decrement this counter by 1.
- **Cap**: Enforced hard limit of 100 deployments/day to prevent runaway costs.

### Layer 2: Sliding Window Circuit Breaker

**State**: Stored in DynamoDB `ConfigTable` under key `circuit_breaker_state`.

**Logic**:
The system tracks both `deploy` and `health` failures in a persistent sliding window (default: 1 hour).

1. **Closed (Normal)**: Deployments proceed normally. Transition to **Open** if failures exceed the threshold (default: 5).
2. **Open (Blocked)**: Autonomous deployments are blocked for a cooldown period (default: 10 minutes).
3. **Half-Open (Testing)**: After the cooldown, the system allows exactly one probe deployment.
   - **Success**: Circuit returns to **Closed** and failure history is cleared.
   - **Failure**: Circuit returns to **Open** and the cooldown is reset.

**Emergency Bypass**:
Deployments marked as `emergency` (e.g., automated rollbacks) bypass both Layer 1 and Layer 2, but are still logged and reported to the dashboard.

---

## Protected Files

Writes to these files return `PERMISSION_DENIED` from `fileWrite`:

```
sst.config.ts
core/tools/index.ts
core/agents/superclaw.ts
core/lib/agent.ts
buildspec.yml
infra/**
```

**Agent directive**: Surface the proposed change to the human as `MANUAL_APPROVAL_REQUIRED`.

---

## Health Probe

- **Endpoint**: `GET /health` (handled by `core/handlers/health.ts`)
- **Checks**: DynamoDB connectivity, returns `deployCountToday`
- **Response shape**:

  ```json
  { "status": "ok", "timestamp": "...", "deployCountToday": 2 }
  ```

- **On success**: decrements Daily Limit counter by 1 and notifies Circuit Breaker of success.
- **On failure (503)**: SuperClaw must call `triggerRollback`.

---

## Emergency Rollback Flow

```
triggerRollback(reason)
      │
      ├── git revert HEAD --no-edit
      └── codebuild.startBuild(Deployer)
```

Returns `ROLLBACK_SUCCESSFUL` or `ROLLBACK_FAILED` (requires human intervention).

---

## Autonomous Context Compaction

Serverless Claw implements a three-tier context management strategy to prevent context window overflow while preserving critical information in long-running autonomous tasks.

### Three-Tier Architecture

| Tier                                      | Content                                     | Budget Allocation                                            |
| ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| **System Tier** (Fixed)                   | System prompt, identity block, memory index | Immutable — always included                                  |
| **Compressed History Tier** (Synthesized) | Prior summary + extracted key facts         | Configurable via `context_summary_ratio` (default 30%)       |
| **Active Window Tier** (Prioritized)      | Recent messages selected by priority score  | Configurable via `context_active_window_ratio` (default 70%) |

### Priority Scoring

Messages in the active window are selected by a priority score that considers message type and recency:

| Message Type          | Base Priority | Notes                                                                           |
| --------------------- | ------------- | ------------------------------------------------------------------------------- |
| System                | 1.0           | Highest — never dropped                                                         |
| Tool Error            | 0.9           | Detected by content patterns (`Error:`, `FAIL`, `Exception`, `exit code [1-9]`) |
| User Instruction      | 0.8           | User-provided constraints and goals                                             |
| Tool Result (Success) | 0.6           | Decision-relevant outcomes                                                      |
| Assistant Reasoning   | 0.4           | Thinking blocks — lowest priority                                               |

**Recency bonus**: `+0.1 × (position / total_messages)` — newer messages receive a bonus among equal-base-priority messages.

**Length penalty**: `-0.1` for messages > 2000 characters (bloated outputs deprioritized).

### Key Fact Extraction

When history exceeds the active window budget, critical information is preserved as key facts in the compressed tier:

- **File paths** (regex-extracted from tool results)
- **Error messages** (first 80 chars of Error/FAIL/Exception lines)
- **Commit hashes** (7-40 char hex strings)
- **Build statuses** (BUILD SUCCESS/FAILED patterns)
- **Explicit decisions** (lines containing `decision:`, `chose to`, `will do`)

### In-Loop Truncation

During the tool-calling execution loop, if context usage exceeds **90%** of the provider's context window:

1. `AgentExecutor` calls `ContextManager.getManagedContext()` to rebuild the message array mid-loop
2. The rebuild uses the same three-tier strategy with the current `systemPrompt` and session `summary`
3. Any pre-existing `System` messages in the array are dynamically stripped before deduplication to prevent exponential prompt growth.
4. **Atomic Blocks**: `ASSISTANT` messages containing `tool_calls` are tightly coupled with their subsequent `TOOL` response messages. The system treats them as an atomic block during priority scoring. If the block is dropped or kept, it happens as a single unit, guaranteeing strict provider API schema compliance and preventing "Missing tool response" crashes.
5. Low-priority blocks (assistant thinking, bloated tool results) are dropped first
6. Tool errors and user instructions are preserved
7. A structured log is emitted with token counts and tier breakdown

This prevents catastrophic context overflow during multi-step tool-calling sessions (e.g., 50-iteration loops).

### Configuration

| Config Key                      | Default | Hot-Swappable |
| ------------------------------- | ------- | ------------- |
| `context_safety_margin`         | 0.2     | Yes           |
| `context_summary_trigger_ratio` | 0.8     | Yes           |
| `context_summary_ratio`         | 0.3     | Yes           |
| `context_active_window_ratio`   | 0.7     | Yes           |

## Human Control & Task Cancellation

Serverless Claw provides a multi-layered interactive control plane that allows human users to intervene in autonomous agent loops without fully disabling them.

### Safety Tiers (Granular Trust Levels)

Agents operate under one of three safety tiers, configured via `safetyTier` in `IAgentConfig`. The tier determines which actions require human approval.

```text
    [ Agent Action ]
          |
    +-----v-----+
    | SafetyTier|
    +-----+-----+
          |
    +-----+-----+-----+
    |           |     |
 [sandbox]  [staged] [autonomous]
    |           |     |
 ALL require  Deploy  No approval
 approval     only    needed
    |           |     |
    v           v     v
 [HITL Gate] [Partial] [Auto]
```

| Tier         |   Code Changes    |    Deployments    | Default? |
| ------------ | :---------------: | :---------------: | :------: |
| `sandbox`    | Requires approval | Requires approval |    —     |
| `staged`     |   Auto-approved   | Requires approval |    ✅    |
| `autonomous` |   Auto-approved   |   Auto-approved   |    —     |

**Usage**: Set via `SuperClaw.requiresApproval(config, 'deployment')` to check if a specific action needs HITL approval.

### 1. Granular Tool Oversight (HITL)

For security-sensitive operations (e.g., deleting data, triggering deployments), tools can be marked with `requiresApproval: true`. When an agent attempts to use such a tool, the execution pauses and presents the user with three options:

- **Approve Tool**: Continues execution of the specific tool call.
- **Reject Tool**: Blocks the specific tool execution and informs the agent of the rejection. The agent can then propose an alternative path.
- **Clarify**: Allows the user to provide Just-in-Time (JIT) guidance for that specific tool call (e.g., "Use the staging database instead of production").

### 2. Strategic Task Cancellation

Users can halt an entire reasoning trace (and all its sub-agent branches) at any time.

- **Signal**: The user clicks "Cancel Task" in the dashboard.
- **Mechanism**: The system emits a `TASK_CANCELLED` event and sets a distributed cancellation flag in DynamoDB (`CANCEL#<traceId>`).
- **Effect**: Every agent in the trace checks this flag during each iteration. If detected, the agent immediately terminates its loop, cleans up local state, and notifies the user.
- **Blast Radius**: Cancellation propagates through the entire Directed Acyclic Graph (DAG), stopping parallel sub-tasks and background monitors associated with that trace.

---

## Adding a New Guardrail

1. Implement logic in `core/tools/index.ts` (or a new file).
2. Add a unit test in `core/tools/index.test.ts` or a new `*.test.ts`.
3. Update this document and `INDEX.md`.
