# System Resilience: Recovery & Stability

> **Navigation**: [← Index Hub](../../INDEX.md) | [Audit Framework](../governance/AUDIT.md#3-the-shield-security--baseline)

This document describes the high-availability, self-healing, and security mechanisms that ensure Serverless Claw remains operational and safe.

## 🛡️ Security & Baseline Control

The Shield acts as the authoritative gate for all tool executions, enforcing least-privilege resource access and blast-radius limits.

### Layer 1: Unified Security Gateway
The `ToolExecutor` delegates all security decisions to the `SafetyEngine`. No tool can execute without an explicit policy allowance.

### Layer 2: Blast Radius Enforcement
The system enforces hard limits on high-impact actions to prevent runaway costs or destructive propagation:
- **Class C Limit**: Hard cap of 5 Class C actions per hour per agent (Principle 10).
- **Promotion**: Class C actions require human approval unless an agent is in `EVOLUTION_MODE="AUTO"` and has a `TrustScore >= 95`.

### Layer 3: Loop Interdiction
Reasoning loops and repetitive "semantic grinding" are caught by the **SemanticLoopDetector**.
- **Penalty**: Detected loops result in automatic trust penalties recorded via `SafetyBase.recordFailure`.

## 🔄 Circuit Breaker (Persistent Logic)

Serverless Claw employs a persistent circuit breaker to prevent runaway deployments and cost spikes.

### Layer 1: Daily Deployment Limit

- **Mechanism**: Atomic counter in DynamoDB.
- **Default**: 5 deployments per UTC day.
- **Reset**: Automatically resets at UTC midnight.

### Layer 2: Sliding Window

The system tracks `deploy` and `health` failures in a 1-hour sliding window.

- **Closed**: System operating normally.
- **Open**: Failures > 5. Autonomous deployments are blocked for 10 minutes.
- **Half-Open**: One probe deployment allowed after cooldown.

---

## 🆘 Dead Man's Switch (Emergency Recovery)

The **Dead Man's Switch** is an external heartbeat monitor that triggers an automated rollback if the system becomes "braindead" (unresponsive).

1. **Schedule**: Triggered every 15 minutes by EventBridge.
2. **Probes**: Combined HTTP (`GET /health`) and Cognitive Health check.
3. **Emergency Action**: If probes fail, CodeBuild triggers an emergency rollback.
4. **Git Revert**: The system performs a `git revert HEAD` and redeploys the last known good state.

---

## 🩹 Self-Healing Loop

When a deployment fails, the system automatically attempts a repair before escalating to human intervention.

```text
    +-----------+           +-----------+
    |  Monitor  | --------> | SuperClaw |
    | (Enrich)  |           | (Diagnose)|
    +-----------+           +-----------+
          ^                       |
          |                       v
    +-----------+           +-----------+
    | Deployer  | <-------- | Coder     |
    | (Fail)    |           | (Repair)  |
    +-----------+           +-----------+
```

## Security Interaction Flow

```text
  [ Agent Output ] -> [ SemanticLoopDetector ] -- (Loop Found) --> [ SafetyBase.recordFailure ]
          |                                                             (Trust Penalty)
          v
  [ Tool Call ] -> [ Shield (SafetyEngine) ] -- (Class C) --> [ EvolutionScheduler ]
          |                  |                                   (Schedule HITL)
          |                  +------- (Trust >= 95 & AUTO) -> [ Principle 9 Promotion ]
          |                                                      (Bypass Approval)
          v
  [ Circuit Breaker ] -- (Tripped?) --> [ Execution Blocked ]
          |
          v
  [ Tool Execution ] -> [ Failure? ] -> [ SafetyBase.recordFailure ] -> [ Trip Breaker ]
```

### Self-Healing Flow:

1. **Diagnosis**: `BuildMonitor` extracts the last 3000 chars of build logs.
2. **Enrichment**: The `traceId` and `gapId` of the failing task are bundled.
3. **Repair**: The **Coder Agent** receives the error logs and reasoning context to propose a fix.
4. **Guard**: This loop is subject to the Circuit Breaker to prevent "Infinite Repair Harm."

---

## 🌊 Concurrency & Lock Management

To prevent race conditions between multiple agents modifying the same code or database records, the system uses a distributed **Lock Manager**.

- **Implementation**: DynamoDB-backed atomic locks with TTL.
- **Default TTL**: 5 minutes for general tasks; 30 minutes for Strategic Gaps.
- **Conflict Handling**: If a lock is busy, the agent emits a `TASK_PAUSED` signal and retries after a jittered backoff.
