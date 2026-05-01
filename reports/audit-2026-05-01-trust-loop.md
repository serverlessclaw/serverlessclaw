# Audit Report: Trust Loop & Atomic State - 2026-05-01

## 🎯 Objective

Audit the "Trust Loop (Eye → Scales → Spine)" (Perspective D) and "Regenerative Metabolism" (Silo 7/6) with a focus on monotonic progress, atomic updates, and concurrency safety.

## 🎯 Finding Type

- Bug
- Race Condition

## 🔍 Investigation Path

- Started at: `core/lib/safety/trust-manager.ts` (The Scales)
- Followed: Trust decay calls in `core/handlers/maintenance.ts` (Regenerative Metabolism).
- Observed: Non-idempotent decay logic leading to double-penalization in concurrent scenarios.
- Follow: Anomaly detection in `core/lib/metrics/cognitive/monitor.ts` (The Eye).
- Observed: Redundant anomaly reporting due to overlapping hourly windows.

```text
[ Trust Loop: Perspective D ]

  (Eye)    CognitiveHealthMonitor.takeSnapshot(window: "2026-05-01T17")
             |
             v
  (Scales) TrustManager.recordAnomalies(agentId, anomalies, windowId: "2026-05-01T17")
             |
             +--- [ IDEMPOTENCY GUARD ] ---+
             |  if (config.lastAnomalyCalibrationAt == windowId) return;
             |
             v
  (Scales) AgentRegistry.atomicIncrementTrustScore(delta)
             |
             v
  (Spine)  AgentRouter.selectBestAgent()
             |  Reads Config.trustScore for scoring
             v
  (Metabolism) maintenance.handler -> TrustManager.decayTrustScores()
             |
             +--- [ ATOMIC DECAY GUARD ] ---+
                Update Config SET trustScore = trustScore + delta, lastDecayedAt = today
                WHERE lastDecayedAt <> today
```

## 🚨 Findings

| ID  | Title             | Type | Severity | Location   | Recommended Action |
| :-- | :---------------- | :--- | :------- | :--------- | :----------------- |
| 1   | Double Trust Decay | Race | P1       | `core/lib/safety/trust-manager.ts` | FIXED. Implement idempotency via `lastDecayedAt` and conditional atomic updates. |
| 2   | Double Anomaly Penalization | Bug | P2 | `core/lib/metrics/cognitive/monitor.ts` | FIXED. Align calibration windows and use `lastAnomalyCalibrationAt` guard. |
| 3   | Race in List Capping | Race | P2 | `core/lib/registry/config/list.ts` | Non-critical. Telemetry list capping uses separate REMOVE commands. Recommend batching REMOVE in a single transaction if list consistency becomes critical. |

## 💡 Architectural Reflections

- **Principle 13 (Atomic State Integrity)**: The system previously relied on "read-calculate-write" patterns for trust decay. This has been hardened to use "conditional atomic updates" where the increment and the timestamp update happen in a single DynamoDB transaction, guarded by the previous state.
- **Idempotency in Serverless**: Scheduled maintenance tasks in serverless environments often trigger retries or concurrent instances. All state-mutating maintenance tasks (like decay or pruning) must track their successful execution via persistent timestamps (e.g., `lastDecayedAt`) and use CAS (Compare-And-Swap) logic.
- **Stable Anomaly IDs**: Anomaly reporting was previously non-idempotent because IDs were random. By introducing `windowId` (aligned to the hour), we ensure that an agent is only penalized once for cognitive degradation within a specific timeframe, even if the monitor runs multiple times.
