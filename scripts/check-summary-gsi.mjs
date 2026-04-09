#!/usr/bin/env node
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const rawArgs = process.argv.slice(2);
const TABLE_NAME = process.env.TRACE_TABLE || rawArgs.find((a) => !a.startsWith('--'));

function getFlag(name, defaultValue) {
  const flag = rawArgs.find((a) => a.startsWith(`--${name}`));
  if (!flag) return defaultValue;
  const eq = flag.indexOf('=');
  return eq === -1 ? true : flag.slice(eq + 1);
}

if (!TABLE_NAME) {
  console.error(
    'Usage: TRACE_TABLE=<tableName> node scripts/check-summary-gsi.mjs <tableName> [--wait] [--timeout=300]'
  );
  process.exit(1);
}

const WAIT = getFlag('wait', false) === true || getFlag('wait', false) === 'true';
const TIMEOUT = Number(getFlag('timeout', process.env.TIMEOUT || 300)) || 300; // seconds
const REGION = process.env.AWS_REGION || 'ap-southeast-2';

const client = new DynamoDBClient({ region: REGION });

async function describe() {
  return client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
}

async function checkOnce() {
  try {
    const res = await describe();
    const gsi = res.Table?.GlobalSecondaryIndexes?.find((g) => g.IndexName === 'SummaryByNode');
    if (!gsi) {
      console.error(`GSI SummaryByNode not found on table ${TABLE_NAME}`);
      return { found: false };
    }
    const status = gsi.IndexStatus;
    console.log(`Found GSI SummaryByNode on ${TABLE_NAME}; status=${status}`);
    return { found: true, status };
  } catch (err) {
    console.error('DescribeTable failed:', err?.message ?? err);
    return { error: true, err };
  }
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function waitForActive() {
  const start = Date.now();
  const deadline = start + TIMEOUT * 1000;
  while (Date.now() < deadline) {
    const r = await checkOnce();
    if (r.found && r.status === 'ACTIVE') return true;
    await sleep(5000);
  }
  return false;
}

(async () => {
  const r = await checkOnce();
  if (!r.found) process.exit(2);
  if (r.status === 'ACTIVE') process.exit(0);
  if (!WAIT) {
    console.error(
      'GSI exists but is not ACTIVE yet. Re-run with `--wait` to wait for ACTIVE status.'
    );
    process.exit(3);
  }

  console.log(`Waiting up to ${TIMEOUT}s for SummaryByNode to become ACTIVE...`);
  const ok = await waitForActive();
  if (ok) {
    console.log('SummaryByNode is ACTIVE');
    process.exit(0);
  } else {
    console.error('Timeout waiting for SummaryByNode to become ACTIVE');
    process.exit(4);
  }
})();
