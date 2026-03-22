# Serverless Claw — Remaining Phases Implementation Plan

> **Generated**: 2026-03-22 | **Phases**: 3–9 | **Prerequisites**: Phase 1 (Session Locking→Message Queue) and Phase 2 (Event Reliability) are complete.

---

## Executive Summary

This plan covers 7 remaining phases ordered by dependency and priority. Each phase includes specific file changes, DynamoDB schema additions, and test requirements. Phases are designed to be implementable incrementally — each phase is independently deployable.

| Phase                                | Priority | Est. Files | Key Risk                                       |
| ------------------------------------ | -------- | ---------- | ---------------------------------------------- |
| 3: Clarification Protocol Resilience | High     | 6          | Critical bug: missing EventBridge subscription |
| 4: Parallel Dispatch Improvements    | Medium   | 4          | Barrier timeout not implemented                |
| 5: Circuit Breaker Enhancement       | Medium   | 4          | No half-open state or time-windowing           |
| 6: Context Management                | Medium   | 3          | No compression or provider-specific strategies |
| ✅ 7: Self-Optimization                 | Low      | 4          | No failure pattern learning exists             |
| 8: Configurability & Flexibility     | Low      | 3          | No config versioning or feature flags          |
| 9: Observability & Metrics           | Low      | 4          | Basic CloudWatch infra exists but unused       |

---

## Phase 3: Clarification Protocol Resilience (High)

### Problem Statement

1. **Critical Bug**: `CLARIFICATION_REQUEST` is NOT in the EventBridge subscription at `infra/agents.ts:246-260`. Clarification events are silently dropped or caught by the worker agent's `anything-but` pattern.
2. No timeout for clarification requests — agents can hang forever.
3. No orphan detection when initiator doesn't respond.
4. No escalation path when timeout occurs.
5. No crash recovery — if the handler Lambda times out mid-clarification, state is lost.

### Implementation Steps

#### Step 3.0 — Fix Missing EventBridge Subscription (Bug Fix)

**File**: `infra/agents.ts:246-260`

Add `EventType.CLARIFICATION_REQUEST` to the `detailType` array in `SystemBuildFailedSubscriber`:

```typescript
detailType: [
  EventType.SYSTEM_BUILD_FAILED,
  EventType.SYSTEM_BUILD_SUCCESS,
  EventType.TASK_COMPLETED,
  EventType.TASK_FAILED,
  EventType.SYSTEM_HEALTH_REPORT,
  EventType.HEARTBEAT_PROACTIVE,
  EventType.CONTINUATION_TASK,
  EventType.TASK_CANCELLED,
  EventType.PARALLEL_TASK_DISPATCH,
  EventType.CLARIFICATION_REQUEST, // <-- ADD THIS
],
```

Also add `EventType.CLARIFICATION_REQUEST` to the worker agent's `anything-but` exclusion list at line 345-362.

#### Step 3.1 — Add Configurable Timeout

**File**: `core/lib/config-defaults.ts`

Add new config entries:

```typescript
CLARIFICATION_TIMEOUT_MS: {
  code: 300000, // 5 minutes
  hotSwappable: true,
  configKey: 'clarification_timeout_ms',
  description: 'Timeout for clarification requests before escalation.',
},
CLARIFICATION_MAX_RETRIES: {
  code: 1,
  hotSwappable: true,
  configKey: 'clarification_max_retries',
  description: 'Max clarification retries before marking task failed.',
},
```

**File**: `core/lib/constants.ts` — Add `CLARIFICATION_TIMEOUT_MS` to `DYNAMO_KEYS`.

#### Step 3.2 — State Persistence in DynamoDB

**File**: `core/lib/memory/clarification-operations.ts` (NEW)

Create clarification state operations:

```typescript
// DynamoDB key pattern: userId=CLARIFICATION#<traceId>#<agentId>, timestamp=<createdAt>
interface ClarificationState {
  userId: string; // CLARIFICATION#<traceId>#<agentId>
  timestamp: number; // createdAt
  type: 'CLARIFICATION_PENDING';
  agentId: string;
  initiatorId: string;
  question: string;
  originalTask: string;
  traceId: string;
  sessionId?: string;
  depth: number;
  status: 'pending' | 'answered' | 'timed_out' | 'escalated';
  createdAt: number;
  expiresAt: number; // TTL = createdAt + timeout + buffer
  retryCount: number;
}
```

Operations:

