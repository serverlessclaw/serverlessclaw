import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IdentityManager } from '../lib/session/identity/manager';
import { UserRole } from '../lib/session/identity/types';
import { MEMORY_KEYS } from '../lib/constants';

// Mock dependencies
const mockDocClient = {
  send: vi.fn().mockResolvedValue({}),
};

const mockBaseMemory = {
  getDocClient: () => mockDocClient,
  getTableName: () => 'TestTable',
  putItem: vi.fn().mockResolvedValue({}),
  queryItems: vi.fn().mockResolvedValue([]),
  deleteItem: vi.fn().mockResolvedValue({}),
};

describe('IdentityManager', () => {
  let manager: IdentityManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new IdentityManager(mockBaseMemory as any);
    // Default mock behavior
    mockBaseMemory.queryItems.mockResolvedValue([]);
  });

  describe('User Provisioning & Password Verification', () => {
    it('should hash password during user creation', async () => {
      const userId = 'test-user';
      const password = 'secure-keyphrase';

      // Mock user doesn't exist initially
      mockBaseMemory.queryItems.mockResolvedValue([]);

      await manager.authenticate(userId, 'dashboard', { password });

      expect(mockBaseMemory.putItem).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}USER#${userId}`,
          hashedPassword: expect.any(String),
          authProvider: 'dashboard',
        }),
        expect.any(Object)
      );

      const hashed = (mockBaseMemory.putItem.mock.calls[0][0] as any).hashedPassword;
      expect(hashed).not.toBe(password);
      expect(hashed.length).toBe(64); // SHA-256 hex length
    });

    it('should verify correct password (salted)', async () => {
      const userId = 'test-user';
      const password = 'secure-keyphrase';
      // sha256 of 'test-user:secure-keyphrase'
      const hashedPassword = '885a232aea6b3f97900b7fc7277b8eff7fec48f1a9b03bffd318dc1e39070cdc';

      mockBaseMemory.queryItems.mockResolvedValue([
        {
          userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}USER#${userId}`,
          hashedPassword,
          role: UserRole.MEMBER,
          authProvider: 'dashboard',
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
        },
      ]);

      const isValid = await manager.verifyPassword(userId, password);
      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const userId = 'test-user';
      const password = 'wrong-password';
      const hashedPassword = '885a232aea6b3f97900b7fc7277b8eff7fec48f1a9b03bffd318dc1e39070cdc';

      mockBaseMemory.queryItems.mockResolvedValue([
        {
          userId: `${MEMORY_KEYS.WORKSPACE_PREFIX}USER#${userId}`,
          hashedPassword,
          role: UserRole.MEMBER,
          authProvider: 'dashboard',
        },
      ]);

      const isValid = await manager.verifyPassword(userId, password);
      expect(isValid).toBe(false);
    });
  });

  describe('User Management', () => {
    it('should allow admin to update user roles', async () => {
      const targetUserId = 'member-01';
      const callerId = 'admin-01';

      mockBaseMemory.queryItems.mockImplementation(async (params: any) => {
        const pk = params.ExpressionAttributeValues[':pk'];
        if (pk.includes(callerId)) {
          return [{ userId: pk, role: UserRole.ADMIN, authProvider: 'dashboard' }];
        }
        if (pk.includes(targetUserId)) {
          return [{ userId: pk, role: UserRole.MEMBER, authProvider: 'dashboard' }];
        }
        return [];
      });

      const success = await manager.updateUser(targetUserId, { role: UserRole.ADMIN }, callerId);

      expect(success).toBe(true);
      expect(mockDocClient.send).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            UpdateExpression: expect.stringContaining('SET #role = :role'),
          }),
        })
      );
    });

    it('should prevent members from updating roles', async () => {
      const targetUserId = 'admin-01';
      const callerId = 'member-01';

      mockBaseMemory.queryItems.mockImplementation(async (params: any) => {
        const pk = params.ExpressionAttributeValues[':pk'];
        if (pk.includes(callerId)) {
          return [{ userId: pk, role: UserRole.MEMBER, authProvider: 'dashboard' }];
        }
        if (pk.includes(targetUserId)) {
          return [{ userId: pk, role: UserRole.ADMIN, authProvider: 'dashboard' }];
        }
        return [];
      });

      const success = await manager.updateUser(targetUserId, { role: UserRole.MEMBER }, callerId);
      expect(success).toBe(false);
    });
  });
});
