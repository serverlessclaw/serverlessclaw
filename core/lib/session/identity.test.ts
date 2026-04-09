import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdentityManager, UserRole, Permission } from './identity';
import type { AccessControlEntry } from './identity';

// Mock logger
vi.mock('../logger', () => import('../../__mocks__/logger'));

// Mock constants
vi.mock('../constants', () => ({
  MEMORY_KEYS: {
    WORKSPACE_PREFIX: 'WORKSPACE#',
  },
  TIME: {
    MS_PER_HOUR: 3600000,
  },
}));

describe('IdentityManager', () => {
  let manager: IdentityManager;
  let mockBase: {
    queryItems: ReturnType<typeof vi.fn>;
    putItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    scanByPrefix: ReturnType<typeof vi.fn>;
  };
  let state: Map<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    state = new Map();

    mockBase = {
      queryItems: vi.fn().mockImplementation(async ({ ExpressionAttributeValues }) => {
        const pk = ExpressionAttributeValues[':pk'];
        const item = state.get(pk);
        return item ? [item] : [];
      }),
      putItem: vi.fn().mockImplementation(async (item) => {
        state.set(item.userId, item);
      }),
      deleteItem: vi.fn().mockImplementation(async ({ userId }) => {
        state.delete(userId);
      }),
      scanByPrefix: vi.fn().mockImplementation(async (prefix) => {
        return Array.from(state.values()).filter((item) => item.userId.startsWith(prefix));
      }),
    };
    manager = new IdentityManager(mockBase as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('authenticate', () => {
    it('should create new user and session on first authentication', async () => {
      const result = await manager.authenticate('user-1', 'telegram');

      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.userId).toBe('user-1');
      expect(result.user?.role).toBe(UserRole.MEMBER);
      expect(result.user?.authProvider).toBe('telegram');
      expect(result.user?.workspaceIds).toEqual([]);
      expect(result.session).toBeDefined();
      expect(result.session?.userId).toBe('user-1');
      expect(mockBase.putItem).toHaveBeenCalled();
    });

    it('should load existing user from storage', async () => {
      const existingUser = {
        userId: 'user-1',
        displayName: 'Test User',
        role: UserRole.ADMIN,
        workspaceIds: ['ws-1'],
        authProvider: 'dashboard',
        createdAt: 1000,
        lastActiveAt: 2000,
      };
      mockBase.queryItems.mockResolvedValue([existingUser]);

      const result = await manager.authenticate('user-1', 'dashboard');

      expect(result.success).toBe(true);
      expect(result.user?.role).toBe(UserRole.ADMIN);
      expect(result.user?.displayName).toBe('Test User');
      expect(result.user?.workspaceIds).toEqual(['ws-1']);
    });

    it('should create session with metadata', async () => {
      const metadata = { client: 'web', version: '1.0' };
      const result = await manager.authenticate('user-1', 'api_key', metadata);

      expect(result.success).toBe(true);
      expect(result.session?.metadata).toEqual(metadata);
    });

    it('should handle query error gracefully and create new user', async () => {
      // Even if query fails, it should log warning and create new user
      mockBase.queryItems.mockRejectedValue(new Error('DB Error'));

      const result = await manager.authenticate('user-1', 'telegram');

      // The implementation catches query errors and creates new user
      expect(result.success).toBe(true);
      expect(result.user?.userId).toBe('user-1');
    });

    it('should update lastActiveAt on authentication', async () => {
      const now = 1234567890000;
      vi.setSystemTime(now);

      const result = await manager.authenticate('user-1', 'telegram');

      expect(result.user?.lastActiveAt).toBe(now);
    });

    it('should handle save user error gracefully', async () => {
      // Make putItem fail
      mockBase.putItem.mockRejectedValue(new Error('Save Error'));

      const result = await manager.authenticate('user-1', 'telegram');

      // saveUser catches error and logs it, but user is still created in memory
      expect(result.success).toBe(true);
      expect(result.user?.userId).toBe('user-1');
    });
  });

  describe('validateSession', () => {
    it('should return session if valid', async () => {
      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      const session = await manager.validateSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe(sessionId);
      expect(session?.userId).toBe('user-1');
    });

    it('should return null for non-existent session', async () => {
      const session = await manager.validateSession('non-existent');

      expect(session).toBeNull();
    });

    it('should return null and delete expired session', async () => {
      const now = 1000000000000;
      vi.setSystemTime(now);

      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      // Update state manually to simulate near-expiration
      const sessionInState = state.get(`WORKSPACE#SESSION#${sessionId}`);
      sessionInState.expiresAt = now + 1000;

      // Move time forward past expiration
      vi.setSystemTime(now + 2000);

      const session = await manager.validateSession(sessionId);

      expect(session).toBeNull();
      expect(mockBase.deleteItem).toHaveBeenCalled();
    });
  });

  describe('hasPermission', () => {
    it('should return false for non-existent user', async () => {
      expect(await manager.hasPermission('non-existent', Permission.AGENT_VIEW)).toBe(false);
    });

    it('should grant all permissions to OWNER', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
        authProvider: 'dashboard',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      await manager.authenticate('owner-1', 'telegram');
      await manager.updateUserRole('owner-1', UserRole.OWNER, 'superadmin');

      const allPermissions = Object.values(Permission);
      for (const perm of allPermissions) {
        expect(await manager.hasPermission('owner-1', perm)).toBe(true);
      }
    });

    it('should grant correct permissions to ADMIN', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
        authProvider: 'dashboard',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN, 'superadmin');

      expect(await manager.hasPermission('admin-1', Permission.AGENT_CREATE)).toBe(true);
      expect(await manager.hasPermission('admin-1', Permission.AGENT_DELETE)).toBe(true);
      expect(await manager.hasPermission('admin-1', Permission.CONFIG_UPDATE)).toBe(true);
      expect(await manager.hasPermission('admin-1', Permission.DASHBOARD_ADMIN)).toBe(true);
      // ADMIN should not have workspace create/delete
      expect(await manager.hasPermission('admin-1', Permission.WORKSPACE_CREATE)).toBe(false);
      expect(await manager.hasPermission('admin-1', Permission.WORKSPACE_DELETE)).toBe(false);
    });

    it('should grant limited permissions to MEMBER', async () => {
      await manager.authenticate('member-1', 'telegram');

      expect(await manager.hasPermission('member-1', Permission.AGENT_VIEW)).toBe(true);
      expect(await manager.hasPermission('member-1', Permission.TASK_CREATE)).toBe(true);
      expect(await manager.hasPermission('member-1', Permission.DASHBOARD_VIEW)).toBe(true);
      // MEMBER should not have create/delete/update permissions
      expect(await manager.hasPermission('member-1', Permission.AGENT_CREATE)).toBe(false);
      expect(await manager.hasPermission('member-1', Permission.AGENT_DELETE)).toBe(false);
      expect(await manager.hasPermission('member-1', Permission.CONFIG_UPDATE)).toBe(false);
    });

    it('should grant read-only permissions to VIEWER', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      await manager.authenticate('viewer-1', 'telegram');
      await manager.updateUserRole('viewer-1', UserRole.VIEWER, 'superadmin');

      expect(await manager.hasPermission('viewer-1', Permission.AGENT_VIEW)).toBe(true);
      expect(await manager.hasPermission('viewer-1', Permission.TASK_VIEW)).toBe(true);
      expect(await manager.hasPermission('viewer-1', Permission.CONFIG_VIEW)).toBe(true);
      expect(await manager.hasPermission('viewer-1', Permission.DASHBOARD_VIEW)).toBe(true);
      // VIEWER should not have any create/update/delete permissions
      expect(await manager.hasPermission('viewer-1', Permission.TASK_CREATE)).toBe(false);
      expect(await manager.hasPermission('viewer-1', Permission.AGENT_CREATE)).toBe(false);
      expect(await manager.hasPermission('viewer-1', Permission.EVOLUTION_APPROVE)).toBe(false);
    });
  });

  describe('hasResourceAccess', () => {
    it('should return false for non-existent user', async () => {
      expect(await manager.hasResourceAccess('non-existent', 'agent', 'agent-1')).toBe(false);
    });

    it('should grant OWNER access to all resources', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      await manager.authenticate('owner-1', 'telegram');
      await manager.updateUserRole('owner-1', UserRole.OWNER, 'superadmin');

      expect(await manager.hasResourceAccess('owner-1', 'agent', 'agent-1')).toBe(true);
      expect(await manager.hasResourceAccess('owner-1', 'workspace', 'ws-1')).toBe(true);
      expect(await manager.hasResourceAccess('owner-1', 'config', 'config-1')).toBe(true);
      expect(await manager.hasResourceAccess('owner-1', 'trace', 'trace-1')).toBe(true);
    });

    it('should grant ADMIN access to all resources', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN, 'superadmin');

      expect(await manager.hasResourceAccess('admin-1', 'agent', 'agent-1')).toBe(true);
      expect(await manager.hasResourceAccess('admin-1', 'workspace', 'ws-1')).toBe(true);
    });

    it('should check access control entries for specific user IDs', async () => {
      await manager.authenticate('user-1', 'telegram');

      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN],
        allowedUserIds: ['user-1'],
      };
      manager.addAccessControlEntry(entry);

      expect(await manager.hasResourceAccess('user-1', 'agent', 'agent-1')).toBe(true);
    });

    it('should check access control entries for roles', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN, 'superadmin');

      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN, UserRole.MEMBER],
      };
      manager.addAccessControlEntry(entry);

      expect(await manager.hasResourceAccess('admin-1', 'agent', 'agent-1')).toBe(true);
    });

    it('should deny access if not in allowed roles', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      await manager.authenticate('viewer-1', 'telegram');
      await manager.updateUserRole('viewer-1', UserRole.VIEWER, 'superadmin');

      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN],
      };
      manager.addAccessControlEntry(entry);

      expect(await manager.hasResourceAccess('viewer-1', 'agent', 'agent-1')).toBe(false);
    });

    it('should check workspace membership for workspace resources', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.addUserToWorkspace('user-1', 'ws-1');

      expect(await manager.hasResourceAccess('user-1', 'workspace', 'ws-1')).toBe(true);
      expect(await manager.hasResourceAccess('user-1', 'workspace', 'ws-2')).toBe(false);
    });

    it('should deny access to non-workspace resources without explicit ACL', async () => {
      await manager.authenticate('member-1', 'telegram');

      // MEMBER does NOT get access to unknown agent resources (deny by default)
      expect(await manager.hasResourceAccess('member-1', 'agent', 'agent-unknown')).toBe(false);
    });
  });

  describe('updateUserRole', () => {
    it('should update user role successfully with authorized caller', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      await manager.authenticate('user-1', 'telegram');
      expect((await manager.getUser('user-1'))?.role).toBe(UserRole.MEMBER);

      const result = await manager.updateUserRole('user-1', UserRole.ADMIN, 'superadmin');

      expect(result).toBe(true);
      expect((await manager.getUser('user-1'))?.role).toBe(UserRole.ADMIN);
      expect(mockBase.putItem).toHaveBeenCalled();
    });

    it('should return false for non-existent user', async () => {
      // Manually create an OWNER user in state
      state.set('WORKSPACE#USER#superadmin', {
        userId: 'WORKSPACE#USER#superadmin',
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
      });
      const result = await manager.updateUserRole('non-existent', UserRole.ADMIN, 'superadmin');

      expect(result).toBe(false);
    });

    it('should persist user to storage', async () => {
      // Create the caller in state - this mimics an existing OWNER in the system
      const superadminKey = 'WORKSPACE#USER#superadmin';
      state.set(superadminKey, {
        userId: superadminKey,
        role: UserRole.OWNER,
        workspaceIds: [],
        displayName: 'superadmin',
        authProvider: 'dashboard',
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      });

      // Authenticate as user-1 (becomes MEMBER) - this triggers putItem calls
      await manager.authenticate('user-1', 'telegram');

      // Clear the putItem mock to track only the updateUserRole call
      mockBase.putItem.mockClear();

      // Update user-1 to OWNER using superadmin as caller
      const result = await manager.updateUserRole('user-1', UserRole.OWNER, 'superadmin');

      expect(result).toBe(true);
      expect(mockBase.putItem).toHaveBeenCalled();
      // The updateUserRole should call saveUser which calls putItem
      // Find the call that has the updated role
      const updateCall = mockBase.putItem.mock.calls.find(
        (call: any[]) => call[0].role === UserRole.OWNER
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[0].role).toBe(UserRole.OWNER);
    });

    it('should deny role change when caller is not OWNER or ADMIN', async () => {
      await manager.authenticate('user-1', 'telegram'); // MEMBER
      await manager.authenticate('user-2', 'telegram');

      const result = await manager.updateUserRole('user-2', UserRole.ADMIN, 'user-1');

      expect(result).toBe(false);
      expect((await manager.getUser('user-2'))?.role).toBe(UserRole.MEMBER);
    });

    it('should deny role change when caller does not exist', async () => {
      await manager.authenticate('user-1', 'telegram');

      const result = await manager.updateUserRole('user-1', UserRole.ADMIN, 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('workspace membership management', () => {
    it('should add user to workspace', async () => {
      await manager.authenticate('user-1', 'telegram');

      const result = await manager.addUserToWorkspace('user-1', 'ws-1');

      expect(result).toBe(true);
      expect((await manager.getUser('user-1'))?.workspaceIds).toContain('ws-1');
      expect(mockBase.putItem).toHaveBeenCalled();
    });

    it('should not duplicate workspace membership', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.addUserToWorkspace('user-1', 'ws-1');
      mockBase.putItem.mockClear();

      await manager.addUserToWorkspace('user-1', 'ws-1');

      expect((await manager.getUser('user-1'))?.workspaceIds).toEqual(['ws-1']);
    });

    it('should return false when adding to workspace for non-existent user', async () => {
      const result = await manager.addUserToWorkspace('non-existent', 'ws-1');

      expect(result).toBe(false);
    });

    it('should remove user from workspace', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.addUserToWorkspace('user-1', 'ws-1');
      await manager.addUserToWorkspace('user-1', 'ws-2');
      mockBase.putItem.mockClear();

      const result = await manager.removeUserFromWorkspace('user-1', 'ws-1');

      expect(result).toBe(true);
      expect((await manager.getUser('user-1'))?.workspaceIds).not.toContain('ws-1');
      expect((await manager.getUser('user-1'))?.workspaceIds).toContain('ws-2');
      expect(mockBase.putItem).toHaveBeenCalled();
    });

    it('should handle removing non-member workspace gracefully', async () => {
      await manager.authenticate('user-1', 'telegram');

      const result = await manager.removeUserFromWorkspace('user-1', 'ws-1');

      expect(result).toBe(true);
    });

    it('should return false when removing from workspace for non-existent user', async () => {
      const result = await manager.removeUserFromWorkspace('non-existent', 'ws-1');

      expect(result).toBe(false);
    });
  });

  describe('session management', () => {
    it('should terminate session', async () => {
      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      mockBase.deleteItem = vi.fn().mockResolvedValueOnce(undefined);
      await manager.terminateSession(sessionId);

      expect(mockBase.deleteItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: `WORKSPACE#SESSION#${sessionId}`,
        })
      );
    });

    it('should get all sessions for a user', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.authenticate('user-1', 'telegram');
      await manager.authenticate('user-2', 'telegram');

      const sessions = await manager.getUserSessions('user-1');

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.userId === 'user-1')).toBe(true);
    });

    it('should cleanup expired sessions', async () => {
      const now = 1000000000000;
      vi.setSystemTime(now);

      const auth1 = await manager.authenticate('user-1', 'telegram');
      const auth2 = await manager.authenticate('user-2', 'telegram');
      await manager.authenticate('user-3', 'telegram');

      // Expire auth1 and auth2
      state.get(`WORKSPACE#SESSION#${auth1.session!.sessionId}`).expiresAt = now - 1000;
      state.get(`WORKSPACE#SESSION#${auth2.session!.sessionId}`).expiresAt = now - 500;

      const cleaned = await manager.cleanupExpiredSessions();

      expect(cleaned).toBe(2);
      expect(await manager.getUserSessions('user-3')).toHaveLength(1);
    });
  });

  describe('getUser and getSession', () => {
    it('should get user by ID', async () => {
      await manager.authenticate('user-1', 'telegram');

      const user = await manager.getUser('user-1');

      expect(user).toBeDefined();
      expect(user?.userId).toBe('user-1');
    });

    it('should return undefined for non-existent user', async () => {
      expect(await manager.getUser('non-existent')).toBeUndefined();
    });

    it('should get session by ID', async () => {
      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      const session = await manager.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe(sessionId);
    });

    it('should return undefined for non-existent session', async () => {
      expect(await manager.getSession('non-existent')).toBeUndefined();
    });
  });

  describe('addAccessControlEntry', () => {
    it('should add access control entry', async () => {
      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN],
      };

      await manager.addAccessControlEntry(entry);

      expect(mockBase.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ACCESS_CONTROL',
          resourceId: 'agent-1',
        })
      );
    });
  });
});
