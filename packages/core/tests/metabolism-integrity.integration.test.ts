import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { MetabolismService } from '../lib/maintenance/metabolism';
import { getDlqEntries } from '../lib/utils/bus';
import { FeatureFlags } from '../lib/feature-flags';
import { setGap } from '../lib/memory/gap-operations';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('../lib/memory/gap-operations', () => ({
  setGap: vi.fn().mockResolvedValue(undefined),
  archiveStaleGaps: vi.fn().mockResolvedValue(0),
  cullResolvedGaps: vi.fn().mockResolvedValue(0),
}));

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-table' },
  },
}));

describe('Metabolic Loop Integrity [Perspective F]', () => {
  const mockMemory = {
    workspaceId: 'ws-test',
    getScopedUserId: vi.fn((id) => `WS#ws-test#${id}`),
    putItem: vi.fn().mockResolvedValue(undefined),
  } as any;

  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  it('enforces server-side filtering for multi-tenant DLQ retrieval', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ userId: 'DLQ#1', workspaceId: 'ws-test', type: 'DLQ_EVENT' }],
    });

    await getDlqEntries({ workspaceId: 'ws-test' });

    const call = ddbMock.call(0);
    const input = call.args[0].input as any;

    expect(input.FilterExpression).toBe('workspaceId = :ws');
    expect(input.ExpressionAttributeValues[':ws']).toBe('ws-test');
  });

  it('propagates workspaceId during dashboard failure remediation (Principle 11)', async () => {
    const failure = {
      traceId: 'trace-123',
      agentId: 'coder',
      error: 'Simulated failure',
      workspaceId: 'ws-remediate',
    };

    await MetabolismService.remediateDashboardFailure(mockMemory, failure as any);

    expect(setGap).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('REMEDIATION'),
      expect.any(String),
      expect.anything(),
      'ws-remediate' // Crucial: must be scoped
    );
  });

  it('prunes feature flags with explicit workspace scoping', async () => {
    // We can't easily mock ConfigManager inside FeatureFlags here without complex setup,
    // but we verified the logic in feature-flags.test.ts.
    // This test ensures the integration path in MetabolismService passes the ID.

    const pruneSpy = vi.spyOn(FeatureFlags, 'pruneStaleFlags');

    await MetabolismService.runMetabolismAudit(mockMemory, {
      repair: true,
      workspaceId: 'ws-scoped-repair',
    });

    expect(pruneSpy).toHaveBeenCalledWith(expect.any(Number), 'ws-scoped-repair');
  });
});
