> **Navigation**: [← Index Hub](../../INDEX.md)

# Multi-Party Collaboration & Workspaces

Serverless Claw supports complex coordination between multiple humans and multiple agents through **Workspaces** and **Moderated Sessions**.

## 👥 Multi-Party Collaboration

When tasks require negotiation or peer review between multiple agents, the system creates a **Shared Collaboration Session** moderated by the **Facilitator Agent**.

### Moderation Flow

The Facilitator is automatically injected as an `editor` participant and woken up via `emitTypedEvent` on every collaboration creation.

```text
  Initiator (Planner)       createCollab()         AgentBus (EB)        Facilitator           Sub-Agents (xN)       DynamoDB
         |                      |                      |                    |                      |                    |
         +-- (1) createCollab ->|                      |                    |                      |                    |
         |                      +--- [AUTO-INJECT] --->|                    |                      |                    |
         |                      |   Facilitator as     |                    |                      |                    |
         |                      |   'editor'           |                    |                      |                    |
         |                      |                      +-- facilitator_task>|                      |                    |
         |                      |                      |   (Wake Up)        |                      |                    |
         |                      +------------------------------------------+--------------------->|                    |
         |                      |                      |                    |                 [CREATE Session]          |
         |                      |                      |                    |                      |                    |
         +-- (2) writeTo ->     |                      |                    +-- getCollabCtx ---->|                    |
         |    (Plan/Prompt)     |                      |                    |                    +-- join ----------->|
         |                      |                      |                    |                    |                    |
         |                      |                      |           [MODERATOR LOOP]              |                    |
         |                      |                      |                    +-- getCollabCtx --->|                    |
         |                      |                      |                    +-- writeTo ------->|  [READ Context]    |
         |                      |                      |                    |  (Summaries,      |                    |
         |                      |                      |                    |   turn prompts)   |  [WRITE Verdict]   |
         |                      |                      |                    |                    |                    |
         |             [ CONSENSUS REACHED ]           |                    |                    |                    |
         |                      |                      |                    |                    |                    |
         +-- (3) closeCollab -->|                      |                    +--------------------+--------------------+
         |    (Owner only)      |                      |                    |                    |              [ARCHIVE]
         v                      v                      v                    v                      v                    v
```

---

## 🏢 Workspace Architecture

A **Workspace** is a shared context primitive providing multi-tenant capability with Role-Based Access Control (RBAC).

### Role Hierarchy

- **Owner**: Full control over members, billing, and workspace deletion.
- **Admin**: Can invite members and manage agent rosters.
- **Collaborator**: Can initiate sessions and interact with agents.
- **Observer**: Read-only access to conversation history and traces.

### Member Profiles

Humans can connect to a workspace via multiple channels:

- Telegram / Discord / Slack
- ClawCenter Dashboard
- Email (for digests)

### Key Tools

- `createWorkspace`, `getWorkspace`, `inviteMember`
- `createCollaboration`, `joinCollaboration`, `writeToCollaboration`

- **Implementation**: See [`core/lib/session/identity.ts`](../../core/lib/session/identity.ts) and [`core/lib/memory/workspace-operations.ts`](../../core/lib/memory/workspace-operations.ts).

---

## 🏢 Workspace & Identity Management

Serverless Claw supports multi-human multi-agent collaboration through **Workspaces** — shared context primitives with role-based access control.

### Identity & Access Layer

The `IdentityManager` (`core/lib/identity.ts`) provides:

- **Authentication**: Session-based auth via Telegram, Dashboard, or API key.
- **RBAC**: Role-based permission enforcement inside a workspace.
- **Multi-Tenancy**: Users can belong to multiple workspaces with different roles.
- **Resource Control**: Fine-grained access to specific agents, traces, and configurations.

### Member Roles

| Role             | Permissions                                            |
| :--------------- | :----------------------------------------------------- |
| **Owner**        | Full access, can delete workspace, manage all members. |
| **Admin**        | Can invite/remove members, manage collaborations.      |
| **Collaborator** | Can participate in sessions, write to shared context.  |
| **Observer**     | Read-only access to sessions and history.              |

### Workspace-Aware Notifications

When a `workspaceId` is associated with a collaboration, the system automatically:

1. Adds all active workspace members (agents and humans) as participants.
2. Routes notifications to human members via their configured channels (Telegram, Discord, Dashboard).

---

# Session Storage vs Traces

We discussed whether the new "multi-party collaboration" sessions should be the default way agents communicate.

**Conclusion: No, it should not be the default.**

We have a dual-mode system:

1. **Transactional (Traces & EventBridge):** The default for 80% of tasks. One agent sends a strict task payload to another agent, which completes it and returns a result. It is fast, isolated, and cheap. The `TRACE#` system tracks this execution graph.
2. **Session-Based (DynamoDB Collaboration):** Opt-in for 20% of complex tasks requiring negotiation, peer review, or human-in-the-loop discussion. All participants read from and write to a shared message history (`shared#collab#...`).

