import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlastRadiusStore } from './blast-radius-store';
import { getDocClient } from '../utils/ddb-client';

vi.mock('../utils/ddb-client', () => ({
  getDocClient: vi.fn(),
  getMemoryTableName: vi.fn(() => 'MemoryTable'),
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('BlastRadiusStore Isolation', () => {
  let store: BlastRadiusStore;
  let mockDocClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDocClient = {
      send: vi.fn(),
    };
    (getDocClient as any).mockReturnValue(mockDocClient);
    store = new BlastRadiusStore();
  });

  it('should use workspace-prefixed partition keys', async () => {
    mockDocClient.send.mockResolvedValue({ Item: null });

    await store.getBlastRadius('agent-1', 'action-1', 'ws-1');

    const lastCall = mockDocClient.send.mock.calls[0][0];
    expect(lastCall.input.Key.userId).toBe('WS#ws-1#SAFETY#BLAST_RADIUS#agent-1:action-1');
  });

  it('should isolate blast radius counts between workspaces', async () => {
    // This is primarily verified by the PK generation, but we can simulate the increment too
    mockDocClient.send.mockResolvedValue({ Attributes: { count: 1, lastAction: Date.now() } });

    await store.incrementBlastRadius('agent-1', 'action-1', 'ws-1');
    let lastCall = mockDocClient.send.mock.calls[0][0];
    expect(lastCall.input.Key.userId).toBe('WS#ws-1#SAFETY#BLAST_RADIUS#agent-1:action-1');

    await store.incrementBlastRadius('agent-1', 'action-1', 'ws-2');
    lastCall = mockDocClient.send.mock.calls[1][0];
    expect(lastCall.input.Key.userId).toBe('WS#ws-2#SAFETY#BLAST_RADIUS#agent-1:action-1');
  });

  it('should fall back to global prefix if workspaceId is missing (legacy)', async () => {
    mockDocClient.send.mockResolvedValue({ Item: null });

    await store.getBlastRadius('agent-1', 'action-1');

    const lastCall = mockDocClient.send.mock.calls[0][0];
    expect(lastCall.input.Key.userId).toBe('SAFETY#BLAST_RADIUS#agent-1:action-1');
  });
});
