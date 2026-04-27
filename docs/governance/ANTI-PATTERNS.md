# Anti-Patterns & Recurring Issues

Based on audit findings and commit history patterns, this document tracks recurring issues to help auditors identify common problems early.

## Critical Anti-Patterns (Must Avoid)

### 1. Fail-Open Rate Limiting

**What**: Rate limiting that returns `true` on DynamoDB failure instead of failing closed.

**Pattern**:

```typescript
// ❌ WRONG
const result = await rateLimit.consume(key);
return result; // Returns true even on DB failure!

// ✅ CORRECT
const result = await rateLimit.consume(key);
if (!result) return false; // Fail-closed
return true;
```

**Occurrences**: 3+ times in 30 days (commits 1e8165f9, 0c25b53c, b6841dda)

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

## How to Use This Document

1. **During Code Review**: Check this document before submitting
2. **During Audit**: Search for these patterns in relevant code areas
3. **During Debugging**: These patterns often indicate root cause location

## Related Documents

- [AUDIT.md](./AUDIT.md) - Audit framework
- [PRINCIPLES.md](./PRINCIPLES.md) - Design principles
- [AUDIT-COVERAGE.md](./AUDIT-COVERAGE.md) - Audit coverage matrix
