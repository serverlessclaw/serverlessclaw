# Serverless Claw Governance Glossary

Definitions of core concepts, metrics, and protocols used in the self-evolving governance framework.

## Core Metrics

| Term                 | Definition                                                                                                                                                                                            | Primary Code Location                   |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| **TrustScore**       | A dynamic metric (0-100) representing the reliability and safety record of an agent. It is punitively updated by QA failures/SLO breaches and rewarded by successes. Scores >= 95 enable `AUTO` mode. | `core/lib/safety/trust-manager.ts`      |
| **Cognitive Health** | A measure of reasoning coherence, memory usage efficiency, and anomaly detection during multi-turn agent sessions.                                                                                    | `core/lib/metrics/cognitive-metrics.ts` |
| **Trust Decay**      | The automatic time-based reduction of `TrustScore` (e.g., -0.5/day), ensuring that high-level autonomy must be continuously earned through sustained reliability.                                     | `core/lib/safety/trust-manager.ts`      |

## System Protocols

| Term                          | Definition                                                                                                                                                            | Primary Code Location                   |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------- |
| **LLM-as-a-Judge**            | A semantic evaluation protocol where a high-capability LLM acts as a judge to verify task success or security compliance against natural language criteria.           | `core/lib/verify/judge.ts`              |
| **Proactive Trunk Evolution** | The autonomous process where high-trust agents implement, verify, and sync changes directly to the main production branch without manual intervention.                | `core/agents/strategic-planner.ts`      |
| **Dead Man's Switch**         | An emergency safety protocol that triggers automated rollbacks if system-wide health probes fail or if a "Class C" violation occurs.                                  | `core/lib/backbone.ts` (RECOVERY agent) |
| **Tiered Retention**          | A memory strategy using DynamoDB with LRU cache. TTLs: CONVERSATION(30d), SESSIONS(90d), LESSONS(90d), GAPS(60d), FACTS(365d). Semantic Vector is a future milestone. | `core/lib/memory/`                      |

## Evolutionary Stages

| Term                    | Definition                                                                                                                      | Responsible Agent |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :---------------- |
| **Pre-Flight Ready**    | The state where a proposed change has passed all local tests and safety guardrails but has not yet been synced to the trunk.    | Coder             |
| **Strategic Tie-break** | The final decision-making process used by the Facilitator to resolve conflicting instructions when autonomy thresholds are met. | Facilitator       |
| **Atomic Sync**         | The non-interruptible process of committing verified code and metadata updates to the repository state in a single transaction. | QA Auditor        |

---

> [!NOTE]
> This glossary is a living document. Updates are managed by the **Cognition Reflector** to ensure documentation remains aligned with evolving implementation.
