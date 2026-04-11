# Self-Evolution & Capability Lifecycle

> **Navigation**: [← Index Hub](../../INDEX.md)

Serverless Claw is a **self-evolving system** that identifies its own weaknesses, designs its own upgrades, and verifies its own satisfaction.

## The Evolution Loop

```text
+--------------+       +------------------+       +-------------------+
|  Coder Agent |------>|  Staging Bucket  |<------|   AWS CodeBuild   |
| (Writes Code)| upload|    (S3)          | pull  |     (Deployer)    |
+--------------+       +------------------+       +---------+---------+
                                                            |
                                                            v
                                                  +-------------------+
                                                  | Pre-Deployment QA |
                                                  | (validateCode,    |
                                                  |  runTests)         |
                                                  +---------+---------+
                                                            |
                                                            v
+--------------+       +------------------+       +-------------------+
|  SuperClaw  +------>|  AWS CodeBuild   +------>|   Agent Stack     |
| (Orchestrator)| trigger| (Deployer)       |  sst  | (Self-Update)     |
+--------------+       +---------|--------+       +---------+---------+
                                  |
                                  v
                         +-------------------+
                         | Build Monitor     |
                         | (Gap Aging: 30d)  |
                         +---------+---------+
                                  |
                                  v
+--------------+       +------------------+       +-------------------+
|  QA Auditor  +------>|  Mechanical Gate |<------+   User Feedback   |
| (Verifies)   | tool  | (Status: DONE)   | chat  |  (Closes Loop)    |
+--------------+       +------------------+       +-------------------+
```

## Capability Lifecycle

The system's evolution follows a strict, verified hierarchy:

1. **Observation**: Reflector identifies a `strategic_gap` from conversation logs.
2. **Audit & Optimization**: Every 48 hours, the **Strategic Planner** reviews all open gaps.
3. **Planning**: Planner designs a `STRATEGIC_PLAN`.
4. **Council Review** (High-Impact Only): If `impact >= 8`, `risk >= 8`, or `complexity >= 8`, the plan is dispatched to the **Critic Agent** for parallel peer review (Security, Performance, Architect). Plans are only approved if all reviews pass.
5. **Approval**: Depending on `evolution_mode`, the user approves or the system proceeds.
6. **Implementation (Definition of Done)**: Coder Agent MUST implement changes along with **Tests** and **Documentation**.
7. **Pre-Flight Validation**: Coder MUST run `validateCode` and `runTests` before `stageChanges`.
8. **Deployment**: CodeBuild deploys to live environment (No Git push).
9. **Verification**: QA Auditor verifies live satisfaction.
10. **Atomic Sync**: ONLY after QA success, `gitSync` pushes verified code back to the trunk.
11. **Nudging & Completion**: SuperClaw marks gap as `DONE`.

Serverless Claw implements a **dynamic trust model** where autonomy is not a static toggle, but a collaborative relationship between the user and SuperClaw.

### The Agent-User Trust Loop

```text
       [ Cognitive Health Monitor ]
                 |
      (1) Continuous Audit <-----------+
                 |                     |
      (2) Calculate Trust Score        |
          (0-100)                      |
                 |                     |
      (3) Advisory Promotion candidacy |
          (if Score >= 90)             |
                 |                     |
      +----------v----------+          |
      |   Security Hub      |          | (5) Recalibrate
      | (Dashboard UI)      |----------+
      +----------+----------+
                 |
      (4) User Approval (HITL -> AUTO)
                 |
      +----------v----------+
      |  Enhanced Autonomy  |
      | (Class B Bypass)    |
      +---------------------+
```

### Trust-Based Autonomy Scaling

1. **Cognitive Health Metrics**: The system tracks reasoning quality, memory consistency, and task completion rates to generate a rolling **Trust Score** for each agent.
2. **Advisory Promotion**: When an agent maintains a `TrustScore >= 90`, the `SafetyEngine` identifies it as an **Advisory Candidate**. This is surfaced in logs and on the Co-Management Dashboard.
3. **Collaborative Negotiation**: SuperClaw uses the `proposeAutonomyUpdate` tool to request mode shifts (e.g., from HITL to AUTO) when performance is optimal.
4. **Governance Boundaries**: Even in AUTO mode, **Class C** (Infrastructure/IAM) actions remain protected by the governance framework unless explicitly overridden in the `governance_config`.

## Evolution Modes: HITL vs AUTO

Serverless Claw supports two primary evolution modes that dictate how autonomously the system can execute tasks and use tools.

