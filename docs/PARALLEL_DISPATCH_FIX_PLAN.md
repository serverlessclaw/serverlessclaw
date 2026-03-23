# Parallel Dispatch Gap Fix Plan

## Problem Statement

The parallel dispatch system has fan-out and partial fan-in, but the aggregated completion signal (`PARALLEL_TASK_COMPLETED`) is dead — emitted but never handled. Individual task results wake up the initiator one-by-one, but there is no "all done, here's the synthesized summary" signal. Additionally, there are gaps in deduplication, duration tracking, fan-out failure recovery, and dead code.

## Critical Gaps

1. **`PARALLEL_TASK_COMPLETED` is a dead event** — No handler case in `events.ts` switch statement. The event falls through to `logger.warn('Unhandled event type')`.
2. **No result deduplication** — Same `taskId` can be appended twice via `list_append`, causing premature `isComplete=true`.
3. **No duration tracking** — `durationMs` and `elapsedMs` are hardcoded to `0`.
4. **Dead code** — `ParallelAggregator.updateProgress()` is never called. `new ParallelAggregator()` in barrier timeout handler is unused.
5. **Sequential fan-out with no recovery** — An `emitEvent()` failure mid-loop aborts fan-out, leaving tasks undispatched.
6. **Incomplete test coverage** — No tests for parallel aggregation path, no tests for `parallel-aggregator.ts` directly.

## Fixes

### Fix 1: `PARALLEL_TASK_COMPLETED` Handler (Critical)

**New file: `core/handlers/events/parallel-completion-handler.ts`**

- Receives the aggregated results event
- Builds structured summary: "N/N succeeded, M failed, K timed out"
- Calls `wakeupInitiator()` with full synthesized results via `CONTINUATION_TASK`

**Modified: `core/handlers/events.ts`**

- Add `case EventType.PARALLEL_TASK_COMPLETED` routing to the new handler

### Fix 2: Result Deduplication (Pre-Read)

**Modified: `core/handlers/events/task-result-handler.ts`**

- Before `aggregator.addResult()`, call `aggregator.getState()` and check if `taskId` already exists in `results`
- If duplicate, skip with warning log
- This costs one extra DynamoDB read per result but prevents duplicate counting

### Fix 3: Duration Tracking

**Modified: `core/handlers/events/task-result-handler.ts`**

- Pass actual `durationMs` instead of `0`: `Date.now() - (dispatchState?.createdAt ?? Date.now())`
- Pass actual `elapsedMs` in `PARALLEL_TASK_COMPLETED` event (computed from `createdAt`)

### Fix 4: Fan-Out Failure Recovery

**Modified: `core/handlers/events/parallel-handler.ts`**

- Wrap each `emitEvent()` in try/catch
- On failure: log warning, immediately call `aggregator.addResult()` with `status: 'failed'`
- Continue dispatching remaining tasks

### Fix 5: Clean Up Dead Code

**Modified: `core/lib/agent/parallel-aggregator.ts`**

- Remove `updateProgress()` method (never called)

**Modified: `core/handlers/events/parallel-barrier-timeout-handler.ts`**

- Remove dead `new ParallelAggregator()` instance on line 16
- Pass actual `elapsedMs` from `createdAt` instead of approximate value

### Fix 6: Test Coverage

**New: `core/handlers/events/parallel-completion-handler.test.ts`**

- Wakes up initiator with synthesized summary
- Handles success/partial/failed overall status
- Handles empty results edge case

**Update: `core/handlers/events/task-result-handler.test.ts`**

- Test parallel aggregation code path (lines 77-113)
- Test `isComplete=true` emits `PARALLEL_TASK_COMPLETED`
- Test duplicate result deduplication

**Update: `core/handlers/events_parallel_dispatch.test.ts`**

- Test fan-out failure recovery with immediate fail recording
- Test duration tracking (actual elapsedMs instead of 0)

## File Summary

| File                                                       | Action                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `core/handlers/events/parallel-completion-handler.ts`      | NEW — synthesize aggregated results, wake up initiator |
| `core/handlers/events.ts`                                  | +`PARALLEL_TASK_COMPLETED` case                        |
| `core/handlers/events/task-result-handler.ts`              | Dedup pre-read + duration tracking                     |
| `core/handlers/events/parallel-handler.ts`                 | Try/catch per emit + immediate fail record             |
| `core/lib/agent/parallel-aggregator.ts`                    | Remove dead `updateProgress()`                         |
| `core/handlers/events/parallel-barrier-timeout-handler.ts` | Remove dead code + actual elapsedMs                    |
| `core/handlers/events/parallel-completion-handler.test.ts` | NEW — completion handler tests                         |
| `core/handlers/events/task-result-handler.test.ts`         | UPDATE — parallel aggregation + dedup tests            |
| `core/handlers/events_parallel_dispatch.test.ts`           | UPDATE — fan-out recovery + duration tests             |

## Implementation Order

1. Fix 5: Clean up dead code (no functional change, safe first)
2. Fix 2: Result deduplication in task-result-handler
3. Fix 3: Duration tracking in task-result-handler
4. Fix 1: Create parallel-completion-handler + add case to events.ts
5. Fix 4: Fan-out failure recovery in parallel-handler
6. Fix 6: Tests for all of the above
