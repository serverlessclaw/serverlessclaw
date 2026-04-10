# Concurrency & Session Management

> **Navigation**: [← Index Hub](../../INDEX.md)

In a serverless, stateless environment, maintaining session integrity requires a different approach than traditional locking. Serverless Claw uses a **Message Queue with Context Injection** pattern instead of mutex locks.

## Core Philosophy

**No Message Loss**: Every user message is immediately recorded to DynamoDB. No message is ever dropped.

**Soft Coordination**: Instead of blocking concurrent requests with locks, we use a lightweight processing flag with a short lock TTL. This allows the system to gracefully handle concurrent requests without losing data.

**Natural Context**: When a user sends messages while an agent is processing, those messages are injected into the agent's context as natural conversation turns, creating a seamless experience.

## Architecture

```text
User Msg A -> Webhook -> Set Processing Flag -> [Agent Processing...]
User Msg B -> Webhook -> Flag Set? -> Queue Message -> Return 200 OK
                                                    |
                                                    v (at next iteration)
                                          Agent Injects Queued Messages
                                          -> Continues Processing
```

## Key Components

### 1. Session State (DynamoDB)

Every session has a state record in the `MemoryTable`:

```
Key: SESSION_STATE#<chatId>
Value: {
  sessionId: "12345",
  processingAgentId: "Lambda-abc123",
  processingStartedAt: 1711000000000,
  pendingMessages: [
    { id: "pending_...", content: "Hello", timestamp: 1711000001000 },
    { id: "pending_...", content: "Also...", timestamp: 1711000002000 }
  ],
  lastMessageAt: 1711000002000,
  lockExpiresAt: 1711000300000,  // Short TTL for lock timeout
  expiresAt: 1713592000000       // Long TTL (30 days) for session persistence
}
```

### 2. SessionStateManager

The `SessionStateManager` class manages session coordination using atomic DynamoDB operations:

```typescript
// core/lib/session-state.ts
export class SessionStateManager {
  // Uses UpdateCommand + ConditionExpression to set flag ONLY if not held OR expired.
  // CRITICAL: preserves existing 'pendingMessages' during acquisition.
  acquireProcessing(sessionId, agentId);

  releaseProcessing(sessionId); // Clears processing flag
  renewProcessing(sessionId, agentId); // Extends lock TTL during long tasks
  addPendingMessage(sessionId, content); // Queue a message
  getPendingMessages(sessionId); // Get all pending messages

  // Uses a retry loop with ConditionExpression to safely clear messages
  // without losing messages arriving during the clear operation.
  clearPendingMessages(sessionId, processedIds);

  removePendingMessage(sessionId, messageId); // Remove specific message (UI)
  updatePendingMessage(sessionId, messageId, newContent); // Edit message (UI)
}
```

### 3. Context Injection in AgentExecutor

At each iteration, the executor checks for pending messages and injects them:

```typescript
// At start of each iteration:
const pending = await sessionStateManager.getPendingMessages(sessionId);
// Filter out messages already seen or in initial history
const newMessages = pending.filter((m) => m.timestamp > lastInjectedTimestamp);

if (newMessages.length > 0) {
  // Inject as natural user messages
  const content = newMessages.map((m) => `[Queued]: ${m.content}`).join('\n\n');
  messages.push({ role: 'user', content });

  // Collect attachments
  attachments.push(...newMessages.flatMap((m) => m.attachments || []));

  // Clear ONLY the messages we just injected
  await sessionStateManager.clearPendingMessages(
    sessionId,
    newMessages.map((m) => m.id)
  );

  // Renew processing flag
  await sessionStateManager.renewProcessing(sessionId, agentId);
}
```

## 🔒 Distributed Locking

To prevent multiple agents from simultaneously modifying the same session history (which leads to corrupted context), the system implements a **Distributed Session Lock** via the `LockManager`.

