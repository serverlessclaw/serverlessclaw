import { logger } from '../../logger';
import { UserRole, Permission, AccessControlEntry } from './types';
import { ROLE_PERMISSIONS, WORKSPACE_SCOPED_PERMISSIONS } from './constants';
import { IdentityBase } from './base';

/**
 * Access Control and Permission operations.
 */
export class AccessOps extends IdentityBase {
  /**
   * Check if a user has specific permission.
   */
  hasPermissionSync(userRole: UserRole, permission: Permission): boolean {
    const rolePermissions = ROLE_PERMISSIONS[userRole];
    return rolePermissions.includes(permission);
  }

  /**
   * Get ACL entry from storage.
   */
  async getAccessControlEntry(
    resourceType: string,
    resourceId: string,
    orgId?: string
  ): Promise<AccessControlEntry | undefined> {
    try {
      const items = await this.base.queryItems({
        KeyConditionExpression: 'userId = :pk AND #ts = :zero',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': this.getAclKey(resourceType, resourceId, orgId),
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
   * Add access control entry.
   */
  async addAccessControlEntry(entry: AccessControlEntry, orgId?: string): Promise<void> {
    try {
      await this.base.putItem({
        userId: this.getAclKey(entry.resourceType, entry.resourceId, orgId),
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
   * Check if permission is workspace scoped.
   */
  isWorkspaceScoped(permission: Permission): boolean {
    return WORKSPACE_SCOPED_PERMISSIONS.has(permission);
  }
}
