# Event Bus & Messaging Architecture

> **Navigation**: [← Index Hub](../../INDEX.md)

> **Agent Context Loading**: Load this file when you need to understand event routing, emit events, or troubleshoot messaging issues.

## Overview

Serverless Claw uses AWS EventBridge as the central nervous system for inter-agent communication. The `emitEvent` utility provides reliable event delivery with retry logic, idempotency, priority levels, and automatic Dead Letter Queue (DLQ) handling.

## Atomic Backbone & Flow Control

The Event Bus acts as the **Spine** of Serverless Claw, ensuring robust signal propagation and atomic control across the swarm.

### 1. Atomic Recursion Control

To prevent infinite reasoning loops or event storms, the Spine enforces strict depth limits using a unified **Atomic Recursion Guard** (`checkAndPushRecursion`):

- **Mechanism**: The `RECURSION_ENTRY` in DynamoDB tracks the current depth for a specific `traceId`.
- **Atomic Monotonic Increment**: Depth tracking uses an atomic monotonic increment via `SET #depth = if_not_exists(#depth, :zero) + :one`. This ensures that every entry point into the system correctly advances the global depth counter, preventing race conditions or bypass in parallel swarm scenarios.
- **Trace-level Continuity (Principle 15)**: Recursion depth is monotonic across the entire life of a trace. Unlike local counters, this stack is **never reset** by individual agent runners.
- **Unified Guard**: Both the `EventHandler` and `AgentMultiplexer` utilize a centralized check to ensure consistency across different entry points.
- **Limit**: Standard tasks are capped at a depth of 15 (configurable via `recursion_limit`). Mission-critical tasks (swarms, DAGs) use a stricter limit (default 10, via `mission_recursion_limit`).

### 2. Distributed Resilience (Tie-breaks & Circuit Breakers)

The Spine maintains system stability through distributed state management and proactive conflict resolution:

- **Yield to Tie-break**: The `AgentMultiplexer` monitors collaboration timeouts in real-time. If a session exceeds its `TIE_BREAK_TIMEOUT_MS`, the multiplexer **immediately halts processing** and yields to the Facilitator's strategic tie-break to prevent "split-brain" state corruption.
- **DistributedState**: Circuit breakers and rate limiters are grounded in `MemoryTable` rather than in-memory volatile state. This ensures protection is enforced consistently across all concurrent Lambda execution environments.
- **Fail-Closed Strategy (Principle 13)**: Rate limiting and circuit breakers enforce a **fail-closed** policy. If the system cannot atomically verify token availability or circuit status due to database failure or extreme contention, it rejects the operation/event to preserve system integrity and protect downstream capacity.
- **Config Caching**: To minimize DynamoDB overhead, static configuration thresholds (limits, timeouts) are cached in-memory with a 1-minute TTL (`ConfigManager`), balancing performance with operational flexibility.

### 3. Agent Selection & Routing (Selection Integrity)

The `AgentRouter` selects the best candidate from the `AgentRegistry` based on trust scores and capability matching.

- **Selection Integrity (Principle 14)**: Operational status (`enabled === true`) is verified at the gateway for **all** selection paths. No reputation score or historical performance can override a "disabled" flag.
- **Performance Optimization**: `AgentRouter` utilizes top-level imports and cached registry lookups to minimize orchestration latency.
- **Fallback**: If no high-trust agent is available, the backbone falls back to a deterministic supervisor (SuperClaw) for graceful degradation.

### 4. Distributed Lock Management

Concurrency is handled via the `LockManager`, which uses conditional DynamoDB updates:

- **Lock Key**: `LOCK#<userId>#<resourceId>`
- **TTL**: Locks automatically expire to prevent deadlocks during Lambda timeouts or failures (default 5-30m).

---

## Event Priority System

Events are classified into four priority levels to ensure critical events are processed appropriately:

