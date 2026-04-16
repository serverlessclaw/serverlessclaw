# Autonomous Health & Monitoring

> **Navigation**: [← Index Hub](../../INDEX.md)

Beyond build failures, Serverless Claw monitors its own operational integrity through **Signal-based Triage** and self-reporting.

## Health Architecture

```text
 [ Any Component ]
        |
 (Health Violation)
        |
        +----------------------------+
        |  SYSTEM_HEALTH_REPORT      |
        |  (AgentBus)                |
        +-------------+--------------+
                      |
        ______________V______________
       |                             |
       |     EVENT_HANDLER           | (SuperClaw)
       |     (Triage Brain)          |
       |_____________________________|
              |
      (Reason & Dispatch)
              |
      +-------+-------+
      |               |
 [ Coder Agent ]  [ Recovery Agent ]
 (Fix Code)       (Cycle Resource)
```

### Self-Scheduling Utility

The `DynamicScheduler` (`core/lib/scheduler.ts`) provides a type-safe interface for managing EventBridge Scheduler schedules.

- **`ensureProactiveGoal`**: Atomically creates or updates a schedule for an agent task (e.g., Strategic Review).
- **Persistence**: Goal metadata is stored in the `ConfigTable` with a `GOAL#` prefix to maintain state across execution cycles.
- **Flexibility**: Supports both one-off tasks and recurring cron/rate expressions.

4. **Circuit Breakers**: To prevent runaway costs or unstable loops, the system enforces a deployment limit (Default: 5 per 24h).

## Proactive Lifecycle

```text
 [ Agent/Goal ]
        |
 (scheduleGoal)
        |
 [ AWS Scheduler ] --(time/rate)--> [ HeartbeatHandler ]
                                          |
                                 (HEARTBEAT_PROACTIVE)
                                          |
 [ AgentBus ] <---------------------------+
      |
 [ EventHandler ] --(Dispatch)--> [ Target Agent ]
                                     (Do Work)
```

## 🛡️ Self-Healing & Dead Man's Switch

To handle severe system-wide failure (e.g., corrupted backbone, backbone outage, or recursive agent failure), Serverless Claw implements a **Dead Man's Switch (DMS)**.

### Recovery Loop

The DMS runs on a disciplined 15-minute cadence via a recurring EventBridge schedule.

```text
 [ Scheduler ] --rate(15m)--> [ DeadMansSwitch ]
                     |
                     +--> checkCognitiveHealth()
                     |    (Bus + Tools + Providers)
                     |
                     +--> FAIL: acquire recovery lock (20m TTL)
                        |
                        +--> increment recovery_attempt_count
                        |        |
                        |        +--> >2 attempts: emit OUTBOUND_MESSAGE (critical escalation)
                        |
                        +--> load LKG hash from MemoryTable
                        |
                        +--> CodeBuild StartBuild
                            (EMERGENCY_ROLLBACK=true, LKG_HASH=...)
```

### Deep Health Probes

Unlike basic uptime checks, the DMS verifies the entire **Cognitive Stack**:

- **Bus Health**: Emits a test event and verifies delivery.
- **Provider Health**: Calls the active LLM provider to verify connectivity and ensures active model configurations are valid and resolvable.
- **Tool Integrity**: Verifies that the the `AgentRegistry` can be successfully read from DynamoDB.

## Triage & Recovery

The **SuperClaw** receives health signals with full error context. It can delegate to a **Coder Agent** for permanent code fixes or a **Recovery Agent** for immediate resource cycling or rollback.

## Observability & Service Level Objectives (SLOs)

Serverless Claw integrates a robust tracking system, emitting real-time signals to CloudWatch and maintaining persistent historical rollups in DynamoDB.

### Metric Topology

Trace data and metrics flow through a multi-layered persistence strategy to ensure reliability and dashboard performance.

```text
 [ Agent Execution ] ----------(Tokens/Duration)--------> [ TokenTracker ] -> (Daily Rollups)
        |                                                       |
        +-----(Steps/Status)-----> [ TraceTable ] <-------------+
        |                             |
        |                      (Summaries V2)
        |                             |
 [ LLM/Tool Calls  ] --(Success/Failure/Tokens)--> [ Metrics ]  |
        |                  |         ^                 |        |
        |                  |         |                 |        |
        |          [ CRITICAL_FAIL ] | [ PARALLEL_AGG ]|        |
        |                  |         |                 |        |
        |                  v         |                 |        |
        |          (DETERMINISTIC)   +-----------------+        |
        |          (FALLBACK KEY )                              |
        |                                              |        |
        +-------(CloudWatch Metrics / Dashboard)-------+        |
                                                       |        |
 [ SLO Tracker ] <------(Query Success Rates)-------------------+
        |
        +---->(Error Budget / Burn Rate Check)
        |
        v
 [ Alerting ] ---> (High Token Usage / Circuit Breaker / DLQ Overflow / High Error Rate)
        |
        +---> [ Notifier (Telegram) ]
```

### Advanced Observability Features

1. **Token Tracking**: Per-invocation and rollup storage ensures granular usage visibility (including summarization).
2. **CloudWatch Metrics**: Core paths (executors, handlers, buses, dead letter queues) continuously emit metric data.
3. **Deterministic Persistence Keys**: Critical metrics that fail to emit to CloudWatch are persisted to DynamoDB using searchable, deterministic keys (`METRIC#${Name}#${Timestamp}`). This eliminates "Gaps in the Eye" by enabling offline aggregation and auditability of critical failure modes.
4. **p95 Latency Estimation**: When high-resolution percentile data is unavailable (e.g., during cold starts or low-concurrency windows), the SLO Tracker employs a **Latency Estimation Factor (1.25x)**. This heuristic ensures that "Durable Observability" remains conservative and safety-first even with sparse data.
5. **Trace Summary Consolidation**: The `ClawTracer` maintains a high-level `__summary__` row per trace. This consolidation avoids the "N+1 Query" problem in dashboards, providing a single-row-per-trace view that stays synchronized through atomic updates in `startTrace`, `addStep`, `endTrace`, and `failTrace`.
6. **Alerting**: Automated notifications (via `OUTBOUND_MESSAGE`) push critical warnings like anomalous token usage, open circuit breakers, and DLQ overflow.
7. **SLO Tracking**: Monitors service availability, task success rate, and P95 latency against predefined budgets.
