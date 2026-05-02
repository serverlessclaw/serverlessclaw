# Recovery Path Architecture

This document describes the idempotent recovery mechanisms used in Serverless Claw to ensure "Exactly-once" or "Idempotent At-least-once" semantics during system failures.

## Recovery Flow Diagram

```mermaid
sequenceDiagram
    participant Agent as Agent (The Hand)
    participant Lock as LockManager
    participant Session as SessionStateManager (The Brain)
    participant Bus as AgentBus (The Spine)
    participant DLQ as Dead Letter Queue

    Note over Agent,DLQ: NORMAL EXECUTION
    Agent->>Lock: acquire()
    Agent->>Session: addPendingMessage(Task A)
    Note over Agent: Agent Crashes! 💥

    Note over Agent,DLQ: RECOVERY PATH
    Session->>Lock: check expired locks
    Session->>Lock: acquire()
    Session->>Session: releaseProcessing()
    Note right of Session: IDEMPOTENCY GUARD
    Session->>Bus: emitEvent(Task A, {idempotencyKey})
    Bus->>Bus: reserveIdempotencyKey()
    alt Key not exists
        Bus-->>Agent: New Execution Triggered
        Bus->>Bus: commitIdempotencyKey()
        Session->>Session: removePendingMessage(Task A)
    else Key exists (Duplicate)
        Bus-->>Session: DUPLICATE
        Session->>Session: removePendingMessage(Task A)
    end
```

## DLQ Retry Flow (Spine Resilience)

```mermaid
graph TD
    A[DLQ Entry] --> B{retryDlqEntry}
    B --> C[emitEvent with IdempotencyKey]
    C --> D{reserveIdempotencyKey}
    D -- New --> E[Commit & Emit]
    E --> F[Purge DLQ Entry]
    D -- Duplicate --> F
    C -- Failure --> G[Wait for next retry]
```

## Key Mechanisms

1.  **Deterministic Idempotency Keys**: Derived from unique message IDs (`resume:sessionId:msgId`) to ensure that even if metadata cleanup fails, the side effect (event emission) is only processed once.
2.  **Emit-then-Purge Strategy**: In the DLQ retry path, the event is emitted _before_ the DLQ entry is purged. Idempotency guards prevent duplicates, and the purge only happens upon confirmed success or confirmed duplication.
3.  **Fail-Closed Circuit Breakers**: Distributed state checks (`isCircuitOpen`, `consumeToken`) default to "Closed" (rejected) on system failures to prevent cascading instability.
