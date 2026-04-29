# System Integrity Architecture

This document describes the integrity and atomicity mechanisms implemented to ensure monotonic progress and multi-tenant isolation in Serverless Claw.

## 1. Atomic State Transitions (Silo 5)

We use DynamoDB `ConditionExpression` to prevent "Last Write Wins" race conditions during trace initialization and metric recording.

```ascii
   Agent                Tracer                DynamoDB
     |                    |                      |
     |-- initialize(id) ->|                      |
     |                    |-- PutItem (Summary) -|
     |                    |   w/ Condition       |
     |                    |                      |
     |                    |<-- Success (OK) -----|
     |<-- Initialized ----|                      |
     |                    |                      |
     |                    |OR (Conflict Case)    |
     |                    |                      |
     |                    |<-- ConditionCheckFailed
     |<-- Error (Conflict)|                      |
```

## 1b. Collaboration Index Jitter (Perspective C)

To prevent overwrites when multiple collaborations share a participant at the same millisecond, the system uses a jittered retry loop.

```ascii
  Identity Service        DynamoDB (Collab Index)
         |                        |
         |-- Put (T=now) -------->|
         |    w/ attribute_not_exists(userId)
         |                        |
         |<-- Conflict (409) -----|
         |                        |
         |-- Put (T=now+1) ------>|
         |                        |
         |<-- Success (200) ------|
         |                        |
```

## 2. Multi-Tenant Budget Enforcement (Shield)

Token usage and recursion depth are tracked with strict `workspaceId` dimensioning to prevent cross-tenant budget leakage.

```ascii
+-------------------------------------------------------------+
| TokenBudgetEnforcer (Shield Layer)                          |
+-------------------------------------------------------------+
|                                                             |
|  [ Event ] --> [ recordUsage(workspaceId) ]                 |
|                       |                                     |
|                       v                                     |
|           +-----------------------+                         |
|           | DynamoDB (Tenanted)   |                         |
|           | PK: WS#<id>#SESSION#<id>|                       |
|           +-----------------------+                         |
|                       |                                     |
|                       v                                     |
|           [ checkBudget() ] --> ( ALLOW / DENY )            |
|                                                             |
+-------------------------------------------------------------+
```

## 3. Regenerative Metabolism (Silo 7)

Autonomous repairs ensure the system prunes its own technical debt and stale infrastructure.

| Repair Target | Mechanism                   | Trigger                        |
| ------------- | --------------------------- | ------------------------------ |
| S3 Staging    | `pruneStagingBucket`        | `STAGING_RETENTION_DAYS` (30d) |
| Agent Tools   | `pruneLowUtilizationTools`  | Atomic Utilization Audit       |
| Memory Gaps   | `cullResolvedGaps`          | Resolution Event               |
| Dashboard     | `remediateDashboardFailure` | Real-time Exception Handler    |

## 4. Recovery Path (Shield -> Spine -> Brain)

The "Dead Man's Switch" provides a guaranteed fallback when high-level agents fail.

```ascii
[ Failure Detected ]
       |
       v
[ dashboard-failure-handler ] --(Success)--> [ REPAIRED ]
       |
       +--(Complex)--> [ EvolutionScheduler ] --> [ HITL Remediation ]
       |
       +--(Critical)--> [ Dead Man's Switch ] --> [ Emergency Rollback ]
```
