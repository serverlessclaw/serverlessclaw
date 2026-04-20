import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BaseMemoryProvider } from './base';
import type { Collaboration, CreateCollaborationInput } from '../types/collaboration';

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock RetentionManager
vi.mock('./tiering', () => ({
  RetentionManager: {
    getExpiresAt: vi.fn().mockImplementation((category: string) => {
      if (category === 'SESSIONS') {
        return Promise.resolve({ expiresAt: 9999999, type: 'SESSION' });
      }
      return Promise.resolve({ expiresAt: 9999999, type: 'SESSION' });
    }),
  },
}));

import {
  createCollaboration,
  addCollaborationParticipant,
  getCollaboration,
  listCollaborationsForParticipant,
  checkCollaborationAccess,
  closeCollaboration,
} from './collaboration-operations';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';

function createMockBase(): BaseMemoryProvider & {
  queryItems: ReturnType<typeof vi.fn>;
  putItem: ReturnType<typeof vi.fn>;
  updateItem: ReturnType<typeof vi.fn>;
  getHistory: ReturnType<typeof vi.fn>;
} {
  return {
    queryItems: vi.fn(),
    putItem: vi.fn(),
    queryItemsPaginated: vi.fn(),
    deleteItem: vi.fn(),
    updateItem: vi.fn(),
    scanByPrefix: vi.fn(),
    getHistory: vi.fn(),
    clearHistory: vi.fn(),
    getDistilledMemory: vi.fn(),
    listConversations: vi.fn(),
    getScopedUserId: vi.fn().mockImplementation((uid, wid) => (wid ? `${uid}#${wid}` : uid)),
  } as unknown as BaseMemoryProvider & {
    queryItems: ReturnType<typeof vi.fn>;
    putItem: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
  };
}

const MOCK_NOW = 1700000000000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(MOCK_NOW);
});

describe('createCollaboration', () => {
  it('should create a collaboration with the owner as the sole participant', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    const input: CreateCollaborationInput = {
      name: 'Test Collab',
      description: 'A test',
      tags: ['tag1'],
      workspaceId: 'ws-1',
    };

    const collab = await createCollaboration(base, 'owner-1', 'agent', input);

    expect(collab.collaborationId).toBe('collab-uuid');
    expect(collab.name).toBe('Test Collab');
    expect(collab.description).toBe('A test');
    expect(collab.owner).toEqual({ type: 'agent', id: 'owner-1' });
    expect(collab.participants).toHaveLength(1);
    expect(collab.participants[0]).toEqual({
      type: 'agent',
      id: 'owner-1',
      role: 'owner',
      joinedAt: MOCK_NOW,
    });
    expect(collab.status).toBe('active');
    expect(collab.tags).toEqual(['tag1']);
    expect(collab.workspaceId).toBe('ws-1');
    expect(collab.syntheticUserId).toBe('shared#collab#collab-uuid');

    // uuid called twice: once for collaborationId, once for sessionId (not provided)
    expect(uuidv4).toHaveBeenCalledTimes(2);

    // putItem called once for COLLABORATION, once for COLLABORATION_INDEX
    expect(base.putItem).toHaveBeenCalledTimes(2);

    // First call stores the collaboration
    const collabItem = base.putItem.mock.calls[0][0];
    expect(collabItem.userId).toBe('COLLAB#collab-uuid#ws-1');
    expect(collabItem.type).toBe('COLLABORATION');

    // Second call indexes the owner
    const indexItem = base.putItem.mock.calls[1][0];
    expect(indexItem.userId).toBe('COLLAB_INDEX#agent#owner-1#ws-1');
    expect(indexItem.type).toBe('COLLABORATION_INDEX');
    expect(indexItem.role).toBe('owner');

    expect(logger.info).toHaveBeenCalledWith(
      'Collaboration created: collab-uuid by agent:owner-1 in workspace: ws-1'
    );
  });

  it('should use provided sessionId', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    const input: CreateCollaborationInput = {
      name: 'Test',
      sessionId: 'my-session',
    };

    const collab = await createCollaboration(base, 'owner-1', 'human', input);

    expect(collab.sessionId).toBe('my-session');
    // Only one uuid call for collaborationId
    expect(uuidv4).toHaveBeenCalledTimes(1);
  });

  it('should include initial participants excluding the owner', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    const input: CreateCollaborationInput = {
      name: 'Test',
      initialParticipants: [
        { type: 'agent', id: 'owner-1', role: 'owner' },
        { type: 'agent', id: 'agent-2', role: 'editor' },
        { type: 'human', id: 'human-1', role: 'viewer' },
      ],
    };

    const collab = await createCollaboration(base, 'owner-1', 'agent', input);

    // Owner should not be duplicated
    expect(collab.participants).toHaveLength(3);
    expect(collab.participants[0].id).toBe('owner-1');
    expect(collab.participants[1].id).toBe('agent-2');
    expect(collab.participants[2].id).toBe('human-1');

    // Should index all 3 participants
    expect(base.putItem).toHaveBeenCalledTimes(4); // 1 collab + 3 indexes
  });

  it('should set expiresAt when ttlDays is provided', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    const input: CreateCollaborationInput = {
      name: 'Test',
      ttlDays: 30,
    };

    const collab = await createCollaboration(base, 'owner-1', 'agent', input);

    const expectedExpiry = Math.floor((MOCK_NOW + 30 * 24 * 60 * 60 * 1000) / 1000);
    expect(collab.expiresAt).toBe(expectedExpiry);
  });

  it('should not set expiresAt when ttlDays is not provided', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    const collab = await createCollaboration(base, 'owner-1', 'agent', { name: 'Test' });

    expect(collab.expiresAt).toBe(9999999);
  });
});

