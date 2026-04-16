/**
 * @module Identity
 * @description Identity and Access Layer for Serverless Claw.
 * Provides user authentication, role-based access control, and session management
 * for multi-human collaboration features.
 */

import { logger } from '../logger';
import { MEMORY_KEYS, TIME } from '../constants';
import { generateSessionId } from '../utils/id-generator';

/**
 * User roles for RBAC.
 * Note: For workspace-scoped roles, see the mapping functions in `../types/workspace`:
 * - userRoleToWorkspaceRole(): Maps UserRole to WorkspaceRole
 * - workspaceRoleToUserRole(): Maps WorkspaceRole back to UserRole
 * The Identity system uses OWNER > ADMIN > MEMBER > VIEWER (system-wide permissions),
 * while workspaces use owner > admin > collaborator > observer (resource-scoped).
 */
export enum UserRole {
  /** Full system access. */
  OWNER = 'owner',
  /** Can manage agents, settings, and members. */
  ADMIN = 'admin',
  /** Can interact with agents and view traces. */
  MEMBER = 'member',
  /** Read-only access to dashboard. */
  VIEWER = 'viewer',
}

/**
 * Permission types.
 */
export enum Permission {
  // Agent permissions
  AGENT_CREATE = 'agent:create',
  AGENT_DELETE = 'agent:delete',
  AGENT_UPDATE = 'agent:update',
  AGENT_VIEW = 'agent:view',

  // Task permissions
  TASK_CREATE = 'task:create',
  TASK_CANCEL = 'task:cancel',
  TASK_VIEW = 'task:view',

  // Evolution permissions
  EVOLUTION_VIEW = 'evolution:view',
  EVOLUTION_APPROVE = 'evolution:approve',
  EVOLUTION_TRIGGER = 'evolution:trigger',

  // Configuration permissions
  CONFIG_VIEW = 'config:view',
  CONFIG_UPDATE = 'config:update',

  // Workspace permissions
  WORKSPACE_CREATE = 'workspace:create',
  WORKSPACE_DELETE = 'workspace:delete',
  WORKSPACE_MEMBERS = 'workspace:members',

  // Trace permissions
  TRACE_VIEW = 'trace:view',
  TRACE_DELETE = 'trace:delete',

  // Dashboard permissions
  DASHBOARD_VIEW = 'dashboard:view',
  DASHBOARD_ADMIN = 'dashboard:admin',
}

/**
 * Role-to-permission mapping.
 */
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.OWNER]: Object.values(Permission),
  [UserRole.ADMIN]: [
    Permission.AGENT_CREATE,
    Permission.AGENT_DELETE,
    Permission.AGENT_UPDATE,
    Permission.AGENT_VIEW,
    Permission.TASK_CREATE,
    Permission.TASK_CANCEL,
    Permission.TASK_VIEW,
    Permission.EVOLUTION_VIEW,
    Permission.EVOLUTION_APPROVE,
    Permission.EVOLUTION_TRIGGER,
    Permission.CONFIG_VIEW,
    Permission.CONFIG_UPDATE,
    Permission.WORKSPACE_MEMBERS,
    Permission.TRACE_VIEW,
    Permission.TRACE_DELETE,
    Permission.DASHBOARD_VIEW,
    Permission.DASHBOARD_ADMIN,
  ],
  [UserRole.MEMBER]: [
    Permission.AGENT_VIEW,
    Permission.TASK_CREATE,
    Permission.TASK_CANCEL,
    Permission.TASK_VIEW,
    Permission.EVOLUTION_VIEW,
    Permission.CONFIG_VIEW,
    Permission.TRACE_VIEW,
    Permission.DASHBOARD_VIEW,
  ],
  [UserRole.VIEWER]: [
    Permission.AGENT_VIEW,
    Permission.TASK_VIEW,
    Permission.EVOLUTION_VIEW,
    Permission.CONFIG_VIEW,
    Permission.TRACE_VIEW,
    Permission.DASHBOARD_VIEW,
  ],
};

/**
 * User identity.
 */
