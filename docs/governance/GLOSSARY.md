# Serverless Claw Governance Glossary

Definitions of core concepts, metrics, and protocols used in the self-evolving governance framework.

## Core Metrics

| Term                 | Definition                                                                                                                                                       | Primary Code Location                   |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| **TrustScore**       | A dynamic metric (0-100) representing the reliability and safety record of an agent or the system as a whole. High scores enable greater autonomy (`AUTO` mode). | `core/lib/safety/safety-engine.ts`      |
| **Cognitive Health** | A measure of reasoning coherence, memory usage efficiency, and anomaly detection during multi-turn agent sessions.                                               | `core/lib/metrics/cognitive-metrics.ts` |
| **Trust Decay**      | The rate at which `TrustScore` decreases following a failure or violation, ensuring that autonomy must be continuously earned.                                   | `core/lib/safety/safety-engine.ts`      |

## System Protocols

| Term                          | Definition                                                                                                                                                  | Primary Code Location                   |
| :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| **LLM-as-a-Judge**            | A semantic evaluation protocol where a high-capability LLM acts as a judge to verify task success or security compliance against natural language criteria. | `core/lib/verify/judge.ts`              |
| **Proactive Trunk Evolution** | The autonomous process where high-trust agents implement, verify, and sync changes directly to the main production branch without manual intervention.      | `core/agents/strategic-planner.ts`      |
| **Dead Man's Switch**         | An emergency safety protocol that triggers automated rollbacks if system-wide health probes fail or if a "Class C" violation occurs.                        | `core/lib/backbone.ts` (RECOVERY agent) |
| **Tiered Retention**          | A memory strategy that moves context between "Hot" (DynamoDB), "Warm" (Semantic Vector), and "Cold" (S3) storage based on access frequency and age.         | `core/lib/memory/`                      |

## Evolutionary Stages

| Term                    | Definition                                                                                                                      | Responsible Agent |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :---------------- |
| **Pre-Flight Ready**    | The state where a proposed change has passed all local tests and safety guardrails but has not yet been synced to the trunk.    | Coder             |
| **Strategic Tie-break** | The final decision-making process used by the Facilitator to resolve conflicting instructions when autonomy thresholds are met. | Facilitator       |
| **Atomic Sync**         | The non-interruptible process of committing verified code and metadata updates to the repository state in a single transaction. | QA Auditor        |

---

> [!NOTE]
> This glossary is a living document. Updates are managed by the **Cognition Reflector** to ensure documentation remains aligned with evolving implementation.
