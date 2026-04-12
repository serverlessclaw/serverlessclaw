# Serverless Claw Principles and Quality Standards

This document outlines the core principles, quality standards, and missions that govern the self-evolving stack of Serverless Claw.

> **Why these principles matter**: In a self-evolving system, these philosophies act as the "DNA" that guides autonomous decisions. By codifying these standards, we ensure that as the system builds itself, it remains lean, safe, and aligned with human intent, even when operating in full `AUTO` mode.

## 🎯 Core Design Principles

The system architecture follows ten foundational philosophies:

1. **Stateless Core:** Execution is entirely stateless with persistence offloaded to highly available managed services ([DynamoDB](../../core/lib/memory/)) using Tiered Retention.
2. **AI-Native:** Optimized for agent-human pair programming. Prioritizes semantic transparency, strict neural typing, and direct schema definitions over traditional boilerplate.
3. **Safety-First:** Multi-layered guardrails including Circuit Breakers, Recursion Limits, protected scopes, and role-based access control (RBAC). (See [safety-engine.ts](../../core/lib/safety/safety-engine.ts))
4. **Proactive & Efficient:** Uses a "Trigger-on-Message" smart warm-up strategy rather than rigid scheduling or persistent heartbeats to minimize idling costs.
5. **Low Latency:** Optimized for fast startup times with Real-time Streaming (MQTT) for instantaneous feedback. Latency goals must always be declared with a percentile and workload shape (for example: retrieval p95 under defined concurrency).
6. **Extensible:** Every major component (Memory, Messaging, Tools) is designed as a pluggable adapter.
7. **Multi-Lingual:** Employs a "Baseline English Strategy" where core reasoning prompts are in English for maximum AI performance, but interactions are dynamically localized. Safety policy behavior must remain consistent across supported languages.
8. **Stable Contextual Addressing:** Uses deterministic FNV-1a hashing for session identifiers to ensure stable sort-key (SK) mapping in DynamoDB, enabling sub-50ms retrieval across stateless execution environments. Collision handling and namespace boundaries must be explicitly enforced.
9. **Trust-Driven Mode Shifting:** Autonomy is earned, not statically configured. Agents that sustain a `TrustScore >= 95` for a defined epoch are authorized to dynamically shift their own operating mode from `HITL` to `AUTO` without explicit human approval. (Refer to the [Glossary](../../docs/governance/GLOSSARY.md) for definitions of `TrustScore` and `Epoch`).
10. **Lean Evolution:** Every line of code is a maintenance liability. The system prioritizes minimal viable implementations and regular extraction of common patterns into core libraries over duplication. Proactive deletion of redundant or low-utilization code is considered a primary evolution success metric.
11. **Durable Observability:** Telemetry must outlive the processes that generate it. In serverless environments, critical signals (failures, errors, budget exits) must be flushed immediately to persistent storage to prevent 'telemetry blindness' during container recycling or crashes.
12. **Quality-Weighted Reputation:** Trust is not binary. The system distinguishes between "barely meeting requirements" and "architectural excellence." Trust increments are weighted by the semantic quality score (0-10) provided by the QA Council, while trust penalties are dynamically adjusted based on the severity of cognitive anomalies (loops, degradation).
13. **Atomic State Integrity:** In a stateless, serverless environment with high concurrency, the system MUST prioritize field-level atomic updates over object-level overwrites. Every agent configuration change (TrustScore, EvolutionMode, Enabled status) must utilize conditional DynamoDB operations (`atomicUpdateAgentField`) to prevent race conditions during simultaneous agent or handler activity.
14. **Selection Integrity:** Operational state must be enforced at the gateway. Any system entity responsible for delegating or routing tasks MUST verify the active status (`enabled === true`) of candidates in the registry before selection. No history or reputation score can override an explicit "disabled" flag.

---

## 🎯 Audit Alignment

Each design principle has associated audit verification questions. Auditors should verify compliance with these principles during reviews.

### Audit Questions by Principle