describe('getCollaboration', () => {
  it('should return a collaboration when found', async () => {
    const base = createMockBase();
    const collabData = {
      collaborationId: 'collab-1',
      name: 'Test',
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collabData]);

    const result = await getCollaboration(base, 'collab-1');

    expect(result).toEqual(collabData);
    expect(base.queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyConditionExpression: 'userId = :userId AND #timestamp = :zero',
        ExpressionAttributeValues: {
          ':userId': 'COLLAB#collab-1',
          ':zero': 0,
        },
      })
    );
  });

  it('should return null when not found', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([]);

    const result = await getCollaboration(base, 'nonexistent');

    expect(result).toBeNull();
  });
});

describe('addCollaborationParticipant', () => {
  it('should add a new participant when actor is owner', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [{ type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);
    base.putItem.mockResolvedValue(undefined);
    base.updateItem.mockResolvedValue(undefined);

    await addCollaborationParticipant(base, 'collab-1', 'owner-1', 'agent', {
      type: 'human',
      id: 'human-1',
      role: 'editor',
    });

    expect(base.updateItem).toHaveBeenCalledTimes(1);
    expect(base.putItem).toHaveBeenCalledTimes(1);

    // Put creates index entry
    const indexEntry = base.putItem.mock.calls[0][0];
    expect(indexEntry.userId).toBe('COLLAB_INDEX#human#human-1');
    expect(indexEntry.role).toBe('editor');
    expect(indexEntry.collaborationId).toBe('collab-1');

    expect(logger.info).toHaveBeenCalledWith(
      'Participant human:human-1 added to collaboration collab-1 in workspace undefined'
    );
  });

  it('should throw when collaboration not found', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([]);

    await expect(
      addCollaborationParticipant(base, 'nonexistent', 'owner-1', 'agent', {
        type: 'agent',
        id: 'agent-2',
        role: 'viewer',
      })
    ).rejects.toThrow('Collaboration nonexistent not found');
  });

  it('should throw when actor is not the owner', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [
        { type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW },
        { type: 'agent', id: 'editor-1', role: 'editor', joinedAt: MOCK_NOW },
      ],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);

    await expect(
      addCollaborationParticipant(base, 'collab-1', 'editor-1', 'agent', {
        type: 'human',
        id: 'human-1',
        role: 'viewer',
      })
    ).rejects.toThrow('Only owners can add participants');
  });

  it('should throw when actor is not a participant', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [{ type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);

    await expect(
      addCollaborationParticipant(base, 'collab-1', 'stranger', 'agent', {
        type: 'agent',
        id: 'agent-2',
        role: 'viewer',
      })
    ).rejects.toThrow('Only owners can add participants');
  });
});