- `saveClarificationRequest(state)` — PutItem on `seekClarification`
- `getClarificationRequest(traceId, agentId)` — GetItem for crash recovery
- `updateClarificationStatus(traceId, agentId, status)` — UpdateItem
- `findExpiredClarifications()` — Query by TTL or GSI scan for orphan detection

**File**: `core/lib/memory.ts` — Add clarification operations to `DynamoMemory` facade.

#### Step 3.3 — Update Clarification Handler with Timeout + Persistence

**File**: `core/handlers/events/clarification-handler.ts`

Modify `handleClarificationRequest`:

1. Save clarification state to DynamoDB before waking initiator
2. Schedule an EventBridge Scheduler one-shot event for `(now + timeout)`
3. The scheduled event emits a `CLARIFICATION_TIMEOUT` event type

**File**: `core/lib/types/agent.ts` — Add `CLARIFICATION_TIMEOUT` to `EventType` enum.

#### Step 3.4 — Clarification Timeout Handler

**File**: `core/handlers/events/clarification-timeout-handler.ts` (NEW)

```
1. Look up clarification state by traceId + agentId
2. If status == 'answered': no-op (already resolved)
3. If retryCount < maxRetries:
   - Re-emit CLARIFICATION_REQUEST with retryCount + 1
   - Wake initiator again with "RETRY" prefix
4. If retryCount >= maxRetries:
   - Update status to 'timed_out'
   - Emit TASK_FAILED to the requesting agent
   - Emit OUTBOUND_MESSAGE to SuperClaw for escalation
   - Emit dashboard notification via Realtime Bridge
```

**File**: `infra/agents.ts` — Add subscription for `CLARIFICATION_TIMEOUT` to the EventHandler.

#### Step 3.5 — Update provideClarification to Mark Resolved

**File**: `core/tools/knowledge-agent.ts:166-201`

In `PROVIDE_CLARIFICATION.execute`, after emitting `CONTINUATION_TASK`, call `updateClarificationStatus(traceId, agentId, 'answered')`.

#### Step 3.6 — Tests

**File**: `core/handlers/events_clarification.test.ts` (UPDATE)

Add tests for:

- Timeout escalation path
- Retry logic
- Crash recovery (re-read state from DynamoDB)
- Idempotent timeout handling (double-fire safe)

### DynamoDB Schema Changes

- New item type in MemoryTable: `CLARIFICATION_PENDING`
- Key: `userId=CLARIFICATION#<traceId>#<agentId>`, `timestamp=<createdAt>`
- TTL: `expiresAt = createdAt + timeout + 1 hour buffer`
- GSI query: `type=CLARIFICATION_PENDING` for orphan detection

### Config Changes

- `clarification_timeout_ms` (hot-swappable, default 300000)
- `clarification_max_retries` (hot-swappable, default 1)

---

## Phase 4: Parallel Dispatch Improvements (Medium)

### Problem Statement

1. `barrierTimeoutMs` parameter is defined but has NO implementation — straggler tasks block indefinitely.
2. No partial success thresholds — all-or-nothing semantics.
3. `TASK_CANCELLED` event exists but isn't wired to parallel task agents.
4. No progress tracking for long-running parallel tasks.

### Implementation Steps

#### Step 4.1 — Implement Barrier Timeout

**File**: `core/handlers/events/parallel-handler.ts`

After dispatching all tasks, schedule an EventBridge one-shot timer for `barrierTimeoutMs`:

```typescript
// After dispatch loop
const timeoutMs = barrierTimeoutMs ?? BARRIER_TIMEOUT_MS;
await scheduleBarrierTimeout(userId, traceId, initiatorId, sessionId, timeoutMs, tasks.length);
```

**File**: `core/lib/scheduler.ts` — Add `scheduleBarrierTimeout()` using EventBridge Scheduler.

**New Event**: `PARALLEL_BARRIER_TIMEOUT` added to `EventType` enum.

**File**: `core/handlers/events/parallel-barrier-timeout-handler.ts` (NEW)

```
1. Read aggregator state for traceId
2. If already complete (completedCount >= taskCount): no-op
3. Mark remaining tasks as 'timeout' in results
4. Determine overall status based on partial success threshold
5. Emit PARALLEL_TASK_COMPLETED with available results
```

#### Step 4.2 — Configurable Partial Success Threshold

**File**: `core/lib/config-defaults.ts`

```typescript
PARALLEL_PARTIAL_SUCCESS_THRESHOLD: {
  code: 0.5, // 50% of tasks must succeed
  hotSwappable: true,
  configKey: 'parallel_partial_success_threshold',
  description: 'Fraction of parallel tasks that must succeed for overall status to be "partial" instead of "failed".',
},
```