export interface UserIdentity {
  /** Unique user ID. */
  userId: string;
  /** Display name. */
  displayName: string;
  /** Email address. */
  email?: string;
  /** User role. */
  role: UserRole;
  /** Workspace IDs the user belongs to. */
  workspaceIds: string[];
  /** Authentication provider. */
  authProvider: 'telegram' | 'dashboard' | 'api_key';
  /** When the user was created. */
  createdAt: number;
  /** Last active timestamp. */
  lastActiveAt: number;
}

/**
 * Session state.
 */
export interface Session {
  /** Unique session ID. */
  sessionId: string;
  /** User ID for this session. */
  userId: string;
  /** Workspace ID for this session. */
  workspaceId?: string;
  /** Session start time. */
  startTime: number;
  /** Last activity time. */
  lastActivityTime: number;
  /** Session expiration time. */
  expiresAt: number;
  /** Session metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Authentication result.
 */
export interface AuthResult {
  /** Whether authentication succeeded. */
  success: boolean;
  /** User identity if authenticated. */
  user?: UserIdentity;
  /** Session if authenticated. */
  session?: Session;
  /** Error message if failed. */
  error?: string;
}

/**
 * Access control entry for workspace resources.
 */
export interface AccessControlEntry {
  /** Resource type. */
  resourceType: 'agent' | 'workspace' | 'config' | 'trace';
  /** Resource ID. */
  resourceId: string;
  /** Parent resource ID for inheritance (e.g., workspace ID for nested resources). */
  parentId?: string;
  /** Allowed roles. */
  allowedRoles: UserRole[];
  /** Specific user IDs with access (overrides role). */
  allowedUserIds?: string[];
}

/**
 * Identity and Access Manager.
 */
export class IdentityManager {
  private base: import('../memory/base').BaseMemoryProvider;

  constructor(base: import('../memory/base').BaseMemoryProvider) {
    this.base = base;
  }