describe('listCollaborationsForParticipant', () => {
  it('should return collaboration summaries for a participant', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([
      { collaborationId: 'c1', role: 'owner', collaborationName: 'Collab 1' },
      { collaborationId: 'c2', role: 'editor', collaborationName: 'Collab 2' },
    ]);

    const result = await listCollaborationsForParticipant(base, 'agent-1', 'agent');

    expect(result).toEqual([
      { collaborationId: 'c1', role: 'owner', collaborationName: 'Collab 1' },
      { collaborationId: 'c2', role: 'editor', collaborationName: 'Collab 2' },
    ]);
    expect(base.queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': 'COLLAB_INDEX#agent#agent-1',
        },
      })
    );
  });

  it('should return empty array when participant has no collaborations', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([]);

    const result = await listCollaborationsForParticipant(base, 'agent-1', 'agent');

    expect(result).toEqual([]);
  });
});

describe('checkCollaborationAccess', () => {
  const activeCollab: Collaboration = {
    collaborationId: 'collab-1',
    name: 'Test',
    sessionId: 'sess-1',
    syntheticUserId: 'shared#collab#collab-1',
    owner: { type: 'agent', id: 'owner-1' },
    participants: [
      { type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW },
      { type: 'agent', id: 'editor-1', role: 'editor', joinedAt: MOCK_NOW },
      { type: 'human', id: 'viewer-1', role: 'viewer', joinedAt: MOCK_NOW },
    ],
    createdAt: MOCK_NOW,
    updatedAt: MOCK_NOW,
    lastActivityAt: MOCK_NOW,
    status: 'active',
  };

  it('should return true for owner without requiredRole', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([activeCollab]);

    const result = await checkCollaborationAccess(base, 'collab-1', 'owner-1', 'agent');

    expect(result).toBe(true);
  });

  it('should return true for editor without requiredRole', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([activeCollab]);

    const result = await checkCollaborationAccess(base, 'collab-1', 'editor-1', 'agent');

    expect(result).toBe(true);
  });

  it('should return true for viewer without requiredRole', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([activeCollab]);

    const result = await checkCollaborationAccess(base, 'collab-1', 'viewer-1', 'human');

    expect(result).toBe(true);
  });

  it('should return false for non-participant', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([activeCollab]);

    const result = await checkCollaborationAccess(base, 'collab-1', 'stranger', 'agent');

    expect(result).toBe(false);
  });

  it('should return false when collaboration not found', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([]);

    const result = await checkCollaborationAccess(base, 'nonexistent', 'owner-1', 'agent');

    expect(result).toBe(false);
  });

  it('should return false when collaboration status is closed', async () => {
    const base = createMockBase();
    const closedCollab = { ...activeCollab, status: 'closed' as const };
    base.queryItems.mockResolvedValue([closedCollab]);

    const result = await checkCollaborationAccess(base, 'collab-1', 'owner-1', 'agent');

    expect(result).toBe(false);
  });

  it('should return false when collaboration status is archived', async () => {
    const base = createMockBase();
    const archivedCollab = { ...activeCollab, status: 'archived' as const };
    base.queryItems.mockResolvedValue([archivedCollab]);

    const result = await checkCollaborationAccess(base, 'collab-1', 'owner-1', 'agent');

    expect(result).toBe(false);
  });

  describe('requiredRole checks', () => {
    it('should allow owner when requiredRole is owner', async () => {
      const base = createMockBase();
      base.queryItems.mockResolvedValue([activeCollab]);

      const result = await checkCollaborationAccess(base, 'collab-1', 'owner-1', 'agent', 'owner');

      expect(result).toBe(true);
    });

    it('should deny editor when requiredRole is owner', async () => {
      const base = createMockBase();
      base.queryItems.mockResolvedValue([activeCollab]);

      const result = await checkCollaborationAccess(base, 'collab-1', 'editor-1', 'agent', 'owner');

      expect(result).toBe(false);
    });

    it('should allow editor when requiredRole is editor', async () => {
      const base = createMockBase();
      base.queryItems.mockResolvedValue([activeCollab]);

      const result = await checkCollaborationAccess(
        base,
        'collab-1',
        'editor-1',
        'agent',
        'editor'
      );

      expect(result).toBe(true);
    });

    it('should allow owner when requiredRole is editor', async () => {
      const base = createMockBase();
      base.queryItems.mockResolvedValue([activeCollab]);

      const result = await checkCollaborationAccess(base, 'collab-1', 'owner-1', 'agent', 'editor');

      expect(result).toBe(true);
    });

    it('should deny viewer when requiredRole is editor', async () => {
      const base = createMockBase();
      base.queryItems.mockResolvedValue([activeCollab]);

      const result = await checkCollaborationAccess(
        base,
        'collab-1',
        'viewer-1',
        'human',
        'editor'
      );

      expect(result).toBe(false);
    });

    it('should allow viewer when requiredRole is viewer', async () => {
      const base = createMockBase();
      base.queryItems.mockResolvedValue([activeCollab]);

      const result = await checkCollaborationAccess(
        base,
        'collab-1',
        'viewer-1',
        'human',
        'viewer'
      );

      expect(result).toBe(true);
    });
  });
});

