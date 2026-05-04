import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addCollaborationParticipant } from './collaboration-operations';
import { AgentRegistry } from '../registry';
import { ParticipantType } from '../types/collaboration';

vi.mock('../registry', () => ({
  AgentRegistry: {
    getAgentConfig: vi.fn(),
  },
}));

describe('Collaboration Operations Integrity', () => {
  const mockBase = {
    getScopedUserId: vi.fn((id) => id),
    updateItem: vi.fn().mockResolvedValue({}),
    putItem: vi.fn().mockResolvedValue({}),
    queryItems: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw error when inviting a disabled agent (Principle 14)', async () => {
    // 1. Setup - collaboration exists
    const mockCollab = {
      collaborationId: 'c1',
      participants: [{ id: 'owner-1', type: 'user', role: 'owner' }],
      workspaceId: 'w1',
    };

    // We need to mock getCollaboration which is internal to the module,
    // or just let it call through if we can mock the base provider correctly.
    // Actually addCollaborationParticipant calls getCollaboration(base, ...).
    // So we need to mock base.getItem or similar if getCollaboration uses it.

    mockBase.queryItems.mockResolvedValue([mockCollab]);

    // 2. Setup - agent is disabled
    (AgentRegistry.getAgentConfig as any).mockResolvedValue({
      id: 'disabled-agent',
      enabled: false,
    });

    // 3. Act & Assert
    await expect(
      addCollaborationParticipant(mockBase, 'c1', 'owner-1', 'user' as ParticipantType, {
        type: 'agent' as ParticipantType,
        id: 'disabled-agent',
        role: 'editor',
      })
    ).rejects.toThrow(/is disabled and cannot be invited/);
  });
});
