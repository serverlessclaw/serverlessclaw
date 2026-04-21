# Audit Instructions for Future Agents

When instructed to audit the Serverless Claw system, follow this process:

## 1. Start Here

Read these documents first:

- `docs/governance/AUDIT.md` - Audit framework and methodology
- `docs/governance/AUDIT-COVERAGE.md` - What's been audited (avoid duplicates)
- `docs/governance/ANTI-PATTERNS.md` - Known recurring issues to watch for

## 2. Run Automated Checks

Before manual audit, always run:

```bash
# Run all quality checks
make check

# Run tests
make test

# Run principles verification (MUST PASS)
pnpm principles
```

The `pnpm principles` check verifies:

- Principle 13: Atomic State Integrity (conditional updates)
- Principle 14: Selection Integrity (enabled check in router)
- Principle 15: Monotonic Progress (atomic increment)
- Fail-Closed Rate Limiting

## 3. Required Audit Steps

Every audit MUST include:

### Step A: Pick a Silo or Perspective

Choose ONE from the Silo table in AUDIT.md or ONE Cross-Silo Perspective (A-E).

**Critical**: You MUST verify at least ONE cross-silo perspective per audit. See AUDIT-COVERAGE.md to find untested perspectives.

### Step B: Manual Verification

For your chosen area:

1. Read the relevant code files
2. Check against PRINCIPLES.md design principles
3. Look for anti-patterns in ANTI-PATTERNS.md
4. Verify actual behavior vs expected behavior

### Step C: Document Findings

Create report in `reports/audit-<YYYY-MM-DD>-<topic>.md` using template in AUDIT.md.

Include:

- What you audited
- What you expected to find
- What you actually found
- Severity (P0/P1/P2/P3)
- Related anti-patterns (if any)

## 4. Priority Areas (Based on Coverage Matrix)

The following have NEVER been audited - prioritize these:

- **Perspective C**: Identity Journey (Brain → Spine → Shield)
- **Perspective D**: Trust Loop (Eye → Scales → Spine)
- **Perspective E**: Recovery Path (Shield → Spine → Brain)

The following are high-risk (most violations):

- **The Shield** (Silo 3) - Safety violations
- **The Scales** (Silo 6) - Race conditions
- **The Spine** (Silo 1) - Fail-open behavior

## 5. Quick Reference Commands

```bash
# Run automated verification
pnpm principles

# Run full test suite
make test

# Run linting
make check

# Run aiready scan (must score 80+)
pnpm aiready
```

## 6. Anti-Patterns to Watch

Most common recurring issues (see ANTI-PATTERNS.md for details):

1. Fail-open rate limiting (returns true on failure)
2. Race condition in LockManager release
3. Missing enabled === true check in router
4. Non-atomic recursion depth increment (++ instead of atomic)
5. Double execution of Class C actions
6. Direct object-level overwrite instead of atomic update
7. Missing conditionExpression in DynamoDB operations
8. Missing `shared#collab#` context summary during promotion
9. Adaptive Mode failure (autonomous agents talking in natural language)
10. Unauthorized agent invitation (missing Principle 14 check in transit)
11. Race condition in collaboration creation (non-atomic creation)

## Summary

1. Read AUDIT.md + ANTI-PATTERNS.md first
2. Run `pnpm principles` - MUST pass
3. Pick ONE silo AND ONE cross-silo perspective
4. Document findings in reports/
5. Reference anti-patterns in findings
