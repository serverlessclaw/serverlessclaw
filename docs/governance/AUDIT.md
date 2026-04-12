# System Audit & Exploration: A Silo-Based Perspective

> **For Agents**: This is a **thinking framework**, not a checklist. Do not treat silos as tasks to "complete." Each silo is a lens — choose an angle, go deep, follow interesting threads, and report what you find. Creativity and lateral thinking are expected. If a silo leads you to an unexpected weakness in another area, pursue it. The cross-silo perspectives exist precisely because the most interesting failures live at the boundaries.

## Table of Contents

- [Finding Type Taxonomy](#finding-type-taxonomy)
- [How to Use This Document](#how-to-use-this-document)
- [Audit Angle Selection](#audit-angle-selection)
- [Severity Guide](#severity-guide)
- [🏗️ Deep-Dive Silos](#-deep-dive-silos)
- [🔗 Cross-Silo Perspectives](#-cross-silo-perspectives)
- [🛠️ Verification Strategy](#-verification-strategy)
- [📝 Documenting Your Findings](#-documenting-your-findings)
- [📖 Glossary](../../docs/governance/GLOSSARY.md)

This document establishes a framework for auditing **Serverless Claw** through focused "Silos" and "Cross-Silo Perspectives." Unlike a traditional phased checklist, this approach encourages creative, deep-dive explorations that prioritize architectural spirit, resilience, and evolution over simple file-based verification.

---

## Finding Type Taxonomy

Every audit finding falls into one of four categories. Classifying findings correctly ensures appropriate prioritization and response.

### 🐛 Bugs (Functional Failures)

**Definition**: Something that works incorrectly, produces wrong results, or fails to meet documented behavior.

**Characteristics**:

- Functions that produce incorrect output
- Error handling that silently fails or produces misleading errors
- Race conditions that cause data corruption
- Missing validation that allows invalid state
- Logic errors that produce opposite behavior

**Examples**:

- Authentication bypass due to missing scope validation
- Sort order reversed in memory retrieval
- Lock not released on timeout causing deadlock
- Exception swallowed hiding real error

**Audit Approach**: Compare actual behavior against documented requirements. Trace code paths through happy and error cases.

### � gaps (Missing Functionality)

**Definition**: Something that should exist but doesn't—intentional or unintentional omissions that limit system capability.

**Characteristics**:

- Missing error handling for expected conditions
- Features described in docs but not implemented
- Edge cases with no handling strategy
- Missing logging for critical operations
- Incomplete feature flags

**Examples**:

- No retry logic for transient failures
- Missing rate limiting on new endpoints
- No TTL on growing data structures
- Unhandled webhook event types

**Audit Approach**: Review expected behavior from docs, user requests, and system requirements. Compare against actual implementation.

### ⚡ Inconsistencies (State Drift)

**Definition**: Contradictions between components, expected vs actual behavior, or drifted state that should be synchronized.

**Characteristics**:

- Configuration not applied uniformly
- Metrics that don't add up
- Cache vs database state divergence
- UI displaying different data than backend
- Duplicate or conflicting logic in multiple places

**Examples**:

- Trust score calculation differs from display
- Backend returns different response than API contract
- Cached stale data beyond TTL
- Two implementations of same feature diverge

**Audit Approach**: Trace data through multiple components. Compare state at different points in the flow.

### 🛠️ Refactor Opportunities (Technical Debt)

**Definition**: Code that works but could be improved—patterns that create maintenance burden, duplication, or future fragility.

**Characteristics**:

- Repeated patterns that could be extracted
- Magic values that should be configuration
- Functions doing too many things
- Missing abstractions creating fragility
- Optimizations that hurt readability

**Examples**:

- Same validation logic copied in multiple handlers
- Hardcoded time windows instead of constants
- Functions 500+ lines without decomposition
- Tight coupling preventing extension
- Missing interfaces for testability

**Audit Approach**: Look for "code smells" and violation of design principles. Evaluate maintenance burden vs complexity.

## How to Use This Document

### What This Is

- A set of **provocations** to guide your exploration
- A way to discover **latent weaknesses** that tests won't catch
- An invitation to **question assumptions** baked into the architecture
- A framework for **cross-disciplinary thinking** — the best findings live between silos

### What This Is Not

- A pass/fail checklist
- A list of files to read
- Something you "complete" and move on from
- A substitute for running `make check` and `make test`

### Recommended Approach

1. **Pick one silo** that matches your current context or curiosity
2. **Adopt the perspective** — literally think from that angle
3. **Follow the evidence** — if you find something interesting, chase it even if it leads outside the silo
4. **Document findings** in `reports/audit-<YYYY-MM-DD>-<topic>.md` with:
   - What you looked at
   - What you expected to find
   - What you actually found
   - Severity assessment (P0/P1/P2/P3)
   - Recommended action or further investigation

---

## Audit Angle Selection

An "angle" is your investigative lens. Choosing the right angle determines what you find.

### How to Choose Your Angle

**Start with context**:

- Recent incidents or failures suggest investigating related silos
- New features should be audited for completeness (gap analysis)
- Performance issues point to the Eye or Spine
- User reports of inconsistency point to cross-silo investigation

**Look for asymmetry**:

- Fast paths vs slow paths may reveal optimization opportunities
- Happy paths vs error paths often have different quality
- Admin vs user surfaces may have privilege escalation
- Test vs production behavior often diverges

**Follow dependencies**:

- External API changes may break assumptions
- Library upgrades may introduce regressions
- Config changes may invalidate workarounds
- New integrations may have unmodeled interactions

### Good Investigation Paths

A good path is:

- **Observable**: You can verify the finding exists
- **Specific**: You can trace to a component or line
- **Actionable**: Someone can fix it

A poor path is:

- Too vague to verify ("the code looks messy")
- Cannot be traced to anything concrete
- No clear owner or fix approach

### When to Pivot

- If your angle yields nothing after 30 minutes, try a different silo
- If you find something surprising, chase it—even outside the current silo
- If two silos both have issues, the interaction is likely the real problem

### Severity Guide

| Level  | Meaning                                                     | Response                       | Example Scenario                                                        |
| ------ | ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| **P0** | Active data loss, security breach, or system compromise     | Fix immediately, block deploys | IAM policy allowing unauthorized access to secret keys.                 |
| **P1** | Reliability issue that will cause failures under load       | Fix in current sprint          | Race condition in the distributed lock manager under concurrent writes. |
| **P2** | Architectural debt that will cause problems as system grows | Plan and schedule              | Missing TTL or indexing strategy for a high-growth telemetry table.     |
| **P3** | Observation or improvement idea                             | Track for future consideration | Suggesting a more efficient prompt structure for the Coder agent.       |

---

## 🗺️ Silo-to-Code Quick Reference

Use this table to map high-level silos to the primary code areas that should be investigated.

| Silo  | Name           | Primary Code Focus                                                                                                                                              |
| :---- | :------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The Spine      | [routing/AgentRouter.ts](../../core/lib/routing/AgentRouter.ts), [backbone.ts](../../core/lib/backbone.ts)                                                      |
| **2** | The Hand       | [mcp.ts](../../core/lib/mcp.ts), [executor.ts](../../core/lib/agent/executor.ts)                                                                                |
| **3** | The Shield     | [safety-engine.ts](../../core/lib/safety/safety-engine.ts), [circuit-breaker.ts](../../core/lib/safety/circuit-breaker.ts)                                      |
| **4** | The Brain      | `core/lib/memory/`, `core/lib/rag/`                                                                                                                             |
| **5** | The Eye        | `core/lib/metrics/`, `core/lib/tracer/` (Trace Intelligence)                                                                                                    |
| **6** | The Scales     | [judge.ts](../../core/lib/verify/judge.ts), [trust-manager.ts](../../core/lib/safety/trust-manager.ts)                                                          |
| **7** | The Metabolism | [metabolism.ts](../../core/lib/maintenance/metabolism.ts) (Regenerative Audit & Repair), [AgentRegistry.ts](../../core/lib/registry/AgentRegistry.ts) (Pruning) |

---

## 🏗️ Deep-Dive Silos

Each silo represents a core functional domain. Reviews within a silo should adopt a specific "Angle" to uncover both explicit bugs and latent architectural weaknesses.

### 1. The Spine (Nervous System & Flow)

**Perspective**: _How does the system ensure the signal never dies?_

- **Angle**: Audit the journey of events through the asynchronous backbone. Look for "dead ends," race conditions in the distributed lock, and the effectiveness of **Conflict Resolution Timeouts** during agent handoffs.
- **Key Concepts**: Event routing, recursion limits, strategic tie-break logic, and adapter normalization (Telegram/GitHub/Jira).

#### What to Look For

- **Event Routing Issues**: Missing handlers for event types, events silently dropped, routing loops
- **Recursion Prevention**: Depth limits that can be bypassed, incorrect depth tracking
- **Lock Integrity**: Race conditions on lock acquire/release, stale locks not released
- **Adapter Normalization**: Inconsistent behavior across platforms

#### Common Finding Patterns

- Events with no subscribers dropped silently
- Depth counters that wrap or reset
- Locks not released on timeout
- Platform-specific logic leaking into core
- Unhandled event type errors

#### Red Flags

- Recursive calls without depth limits
- Lock acquire without timeout
- Event handlers that throw without catching
- Missing default routing for unknown events
- Single points of failure in event chain

#### Verification Methods

- **Atomic Recursion Check**: Verify that `RECURSION_ENTRY` updates use monotonic depth guards (`depth < :newDepth`) to prevent loop bypass.
- **Selection Integrity**: Assert that `selectBestAgent` filters out candidates with `enabled: false` regardless of reputation scores, with backbone fallback for graceful degradation.
- **Dead-End Discovery**: Scan `event-routing.ts` for unhandled or explicitly excluded agent task events that lack multiplexer subscriptions. Runtime verification via `verifyEventRoutingConfiguration()` runs at module load to catch misconfigurations.
- **Atomic Field Updates**: Verify that `atomicUpdateAgentField` checks agent existence before updating to prevent orphan field creation.

#### 🩻 Spine Event Flow

```text
  [ EventBridge ]
         |
         v
  [ Event Handler ] -- (Atomic Check) --> [ DynamoDB Rate Limiter & Circuit Breaker ]
         |
         |-- (Trace Context) --> [ Recursion Tracker ] -- (Atomic Push) --> [ MemoryTable ]
         |                                                                   (depth check)
         v
  [ Agent Router ] -- (Selection Guard) --> [ Agent Registry ]
         |                                   (check config.enabled)
         v
  [ Lock Manager ] -- (Cond. Update) --> [ MemoryTable ]
         |                                (userId: LOCK#<id>)
         v
  [ Agent Executor ] -- (Action) --> [ Unified MCP Multiplexer ]
         |
         v
  [ Lock Manager ] -- (Relaxed Release) --> [ MemoryTable ]
```

- **Verification Methods**:
  - **Atomic Recursion Check**: Verify that `RECURSION_ENTRY` updates use monotonic depth guards (`depth < :newDepth`) to prevent loop bypass.
  - **Selection Integrity**: Assert that `selectBestAgent` filters out candidates with `enabled: false` regardless of reputation scores, with backbone fallback for graceful degradation.
  - **Dead-End Discovery**: Scan `event-routing.ts` for unhandled or explicitly excluded agent task events that lack multiplexer subscriptions. Runtime verification via `verifyEventRoutingConfiguration()` runs at module load to catch misconfigurations.
  - **Atomic Field Updates**: Verify that `atomicUpdateAgentField` checks agent existence before updating to prevent orphan field creation.

### 2. The Hand (Agency & Skill Mastery)

**Perspective**: _How effectively can the system manipulate its environment?_

- **Angle**: Explore the boundary between agent intent and tool execution. Review the "creative" prompts of personas like `Coder` and `Planner` and the reliability of the "Unified MCP Multiplexer" under heavy load.
- **Key Concepts**: Prompt engineering, skill discovery, tool schema consistency, and MCP resource efficiency.

#### What to Look For

- **Prompt Quality**: Prompts that produce inconsistent results, unclear instructions, or missing context
- **Tool Schema Drift**: Schemas that don't match actual API behavior
- **Resource Exhaustion**: MCP connections not properly pooled or released
- **Skill Discovery Failures**: Skills that exist but aren't discoverable or usable

#### Common Finding Patterns

- Prompts with ambiguous success criteria leading to unreliable outputs
- Missing error handling in tool wrappers
- Connections held after failures
- Retry logic missing exponential backoff
- Skills without proper capability declarations

#### Red Flags

- Tools accepting any input without validation
- No timeout on tool execution
- Prompt injection vectors in user input
- Skills returning errors but marking success
- MCP multiplexer not handling concurrent requests

#### Verification Methods

- **Prompt Audit**: Run persona prompts with known inputs, verify output quality
- **Tool Schema Test**: Validate all tools against their schemas with boundary inputs
- **Resource Leak Check**: Monitor connection pool under load
- **Error Path Test**: Trigger failures at each layer, verify error handling

#### 🛡️ Silo 3: The Shield (Security & Baseline) [STABILIZED 2026-04-12]

The Shield has been unified. The `SafetyEngine` now acts as the authoritative gate for all tool executions, enforcing least-privilege resource access and Class C blast-radius limits.

**Key Achievements**:

- **Unified Gateway**: ToolExecutor now delegates all security decisions to the SafetyEngine (Principle 3).
- **Blast Radius Enforcement**: Hard limit of 5 Class C actions per hour per agent (Principle 10).
- **Loop Interdiction**: Reasoning loops are caught by the `SemanticLoopDetector` and result in trust penalties (Principle 22).

#### 🩻 Unified Shield Flow

```text
  [ Agent Output ] -> [ SemanticLoopDetector ] -- (Loop Found) --> [ SafetyBase.recordFailure ]
          |                                                             (Trust Penalty)
          v
  [ Tool Call ] -> [ Shield (SafetyEngine) ] -- (Class C) --> [ EvolutionScheduler ]
          |                  |                                   (Schedule HITL)
          |                  +------- (Trust >= 95 & AUTO) -> [ Principle 9 Promotion ]
          |                                                      (Bypass Approval)
          v
  [ Circuit Breaker ] -- (Tripped?) --> [ Execution Blocked ]
          |
          v
  [ Tool Execution ] -> [ Failure? ] -> [ SafetyBase.recordFailure ] -> [ Trip Breaker ]
```

#### What to Look For

- **IAM Policy Gaps**: Overly permissive policies, missing least-privilege, or wildcard actions
- **Circuit Breaker Effectiveness**: Breakers not triggering, thresholds too high, or recovery blocked
- **Recovery Logic**: Dead Man's Switch conditions, rollback procedures, fallback behavior
- **Blast Radius**: Class C violations, cross-tenant access, uncontrolled propagation

#### Common Finding Patterns

- IAM policies with Write on secrets without read
- Circuit breakers with thresholds above normal load
- No fallback for critical services
- Single points of failure in recovery path
- Auto-approve without human review for high-risk operations

#### Red Flags

- IAM policies allowing \*
- No circuit breaker on external dependencies
- Recovery procedure requires manual intervention
- Blast radius limits not enforced
- Security violations not triggering alerts

#### Verification Methods

- **IAM Audit**: Review all policies against least-privilege principle
- **Circuit Test**: Artificially trigger failures, verify breaker activation
- **Recovery Drill**: Test full recovery procedure end-to-end
- **Blast Radius Test**: Simulate Class C violations, verify containment

### 4. The Brain (Memory, Identity & Continuity)

**Perspective**: _How does the system maintain its "sense of self" and history?_

- **Angle**: Investigate the continuity of context across multi-turn sessions. Audit the multi-tenant Workspace isolation and the efficiency of the **Tiered Memory Model** (Hot DynamoDB + LRU Cache) for high-speed recall and strategic reflection.
- **Note**: Semantic Vector Memory is a future milestone. Current implementation uses DynamoDB with tiered retention.
- **Key Concepts**: Tiered retention (TTL), Cache hit rates, RBAC (Owner/Admin/Collab), and strategic gap identification.

#### What to Look For

- **Context Leaks**: Cross-workspace data exposure, session confusion, identity bleeding
- **TTL Issues**: Missing TTL causing unbounded growth, TTL too short losing context, TTL too long retaining junk
- **Cache Inefficiency**: Low hit rates, cache stampede, stale cache serving
- **RBAC Gaps**: Privilege escalation, permission drift, missing enforcement

#### Common Finding Patterns

- Workspace IDs in wrong fields causing cross-talk
- TTL defaults that don't match retention policy
- Cache invalidated on every write
- Role checks that can be bypassed
- Missing auth on new endpoints

#### Red Flags

- No workspace isolation on sensitive queries
- Infinite TTL on large data
- Cache disabled for performance reasons
- Role stored in client-controlled data
- New endpoints without RBAC checks

#### Verification Methods

- **Isolation Test**: Attempt cross-workspace access, verify rejection
- **TTL Audit**: Query old records, verify TTL enforcement
- **Cache Analysis**: Monitor hit rates, identify misses
- **RBAC Audit**: Test each role across all endpoints

### 5. The Eye (Observation & Consistency)

**Perspective**: _Does the system's internal trace state match what is reported to the user?_

- **Angle**: Audit the consistency between backend trace state and the Dashboard's Trace Intelligence. Ensure that "truth" matches backend state and that no signal is lost between internal execution and external reporting. Utilize the **`ConsistencyProbe`** to detect drift between raw metrics (completion counts, latency) and dashboard events.
- **Key Concepts**: Trace consistency, Real-time sync, Dashboard accuracy, Observability SLOs, **Metrics Integrity Probing**.

#### What to Look For

- **Metrics Drift**: Backend counts don't match dashboard, lost events in flight
- **Trace Gaps**: Incomplete traces, missing spans, broken correlations
- **Reporting Latency**: Events appearing late, real-time claims false
- **SLO Violations**: Measurements not matching targets, thresholds wrong

#### Common Finding Patterns

- Errors counted differently between systems
- Large transactions without tracing
- Metrics aggregated incorrectly
- Dashboard cache serving stale data
- SLO calculations with wrong denominators

#### Red Flags

- Metrics that can't be queried
- Missing error metrics
- No trace sampling strategy
- Dashboard doesn't update in real-time
- SLOs without dashboards

#### Verification Methods

- **ConsistencyProbe**: Compare backend state to dashboard display. Implemented with trace table cross-reference for drift detection.
- **Trace Audit**: Verify correlation IDs, trace completeness
- **Latency Measurement**: Time from event to dashboard
- **SLO Calculation**: Recalculate SLOs independently, compare. **Note**: p95_latency uses actual `avgDurationMs` from TokenRollup, not token counts.

#### 🩻 Eye Metrics Flow

```text
   [ Agent Execution ]
          |
          v
   [ ClawTracer ] -- (endTrace/failTrace) --> [ Metrics Emission ]
          |                                    (agentInvoked, agentDuration)
          v                                    |
   [ TraceTable ]                             v
          |                            [ CloudWatch / DynamoDB ]
          |                                    |
          v                                    |
   [ ConsistencyProbe ] <---------------------+
   (verifyTraceConsistency)
          |
          v
   [ Dashboard Trace Intelligence ]
```

### 6. The Scales (Trust & Calibration)

**Perspective**: _Is the system accurately penalizing failure and rewarding success?_

- **Angle**: Audit the integrity of the feedback loop from observation to trust calibration. Review the **LLM-as-a-Judge** semantic evaluation layer to ensure it is impartial and that `TrustScore` calculations accurately reflect agent performance. Verify that failures (caught by QA or SLO breaches) and cognitive anomalies (reasoning loops, degradation detected by Silo 5) correctly penalize the trust score. Ensure success bumps are weighted by quality scores. **Technical Integrity**: Verify that trust updates utilize the **Atomic Field Pattern** to prevent race conditions during concurrent agent activity.
- **Key Concepts**: LLM-as-a-Judge impartiality, TrustScore penalties, Success rewards, Trust decay rates, **Atomic State Integrity**, **Batched Anomaly Reporting**.

#### What to Look For

- **Trust Drift**: Scores that don't reflect actual performance, delayed updates
- **Evaluation Bias**: Judge favoring certain agents or patterns, inconsistent criteria
- **Feedback Loop Gaps**: Failures not updating scores, successes over-weighted
- **Decay Issues**: Stale high scores, decay too aggressive, decay not applied

#### Common Finding Patterns

- Trust scores not updated on failures
- Judge criteria not matching task requirements
- Success bumps not weighted by quality
- Decay applied too frequently or not at all
- Trust updates that can be bypassed

#### Red Flags

- No trust penalty on known failures
- Judge criteria easily gamed
- Trust changes not atomic
- No upper bound on trust score
- Trust decay not time-based

#### Verification Methods

- **Trust Trace**: Follow trust changes through lifecycle
- **Judge Audit**: Test judge on known good/bad outputs
- **Decay Test**: Verify time-based decay application
- **Atomic Test**: Concurrent updates don't cause drift

#### 🔄 Trust Anomaly Feedback Loop

```text
 [ Silo 5: The Eye ]           [ Silo 6: The Scales ]
         |                            ^
 (Anomaly Detected)                   |
         |                            |
         v                            |
 [ DegradationDetector ]              |
         |                            |
  (Batch Anomalies)                   |
         |                            |
         v                            |
 [ CognitiveHealthMonitor ]           |
         |                            |
   (AwaitForBatch)                    |
         |                            |
         v                            |
 [ TrustManager ] --------------------+
         |
  (Atomic Update)
         |
         v
 [ AgentRegistry (DDB) ]
```

### 7. The Metabolism (Regenerative Repair & Bloat Management)

**Perspective**: _Is the system capable of autonomously healing its own debt and recycling waste?_

- **Angle**: Audit the system through the lens of **Regenerative Metabolism**. Unlike passive audits, Silo 7 operates on the "Perform while Auditing" philosophy — identifying metabolic waste (dead overrides, memory bloat) and executing repairs in real-time.
- **Detailed Framework**: Refer to the exhaustive [METABOLISM.md](../../docs/system/METABOLISM.md) for architecture and diagrams.
- **Key Concepts**: Regenerative repair, tool pruning, memory culling, strategic propagation, and metabolic efficiency.

#### What to Look For

- **Metabolic Waste**: Dynamic tool overrides with zero executions over 30 days.
- **Memory Bloat**: Resolved knowledge gaps held beyond 90 days.
- **Architectural Debt**: Patterns identified by AIReady (AST) analysis as potentially redundant.
- **Repair Integrity**: Correct propagation of P1/P2 findings into the [Strategic Planner](../../core/agents/strategic-planner.ts) for HITL/Review.

#### Common Finding Patterns

- Functions with zero callers in codebase
- Feature flags for removed features still in code
- Similar utility functions in multiple modules
- Magic numbers without named constants
- Export maps with unused exports

#### Red Flags

- Files with >50% comments suggesting deprecated code
- Circular dependencies between modules
- Functions 500+ lines without decomposition
- No test coverage on "legacy" code
- Copy-paste modifications of existing functions

#### Verification Methods

- **Dead Code Detection**: Static analysis for uncalled functions, unused exports
- **Pattern Audit**: Search for repeated implementations of same functionality
- **Dependency Graph**: Visualize and audit for anomalies
- **Code Churn Analysis**: Files frequently changed, may indicate fragile code

---

## 🔗 Cross-Silo Perspectives

These perspectives intentionally span multiple silos to identify integration gaps and emergent system behaviors. Cross-silo findings often represent the most critical architectural issues because they reveal broken contracts between components.

### A. The "Life of a Message" (Spine ↔ Brain ↔ Eye)

**Objective**: Verify end-to-end message flow integrity from receipt to response.

**Investigation Steps**:

1. Identify a recent message through the system
2. Trace from webhook entry through router
3. Verify memory retrieval for context
4. Follow agent reasoning and tool execution
5. Check trace completeness in dashboard
6. Verify UI sync via MQTT

**Expected Findings**:

- Missing trace spans at boundaries
- Memory retrieval failures causing degraded responses
- Latency build-up at specific stages
- Metrics not matching between systems
- Trace correlation broken

**Verification Checkpoints**:

- Message ID traceable end-to-end
- All hops have timing data
- Dashboard reflects actual state
- No silent failures in chain

### B. The "Evolution Cycle" (Hand ↔ Shield ↔ Scales)

**Objective**: Verify autonomous evolution maintains safety and trust integrity.

**Investigation Steps**:

1. Find a recent self-evolution event
2. Verify strategic plan generation
3. Check safety verification pre-flight
4. Verify trust score for autonomy level
5. Trace deployment approval flow
6. Verify post-deploy trust update

**Expected Findings**:

- High-trust agents bypassing safety checks
- Trust score not updated post-deployment
- Safety verifications skipped under load
- Deployment without traceability

**Verification Checkpoints**:

- All deployments have decision logs
- Trust changes map to events
- Safety gates not bypassable
- Rollback procedures tested

### C. The "Identity Journey" (Brain ↔ Spine ↔ Shield)

**Objective**: Verify identity and permissions propagate correctly across all surfaces.

**Investigation Steps**:

1. Find authenticated user
2. Trace API Gateway auth to context
3. Check workspace derivation
4. Verify role assignment propagation
5. Check tool execution permissions
6. Verify audit trail

**Expected Findings**:

- Role not checked at all surfaces
- Cross-workspace permission leakage
- Stale permissions not revoked
- Admin escalation without audit

**Verification Checkpoints**:

- RBAC checked at every sensitive endpoint
- No privilege escalation without review
- All actions traceable to identity
- Permissions sync correctly

### D. The "Trust Loop" (Eye ↔ Scales ↔ Spine)

**Objective**: Verify the feedback loop from observation through trust to action.

**Investigation Steps**:

1. Find a detected anomaly (Silo 5)
2. Verify anomaly reached trust system
3. Check trust penalty applied
4. Verify new trust affects agent selection
5. Verify selection affects behavior

**Expected Findings**:

- Anomaly detection not reaching trust
- Trust penalty not affecting selection
- Selection ignoring disabled status
- Feedback loop has dead ends

**Verification Checkpoints**:

- All anomalies reach trust system
- Trust changes selection behavior
- Disabled agents not selected
- No untracked trust changes

### E. The "Recovery Path" (Shield ↔ Spine ↔ Brain)

**Objective**: Verify system recovery maintains consistency.

**Investigation Steps**:

1. Identify recovery triggers (circuit breaker, dead man's switch)
2. Trace recovery procedures
3. Verify state consistency post-recovery
4. Check memory integrity
5. Verify trust state preserved

**Expected Findings**:

- Recovery not completing state sync
- Memory left in inconsistent state
- Trust scores lost or corrupted
- No recovery audit trail

**Verification Checkpoints**:

- Recovery produces consistent state
- Memory matches expected values
- Trust system operational post-recovery
- Full audit trail exists

---

## 🛠️ Verification Strategy

Future reviews should utilize a "Probe and Verify" method rather than a simple pass/fail:

### Core Probes

- **Static Probes**: `make check` for structural health (Linting/Types).
- **Dynamic Probes**: `make test` and `npx vitest` for behavioral health (Unit/Integration).
- **Holistic Probes**: `npx playwright test` to verify the user-facing reality (E2E).
- **Observational Probes**: Reviewing `Trace Intelligence` in the dashboard or via `TOOLS.inspectTrace` to visualize the "creative" paths taken during complex tasks.

### Specialized Probes

#### Security Probes

- **IAM Audit**: Review policies against least-privilege
- **Injection Testing**: Try malicious inputs at all boundaries
- **Privilege Escalation**: Attempt unauthorized actions
- **Secret Exposure**: Check logs for leaked secrets

#### Performance Probes

- **Load Testing**: Verify behavior under load
- **Latency Profiling**: Identify slow paths
- **Connection Pooling**: Test pool exhaustion
- **Memory Growth**: Monitor under sustained load

#### Consistency Probes

- **Metrics Reconciliation**: Backend vs dashboard counts
- **Cache Coherency**: Cache vs database verification
- **Trace Completeness**: Verify full correlation
- **State Reconciliation**: Cross-system state check

#### Dependency Probes

- **External API**: Test with mocked external services
- **Library Version**: Verify pinned versions
- **Supply Chain**: Check dependency integrity
- **Breaking Changes**: Test after upgrades

---

## 📝 Documenting Your Findings

Use the following template when creating reporting artifacts in the `reports/` directory.

```markdown
# Audit Report: [Topic/Silo] - [YYYY-MM-DD]

## 🎯 Objective

Brief description of what you were looking for.

## 🎯 Finding Type

Specify the primary finding type (see [Finding Type Taxonomy](#finding-type-taxonomy)):

- Bug / Gap / Inconsistency / Refactor

## 🔍 Investigation Path

- Started at: [File/Component]
- Followed: [Event/Trace]
- Observed: [Behavior]

## 🚨 Findings

| ID  | Title             | Type | Severity | Location   | Recommended Action |
| :-- | :---------------- | :--- | :------- | :--------- | :----------------- |
| 1   | Brief description | Bug  | P1       | file.ts:42 | Fix X in file Y    |

## 💡 Architectural Reflections

Any high-level notes on debt or potential consolidations.
```
