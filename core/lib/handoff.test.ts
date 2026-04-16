import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestHandoff, isHumanTakingControl } from './handoff';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('./utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./registry/config', () => ({
  ConfigManager: {
    getRawConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('Handoff Protocol', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.clearAllMocks();
  });

  it('should record handoff in DynamoDB and emit event', async () => {
    ddbMock.on(PutCommand).resolves({});

    await requestHandoff('user-1', 'session-1');

    expect(ddbMock.calls()).toHaveLength(1);
    const input = ddbMock.call(0).args[0].input as any;
    expect(input.Item.userId).toBe('HANDOFF#user-1');
    expect(input.Item.type).toBe('HANDOFF');

    const { emitEvent } = await import('./utils/bus');
    expect(emitEvent).toHaveBeenCalledWith(
      'handoff-protocol',
      'handoff',
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('should honor handoff_ttl_seconds from ConfigTable', async () => {
    ddbMock.on(PutCommand).resolves({});
    const { ConfigManager } = await import('./registry/config');
    (ConfigManager.getRawConfig as any).mockResolvedValueOnce(300);

    await requestHandoff('user-ttl', 'session-ttl');

    const input = ddbMock.call(0).args[0].input as any;
    const now = Math.floor(Date.now() / 1000);
    expect(input.Item.expiresAt).toBeGreaterThanOrEqual(now + 299);
    expect(input.Item.expiresAt).toBeLessThanOrEqual(now + 301);
  });

  it('should return true if handoff is active', async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'HANDOFF#user-1', expiresAt: future },
    });

    const result = await isHumanTakingControl('user-1');
    expect(result).toBe(true);
  });

  it('should return false if handoff is expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 100;
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'HANDOFF#user-1', expiresAt: past },
    });

    const result = await isHumanTakingControl('user-1');
    expect(result).toBe(false);
  });

  it('should return false if no handoff record exists', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const result = await isHumanTakingControl('user-1');
    expect(result).toBe(false);
  });

  it('should handle missing MemoryTable in requestHandoff', async () => {
    vi.resetModules();
    vi.doMock('sst', () => ({
      Resource: {},
    }));
    const { requestHandoff: requestWithMock } = await import('./handoff');
    await requestWithMock('user-1');
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('should handle missing MemoryTable in isHumanTakingControl', async () => {
    vi.resetModules();
    vi.doMock('sst', () => ({
      Resource: {},
    }));
    const { isHumanTakingControl: checkWithMock } = await import('./handoff');
    const result = await checkWithMock('user-1');
    expect(result).toBe(false);
  });

  it('should handle DynamoDB error in requestHandoff', async () => {
    ddbMock.on(PutCommand).rejects(new Error('DDB Error'));
    await requestHandoff('user-1');
    // Should not throw, but log error
  });

  it('should handle DynamoDB error in isHumanTakingControl', async () => {
    ddbMock.on(GetCommand).rejects(new Error('DDB Error'));
    const result = await isHumanTakingControl('user-1');
    expect(result).toBe(false);
  });

  it('should return true when sessionId matches stored session', async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'HANDOFF#user-1', expiresAt: future, sessionId: 'session-1' },
    });

    const result = await isHumanTakingControl('user-1', 'session-1');
    expect(result).toBe(true);
  });

  it('should return false when sessionId does not match stored session', async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'HANDOFF#user-1', expiresAt: future, sessionId: 'session-1' },
    });

    const result = await isHumanTakingControl('user-1', 'session-2');
    expect(result).toBe(false);
  });

  it('should return true when stored handoff has no sessionId but check includes sessionId (Global Handoff)', async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'HANDOFF#user-1', expiresAt: future },
    });

    const result = await isHumanTakingControl('user-1', 'session-1');
    expect(result).toBe(true);
  });

  it('should ignore sessionId parameter for backwards compatibility', async () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    ddbMock.on(GetCommand).resolves({
      Item: { userId: 'HANDOFF#user-1', expiresAt: future, sessionId: 'session-1' },
    });

    const result = await isHumanTakingControl('user-1');
    expect(result).toBe(true);
  });
});
