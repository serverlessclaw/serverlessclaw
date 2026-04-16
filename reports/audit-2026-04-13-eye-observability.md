# Audit Report: The Eye (Silo 5) - Observation & Consistency
**Date:** 2026-04-13  
**Auditor:** Kilo  
**Silo:** 5 - The Eye (Observation & Consistency)  
**Focus:** Metrics, Tracing, SLOs, and Dashboard Sync

---

## 🎯 Objective

Deep-dive audit of The Eye (Silo 5) to identify bugs, gaps, and inconsistencies between backend trace state and dashboard reporting. The Eye was selected as it validates all other silos—if metrics are broken, trust in the entire system is compromised.

---

## 🎯 Finding Type

- **Bugs**: Functional failures where implementation doesn't match documented behavior
- **Gaps**: Missing functionality that should exist
- **Inconsistencies**: State drift between components

---

## 🔍 Investigation Path

1. **Started at**: `core/lib/metrics/metrics.ts` - CloudWatch metrics emission
2. **Followed**: Tracer implementation (`tracer-implementation.ts`) → ConsistencyProbe (`cognitive-metrics.ts:703-784`) → SLO calculations (`slo.ts`)
3. **Observed**: End-to-end flow from agent execution to dashboard via MQTT realtime

---

## 🚨 Findings

### BUGS

| ID | Title | Type | Severity | Location | Recommended Action |
|:---|:------|:-----|:---------|:---------|:-------------------|
| **B1** | SLO Latency Misnamed - Mean vs P95 | Bug | **P1** | `slo.ts:34-38` | Rename metric from `p95_latency` to `avg_latency` or implement actual percentile calculation |
| **B2** | Metrics Silent Failure on CloudWatch Unavailable | Bug | **P2** | `metrics.ts:42-45` | Change `console.debug` to `console.warn` for visibility; consider DLQ fallback |
| **B3** | Agent Enabled Check Inconsistency | Bug | **P2** | `AgentRouter.ts:303` | Use explicit `=== true` check; document undefined as "enabled by default" |

### GAPS

| ID | Title | Type | Severity | Location | Recommended Action |
|:---|:------|:-----|:---------|:---------|:-------------------|
| **G1** | ConsistencyProbe Missing Tracer Integration | Gap | **P2** | `cognitive-metrics.ts:738-742` | Add cross-reference with TraceTable to verify backend-dashboard consistency |
| **G2** | No Dashboard SLO Status Exposure | Gap | **P2** | `slo.ts` | Emit SLO status metrics for dashboard display; currently only triggers trust penalties |
| **G3** | No Trace Summary Validation | Gap | **P3** | `tracer-implementation.ts:103-128` | Add verification that `__summary__` nodes match actual trace state |
| **G4** | No Real-time Sync Verification | Gap | **P2** | `realtime.ts` | Add delivery confirmation or retry mechanism for MQTT publish failures |

### INCONSISTENCIES

| ID | Title | Type | Severity | Location | Recommended Action |
|:---|:------|:-----|:---------|:---------|:-------------------|
| **I1** | SLO Definition Uses p95 but Calculates Mean | Inconsistency | **P1** | `slo.ts:15` vs `token-usage.ts:47` | Clarify: `avgDurationMs` is average, not percentile; fix SLO definition or calculation |
| **I2** | Memory Health Scan Uses Sample Not Full Scan | Inconsistency | **P2** | `cognitive-metrics.ts:498` | Document that staleness detection is based on 100-item sample; may miss edge cases |
| **I3** | Trace Summary Feature Flag Not Documented | Inconsistency | **P3** | `tracer-implementation.ts:103` | Add `TRACE_SUMMARIES_ENABLED` to environment docs or remove feature flag |

---

## 📋 Detailed Findings

### B1: SLO Latency Misnamed - Mean vs P95

**Location**: `core/lib/metrics/slo.ts:34-38`

**Current Code**:
```typescript
case 'p95_latency': {
  const totalInvocations = rollups.reduce((s, r) => s + r.invocationCount, 0);
  const totalDuration = rollups.reduce((s, r) => s + (r.totalDurationMs || 0), 0);
  current = totalInvocations > 0 ? totalDuration / totalInvocations : 0;
  break;
}
```

