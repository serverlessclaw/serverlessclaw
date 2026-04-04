# Self-Evolution & Capability Lifecycle

> **Navigation**: [← Index Hub](../INDEX.md)

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

- **Triage**: SuperClaw analyzes the failure logs using the **Failure Manifest** (see [DEVOPS.md#autonomous-remediation--failure-manifests](./DEVOPS.md#autonomous-remediation--failure-manifests)).
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