**Why not default?**
Putting all agent chatter into a shared session causes "context dilution," slowing down agents, wasting tokens, and increasing hallucination risks.

---

# Managing Boundaries & Coordination in Session Mode

In a shared session, without explicit boundaries, agents might talk endlessly or talk over each other.

Coordination requires specific roles and mechanisms:

### 1. The Owner/Moderator Role

Every collaboration has an `owner` (defined in the `Collaboration` type). The owner acts as the moderator. For example, if the Strategic Planner initiates a Council Review session:

- The **Planner (Owner)** opens the session and drops the initial proposal.
- The **Critics (Participants)** review and drop their thoughts.
- The **Planner (Owner)** is responsible for analyzing the feedback, driving a conclusion, and calling `closeCollaboration`.

### 2. Turn-Taking vs Concurrent Writes

Unlike human chats where everyone types at once, AI swarms need structured turn-taking to prevent infinite loops.

- **Implicit Turn-Taking:** A message from Agent A triggers a webhook or event that wakes up Agent B.
- **Explicit Tasking:** Even within a session, the Owner can direct specific agents by mentioning them, preventing everyone from responding to every message.

### 3. Conclusion & Extraction

A session must result in a structured output (a plan, a fix, a decision). The Owner is responsible for:

1. Synthesizing the final decision.
2. Executing a tool (like `triggerDeployment` or `dispatchTask` to a Coder).
3. Closing the collaboration session using the `closeCollaboration` tool so agents stop monitoring it.

This mirrors how the existing `ParallelAggregator` works for transactional fan-outs, but applies it to an iterative chat context.

### Council of Agents (Peer Review Gate)

For high-impact strategic plans, the system introduces a **Council of Agents** — a peer review gate that dispatches the plan to three specialized **Critic Agents** for independent review before execution.

The Council uses a **Collaboration Session** for shared context. The **Facilitator Agent** is automatically injected to moderate the review discussion, ensure all critics have submitted their verdicts, and summarize the collective assessment.

#### Trigger Conditions

The Council is activated when any of these metrics exceed the threshold (default: 8/10):

| Metric         | Source       | Threshold |
| -------------- | ------------ | --------- |
| **Impact**     | Gap metadata | ≥ 8       |
| **Risk**       | Gap metadata | ≥ 8       |
| **Complexity** | Gap metadata | ≥ 8       |

If all metrics are below the threshold, the Planner dispatches directly to the Coder (bypassing Council).

#### Review Modes

The Critic Agent operates in three modes, each dispatched as a parallel task:

| Mode            | Focus                                        | Red Flags                                                     |
| --------------- | -------------------------------------------- | ------------------------------------------------------------- |
| **Security**    | Injection, auth bypass, data exposure        | Unsanitized inputs, hardcoded secrets, overly permissive IAM  |
| **Performance** | Latency, memory, cold start, cost            | Unbounded loops, missing pagination, N+1 queries              |
| **Architect**   | Design coherence, dependencies, blast radius | Circular dependencies, tight coupling, missing error handling |

#### Flow

```text
Planner (impact >= 8)
    |
    +--- (1) createCollab ("Council Review")
    |
    +--- (2) writeToCollab (Strategic Plan)
    |
    +--- (3) PARALLEL_TASK_DISPATCH (3 critic tasks + collabId)
    |         |
    |         +--- [Security Review] ----+
    |         +--- [Performance Review] -+---> [Aggregation (agent_guided)]
    |         +--- [Architect Review] --+      (Reads shared session context)
    |                                               |
    |                                               v
    +--- (4) [EH ROUTE] <------------------ [CONTINUATION_TASK]
    |         |
    |         v
    +--- (5) [THINK: Verdict?]
    |         |
    |         +--- (6) closeCollab (Archive)
    |         |
    |         +-----------+-----------+
    |         |                       |
    |   [APPROVED]              [REJECTED/CONDITIONAL]
    |         |                       |
    |         v                       v
    |   [dispatch to Coder]      [revise plan or escalate to HITL]
```

#### Aggregation

The Council uses `agent_guided` aggregation with a prompt that synthesizes all three reviews:

- **APPROVED**: No critical or high severity findings
- **REJECTED**: Any critical finding exists — the plan MUST NOT proceed
- **CONDITIONAL**: High severity findings that can be mitigated — proceed with fixes

#### Auto vs HITL Delineation

| Condition                                         | Behavior                                  |
| ------------------------------------------------- | ----------------------------------------- |
| `impact < 8` AND `evolution_mode = AUTO`          | Skip Council → dispatch directly to Coder |
| `impact >= 8` OR `risk >= 8` OR `complexity >= 8` | Council Required → parallel review        |
| `evolution_mode = HITL`                           | Council + Human Approval                  |
| Any Critical finding                              | Auto-REJECT → back to Planner             |

### Multi-Party Collaboration (Shared Sessions)

