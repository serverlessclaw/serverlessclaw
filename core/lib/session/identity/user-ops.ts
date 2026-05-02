import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'crypto';
import { logger } from '../../logger';
import { UserRole, UserIdentity } from './types';
import { IdentityBase } from './base';

/**
 * User-related identity operations.
 */
export class UserOps extends IdentityBase {
  /**
   * Get user identity. Loads from storage.
   */
  async loadUser(userId: string, orgId?: string): Promise<UserIdentity | undefined> {
    try {
      const items = await this.base.queryItems({
        KeyConditionExpression: 'userId = :pk AND #ts = :zero',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: {
          ':pk': this.getUserKey(userId, orgId),
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
          hashedPassword: item.hashedPassword as string | undefined,
        };
      }
    } catch (error) {
      logger.error(`Failed to load user ${userId}:`, error);
    }
    return undefined;
  }

  /**
   * Create new user identity.
   */
  async createUser(
    userId: string,
    authProvider: 'telegram' | 'dashboard' | 'api_key',
    password?: string,
    orgId?: string
  ): Promise<UserIdentity> {
    const newUser: UserIdentity = {
      userId,
      displayName: userId,
      role: UserRole.MEMBER,
      workspaceIds: [],
      authProvider,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      hashedPassword: password ? this.hashPassword(userId, password) : undefined,
    };

    await this.saveUser(newUser, orgId);
    return newUser;
  }

  /**
   * Save user to storage.
   */
  async saveUser(user: UserIdentity, orgId?: string): Promise<void> {
    try {
      await this.base.putItem(
        {
          userId: this.getUserKey(user.userId, orgId),
          timestamp: 0,
          type: 'USER_IDENTITY',
          displayName: user.displayName,
          email: user.email,
          role: user.role,
          workspaceIds: user.workspaceIds,
          authProvider: user.authProvider,
          createdAt: user.createdAt,
          lastActiveAt: user.lastActiveAt,
          hashedPassword: user.hashedPassword,
          updatedAt: Date.now(),
        },
        { ConditionExpression: 'attribute_not_exists(userId)' }
      );
    } catch (error) {
      logger.error(`Failed to save user ${user.userId}:`, error);
    }
  }

  /**
   * Get all registered users.
   */
  async getAllUsers(orgId?: string): Promise<UserIdentity[]> {
    try {
      const { getMemoryByType } = await import('../../memory/utils');
      const items = await getMemoryByType(
        this.base,
        'USER_IDENTITY',
        1000,
        orgId ? { orgId } : undefined
      );
      return items.map((item) => ({
        userId: (item.userId as string).split('#').pop()!,
        displayName: (item.displayName as string) ?? '',
        email: item.email as string | undefined,
        role: item.role as UserRole,
        workspaceIds: (item.workspaceIds as string[]) ?? [],
        authProvider: item.authProvider as 'telegram' | 'dashboard' | 'api_key',
        createdAt: item.createdAt as number,
        lastActiveAt: item.lastActiveAt as number,
        hashedPassword: item.hashedPassword as string | undefined,
      }));
    } catch (error) {
      logger.error('Failed to list users:', error);
      return [];
    }
  }

  /**
   * Update user details.
   */
  async updateUser(
    userId: string,
    updates: Partial<Pick<UserIdentity, 'displayName' | 'email' | 'role'>>,
    orgId?: string
  ): Promise<boolean> {
    const docClient = this.base.getDocClient();
    const tableName = this.base.getTableName();
    if (!tableName) return false;

    const expressions = [];
    const values: Record<string, unknown> = { ':updatedAt': Date.now() };
    const names: Record<string, string> = {};

    if (updates.displayName) {
      expressions.push('displayName = :displayName');
      values[':displayName'] = updates.displayName;
    }
    if (updates.email) {
      expressions.push('email = :email');
      values[':email'] = updates.email;
    }
    if (updates.role) {
      expressions.push('#role = :role');
      values[':role'] = updates.role;
      names['#role'] = 'role';
    }

    if (expressions.length === 0) return true;

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: this.getUserKey(userId, orgId), timestamp: 0 },
          UpdateExpression: `SET ${expressions.join(', ')}, updatedAt = :updatedAt`,
          ConditionExpression: 'attribute_exists(userId)',
          ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
          ExpressionAttributeValues: values,
        })
      );
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return false;
      }
      logger.error(`Failed to update user ${userId}:`, e);
      return false;
    }
  }

  /**
   * Add user to workspace.
   */
  async addUserToWorkspace(userId: string, workspaceId: string, orgId?: string): Promise<boolean> {
    const docClient = this.base.getDocClient();
    const tableName = this.base.getTableName();
    if (!tableName) return false;

    try {
      await docClient.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { userId: this.getUserKey(userId, orgId), timestamp: 0 },
          UpdateExpression:
            'SET workspaceIds = list_append(if_not_exists(workspaceIds, :empty), :workspaceId), updatedAt = :updatedAt',
          ConditionExpression:
            'attribute_exists(userId) AND NOT contains(workspaceIds, :workspaceIdStr)',
          ExpressionAttributeValues: {
            ':empty': [],
            ':workspaceId': [workspaceId],
            ':workspaceIdStr': workspaceId,
            ':updatedAt': Date.now(),
          },
        })
      );
      logger.info(`User ${userId} added to workspace ${workspaceId}`);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        // If the user doesn't exist, we should return false.
        const user = await this.loadUser(userId, orgId);
        return !!user;
      }
      logger.error(`Failed to add user ${userId} to workspace ${workspaceId}:`, e);
      return false;
    }
  }

  /**
   * Remove user from workspace.
   */
  async removeUserFromWorkspace(
    userId: string,
    workspaceId: string,
    orgId?: string
  ): Promise<boolean> {
    const docClient = this.base.getDocClient();
    const tableName = this.base.getTableName();
    if (!tableName) return false;

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      const user = await this.loadUser(userId, orgId);
      if (!user) return false;

      const index = user.workspaceIds.indexOf(workspaceId);
      if (index === -1) return true;

      const newIds = user.workspaceIds.filter((id) => id !== workspaceId);

      try {
        await docClient.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { userId: this.getUserKey(userId, orgId), timestamp: 0 },
            UpdateExpression: 'SET workspaceIds = :workspaceIds, updatedAt = :updatedAt',
            ConditionExpression: 'workspaceIds = :oldIds',
            ExpressionAttributeValues: {
              ':workspaceIds': newIds,
              ':oldIds': user.workspaceIds,
              ':updatedAt': Date.now(),
            },
          })
        );
        logger.info(`User ${userId} removed from workspace ${workspaceId}`);
        return true;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
          retryCount++;
          continue;
        }
        logger.error(`Failed to remove user ${userId} from workspace ${workspaceId}:`, e);
        return false;
      }
    }
    return false;
  }

  /**
   * Hash a password for storage using userId as salt.
   */
  hashPassword(userId: string, password: string): string {
    return createHash('sha256').update(`${userId}:${password}`).digest('hex');
  }
}