**File**: `core/handlers/events/task-result-handler.ts` — Update `overallStatus` calculation to use the threshold:

```typescript
const successCount = aggregateState.results.filter(r => r.status === 'success').length;
const threshold = /* fetch from config */;
const successRate = successCount / aggregateState.taskCount;

const overallStatus = successRate === 1 ? 'success'
  : successRate >= threshold ? 'partial'
  : 'failed';
```

#### Step 4.3 — Wire TASK_CANCELLED to Parallel Tasks

**File**: `core/handlers/events/parallel-handler.ts`

When a parallel dispatch is initiated, save task-to-agent mapping in the aggregator record. When `TASK_CANCELLED` is received:

1. Look up all agents from the parallel dispatch
2. Emit individual `TASK_CANCELLED` events to each agent's event type

**File**: `core/handlers/events/cancellation-handler.ts`

Add a check in agent processing loops (via `core/lib/agent.ts`) to call `isTaskCancelled()` at each iteration and abort if true.

#### Step 4.4 — Progress Tracking

**File**: `core/lib/agent/parallel-aggregator.ts`

Add `progress` field to aggregator state:

```typescript
interface ParallelProgress {
  taskId: string;
  agentId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progressPercent?: number;
  lastUpdate: number;
}
```

Add `updateProgress()` method that updates individual task progress without incrementing `completedCount`.

**File**: `core/tools/definitions/progress.ts` (NEW) — Optional tool `reportProgress(percent, message)` that agents can call during long tasks.

### DynamoDB Schema Changes

- Parallel aggregator record gains: `tasks[]` (mapping of taskId→agentId), `barrierTimeoutAt` (timestamp)
- New field in results: `progressPercent`

### Config Changes

- `parallel_partial_success_threshold` (hot-swappable, default 0.5)

---

## Phase 5: Circuit Breaker Enhancement (Medium)

### Problem Statement

1. Circuit breaker is count-only (consecutive failures) — no time-windowing.
2. No half-open state for gradual recovery — it's all-or-nothing.
3. No differentiation between emergency rollback and autonomous deploy.
4. No correlation with system health metrics (error rate, latency).

### Implementation Steps

#### Step 5.1 — Time-Based Sliding Window

**File**: `core/lib/circuit-breaker.ts` (NEW)

Create a dedicated `CircuitBreaker` class:

```typescript
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half_open';
  failureWindow: Array<{ timestamp: number; type: 'deploy' | 'health' }>;
  successWindow: Array<{ timestamp: number }>;
  lastFailureTime: number;
  lastStateChange: number;
  halfOpenProbeCount: number;
}

class CircuitBreaker {
  // Sliding window: track failures in last N minutes
  private static readonly WINDOW_MS = 3600000; // 1 hour

  async recordFailure(type: 'deploy' | 'health'): Promise<CircuitBreakerState>;
  async recordSuccess(): Promise<CircuitBreakerState>;
  async canProceed(deployType: 'autonomous' | 'emergency'): Promise<boolean>;
  async getState(): Promise<CircuitBreakerState>;
}
```

State stored in ConfigTable under key `circuit_breaker_state`.

#### Step 5.2 — Half-Open State

When circuit is `open`:

- After a configurable cooldown (default: 10 min), transition to `half_open`
- In `half_open`, allow 1 probe deployment
- If probe succeeds → `closed` (reset)
- If probe fails → `open` (reset cooldown)

**File**: `core/lib/config-defaults.ts`

```typescript
CIRCUIT_BREAKER_WINDOW_MS: {
  code: 3600000, // 1 hour
  hotSwappable: true,
  configKey: 'circuit_breaker_window_ms',
  description: 'Sliding window for circuit breaker failure tracking.',
},
CIRCUIT_BREAKER_COOLDOWN_MS: {
  code: 600000, // 10 minutes
  hotSwappable: true,
  configKey: 'circuit_breaker_cooldown_ms',
  description: 'Cooldown before transitioning from open to half-open.',
},
CIRCUIT_BREAKER_HALF_OPEN_MAX: {
  code: 1,
  hotSwappable: true,
  configKey: 'circuit_breaker_half_open_max',
  description: 'Max probe deployments allowed in half-open state.',
},
```

#### Step 5.3 — Emergency vs Autonomous Differentiation

**File**: `core/tools/deployment.ts`

