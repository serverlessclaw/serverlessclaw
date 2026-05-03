# Audit Report: Silo 7 (Metabolism) & Perspective F (Metabolic Loop)

**Date**: 2026-05-03
**Auditor**: Antigravity
**Scope**: Silo 7 (Metabolism), Perspective F (Metabolic Loop: Metabolism ↔ Scales ↔ Spine)

## Findings Summary

| ID | Title | Type | Severity | Related Anti-Pattern | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AUDIT-7-01 | Missing workspaceId in setGap | Bug/Isolation | P1 | AP-3 (Tenant Leak) | FIXED |
| AUDIT-7-02 | In-Memory DLQ Filtering | Anti-Pattern | P2 | AP-19 (In-Memory Filter) | FIXED |
| AUDIT-7-03 | Global Feature Flags Pruning | Inconsistency | P2 | Principle 11 (Isolation) | FIXED |
| AUDIT-7-04 | Telemetry Blindness in Errors | Telemetry | P2 | AP-14 (Global Telemetry) | FIXED |

## Detailed Findings

### AUDIT-7-01: Missing workspaceId in setGap (P1)
**Description**: The `remediateDashboardFailure` function in `core/lib/maintenance/metabolism/remediation.ts` was calling `setGap` without a `workspaceId`. This caused remediation gaps to be anchored to the global scope instead of the specific tenant where the failure occurred.
**Remediation**: Updated `setGap` call to pass the extracted `workspaceId`.

### AUDIT-7-02: In-Memory DLQ Filtering (P2)
**Description**: `getDlqEntries` in `core/lib/utils/bus.ts` was fetching entries from a GSI and then filtering by `workspaceId` in application memory. This violates Anti-Pattern 19 and poses a risk of multi-tenant data leakage if the filter is bypassed.
**Remediation**: Added `FilterExpression: 'workspaceId = :ws'` to the DynamoDB `QueryCommand` for server-side filtering.

### AUDIT-7-03: Global Feature Flags Pruning (P2)
**Description**: `FeatureFlags.pruneStaleFlags` was designed as a global operation, ignoring tenant context. In a multi-tenant system, feature flags should be manageable per-tenant.
**Remediation**: Updated `FeatureFlags` to support `workspaceId` across all methods (get, set, list, prune) and updated the metabolism autonomous repair loop to pass the current workspace context.

### AUDIT-7-04: Telemetry Blindness in Errors (P2)
**Description**: Several critical error logs in `TrustManager`, `MetabolismService`, and the Event `Bus` were omitting the `workspaceId` from the log message string, making it difficult to trace failures to specific tenants in high-volume environments.
**Remediation**: Hardened log strings to include `(WS: ${workspaceId})` suffix for all error paths.

## Verification
- Ran `pnpm principles`: PASSED
- Ran `make check`: PASSED
- Ran `make test`: PASSED (3786/3786 tests)