For complex tasks that require negotiation, peer review, or iterative brainstorming between multiple agents (and humans), the system provides a **Shared Collaboration Session** model. Unlike the default transactional handoff, this model allows all participants to share a persistent conversation history.

The **Facilitator Agent** is automatically injected as an `editor` participant when any collaboration is created. It is immediately woken up via a `facilitator_task` event to begin moderating the session.

#### Roles and Responsibilities

- **Owner (Moderator)**: The agent that created the session. Responsible for driving consensus, extracting the final structured result, and closing the session.
- **Facilitator (Auto-injected)**: Dedicated session moderator. Ensures turn-taking, summarizes discussions, and drives consensus. Cannot close the session (only the Owner can).
- **Participant**: An agent or human invited to the session. Can read history and append messages.

#### Flow

```text
Initiator (Planner)     Collaboration Tool      AgentBus (EB)      Facilitator (Auto)    Sub-Agents (xN)      Shared Session (DDB)
       |                      |                      |                      |                    |                    |
       +-- createCollab ----->|                      |                      |                    |                    |
       |                      |--- [AUTO-INJECT] ----+--------------------->|                    |                    |
       |                      |   Facilitator as     |                      |                    |                    |
       |                      |   'editor' participant                      |                    |                    |
       |   (Owner: Planner) --+----------------------+                      +--------------------+------------------->|
       |                      |                      |                      |                    |  [INIT shared#collab#ID]
       |                      |                      |                      |                    |                    |
       |                      |              [EMIT facilitator_task] ------->                    |                    |
       |                      |              (Wake up Facilitator)          |                    |                    |
       |                      |                      |                      |                    |                    |
       +-- writeToCollab -----+----------------------+                      +--------------------+------------------->|
       |   (Initial Prompt) --+                      |                      |                    |  [ADD Message]     |
       |                      |                      |                      |                    |                    |
       |                      |             [ AS AGENTS ARE NOTIFIED ]      |                    |                    |
       |                      |                      |<--- TASK_EVENT ------+                    |                    |
       |                      |                      |<--- TASK_EVENT ------+--------------------+                    |
       |                      |                      | (collabId)           |                    |                    |
       |                      |                      |                      +-- getCollabCtx --->|                    |
       |                      |                      |                      |                    +-- joinCollab ---->|
       |                      |                      |                      |                    |                    |
       |                      |              [ FACILITATOR MODERATES ]      |                    |                    |
       |                      |                      |                      +-- getCollabCtx --->|                    |
       |                      |                      |                      +-- writeToCollab -->|                    |
       |                      |                      |                      |  (Summaries,      |                    |
       |                      |                      |                      |   turn prompts)   |                    |
       |                      |                      |                      |                    |                    |
       |                      |                      |                      |                    +-- getHistory ---->|
       |                      |                      |                      |                    +-- writeToCollab ->|
       |                      |                      |                      |                    |                    |
       |             [ ITERATIVE DISCUSSION ]        |                      |                    |                    |
       |                      |                      |                      |                    |                    |
       +-- closeCollab <------+----------------------+                      +--------------------+--------------------+
           (Final decision — only Owner can close)                                                                         [ARCHIVE Session]
```

#### When to use

- **Council of Agents**: Shared discussion between Security, Performance, and Architect critics (Facilitator moderates).
- **Human-in-the-loop Debugging**: Real-time collaboration between a human and multiple specialized agents.
- **Ambiguity Resolution**: When a task is too complex for a single transactional exchange.

### Workspace-Aware Multi-Human Collaboration

When a `workspaceId` is provided to `createCollaboration`, the system automatically:

1. Adds all active workspace members (agents and humans) as collaboration participants (editor/viewer based on role)
2. Routes notifications to all human members via their configured channels

```text
SuperClaw (Lambda)    Workspace (DDB)     Collab Tool       Notifier (Lambda)     Human Channels
       |                    |                  |                    |                    |
       +-- createCollab --->|                  |                    |                    |
       |   (workspaceId:X)  |                  |                    |                    |
       |                    |                  |                    |                    |
       |             [LOAD MEMBERS]            |                    |                    |
       |                    |                  |                    |                    |
       |             +------v------+           |                    |                    |
       |             | Agents (xN) |           |                    |                    |
       |             | Humans (xM) |           |                    |                    |
       |             +------+------+           |                    |                    |
       |                    |                  |                    |                    |
       |                    +-- auto-add ----->|                    |                    |
       |                    |   agents as      |                    |                    |
       |                    |   participants   |                    |                    |
       |                    |                  |                    |                    |
       |                    |             [SESSION EVENTS]          |                    |
       |                    |                  +-- OUTBOUND ------->|                    |
       |                    |                  |   (workspaceId)    |                    |
       |                    |                  |                    |                    |
       |                    |                  |             [FAN-OUT per member]        |
       |                    |                  |                    +-- Telegram ------->|
       |                    |                  |                    +-- Discord -------->|
       |                    |                  |                    +-- Dashboard ------>|
```
