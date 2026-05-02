# Anti-Patterns & Recurring Issues

Based on audit findings and commit history patterns, this document tracks recurring issues to help auditors identify common problems early.

## Critical Anti-Patterns (Must Avoid)

### 1. Fail-Open Safety Checks (Rate Limits & Budgets)

**What**: Security/Safety checks that return `true` (allowed) or `false` (not-exceeded) on failure instead of failing closed.

**Pattern**:

```typescript
// ❌ WRONG (Budget)
try {
  const exceeded = await checkBudget();
  return exceeded;
} catch {
  return false; // Returns false even on DB failure!
}

// ✅ CORRECT
try {
  const exceeded = await checkBudget();
  return exceeded;
} catch (e) {
  logger.error('Check failed', e);
  return true; // Fail-closed: assume exceeded to prevent cost leak
}
```

**Occurrences**: 4+ times in 30 days (commits 1e8165f9, 0c25b53c, b6841dda, and recursion-tracker bug)

---

### 2. Race Condition in LockManager Release

**What**: Lock release without verifying current holder, allowing other processes to acquire.

**Pattern**:

```typescript
// ❌ WRONG
await lockManager.release(lockId);

// ✅ CORRECT
await lockManager.release(lockId, { expectedHolder: myHolderId });
```

**Occurrences**: 2 times (commits 672059b6, 3bd162d0)

---

### 3. Missing Enabled Check in Router

**What**: Selecting/routing to an agent without verifying `enabled === true`.

**Pattern**:

```typescript
// ❌ WRONG
const agent = agents.find((a) => a.id === selectedId);

// ✅ CORRECT
const agent = agents.find((a) => a.id === selectedId && a.enabled === true);
if (!agent?.enabled) throw new Error('Agent not enabled');
```

**Occurrences**: 2+ times in 30 days

---

### 4. Non-Atomic Recursion Depth Increment

**What**: Using `++` or `+= 1` instead of atomic increment for recursion depth tracking.

**Pattern**:

```typescript
// ❌ WRONG
const depth = await getRecursionDepth();
await setRecursionDepth(depth + 1);

// ✅ CORRECT
await incrementRecursionDepth(); // Uses if_not_exists + 1
```

**Occurrences**: 1 time (but critical)

---

### 5. Double Execution of Class C Actions

**What**: Executing action immediately AND scheduling for human review.

**Pattern**:

```typescript
// ❌ WRONG (Anti-Pattern)
const result = await evaluateAction(event);
await evolutionScheduler.scheduleAction(event); // Always schedules manually!
if (result.allowed) executeAction(); // Executes anyway, leading to double execution!

// ✅ CORRECT
const { allowed } = await evaluateAction(event);
if (allowed) {
  await executeAction(); // Only execute if allowed
}
// Note: SafetyEngine now internally calls scheduleAction() and guarantees allowed: false when approval is required.
```

**Occurrences**: 1 time (commit b6841dda)

---

## High Priority Patterns

### 6. Direct Object-Level Overwrites

**What**: Overwriting entire object instead of using field-level atomic updates.

**Pattern**:

```typescript
// ❌ WRONG
const agent = await getAgent(id);
agent.trustScore = newScore;
await agentRepo.put(agent);

// ✅ CORRECT
await atomicUpdateMapField(id, 'trustScore', newScore);
```

---

### 7. Missing Conditional Update

**What**: Using `Table.put()` or `Table.update()` without `conditionExpression`.

**Pattern**:

```typescript
// ❌ WRONG
await Table.update({ id, ...updates });

// ✅ CORRECT
await Table.update({
  id,
  ...updates,
  conditionExpression: 'attribute_exists(id)',
});
```

---

## Integration Anti-Patterns

### 8. Siloed Fixes

**What**: Fixing one silo without checking adjacent silos for regressions.

**When to Watch**:

- Fixing Spine? Check Brain and Eye
- Fixing Shield? Check Scales
- Fixing Hand? Check Shield

**Prevention**: Always run cross-silo tests after siloed changes.

---

### 9. Telemetry Blindness

**What**: Emitting events/metrics without verifying downstream processing or tenant isolation.

**Prevention**:

- Verify events reach intended handlers
- Check dashboard matches backend state
- Review TRACE entries after processing
- **Ensure all metrics carry `WorkspaceId` dimensions for multi-tenant observability.**

---

### 10. Adaptive Mode Failure

**What**: Autonomous agents using natural language (`text` mode) for peer communication.

**Pattern**:

```typescript
// ❌ WRONG
const stream = agent.stream(userId, task, { initiatorId: 'other-agent' }); // Defaults to 'text' mode

// ✅ CORRECT
const mode = options.initiatorId ? 'json' : 'text'; // Force JSON for agent-to-agent
const stream = agent.stream(userId, task, { communicationMode: mode });
```

---

### 11. Unauthorized Agent Invitation

**What**: drafting agents into collaborations without verifying `enabled === true`.

**Pattern**:

```typescript
// ❌ WRONG
participants.push({ id: agentId, type: 'agent' });

// ✅ CORRECT
const config = await registry.getAgentConfig(agentId);
if (config && config.enabled === false) throw new Error('Agent disabled');
participants.push({ id: agentId, type: 'agent' });
```

---

### 12. Millisecond Collision Overwrites

**What**: Missing `ConditionExpression` in log persistence (PutCommand) causing loss of concurrent audit records.

**Pattern**:

```typescript
// ❌ WRONG
await db.put({ userId, timestamp: now, ...entry }); // Second write at same MS overwrites first!

// ✅ CORRECT
await db.put({
  userId,
  timestamp: now + attempt, // Use attempt as micro-jitter
  ...entry,
  conditionExpression: 'attribute_not_exists(userId)',
});
```