Modify `triggerDeployment` to accept `deployType: 'autonomous' | 'emergency'`:

- `autonomous` deployments are subject to full circuit breaker
- `emergency` deployments bypass the circuit breaker but still log and emit metrics

**File**: `core/lib/circuit-breaker.ts`

```typescript
async canProceed(deployType: 'autonomous' | 'emergency'): Promise<{ allowed: boolean; reason?: string }> {
  if (deployType === 'emergency') {
    // Log warning but allow
    return { allowed: true };
  }
  // Full circuit breaker logic for autonomous
}
```

#### Step 5.4 — Health Metric Correlation

**File**: `core/handlers/monitor.ts`

Update build monitor to:

1. Record failures in sliding window circuit breaker (not just consecutive count)
2. Also record health check failures from `recovery.ts`
3. Factor in deployment latency as a health signal

**File**: `core/handlers/recovery.ts`

Update Dead Man's Switch to report failures to the sliding window circuit breaker.

#### Step 5.5 — Migrate Existing Circuit Breaker

**File**: `core/handlers/monitor.ts:129-154` — Replace consecutive failure counter with `CircuitBreaker.recordFailure()`.
**File**: `core/tools/deployment.ts:40-59` — Replace daily counter with `CircuitBreaker.canProceed()`.

Keep the daily deploy limit as a separate safety layer (defense in depth).

### Config Changes

- `circuit_breaker_window_ms` (hot-swappable, default 3600000)
- `circuit_breaker_cooldown_ms` (hot-swappable, default 600000)
- `circuit_breaker_half_open_max` (hot-swappable, default 1)

---

## Phase 6: Context Management (Medium)

### Problem Statement

1. ContextManager uses simple sliding window — no compression for long conversations.
2. No provider-specific context strategies (GPT-5.4 vs Claude 4.6 have different context windows and behaviors).
3. No context priority scoring — all messages treated equally.
4. No context budget allocation in multi-agent scenarios.

### Implementation Steps

#### Step 6.1 — Context Compression (Summarization + Key Facts)

**File**: `core/lib/agent/context-manager.ts`

Enhance `getManagedContext` to support a three-tier strategy:

```typescript
interface ContextTier {
  systemPrompt: Message;           // Always included
  compressedHistory?: Message;     // Summarized older messages (key facts)
  activeWindow: Message[];         // Recent messages (sliding window)
  toolResults?: Message[];         // Recent tool outputs (high priority)
}

static async getManagedContext(
  history: Message[],
  summary: string | null,
  systemPrompt: string,
  limit: number,
  options?: {
    compressionLevel?: 'none' | 'light' | 'aggressive';
    providerContextWindow?: number;
  }
): Promise<ManagedContext>
```

When `needsSummarization` is true, instead of just using the existing summary:

1. Extract **key facts** (entities, decisions, constraints) from older messages
2. Create a `compressedHistory` message: `[COMPRESSED_CONTEXT]: Key facts: ...`
3. Active window = most recent messages that fit in remaining budget

#### Step 6.2 — Provider-Specific Context Strategies

**File**: `core/lib/agent/context-strategies.ts` (NEW)

```typescript
interface ProviderContextStrategy {
  maxContextTokens: number;
  reservedResponseTokens: number;
  compressionTriggerPercent: number; // When to start compressing
  toolResultPriority: 'high' | 'normal'; // Keep tool results or compress them
}

const PROVIDER_STRATEGIES: Record<string, ProviderContextStrategy> = {
  'gpt-5.4': {
    maxContextTokens: 128000,
    reservedResponseTokens: 16384,
    compressionTriggerPercent: 75,
    toolResultPriority: 'high',
  },
  'gpt-5.4-mini': {
    maxContextTokens: 128000,
    reservedResponseTokens: 8192,
    compressionTriggerPercent: 80,
    toolResultPriority: 'normal',
  },
  'claude-sonnet-4-6': {
    maxContextTokens: 200000,
    reservedResponseTokens: 16384,
    compressionTriggerPercent: 80,
    toolResultPriority: 'high',
  },
  default: {
    maxContextTokens: 64000,
    reservedResponseTokens: 4096,
    compressionTriggerPercent: 80,
    toolResultPriority: 'normal',
  },
};
```

**File**: `core/lib/agent/context-manager.ts` — Use strategy in `getManagedContext`.

#### Step 6.3 — Context Priority Scoring

**File**: `core/lib/agent/context-manager.ts`

Add message priority scoring:

```typescript
function scoreMessage(msg: Message): number {
  // Recent messages: high priority
  // Tool results with errors: highest priority
  // User questions: high priority
  // System messages: medium priority
  // Old assistant responses: low priority
}
```

Use scores to decide which messages to keep vs compress when budget is tight.

#### Step 6.4 — Multi-Agent Context Budget

**File**: `core/lib/agent/context-manager.ts`

When multiple agents share a conversation (e.g., SuperClaw + Coder), allocate context budget:

```typescript
static allocateBudget(
  totalBudget: number,
  agents: Array<{ id: string; role: 'orchestrator' | 'specialist' | 'observer' }>
): Record<string, number> {
  // Orchestrator gets 50%, specialist gets 40%, observer gets 10%
}
```

This is used when building context for continuation tasks that include prior agent history.

### Config Changes

- Uses existing `MAX_CONTEXT_LENGTH` from constants
- Provider strategies are code-level (not hot-swappable) since they depend on provider capabilities

---

## Phase 7: Self-Optimization (Low)

### Problem Statement

1. No automated tool optimization based on usage patterns.
2. No failure pattern learning (negative memory tier).
3. No performance-based agent routing.
4. No cost-aware optimization (token usage tracking per tool).

### Implementation Steps

#### Step 7.1 — Failure Pattern Learning (FAILED_PLANS#)

**File**: `core/lib/memory/insight-operations.ts`

Add new memory prefix `FAILED_PLANS#`:

```typescript
async recordFailedPlan(
  userId: string,
  planId: string,
  planContent: string,
  failureReason: string,
  metadata?: InsightMetadata
): Promise<void>

async getFailedPlans(userId: string, limit?: number): Promise<MemoryInsight[]>
```

**File**: `core/agents/cognition-reflector.ts` — When analyzing failures, check `FAILED_PLANS#` for similar past failures before logging new gaps.

**File**: `core/agents/strategic-planner.ts` — When designing plans, query `FAILED_PLANS#` to avoid repeating failed strategies.

#### Step 7.2 — Performance-Based Agent Routing

**File**: `core/lib/agent-routing.ts` (NEW)

Track per-agent success rate and latency:

```typescript
interface AgentPerformanceMetrics {
  agentId: string;
  totalInvocations: number;
  successCount: number;
  avgDurationMs: number;
  lastUpdated: number;
}

class AgentRouter {
  async recordCompletion(agentId: string, success: boolean, durationMs: number): Promise<void>;
  async getMetrics(agentId: string): Promise<AgentPerformanceMetrics>;
  async selectBestAgent(candidates: string[], taskType: string): Promise<string>;
}
```

Store in ConfigTable under key `agent_performance_<agentId>`.

#### Step 7.3 — Token Usage Tracking per Tool

**File**: `core/lib/agent.ts`

Track token usage per tool invocation:

```typescript
// In the executor loop, after each tool call:
await registry.recordToolUsage(toolName, agentId, {
  inputTokens: estimatedInputTokens,
  outputTokens: estimatedOutputTokens,
  durationMs: toolDuration,
});
```

**File**: `core/lib/registry.ts` — Enhance `recordToolUsage` to accept optional token/duration data.

#### Step 7.4 — Automated Tool Optimization

**File**: `core/agents/strategic-planner.ts`

In the 48-hour strategic review, add optimization recommendations:

- Tools with high token cost but low success rate → suggest replacement
- Tools with overlapping capabilities → suggest consolidation
- Tools never used → suggest pruning (already exists via efficiency loop)

### DynamoDB Schema Changes

- New item type: `FAILED_PLANS#<planId>` in MemoryTable
- Enhanced `tool_usage` records with `inputTokens`, `outputTokens`, `durationMs`

---

## Phase 8: Configurability & Flexibility (Low)

### Problem Statement

1. No per-agent configuration overrides (all agents share global config).
2. No configuration versioning or rollback.
3. No feature flags for gradual rollout.
4. No A/B testing capabilities.

### Implementation Steps

#### Step 8.1 — Per-Agent Configuration Overrides

**File**: `core/lib/registry/config.ts`

Add agent-specific config support:

```typescript
// ConfigTable key pattern: agent_config_<agentId>_<configKey>
async function getAgentConfig<T>(agentId: string, key: string, fallback: T): Promise<T> {
  const agentValue = await getRawConfig(`agent_config_${agentId}_${key}`);
  return agentValue ?? fallback;
}
```

**File**: `core/lib/registry.ts` — In `getAgentConfig`, merge agent-specific overrides on top of global config.

