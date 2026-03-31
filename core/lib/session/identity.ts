/**
 * @module Identity
 * @description Identity and Access Layer for Serverless Claw.
 * Provides user authentication, role-based access control, and session management
 * for multi-human collaboration features.
 */

import { logger } from '../logger';
import { MEMORY_KEYS, TIME } from '../constants';

/**
 * User roles for RBAC.
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
  private sessions: Map<string, Session> = new Map();
  private users: Map<string, UserIdentity> = new Map();
  private accessControl: AccessControlEntry[] = [];

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
      let user = this.users.get(userId);
      if (!user) {
        user = await this.loadOrCreateUser(userId, authProvider);
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
      this.users.set(userId, user);

      // Create session
      const session = this.createSession(userId, metadata);

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
  validateSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check expiration
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      logger.info(`Session expired: ${sessionId}`);
      return null;
    }

    // Update last activity
    session.lastActivityTime = Date.now();
    return session;
  }

  /**
   * Check if a user has a specific permission.
   */
  hasPermission(userId: string, permission: Permission): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    const rolePermissions = ROLE_PERMISSIONS[user.role];
    return rolePermissions.includes(permission);
  }

  /**
   * Check if a user has access to a specific resource.
   */
  hasResourceAccess(
    userId: string,
    resourceType: 'agent' | 'workspace' | 'config' | 'trace',
    resourceId: string
  ): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    // Owners and admins have access to everything
    if (user.role === UserRole.OWNER || user.role === UserRole.ADMIN) {
      return true;
    }

    // Check specific access control entries
    const entry = this.accessControl.find(
      (e) => e.resourceType === resourceType && e.resourceId === resourceId
    );

    if (entry) {
      // Check if user ID is explicitly allowed
      if (entry.allowedUserIds?.includes(userId)) {
        return true;
      }
      // Check if user's role is allowed
      return entry.allowedRoles.includes(user.role);
    }

    // Default: check workspace membership for workspace resources
    if (resourceType === 'workspace') {
      return user.workspaceIds.includes(resourceId);
    }

    // For other resources, deny by default unless explicitly granted via ACL
    return false;
  }

  /**
   * Get user identity.
   */
  getUser(userId: string): UserIdentity | undefined {
    return this.users.get(userId);
  }

  /**
   * Get session.
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Terminate a session.
   */
  terminateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.info(`Session terminated: ${sessionId}`);
  }

  /**
   * Get all active sessions for a user.
   */
  getUserSessions(userId: string): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.userId === userId);
  }

  /**
   * Update user role.
   */
  async updateUserRole(userId: string, role: UserRole): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      logger.error(`User not found: ${userId}`);
      return false;
    }

    user.role = role;
    this.users.set(userId, user);

    // Persist to storage
    await this.saveUser(user);
    logger.info(`User role updated: ${userId} -> ${role}`);
    return true;
  }

  /**
   * Add user to workspace.
   */
  async addUserToWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) {
      logger.error(`User not found: ${userId}`);
      return false;
    }

    if (!user.workspaceIds.includes(workspaceId)) {
      user.workspaceIds.push(workspaceId);
      this.users.set(userId, user);
      await this.saveUser(user);
      logger.info(`User ${userId} added to workspace ${workspaceId}`);
    }
    return true;
  }

  /**
   * Remove user from workspace.
   */
  async removeUserFromWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;

    const index = user.workspaceIds.indexOf(workspaceId);
    if (index > -1) {
      user.workspaceIds.splice(index, 1);
      this.users.set(userId, user);
      await this.saveUser(user);
      logger.info(`User ${userId} removed from workspace ${workspaceId}`);
    }
    return true;
  }

  /**
   * Add access control entry.
   */
  addAccessControlEntry(entry: AccessControlEntry): void {
    // Remove existing entry for same resource
    this.accessControl = this.accessControl.filter(
      (e) => !(e.resourceType === entry.resourceType && e.resourceId === entry.resourceId)
    );
    this.accessControl.push(entry);
    logger.info(`Access control entry added: ${entry.resourceType}:${entry.resourceId}`);
  }

  /**
   * Load or create user identity.
   */
  private async loadOrCreateUser(
    userId: string,
    authProvider: 'telegram' | 'dashboard' | 'api_key'
  ): Promise<UserIdentity> {
    // Try to load from storage
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
      logger.warn(`Failed to load user ${userId}, creating new:`, error);
    }

    // Create new user
    const newUser: UserIdentity = {
      userId,
      displayName: userId,
      role: UserRole.MEMBER, // Default role
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
  private createSession(userId: string, metadata?: Record<string, unknown>): Session {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    const session: Session = {
      sessionId,
      userId,
      startTime: now,
      lastActivityTime: now,
      expiresAt: now + 24 * TIME.MS_PER_HOUR, // 24 hour session
      metadata,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Cleanup expired sessions.
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }
}