**Issue**: This calculates **mean** latency (totalDuration / invocationCount), not p95. The AUDIT.md states "p95_latency uses actual `avgDurationMs` from TokenRollup, not token counts" - but `avgDurationMs` in TokenRollup (`token-usage.ts:47`) is also the average, not the 95th percentile.

**Expected**: Either:
1. Rename SLO to `avg_latency` to match calculation, OR
2. Implement actual percentile calculation using raw duration data

**Severity**: P1 - This is a reliability issue that will cause confusion when measuring actual SLO compliance.

---

### B2: Metrics Silent Failure on CloudWatch Unavailable

**Location**: `core/lib/metrics/metrics.ts:42-45`

**Current Code**:
```typescript
const cw = await getCloudWatchClient();
if (!cw) {
  console.debug('[METRICS] CloudWatch not available, skipping:', metrics);
  return;
}
```

**Issue**: When CloudWatch SDK fails to load or credentials are missing, critical metrics are silently discarded with `console.debug`. According to PRINCIPLE 11 "Durable Observability": "telemetry must outlive the processes that generate it."

**Expected**: At minimum use `console.warn`, ideally fallback to DLQ or alternative storage.

**Severity**: P2 - Metrics loss affects observability but doesn't break core functionality.

---

### B3: Agent Enabled Check Inconsistency

**Location**: `core/lib/routing/AgentRouter.ts:303`

**Current Code**:
```typescript
if (config && config.enabled !== false) {
  enabledCandidates.push(candidates[i]);
}
```

**Issue**: 
- Treats `undefined` as enabled (since `undefined !== false`)
- But PRINCIPLE 14 "Selection Integrity" states: "verify the active status (`enabled === true`) of candidates"
- Inconsistency between router interpretation and documented principle

**Expected**: Use explicit check `config.enabled === true` to align with PRINCIPLE 14.

**Severity**: P2 - Could select disabled agents if default changes.

---

### G1: ConsistencyProbe Missing Tracer Integration

**Location**: `core/lib/metrics/cognitive-metrics.ts:738-742`

**Current Code**:
```typescript
// 2. Cross-reference with Tracer (if integrated)
// For now, we compare against expected counts from the Dashboard intelligence service
// (mocked or inferred from other event stores if available)

// Gap: Tracer integration for Silo 5 probe is a future milestone.
// We currently verify that task_completed and task_latency_ms are pairwise consistent.
```

**Issue**: The ConsistencyProbe doesn't verify against the actual TraceTable. It only checks internal consistency between `task_completed` and `task_latency_ms` metrics. There's no cross-reference to verify that dashboard displays match backend trace state.

**Expected**: Query TraceTable for actual completed traces and compare with metrics.

**Severity**: P2 - Core Silo 5 verification mechanism is incomplete.

---

### G2: No Dashboard SLO Status Exposure

**Location**: `core/lib/metrics/slo.ts:57-100`

**Issue**: `SLOTracker.getSLOStatus()` calculates SLO compliance and triggers trust penalties, but doesn't emit any metrics for dashboard display. Users cannot see current SLO status.

**Expected**: Emit SLO metrics similar to other METRICS in `metrics.ts`.

**Severity**: P2 - Missing observability for critical system metric.

---

### I1: SLO Definition Uses p95 but Calculates Mean (Same as B1)

This is both a bug (functional) and inconsistency (terminology). The SLO is named `p95_latency` but calculates average.

---

### I2: Memory Health Scan Uses Sample Not Full Scan

**Location**: `core/lib/metrics/cognitive-metrics.ts:498`

**Current Code**:
```typescript
const MAX_ITEMS_PER_PREFIX = 100;
// ...
const items = await this.base.scanByPrefix(prefix, { limit: MAX_ITEMS_PER_PREFIX });
```

**Issue**: Memory health analysis only scans 100 items per prefix. If a workspace has 10,000 items, staleness detection is based on ~1% sample. This could miss widespread staleness.

**Status**: Documented as sample-based for performance. This is a known trade-off.

**Severity**: P2 - May produce inaccurate memory health scores.

---

### I3: Trace Summary Feature Flag Not Documented

**Location**: `core/lib/tracer/tracer-implementation.ts:103`