| Mode                         | Autonomy Level | Approval Logic                                                                   | Use Case                                                |
| :--------------------------- | :------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------ |
| **HITL** (Human-in-the-Loop) | Medium         | Requires manual approval for all sensitive tools.                                | Production, high-stakes environments.                   |
| **AUTO** (Autonomous)        | High           | Bypasses manual approval for sensitive tools (Technical Guardrails still apply). | Rapid experimentation, trusted VPCs, autonomous agents. |

### ⚡ EvolutionMode.AUTO Flow

In `EvolutionMode.AUTO`, the `ToolExecutor` prioritizes speed and autonomy while maintaining safety through **Technical Guardrails**:

1.  **Implicit Approval**: All tool calls are treated as "Effective Approved" by default.
2.  **Sensitive Tool Awareness**: Even in AUTO mode, the system identifies "Sensitive Tools" (e.g., `delete`, `iam`, `shell`) and applies extra logging and tracing.
3.  **Technical Guardrails (Zod & Security)**: Bypassing human approval does NOT bypass technical security. The `checkArgumentsForSecurity` pre-flight check still runs to prevent Class D vulnerabilities (e.g., path traversal, command injection).
4.  **Autonomous Promotion**: Innovations identified by the Harvester in AUTO mode can be promoted to the Mother Hub with minimal human friction, monitored by the `QA Auditor`.

---

## Atomic Deployment Sync (Metadata Integrity)

To ensure self-evolution robustness, the system implements an **Atomic Sync** mechanism that links infrastructure builds to the strategic gaps they resolve. This prevents metadata loss during the asynchronous deployment process.

### Dual-Path Synchronization

1. **DynamoDB Path**: `triggerDeployment` records build metadata and gap mappings in the `MemoryTable` under `BUILD#` and `BUILD_GAPS#` keys.
2. **CodeBuild Path**: Metadata (`GAP_IDS`, `INITIATOR_USER_ID`, `TRACE_ID`) is passed as environment variables directly to the CodeBuild project.

The **Build Monitor** resolves metadata by prioritizing DynamoDB but falling back to CodeBuild environment variables if records are delayed or missing.

```text
    [ triggerDeployment ]
          |
          +--(1) Write DDB metadata (BUILD#, BUILD_GAPS#)
          |
          +--(2) Start CodeBuild (Env Overrides: GAP_IDS, TRACE_ID)
                    |
                    v
             [ AWS CodeBuild ]
                    |
          (3) Emit State Change Event
                    |
                    v
             [ Build Monitor ]
                    |
          (4) Resolve Metadata <---+ (Fallback: CodeBuild Env)
                    |              |
          (5) Transition Gaps ---->+ (Primary: DynamoDB)
              (DEPLOYED / OPEN)
```

## Self-Healing Loop

If a deployment fails, the **Build Monitor** detects the failure and emits a `SYSTEM_BUILD_FAILED` event.