#### Step 8.2 — Configuration Versioning with Rollback

**File**: `core/lib/config-versioning.ts` (NEW)

```typescript
// ConfigTable key: config_version_<versionId>
interface ConfigVersion {
  versionId: string; // timestamp-based
  createdAt: number;
  changes: Record<string, { old: unknown; new: unknown }>;
  author: string; // 'system' | userId
  description: string;
}

class ConfigVersioning {
  async snapshotBeforeChange(key: string, oldValue: unknown, author: string): Promise<void>;
  async getVersionHistory(limit?: number): Promise<ConfigVersion[]>;
  async rollbackToVersion(versionId: string): Promise<void>;
}
```

**File**: `core/lib/registry/config.ts` — In `saveRawConfig`, call `snapshotBeforeChange` before writing.

#### Step 8.3 — Feature Flags

**File**: `core/lib/feature-flags.ts` (NEW)

```typescript
// ConfigTable key: feature_flag_<flagName>
interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercent: number; // 0-100
  targetAgents?: string[]; // Specific agents this applies to
  description: string;
}

class FeatureFlags {
  async isEnabled(flagName: string, agentId?: string): Promise<boolean>;
  async setFlag(flag: FeatureFlag): Promise<void>;
  async listFlags(): Promise<FeatureFlag[]>;
}
```

**File**: `core/lib/config-defaults.ts` — Add `FEATURE_FLAGS_ENABLED` config.

#### Step 8.4 — A/B Testing (Basic)

Leverage feature flags with `rolloutPercent`:

- Hash `agentId + flagName` to determine if agent gets variant A or B
- Log which variant was used in trace metadata
- Compare success rates via Phase 7 metrics

### DynamoDB Schema Changes

- New key pattern: `agent_config_<agentId>_<configKey>` in ConfigTable
- New key pattern: `config_version_<versionId>` in ConfigTable
- New key pattern: `feature_flag_<flagName>` in ConfigTable
- New key: `feature_flags_list` in ConfigTable (array of flag names)

---

## Phase 9: Observability, Metrics & Token Tracking (Low)

### Problem Statement

1. CloudWatch metrics infrastructure exists (`core/lib/metrics.ts`) but is rarely called.
2. No token usage tracking per agent/tool/invocation.
3. No alerting for critical communication failures or anomalous token usage.
4. No SLA/SLO tracking.

### Implementation Steps

#### Step 9.0 — New Metric Constructors in metrics.ts

Add to the existing Metrics factory:
```typescript
tokensInput(inputTokens: number, agentId: string, provider: string): MetricDatum
tokensOutput(outputTokens: number, agentId: string, provider: string): MetricDatum
// agentInvoked(agentId)  // already exists
// agentDuration(agentId, ms)  // already exists
// toolExecuted(toolName, success)  // already exists
// toolDuration(toolName, ms)  // already exists
```

#### Step 9.1a — Instrumentation Points

| File | Line(s) | Metric |
|------|---------|--------|
| `executor.ts` | After `aiResponse.usage` (line ~292) | `Metrics.tokensInput`, `Metrics.tokensOutput` |
| `executor.ts` | After tool execution (line ~362) | `Metrics.toolExecuted`, `Metrics.toolDuration` |
| `agent.ts` | After `runLoop` returns | `Metrics.agentDuration`, `Metrics.agentInvoked` |
| `monitor.ts` | On build success/failure | `Metrics.deploymentCompleted` |
| `recovery.ts` | After health probe | `Metrics.mcpHubPing`, `Metrics.lockAcquired`, `Metrics.circuitBreakerTriggered` |
| `bus.ts` | After `PutEventsCommand` | `Metrics.eventBridgeEmit`, `Metrics.dlqEvents` |
| `events.ts` | Top of handler | `Metrics.agentInvoked` by event type |

#### Step 9.1b — Token Accumulation in Executor

Add running totals inside `runLoop`:
```typescript
let totalInputTokens = 0;
let totalOutputTokens = 0;
let toolCallCount = 0;

// After each LLM call:
if (aiResponse.usage) {
  totalInputTokens += aiResponse.usage.inputTokens;
  totalOutputTokens += aiResponse.usage.outputTokens;
}

// After each tool call:
toolCallCount++;
```

Update `runLoop` return type:
```typescript
usage?: {
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCallCount: number;
  durationMs: number;
}
```

#### Step 9.2a — Per-Invocation Records

**File**: `core/lib/token-usage.ts` (NEW)

