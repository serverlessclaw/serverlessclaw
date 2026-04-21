# Memory Management: The Tiered Neural Engine

> **Navigation**: [← Index Hub](../../INDEX.md)

# Memory & Persistence Lifecycle

Serverless Claw uses a tiered memory system to balance low-latency recall with long-term strategic context.

## 🧠 Memory Adapters

While the default implementation uses DynamoDB for globally distributed, low-latency persistence, the system follows an adapter pattern to support multiple backends:

- **DynamoDB (Default)**: Optimized for 50-100ms context retrieval.
- **Redis (Upstash)**: Used for extremely high-frequency turn-taking signals.
- **PostgreSQL (Drizzle/Prisma)**: Optional for complex relational memory queries.
- **S3**: Long-term archival of high-volume conversation logs.

## 🗂️ Searchable Memory Model (Flattened)

To support sub-50ms context retrieval across millions of records, the system uses a **Flattened DynamoDB Model**. Searchable fields are projected at the root level to maximize Global Secondary Index (GSI) efficiency.

### Workspace Scoping & Multi-Tenancy

In multi-tenant environments, logical isolation is enforced via the `userId` partition key. When a `workspaceId` is present in the execution context, all memory operations utilize a scoped PK format:

**Format**: `WS#<workspaceId>#<userId>`

- **Isolation**: Prevents data leakage between different workspaces even if they share the same `userId`.
- **Consistency**: This scoping is applied transparently across all memory tiers (History, Lessons, Gaps).
- **Fallback**: If no `workspaceId` is provided, the system defaults to the raw `userId`.

#### Isolated Memory Flow

```text
  [ Event / Task ] -> (workspaceId) -> [ Agent ]
          |                               |
          |                               v
          +----------------------> [ Memory Layer ]
                                          |
                                          v
                                [ getScopedUserId ]
                                (Harden & Validate)
                                          |
                                          v
                                [ resolveItemById ]
                             (Direct SK -> GSI Fallback)
                                          |
                                          v
                                [ DynamoDB PK Scan ]
                          (WS#workspace-123#user-456)
                                          |
                                          +-- (Isolated from) --+
                                                                |
                                                     (WS#workspace-abc#user-456)
```

- **Hardened Scoping**: The `getScopedUserId` utility explicitly validates base `userId` strings to prevent "prefix spoofing" where a user might attempt to inject their own `WS#` prefix to access unauthorized workspace data.
- **Modular Memory Architecture**: The `CachedMemory` provider is decomposed into specialized delegators to maintain AI context window clarity and separation of concerns:
  - **MemoryGaps**: Manages strategic gap lifecycle, atomic status transitions, and planning locks.
  - **MemoryCollaboration**: Orchestrates multi-party session access, participant roles, and shared context.
  - **MemoryDelegator**: Handles low-level system operations, LKG hashes, and system-level metadata.
- **Thundering Herd Protection**: Implements concurrent request coalescing (Promise Caching) for high-frequency operations like `getHistory`. This ensures that simultaneous cache misses for the same user only trigger a single DynamoDB read, maximizing metabolic efficiency.
- **On-Demand Session Renewal**: The `SessionStateManager` utilizes an `autoRenew` pattern within agent execution loops. It automatically refreshes session locks (TTL) when they reach 50% expiration, eliminating the need for unreliable background heartbeats in Lambda environments.

