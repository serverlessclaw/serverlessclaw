# Memory Management: The Tiered Neural Engine

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
|  - Key: DISTILLED# / LESSON# / GAP#                                 |
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

## High-Performance Indexing (TypeTimestampIndex)

The `MemoryTable` utilizes a Global Secondary Index (GSI) named `TypeTimestampIndex` to enable instantaneous querying. This allows the system to bypass expensive full-table scans when fetching context.

- **Partition Key**: `type` (e.g., 'GAP', 'LESSON', 'DISTILLED', 'MESSAGE', 'SESSION')
- **Sort Key**: `timestamp`
- **Result**: Reduced dashboard load times from ~10s to **<100ms**.

## Human-Agent Co-Management (Neural Reserve)

Memory is not a "black box" in Serverless Claw. Through the **Neural Reserve** page (Evolution sector) in ClawCenter, users can:
- **Audit**: View all distilled facts, lessons, and identified gaps.
- **Prioritize**: Manually adjust the priority of a `GAP#` to influence the Planner's roadmap.
- **Prune**: "Weed" the memory garden by deleting stale or incorrect items.
- **Focus**: Toggle "HOT_PATH" status for tactical lessons to ensure they are always present in the reasoning loop.

## The Smart Recall Mechanism

Instead of shoving all history into every prompt, agents use the `recallKnowledge(query)` tool.

1. **Query**: The agent generates a search query (e.g., "How does the user prefer code documentation?").
2. **Search**: The system searches `LESSON#`, `GAP#`, and `DISTILLED#` keys in DynamoDB.
3. **Recovery**: Relevant snippets are returned to the agent's context "Just-In-Time".

> [!TIP]
> This retrieval strategy reduces input token costs by up to 90% in long-lived sessions while maintaining high context precision and system self-awareness.