  /**
   * Authenticate a user and create a session.
   */
  async authenticate(
    userId: string,
    authProvider: 'telegram' | 'dashboard' | 'api_key',
    metadata?: Record<string, unknown>
  ): Promise<AuthResult> {
    try {
      // Get or create user identity
      let user = await this.getUser(userId);
      if (!user) {
        user = await this.createUser(userId, authProvider);
      }

      // Validate workspace membership if workspaceId provided
      const workspaceId = metadata?.workspaceId as string | undefined;
      if (workspaceId && !user.workspaceIds.includes(workspaceId)) {
        return {
          success: false,
          error: `User ${userId} is not a member of workspace ${workspaceId}`,
        };
      }

      // Update last active time
      user.lastActiveAt = Date.now();
      await this.saveUser(user);

      // Create session with workspace context
      const session = await this.createSession(userId, workspaceId, metadata);

      logger.info(`User authenticated: ${userId} via ${authProvider}`, {
        sessionId: session.sessionId,
        role: user.role,
      });

      return {
        success: true,
        user,
        session,
      };
    } catch (error) {
      logger.error(`Authentication failed for user ${userId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  /**
   * Validate a session.
   */
  async validateSession(sessionId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    // Check expiration
    if (Date.now() > session.expiresAt) {
      await this.terminateSession(sessionId);
      logger.info(`Session expired: ${sessionId}`);
      return null;
    }

    // Update last activity
    session.lastActivityTime = Date.now();
    await this.saveSession(session);
    return session;
  }

  private static readonly WORKSPACE_SCOPED_PERMISSIONS = new Set([
    Permission.WORKSPACE_CREATE,
    Permission.WORKSPACE_DELETE,
    Permission.WORKSPACE_MEMBERS,
  ]);

  /**
   * Check if a user has a specific permission.
   * Validates workspace membership for workspace-scoped permissions.
   */
  async hasPermission(
    userId: string,
    permission: Permission,
    workspaceId?: string
  ): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;

    const rolePermissions = ROLE_PERMISSIONS[user.role];
    if (!rolePermissions.includes(permission)) return false;

    if (workspaceId && IdentityManager.WORKSPACE_SCOPED_PERMISSIONS.has(permission)) {
      return user.workspaceIds.includes(workspaceId);
    }

    return true;
  }

  /**
   * Check if a user has access to a specific resource.
   * Validates workspace membership when workspaceId is provided.
   */
  async hasResourceAccess(
    userId: string,
    resourceType: 'agent' | 'workspace' | 'config' | 'trace',
    resourceId: string,
    _workspaceId?: string
  ): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;

    // Owners and admins have access to everything
    if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) {
      return true;
    }

    // Check specific access control entries
    const entry = await this.getAccessControlEntry(resourceType, resourceId);

    if (entry) {
      // Check if user ID is explicitly allowed
      if (entry.allowedUserIds?.includes(userId)) {
        return true;
      }
      // Check if user's role is allowed
      if (entry.allowedRoles.includes(user.role)) {
        return true;
      }

      // Check hierarchical inheritance - if parent resource is accessible, inherit permission
      if (entry.parentId) {
        const parentEntry = await this.getAccessControlEntry('workspace', entry.parentId);
        if (parentEntry) {
          if (parentEntry.allowedUserIds?.includes(userId)) {
            return true;
          }
          if (parentEntry.allowedRoles.includes(user.role)) {
            return true;
          }
        }
        // Also check workspace membership
        if (user.workspaceIds.includes(entry.parentId)) {
          return true;
        }
      }
    }

    // Default: check workspace membership for workspace resources
    if (resourceType === 'workspace') {
      return user.workspaceIds.includes(resourceId);
    }

    // For other resources, deny by default unless explicitly granted via ACL
    return false;
  }

  /**
   * Get user identity. Loads from storage.
   * Note: Fallback owner IDs no longer auto-grant OWNER role for security.
   * They default to MEMBER like all new users. Admin must explicitly promote.
   * @param userId - The user ID to retrieve
   * @param callerId - Optional caller ID for permission validation. If provided, validates caller has access.
   */
  async getUser(userId: string, callerId?: string): Promise<UserIdentity | undefined> {
    if (callerId && callerId !== userId) {
      const hasAccess = await this.hasResourceAccess(callerId, 'agent', userId);
      if (!hasAccess) {
        logger.warn(`Permission denied: ${callerId} attempted to access user ${userId}`);
        return undefined;
      }
    }
    return this.loadUser(userId);
  }

  /**
   * Get session from storage.
   * @param sessionId - The session ID to retrieve
   * @param callerId - Optional caller ID for permission validation. If provided, validates caller has access.
   */
  async getSession(sessionId: string, callerId?: string): Promise<Session | undefined> {
    try {
      const items = await this.base.queryItems({
        KeyConditionExpression: 'userId = :pk AND #ts = :zero',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': `${MEMORY_KEYS.WORKSPACE_PREFIX}SESSION#${sessionId}`,
          ':zero': 0,
        },
      });

