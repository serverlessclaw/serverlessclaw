# Safety Guardrails

> **Agent Context Loading**: Load this file before making any deployment, modifying protected files, or when the circuit breaker is active.

## Guardrail Overview

| Guardrail | Where Implemented | Trigger |
|-----------|-------------------|---------|
| **Resource Labeling** | `core/tools/index.ts → file_write` | Any write to a protected file |
| **Circuit Breaker** | `core/tools/index.ts → trigger_deployment` | > 5 deployments/day (UTC) |
| **Self-Healing Loop** | `core/handlers/monitor.ts` | CodeBuild FAILED event |
| **Dead Man's Switch** | `core/handlers/recovery.ts` | 15-min health probe failure |
| **Pre-flight Validation** | `core/tools/index.ts → validate_code` | Called by Coder Agent after writes |
| **Health Probe** | `core/handlers/health.ts` → `GET /health` | Called by SuperClaw after deployment |
| **Rollback Signal** | `core/tools/index.ts → trigger_rollback` | Circuit breaker active or health failed |
| **Human-in-the-Loop** | SuperClaw system prompt | `MANUAL_APPROVAL_REQUIRED` returned |
| **Dashboard Auth** | `dashboard/src/proxy.ts` | Unauthorized access to ClawCenter |

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
2. **Diagnosis**: `BuildMonitor` fetches the last 50 lines of CloudWatch logs and identifies the original user context from DynamoDB.
3. **Notification**: Dispatches a `system.build.failed` event to the `AgentBus`.
4. **Action**: `EventHandler` invokes the SuperClaw, which notifies the user and automatically dispatches a fix task to the **Coder Agent**.

This loop is still subject to the **Circuit Breaker** to prevent infinite repair attempts.

---

## Circuit Breaker Detail

**State**: Stored in DynamoDB `MemoryTable` under key `system:deploy-stats`:
```json
{ "id": "system:deploy-stats", "count": 3, "lastReset": "2026-03-09" }
```

**Logic**:
- If `lastReset` ≠ today (UTC): reset `count` to 0 (new day).
- If `count >= LIMIT`: return `CIRCUIT_BREAKER_ACTIVE` — no CodeBuild triggered.
- On each successful deploy: `count += 1`.
- On each successful `check_health`: `count -= 1` (reward credit).

**Limit Configuration**:
- **Default**: 5 deployments / UTC day.
- **Customization**: Set `deploy_limit` in the `ConfigTable` (DynamoDB).
- **Cap**: The system enforces a hard cap of **100** deployments per day to prevent runaway costs.
- **Warning**: Setting a limit > 20 will trigger high-consumption warnings in the logs. High limits significantly increase LLM token consumption and AWS resource costs during autonomous evolution loops.

---

## Protected Files

Writes to these files return `PERMISSION_DENIED` from `file_write`:

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
- **On success**: decrement circuit breaker counter by 1.
- **On failure (503)**: SuperClaw must call `trigger_rollback`.

---

## Emergency Rollback Flow

```
trigger_rollback(reason)
      │
      ├── git revert HEAD --no-edit
      └── codebuild.startBuild(Deployer)
```

Returns `ROLLBACK_SUCCESSFUL` or `ROLLBACK_FAILED` (requires human intervention).

---

## Adding a New Guardrail

1. Implement logic in `core/tools/index.ts` (or a new file).
2. Add a unit test in `core/tools/index.test.ts` or a new `*.test.ts`.
3. Update this document and `INDEX.md`.