describe('closeCollaboration', () => {
  it('should close collaboration when actor is owner', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [{ type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);
    base.updateItem.mockResolvedValue(undefined);

    await closeCollaboration(base, 'collab-1', 'owner-1', 'agent');

    expect(base.updateItem).toHaveBeenCalledTimes(1);
  });

  it('should throw when collaboration not found', async () => {
    const base = createMockBase();
    base.queryItems.mockResolvedValue([]);

    await expect(closeCollaboration(base, 'nonexistent', 'owner-1', 'agent')).rejects.toThrow(
      'Collaboration nonexistent not found'
    );
  });

  it('should throw when actor is not the owner', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [
        { type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW },
        { type: 'agent', id: 'editor-1', role: 'editor', joinedAt: MOCK_NOW },
      ],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);

    await expect(closeCollaboration(base, 'collab-1', 'editor-1', 'agent')).rejects.toThrow(
      'Only owners can close collaborations'
    );
  });

  it('should throw when actor is not a participant', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [{ type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);

    await expect(closeCollaboration(base, 'collab-1', 'stranger', 'agent')).rejects.toThrow(
      'Only owners can close collaborations'
    );
  });

  it('should log info when collaboration is closed', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [{ type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);
    base.putItem.mockResolvedValue(undefined);

    await closeCollaboration(base, 'collab-1', 'owner-1', 'agent');

    expect(logger.info).toHaveBeenCalledWith(
      'Collaboration collab-1 closed by agent:owner-1 in workspace undefined'
    );
  });
});

