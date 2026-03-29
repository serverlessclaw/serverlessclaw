import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdentityManager, UserRole, Permission } from './identity';
import type { AccessControlEntry } from './identity';

// Mock logger
vi.mock('./logger', () => import('../__mocks__/logger'));

// Mock constants
vi.mock('./constants', () => ({
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBase = {
      queryItems: vi.fn().mockResolvedValue([]),
      putItem: vi.fn().mockResolvedValue(undefined),
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

      const session = manager.validateSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe(sessionId);
      expect(session?.userId).toBe('user-1');
    });

    it('should return null for non-existent session', () => {
      const session = manager.validateSession('non-existent');

      expect(session).toBeNull();
    });

    it('should return null and delete expired session', async () => {
      const now = 1000000000000;
      vi.setSystemTime(now);

      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      // Move time forward past expiration (24 hours + 1ms)
      vi.setSystemTime(now + 24 * 3600000 + 1);

      const session = manager.validateSession(sessionId);

      expect(session).toBeNull();
      expect(manager.getSession(sessionId)).toBeUndefined();
    });

    it('should update lastActivityTime on validation', async () => {
      const now = 1000000000000;
      vi.setSystemTime(now);

      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      vi.setSystemTime(now + 10000);

      const session = manager.validateSession(sessionId);

      expect(session?.lastActivityTime).toBe(now + 10000);
    });
  });

  describe('hasPermission', () => {
    it('should return false for non-existent user', () => {
      expect(manager.hasPermission('non-existent', Permission.AGENT_VIEW)).toBe(false);
    });

    it('should grant all permissions to OWNER', async () => {
      await manager.authenticate('owner-1', 'telegram');
      await manager.updateUserRole('owner-1', UserRole.OWNER);

      const allPermissions = Object.values(Permission);
      for (const perm of allPermissions) {
        expect(manager.hasPermission('owner-1', perm)).toBe(true);
      }
    });

    it('should grant correct permissions to ADMIN', async () => {
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN);

      expect(manager.hasPermission('admin-1', Permission.AGENT_CREATE)).toBe(true);
      expect(manager.hasPermission('admin-1', Permission.AGENT_DELETE)).toBe(true);
      expect(manager.hasPermission('admin-1', Permission.CONFIG_UPDATE)).toBe(true);
      expect(manager.hasPermission('admin-1', Permission.DASHBOARD_ADMIN)).toBe(true);
      // ADMIN should not have workspace create/delete
      expect(manager.hasPermission('admin-1', Permission.WORKSPACE_CREATE)).toBe(false);
      expect(manager.hasPermission('admin-1', Permission.WORKSPACE_DELETE)).toBe(false);
    });

    it('should grant limited permissions to MEMBER', async () => {
      await manager.authenticate('member-1', 'telegram');

      expect(manager.hasPermission('member-1', Permission.AGENT_VIEW)).toBe(true);
      expect(manager.hasPermission('member-1', Permission.TASK_CREATE)).toBe(true);
      expect(manager.hasPermission('member-1', Permission.DASHBOARD_VIEW)).toBe(true);
      // MEMBER should not have create/delete/update permissions
      expect(manager.hasPermission('member-1', Permission.AGENT_CREATE)).toBe(false);
      expect(manager.hasPermission('member-1', Permission.AGENT_DELETE)).toBe(false);
      expect(manager.hasPermission('member-1', Permission.CONFIG_UPDATE)).toBe(false);
    });

    it('should grant read-only permissions to VIEWER', async () => {
      await manager.authenticate('viewer-1', 'telegram');
      await manager.updateUserRole('viewer-1', UserRole.VIEWER);

      expect(manager.hasPermission('viewer-1', Permission.AGENT_VIEW)).toBe(true);
      expect(manager.hasPermission('viewer-1', Permission.TASK_VIEW)).toBe(true);
      expect(manager.hasPermission('viewer-1', Permission.CONFIG_VIEW)).toBe(true);
      expect(manager.hasPermission('viewer-1', Permission.DASHBOARD_VIEW)).toBe(true);
      // VIEWER should not have any create/update/delete permissions
      expect(manager.hasPermission('viewer-1', Permission.TASK_CREATE)).toBe(false);
      expect(manager.hasPermission('viewer-1', Permission.AGENT_CREATE)).toBe(false);
      expect(manager.hasPermission('viewer-1', Permission.EVOLUTION_APPROVE)).toBe(false);
    });
  });

  describe('hasResourceAccess', () => {
    it('should return false for non-existent user', () => {
      expect(manager.hasResourceAccess('non-existent', 'agent', 'agent-1')).toBe(false);
    });

    it('should grant OWNER access to all resources', async () => {
      await manager.authenticate('owner-1', 'telegram');
      await manager.updateUserRole('owner-1', UserRole.OWNER);

      expect(manager.hasResourceAccess('owner-1', 'agent', 'agent-1')).toBe(true);
      expect(manager.hasResourceAccess('owner-1', 'workspace', 'ws-1')).toBe(true);
      expect(manager.hasResourceAccess('owner-1', 'config', 'config-1')).toBe(true);
      expect(manager.hasResourceAccess('owner-1', 'trace', 'trace-1')).toBe(true);
    });

    it('should grant ADMIN access to all resources', async () => {
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN);

      expect(manager.hasResourceAccess('admin-1', 'agent', 'agent-1')).toBe(true);
      expect(manager.hasResourceAccess('admin-1', 'workspace', 'ws-1')).toBe(true);
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

      expect(manager.hasResourceAccess('user-1', 'agent', 'agent-1')).toBe(true);
    });

    it('should check access control entries for roles', async () => {
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN);

      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN, UserRole.MEMBER],
      };
      manager.addAccessControlEntry(entry);

      expect(manager.hasResourceAccess('admin-1', 'agent', 'agent-1')).toBe(true);
    });

    it('should deny access if not in allowed roles', async () => {
      await manager.authenticate('viewer-1', 'telegram');
      await manager.updateUserRole('viewer-1', UserRole.VIEWER);

      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN],
      };
      manager.addAccessControlEntry(entry);

      expect(manager.hasResourceAccess('viewer-1', 'agent', 'agent-1')).toBe(false);
    });

    it('should check workspace membership for workspace resources', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.addUserToWorkspace('user-1', 'ws-1');

      expect(manager.hasResourceAccess('user-1', 'workspace', 'ws-1')).toBe(true);
      expect(manager.hasResourceAccess('user-1', 'workspace', 'ws-2')).toBe(false);
    });

    it('should deny access to non-workspace resources without explicit ACL', async () => {
      await manager.authenticate('member-1', 'telegram');

      // MEMBER does NOT get access to unknown agent resources (deny by default)
      expect(manager.hasResourceAccess('member-1', 'agent', 'agent-unknown')).toBe(false);
    });
  });

  describe('updateUserRole', () => {
    it('should update user role successfully', async () => {
      await manager.authenticate('user-1', 'telegram');
      expect(manager.getUser('user-1')?.role).toBe(UserRole.MEMBER);

      const result = await manager.updateUserRole('user-1', UserRole.ADMIN);

      expect(result).toBe(true);
      expect(manager.getUser('user-1')?.role).toBe(UserRole.ADMIN);
      expect(mockBase.putItem).toHaveBeenCalled();
    });

    it('should return false for non-existent user', async () => {
      const result = await manager.updateUserRole('non-existent', UserRole.ADMIN);

      expect(result).toBe(false);
    });

    it('should persist user to storage', async () => {
      await manager.authenticate('user-1', 'telegram');
      mockBase.putItem.mockClear();

      await manager.updateUserRole('user-1', UserRole.OWNER);

      expect(mockBase.putItem).toHaveBeenCalled();
      const savedItem = mockBase.putItem.mock.calls[0][0];
      expect(savedItem.role).toBe(UserRole.OWNER);
    });
  });

  describe('workspace membership management', () => {
    it('should add user to workspace', async () => {
      await manager.authenticate('user-1', 'telegram');

      const result = await manager.addUserToWorkspace('user-1', 'ws-1');

      expect(result).toBe(true);
      expect(manager.getUser('user-1')?.workspaceIds).toContain('ws-1');
      expect(mockBase.putItem).toHaveBeenCalled();
    });

    it('should not duplicate workspace membership', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.addUserToWorkspace('user-1', 'ws-1');
      mockBase.putItem.mockClear();

      await manager.addUserToWorkspace('user-1', 'ws-1');

      expect(manager.getUser('user-1')?.workspaceIds).toEqual(['ws-1']);
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
      expect(manager.getUser('user-1')?.workspaceIds).not.toContain('ws-1');
      expect(manager.getUser('user-1')?.workspaceIds).toContain('ws-2');
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

      manager.terminateSession(sessionId);

      expect(manager.getSession(sessionId)).toBeUndefined();
    });

    it('should get all sessions for a user', async () => {
      await manager.authenticate('user-1', 'telegram');
      await manager.authenticate('user-1', 'telegram');
      await manager.authenticate('user-2', 'telegram');

      const sessions = manager.getUserSessions('user-1');

      expect(sessions).toHaveLength(2);
      expect(sessions.every((s) => s.userId === 'user-1')).toBe(true);
    });

    it('should cleanup expired sessions', async () => {
      const now = 1000000000000;
      vi.setSystemTime(now);

      await manager.authenticate('user-1', 'telegram');
      await manager.authenticate('user-2', 'telegram');

      // Move time forward past expiration
      vi.setSystemTime(now + 24 * 3600000 + 1);

      await manager.authenticate('user-3', 'telegram');

      const cleaned = manager.cleanupExpiredSessions();

      expect(cleaned).toBe(2);
      expect(manager.getUserSessions('user-3')).toHaveLength(1);
    });
  });

  describe('getUser and getSession', () => {
    it('should get user by ID', async () => {
      await manager.authenticate('user-1', 'telegram');

      const user = manager.getUser('user-1');

      expect(user).toBeDefined();
      expect(user?.userId).toBe('user-1');
    });

    it('should return undefined for non-existent user', () => {
      expect(manager.getUser('non-existent')).toBeUndefined();
    });

    it('should get session by ID', async () => {
      const authResult = await manager.authenticate('user-1', 'telegram');
      const sessionId = authResult.session!.sessionId;

      const session = manager.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe(sessionId);
    });

    it('should return undefined for non-existent session', () => {
      expect(manager.getSession('non-existent')).toBeUndefined();
    });
  });

  describe('addAccessControlEntry', () => {
    it('should add access control entry', async () => {
      const entry: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN],
      };

      manager.addAccessControlEntry(entry);

      // Verify by checking access
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN);
      expect(manager.hasResourceAccess('admin-1', 'agent', 'agent-1')).toBe(true);
    });

    it('should replace existing entry for same resource', async () => {
      const entry1: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.ADMIN],
      };
      const entry2: AccessControlEntry = {
        resourceType: 'agent',
        resourceId: 'agent-1',
        allowedRoles: [UserRole.MEMBER],
      };

      manager.addAccessControlEntry(entry1);
      manager.addAccessControlEntry(entry2);

      // Verify MEMBER now has access, ADMIN does not
      await manager.authenticate('member-1', 'telegram');
      await manager.authenticate('admin-1', 'telegram');
      await manager.updateUserRole('admin-1', UserRole.ADMIN);

      expect(manager.hasResourceAccess('member-1', 'agent', 'agent-1')).toBe(true);
      expect(manager.hasResourceAccess('admin-1', 'agent', 'agent-1')).toBe(true); // ADMIN still has access due to role
    });
  });
});
