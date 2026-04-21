# Total Quality & Evolution Loop

The **Cognitive Evolution Loop** is the core mechanism by which the Serverless Claw swarm iteratively improves its own reasoning capabilities without manual engineering intervention for every failure.

## 🌀 The Evolution Cycle (ASCII Diagram)

```text
       [ SIGNAL ]                      [ ANALYSIS ]                      [ REMEDIATION ]
    ------------------              -----------------                 -------------------
    |                |              |               |                 |                 |
    |  Real-world    |------------->| Tuning Critic |---------------->| Proposed        |
    |  Failure       | (EventBridge)| (LLM-based)   | (Metabolic Gap) | Persona Updates |
    |                |              |               |                 |                 |
    ------------------              -----------------                 -------------------
            ^                                                                  |
            |                                                                  |
            |Promote to Prod                                                   |Replay Failure
            |(AgentRegistry)                                                   |In Sandbox
            |                                                                  |
    ------------------              ------------------                -------------------
    |                |              |                |                |                 |
    |  DEPLOYED      |<-------------|  HUMAN/SYSTEM  |<---------------|  EVOLUTION      |
    |  v(N+1)        | (Verification|  APPROVAL      | (Isolated Mode)|  SANDBOX        |
    |  PERSONA       |     Gate)    |                | (Drift-Free)   |  (PLAYGROUND)   |
    ------------------              ------------------                -------------------
```

## 🏗 Key Components

### 1. Signal Receipt (Pulse Health)

Every agent execution generates a trace. Failures are captured by the `reputation-handler` and aggregated into hourly buckets. Low reputation scores (Principle 12) trigger a "Metabolic Gap" signal.

### 2. Tuning Critic (Intelligence Hub)

The Intelligence Hub analyzes the error distribution. If a "Reasoning Failure" is detected, it pulls the full trace and initial context. A specialized LLM compares the intent vs. the result and generates an **Improved Prompt Snippet**.

### 3. Evolution Sandbox (Isolated Replay)

To prevent "Memory Drift" or "Reputation Poisoning" during testing, the sandbox runs in **Isolated Mode**:

- `isIsolated: true`: Prevents persistence to DynamoDB memory.
- `source: PLAYGROUND`: Excludes results from reputation metrics.
- `TraceSource.UNKNOWN`: Bypasses default reflection checks.

### 4. Registry Promotion (Cognitive Lineage)

Once verified in the sandbox, the change is committed.

- **Prompt Hash**: Ensures uniqueness of the behavioral change.
- **Atomic Versioning**: Increments the agent version (e.g., v1 -> v2) to track historical lineage.
- **Reputation Reset**: Optionally resets specific failure flags for the new version to allow for a fresh performance baseline.

---

> [!IMPORTANT]
> The **Evolution Sandbox** is air-gapped. Any tools executed within the sandbox that interact with external APIs must be handled by their respective MCP servers with proper safety tiers enabled.

> [!TIP]
> Cognitive Evolution is most effective when paired with **Pulse Health** monitoring to detect degradation early before failures cascade through the swarm.
