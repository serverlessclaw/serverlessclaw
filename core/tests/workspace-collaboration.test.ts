import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collaborationTools } from '../tools/collaboration';
const { createCollaboration } = collaborationTools;
import { getAgentContext } from '../lib/utils/agent-helpers';

// Mock agent-helpers
vi.mock('../lib/utils/agent-helpers', () => ({
  getAgentContext: vi.fn(),
}));

// Mock workspace-operations
const mockGetWorkspace = vi.fn();
vi.mock('../lib/memory/workspace-operations', () => ({
  getWorkspace: (...args: any[]) => mockGetWorkspace(...args),
}));

// Mock logger
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock EventBridge emitter
vi.mock('../lib/events', () => ({
  emitTypedEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('Workspace-Collaboration Integration', () => {
  let mockMemory: any;
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemory = {
      createCollaboration: vi.fn().mockResolvedValue({
        collaborationId: 'c-123',
        name: 'Test Collab',
        sessionId: 's-123',
        syntheticUserId: 'shared#collab#c-123',
        participants: [],
      }),
    };
    mockContext = {
      agentId: 'test-agent',
      memory: mockMemory,
    };
    (getAgentContext as any).mockResolvedValue(mockContext);
  });

  it('should auto-add all workspace members to the collaboration', async () => {
    const mockWorkspace = {
      workspaceId: 'ws-123',
      name: 'Test Workspace',
      members: [
        {
          memberId: 'human-1',
          type: 'human',
          displayName: 'Alice',
          role: 'owner',
          active: true,
        },
        {
          memberId: 'agent-1',
          type: 'agent',
          displayName: 'Coder',
          role: 'collaborator',
          active: true,
        },
        {
          memberId: 'agent-2',
          type: 'agent',
          displayName: 'Observer',
          role: 'observer',
          active: true,
        },
        {
          memberId: 'human-2',
          type: 'human',
          displayName: 'Inactive Bob',
          role: 'collaborator',
          active: false,
        },
      ],
    };
    mockGetWorkspace.mockResolvedValue(mockWorkspace);

    const result = await createCollaboration.execute({
      name: 'Test Collab',
      workspaceId: 'ws-123',
      agentId: 'test-agent',
    });

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);

    // Verify createCollaboration was called with all active members
    // owner/collaborator -> editor, observer -> viewer
    expect(mockMemory.createCollaboration).toHaveBeenCalledWith(
      'test-agent',
      'agent',
      expect.objectContaining({
        workspaceId: 'ws-123',
        initialParticipants: expect.arrayContaining([
          { type: 'human', id: 'human-1', role: 'editor' },
          { type: 'agent', id: 'agent-1', role: 'editor' },
          { type: 'agent', id: 'agent-2', role: 'viewer' },
        ]),
      })
    );

    // Check that inactive member was NOT added
    const callArgs = mockMemory.createCollaboration.mock.calls[0][2];
    expect(callArgs.initialParticipants).not.toContainEqual(
      expect.objectContaining({ id: 'human-2' })
    );
  });

  it('should still create collaboration if workspace not found (graceful degradation)', async () => {
    mockGetWorkspace.mockResolvedValue(null);

    const result = await createCollaboration.execute({
      name: 'Test Collab',
      workspaceId: 'ws-not-found',
      agentId: 'test-agent',
    });

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);
    expect(mockMemory.createCollaboration).toHaveBeenCalled();
  });
});