```typescript
interface TokenUsageRecord {
  userId: string;           // TOKEN#<agentId>#<timestamp>
  timestamp: number;
  traceId: string;
  agentId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: number;
  taskType: 'agent_process' | 'summarization' | 'other';
  success: boolean;
  durationMs: number;
  expiresAt: number;        // TTL 7 days
}

class TokenTracker {
  static async recordInvocation(record: TokenUsageRecord): Promise<void>;
  static async getInvocationHistory(agentId: string, limit?: number): Promise<TokenUsageRecord[]>;
}
```

#### Step 9.2b — Daily Rollups

**File**: `core/lib/token-usage.ts`

```typescript
interface TokenRollup {
  userId: string;           // TOKEN_ROLLUP#<agentId>#<YYYY-MM-DD>
  timestamp: number;        // day start epoch
  totalInputTokens: number;
  totalOutputTokens: number;
  invocationCount: number;
  toolCalls: number;
  avgTokensPerInvocation: number;
  successCount: number;
  expiresAt: number;        // TTL 90 days
}

class TokenTracker {
  // ...
  static async updateRollup(agentId: string, usage: { inputTokens: number, outputTokens: number, toolCalls: number, success: boolean }): Promise<void>;
  static async getRollup(agentId: string, date: string): Promise<TokenRollup | null>;
  static async getRollupRange(agentId: string, days: number): Promise<TokenRollup[]>;
}
```
Uses MemoryTable with the existing composite key pattern (userId + timestamp).

#### Step 9.2c — Per-Tool Rollups

**File**: `core/lib/token-usage.ts`

```typescript
interface ToolTokenRollup {
  userId: string;           // TOOL_TOKEN#<toolName>#<YYYY-MM-DD>
  timestamp: number;
  invocationCount: number;
  successCount: number;
  avgInputTokens: number;   // tracked via context estimation (input to the LLM call that used this tool)
  expiresAt: number;
}

class TokenTracker {
  // ...
  static async updateToolRollup(toolName: string, success: boolean, inputTokens?: number): Promise<void>;
}
```

#### Step 9.2d — Summarization Usage Capture

Update `core/lib/agent/context-manager.ts` `summarize()`:
- Return `{ summary: string, usage?: { inputTokens, outputTokens } }` instead of `void`
- Call `TokenTracker.recordInvocation()` with `taskType: 'summarization'`

#### Step 9.3 — Critical Alerting

**File**: `core/lib/alerting.ts` (NEW)

```typescript
class Alerting {
  static async alertHighTokenUsage(agentId: string, tokens: number, threshold: number): Promise<void>;
  static async alertCircuitBreakerOpen(type: string): Promise<void>;
  static async alertDLQOverflow(count: number): Promise<void>;
  static async alertHighErrorRate(agentId: string, rate: number): Promise<void>;
}
```

Alerts emit `OUTBOUND_MESSAGE` event pattern → Notifier → Telegram.

**File**: `core/lib/config-defaults.ts`

Add alert config defaults:
```typescript
ALERT_ERROR_RATE_THRESHOLD: {
  code: 0.3, // 30% error rate
  hotSwappable: true,
  configKey: 'alert_error_rate_threshold',
  description: 'Error rate threshold for agent alerting.',
},
ALERT_DLQ_THRESHOLD: {
  code: 10,
  hotSwappable: true,
  configKey: 'alert_dlq_threshold',
  description: 'DLQ event count threshold for alerting.',
},
ALERT_TOKEN_ANOMALY_MULTIPLIER: {
  code: 3.0,
  hotSwappable: true,
  configKey: 'alert_token_anomaly_multiplier',
  description: 'Alert if tokens are greater than 3x rolling average.',
}
```

#### Step 9.4 — SLA/SLO Tracking

**File**: `core/lib/slo.ts` (NEW)

Define SLOs and track against them:

```typescript
interface SLODefinition {
  name: string;
  target: number;
  window: 'daily' | 'weekly' | 'monthly';
  metric: 'availability' | 'task_success_rate' | 'p95_latency';
}

const DEFAULT_SLOS: SLODefinition[] = [
  { name: 'api_availability', target: 0.995, window: 'monthly', metric: 'availability' },
  { name: 'task_success_rate', target: 0.95, window: 'weekly', metric: 'task_success_rate' },
  { name: 'response_latency', target: 30000, window: 'daily', metric: 'p95_latency' },
];

class SLOTracker {
  static async checkSLO(name: string, rollups: TokenRollup[]): Promise<{ burnRate: number, withinBudget: boolean }>;
  static async getSLOStatus(): Promise<Record<string, { current: number, target: number }>>;
}
```

