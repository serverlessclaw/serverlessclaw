# Audit Report: The Brain (Memory, Identity & Continuity) - 2026-04-15

## Objective

Deep-dive audit of Silo 4 (The Brain) to identify bugs, gaps, inconsistencies, and refactor opportunities in the memory subsystem.

---

## 🔍 Findings Summary

| ID | Title | Type | Severity | Status |
|:--|:------|:-----|:---------|:-------|
| 1 | TTL Threshold Mismatch in cullResolvedGaps | Inconsistency | **P1** | ✅ Fixed |
| 2 | Non-atomic reputation update creates race condition | Bug | **P1** | ✅ Fixed |
| 3 | Cache key regex injection vulnerability | Bug | P3 | ✅ Fixed |
| 4 | Missing workspace isolation in global queries | Gap | **P2** | ✅ Fixed |
| 5 | Reputation score computed on read, not write | Inconsistency | **P2** | ✅ Fixed |

---

## 🚨 Findings Detail

### Finding 1: TTL Threshold Mismatch in cullResolvedGaps

**Type**: Inconsistency  
**Severity**: P1  
**Location**: `core/lib/memory/gap-operations.ts:133`

**Description**:
The `cullResolvedGaps()` function uses a default threshold of 90 days (line 133), but the system's configured `GAPS_RETENTION_DAYS` is 60 days (per `config-defaults.ts:455`). This creates an inconsistency where gaps may live 30 days longer than the configured retention policy before being culled.

**Evidence**:
```typescript
// gap-operations.ts:131-136
export async function cullResolvedGaps(
  base: BaseMemoryProvider,
  thresholdDays: number = 90,  // <-- 90 days hardcoded default
  workspaceId?: string
): Promise<number>
```

```typescript
// config-defaults.ts:453-459
GAPS_RETENTION_DAYS: {
  code: 60,
  hotSwappable: true,
  configKey: 'gaps_retention_days',
  description: 'Days to retain strategic gaps beforeTTL expiry.',
}
```

**Impact**:
- Resolved gaps persist 30 days longer than intended
- Contradicts Principle 10 (Lean Evolution: 90-day gap retention)
- Wastes storage and violates documented retention policy

**Recommended Action**:
Change the default threshold in `cullResolvedGaps` to read from `RETENTION.GAPS_DAYS` instead of hardcoding 90:
```typescript
thresholdDays: number = RETENTION.GAPS_DAYS
```

---

### Finding 2: Non-atomic Reputation Update (Race Condition)

**Type**: Bug  
**Severity**: P1  
**Location**: `core/lib/memory/reputation-operations.ts:85-151`

**Description**:
The `updateReputation()` function performs a non-atomic read-modify-write pattern that violates Principle 13 (Atomic State Integrity). It executes TWO separate DynamoDB operations:
1. First update creates/initializes the record (lines 97-123)
2. Then reads back the data to compute derived values (line 126)
3. Then performs a SECOND update with computed values (lines 135-142)

Between operations 1 and 3, another process could modify the reputation, causing lost updates.

**Evidence**:
```typescript
// reputation-operations.ts:94-151
// First update - creates record
await base.updateItem({ ... }); // lines 97-123

// Read back to compute derived values
const existing = await getReputation(base, agentId); // line 126

// SECOND update - computed values
await base.updateItem({ ... }); // lines 135-142
```

**Impact**:
- Race condition: concurrent reputation updates can lose data
- Violates Principle 13: "MUST prioritize field-level atomic updates over object-level overwrites"
- Success rate and avg latency are computed on read, not atomically

**Recommended Action**:
Use a single atomic update with `if_not_exists` to compute derived values inline, or use DynamoDB's mathematical operations:
```typescript
// Single atomic update with computed values inline
UpdateExpression: `
  SET successRate = (tasksCompleted + :zero) / NULLIF(tasksCompleted + tasksFailed + :zero, 0),
      avgLatencyMs = if_not_exists(avgLatencyMs, :zero)
`
```

---

### Finding 3: Cache Key Regex Injection

**Type**: Bug  
**Severity**: P3  
**Location**: `core/lib/memory/cache.ts:120`

**Description**:
The `invalidateUser()` function constructs a regex from userId without escaping special characters. If a userId contains regex metacharacters (e.g., `user+test` or `user*123`), the regex will behave unexpectedly, potentially failing to invalidate correct keys or matching unintended keys.