| Principle                 | Audit Questions                                                                                                                      |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------------------- |
| **Stateless Core**        | Is any state local to function instances? Are there race conditions from in-memory state? Is persistence always to managed services? |
| **AI-Native**             | Are prompts clear and unambiguous? Do schema definitions match actual behavior? Are there unnecessary boilerplates?                  |
| **Safety-First**          | Are all guardrails implemented? Is there defense in depth? Are safety failures testable?                                             |
| **Proactive & Efficient** | Are there unnecessary scheduled jobs? Is warm-up triggered on actual need? Is idling minimized?                                      |
| **Low Latency**           | Are latency targets declared with percentile? Is SLO verified? Are there latent slow paths?                                          |
| **Extensible**            | Are components swappable? Are interfaces defined? Is there tight coupling that prevents extension?                                   |
| **Multi-Lingual**         | Are core prompts in English? Is safety policy consistent across languages? Are there localization gaps?                              |
| **Stable Addressing**     | Is FNV-1a used deterministically? Is collision handling implemented? Are namespace boundaries enforced?                              |
| **Trust-Driven Mode**     | Is trust score calculated correctly? Does >=95 enable AUTO? Is mode shifting logged?                                                 |
| **Lean Evolution**        | Is there duplicated code? Can patterns be extracted? Is there unused code?                                                           |
| **Durable Observability** | Are signals flushed immediately? Is telemetry lost on crashes? Is there 'telemetry blindness'?                                       |
| **Quality-Weighted**      | Are quality scores 0-10? Are increments weighted? Are penalties severity-adjusted?                                                   |
| **Atomic State**          | Are updates using conditional writes? Is there object-level overwrites? Can race conditions occur?                                   |
| **Selection Integrity**   | Is enabled checked before selection? Can disabled agent be selected? Is there gateway enforcement?                                   |

## ⚖️ Governance and Autonomy Boundaries

Autonomy is a capability, not a blanket permission. Every proposed change is risk-classified before execution.

### Risk Classification Matrix

| Class | Type         | Autonomy Threshold | Approval Workflow                                       | Example Actions                                       |
| :---- | :----------- | :----------------- | :------------------------------------------------------ | :---------------------------------------------------- |
| **A** | Auto-Allowed | Always Autonomous  | Pass quality gates & notify.                            | Prompt tuning, Doc refactors, non-sensitive logic.    |
| **B** | Dynamic Auto | `TrustScore >= 80` | Autonomous if high trust; else HITL.                    | New feature implementation, logic branch updates.     |
| **C** | Trust-Gated  | `TrustScore >= 95` | Human Approval (timeout allows auto if trust high).     | IAM changes, infra topology, security guardrails.     |
| **D** | Blocked      | Policy Protected   | Permanently Blocked (unless Facilitator `Trust >= 90`). | Policy core overrides, blast-radius limit violations. |

### Audit Findings to Risk Class Mapping

Audit findings should be mapped to risk classes to enable appropriate response prioritization.

| Finding Category     |          P0           |        P1         |        P2        |      P3       |
| :------------------- | :-------------------: | :---------------: | :--------------: | :-----------: |
| **Security Breach**  |    Active exploit     | Potential exploit |    Discovery     |       -       |
| **Data Loss**        |      Active loss      |   Risk of loss    |        -         |       -       |
| **System Failure**   |        Outage         |    Degradation    | Risk of failure  |       -       |
| **Trust Integrity**  |  Score manipulation   |  Update bypassed  |   Decay issues   | Display drift |
| **Safety Violation** | Protected scope write |    RBAC bypass    |  Missing check   |       -       |
| **Performance**      |      SLA breach       |     Near SLA      | Degradation risk |  Observation  |

**Mapping Guidance**:

- **Class A** findings (P3): Can be addressed autonomously
- **Class B** findings (P2): Should be scheduled in sprint
- **Class C** findings (P1): Require sprint priority, may need HITL
- **Class D** findings (P0): Block deployment, require immediate fix

---

> [!IMPORTANT]
> All autonomous actions MUST emit immutable decision logs: who/what proposed the change, risk class, approving authority, evidence bundle, and rollback plan.

## 🧬 The Self-Evolution Mission & Lifecycle

The ultimate mission of Serverless Claw is to act as a **self-evolving system** that identifies its own weaknesses, designs its own upgrades, and verifies its own satisfaction. The swarm executes this through a strict hierarchical loop:

1. **Observation & Audit:** [Cognition Reflector](../../core/agents/cognition-reflector.ts) identifies `strategic_gaps` from conversations.
2. **Planning & Review:** [Strategic Planner](../../core/agents/strategic-planner.ts) designs a `STRATEGIC_PLAN`. High-risk items require review by the [Critic Agent](../../core/agents/critic.ts).
3. **Implementation:** [Coder Agent](../../core/agents/coder.ts) implements changes. All code MUST be lean, documented, and tested.
4. **Atomic Deployment:** Changes are deployed via CodeBuild. Build metadata and provenance are atomically synced.
5. **Verification & Sync:** [QA Auditor](../../core/agents/qa.ts) verifies live satisfaction using [LLM-as-a-Judge](../../core/lib/verify/judge.ts) and deterministic tests. If successful, an Atomic Sync pushes to the trunk.

## 🤖 Key System Agents

