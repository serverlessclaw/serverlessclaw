# Memory Management: The Tiered Neural Engine

> **Last Updated**: 23 March 2026

Serverless Claw uses a tiered, evolutionary memory system designed to provide context-rich interactions while minimizing "prompt bloat" and token costs.

## Architecture Diagram

```text
+-----------------------------------------------------------------------+
|                        AGENT REASONING LOOP                           |
+-----------------------------------------------------------------------+
           |                                             ^
           v                                             |
+-----------------------+                      +-----------------------+
|  Context Weaver      |                      |  Knowledge Retriever  |
|  (Prompt Assembly)   |                      |  (Smart Recall Tool)  |
+-----------+-----------+                      +-----------+-----------+
            |                                             ^
            |       [ PERSISTENCE LAYER: DynamoDB ]       |
            |       (Indexed via 'TypeTimestampIndex')    |
            v                                             |
+-----------+---------------------------------------------+-----------+
|                          MEMORY TABLE                               |
+---------------------------------------------------------------------+
|                                                                     |
|  [ TIER 1: CORE INTELLIGENCE ] --------> Retain: 2 Years (730d)     |
|  - Key: DISTILLED# / LESSON# / GAP# / MEMORY:                       |
|  - Purpose: Permanent identity, tactical lessons, strategic roadmaps.|
|                                                                     |
|  [ TIER 2: HUMAN CONVERSATION ] -------> Retain: 30 Days            |
|  - Key: CONV# / SESSIONS#                                           |
|  - Purpose: Recent user chat history and session metadata.           |
|                                                                     |
|  [ TIER 3: AGENT OPERATIONAL TRACES ] -> Retain: 1 Day              |
|  - Key: CODER# / PLANNER# / REFLECTOR#                              |
|  - Purpose: Mechanical execution logs for background agent loops.    |
|                                                                     |
|  [ TIER 4: TRANSIENT SYSTEM LOGS ] ----> Retain: 1 Hour             |
|  - Key: RECOVERY / SYSTEM#                                          |
|  - Purpose: Volatile state signals for recovery and coordination.   |
|                                                                     |
+---------------------------------------------------------------------+
```

## Memory Tiers Explained

### 1. Long-Term Facts (`DISTILLED#`)
Permanent knowledge about the user. This is the "Base Identity" of the session. It includes name, role, and overarching goals.
- **Update Frequency**: Low (only when significant identity shifts occur).
- **Injection**: Loaded into the System Prompt for EVERY request.

### 2. Tactical Lessons (`LESSON#` / `TACTICAL#`)
Short-term heuristics distilled by the **Cognition Reflector**. If the agent makes a mistake or a technical "gotcha" is discovered, it's saved here to prevent repetition.
- **Update Frequency**: Medium.
- **Injection**: The most relevant lessons are selectively loaded into the prompt.

### 3. Strategic Gaps (`GAP#`)
A backlog of missing capabilities identified by the Reflector. These gaps are the primary driver for the system's **Self-Evolution**.
- **Tracking**: Includes ROI, Complexity, and Risk signals.
- **Evolution**: The **Strategic Planner** reviews these during its deterministic **48-hour review** cycle to design the next system upgrade.

### 4. Agent Operational Traces (`COGNITION-REFLECTOR#`, `CODER#`, etc.)
The raw execution logs of background agent loops. These are trace-specific and isolated to prevent cross-contamination.
- **Update Frequency**: Extremely High.
- **Retention**: **1 Day**.
- **Namespace**: Keyed by `AGENT#userId#traceId`.

### 5. Transient System Logs (`RECOVERY`, `SYSTEM#`)
Volatile signals used for coordination, recovery, and real-time status updates.
- **Retention**: **1 Hour**.
- **Purpose**: High-velocity coordination.

## Neural Lifecycle (Tiered Retention)

Serverless Claw implements an automatic, tiered data lifecycle using DynamoDB TTL. This ensures the system remains "lean" and fast without losing strategic intelligence.

| Tier | Retention | Category | Purpose |
| :--- | :--- | :--- | :--- |
| **Intelligence** | **2 Years** | Strategic | Facts, Lessons, Gaps |
| **Conversation**| **30 Days** | Operational | Human chat history |
| **Agent Traces** | **1 Day**   | Mechanical  | Background agent loops |
| **System Logs**  | **1 Hour**  | Volatile    | Recovery & signals |

## Operational & Performance Metrics

Beyond conversation and knowledge, the system tracks its own performance to enable cost-aware routing and self-optimization.

### Token Usage Tracking

Every LLM invocation is recorded with granular metadata:

