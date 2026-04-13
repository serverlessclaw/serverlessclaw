# Event Bus & Messaging Architecture

> **Navigation**: [← Index Hub](../../INDEX.md)

> **Agent Context Loading**: Load this file when you need to understand event routing, emit events, or troubleshoot messaging issues.

## Overview

Serverless Claw uses AWS EventBridge as the central nervous system for inter-agent communication. The `emitEvent` utility provides reliable event delivery with retry logic, idempotency, priority levels, and automatic Dead Letter Queue (DLQ) handling.

## Atomic Backbone & Flow Control

The Event Bus acts as the **Spine** of Serverless Claw, ensuring robust signal propagation and atomic control across the swarm.

### 1. Atomic Recursion Control
To prevent infinite reasoning loops or event storms, the Spine enforces strict depth limits using **Atomic Recursion Guards**:
- **Mechanism**: The `RECURSION_ENTRY` in DynamoDB tracks the current depth for a specific `traceId`.
- **Constraint**: Updates must use monotonic depth guards (`depth < :newDepth`) to prevent out-of-order event bypass.
- **Limit**: Standard tasks are capped at a depth of 10 unless explicitly promoted.

### 2. Agent Selection & Routing
The `AgentRouter` selects the best candidate from the `AgentRegistry` based on trust scores and capability matching.
- **Selection Guard**: `selectBestAgent` explicitly filters out agents with `enabled: false`.
- **Fallback**: If no high-trust agent is available, the backbone falls back to a deterministic supervisor for graceful degradation.

### 3. Distributed Lock Management
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

The system uses a **Reserve-then-Commit** atomic pattern to ensure that even under high concurrency, an event is only processed once. 

- **Storage**: Entries are stored in the `MemoryTable` with a numeric `timestamp: 0` Sort Key to ensure schema consistency across all distributed primitives.
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

## Event Flow

```
[Agent/Tool]
     |
     v
[emitEvent()]
     |
     +---> [Check Idempotency] --> DUPLICATE? --> Return
     |
     v
[EventBridge PutEvents]
     |
     +---> SUCCESS --> Return event ID
     |
     +---> FAILURE
              |
              +---> PERMANENT? --> Store in DLQ immediately
              |
              +---> TRANSIENT? --> Retry with backoff
              |
              +---> UNKNOWN?   --> Retry, then store in DLQ
```

### Event Schema Validation

All events must adhere to the base schema defined in `core/lib/schema/base.ts`.

- **Required Fields**: `traceId` is mandatory for all events to maintain the execution chain.
- **Session ID**: `sessionId` is required for user-interactive events but can be omitted or set to `'N/A'` for system-level background events (e.g., health reports).
- **Depth**: The `depth` field is automatically managed by the `Spine` to prevent recursion loops.