      if (items.length > 0) {
        const item = items[0];
        const sessionUserId = item.sessionUserId as string;

        if (callerId && callerId !== sessionUserId) {
          const hasAccess = await this.hasResourceAccess(callerId, 'trace', sessionUserId);
          if (!hasAccess) {
            logger.warn(`Permission denied: ${callerId} attempted to access session ${sessionId}`);
            return undefined;
          }
        }

        return {
          sessionId,
          userId: sessionUserId,
          workspaceId: item.workspaceId as string | undefined,
          startTime: item.startTime as number,
          lastActivityTime: item.lastActivityTime as number,
          expiresAt: item.expiresAt as number,
          metadata: item.metadata as Record<string, unknown> | undefined,
        };
      }
    } catch (error) {
      logger.error(`Failed to load session ${sessionId}:`, error);
    }
    return undefined;
  }

  /**
   * Terminate a session.
   */
  async terminateSession(sessionId: string): Promise<void> {
    try {
      await this.base.deleteItem({
        userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}SESSION#${sessionId}`,
        timestamp: 0,
      });
      logger.info(`Session terminated: ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to terminate session ${sessionId}:`, error);
    }
  }

  /**
   * Get all active sessions for a user.
   * Note: This uses a scan with filter, which is inefficient but acceptable for infrequent use.
   * In a high-traffic system, a GSI on sessionUserId would be required.
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    try {
      // P3 Fix: Use TypeTimestampIndex GSI with FilterExpression instead of scanByPrefix
      // This is still a scan-like operation over the index, but limited to 'SESSION' type items.
      const result = await this.base.queryItemsPaginated({
        IndexName: 'TypeTimestampIndex',
        KeyConditionExpression: '#tp = :type',
        FilterExpression: 'sessionUserId = :uid',
        ExpressionAttributeNames: {
          '#tp': 'type',
        },
        ExpressionAttributeValues: {
          ':type': 'SESSION',
          ':uid': userId,
        },
        Limit: 100,
        ScanIndexForward: false,
      });

      return result.items.map((item) => ({
        sessionId: (item.userId as string).split('#').pop()!,
        userId: item.sessionUserId as string,
        workspaceId: item.workspaceId as string | undefined,
        startTime: item.startTime as number,
        lastActivityTime: item.lastActivityTime as number,
        expiresAt: item.expiresAt as number,
        metadata: item.metadata as Record<string, unknown> | undefined,
      }));
    } catch (error) {
      logger.error(`Failed to get sessions for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Update user role. Requires OWNER/ADMIN caller.
   */
  async updateUserRole(userId: string, role: UserRole, callerId: string): Promise<boolean> {
    const caller = await this.getUser(callerId);
    if (!caller || (caller.role !== UserRole.OWNER && caller.role !== UserRole.ADMIN)) {
      logger.error(`Unauthorized role update attempt by ${callerId} for ${userId}`);
      return false;
    }

    const user = await this.getUser(userId);
    if (!user) {
      logger.error(`User not found: ${userId}`);
      return false;
    }

    user.role = role;
    await this.saveUser(user);
    logger.info(`User role updated: ${userId} -> ${role}${callerId ? ` by ${callerId}` : ''}`);
    return true;
  }

  /**
   * Add user to workspace.
   */
  async addUserToWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) {
      logger.error(`User not found: ${userId}`);
      return false;
    }

    if (!user.workspaceIds.includes(workspaceId)) {
      user.workspaceIds.push(workspaceId);
      await this.saveUser(user);
      logger.info(`User ${userId} added to workspace ${workspaceId}`);
    }
    return true;
  }

  /**
   * Remove user from workspace.
   */
  async removeUserFromWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;

    const index = user.workspaceIds.indexOf(workspaceId);
    if (index > -1) {
      user.workspaceIds.splice(index, 1);
      await this.saveUser(user);
      logger.info(`User ${userId} removed from workspace ${workspaceId}`);
    }
    return true;
  }

  /**
   * Add access control entry.
   */
  async addAccessControlEntry(entry: AccessControlEntry): Promise<void> {
    try {
      await this.base.putItem({
        userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}ACL#${entry.resourceType}#${entry.resourceId}`,
        timestamp: 0,
        type: 'ACCESS_CONTROL',
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        parentId: entry.parentId,
        allowedRoles: entry.allowedRoles,
        allowedUserIds: entry.allowedUserIds,
        updatedAt: Date.now(),
      });
      logger.info(`Access control entry saved: ${entry.resourceType}:${entry.resourceId}`);
    } catch (error) {
      logger.error(`Failed to save ACL entry:`, error);
    }
  }

  /**
   * Load user identity from storage.
   */
  private async loadUser(userId: string): Promise<UserIdentity | undefined> {
    try {
      const items = await this.base.queryItems({
        KeyConditionExpression: 'userId = :pk AND #ts = :zero',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': `${MEMORY_KEYS.WORKSPACE_PREFIX}USER#${userId}`,
          ':zero': 0,
        },
      });

      if (items.length > 0) {
        const item = items[0];
        return {
          userId,
          displayName: (item.displayName as string) ?? userId,
          email: item.email as string | undefined,
          role: item.role as UserRole,
          workspaceIds: (item.workspaceIds as string[]) ?? [],
          authProvider: item.authProvider as 'telegram' | 'dashboard' | 'api_key',
          createdAt: item.createdAt as number,
          lastActiveAt: item.lastActiveAt as number,
        };
      }
    } catch (error) {
      logger.error(`Failed to load user ${userId}:`, error);
    }
    return undefined;
  }

  /**
   * Create new user identity.
   * New users default to MEMBER role. OWNER role must be explicitly assigned by an existing admin.
   */
  private async createUser(
    userId: string,
    authProvider: 'telegram' | 'dashboard' | 'api_key'
  ): Promise<UserIdentity> {
    const newUser: UserIdentity = {
      userId,
      displayName: userId,
      role: UserRole.MEMBER,
      workspaceIds: [],
      authProvider,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    await this.saveUser(newUser);
    return newUser;
  }

  /**
   * Save user to storage.
   */
  private async saveUser(user: UserIdentity): Promise<void> {
    try {
      await this.base.putItem({
        userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}USER#${user.userId}`,
        timestamp: 0,
        type: 'USER_IDENTITY',
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        workspaceIds: user.workspaceIds,
        authProvider: user.authProvider,
        createdAt: user.createdAt,
        lastActiveAt: user.lastActiveAt,
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.error(`Failed to save user ${user.userId}:`, error);
    }
  }

  /**
   * Create a new session.
   */
  private async createSession(
    userId: string,
    workspaceId: string | undefined,
    metadata?: Record<string, unknown>
  ): Promise<Session> {
    const sessionId = generateSessionId();
    const now = Date.now();
    const session: Session = {
      sessionId,
      userId,
      workspaceId,
      startTime: now,
      lastActivityTime: now,
      expiresAt: now + 24 * TIME.MS_PER_HOUR, // 24 hour session
      metadata,
    };

    await this.saveSession(session);
    return session;
  }

  /**
   * Save session to storage.
   */
  private async saveSession(session: Session): Promise<void> {
    try {
      await this.base.putItem({
        userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}SESSION#${session.sessionId}`,
        timestamp: 0,
        type: 'SESSION',
        sessionUserId: session.userId, // Avoid collision with PK userId
        workspaceId: session.workspaceId,
        startTime: session.startTime,
        lastActivityTime: session.lastActivityTime,
        expiresAt: session.expiresAt,
        metadata: session.metadata,
        ttl: Math.floor(session.expiresAt / 1000), // DDB TTL
      });
    } catch (error) {
      logger.error(`Failed to save session ${session.sessionId}:`, error);
    }
  }

  /**
   * Get ACL entry from storage.
   */
  private async getAccessControlEntry(
    resourceType: string,
    resourceId: string
  ): Promise<AccessControlEntry | undefined> {
    try {
      const items = await this.base.queryItems({
        KeyConditionExpression: 'userId = :pk AND #ts = :zero',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': `${MEMORY_KEYS.WORKSPACE_PREFIX}ACL#${resourceType}#${resourceId}`,
          ':zero': 0,
        },
      });

      if (items.length > 0) {
        const item = items[0];
        return {
          resourceType: item.resourceType as 'agent' | 'workspace' | 'config' | 'trace',
          resourceId: item.resourceId as string,
          parentId: item.parentId as string | undefined,
          allowedRoles: item.allowedRoles as UserRole[],
          allowedUserIds: item.allowedUserIds as string[] | undefined,
        };
      }
    } catch (error) {
      logger.error(`Failed to load ACL entry for ${resourceType}:${resourceId}:`, error);
    }
    return undefined;
  }

  /**
   * Cleanup expired sessions.
   * Note: DynamoDB TTL handles this automatically, but this provides explicit cleanup.
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now();
    try {
      // P3 Fix: Use TypeTimestampIndex GSI instead of scanByPrefix
      const { getMemoryByType } = await import('../memory/utils');
      const items = await getMemoryByType(this.base, 'SESSION', 1000);
      let cleaned = 0;

      for (const item of items) {
        if (now > (item.expiresAt as number)) {
          const sessionId = (item.userId as string).split('#').pop()!;
          await this.terminateSession(sessionId);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} expired sessions`);
      }
      return cleaned;
    } catch (error) {
      logger.error('Failed to cleanup expired sessions:', error);
      return 0;
    }
  }
}