### Config Changes

- `alert_error_rate_threshold` (hot-swappable, default 0.3)
- `alert_dlq_threshold` (hot-swappable, default 10)
- `alert_token_anomaly_multiplier` (hot-swappable, default 3.0)

---

## Dependency Graph

```
Phase 3 (Clarification) ─────────────────────┐
                                               │
Phase 4 (Parallel) ───────────────────────────┤
                                               ├──> Phase 9 (Observability)
Phase 5 (Circuit Breaker) ────────────────────┤
                                               │
Phase 6 (Context Management) ─────────────────┤
                                               │
Phase 7 (Self-Optimization) ──── depends on ──┘
  - Phase 7.2 depends on Phase 9.2 (metrics)
  - Phase 7.3 depends on Phase 9.1 (instrumentation)

Phase 8 (Configurability) ──── depends on ──── Phase 5 (circuit breaker config patterns)
```

Recommended implementation order: **3 → 4 → 5 → 6 → 8 → 7 → 9**

---

## Testing Strategy

Each phase requires:

1. **Unit tests** in `*.test.ts` alongside implementation files
2. **Integration test**: Run `make test` after each phase
3. **Quality check**: Run `make check` before each commit
4. **Deployment test**: `make dev` for local stage verification

### Phase-Specific Test Requirements

| Phase | Key Test Scenarios                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| 3     | Clarification timeout fires, retry works, escalation sends, crash recovery restores state                         |
| 4     | Barrier timeout marks stragglers, partial success threshold works, cancellation propagates                        |
| 5     | Sliding window counts correctly, half-open allows probe, emergency bypasses breaker                               |
| 6     | Compression reduces token count, provider strategy uses correct limits, priority scoring keeps important messages |
| 7     | Failed plans are learned, routing selects best agent, token tracking records accurately                           |
| 8     | Agent overrides take precedence, version rollback restores values, feature flag respects rollout %                |
| 9     | Metrics appear in CloudWatch, alerts fire on thresholds, SLO burn rate calculated correctly                       |

---

## Risk Assessment

| Risk                                                 | Phase | Mitigation                                                                   |
| ---------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| EventBridge subscription change breaks existing flow | 3.0   | Test with `make dev` first, verify all existing subscribers still work       |
| Clarification timeout creates duplicate events       | 3.4   | Use idempotency keys (already in bus.ts) for clarification timeout events    |
| Circuit breaker migration drops existing state       | 5.4   | Read existing `consecutive_build_failures` on first run, seed sliding window |
| Context compression loses critical information       | 6.1   | Keep full history in DynamoDB, compression only for LLM prompt               |
| Feature flags add latency to hot path                | 8.3   | Cache flag state in-memory with 60s TTL, ConfigTable as source of truth      |

---

## Files Modified Summary

| Phase | New Files                                                         | Modified Files                                                                                                                        |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 3     | `clarification-operations.ts`, `clarification-timeout-handler.ts` | `infra/agents.ts`, `config-defaults.ts`, `constants.ts`, `clarification-handler.ts`, `knowledge-agent.ts`, `agent.ts` (types)         |
| 4     | `parallel-barrier-timeout-handler.ts`                             | `parallel-handler.ts`, `task-result-handler.ts`, `parallel-aggregator.ts`, `config-defaults.ts`                                       |
| 5     | `circuit-breaker.ts`                                              | `monitor.ts`, `deployment.ts`, `config-defaults.ts`, `recovery.ts`                                                                    |
| 6     | `context-strategies.ts`                                           | `context-manager.ts`                                                                                                                  |
| 7     | `agent-routing.ts`                                                | `insight-operations.ts`, `cognition-reflector.ts`, `strategic-planner.ts`, `registry.ts`                                              |
| 8     | `config-versioning.ts`, `feature-flags.ts`                        | `registry/config.ts`, `registry.ts`, `config-defaults.ts`                                                                             |
| 9     | `token-usage.ts`, `alerting.ts`, `slo.ts`, `token-usage.test.ts`, `alerting.test.ts`, `slo.test.ts` | `metrics.ts`, `agent/executor.ts`, `agent.ts`, `agent/context-manager.ts`, `config-defaults.ts`, `metadata.ts`, `monitor.ts`, `recovery.ts`, `events.ts`, `bus.ts`, `docs/CONFIG.md` |
