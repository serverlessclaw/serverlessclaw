import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getReputation, updateReputation } from './reputation-operations';
import { MEMORY_KEYS } from '../constants';

const mockBase = {
  queryItems: vi.fn(),
  putItem: vi.fn(),
  updateItem: vi.fn(),
  getScopedUserId: vi.fn((userId, workspaceId) =>
    workspaceId ? `WS#${workspaceId}#${userId}` : userId
  ),
};

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Reputation Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use workspace-scoped keys for reputation updates', async () => {
    await updateReputation(mockBase as any, 'agent-1', true, 100, 'workspace-A');

    expect(mockBase.updateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.objectContaining({
          userId: `WS#workspace-A#${MEMORY_KEYS.REPUTATION_PREFIX}agent-1`,
        }),
      })
    );
  });

  it('should use global keys when no workspaceId is provided', async () => {
    await updateReputation(mockBase as any, 'agent-1', true, 100);

    expect(mockBase.updateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Key: expect.objectContaining({
          userId: `${MEMORY_KEYS.REPUTATION_PREFIX}agent-1`,
        }),
      })
    );
  });

  it('should isolate lookups by workspaceId', async () => {
    mockBase.queryItems.mockResolvedValue([]);

    await getReputation(mockBase as any, 'agent-1', 'workspace-B');

    expect(mockBase.queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        ExpressionAttributeValues: expect.objectContaining({
          ':pk': `WS#workspace-B#${MEMORY_KEYS.REPUTATION_PREFIX}agent-1`,
        }),
      })
    );
  });
});
