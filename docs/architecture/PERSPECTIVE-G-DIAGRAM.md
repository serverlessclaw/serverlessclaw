# Perspective G: The Regenerative Metabolism Loop

This diagram visualizes the interaction between the **Metabolism (Silo 7)**, **Scales (Silo 6)**, and **Shield (Silo 3)** during autonomous self-healing and reputation calibration.

```text
                                Perspective G: Regenerative Loop
                                ===============================

       [ Silo 5: The Eye ]
               |
        (1) Anomaly Detected
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
       [ Silo 7: The Metabolism ] -------------------------------+
               |
        (5) Autonomous Repairs (Regeneration)
               |-- Prune Stale Overrides
               |-- Cull Memory Bloat
               |-- Reclaim S3 Staging (P1 Finding if fails)
               |-- Trust-Based Mode Shifting (AUTO/HITL)
```

## Key Mechanisms in Perspective G

1.  **Mandatory SYSTEM Scoping**: All autonomous repairs (Silo 7) and reputation updates (Silo 6) must be anchored to a `workspaceId`. Unscoped background tasks are rejected by the Shield to prevent cross-tenant elevation.
2.  **Deferred Trace Batching**: During parallel tool execution, traces are collected locally and flushed in atomic batches to Silo 5, reducing IOPS and database contention.
3.  **Metabolic hygiene**: S3 staging reclamation and tool pruning are monitored; failures trigger P1 audit findings to notify the Eye and the Scales of hygiene blind spots.
4.  **Trust-Based Shift**: High-trust agents are promoted to `AUTO` mode, while low-trust agents are mitigated via registry disabling, closing the metabolic loop.
