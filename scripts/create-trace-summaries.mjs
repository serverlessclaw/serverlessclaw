#!/usr/bin/env node
/**
 * Simple migration script to create per-trace summary rows for an existing
 * TraceTable. Run with `TRACE_TABLE=your-table node create-trace-summaries.mjs`.
 *
 * Note: This is a best-effort offline migration tool. It scans the table and
 * creates a reserved summary row with nodeId='__summary__' for traces that
 * don't already have one. Use caution running against large production tables.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  QueryCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

// Parse CLI args and env vars
const rawArgs = process.argv.slice(2);
let TABLE_NAME = process.env.TRACE_TABLE || rawArgs.find((a) => !a.startsWith('--'));

function getFlag(name, defaultValue) {
  const flag = rawArgs.find((a) => a.startsWith(`--${name}`));
  if (!flag) return defaultValue;
  const eq = flag.indexOf('=');
  return eq === -1 ? true : flag.slice(eq + 1);
}

if (!TABLE_NAME) {
  console.error(
    'Usage: TRACE_TABLE=<tableName> node create-trace-summaries.mjs <tableName> [--dry-run] [--limit=100] [--rate=200] [--page-size=500]'
  );
  process.exit(1);
}

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const PAGE_SIZE = Number(getFlag('page-size', process.env.PAGE_SIZE || 500));
const DRY_RUN =
  getFlag('dry-run', process.env.DRY_RUN === 'true' ? true : false) === true ||
  getFlag('dry-run', false) === 'true';
const LIMIT = Number(getFlag('limit', process.env.LIMIT || 0)) || 0; // stop after creating LIMIT summaries (0 = unlimited)
const RATE = Number(getFlag('rate', process.env.RATE || 0)) || 0; // writes per second (0 = no throttle)

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  console.log(`Scanning ${TABLE_NAME} to generate trace summaries (pageSize=${PAGE_SIZE})`);
  let lastKey = undefined;
  let created = 0;
  const seen = new Set();

  const msPerWrite = RATE > 0 ? Math.round(1000 / RATE) : 0;
  let shouldStop = false;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: 'traceId',
        Limit: PAGE_SIZE,
        ExclusiveStartKey: lastKey,
      })
    );

    for (const item of res.Items ?? []) {
      const traceId = item?.traceId;
      if (!traceId || seen.has(traceId)) continue;
      seen.add(traceId);

      // Skip if summary already exists
      const existing = await docClient.send(
        new GetCommand({ TableName: TABLE_NAME, Key: { traceId, nodeId: '__summary__' } })
      );
      if (existing.Item) continue;

      // Fetch one representative node (most recent) to populate the summary
      const q = await docClient.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'traceId = :tid',
          ExpressionAttributeValues: { ':tid': traceId },
          Limit: 1,
          ScanIndexForward: false,
        })
      );
      const base = (q.Items ?? [])[0] ?? {};

      const summary = {
        traceId,
        nodeId: '__summary__',
        userId: base.userId ?? null,
        source: base.source ?? null,
        agentId: base.agentId ?? null,
        timestamp: base.timestamp ?? Date.now(),
        status: base.status ?? 'started',
        title:
          (base.initialContext && (base.initialContext.title || base.initialContext.message)) ??
          null,
        expiresAt: base.expiresAt,
      };

      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would create summary for ${traceId}`);
        created++;
      } else {
        try {
          await docClient.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: summary,
              ConditionExpression: 'attribute_not_exists(traceId) AND attribute_not_exists(nodeId)',
            })
          );
          created++;
          if (msPerWrite > 0) await sleep(msPerWrite);
          if (created % 50 === 0) console.log(`Created ${created} summaries so far...`);
        } catch (err) {
          // ignore conditional failures or transient errors
          console.warn(`Skipping ${traceId}: ${(err && err.message) || err}`);
        }
      }

      if (LIMIT > 0 && created >= LIMIT) {
        shouldStop = true;
        break;
      }
    }

    if (shouldStop) break;
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  console.log(`Done. Created ${created} summary rows.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(2);
});