**Evidence**:
```typescript
// cache.ts:118-121
invalidateUser(userId: string): number {
  // Matches keys where userId is at the start or follows a colon
  return this.invalidatePattern(new RegExp(`(^|:)${userId}(:|$)`));
}
```

**Impact**:
- Cache invalidation may fail for userIds with special characters
- Potential unintended key matching
- Low severity as userIds are typically UUIDs with safe characters

**Recommended Action**:
Escape regex special characters:
```typescript
invalidateUser(userId: string): number {
  const escapedUserId = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return this.invalidatePattern(new RegExp(`(^|:)${escapedUserId}(:|$)`));
}
```

---

### Finding 4: Missing Workspace Isolation in Global GSI Queries

**Type**: Gap  
**Severity**: P2  
**Location**: `core/lib/memory/utils.ts:203-212`

**Description**:
When `queryByTypeAndGetContent` is called without a `userId` (global queries), the `workspaceId` filter is only applied if provided. However, some callers may omit workspaceId for "global" data like system lessons, which may inadvertently include workspace-scoped data.

**Evidence**:
```typescript
// utils.ts:177-216
export async function queryByTypeAndGetContent(
  base: BaseMemoryProvider,
  type: string,
  limit: number = 10,
  userId?: string,
  workspaceId?: string  // <-- Optional, not enforced for global queries
): Promise<string[]> {
  // ...
  if (userId) {
    // Uses UserInsightIndex with scoped userId
  } else {
    // Uses TypeTimestampIndex GSI
    if (workspaceId) {
      params.FilterExpression = 'workspaceId = :workspaceId';
    }
    // If workspaceId not provided, returns ALL workspace data!
  }
}
```

**Impact**:
- Global queries (no userId) may leak cross-workspace data if workspaceId is not explicitly provided
- Inconsistent behavior between scoped and global queries

**Recommended Action**:
Add validation or documentation that global queries require explicit workspaceId for tenant isolation:
```typescript
if (!userId && !workspaceId) {
  throw new Error('Global queries require workspaceId for tenant isolation');
}
```

---

### Finding 5: Reputation Derived Values Computed on Read

**Type**: Inconsistency  
**Severity**: P2  
**Location**: `core/lib/memory/reputation-operations.ts:126-142`

**Description**:
The `successRate` and `avgLatencyMs` are computed in the second update pass, not atomically. This means a reader between the two updates may see stale values. Also, the computation logic is duplicated in `computeReputationScore()` (lines 180-194), creating inconsistency between stored values and computed scores.

**Evidence**:
```typescript
// reputation-operations.ts:129-132
const total = existing.tasksCompleted + existing.tasksFailed;
const successRate = total > 0 ? existing.tasksCompleted / total : 0;
const avgLatencyMs =
  existing.tasksCompleted > 0 ? existing.totalLatencyMs / existing.tasksCompleted : 0;

// Later in computeReputationScore() - duplicate logic
const successComponent = reputation.successRate;  // reads stored value
```

**Impact**:
- Derived values may lag behind actual state
- Duplicate computation logic creates maintenance burden
- Potential for divergence between stored and computed values

**Recommended Action**:
Consolidate into single atomic update as mentioned in Finding 2, or compute inline using DynamoDB expression functions.

---

## 💡 Architectural Reflections

### Positive Observations
1. **Workspace Isolation**: The `getScopedUserId()` in base.ts:60-71 properly scopes userIds with `WS#` prefix
2. **Pinned Session TTL**: session-operations.ts:137 correctly enforces 365-day max for pinned sessions
3. **Gap Transition Guards**: gap-operations.ts:368-386 properly validates state transitions atomically

### Technical Debt
1. **Duplicate pattern in gap-operations**: Multiple fallback search patterns (lines 388-409) suggest unstable key derivation
2. **Test coverage**: Workspace isolation tests exist but don't cover edge cases like malformed workspaceIds
3. **Cache eviction logging**: Too verbose at DEBUG level (cache.ts:194), should be at TRACE

### Recommendations
1. **High Priority**: Fix Finding 1 and 2 as they violate core principles
2. **Medium Priority**: Add input validation for Finding 4
3. **Low Priority**: Fix regex escaping in Finding 3 for robustness

---

## Verification Methods Used

1. **Code Analysis**: Traced through 35+ files in memory subsystem
2. **Config Reconciliation**: Compared constants vs config-defaults.ts
3. **Pattern Detection**: Searched for non-atomic update patterns
4. **Cross-reference**: Verified workspaceId propagation through call chains

---

*Audit completed: 2026-04-15*
*Auditor: Kilo (Silo 4 Deep Dive)*