```text
[ Record Root ]
  ├── userId (PK)         <-- Scoped partition (WS#ws-abc#user-123)
  ├── timestamp (SK)      <-- Unique ID or numeric 0 for singletons
  ├── type (GSI-PK)       <-- Category
  ├── tags (GSI-Filter)   <-- Consolidated keywords
  ├── orgId               <-- Organizational isolation
  ├── workspaceId         <-- Workspace-specific isolation
  ├── createdAt           <-- Immutable source
  └── [ metadata ]        <-- Strategic scores (confidence, priority)

**Singleton Records**: For global state or unique metadata (e.g., `REPUTATION#<id>`, `SESSION_STATE#<id>`), the `timestamp` sort key is set to exactly `0` to ensure O(1) retrieval without range scanning.
```

This architecture ensures that agents can perform complex keyword and category searches without expensive table scans or deep-nested attribute filtering.

---

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
|  [ TIER 1: CORE INTELLIGENCE ] --------> Retain: 60-365 Days         |
|  - Key: DISTILLED# (365d) / LESSON# (90d) / FACT# (365d) / GAP# (60d)/ |
|    GAP_LOCK#: (30m) / REPUTATION# (365d) / FAILED_PLAN#:              |
|  - Purpose: Permanent identity, tactical lessons, strategic roadmaps,|
|    concurrency control for evolution, and anti-pattern learning.     |
|  - Note: GAPS_RETENTION_DAYS configurable via configDefaults           |
|                                                                     |
## Extended Memory Lifecycle & Continuity

Beyond raw chat history, the **Brain** manages the continuity of system identity and strategic maturity.

### 1. Tiered Retention Model
The system enforces specialized retention policies based on the semantic value of data:
- **Strategic Gaps (`GAP#`)**: Retained for 60 days to allow for metabolic resolution.
- **Cognitive Lessons (`LESSON#`)**: Retained for 90 days to reinforce successful patterns.
- **Identity/Fidelity (`FACT#`, `DISTILLED#`)**: Retained for 365 days as the "stable core" of agent performance.
- **Trace History**: TTL configured via `HISTORY_RETENTION_DAYS` (default 30d).

### 2. Knowledge Gaps & Strategic Continuity
The system tracks "missing pieces" or unresolved sub-tasks as **Knowledge Gaps**.
- **Lifecycle**: Created -> Active (Strategic Lock) -> Resolved (Cycled to Lesson) -> Metabolized (Pruned).
- **Session Integrity**: Metadata is injected into active sessions to ensure agents are aware of pending strategic gaps within their workspace.

