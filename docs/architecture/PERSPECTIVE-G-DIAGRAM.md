# Perspective F & G: The Regenerative Metabolism & Isolation Loop

This diagram visualizes the interaction between the **Metabolism (Silo 7)**, **Scales (Silo 6)**, and **Shield (Silo 3)** during autonomous self-healing, reputation calibration, and multi-tenant isolation.

```text
                        Perspective F (Metabolic Loop) & G (Isolation)
                        ==============================================

       [ Silo 5: The Eye ]
               |
        (1) Anomaly Detected (Failures/Trace Errors)
               |
               v
       [ Silo 6: The Scales ] <----------------------------------+
               |                                                 |
        (2) Trust Penalty/Success                                |
               |                                                 |
               v                                                 |
       [ Silo 3: The Shield ]                                    |
               |                                                 |
        (3) Mandatory Scoping Check (Perspective G Hardening)    |
               | (Must have workspaceId for SYSTEM identity)     |
               |                                                 |
               v                                                 |
       [ Silo 2: The Hand ]                                      |
               |                                                 |
        (4) Tool Execution (Deferred Trace Collection)           |
               |                                                 |
               v                                                 |
       [ Silo 7: The Metabolism ] <--- (MetabolismService Consolidated)
               |
        (5) Autonomous Repairs (Regenerative Metabolism)
               |-- Prune Stale Overrides (WS Scoped)
               |-- Cull Memory Bloat (WS Scoped)
               |-- Atomic DLQ Recovery (FilterExpression Scoped)
               |-- Feature Flag Pruning (WS Scoped)
               |-- Reclaim S3 Staging (WS Prefix Scoped)
               |-- Trust-Based Mode Shifting (AUTO/HITL)
               |-- Orphan Trace Cleanup (Status Index Scoped)
```

## Key Mechanisms

1.  **Perspective G: Mandatory SYSTEM Scoping**: All autonomous repairs (Silo 7) and reputation updates (Silo 6) must be anchored to a `workspaceId`. Unscoped background tasks are rejected by the Shield to prevent cross-tenant elevation.
2.  **Perspective F: Atomic Regenerative Repairs**: Repairs utilize DynamoDB `ConditionExpression` and `FilterExpression` to ensure that maintenance tasks are idempotent and isolated. The `MetabolismService` centralizes these repairs to prevent logic drift in maintenance handlers.
3.  **Metabolic hygiene**: S3 staging reclamation and tool pruning are monitored; failures trigger P1 audit findings to notify the Eye and the Scales of hygiene blind spots.
4.  **Trust-Based Shift**: High-trust agents are promoted to `AUTO` mode via atomic conditional updates, while low-trust agents are mitigated via registry disabling, closing the metabolic loop.
