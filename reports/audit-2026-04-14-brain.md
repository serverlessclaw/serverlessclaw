# Audit Report: Silo 4 (The Brain) - 2026-04-14

## 🎯 Objective

Investigate the Memory, Identity & Continuity vertical (Silo 4) to identify bugs, gaps, and inconsistencies. Focus on ensuring workspace isolation, reliable tiered retention, and reducing metabolic waste in DynamoDB access patterns.

## 🎯 Finding Type

- Bug / Security Gap / Reliability / Refactor

## 🔍 Investigation Path

- Started at: `core/lib/memory/workspace-operations.ts` and `core/lib/memory/base.ts`.
- Followed: Scoping logic in `base.ts` and session lifecycle in `session-operations.ts`.
- Observed: 
  - Weak scoping check in `getScopedUserId` could allow prefix spoofing.
  - `deleteConversation` relied on an extra query and inconsistent timestamp attributes.
  - `getHistory` in `CachedMemory` was vulnerable to thundering herd concurrent misses.
  - `WORKSPACE_INDEX` was an unbounded list in `ConfigTable`.

## 🚨 Findings

| ID  | Title | Type | Severity | Location | Recommended Action |
| :-- | :--- | :--- | :------- | :------- | :----------------- |
| 1 | **Workspace Prefix Spoofing** | Security | P1 | `core/lib/memory/base.ts` | **Fixed.** Updated `getScopedUserId` to validate and strip illegal prefix characters from base `userId`, ensuring robust logical isolation. |
| 2 | **Brittle Session Deletion** | Bug | P1 | `core/lib/memory/session-operations.ts` | **Fixed.** Simplified `deleteConversation` to derive the Sort Key (SK) directly from the `sessionId`. Eliminated redundant DynamoDB Query and attribute name confusion. |
| 3 | **Cache thundering Herd** | Reliability | P2 | `core/lib/memory/cached-memory.ts` | **Fixed.** Implemented a promise cache in `getHistory` to coalesce concurrent requests for the same user, reducing redundant DynamoDB reads. |
| 4 | **Unbounded Workspace Index** | Waste | P2 | `core/lib/memory/workspace-operations.ts` | **Remediated.** Added a safety limit of 1000 items to `WORKSPACE_INDEX`. (Architectural Refactor to use GSI recommended for future scale). |
| 5 | **Tiering Logic Complexity** | Refactor | P3 | `core/lib/memory/tiering.ts` | **Fixed.** Replaced nested `if/else` chains in `getExpiresAt` with a clean categorical mapping. |

## 💡 Architectural Reflections

The Brain vertical showed "state drift" in its schema evolution, with `timestamp` and `updatedAt` being used inconsistently as Sort Keys across different modules. The consolidation of `createMetadata` and `queryByTypeAndMap` Mapping logic restores consistency and aligns the system with Principle 1 (Stateless Core) and Principle 8 (Stable Contextual Addressing).

The implementation of `historyPromises` in `CachedMemory` provides an important layer of "Metabolic Efficiency," preventing the system from wasting cycles on redundant I/O during high-concurrency bursts.