| Priority   | Use Case                                           | Retry Policy                       |
| ---------- | -------------------------------------------------- | ---------------------------------- |
| `CRITICAL` | System failures, health issues, deployment errors  | 5 retries with exponential backoff |
| `HIGH`     | User-facing messages, heartbeats, task completions | 3 retries with exponential backoff |
| `NORMAL`   | Standard agent-to-agent communication              | 3 retries (default)                |
| `LOW`      | Background tasks, telemetry, non-urgent updates    | 1 retry                            |

### Usage

The `emitEvent` utility is the primary interface for sending events. It supports explicit priority levels and provides convenience methods like `emitCriticalEvent`.

- **Implementation**: [`core/lib/utils/bus.ts`](../../core/lib/utils/bus.ts)
- **Available Methods**: `emitEvent`, `emitCriticalEvent`, `emitHighPriorityEvent`, `emitLowPriorityEvent`.

## Idempotency (Reserve-then-Commit)

To prevent duplicate event processing even under high concurrency, the system uses a **Reserve-then-Commit** atomic pattern:

1.  **RESERVE**: `emitEvent` attempts an atomic `PutCommand` with `attribute_not_exists(userId)`.
2.  **EMIT**: If reservation succeeds, it calls EventBridge `PutEvents`.
3.  **COMMIT**: Upon success, it updates the record to `COMMITTED` status and attaches the `eventId`.

This ensures that if two agents try to emit the same task simultaneously, one will fail the reservation and the system will correctly return `DUPLICATE`.

The system uses a **Reserve-then-Commit** atomic pattern to ensure that even under high concurrency, an event is only processed once.

- **Helper**: `emitEventWithIdempotency` in [`core/lib/utils/bus.ts`](../../core/lib/utils/bus.ts)

**Note**: Idempotency keys are stored in DynamoDB with a 1-hour TTL.

## Error Handling & Retry Logic

The event bus implements intelligent retry with exponential backoff:

```
Attempt 1 -> FAIL -> Wait 100ms -> Retry
Attempt 2 -> FAIL -> Wait 200ms -> Retry
Attempt 3 -> FAIL -> Wait 400ms -> Retry
Attempt 4 -> FAIL -> Store in DLQ
```

### Error Categories

Errors are classified to optimize retry behavior:

| Category    | Examples                                  | Retry Behavior               |
| ----------- | ----------------------------------------- | ---------------------------- |
| `TRANSIENT` | Rate limiting, timeout, connection issues | Retry with backoff           |
| `PERMANENT` | Access denied, invalid payload, not found | Store in DLQ immediately     |
| `UNKNOWN`   | Unclassified errors                       | Retry with backoff, then DLQ |

## Dead Letter Queue (DLQ)

Failed events are automatically stored in the DLQ with full metadata including retry counts and error categories.

- **Schema**: See `DlqEntry` interface in [`core/lib/utils/bus.ts`](../../core/lib/utils/bus.ts).

The bus provides tools to inspect and replay failed events.

- **Operations**: `getDlqEntries`, `retryDlqEntry`, `purgeDlqEntry` in [`core/lib/utils/bus.ts`](../../core/lib/utils/bus.ts).

Standard event types and their default priority levels are centrally defined to maintain system-wide consistency.

- **Enum**: `EventType` in [`core/lib/types/agent.ts`](../../core/lib/types/agent.ts).
- **Mapping**: `EVENT_PRIORITY_MAP` in [`core/lib/utils/bus.ts`](../../core/lib/utils/bus.ts).

## Spine Event Flow