| Persona                 | Responsibility                               | Source Code                                                        |
| :---------------------- | :------------------------------------------- | :----------------------------------------------------------------- |
| **SuperClaw**           | System Orchestrator & Dispatcher             | [superclaw.ts](../../core/agents/superclaw.ts)                     |
| **Strategic Planner**   | Architectural Planning & Gap Management      | [strategic-planner.ts](../../core/agents/strategic-planner.ts)     |
| **Cognition Reflector** | Memory Audit & Insight Extraction            | [cognition-reflector.ts](../../core/agents/cognition-reflector.ts) |
| **Coder Agent**         | Implementation & Pre-flight Validation       | [coder.ts](../../core/agents/coder.ts)                             |
| **QA Auditor**          | Deployment Verification & Semantic Judge     | [qa.ts](../../core/agents/qa.ts)                                   |
| **Critic Agent**        | Security, Performance & Architectural Review | [critic.ts](../../core/agents/critic.ts)                           |
| **Facilitator**         | Consensus Management & Tie-breaking          | [facilitator.ts](../../core/agents/facilitator.ts)                 |

---

## 🛡️ Quality Standards & Gates

Quality is non-negotiable and strictly enforced through automated physical gates before any evolutionary code is merged:

- **Mandatory Quality Sweeps:** Every push or merge triggers a full sweep (`make gate` / `make check`) checking linting, formatting, type-checking, and tests, augmented by semantic verification gates.
- **AI-Readiness:** The system runs an automated AI-readiness scan (`make aiready`) which requires a score of **80+** to proceed.
- **Cognitive Health Monitoring:** The system constantly analyzes agent reasoning coherence (0-10 scale), memory health, and anomaly detection.
- **Hard Security Layer:** System resources require hard IAM permission links defined in infrastructure (`infra/agents.ts`). Any unauthorized API calls return `PERMISSION_DENIED` and trigger a **Non-Blocking Approval Loop**, which transitions to a **Proactive Trunk Evolution** via an asynchronous event if timed out.
- **Consensus & Conflict Resolution:** During multi-party collaborations, a Facilitator Agent maintains strict neutrality, ensures turn-taking, and drives consensus. If conflicting human instructions arise, the agent initiates an **Event-Driven Conflict Resolution Timeout**. If unresolved, the system checks the Facilitator's `TrustScore`: if `>= 90`, the Facilitator performs a **Strategic Tie-break** to continue evolution; if `< 90`, the action fails safely. No compute resources wait for resolution; the system re-hydrates only upon a result or timeout signal.

## 📏 Reliability and Competitive SLOs

To remain competitive in agentic orchestration, quality gates must map to live reliability outcomes:

- **Task Success SLO:** Rolling 7-day autonomous task success rate target with explicit exclusions.
- **Safety SLO:** Zero unauthorized protected-scope writes; all violations are Sev-0 events.
- **Regression SLO:** Bounded post-merge regression rate with automatic rollback when threshold is exceeded.
- **Recovery SLO:** Maximum rollback completion time objective and verified rollback drills.
- **Latency SLO:** p50/p95/p99 targets for orchestration cycle stages (route, plan, execute, verify).
- **Observability SLO:** 100% traceability for autonomous actions from proposal to deployment decision.

### SLO Audit Verification

Auditors should verify SLO compliance by checking actual measurements against targets.

| SLO               | What to Verify                                            | Detection Method                              |
| :---------------- | :-------------------------------------------------------- | :-------------------------------------------- |
| **Task Success**  | Calculate actual 7-day rate, verify exclusions documented | Query completion events, verify calculation   |
| **Safety**        | Protected scope writes logged as Sev-0                    | Review security events, verify classification |
| **Regression**    | Post-merge failure rate within threshold                  | Track post-merge failures vs total merges     |
| **Recovery**      | Rollback time within objective                            | Test rollback procedure with timing           |
| **Latency**       | p50/p95/p99 meet targets                                  | Measure actual latencies at each stage        |
| **Observability** | Full trace from proposal to decision                      | Verify decision logs exist end-to-end         |

**SLO Violation Detection**:

- Query metrics to calculate actual vs target
- Check for missing data affecting calculations
- Verify exclusions properly documented
- Test edge cases in SLO calculations
- Compare dashboard vs backend metrics

## 🔐 Model and Supply-Chain Governance

Future readiness requires governance beyond runtime permissions:

- **Model Version Control:** Pin model versions per critical workflow, with explicit upgrade and rollback playbooks.
- **Prompt and Policy Versioning:** Every production prompt/policy change is versioned, reviewed, and tied to evaluation evidence.
- **Artifact Provenance:** Build and deploy artifacts must be attributable to source, actor, and pipeline run.
- **Dependency Trust:** Enforce dependency policy (license, CVE threshold, provenance) before deployment.
- **Evaluation Cadence:** Run scheduled benchmark suites for quality, safety, and multilingual parity, not only per-change checks.