```text
Key: TOKEN#<agentId>#<timestamp>
Value: {
  inputTokens: 1200,
  outputTokens: 450,
  totalTokens: 1650,
  success: true,
  taskType: "agent_process",
  model: "claude-3-5-sonnet",
  durationMs: 4200
}
```

### Agent Performance Rollups

The `TokenTracker` maintains daily rollups for every agent, enabling the **Agent Router** to select candidates based on historical efficiency.

- **Partition Key**: `TOKEN_ROLLUP#<agentId>`
- **Sort Key**: `timestamp` (Day start)
- **Metrics**: `avgTokensPerInvocation`, `successRate`, `totalInvocations`.

### Cost-Aware Routing

The `AgentRouter` uses these metrics to compute a **Composite Score**:
`Score = (Capability * SuccessRate) - (AvgTokens / 10000)`

This ensures the system naturally prefers faster, cheaper models (like GPT-4o-mini) for simple tasks while reserving powerful models (like Claude 3.5 Sonnet) for high-complexity strategic planning.

## High-Performance Indexing (TypeTimestampIndex)

The `MemoryTable` utilizes a Global Secondary Index (GSI) named `TypeTimestampIndex` to enable instantaneous querying. This allows the system to bypass expensive full-table scans when fetching context.

- **Partition Key**: `type` (e.g., 'GAP', 'LESSON', 'DISTILLED', 'MESSAGE', 'SESSION')
- **Sort Key**: `timestamp`
- **Result**: Reduced dashboard load times from ~10s to **<100ms**.

## Neural Pruning & Hit Tracking (The Self-Cleaning Loop)

Serverless Claw doesn't just remember; it strategically forgets. To prevent "cognitive bloat" and ensure the most relevant knowledge is always prioritized, the system implements an autonomous **Neural Pruning** loop.

### Hit Tracking Mechanism
Every time an agent recalls a memory using the `recallKnowledge` tool, the system performs an atomic "Hit" update in the background:
- **`hitCount`**: Increments a counter on the memory item.
- **`lastAccessed`**: Updates the timestamp to the current time.

This telemetry allows the system to distinguish between **High-Utility Facts** (recalled daily) and **Neural Noise** (never used).

### The Pruning Loop Diagram

```text
+-----------------------+       +-----------------------+
|   Agent Tool Use      |       |  Strategic Planner    |
|  (recallKnowledge)    |       |  (48h Review Cycle)   |
+-----------+-----------+       +-----------+-----------+
            |                               ^
     [RECORD HIT]                    [AUDIT UTILIZATION]
            |                               |
            v                               v
+-----------+-------------------------------+-----------+
|                  NEURAL MEMORY TABLE                  |
|  (Tracks hitCount, lastAccessed, and timestamp)       |
+-----------+-------------------------------+-----------+
            |                               |
            |                         [PRUNE STALE]
            v                               |
+-----------+-------------------------------+-----------+
|                CLEAN NEURAL STATE                     |
|  (High-density, relevant, and cost-efficient)        |
+-------------------------------------------------------+
```

### Pruning Logic
During its scheduled **48-hour review**, the **Strategic Planner** audits all dynamic memories (`MEMORY:*`). 
1. **Identification**: Any memory with `hitCount == 0` that hasn't been accessed in **14 days** is flagged as "Stale".
2. **Analysis**: The Planner evaluates if the stale information is redundant or irrelevant to current system goals.
3. **Action**: The Planner recommends pruning the item (archiving or deleting) as part of its **Strategic Plan**.

## Human-Agent Co-Management (Neural Reserve)

Memory is not a "black box" in Serverless Claw. Through the **Neural Reserve** page (Evolution sector) in ClawCenter, users can:
- **Audit**: View all distilled facts, lessons, and identified gaps, now including **Hit Tracking** metrics (total hits and last recalled time).
- **Prioritize**: Manually adjust the priority of a `GAP#` to influence the Planner's roadmap.
- **Prune**: "Weed" the memory garden by deleting stale or incorrect items.
- **Focus**: Toggle "HOT_PATH" status for tactical lessons to ensure they are always present in the reasoning loop.
- **Neural Health**: Monitor which memories are currently being ignored by the agents to decide on manual pruning.


## The Smart Recall Mechanism

Instead of shoving all history into every prompt, agents use the `recallKnowledge(query)` tool.

1. **Query**: The agent generates a search query (e.g., "How does the user prefer code documentation?").
2. **Search**: The system searches `LESSON#`, `GAP#`, and `DISTILLED#` keys in DynamoDB.
3. **Recovery**: Relevant snippets are returned to the agent's context "Just-In-Time".

> [!TIP]
> This retrieval strategy reduces input token costs by up to 90% in long-lived sessions while maintaining high context precision and system self-awareness.
