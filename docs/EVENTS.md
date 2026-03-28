# Event Bus & Messaging Architecture

> **Agent Context Loading**: Load this file when you need to understand event routing, emit events, or troubleshoot messaging issues.

## Overview

Serverless Claw uses AWS EventBridge as the central nervous system for inter-agent communication. The `emitEvent` utility provides reliable event delivery with retry logic, idempotency, priority levels, and automatic Dead Letter Queue (DLQ) handling.

## Event Priority System

Events are classified into four priority levels to ensure critical events are processed appropriately:

| Priority   | Use Case                                           | Retry Policy                       |
| ---------- | -------------------------------------------------- | ---------------------------------- |
| `CRITICAL` | System failures, health issues, deployment errors  | 5 retries with exponential backoff |
| `HIGH`     | User-facing messages, heartbeats, task completions | 3 retries with exponential backoff |
| `NORMAL`   | Standard agent-to-agent communication              | 3 retries (default)                |
| `LOW`      | Background tasks, telemetry, non-urgent updates    | 1 retry                            |

### Usage

```typescript
import { emitEvent, EventPriority } from '../lib/utils/bus';

// Standard emission (NORMAL priority)
await emitEvent('source', 'event.type', { data: 'value' });

// With explicit priority
await emitEvent('source', 'event.type', { data: 'value' }, {
  priority: EventPriority.HIGH
});

// Convenience methods for specific priorities
await emitCriticalEvent('system', 'critical.event', { issue: 'data' });
await emitHighPriorityEvent('agent', 'task.completed', { taskId: '123' });
await emitLowPriorityEvent('telemetry', 'metrics.update', { metrics: {...} });
```

## Idempotency (Reserve-then-Commit)

To prevent duplicate event processing even under high concurrency, the system uses a **Reserve-then-Commit** atomic pattern:

1.  **RESERVE**: `emitEvent` attempts an atomic `PutCommand` with `attribute_not_exists(userId)`.
2.  **EMIT**: If reservation succeeds, it calls EventBridge `PutEvents`.
3.  **COMMIT**: Upon success, it updates the record to `COMMITTED` status and attaches the `eventId`.

This ensures that if two agents try to emit the same task simultaneously, one will fail the reservation and the system will correctly return `DUPLICATE`.

```typescript
// Automatic idempotency based on source, type, sessionId, and traceId
await emitEventWithIdempotency('source', 'event.type', {
  sessionId: 'session-123',
  traceId: 'trace-456',
});
```

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

Failed events are automatically stored in the DLQ with metadata:

```typescript
{
  userId: "EVENTBUS#DLQ#<timestamp>#<random>",
  timestamp: 1711000000000,
  source: "source.name",
  detailType: "event.type",
  detail: "{\"key\":\"value\"}",
  retryCount: 3,
  maxRetries: 3,
  lastError: "Service unavailable",
  errorCategory: "TRANSIENT",
  priority: "HIGH",
  correlationId: "optional-correlation-id",
  createdAt: 1711000000000,
  expiresAt: 1711086400000
}
```

### DLQ Operations

```typescript
import { getDlqEntries, retryDlqEntry, purgeDlqEntry } from '../lib/utils/bus';

// Fetch DLQ entries (uses GSI TypeTimestampIndex for performance)
const entries = await getDlqEntries(50);

// Retry a specific entry (deletes original from DLQ on success)
const success = await retryDlqEntry(entries[0]);

// Purge an entry manually
await purgeDlqEntry(entries[0]);
```

## Event Types

Standard event types are defined in `core/lib/types/agent.ts`:

| Event Type               | Description                     | Priority          |
| ------------------------ | ------------------------------- | ----------------- |
| `OUTBOUND_MESSAGE`       | User-facing messages            | HIGH              |
| `SYSTEM_BUILD_SUCCESS`   | Successful deployment           | HIGH              |
| `SYSTEM_BUILD_FAILED`    | Failed deployment               | CRITICAL          |
| `SYSTEM_HEALTH_REPORT`   | Health issues                   | Based on severity |
| `HEARTBEAT_PROACTIVE`    | Scheduled task wake-up          | HIGH              |
| `CODER_TASK`             | Code modification request       | NORMAL            |
| `CLARIFICATION_REQUEST`  | Agent requesting user input     | HIGH              |
| `CLARIFICATION_TIMEOUT`  | Timeout for clarification       | HIGH              |
| `CONTINUATION_TASK`      | Task resumption signal          | HIGH              |
| `TASK_COMPLETED`         | Generic task success            | NORMAL            |
| `TASK_FAILED`            | Generic task failure            | HIGH              |
| `PARALLEL_TASK_DISPATCH` | Multi-task coordination         | NORMAL            |
| `PARALLEL_TASK_COMPLETED`| Aggregated parallel results     | HIGH              |
| `PARALLEL_BARRIER_TIMEOUT`| Timeout for parallel barrier    | HIGH              |
| `EVOLUTION_PLAN`         | Capability improvement proposal | NORMAL            |

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

## Best Practices

1. **Use appropriate priorities**: User-facing events should be HIGH or CRITICAL.
2. **Include correlation IDs**: Link related events together with `correlationId`.
3. **Set idempotency keys**: Prevent duplicate processing for idempotent operations.
4. **Monitor the DLQ**: Failed events should be reviewed and retried or purged.
5. **Use convenience methods**: `emitCriticalEvent()`, `emitHighPriorityEvent()` for common cases.
