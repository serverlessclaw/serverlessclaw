import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

/**
 * Seed Production Data for E2E Tests (Direct DynamoDB version)
 *
 * Run with: npx sst shell --stage prod -- npx tsx scratch/seed-prod-data.ts
 */

async function seedData() {
  console.log('🚀 Seeding production data for E2E tests (Direct DDB)...');

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client);

  const memoryTable = (Resource as any).MemoryTable.name;
  const traceTable = (Resource as any).TraceTable.name;
  const userId = 'dashboard-user';

  const runId = Math.random().toString(36).substring(7);
  const now = Date.now();

  // 1. Create a FAILED Gap
  const failedGapId = `gap-resilience-fail-${now}`;
  console.log(`📦 Creating failed gap: ${failedGapId} in ${memoryTable}`);
  await docClient.send(
    new PutCommand({
      TableName: memoryTable,
      Item: {
        userId: `GAP#${failedGapId}`,
        timestamp: now,
        type: 'GAP',
        content: `Simulated capability failure ${runId}`,
        status: 'FAILED',
        metadata: { impact: 8, priority: 9 },
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  // 2. Create a Trace with a FAILED node
  const failedTraceId = uuidv4();
  console.log(`📦 Creating failed trace: ${failedTraceId} in ${traceTable}`);

  await docClient.send(
    new PutCommand({
      TableName: traceTable,
      Item: {
        traceId: failedTraceId,
        nodeId: 'root',
        userId,
        source: 'dashboard',
        agentId: 'superclaw',
        timestamp: now + 1,
        status: 'failed',
        initialContext: { userText: `Resilience Test Trace ${runId}` },
        failureReason: 'Simulated execution error for retry UI testing',
        steps: [
          {
            stepId: uuidv4(),
            type: 'thought',
            content: 'Processing resilience test...',
            timestamp: now + 1,
          },
        ],
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: traceTable,
      Item: {
        traceId: failedTraceId,
        nodeId: '__summary__',
        userId,
        source: 'dashboard',
        agentId: 'superclaw',
        timestamp: now + 1,
        status: 'failed',
        initialContext: { userText: `Resilience Test Trace ${runId}` },
        failureReason: 'Simulated execution error for retry UI testing',
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  // 3. Create a Trace with tool calls (MCP vs Local)
  const toolTraceId = uuidv4();
  console.log(`📦 Creating tool trace: ${toolTraceId}`);

  await docClient.send(
    new PutCommand({
      TableName: traceTable,
      Item: {
        traceId: toolTraceId,
        nodeId: 'root',
        userId,
        source: 'dashboard',
        agentId: 'superclaw',
        timestamp: now + 2,
        status: 'completed',
        initialContext: { userText: `Tool Source Test Trace ${runId}` },
        steps: [
          {
            stepId: uuidv4(),
            type: 'tool_call',
            content: { toolName: 'list_files', connectorId: 'mcp-server-1' },
            timestamp: now + 2,
          },
          {
            stepId: uuidv4(),
            type: 'tool_call',
            content: { toolName: 'saveMemory' },
            timestamp: now + 3,
          },
        ],
        finalResponse: 'I have listed files and saved memory.',
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: traceTable,
      Item: {
        traceId: toolTraceId,
        nodeId: '__summary__',
        userId,
        source: 'dashboard',
        agentId: 'superclaw',
        timestamp: now + 2,
        status: 'completed',
        initialContext: { userText: `Tool Source Test Trace ${runId}` },
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  // 4. Create a Trace with collaboration
  const collabTraceId = uuidv4();
  const collabId = uuidv4();
  console.log(`📦 Creating collaboration trace: ${collabTraceId}`);

  await docClient.send(
    new PutCommand({
      TableName: traceTable,
      Item: {
        traceId: collabTraceId,
        nodeId: 'root',
        userId,
        source: 'dashboard',
        agentId: 'superclaw',
        timestamp: now + 4,
        status: 'completed',
        initialContext: { userText: `Collaboration Test Trace ${runId}` },
        metadata: { collaborationId: collabId },
        steps: [
          {
            stepId: uuidv4(),
            type: 'thought',
            content: 'Initiating swarm intelligence...',
            timestamp: now + 4,
            metadata: { collaborationId: collabId },
          },
        ],
        finalResponse: 'Swarm collaboration established.',
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  await docClient.send(
    new PutCommand({
      TableName: traceTable,
      Item: {
        traceId: collabTraceId,
        nodeId: '__summary__',
        userId,
        source: 'dashboard',
        agentId: 'superclaw',
        timestamp: now + 4,
        status: 'completed',
        initialContext: { userText: `Collaboration Test Trace ${runId}` },
        metadata: { collaborationId: collabId },
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  // Create Collaboration record
  await docClient.send(
    new PutCommand({
      TableName: memoryTable,
      Item: {
        userId: `COLLAB#${collabId}`,
        timestamp: 0,
        type: 'COLLABORATION',
        collaborationId: collabId,
        name: 'E2E Swarm Collaboration',
        status: 'active',
        participants: [
          { type: 'human', id: userId, role: 'owner' },
          { type: 'agent', id: 'coder', role: 'editor' },
        ],
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      },
    })
  );

  console.log('\n✅ Seeding completed successfully.');
}

seedData().catch((err) => {
  console.error('💥 Seeding failed:', err);
  process.exit(1);
});