### 3. Multi-Tenant Boundary Enforcement
As described in [Workspace Scoping](#workspace-scoping--multi-tenancy), identity and isolation are enforced at the service level:
- Cross-tenant access is rejected at the PK generation layer, ensuring data fidelity within complex swarms.
|  [ TIER 3: AGENT OPERATIONAL TRACES ] -> Retain: 30 Days            |
|  - Key: CODER# / PLANNER# / REFLECTOR#                              |
|  - Purpose: Mechanical execution logs for background agent loops.    |
|                                                                     |
|  [ TIER 4: TRANSIENT SYSTEM LOGS ] ----> Retain: 1 Day (7d for Health) |
|  - Key: RECOVERY / SYSTEM# / HANDOFF# / HEALTH# / WARM#                 |
|  - Purpose: Volatile state signals for recovery, coordination, and  |
|    human-agent handoff management. HEALTH# tracks cognitive stability.|
|    WARM# tracks server/agent warm state for smart warmup.            |
|    LOCK#SESSION# manages session concurrency (5-minute default TTL). |
|    GAP_LOCK# manages strategic gap locks (30-minute default TTL).    |
|                                                                     |
+---------------------------------------------------------------------+
```

## Memory Cache Architecture (Silo 2)

To minimize latency while maintaining consistency, Serverless Claw uses a multi-layered caching strategy for memory retrieval.

```text
       [ Agent Execution ]
               |
               v
       +-------------------+
       |   CachedMemory    | <--- (Singleton Proxy)
       +-------------------+
               |
       +-------+-------+
       |               |
       v               v
 [ High-Speed ]  [ Scoped Data ]
 [    LRU     ]  [    LRU      ]
 (Global TTL)    (User-specific)
       |               |
       |               | (Cache Miss / TTL Expired)
       +-------+-------+
               |
               v
       +-------------------+
       |  DynamoDB Storage | <--- (Persistence)
       +-------------------+
               |
               +---> [ Atomic Updates ] (Partial Fields)
                     (Principle 13: atomicUpdateMetadata)
```

### Cache Namespace & Scoping

Cache keys are strictly prefixed to prevent collisions and support strategic pruning:

- **`prefs:<userId>[:<workspaceId>]`**: Personal and workspace-specific settings/insights.
- **`lessons:<userId>[:<workspaceId>]`**: Tactical lessons (LRU).
- **`search:<queryHash>`**: Semantic search results (Short TTL).
- **`global:lessons`**: Common lessons shared across all users.

---

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
- **Normalization**: Gap IDs are normalized (numeric extraction) to ensure stable trace linkage across providers and prevent accidental duplication from text-prefixed IDs (e.g., `GAP-123` becomes `123`).
- **Evolution**: The **Strategic Planner** reviews these during its deterministic **48-hour review** cycle.
- **Concurrency**: Agents use `GAP_LOCK#<id>` items with a 30-minute TTL to coordinate work on high-value gaps, preventing duplicate efforts and race conditions.

### 4. Negative Memory (`FAILED_PLAN#`)

Records of structurally failed strategic plans. This tier prevents the swarm from "looping" on expensive mistakes by providing a historical record of what has already been tried and failed.

- **Data Model**: JSON containing the plan hash, failure reason, and impacted gap IDs.
- **Feedback Loop**:
  ```text
  [ Coder Agent ] --(1) record failure--> [ FAILED_PLAN# ]
                                              |
                                              v
  [ Strategic Planner ] <--(3) avoid anti-patterns
      (Design Phase)
  ```

### 5. Agent Operational Traces (`COGNITION-REFLECTOR#`, `CODER#`, etc.)

The raw execution logs of background agent loops. These are trace-specific and isolated to prevent cross-contamination.

- **Update Frequency**: Extremely High.
- **Retention**: **1 Day**.
- **Namespace**: Keyed by `AGENT#userId#traceId`.

### 5. Transient System Logs (`RECOVERY`, `SYSTEM#`, `HANDOFF#`)

Volatile signals used for coordination, recovery, real-time status updates, and human-agent handoffs.

- **Retention**: **1 Day**.
- **Handoff TTL**: `HANDOFF#` keys specifically use a **2-minute TTL** to manage active human control periods.
- **Purpose**: High-velocity coordination.

## Neural Lifecycle (Tiered Retention)

Serverless Claw implements an automatic, tiered data lifecycle using DynamoDB TTL. This ensures the system remains "lean" and fast without losing strategic intelligence.

| Tier             | Retention       | Category    | Purpose                                                     |
| :--------------- | :-------------- | :---------- | :---------------------------------------------------------- |
| **Intelligence** | **90-730 Days** | Strategic   | Lessons (90d), Facts (365d), Gaps (730d), Reputation (365d) |
| **Conversation** | **30 Days**     | Operational | Human chat history, Sessions (90d), Summaries (30d)         |
| **Agent Traces** | **30 Days**     | Mechanical  | Background agent loops                                      |
| **System Logs**  | **1 Day**       | Volatile    | Recovery, signals, handoffs, Health (7d)                    |

## Memory Operations

The memory system exports operations for each tier. These are available via `core/lib/memory/index.ts`:

### Gap Operations (`gap-operations.ts`)

| Function                         | Purpose                                         | Tier         |
| -------------------------------- | ----------------------------------------------- | ------------ |
| `getAllGaps(status)`             | Retrieve all capability gaps filtered by status | Intelligence |
| `setGap(gap)`                    | Create or update a strategic gap                | Intelligence |
| `getGap(gapId)`                  | Retrieve a specific gap by ID (via resolution)  | Intelligence |
| `updateGapStatus(gapId, status)` | Transition gap to new status (atomic)           | Intelligence |
| `acquireGapLock(gapId)`          | Acquire 30-min lock to prevent race conditions  | Intelligence |
| `releaseGapLock(gapId)`          | Release gap lock                                | Intelligence |
| `assignGapToTrack(gapId, track)` | Assign gap to evolution track                   | Intelligence |
| `recordMemoryHit(...)`           | Track memory access for pruning (Principle 13)  | Intelligence |
| `archiveStaleGaps()`             | Archive gaps not accessed in 14+ days           | Intelligence |

### Atomic Metadata Updates (Principle 13)

To prevent race conditions in highly concurrent swarm operations, the system enforces **Atomic State Integrity** (Principle 13). Instead of replacing entire objects, `atomicUpdateMetadata` performs field-level updates:

```typescript
// Unified update pattern for Gaps and Insights
await atomicUpdateMetadata(base, id, type, updates);
```

**Implementation Detail**: Uses granular `UpdateExpression: "SET metadata.hitCount = :hitCount"` to ensure atomic field isolation, preventing agents from overwriting each other's changes.

### Insight Operations (`insight-operations.ts`)

| Function                    | Purpose                                   | Tier         |
| --------------------------- | ----------------------------------------- | ------------ |
| `addMemory(insight)`        | Store a new memory/lesson                 | Intelligence |
| `searchInsights(query)`     | Semantic search across memories           | Intelligence |
| `recordMemoryHit(memoryId)` | Track memory access for pruning           | Intelligence |
| `addLesson(lesson)`         | Record a tactical lesson                  | Intelligence |
| `getLessons(userId)`        | Retrieve lessons for a user               | Intelligence |
| `recordFailedPlan(plan)`    | Record failed plan to prevent retries     | Intelligence |
| `getFailedPlans()`          | Retrieve all failed plans (anti-patterns) | Intelligence |
| `getLowUtilizationMemory()` | Find memories with 0 hits in 14+ days     | Intelligence |

### Session Operations (`session-operations.ts`)

| Function                                 | Purpose                       | Tier         |
| ---------------------------------------- | ----------------------------- | ------------ |
| `saveMessages(conversationId, messages)` | Store chat messages           | Conversation |
| `getMessages(conversationId)`            | Retrieve conversation history | Conversation |
| `createSession(userId, metadata)`        | Create new session            | Conversation |
| `updateSession(sessionId, updates)`      | Update session state          | Conversation |

### Workspace Operations (`workspace-operations.ts`)

| Function                                        | Purpose                      | Tier         |
| ----------------------------------------------- | ---------------------------- | ------------ |
| `createWorkspace(workspace)`                    | Create new workspace         | Intelligence |
| `getWorkspace(workspaceId)`                     | Retrieve workspace details   | Intelligence |
| `inviteMember(workspaceId, member)`             | Invite member to workspace   | Intelligence |
| `updateMemberRole(workspaceId, memberId, role)` | Update member permissions    | Intelligence |
| `removeMember(workspaceId, memberId)`           | Remove member from workspace | Intelligence |

### Collaboration Operations (`collaboration-operations.ts`)

| Function                                    | Purpose                      | Tier         |
| ------------------------------------------- | ---------------------------- | ------------ |
| `createCollaboration(session)`              | Create collaboration session | Conversation |
| `joinCollaboration(sessionId, participant)` | Join active collaboration    | Conversation |
| `writeToCollaboration(sessionId, message)`  | Write to shared context      | Conversation |
| `getCollaborationContext(sessionId)`        | Retrieve shared history      | Conversation |
| `closeCollaboration(sessionId)`             | End collaboration session    | Conversation |
| `updateCollaborationActivity(id)`           | Refresh activity timestamp   | Conversation |
| `findStaleCollaborations(timeout)`          | Find timed-out sessions      | Conversation |

### Reputation Operations (`reputation-operations.ts`)

| Function                             | Purpose                          | Tier         |
| ------------------------------------ | -------------------------------- | ------------ |
| `updateReputation(agentId, metrics)` | Update rolling 7-day reputation  | Intelligence |
| `getReputation(agentId)`             | Retrieve agent reputation score  | Intelligence |
| `computeCompositeScore(metrics)`     | Calculate reputation score (0-1) | Intelligence |

### 6. Session Safety & Truncation

To prevent sessions from exceeding DynamoDB's 400KB item size limit (which causes `ValidationException`), the `SessionStateManager` enforces a **Sliding Window Buffer** via atomic conditional updates.

- **Cap**: The system retains only the **last 50 pending messages** in the `pendingMessages` list.
- **Mechanism**: Uses atomic `ConditionExpression: 'size(pendingMessages) < :max'` - new messages are rejected if queue is full, preventing race conditions under concurrent load.
- **Circuit Breaker**: This prevents race conditions where two concurrent adds could both exceed 50 before truncation, ensuring consistent behavior under load.

#### Session Buffer Truncation Logic (Atomic)

```text
[ Incoming Message ]
       |
       v
[ addPendingMessage ]
       |
       v
[ Atomic Append with Conditional ]
       |
       +--> (size(pendingMessages) < 50) -- YES --> [ Append Message ]
       |
       +--> (size(pendingMessages) < 50) -- NO  --> [ REJECT: PENDING_QUEUE_FULL ]
```

### Clarification Operations (`clarification-operations.ts`)

| Function                                 | Purpose                      | Tier   |
| ---------------------------------------- | ---------------------------- | ------ |
| `requestClarification(taskId, question)` | Request user input           | System |
| `provideClarification(taskId, answer)`   | Provide clarification answer | System |
| `checkClarificationTimeout(taskId)`      | Check for timed-out requests | System |

> **Tip**: Use the `recallKnowledge(query)` tool for JIT retrieval instead of manually calling search functions. This handles hit tracking and caching automatically.

## Operational & Performance Metrics

Beyond conversation and knowledge, the system tracks its own performance to enable cost-aware routing and self-optimization.

#Every LLM invocation is recorded with granular metadata including token counts, duration, and success status.

- **Schema**: See `TokenUsage` interface in [`core/lib/types/memory.ts`](../../core/lib/types/memory.ts).

### Agent Performance Rollups

The `TokenTracker` maintains daily rollups for every agent, enabling the **Agent Router** to select candidates based on historical efficiency.

- **Partition Key**: `TOKEN_ROLLUP#<agentId>`
- **Sort Key**: `timestamp` (Day start)
- **Metrics**: `avgTokensPerInvocation`, `successRate`, `totalInvocations`, `createdAt`.

### Cost-Aware Routing

The `AgentRouter` uses these metrics to compute a **Composite Score**:
`Score = (Capability * SuccessRate) - (AvgTokens / 10000)`

This ensures the system naturally prefers faster, cheaper models (like GPT-4o-mini) for simple tasks while reserving powerful models (like Claude 3.5 Sonnet) for high-complexity strategic planning. The unified **AgentRouter** is located at `core/lib/routing/AgentRouter.ts`.

### Agent Reputation (Swarm Routing)

The `AgentRouter` now incorporates **reputation data** for swarm-aware routing decisions. On every `TASK_COMPLETED` or `TASK_FAILED` event, the `EventHandler` updates a rolling 7-day reputation record per agent.

- **Partition Key**: `REPUTATION#<agentId>`
- **Sort Key**: `0` (singleton per agent)
- **Metrics**: `tasksCompleted`, `tasksFailed`, `successRate`, `avgLatencyMs`, `lastActive`, `windowStart`
- **TTL**: 7 days (auto-expires stale records)

**Composite Reputation Score** (0-1):

```text
Score = (successRate * 0.6) + (latencyComponent * 0.25) + (recencyComponent * 0.15)
```

**Enhanced Routing Formula**:

```text
FinalScore = (0.6 * performanceScore) + (0.4 * reputationScore)
```

This ensures agents with proven track records (high success, low latency, recent activity) are preferred over untested or degraded agents.

## High-Performance Indexing (Hybrid Strategy)

The `MemoryTable` utilizes a dual Global Secondary Index (GSI) strategy to balance system-wide observability with high-performance, user-scoped retrieval.

### 1. TypeTimestampIndex (Global Observability)

Used for cross-user strategic monitoring, global lessons, and system-wide evolution tracking.

- **Partition Key**: `type` (e.g., 'GAP', 'LESSON', 'DISTILLED')
- **Sort Key**: `timestamp`
- **Purpose**: Powering the global Evolution dashboard and system-wide audits.

### 2. UserInsightIndex (User-Scoped Performance)

A specialized index optimized for real-time agent context retrieval and multi-tenant isolation. It eliminates cross-tenant scanning bottlenecks.

- **Scoping**: All `searchInsights` calls with a `userId` automatically leverage this index for O(1) partition targeting.
- **Flattened Schema**: To maximize retrieval speed, searchable metadata (`tags`, `orgId`, `createdAt`) are stored at the top level of the record, rather than nested in metadata.

The `MemoryTable` uses a flattened record model to ensure that searchable fields are directly accessible to GSIs and retrieval logic.

- **Schema**: See `MemoryRecord` interface in [`core/lib/types/memory.ts`](../../core/lib/types/memory.ts).

## Neural Pruning & Hit Tracking (The Self-Cleaning Loop)

Serverless Claw doesn't just remember; it strategically forgets. To prevent "cognitive bloat" and ensure the most relevant knowledge is always prioritized, the system implements an autonomous **Neural Pruning** loop.

### Hit Tracking Mechanism

Every time an agent recalls a memory using the `recallKnowledge` tool, the system performs an atomic "Hit" update in the background:

- **`hitCount`**: Increments a counter on the memory item.
- **`lastAccessed`**: Updates the timestamp to the current time.
- **`createdAt`**: Remains immutable to track the original memory creation time.

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
|  (Tracks hitCount, lastAccessed, and createdAt)       |
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

## Alternative Memory Storage Options (Evolution)

As Serverless Claw evolves, specialized storage engines may be used for certain memory tiers to balance cost, latency, and semantic capability.

### 1. Vector Storage (Semantic Brain)

For high-density RAG (Retrieval-Augmented Generation) and semantic lookup:

- **OpenSearch Serverless**: The standard AWS choice for vector embeddings. High performance but carries a higher baseline cost.
- **Pinecone (Serverless)**: Recommended for budget-conscious stages requiring high-quality semantic search across millions of facts.
- **Supabase (pgvector)**: Ideal for hybrid relational/semantic memory.

### 2. Graph Storage (The Collective)

- **Amazon Neptune Serverless**: Used for tracking complex relationships between agents, workspaces, and long-term memory threads.

## 🏗️ Proposed Hybrid Architecture

The "Brain" follows a tiered model:

1.  **Tier 1: Hot State (DynamoDB)**: Sub-50ms session state and atomic locks.
2.  **Tier 2: Semantic Memory (Vector DB)**: RAG and strategic gap identification.
3.  **Tier 3: Relational Memory (Graph DB)**: Complex agent-to-agent collaboration tracking.

---

## 🤝 Collaboration Operations

The system provides specialized state management for multi-party coordination through `CollaborationOps`.

### 1. Context Transition (Promotion Flow)

When a 1:1 session is promoted to a collaboration hub (e.g., inviting an auditor), the system performs an atomic transition:

- **Summarization**: The last 5 messages from the personal history are distilled into a context summary.
- **Seeding**: A new `shared#collab#` partition is initialized with a `SYSTEM` message containing the summary.
- **Invitation**: All requested agents and the `facilitator` are atomically added as participants.

### 2. Atomic State Integrity (Principle 13)

To prevent race conditions in multi-agent swarms, all collaboration operations are atomic:

- **Creation Integrity**: Enforces a `ConditionExpression: attribute_not_exists(userId)` check on the collaboration ID.
- **Participant Integrity**: Adding participants uses atomic `list_append` with existence checks.
- **Closing Integrity**: Updates status to `closed` and cleans up index entries to prevent orphaned sessions.

### 🍱 Partitioning Scheme

| PK (userId)          | Type       | Description                                            |
| :------------------- | :--------- | :----------------------------------------------------- |
| `shared#collab#<ID>` | `MESSAGE`  | Shared message history for multi-agent hubs.           |
| `COLLABORATION#<ID>` | `METADATA` | Core configuration, owner, and participant roster.     |
| `COLLAB_INDEX#<PID>` | `INDEX`    | Shard for participant lookup (List my collaborations). |
