import { UserRole } from '../../types/agent';
import { logger } from '../../logger';

/**
 * Maps UserRoles to AWS-aligned permission scopes.
 * This can be used for session tags or dynamic role assumptions.
 */
export const ROLE_IAM_MAPPING: Record<UserRole, string[]> = {
  [UserRole.OWNER]: ['*'], // Full access within tenant
  [UserRole.ADMIN]: [
    's3:*',
    'dynamodb:*',
    'lambda:InvokeFunction',
    'eventbridge:PutEvents',
    'iam:GetUser',
    'iam:GetRole',
  ],
  [UserRole.MEMBER]: [
    's3:GetObject',
    's3:PutObject',
    's3:ListBucket',
    'dynamodb:GetItem',
    'dynamodb:PutItem',
    'dynamodb:Query',
    'lambda:InvokeFunction',
    'eventbridge:PutEvents',
  ],
  [UserRole.VIEWER]: ['s3:GetObject', 's3:ListBucket', 'dynamodb:GetItem', 'dynamodb:Query'],
};

/**
 * Synchronizes organization roles with SafetyEngine tiers.
 * Higher roles get higher trust scores or lower safety tiers.
 */
export function syncRoleToSafetyTier(role: UserRole): 'local' | 'prod' {
  switch (role) {
    case UserRole.OWNER:
    case UserRole.ADMIN:
      return 'local'; // Lower friction for admins (still safe, but less approval needed)
    default:
      return 'prod'; // Strict gating for members and viewers
  }
}

/**
 * Logs a synchronization event for audit purposes.
 */
export function logSyncEvent(userId: string, orgId: string, role: UserRole): void {
  logger.info(`[RBAC_SYNC] Synced user ${userId} to org ${orgId} with role ${role}`);
}
