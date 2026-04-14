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
                 |
                 v
7. P0 Reliability: Drain Pending Queue
   (Re-emit next pending message as Event)
```

## Crash Recovery

If an agent crashes during processing:

1. The Lambda terminates.
2. The processing flag is never explicitly released.
3. However, the lock has a **5-minute lock TTL** (`lockExpiresAt`).
4. Next message for the session will check `lockExpiresAt < now` and find the lock has expired.
5. A new agent starts and picks up any pending messages.
6. The entire session state record persists for **30 days** (`expiresAt`) unless a new message is received.

## 🔄 Queue Draining Mechanism

To resolve the "Silent Data Loss" risk for busy sessions, the `SessionStateManager.releaseProcessing` method implements an automatic **Queue Draining** logic:

1. **Lock Release**: The current agent releases the session lock.
2. **Pending Check**: The system checks if any messages are in the `pendingMessages` array.
3. **Next Task Re-emission**: If messages exist, the system takes the _first_ message and re-emits it as a `dynamic_<agent>_task` event.
4. **Continuation**: The message is removed from the queue, and the event system triggers the next agent to process this message.

This ensures that concurrent requests are not just stored, but are eventually executed in a first-in-first-out (FIFO) manner once the session becomes available.

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

## ⚙️ Agent Configuration Atomicity

Traditional configuration management risks "Last Write Wins" race conditions where one agent's update (e.g., a trust score penalty) is overwritten by another's simultaneous change (e.g., a success bump).

Serverless Claw enforces atomicity through **Field-Level `UpdateItem` Operations**:

### Implementation Pattern

Instead of reading a full `IAgentConfig` object, modifying it locally, and saving it back, the system uses the **`atomicUpdateAgentField`** pattern:

```typescript
// core/lib/registry/AgentRegistry.ts
static async atomicUpdateAgentField(agentId: string, field: string, value: any) {
  // Uses DynamoDB UpdateCommand with a SET expression targeting the AGENTS_CONFIG map
  // Key: agents_config, UpdateExpression: "SET #config.#agent.#field = :val"
}
```

For operations requiring read-modify-write semantics (like TrustScore updates), the system uses **`atomicUpdateAgentFieldWithCondition`** which adds a conditional expression:

```typescript
// Ensures update only succeeds if current value matches expected
static async atomicUpdateAgentFieldWithCondition(
  id: string,
  field: string,
  value: unknown,
  expectedCurrentValue: unknown
): Promise<void> {
  // ConditionExpression: "attribute_not_exists(#val.#id.#field) OR #val.#id.#field = :expected"
}
```

### Benefits

- **No Conflict Resolution Needed**: Concurrent updates to different agents, or even different fields of the same agent, are handled natively by DynamoDB.
- **Improved Performance**: Smaller payload sizes (only the field/value being updated) reduce throughput consumption and latency.
- **Consistent Trust History**: Ensures that every `TrustScore` modification is accurately recorded even during high-frequency maintenance cycles (e.g., Trust Decay).
- **Race Condition Prevention**: The conditional update pattern prevents lost updates when multiple processes read the same value simultaneously.

## 🪢 Cross-Session Recursion Safety

In a distributed swarm, preventing infinite loops requires more than a local counter. Serverless Claw uses an atomic **Recursion Tracker** to enforce safety across long-lived trace chains:

- **Atomic Increments**: Depth is updated via DynamoDB `UpdateItem` with `SET #depth = if_not_exists(#depth, :zero) + :one`. This ensures a single monotonic counter across all concurrent branches of a swarm. (See [recursion-tracker.ts](../../core/lib/recursion-tracker.ts))
- **Fail-Fast**: Any agent found at a depth exceeding `backbone.maxIterations` must immediately emit a `TASK_FAILED` event with `LOOP_TERMINATION` reason.

## 🔓 Relaxed Lock Cleanup

To maintain environment hygiene without risking race conditions, the system follows a **Relaxed Release** pattern in the `LockManager`:

- **Ownership Check**: Before release, the lock state is checked to verify ownership and expiry status.
- **Expired Lock Cleanup**: An owner can release even if the lock has expired (allows cleanup of stale locks after crashes).
- **Condition**: Release uses `attribute_exists(ownerId) OR attribute_not_exists(ownerId)` to handle both active and expired states.

> **Note**: The condition was updated from strict `ownerId = :owner` to allow cleanup of naturally expired locks that may have been cleared by DynamoDB TTL.

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
