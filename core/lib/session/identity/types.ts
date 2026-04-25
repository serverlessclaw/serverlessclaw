import { UserRole } from '../../types/common';
export { UserRole };

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
  /** Team ID. */
  teamId?: string;
  /** Staff ID within organization. */
  staffId?: string;
  /** Authentication provider. */
  authProvider: 'telegram' | 'dashboard' | 'api_key';
  /** When the user was created. */
  createdAt: number;
  /** Last active timestamp. */
  lastActiveAt: number;
  /** Securely hashed password/keyphrase. */
  hashedPassword?: string;
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
  /** Team ID for this session. */
  teamId?: string;
  /** Staff ID for this session. */
  staffId?: string;
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
