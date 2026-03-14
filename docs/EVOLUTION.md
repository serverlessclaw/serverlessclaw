# Self-Evolution & Capability Lifecycle

Serverless Claw is a **self-evolving system** that identifies its own weaknesses, designs its own upgrades, and verifies its own satisfaction.

## The Evolution Loop

The stack evolves by bridging the gap between temporary Lambda execution and persistent storage.

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
2. **Audit & Optimization**: Every 48 hours, the **Strategic Planner** reviews all open gaps and `tool_usage` telemetry.
   - **Deduplication**: Planner performs a semantic check to prevent redundant plans for the same gap.
   - **Gap Aging**: Planner automatically archives gaps older than 30 days to `ARCHIVED` status.
3. **Planning**: Planner designs a `STRATEGIC_PLAN` (Expansion or Pruning).
4. **Approval**: Depending on `evolution_mode` (`hitl` vs `auto`), the user approves or the system proceeds.
5. **Implementation**: Coder Agent writes code and triggers deployment.
   - **Pre-Deployment Verification**: Coder MUST run `validateCode` and `runTests` BEFORE calling `triggerDeployment`.
6. **Verification (Mechanical Gating)**: QA Auditor MUST verify the change using system tools (e.g., `checkHealth`, `validateCode`).
7. **Nudging & Completion**:
   - Reflector nudges the user to test `DEPLOYED` features.
   - SuperClaw proactively marks gaps as `DONE` when the user confirms satisfaction.

## Self-Healing Loop

If a deployment fails, the **Build Monitor** detects the failure and emits a `SYSTEM_BUILD_FAILED` event.

- **Triage**: SuperClaw analyzes the failure logs.
- **Rollback**: If consecutive failures occur, the **Dead Man's Switch** triggers an emergency Git rollback to the last known stable commit.

## Gap Status Flow

```
OPEN → PLANNED → PROGRESS → DEPLOYED → DONE
  |        |          |           |
  v        v          v           v
ARCHIVED (auto-archived after 30 days)
```
