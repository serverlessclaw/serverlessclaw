# Audit Instructions for Future Agents

When instructed to audit the Serverless Claw system, follow this process to ensure maximum resilience and architectural integrity.

## 1. Start Here

Read these documents first to establish context:

- `docs/governance/AUDIT.md` - Audit framework and methodology
- `docs/governance/AUDIT-COVERAGE.md` - What's been audited (check for under-audited silos/perspectives)
- `docs/governance/ANTI-PATTERNS.md` - Known recurring issues (19+ patterns)

## 2. The "Instruction Shift" Protocol (Avoiding Blind Spots)

To prevent "audit tunnel vision," you MUST:

1. **Rotate Focus**: Review the last 3 audit reports in `reports/`. Deliberately AVOID the primary files remediated in those reports unless you are specifically looking for regressions.
2. **Shift the Lens**: If the previous audit was "Bottom-Up" (code review), perform this audit "Top-Down" (start from `docs/architecture/*.md` and verify implementation matches docs).
3. **Audit the Negative Space**: Look for what is _missing_ (e.g., a missing error path in a new feature, missing telemetry in a background task, or missing multi-tenant scoping in a shared utility).

## 3. Run Automated Checks

Before manual audit, always run:

```bash
# Run all quality checks (lint, types, formatting)
make check

# Run unit and integration tests
make test

# Run principles verification (MUST PASS)
pnpm principles
```

The `pnpm principles` check verifies core invariants:

- Principle 13: Atomic State Integrity (conditional updates)
- Principle 14: Selection Integrity (enabled check in router)
- Principle 15: Monotonic Progress (atomic increment)
- Fail-Closed Rate Limiting

## 4. Required Audit Steps

Every audit MUST include:

### Step A: Pick a Silo or Perspective

Choose ONE from the Silo table (1-7) and ONE Cross-Silo Perspective (A-F).

**Mandatory Check**: Every audit round MUST explicitly verify **Principle 11: Multi-Tenant Isolation** in the chosen area.

### Step B: Manual Verification

1. **Infrastructure Audit**: If auditing Silos 1, 3, or 7, review `infra/` or `.sst/` configurations for IAM least-privilege and resource isolation.
2. **Cognitive Safety Check**: Evaluate code complexity. Is it readable by an agent? Are state transitions explicit?
3. **Telemetry Quality**: Verify metrics are high-signal. Do they include `workspaceId` dimensions? (Anti-Pattern 14).
4. **Documentation-Code Drift**: Ensure architectural diagrams in `docs/architecture/` reflect the current reality of the code.

### Step C: Document Findings

Create report in `reports/audit-<YYYY-MM-DD>-<topic>.md`.
Include ID, Title, Type (Bug/Gap/Inconsistency/Refactor), Severity (P0-P3), and Related Anti-Pattern ID.

> [!IMPORTANT]
> **Git Tracking**: Audit reports in the `reports/` directory are NOT to be tracked in git. They are local artifacts for rotation and context. Do NOT use `git add -f` to override the `.gitignore` for these files.

## 5. Priority Areas (Current Blind Spots)

Prioritize these under-audited or high-complexity areas:

- **Perspective F**: The Metabolic Loop (Metabolism ↔ Scales ↔ Spine). How the system heals itself.
- **Silo 7**: The Metabolism. Autonomous cleanup and repair logic.
- **Silo 1**: The Spine. Event routing complexity and DLQ triage.
- **Cross-Component Dependencies**: How changes in `core/lib/utils/` ripple across silos.

## 6. Quick Reference Commands

```bash
# Verify principles
pnpm principles

# Run full test suite
make test

# Run AI-readiness scan
pnpm aiready

# Run documentation-code sync check
pnpm docs:check
```

## 7. Key Anti-Patterns to Watch (Summary)

See `ANTI-PATTERNS.md` for the full list of 19+ patterns, including:

1. Fail-open behavior (Security/Rate limits)
2. Non-atomic DynamoDB operations (Missing ConditionExpression)
3. Multi-tenant leakage (Missing workspaceId scoping)
4. Telemetry Blindness (Missing or unscoped metrics)
5. Race conditions in Lock/Session management
6. **New**: In-Memory Multi-Tenant Filtering (Anti-Pattern 19)

## 8. Framework Integrity & Sync (Hub-and-Spoke)

As a consumer of the ServerlessClaw framework, you must maintain the boundary between core framework code and application-specific logic.

1. **Core vs Spoke**: Framework-level changes (Registry logic, Bus, Memory, Safety) happen in `framework/core/lib`. Application-level changes (custom agents, business tools) happen in `packages/` or via `PluginManager` registration.
2. **Promotion (sync-upstream)**: If you improve the framework core (e.g., adding a new Registry feature or fixing a bug in the Bus), you MUST promote these changes back to the upstream repository using `make sync-upstream`.
3. **Evolution (sync-downstream)**: Periodically run `make sync-downstream` to pull the latest canonical improvements from the Mother Hub.
4. **Anti-Pattern 20: Domain Pollution**: Do NOT hardcode domain-specific logic (e.g., Energy, CRM, Finance) into the `framework/` directory. Use the `PluginManager` to inject these capabilities.

## Summary Checklist

1. Rotate focus away from recently edited files.
2. Verify Principle 11 (Isolation) is enforced.
3. Check both `core/` logic and `infra/` configuration.
4. Document findings and update `AUDIT-COVERAGE.md`.