---

### 13. Blind Tool Failures (Telemetry Gap)

**What**: Catching tool execution errors or security blocks without reporting them to the `TrustManager` (Scales).

**Pattern**:

```typescript
// ❌ WRONG
try {
  await tool.execute(args);
} catch (e) {
  messages.push({ role: 'tool', content: `FAILED: ${e.message}` });
  return { toolCallCount: 0 }; // Trust is never updated!
}

// ✅ CORRECT
try {
  await tool.execute(args);
} catch (e) {
  messages.push({ role: 'tool', content: `FAILED: ${e.message}` });
  await TrustManager.recordFailure(agentId, `Tool crash: ${e.message}`, 2);
  return { toolCallCount: 0 };
}
```

**Occurrences**: 2 critical paths (fixed in audit 2026-04-29)

---

### 14. Global Telemetry (Missing WorkspaceId)

**What**: Emitting metrics, traces, or DLQ entries without `WorkspaceId` dimensions or prefixes, leading to tenant data mixing or blindness in multi-tenant environments.

**Pattern**:

```typescript
// ❌ WRONG
emitMetrics([METRICS.dlqEvents(1)]); // Metric is global, no tenant filtering possible

// ✅ CORRECT
const scope = { workspaceId: event.workspaceId };
emitMetrics([METRICS.dlqEvents(1, scope)]); // Partitioned via dimension
```

**Occurrences**: Fixed 6+ instances across Spine, Brain, and Eye in audit round 2026-04-29.

---

### 15. Non-Atomic Clamping in Increments

**What**: Incrementing a value and then conditionally setting it to a min/max bound in a separate unconditional update.

**Risk**: Concurrent updates between the increment and the clamp will be lost.

**Pattern**:

```typescript
// ❌ WRONG
const newValue = current + delta;
if (newValue > max) {
  await db.update({ SET val = :max }); // Overwrites any concurrent changes!
}

// ✅ CORRECT
if (newValue > max) {
  await db.update({
    SET val = :max,
    ConditionExpression: 'val > :max' // Only overwrite if still out of bounds
  });
}
```

---

### 16. Non-Idempotent Maintenance Tasks

**What**: Background tasks (decay, pruning, cleanup) that lack idempotent guards, leading to double-execution in serverless environments or concurrent runs.

**Risk**: Double-penalization of trust scores, excessive culling of memory, or corrupted telemetry.

**Pattern**:

```typescript
// ❌ WRONG
async function decayTrust() {
  await atomicIncrement(score, -1); // Runs every time the cron triggers
}

// ✅ CORRECT
async function decayTrust() {
  await atomicUpdate({
    SET score = score - 1, lastDecayedAt = :today,
    Condition: 'lastDecayedAt <> :today'
  });
}
```

**Occurrences**: Fixed in TrustManager decay and Anomaly Calibration (Audit 2026-05-01).

---

### 17. Non-Idempotent Recovery Resumption

**What**: Resuming a chain of messages after a failure without using deterministic idempotency keys for the re-emitted events.

**Risk**: Double execution of tasks if the metadata cleanup fails or is delayed.

**Pattern**:

```typescript
// ❌ WRONG
await emitEvent('resume', 'task', { ...msg });
await removePendingMessage(msg.id); // If this fails, msg is emitted again on next recovery!

// ✅ CORRECT
const idempotencyKey = `resume:${sessionId}:${msg.id}`;
await emitEvent('resume', 'task', { ...msg }, { idempotencyKey });
await removePendingMessage(msg.id);
```

**Occurrences**: Fixed in `session-state.ts` (Audit 2026-05-02).

---

### 18. Purge-before-Emit (DLQ Retry Data Loss)

**What**: Purging an entry from a Dead Letter Queue before confirming successful emission of the retry event.

**Risk**: Permanent loss of event data if the process crashes or fails between the purge and the emission.

**Pattern**:

```typescript
// ❌ WRONG
await purgeDlqEntry(entry);
await emitEvent(entry.source, entry.detailType, entry.detail); // CRASH HERE = DATA LOST 💥

// ✅ CORRECT (Idempotent At-Least-Once)
await emitEvent(entry.source, entry.detailType, entry.detail, { idempotencyKey: entry.id });
await purgeDlqEntry(entry);
```

**Occurrences**: Fixed in `bus.ts` (Audit 2026-05-02).

---

### 19. In-Memory Multi-Tenant Filtering

**What**: Performing a global database query and then filtering results by `WorkspaceId` in application memory instead of using server-side filters (Partition Keys, Global Secondary Indexes, or FilterExpressions).

**Risk**: Multi-tenant data leakage if the filter is forgotten or bypassed. Performance degradation as the database returns irrelevant data that is then discarded.

**Pattern**:

```typescript
// ❌ WRONG
const items = await db.query({ KeyCondition: 'id = :id' });
return items.filter((i) => i.workspaceId === currentWs);

// ✅ CORRECT
return await db.query({
  KeyCondition: 'id = :id',
  FilterExpression: 'workspaceId = :ws',
  ExpressionAttributeValues: { ':id': id, ':ws': currentWs }
});
```

**Occurrences**: Fixed in `ClawTracer.getTrace` (Audit 2026-05-02).

## How to Use This Document

1. **During Code Review**: Check this document before submitting
2. **During Audit**: Search for these patterns in relevant code areas
3. **During Debugging**: These patterns often indicate root cause location

## Related Documents

- [AUDIT.md](./AUDIT.md) - Audit framework
- [PRINCIPLES.md](./PRINCIPLES.md) - Design principles
- [AUDIT-COVERAGE.md](./AUDIT-COVERAGE.md) - Audit coverage matrix
