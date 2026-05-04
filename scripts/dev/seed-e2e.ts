/**
 * E2E Data Seeding Script
 * Seeds DynamoDB with the necessary data for Playwright E2E tests.
 * Supports both local and production environments via standard AWS/SST resolution.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getMemoryTableName, getTraceTableName } from '../../packages/core/lib/utils/ddb-client';
import { GapStatus } from '../../packages/core/lib/types/agent';
import { MEMORY_KEYS } from '../../packages/core/lib/constants';

async function seed() {
  console.log('🌱 Starting E2E Data Seeding...');

  const memoryTable = getMemoryTableName();
  const traceTable = getTraceTableName();

  if (!memoryTable || !traceTable) {
    console.error(
      '❌ Error: Table names not found. Ensure environment variables or SST resources are available.'
    );
    process.exit(1);
  }

  const client = new DynamoDBClient({});
  const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  const now = Date.now() - 300000; // 5 minutes in past for reliable indexing
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  try {
    // 0. Seed User Identities
    console.log('👤 Seeding E2E Users...');
    const users = [
      { id: 'dashboard-user', role: 'admin' },
      { id: 'superadmin', role: 'owner' },
    ];

    for (const u of users) {
      await docClient.send(
        new PutCommand({
          TableName: memoryTable,
          Item: {
            userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}USER#${u.id}`,
            timestamp: 0,
            type: 'USER_IDENTITY',
            role: u.role,
            workspaceIds: ['default'],
            authProvider: 'dashboard',
            createdAt: now,
            lastActiveAt: now,
          },
        })
      );
    }

    // 1. Seed Traces for 'Collaboration Test Trace'
    console.log('📝 Seeding Traces...');
    const traceId = 'trace_collaboration_test';

    // Trace Summary
    await docClient.send(
      new PutCommand({
        TableName: traceTable,
        Item: {
          traceId,
          nodeId: '__summary__',
          timestamp: now,
          userId: 'dashboard-user',
          agentId: 'superclaw',
          source: 'user',
          status: 'completed',
          task: 'Collaboration Test Trace',
          initialContext: { userText: 'Collaboration Test Trace' },
          workspaceId: 'default',
          metadata: { category: 'test' },
        },
      })
    );

    // Trace Steps
    await docClient.send(
      new PutCommand({
        TableName: traceTable,
        Item: {
          traceId,
          nodeId: 'step_1',
          timestamp: now,
          type: 'thought',
          source: 'user',
          agentId: 'superclaw',
          workspaceId: 'default',
          content: { text: 'Starting collaboration test' },
        },
      })
    );

    // Collaboration Data for Canvas rendering
    await docClient.send(
      new PutCommand({
        TableName: traceTable,
        Item: {
          traceId,
          nodeId: '__collaboration__',
          timestamp: now,
          type: 'COLLABORATION',
          source: 'user',
          agentId: 'superclaw',
          workspaceId: 'default',
          collaborationId: 'collab_test_1',
          participants: [
            { id: 'superclaw', type: 'agent', role: 'initiator' },
            { id: 'coder', type: 'agent', role: 'specialist' },
          ],
          status: 'active',
          metadata: {
            graph: {
              nodes: [
                { id: 'n1', data: { label: 'Start' }, position: { x: 0, y: 0 } },
                { id: 'n2', data: { label: 'Process' }, position: { x: 100, y: 100 } },
              ],
              edges: [{ id: 'e1-2', source: 'n1', target: 'n2' }],
            },
          },
        },
      })
    );

    // Seed Tool Source Test Trace
    console.log('📝 Seeding Tool Source Trace...');
    const toolTraceId = 'trace_tool_source_test';

    await docClient.send(
      new PutCommand({
        TableName: traceTable,
        Item: {
          traceId: toolTraceId,
          nodeId: '__summary__',
          timestamp: now,
          userId: 'dashboard-user',
          agentId: 'superclaw',
          source: 'user',
          status: 'completed',
          task: 'Tool Source Test Trace',
          initialContext: { userText: 'Tool Source Test Trace' },
          workspaceId: 'default',
          metadata: { category: 'test' },
        },
      })
    );

    await docClient.send(
      new PutCommand({
        TableName: traceTable,
        Item: {
          traceId: toolTraceId,
          nodeId: 'step_1',
          timestamp: now,
          type: 'tool_call',
          source: 'user',
          agentId: 'superclaw',
          workspaceId: 'default',
          content: { toolName: 'mcp-github_get_issue', tool: 'mcp-github_get_issue', args: {} },
        },
      })
    );

    await docClient.send(
      new PutCommand({
        TableName: traceTable,
        Item: {
          traceId: toolTraceId,
          nodeId: 'step_2',
          timestamp: now + 1000,
          type: 'tool_call',
          source: 'user',
          agentId: 'superclaw',
          workspaceId: 'default',
          content: { toolName: 'local_tool', tool: 'local_tool', args: {} },
        },
      })
    );

    // 2. Seed Gaps for 'Simulated capability failure'
    console.log('🕳️ Seeding Gaps...');
    await docClient.send(
      new PutCommand({
        TableName: memoryTable,
        Item: {
          userId: `GAP#simulated_failure_1`,
          timestamp: now,
          type: 'GAP',
          status: GapStatus.OPEN,
          content: 'Simulated capability failure in production E2E',
          workspaceId: 'default',
          metadata: {
            category: 'strategic_gap',
            impact: 8,
            urgency: 5,
          },
        },
      })
    );

    // 3. Seed Reputation for agents
    console.log('📈 Seeding Reputation...');
    const agents = ['superclaw', 'coder', 'researcher'];
    for (const agentId of agents) {
      await docClient.send(
        new PutCommand({
          TableName: memoryTable,
          Item: {
            userId: `${MEMORY_KEYS.REPUTATION_PREFIX}${agentId}`,
            timestamp: 0,
            type: 'REPUTATION',
            agentId,
            tasksCompleted: 50,
            tasksFailed: 2,
            successRate: 0.96,
            avgLatencyMs: 1200,
            lastActive: now,
            windowStart: weekAgo,
          },
        })
      );
    }

    // 4. Seed Health Metrics
    console.log('🏥 Seeding Health...');
    for (const agentId of agents) {
      await docClient.send(
        new PutCommand({
          TableName: memoryTable,
          Item: {
            userId: `HEALTH#${agentId}`,
            timestamp: 0,
            type: 'HEALTH',
            overallScore: 95,
            taskCompletionRate: 0.98,
            reasoningCoherence: 0.92,
            errorRate: 0.02,
            updatedAt: now,
          },
        })
      );
    }

    // 5. Seed Budget
    console.log('💰 Seeding Budget...');
    await docClient.send(
      new PutCommand({
        TableName: memoryTable,
        Item: {
          userId: 'track_evolution_budget',
          timestamp: 0,
          type: 'CONFIG',
          maxTotalBudgetUsd: 10.0,
          budgets: [
            { track: 'high', allocated: 5.0, spent: 1.2 },
            { track: 'standard', allocated: 3.0, spent: 0.5 },
            { track: 'light', allocated: 2.0, spent: 0.1 },
          ],
        },
      })
    );

    console.log('✅ E2E Seeding Completed Successfully!');
  } catch (error) {
    console.error('❌ E2E Seeding Failed:', error);
    process.exit(1);
  }
}

seed();
