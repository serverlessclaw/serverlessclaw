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

````ascii
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

### 2c. Isolated S3 Staging Pipeline (Shield)

To prevent data leakage and race conditions during parallel coder tasks, the system partitions S3 staging objects using `traceId`.

```ascii
[ Coder Agent 1 ] --(patch)--> [ stageChanges ] --(Upload: staged_T1.zip)--> [ S3 Staging ]
                                                                                  |
[ Coder Agent 2 ] --(patch)--> [ stageChanges ] --(Upload: staged_T2.zip)--> [ S3 Staging ]
                                                                                  |
                                                                                  v
[ Merger Handler ] <---(Fetch: staged_T1.zip, staged_T2.zip)---------------- [ S3 Staging ]
       |
       |-- (Merge & Apply Patches)
       |
       +--(Upload Merged)--> [ S3 Staging: staged_trace-abc.zip ]
                                       |
                                       v
[ Deployment Tool ] <---(staged_trace-abc.zip)--- [ CodeBuild ]
```

### 2b. Class C Blast Radius Isolation (Shield)

To prevent cross-tenant limit sharing, the `BlastRadiusStore` uses workspace-prefixed partition keys for sensitive action frequency tracking.

```ascii
[ Class C Action ] --(agentId, action, workspaceId)--> [ BlastRadiusStore ]
                                                            |
                                                            v
                                                   +-------------------------+
                                                   | DynamoDB (MemoryTable)  |
                                                   | PK: WS#<id>#SAFETY#BLAST#<agentId>:<action> |
                                                   +-------------------------+
                                                            |
                                                            v
                                                   [ Count < 5/hour? ] --> ( ALLOW / BLOCK )
````

````

## 3. Regenerative Metabolism (Silo 7)

Autonomous repairs ensure the system prunes its own technical debt and stale infrastructure.

| Repair Target | Mechanism                   | Trigger                        |
| ------------- | --------------------------- | ------------------------------ |
| S3 Staging    | `pruneStagingBucket`        | `STAGING_RETENTION_DAYS` (30d) |
| Agent Tools   | `pruneLowUtilizationTools`  | Atomic Utilization Audit       |
| Memory Gaps   | `cullResolvedGaps`          | Resolution Event               |
| Dashboard     | `remediateDashboardFailure` | Real-time Exception Handler    |
| DLQ Recovery  | `getDlqEntries`             | System Maintenance / Retry     |

### 3b. Atomic Multi-Tenant Isolation (AP-19 Remediation)

To ensure strict isolation during background maintenance, all query-based retrieval (such as DLQ scanning) MUST use server-side `FilterExpression`. In-memory multi-tenant filtering is prohibited as it creates a potential for data leakage if the filter is bypassed.

```ascii
[ Metabolism ] -> [ getDlqEntries(workspaceId) ]
                        |
                        v
                [ Query (TypeTimestampIndex) ]
                [ FilterExpression: workspaceId = :ws ]
````

## 4. Recovery Path (Shield -> Spine -> Brain)

Detailed documentation of the idempotent resumption and DLQ retry logic can be found in [RECOVERY-PATH.md](./RECOVERY-PATH.md).

The system uses a tiered fallback mechanism ("Dead Man's Switch") to handle failures at different layers:

```ascii
[ Failure Detected ]
       |
       v
[ health-handler ] --(Success)--> [ REPAIRED ]
       |
       +--(Complex)--> [ EvolutionScheduler ] --> [ HITL Remediation ]
       |
       +--(Critical)--> [ Dead Man's Switch ] --> [ Emergency Rollback ]
```

## 5. Modular Configuration Hierarchy (Silo 5)

To maintain AI context integrity and modularity, `ConfigManager` is implemented via a multi-level inheritance chain.

```ascii
+-----------------------------+
|      ConfigManager Base     | (CRUD, Caching, Scoping)
+--------------+--------------+
               |
               v
+--------------+--------------+
|      ConfigManager List     | (Atomic List Appends/Removals)
+--------------+--------------+
               |
               v
+--------------+--------------+
|   ConfigManager Map Atomic  | (Atomic Numeric Increments)
+--------------+--------------+
               |
               v
+--------------+--------------+
| ConfigManager Map Colls     | (Collections within Map Entities)
+--------------+--------------+
               |
               v
+--------------+--------------+
|      ConfigManager Map      | (Basic Entity Operations)
+--------------+--------------+
               |
               v
+--------------+--------------+
|       ConfigManager         | (Agent Overrides & Entry Point)
+-----------------------------+
```