- **Triage**: SuperClaw analyzes the failure logs using the **Failure Manifest** (see [DEVOPS.md#autonomous-remediation-failure-manifests](../governance/DEVOPS.md#autonomous-remediation-failure-manifests)).
- **High-Signal Remediation**: The system automatically reconstructs the failing workspace state (including uncommitted patches) to enable precise fixes by the Coder agent.
- **Rollback**: If consecutive failures occur, the **Dead Man's Switch** triggers an emergency Git rollback to the last known stable commit.

## Gap Status Flow

```
OPEN → PLANNED → PROGRESS → DEPLOYED → DONE
  |        |          |           |
  |        v          v           v
  +----<---------------------- FAILED (If max reopen limits hit: 3 attempts)
                                  |
ARCHIVED (auto-archived after 30 days)
```

**Retry Logic:** If a deployed change fails QA or the build fails, the gap is moved back to `OPEN` and the `Coder Agent` is immediately dispatched to fix it. If it fails 3 times, it escalates to `FAILED`.

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
       2. AUDIT_TELEMETRY (MAJOR_SWARM_COMPLETE / TRUNK_SYNC)
              |
       3. ToolPruner.generatePruneProposal()
              |
       4. SUGGEST_PRUNING (Strategic Gap: PENDING_REVIEW)
              |
    +---------+---------+
    |   Human Admin     | <--- Approve/Execute removal via Dashboard
    +-------------------+
```

- **Deterministic Auditing**: During major events (`MAJOR_SWARM_COMPLETE`), the `AuditHandler` triggers the **ToolPruner** (`core/lib/lifecycle/pruning.ts`).
- **Redundancy Detection**: If a tool hasn't been used in 30 days (configurable via `tool_prune_threshold_days`), the `ToolPruner` suggests a pruning plan.
- **Manual Intervention**: Humans can review proposals and execute removals via the **Evolution** sector in the Dashboard.

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

## 📈 Self-Optimization Feedback Loop

To ensure the system remains efficient, a continuous optimization loop runs in the background, utilizing telemetry and reputation metrics to drive routing and planning decisions.

### Performance Telemetry

The system captures granular metrics for every tool invocation and agent task:

- **`tool_usage`**: Records input/output tokens, duration, and success status.
- **`failure_patterns`**: The **Cognition Reflector** identifies persistent technical hurdles (anti-patterns).

### Agent Reputation Strategy

On every `TASK_COMPLETED` or `TASK_FAILED` event, the system updates a rolling 7-day reputation record for the involved agents.

- **Formula**: `Score = (successRate * 0.6) + (latencyComponent * 0.25) + (recencyComponent * 0.15)`
- **Composite Routing**: The `AgentRouter` selects agents using a blend of historical performance and reputation: `FinalScore = (0.6 * performanceScore) + (0.4 * reputationScore)`.

### Optimization Flow

```text
    [ Execution ] <----------- (6) selectBestAgent() ----------- [ AgentRouter ]
          |                                                            ^
    (1) recordToolUsage()                                              |
          |                                                   (5) getMetrics()
    +-----v-----+          (7) updateReputation()               +-------+-------+
    |  Token    | <----------- (4) fetchToolUsage() ---+        |  Reputation   |
    |  Tracker  | <---+                                 |        |  (7-day roll) |
    +-----+-----+     |                                 |        +-------+-------+
          |           |                                 |                ^
    (2) recordFailure |                                 |      (8) getReputation()
          |                                                   |                |
    +-----v-----+                                             +        | Reputation    |
    |  Memory   | <----------------------------------------------------| Handler       |
    |  (Insights)|                                                      +-------+-------+
          ^                                                                      ^
          |                                                                      |
          +------------------ [ Strategic Planner ] <----------- (7) REPUTATION_UPDATE
                                (Design Phase)                           |
                                                                 +-------+-------+
                                                                 | EventHandler  |
                                                                 | (on result)   |
                                                                 +---------------+
```

The unified **AgentRouter** (`core/lib/routing/AgentRouter.ts`) consolidates these metrics to ensure the most capable and cost-effective agent is selected for every task.

## 🛡️ Evolution Safeguards

- **Intent-Based Dual Mode**: Agents toggle between **JSON Mode** (for strict handoffs and state sync) and **Text Mode** (for user-facing empathy).
- **Structured JSON Hub**: When in JSON mode, agents emit deterministic signals (`SUCCESS`, `FAILED`, `REOPEN`) matching a strict native schema.
- **Atomic Metadata Sync**: The `triggerDeployment` tool handles gap-to-build mapping internally to prevent metadata loss.

---

## Multi-Track Evolution

Gaps are automatically assigned to evolution tracks based on keyword analysis of the plan content. Each track runs in parallel via `PARALLEL_TASK_DISPATCH`.

### Tracks

| Track            | Keywords                                            | Priority    | Use Case                            |
| ---------------- | --------------------------------------------------- | ----------- | ----------------------------------- |
| `security`       | auth, injection, vulnerability, permission, encrypt | 1 (highest) | Security patches, auth improvements |
| `performance`    | latency, cache, memory, optimize, slow, timeout     | 2           | Optimization, caching, throughput   |
| `feature`        | (default)                                           | 3           | New capabilities, UX improvements   |
| `infrastructure` | deploy, lambda, sst, pipeline, ci/cd, buildspec     | 4           | DevOps, monitoring, scaling         |
| `refactoring`    | refactor, cleanup, debt, rename, consolidate        | 5           | Tech debt, code organization        |

### Track Assignment Flow

```text
    [ Strategic Planner ]
              |
    (1) determineTrack(plan) --> [ Keyword Matching ]
              |
    +---------+---------+
    |                   |
  [Track: Security]   [Track: Performance]
  priority: 1         priority: 2
    |                   |
    +---- gaps ----+    +---- gaps ----+
    |              |    |              |
  [Gap#1]       [Gap#2] [Gap#3]    [Gap#4]
    |              |    |              |
    v              v    v              v
  [PARALLEL_TASK_DISPATCH per track]
```

### Memory Schema

Track assignments are stored as `TRACK#<gapId>` in DynamoDB:

```typescript
{
  {
    userId: 'TRACK#gap-123',
    timestamp: 0,
    type: 'TRACK_ASSIGNMENT',
    gapId: 'gap-123',
    track: 'security',
    priority: 1,
    assignedAt: 1711668000000,
  }

```
