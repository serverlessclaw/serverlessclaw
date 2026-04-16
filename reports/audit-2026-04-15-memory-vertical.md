# Audit Report: Memory Vertical Deep-Dive - 2026-04-15

## 🎯 Objective

Deep-dive audit of **Silo 4: The Brain** (Memory vertical) to identify bugs, gaps, inconsistencies, and refactoring opportunities. Clean up and prevent overengineering while simplifying the codebase where possible.

## 🎯 Finding Type

- Bug (Functional Failures)
- Gap (Missing Functionality)
- Inconsistency (State Drift)
- Refactor (Technical Debt)

## 🔍 Investigation Path

- **Started at**: `core/lib/memory/dynamo-memory.ts` (facade)
- **Followed**: Down through operation modules (gap-operations, insight-operations, session-operations, utils)
- **Tested**: All 438 memory tests passing
- **Cross-Silo**: Verified Brain integration with Hand, Spine, Eye

## 🚨 Findings

### P1 - Critical Issues (Fix Immediately)

| ID  | Title | Type | Location | Description |
|-----|-------|------|----------|-------------|
| M-1 | `atomicUpdateMetadata` silently swallows errors | Bug | `utils.ts:254-257` | The catch block logs but doesn't re-throw, making callers think update succeeded when it may have failed |

### P2 - Important Issues (Plan for Sprint)

| ID  | Title | Type | Location | Description |
|-----|-------|------|----------|-------------|
| M-2 | Duplicate workspace scoping patterns | Refactor | `gap-operations.ts`, `insight-operations.ts`, `session-operations.ts` | Each file reimplements `base.getScopedUserId()` with slight variations. Should be centralized. |
| M-3 | `getGapIdPK` collides on compound IDs | Bug | `utils.ts:99-104` | Function extracts only numeric suffix, losing semantic context. E.g., `GAP#SEC-123` becomes `GAP#123` |
| M-4 | Inefficient dual-path lookup in `resolveItemById` | Refactor | `utils.ts:120-191` | Always tries GSI fallback even when direct lookup succeeds, adding unnecessary latency |
| M-5 | Inconsistent error handling in gap lock operations | Inconsistency | `gap-operations.ts:397` | `releaseGapLock` catches and swallows errors silently while other operations throw |

### P3 - Observations (Track for Future)

| ID  | Title | Type | Location | Description |
|-----|-------|------|----------|-------------|
| M-6 | No index on `expiresAt` field | Gap | `base.ts` | Archive/cull operations require full table scans |
| M-7 | Hardcoded magic value in timestamp parsing | Refactor | `utils.ts:241` | `1577836800000` (2020-01-01) should be a constant |
| M-8 | `findSimilarMemory` uses naive Jaccard similarity | Refactor | `insight-operations.ts:28-71` | Keyword-based matching could be improved with embeddings later |

## 🔗 Cross-Silo Issues

### Brain ↔ Hand (The Hand creates memories)
- **Issue**: `researcher.ts:149` calls `memory.addMemory()` but doesn't check workspace isolation before storing
- **Status**: Partially mitigated by `getScopedUserId` in BaseMemoryProvider

### Brain ↔ Eye (The Eye observes memories)
- **Issue**: `cognitive-metrics.ts:925` creates new DynamoMemory instance per metric emission
- **Impact**: Wasted connections, no caching benefit

### Brain ↔ Spine (Events trigger memory)
- **Status**: ✅ Well integrated via event bus

## 💡 Architectural Reflections

### What's Working Well
1. **Centralized Resolution**: `resolveItemById` in `utils.ts` is the authoritative resolver (audited and stabilized)
2. **Atomic Updates**: Field-level atomic updates via `atomicUpdateMetadata` prevent race conditions
3. **Workspace Isolation**: `getScopedUserId` properly scopes all PKs with `WS#workspaceId#` prefix
4. **Test Coverage**: 438 tests with good coverage of critical paths

### Technical Debt
1. **Duplicate PK/SK derivation logic** scattered across operations files
2. **No TTL index** forces full scans for archive/cull operations
3. **Inconsistent error handling** - some operations throw, others silently fail

### Recommended Consolidation
1. Move all PK/SK derivation to `utils.ts` - create `derivePK()` and `deriveSK()` generics
2. Create `ArchiveManager` class to handle all TTL-based cleanup with proper indexes
3. Standardize error handling - either all throw or all return Result types

## ✅ Verification

- **Static**: `make check` - Linting/Types pass
- **Dynamic**: `pnpm exec vitest run core/lib/memory` - **438 tests pass**
- **Observational**: Code review complete

## 📋 Recommended Action Plan

| Priority | Action | Owner |
|----------|--------|-------|
| P1 | Fix `atomicUpdateMetadata` to re-throw after logging | Code Review |
| P2 | Centralize workspace scoping patterns | Refactor Sprint |
| P2 | Fix `getGapIdPK` collision logic | Bug Fix |
| P3 | Add index on `expiresAt` for archive optimization | Future |
| P3 | Replace magic timestamp with constant | Cleanup |

---

*Audit completed 2026-04-15 | Silo 4: The Brain | Status: OPERATIONAL with technical debt*