- **Mechanism**: Before processing a session or sensitive resource, an agent or handler attempts to acquire a lock via `LockManager.acquire(lockId, { ownerId: agentId })`.
- **Stateless Consistency**: Uses DynamoDB's conditional updates (`attribute_not_exists` or `expiresAt < now`) to ensure mutually exclusive access across multiple Lambda invocations.
- **Automatic Release**: Locks are explicitly released in a `finally` block or naturally expire via TTL (crash recovery).
- **Session Queuing**: If a session lock is busy, new incoming messages are durably queued in `pendingMessages` (see [Session State](#1-session-state-dynamodb)) for subsequent processing.

### Lock Heartbeat Mechanism

To prevent session "dead zones" caused by crashed or timed-out Lambda processes, the system uses a **Heartbeat-enabled Leasing** model:

- **Dynamic Renewal**: While an agent is processing, a background heartbeat periodically (every 60s) renews the session lock in DynamoDB.
- **Crash Recovery**: If an execution environment fails, the heartbeat stops, and the lock naturally expires within 5 minutes, allowing recovery handlers to take over.

## Webhook Flow

```text
1. Message arrives -> Always add to conversation history (DynamoDB)
                 |
                 v
2. Check processing flag via SessionStateManager
                 |
     +-----------+-----------+
     |                       |
  Flag not set           Flag set
     |                       |
     v                       v
3. Set flag            4. Add to pending queue
   (Lambda Request ID)      |
     |                       |
     v                       v
5. Process normally    5. Return 200 "Message queued"
                 |
                 v
6. Release flag (in finally block)
```

## Crash Recovery

If an agent crashes during processing:

1. The Lambda terminates.
2. The processing flag is never explicitly released.
3. However, the lock has a **5-minute lock TTL** (`lockExpiresAt`).
4. Next message for the session will check `lockExpiresAt < now` and find the lock has expired.
5. A new agent starts and picks up any pending messages.
6. The entire session state record persists for **30 days** (`expiresAt`) unless a new message is received.

## UI Integration (ClawCenter Dashboard)

The dashboard can show pending messages with edit/remove capabilities:

### API Endpoints

1. **GET /api/pending-messages?sessionId=...**
2. **DELETE /api/pending-messages** (body: `{ sessionId, messageId }`)
3. **PATCH /api/pending-messages** (body: `{ sessionId, messageId, content }`)

## Parallel Dispatch & Barrier Sync

For complex tasks, the system supports parallel multi-agent execution with atomic aggregation.

### State Management

Parallel tasks use a specialized aggregator record in `MemoryTable`:

```text
Key: USER#<id> | PARALLEL#<traceId>
Value: {
  status: "pending" | "success" | "partial" | "failed" | "timeout",
  taskCount: 5,
  completedCount: 3,
  results: [...],
  results_ids: ["taskId1", "taskId2", ...], // Atomic set to prevent duplicates
  taskMapping: [...],
  barrierTimeoutAt: 1711000000000
}
```

### Race Condition Prevention

To prevent double-emission of completion events between the **Result Handler** and the **Barrier Timeout Handler**, the system uses an atomic `markAsCompleted` operation:

```typescript
// core/lib/agent/parallel-aggregator.ts
async markAsCompleted(userId, traceId, status) {
  // Uses DynamoDB ConditionExpression to ensure status transitions
  // ONLY from 'pending' to a final state.
  // Returns true if this caller performed the transition.
}
```

### Aggregation Flow

1. **Dispatch**: Initiator emits `PARALLEL_TASK_DISPATCH` and schedules a `PARALLEL_BARRIER_TIMEOUT` one-shot event.
2. **Execution**: Multiple agents process tasks independently.
3. **Completion**: As agents finish, `task-result-handler` adds results via `addResult`.
4. **Synchronization**:
   - If `completedCount == taskCount`: The Result Handler calls `markAsCompleted`. If successful, it emits `PARALLEL_TASK_COMPLETED`.
   - If `BARRIER_TIMEOUT` fires: The Timeout Handler calls `markAsCompleted`. If successful, it emits `PARALLEL_TASK_COMPLETED` with partial results.

This ensures that regardless of network latency or Lambda execution timing, exactly **one** completion event is ever emitted for a parallel dispatch.

## Shared Collaboration Session Concurrency

The **Multi-Party Collaboration** system uses a shared conversation key (`shared#collab#<collaborationId>`) to enable multiple agents to participate in a single session.

### Write Concurrency

Since multiple agents may attempt to write to the same session simultaneously, the system uses **Atomic Records** and **Conditional Writes** in DynamoDB to ensure data integrity:

- **Atomic Records**: Every message is stored as a separate DynamoDB item with a unique timestamp as the sort key. This prevents "clobbering" of messages even if two agents write at the exact same millisecond.
- **Participant Registry**: The `Collaboration` metadata record is protected via conditional updates (`attribute_not_exists` or `version` checks), ensuring that participant management and status changes are thread-safe.
- **Turn-Taking**: While the storage is concurrent-safe, agents follow a turn-taking pattern guided by the `Owner` of the session to prevent infinite loops and ensure high-signal coordination.

## Comparison: Lock vs Queue vs Parallel

| Parameter                 | Default         | Description                       |
| ------------------------- | --------------- | --------------------------------- |
| `LOCK_TTL_SECONDS`        | 300 (5 min)     | Lock timeout for crash recovery   |
| `SESSION_TTL_SECONDS`     | 2,592,000 (30d) | Persistent state TTL              |
| Pending message retention | Until processed | Messages don't expire prematurely |

## Benefits

1. **No Message Loss**: Every user message is preserved.
2. **Better UX**: Agent naturally responds to multiple messages.
3. **Resilient**: Automatic recovery from crashes while maintaining state.
4. **Observable**: Dashboard can show queued state.
5. **Flexible**: UI can edit/remove queued messages before processing.