describe('edge cases', () => {
  it('should not duplicate owner in initialParticipants', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    const input: CreateCollaborationInput = {
      name: 'Test',
      initialParticipants: [
        { type: 'agent', id: 'owner-1', role: 'owner' },
        { type: 'agent', id: 'owner-1', role: 'editor' },
      ],
    };

    const collab = await createCollaboration(base, 'owner-1', 'agent', input);

    // Owner should appear exactly once (the initial entry), not duplicated
    const ownerEntries = collab.participants.filter((p) => p.id === 'owner-1');
    expect(ownerEntries).toHaveLength(1);
    expect(ownerEntries[0].role).toBe('owner');
  });

  it('should handle participant with same id but different type', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'user-1' },
      participants: [{ type: 'agent', id: 'user-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);
    base.updateItem.mockResolvedValue(undefined);
    base.putItem.mockResolvedValue(undefined);

    // Adding a human with the same id should work (different type)
    await addCollaborationParticipant(base, 'collab-1', 'user-1', 'agent', {
      type: 'human',
      id: 'user-1',
      role: 'viewer',
    });

    expect(base.putItem).toHaveBeenCalledTimes(1);
    const indexEntry = base.putItem.mock.calls[0][0];
    expect(indexEntry.userId).toBe('COLLAB_INDEX#human#user-1');
  });

  it('should handle owner type mismatch in access check', async () => {
    const base = createMockBase();
    const collab: Collaboration = {
      collaborationId: 'collab-1',
      name: 'Test',
      sessionId: 'sess-1',
      syntheticUserId: 'shared#collab#collab-1',
      owner: { type: 'agent', id: 'owner-1' },
      participants: [{ type: 'agent', id: 'owner-1', role: 'owner', joinedAt: MOCK_NOW }],
      createdAt: MOCK_NOW,
      updatedAt: MOCK_NOW,
      lastActivityAt: MOCK_NOW,
      status: 'active',
    };
    base.queryItems.mockResolvedValue([collab]);

    // Same id but different type should not match
    const result = await checkCollaborationAccess(base, 'collab-1', 'owner-1', 'human');

    expect(result).toBe(false);
  });

  it('should store undefined expiresAt on item when no ttlDays (spread overrides ttlExpiresAt)', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    await createCollaboration(base, 'owner-1', 'agent', { name: 'Test' });

    const collabItem = base.putItem.mock.calls[0][0];
    expect(collabItem.expiresAt).toBe(9999999);
  });

  it('should store millis expiresAt on item when ttlDays is set', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValueOnce('collab-uuid');

    await createCollaboration(base, 'owner-1', 'agent', { name: 'Test', ttlDays: 7 });

    const collabItem = base.putItem.mock.calls[0][0];
    const expectedSeconds = Math.floor((MOCK_NOW + 7 * 24 * 60 * 60 * 1000) / 1000);
    expect(collabItem.expiresAt).toBe(expectedSeconds);
  });
});

import { transitToCollaboration } from './collaboration-operations';

describe('transitToCollaboration', () => {
  it('should transit a session to a collaboration and seed history', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    base.getHistory.mockResolvedValue([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValue('collab-uuid');

    const collab = await transitToCollaboration(base, 'user-1', 'ws-1', 'sess-1', ['agent-1']);

    expect(collab.collaborationId).toBe('collab-uuid');
    expect(collab.participants).toHaveLength(3); // user-1, agent-1, facilitator

    // Check history seeding
    expect(base.getHistory).toHaveBeenCalled();
    // 1 collab + 3 indexes + 1 seed message = 5 putItems
    expect(base.putItem).toHaveBeenCalledTimes(5);

    const seedMessage = base.putItem.mock.calls[4][0];
    expect(seedMessage.type).toBe('MESSAGE');
    expect(seedMessage.content).toContain('Context Transition');
    expect(seedMessage.content).toContain('user: hello');
  });

  it('should handle transition with no history', async () => {
    const base = createMockBase();
    base.putItem.mockResolvedValue(undefined);
    base.getHistory.mockResolvedValue([]);
    (uuidv4 as ReturnType<typeof vi.fn>).mockReturnValue('collab-uuid');

    await transitToCollaboration(base, 'user-1', 'ws-1', 'sess-1', []);

    // 1 collab + 2 indexes (user + facilitator) = 3 putItems
    expect(base.putItem).toHaveBeenCalledTimes(3);
  });
});