```text
  [ EventBridge Event ]
          |
          v
  [ EventHandler ] -- (Resilient Validation) -> [ Missing traceId/sessionId? ] -- YES --> [ Inject Defaults ]
          |                                                                              (Self-Heal)
          | (NO)
          v
  [ Agent Multiplexer ] -- (Check Timeout) -> [ Timed Out? ] -- YES --> [ HALT & Yield ]
          |                                                             (Tie-break)
          | (NO)
          v
  [ Flow Control ] -- (Principle 13) -> [ Circuit/Rate Gate ] -- FAIL --> [ Reject & DLQ ]
          |                                 (Fail-Closed)
          v
  [ Agent Router ] -- (Principle 14 Guard) -> [ Selection Integrity ] -- FAIL --> [ Fallback ]
          |                                         (Verify Enabled)
          v
  [ Recursion Guard ] -- (Principle 15) -> [ Atomic Increment ] -- FAIL --> [ Reject & Notify ]
          |                                (Monotonic Safety)        (Limit Exceeded)
          |                                         |
          v                                         v
  [ DLQ Guard ] -- (DLQ_ROUTE?) -> [ YES: stop re-route, raise health issue ]
          |                         (Prevents DLQ -> DLQ loops)
          | (NO)
          v
  [ Agent Executor ] -- (Lock Acquisition) -> [ Session Lock ]
          |                                          |
          v                                          v
  [ Tool Executor ] -- (Shield Gate) -> [ Safety Engine ]
          |
          v
  [ Trace Table ] -- (Unified failTrace) -> [ Recovery Event ]
```

**Recursion Flow Details:**

- **Atomic Guard**: Uses `UpdateCommand` with `if_not_exists` to increment depth in a single atomic database trip.
- **Safety Enforcement**: Returns the _new_ depth value immediately; calling code rejects any operation where `newDepth > RECURSION_LIMIT`.
- **TTL**: Normal traces use 1-hour TTL; mission-critical contexts use 30-minute TTL
- **Error Handling**: Database failures return `-1` (sentinel) to distinguish from no-entry (`0`)

---

## Resilient Event Validation (Self-Healing)

To prevent infinite routing loops (especially during failure handling and DLQ routing), the `EventHandler` implements a **Self-Healing Context** strategy:

- **Logic**: If an incoming event is missing `sessionId` or `traceId`, the handler injects system-level defaults (`system-spine` for sessionId, and a generated trace for traceId) instead of rejecting the event.
- **Resiliency**: This ensures that even events with degraded metadata can be bridged to the appropriate handlers or secondary queues without triggering a "Validation -> DLQ -> Validation" failure loop.
- **Observability**: Every injection triggers a `logger.warn` signal, allowing operators to trace the source of "dirty" events without compromising system uptime.

---
- **DLQ_ROUTE Exception**: `DLQ_ROUTE` bypasses recursion increment and cannot be re-routed to DLQ again.

## Backbone Gap Management (April 2026)

To prevent signal loss and ensure high-fidelity telemetry, the system now implements specific handlers for previously unhandled "Backbone Gaps":

- **Reputation Updates**: `REPUTATION_UPDATE` events are processed by the `reputation-handler` to synchronize trust scores with the live dashboard.
- **Escalation Completion**: `ESCALATION_COMPLETED` events are handled to ensure clean closure of human-intervention loops.
- **Emergency Recovery Logs**: `RECOVERY_LOG` events are distilled and stored to provide agents with context about recent system rollbacks (Principle 1).

## Bus Lifecycle (Reserve-then-Commit)

```text
[Agent/Tool]
     |
     v
[emitEvent()]
     |
     +---> [Check Idempotency] --> DUPLICATE? --> [ Return ]
     |
     v
[EventBridge PutEvents]
     |
     +---> SUCCESS --> [ Commit Status ] --> [ Return ID ]
     |
     +---> FAILURE
              |
              +---> PERMANENT? --> [ Store in DLQ ]
              |
              +---> TRANSIENT? --> [ Retry Backoff ]
              |
              +---> UNKNOWN?   --> [ Retry -> DLQ ]
```

## Best Practices

1. **Use appropriate priorities**: User-facing events should be HIGH or CRITICAL.
2. **Include correlation IDs**: Link related events together with `correlationId`.
3. **Set idempotency keys**: Prevent duplicate processing for idempotent operations.
4. **Monitor the DLQ**: Failed events should be reviewed and retried or purged.
5. **Use convenience methods**: `emitCriticalEvent()`, `emitHighPriorityEvent()` for common cases.
