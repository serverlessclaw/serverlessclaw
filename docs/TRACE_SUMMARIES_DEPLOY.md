# Trace Summaries GSI — Deploy & Migration Runbook

Purpose

- Provide a safe, auditable plan to add the `SummaryByNode` GSI and populate per-trace `__summary__` rows so the dashboard can list one row per trace deterministically.

Prerequisites

- Confirm production DynamoDB `TraceTable` has Point-in-Time Recovery (PITR) enabled and recent backups exist.
- Ensure CI pipeline can run infra diffs and staged deploys for `prod` (do not run `sst dev --stage dev`).
- Confirm stakeholders and schedule a maintenance window (low traffic preferred).

High-level approach

1. Add `SummaryByNode` GSI to `TraceTable` (partition key `nodeId` (S), sort key `timestamp` (N)). Project `traceId`, `timestamp`, `status`, `metadata`.
2. Deploy infra change to `prod` (via PR + CI) while keeping `TRACE_SUMMARIES_ENABLED=false`.
3. Run migration script to create `__summary__` items for existing traces in controlled, throttled batches.
4. Enable `TRACE_SUMMARIES_ENABLED=true` for consumers and switch dashboard to query GSI.

Infra change details

- File to change: `infra/storage.ts` — add index definition similar to:
  - IndexName: `SummaryByNode`
  - KeySchema: `{ AttributeName: 'nodeId', KeyType: 'HASH' }, { AttributeName: 'timestamp', KeyType: 'RANGE' }`
  - Projection: include `traceId`, `timestamp`, `status`, `metadata`

Migration strategy and safety

- Why migration: the GSI indexes only existing items with `nodeId='__summary__'`. We must create those summary rows for historical traces.
- Script: `scripts/create-trace-summaries.mjs` (exists in repo). Verify the script supports a `--dry-run` or add a dry-run flag. If not present, open a small patch to add dry-run/limit/rate options.
- Run the migration in multiple passes:
  1. Dry-run on a small sample (e.g., `limit=100`) and verify no errors.
  2. Run with throttling (e.g., 200 writes/sec) and monitor DynamoDB consumed capacity and error rates.
  3. Validate sample of generated `__summary__` items by querying the table.
- Monitoring: watch CloudWatch metrics (ConsumedWriteCapacity, ThrottledRequests), application logs, and internal metrics for summary writes.

Rollout steps (detailed)

1. Create feature branch: `git checkout -b feat/trace-summaries-gsi`
2. Add GSI to `infra/storage.ts` and keep application flag default OFF by ensuring `TRACE_SUMMARIES_ENABLED` is not true in prod until migration completes.
3. Open PR and run full CI (unit tests, integration smoke tests) — do not enable feature flag yet.
4. After PR approval, deploy infra via CI to `prod` or run `sst deploy --stage prod` as your infra process requires. Confirm GSI exists via AWS Console or CLI:

```bash
aws dynamodb describe-table --table-name TraceTable --query "Table.GlobalSecondaryIndexes[?IndexName=='SummaryByNode']"
```

Or use the helper script to both check and optionally wait for the index to become `ACTIVE`:

```bash
# quick check (no wait)
TRACE_TABLE=TraceTable node scripts/check-summary-gsi.mjs

# wait up to 10 minutes for the index to become ACTIVE
TRACE_TABLE=TraceTable node scripts/check-summary-gsi.mjs --wait --timeout=600
```

1. Run migration script in small dry-run mode. Validate output and confirm expected summary counts for sample traces.
2. Run migration in throttled batches until finished. Re-run any failed batches.
3. Enable `TRACE_SUMMARIES_ENABLED=true` in environment (Lambda env / config store) for a small subset of consumers first if possible (canary), then full rollout.
4. Switch dashboard to query the GSI (feature toggle); run smoke E2E tests and check trace-listing correctness.

Verification checklist

- GSI `SummaryByNode` exists and is healthy.
- A sample of traces have `__summary__` items with correct `traceId`, `timestamp`, `status`.
- Dashboard query against the GSI returns one row per trace with correct pagination behavior.
- CloudWatch shows no unexpected ThrottledRequests or sustained RCU/WCU spikes.
- All unit tests and E2E smoke tests pass.

Rollback procedure

- If problems discovered, immediately set `TRACE_SUMMARIES_ENABLED=false` to stop summary reads/writes.
- If infra change must be reversed, roll back infra via CI and/or remove GSI (note: removing a GSI is destructive).
- If migration introduced bad data, run a cleanup script to remove `nodeId='__summary__'` items (careful: keep backups).

Estimated timing

- GSI addition: minutes to hours (depends on table size and AWS internal indexing). Plan for 1–4 hours.
- Migration: depends on number of traces; plan for staged batches over a maintenance window.

Commands & quick notes

- Create branch and open PR:

```bash
git checkout -b feat/trace-summaries-gsi
# edit infra/storage.ts and app feature flag locations
git add infra/storage.ts core/... dashboard/...
git commit -m "feat: add SummaryByNode GSI and gated summary support"
git push origin feat/trace-summaries-gsi
```

- Inspect GSI via AWS CLI:

```bash
aws dynamodb describe-table --table-name TraceTable --query "Table.GlobalSecondaryIndexes[?IndexName=='SummaryByNode']"
```

- Run migration (dry-run pattern):

```bash
# inspect script and run with dry-run/limit if supported
node scripts/create-trace-summaries.mjs --dry-run --limit=100
# full run (throttled)
node scripts/create-trace-summaries.mjs --rate=200
```

Notes & caveats

- If the table is very large, consider an incremental approach and avoid enabling summaries until a meaningful sample has been backfilled.
- Validate IAM permissions for any migration runner — it needs write access to `TraceTable`.
- Update `docs/DEVOPS.md` with the staged deploy & rollback steps if you make this change.

Contact

- Tag the on-call infra owner and the engineers responsible for `TraceTable` and the dashboard before deployment.

---

If you want, I can (A) open the feature branch and create the infra PR draft now, or (B) start by adding dry-run flags to `scripts/create-trace-summaries.mjs` and adding focused unit tests for the migration step. Which should I do next?
