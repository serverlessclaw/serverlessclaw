import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logger } from '../../logger';
import {
  UserRole,
  Permission,
  UserIdentity,
  Session,
  AuthResult,
  AccessControlEntry,
} from './types';
import { IdentityBase } from './base';
import { UserOps } from './user-ops';
import { SessionOps } from './session-ops';
import { AccessOps } from './access-ops';

/**
 * Identity and Access Manager.
 *
 * Refactored into functional sub-modules (user-ops, session-ops, access-ops)
 * to maintain AI grounding and resolve "Extreme file length" critical issues.
 */
export class IdentityManager extends IdentityBase {
  private userOps: UserOps;
  private sessionOps: SessionOps;
  private accessOps: AccessOps;

  constructor(base: import('../../memory/base').BaseMemoryProvider) {
    super(base);
    this.userOps = new UserOps(base);
    this.sessionOps = new SessionOps(base);
    this.accessOps = new AccessOps(base);
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
      const orgId = metadata?.orgId as string | undefined;
      const workspaceId = metadata?.workspaceId as string | undefined;

      // Get or create user identity
      let user = await this.userOps.loadUser(userId, orgId);
      if (!user) {
        user = await this.userOps.createUser(
          userId,
          authProvider,
          metadata?.password as string,
          orgId
        );
      }

      // Validate workspace membership if workspaceId provided
      if (workspaceId && !user.workspaceIds.includes(workspaceId)) {
        return {
          success: false,
          error: `User ${userId} is not a member of workspace ${workspaceId}`,
        };
      }

      // Update last active time
      user.lastActiveAt = Date.now();
      const docClient = this.base.getDocClient();
      const tableName = this.base.getTableName();
      if (tableName) {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { userId: this.getUserKey(userId, orgId), timestamp: 0 },
            UpdateExpression: 'SET lastActiveAt = :lastActiveAt',
            ExpressionAttributeValues: { ':lastActiveAt': user.lastActiveAt },
          })
        );
      }

      // Create session with workspace context
      const session = await this.sessionOps.createSession(userId, workspaceId, metadata);

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
  async validateSession(sessionId: string, orgId?: string): Promise<Session | null> {
    const session = await this.sessionOps.getSession(sessionId, orgId);
    if (!session) return null;

    if (Date.now() > session.expiresAt) {
      await this.sessionOps.terminateSession(sessionId, orgId);
      logger.info(`Session expired: ${sessionId}`);
      return null;
    }

    session.lastActivityTime = Date.now();
    await this.sessionOps.saveSession(session, orgId);
    return session;
  }

  /**
   * Check if a user has a specific permission.
   */
  async hasPermission(
    userId: string,
    permission: Permission,
    workspaceId?: string,
    orgId?: string
  ): Promise<boolean> {
    const user = await this.userOps.loadUser(userId, orgId);
    if (!user) return false;

    if (!this.accessOps.hasPermissionSync(user.role, permission)) return false;

    if (this.accessOps.isWorkspaceScoped(permission)) {
      // OWNER and ADMIN are global roles and bypass workspace-membership checks
      if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) return true;

      if (!workspaceId) return false;
      return user.workspaceIds.includes(workspaceId);
    }

    return true;
  }

  /**
   * Check if a user has access to a specific resource.
   */
  async hasResourceAccess(
    userId: string,
    resourceType: 'agent' | 'workspace' | 'config' | 'trace',
    resourceId: string,
    orgId?: string
  ): Promise<boolean> {
    const user = await this.userOps.loadUser(userId, orgId);
    if (!user) return false;

    if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) {
      return true;
    }

    const entry = await this.accessOps.getAccessControlEntry(resourceType, resourceId, orgId);

    if (entry) {
      if (entry.allowedUserIds?.includes(userId)) return true;
      if (entry.allowedRoles.includes(user.role)) return true;

      if (entry.parentId) {
        const parentEntry = await this.accessOps.getAccessControlEntry(
          'workspace',
          entry.parentId,
          orgId
        );
        if (parentEntry) {
          if (parentEntry.allowedUserIds?.includes(userId)) return true;
          if (parentEntry.allowedRoles.includes(user.role)) return true;
        }
        if (user.workspaceIds.includes(entry.parentId)) return true;
      }
    }

    if (resourceType === 'workspace') {
      return user.workspaceIds.includes(resourceId);
    }

    return false;
  }

  // Delegated methods for API consistency
  async getUser(
    userId: string,
    callerId?: string,
    orgId?: string
  ): Promise<UserIdentity | undefined> {
    if (callerId && callerId !== userId) {
      const hasAccess = await this.hasResourceAccess(callerId, 'agent', userId, orgId);
      if (!hasAccess) return undefined;
    }
    return this.userOps.loadUser(userId, orgId);
  }

  async getAllUsers(orgId?: string): Promise<UserIdentity[]> {
    return this.userOps.getAllUsers(orgId);
  }

  async getSession(
    sessionId: string,
    callerId?: string,
    orgId?: string
  ): Promise<Session | undefined> {
    const session = await this.sessionOps.getSession(sessionId, orgId);
    if (session && callerId && callerId !== session.userId) {
      const hasAccess = await this.hasResourceAccess(callerId, 'trace', session.userId, orgId);
      if (!hasAccess) return undefined;
    }
    return session;
  }

  async terminateSession(sessionId: string, orgId?: string): Promise<void> {
    return this.sessionOps.terminateSession(sessionId, orgId);
  }

  async getUserSessions(userId: string): Promise<Session[]> {
    return this.sessionOps.getUserSessions(userId);
  }

  async updateUserRole(
    userId: string,
    role: UserRole,
    callerId: string,
    orgId?: string
  ): Promise<boolean> {
    const caller = await this.getUser(callerId, undefined, orgId);
    if (!caller || (caller.role !== UserRole.OWNER && caller.role !== UserRole.ADMIN)) return false;
    return this.userOps.updateUser(userId, { role }, orgId);
  }

  async addUserToWorkspace(userId: string, workspaceId: string, orgId?: string): Promise<boolean> {
    return this.userOps.addUserToWorkspace(userId, workspaceId, orgId);
  }

  async removeUserFromWorkspace(
    userId: string,
    workspaceId: string,
    orgId?: string
  ): Promise<boolean> {
    return this.userOps.removeUserFromWorkspace(userId, workspaceId, orgId);
  }

  async addAccessControlEntry(entry: AccessControlEntry, orgId?: string): Promise<void> {
    return this.accessOps.addAccessControlEntry(entry, orgId);
  }

  async cleanupExpiredSessions(): Promise<number> {
    return this.sessionOps.cleanupExpiredSessions();
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.userOps.loadUser(userId);
    if (!user || !user.hashedPassword) return false;
    return this.userOps.hashPassword(userId, password) === user.hashedPassword;
  }

  async updateUser(
    userId: string,
    updates: Record<string, unknown>,
    callerId: string,
    orgId?: string
  ): Promise<boolean> {
    const caller = await this.getUser(callerId, undefined, orgId);
    if (!caller || (caller.role !== UserRole.OWNER && caller.role !== UserRole.ADMIN)) return false;
    return this.userOps.updateUser(userId, updates, orgId);
  }
}

let identityManager: IdentityManager | undefined;

export async function getIdentityManager(): Promise<IdentityManager> {
  if (!identityManager) {
    const { BaseMemoryProvider } = await import('../../memory/base');
    identityManager = new IdentityManager(new BaseMemoryProvider());
  }
  return identityManager;
}
