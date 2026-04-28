import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAllConfigs = vi.fn();
const mockHasPermission = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
  },
}));

vi.mock('@claw/core/lib/registry', () => ({
  AgentRegistry: {
    getAllConfigs: mockGetAllConfigs,
  },
}));

vi.mock('@claw/core/lib/session/identity', () => ({
  getIdentityManager: () => ({
    hasPermission: mockHasPermission,
    getUser: vi.fn().mockResolvedValue({ role: 'ADMIN' }),
  }),
  Permission: {
    AGENT_VIEW: 'agent:view',
    AGENT_UPDATE: 'agent:update',
    AGENT_DELETE: 'agent:delete',
    TASK_CREATE: 'task:create',
  },
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { FORBIDDEN: 403, OK: 200, INTERNAL_SERVER_ERROR: 500 },
  AUTH: {
    COOKIE_NAME: 'claw_auth_session',
    COOKIE_VALUE: 'authenticated',
    SESSION_USER_ID: 'claw_session_id',
  },
}));

describe('Dashboard API RBAC Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Agents API GET - RBAC', () => {
    it('returns 403 if user lacks AGENT_VIEW permission', async () => {
      mockHasPermission.mockResolvedValue(false);
      const { GET } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?workspaceId=ws-1', {
        headers: {
          cookie: 'claw_auth_session=authenticated; claw_session_id=user-1',
        },
      });
      const res = await GET(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Unauthorized workspace access' });
    });
  });

  describe('Agents API POST - RBAC', () => {
    it('returns 403 if user lacks AGENT_UPDATE permission', async () => {
      mockHasPermission.mockResolvedValue(false);
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?workspaceId=ws-1', {
        method: 'POST',
        headers: {
          cookie: 'claw_auth_session=authenticated; claw_session_id=user-1',
        },
        body: JSON.stringify({ agents: {} }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Unauthorized to update agent configurations' });
    });
  });
});