**Issue**: `TRACE_SUMMARIES_ENABLED` is a runtime feature flag without clear documentation.

**Status**: RESOLVED - The flag is already set to `'true'` in `infra/agents.ts` and `infra/mcp-servers.ts`, making it effectively default-on in production. No documentation needed since it's not a configurable option.

---

## ✅ Resolution Status

| ID | Title | Status |
|:---|:------|:-------|
| B1 | SLO Latency Misnamed | ✅ FIXED - Renamed to `avg_latency` |
| B2 | Metrics Silent Failure | ✅ FIXED - Changed to `console.warn` |
| B3 | Agent Enabled Check | ✅ FIXED - Changed to explicit `=== true` |
| G1 | ConsistencyProbe Tracer | ✅ FIXED - Added TraceTable cross-reference infrastructure |
| G2 | No SLO Dashboard Exposure | ✅ FIXED - Added `emitSLOStatusMetrics()` |
| I1 | SLO Definition Mismatch | ✅ FIXED - Same as B1 |
| I2 | Sample-based Memory Health | 📝 DOCUMENTED - Known trade-off |
| I3 | Undocumented Feature Flag | ✅ VERIFIED - Already enabled in production |

**Issue**: Memory health analysis only scans 100 items per prefix. If a workspace has 10,000 items, staleness detection is based on ~1% sample. This could miss widespread staleness.

**Expected**: Document this limitation or implement smarter sampling.

**Severity**: P2 - May produce inaccurate memory health scores.

---

## 🔗 Cross-Silo Implications

### Eye → Scales (Cross-Silo D: Trust Loop)

The feedback loop from Eye to Scales is implemented correctly:
- `CognitiveHealthMonitor.detectAnomalies()` detects issues
- `TrustManager.recordAnomalies()` applies penalties (verified in `cognitive-metrics.ts:606`)
- Agent selection respects `enabled` status via `AgentRouter.selectBestAgent()`

**However**: There's a potential dead-end: if trust drops below threshold, the agent is disabled, but there's no mechanism to verify the agent was actually deselected in subsequent routing.

### Eye → Spine (Trace Flow)

Trace flow is correctly implemented:
- `ClawTracer.startTrace()` creates trace in DynamoDB
- `ClawTracer.endTrace()` / `failTrace()` updates status and emits metrics
- Metrics are emitted via `METRICS.agentInvoked` and `METRICS.agentDuration`

**However**: No verification that these traces appear in dashboard.

---

## 💡 Architectural Reflections

1. **Metrics Pipeline Weakness**: Single point of failure if CloudWatch unavailable. Consider dual-write to DynamoDB for durability.

2. **Silo 5 Verification Gap**: The ConsistencyProbe is a good concept but incomplete without actual TraceTable cross-reference. This is explicitly documented as "future milestone."

3. **Terminology Confusion**: `avgDurationMs` in TokenRollup is called "average" but SLO references it as "p95" - needs alignment.

4. **Feature Flag Proliferation**: `TRACE_SUMMARIES_ENABLED` is a runtime feature flag without clear documentation. Consider removing and making default behavior.

---

## ✅ Verification Evidence

All findings are traceable to specific files and line numbers as documented above. Code paths were verified by reading:
- `core/lib/metrics/metrics.ts`
- `core/lib/metrics/slo.ts`
- `core/lib/metrics/cognitive-metrics.ts`
- `core/lib/metrics/token-usage.ts`
- `core/lib/tracer/tracer-implementation.ts`
- `core/lib/routing/AgentRouter.ts`
- `core/lib/utils/realtime.ts`
- `core/lib/safety/trust-manager.ts`

---

## Recommended Priority Actions

| Priority | Action |
|----------|--------|
| **P1** | Fix SLO latency naming/calculation (B1, I1) |
| **P1** | Fix agent enabled check to use explicit `=== true` (B3) |
| **P2** | Add warning for metrics fallback instead of debug (B2) |
| **P2** | Add TraceTable cross-reference to ConsistencyProbe (G1) |
| **P2** | Emit SLO status metrics for dashboard (G2) |
| **P3** | Document sample-based memory health limitation (I2) |
| **P3** | Document or remove TRACE_SUMMARIES_ENABLED flag (I3) |