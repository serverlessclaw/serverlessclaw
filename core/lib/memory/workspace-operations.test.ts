import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWorkspace,
  getWorkspace,
  inviteMember,
  updateMemberRole,
  removeMember,
  getHumanMembersWithChannels,
  getAgentMembers,
} from './workspace-operations';
import { hasPermission } from '../types/workspace';

const mockGetRawConfig = vi.fn();
const mockSaveRawConfig = vi.fn();

vi.mock('../registry/config', () => ({
  ConfigManager: {
    getRawConfig: (...args: unknown[]) => mockGetRawConfig(...args),
    saveRawConfig: (...args: unknown[]) => mockSaveRawConfig(...args),
  },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Workspace Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveRawConfig.mockResolvedValue(undefined);
  });

  describe('createWorkspace', () => {
    it('should create a workspace with owner as first member', async () => {
      mockGetRawConfig.mockResolvedValue([]); // empty index

      const workspace = await createWorkspace({
        name: 'Test Workspace',
        description: 'A test',
        ownerId: 'user-123',
        ownerDisplayName: 'Alice',
      });

      expect(workspace.workspaceId).toMatch(/^ws-/);
      expect(workspace.name).toBe('Test Workspace');
      expect(workspace.ownerId).toBe('user-123');
      expect(workspace.members).toHaveLength(1);
      expect(workspace.members[0].role).toBe('owner');
      expect(workspace.status).toBe('active');

      // Should save workspace and update index
      expect(mockSaveRawConfig).toHaveBeenCalledTimes(2);
    });

    it('should set TTL when provided', async () => {
      mockGetRawConfig.mockResolvedValue([]);

      const workspace = await createWorkspace({
        name: 'Temp Workspace',
        ownerId: 'user-123',
        ownerDisplayName: 'Alice',
        ttlDays: 30,
      });

      expect(workspace.expiresAt).toBeDefined();
      expect(workspace.expiresAt).toBeGreaterThan(Date.now() / 1000);
    });
  });

  describe('getWorkspace', () => {
    it('should return workspace when found', async () => {
      const mockWs = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [],
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(mockWs);

      const result = await getWorkspace('ws-test');
      expect(result).toEqual(mockWs);
    });

    it('should return null when not found', async () => {
      mockGetRawConfig.mockResolvedValue(undefined);

      const result = await getWorkspace('ws-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('inviteMember', () => {
    it('should invite a new agent member', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      const result = await inviteMember('ws-test', 'user-123', {
        workspaceId: 'ws-test',
        memberId: 'coder',
        type: 'agent',
        displayName: 'Coder Agent',
        role: 'collaborator',
      });

      expect(result.members).toHaveLength(2);
      expect(result.members[1].memberId).toBe('coder');
      expect(result.members[1].role).toBe('collaborator');
    });

    it('should reject duplicate members', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'coder',
            type: 'agent',
            displayName: 'Coder',
            role: 'collaborator',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      await expect(
        inviteMember('ws-test', 'user-123', {
          workspaceId: 'ws-test',
          memberId: 'coder',
          type: 'agent',
          displayName: 'Coder',
          role: 'collaborator',
        })
      ).rejects.toThrow('Member already exists');
    });

    it('should reject invite from non-admin', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'user-456',
            type: 'human',
            displayName: 'Bob',
            role: 'observer',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      await expect(
        inviteMember('ws-test', 'user-456', {
          workspaceId: 'ws-test',
          memberId: 'new-user',
          type: 'human',
          displayName: 'Charlie',
          role: 'collaborator',
        })
      ).rejects.toThrow('Insufficient permissions');
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'user-456',
            type: 'human',
            displayName: 'Bob',
            role: 'collaborator',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      const result = await updateMemberRole('ws-test', 'user-123', 'user-456', 'admin');

      expect(result.members[1].role).toBe('admin');
    });

    it('should not allow changing owner role', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      await expect(
        updateMemberRole('ws-test', 'user-123', 'user-123', 'collaborator')
      ).rejects.toThrow('Cannot change the workspace owner role');
    });
  });

  describe('removeMember', () => {
    it('should remove a member', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'user-456',
            type: 'human',
            displayName: 'Bob',
            role: 'collaborator',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      const result = await removeMember('ws-test', 'user-123', 'user-456');
      expect(result.members).toHaveLength(1);
      expect(result.members[0].memberId).toBe('user-123');
    });

    it('should not allow removing owner', async () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human',
            displayName: 'Alice',
            role: 'owner',
            joinedAt: Date.now(),
            active: true,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      };
      mockGetRawConfig.mockResolvedValue(ws);

      await expect(removeMember('ws-test', 'user-123', 'user-123')).rejects.toThrow(
        'Cannot remove the workspace owner'
      );
    });
  });

  describe('getHumanMembersWithChannels', () => {
    it('should return only active human members', () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human' as const,
            displayName: 'Alice',
            role: 'owner' as const,
            channels: [{ platform: 'telegram', identifier: '12345', enabled: true }],
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'coder',
            type: 'agent' as const,
            displayName: 'Coder',
            role: 'collaborator' as const,
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'user-456',
            type: 'human' as const,
            displayName: 'Bob',
            role: 'observer' as const,
            channels: [],
            joinedAt: Date.now(),
            active: false,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active' as const,
      };

      const humans = getHumanMembersWithChannels(ws);
      expect(humans).toHaveLength(1);
      expect(humans[0].memberId).toBe('user-123');
    });
  });

  describe('getAgentMembers', () => {
    it('should return only active agent members', () => {
      const ws = {
        workspaceId: 'ws-test',
        name: 'Test',
        ownerId: 'user-123',
        members: [
          {
            memberId: 'user-123',
            type: 'human' as const,
            displayName: 'Alice',
            role: 'owner' as const,
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'coder',
            type: 'agent' as const,
            displayName: 'Coder',
            role: 'collaborator' as const,
            joinedAt: Date.now(),
            active: true,
          },
          {
            memberId: 'planner',
            type: 'agent' as const,
            displayName: 'Planner',
            role: 'observer' as const,
            joinedAt: Date.now(),
            active: false,
          },
        ],
        activeCollaborations: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active' as const,
      };

      const agents = getAgentMembers(ws);
      expect(agents).toHaveLength(1);
      expect(agents[0].memberId).toBe('coder');
    });
  });

  describe('hasPermission', () => {
    it('should enforce role hierarchy', () => {
      expect(hasPermission('owner', 'admin')).toBe(true);
      expect(hasPermission('admin', 'collaborator')).toBe(true);
      expect(hasPermission('collaborator', 'observer')).toBe(true);
      expect(hasPermission('observer', 'admin')).toBe(false);
      expect(hasPermission('collaborator', 'owner')).toBe(false);
    });
  });
});
