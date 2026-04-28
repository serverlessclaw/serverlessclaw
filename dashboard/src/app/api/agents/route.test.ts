import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAllConfigs = vi.fn();
const mockSaveConfig = vi.fn();
const mockSend = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },

  GetCommand: class {
    constructor(public p: Record<string, unknown>) {
      Object.assign(this, p);
    }
  },
  PutCommand: class {
    constructor(public p: Record<string, unknown>) {
      Object.assign(this, p);
    }
  },
  UpdateCommand: class {
    constructor(public p: Record<string, unknown>) {
      Object.assign(this, p);
    }
  },
  DeleteCommand: class {
    constructor(public p: Record<string, unknown>) {
      Object.assign(this, p);
    }
  },
}));

vi.mock('@claw/core/lib/registry', () => ({
  AgentRegistry: {
    getAllConfigs: mockGetAllConfigs,
    saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  },
  ConfigManager: {
    atomicRemoveFromMap: vi.fn().mockResolvedValue({}),
    deleteConfig: vi.fn().mockResolvedValue({}),
  },
}));

const mockGetConfigTableName = vi.fn().mockReturnValue('test-config-table');
vi.mock('@claw/core/lib/utils/ddb-client', () => ({
  getConfigTableName: () => mockGetConfigTableName(),
}));

vi.mock('@claw/core/lib/registry/config/client', () => ({
  getDocClient: () => ({ send: mockSend }),
}));

vi.mock('@claw/core/lib/backbone', () => ({
  BACKBONE_REGISTRY: {
    superclaw: { id: 'superclaw', name: 'SuperClaw', isBackbone: true },
    coder: { id: 'coder', name: 'Coder', isBackbone: true },
  },
}));

const mockHasPermission = vi.fn().mockResolvedValue(true);
const mockGetUser = vi.fn().mockResolvedValue({ role: 'ADMIN' });
vi.mock('@claw/core/lib/session/identity', () => ({
  getIdentityManager: () => ({
    hasPermission: mockHasPermission,
    getUser: mockGetUser,
  }),
  Permission: {
    AGENT_VIEW: 'agent:view',
    AGENT_UPDATE: 'agent:update',
    AGENT_DELETE: 'agent:delete',
  },
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { INTERNAL_SERVER_ERROR: 500, BAD_REQUEST: 400, OK: 200, FORBIDDEN: 403 },
  DYNAMO_KEYS: { AGENTS_CONFIG: 'agents_config' },
  AUTH: {
    COOKIE_NAME: 'claw_auth_session',
    COOKIE_VALUE: 'authenticated',
    SESSION_USER_ID: 'claw_session_id',
  },
}));

describe('Agents API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConfigTableName.mockReturnValue('test-config-table');
    mockHasPermission.mockResolvedValue(true);
    mockGetUser.mockResolvedValue({ role: 'ADMIN' });
  });

  describe('GET', () => {
    it('returns agent configs on success', async () => {
      const configs = { superclaw: { id: 'superclaw', name: 'SuperClaw' } };
      mockGetAllConfigs.mockResolvedValue(configs);

      const { GET } = await import('./route');
      const res = await GET(new NextRequest('http://localhost/api/agents'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual({ agents: configs });
    });

    it('returns 500 on error', async () => {
      mockGetAllConfigs.mockRejectedValue(new Error('DynamoDB error'));

      const { GET } = await import('./route');
      const res = await GET(new NextRequest('http://localhost/api/agents'));
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to fetch agents');
    });

    it('returns 403 when user lacks AGENT_VIEW permission', async () => {
      mockHasPermission.mockResolvedValue(false);

      const { GET } = await import('./route');
      const res = await GET(new NextRequest('http://localhost/api/agents'));
      expect(res.status).toBe(403);
    });
  });

  describe('POST', () => {
    it('saves agent config and returns success', async () => {
      mockSaveConfig.mockResolvedValue({});

      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          agents: [{ id: 'test', name: 'Test Agent', systemPrompt: 'You are a test.' }],
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockSaveConfig).toHaveBeenCalled();
    });

    it('returns 500 when ConfigTable name is missing', async () => {
      mockGetConfigTableName.mockReturnValue('');
      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({ agents: [] }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'ConfigTable name is missing from resources.' });
    });

    it('returns 500 on DynamoDB error', async () => {
      mockSaveConfig.mockRejectedValue(new Error('Write failed'));

      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({
          agents: [{ id: 'error-trigger', name: 'Trigger', systemPrompt: 'X' }],
        }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to update agents');
    });
  });

  describe('PATCH', () => {
    it('creates a new non-backbone agent', async () => {
      mockSaveConfig.mockResolvedValue({});

      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({
          agentId: 'my-agent',
          config: { name: 'My Agent', systemPrompt: 'You are helpful.', enabled: true },
        }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.agentId).toBe('my-agent');
    });

    it('returns 400 when agentId or config is missing', async () => {
      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({ agentId: 'test' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(400);
    });

    it('returns 500 when ConfigTable name is missing', async () => {
      mockGetConfigTableName.mockReturnValue('');
      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({ agentId: 'test', config: {} }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(500);
    });

    it('rejects creating agents with backbone IDs', async () => {
      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({
          agentId: 'superclaw',
          config: { name: 'Malicious', isBackbone: false },
        }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Cannot overwrite backbone agent');
    });

    it('returns 500 on error', async () => {
      mockSaveConfig.mockRejectedValue(new Error('Patch failed'));
      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({ agentId: 'test', config: {} }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(500);
    });

    it('returns 403 when user lacks AGENT_UPDATE permission', async () => {
      mockHasPermission.mockResolvedValue(false);

      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({ agentId: 'test', config: {} }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE', () => {
    it('deletes a non-backbone agent', async () => {
      mockSend.mockResolvedValue({});

      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?agentId=my-agent', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.agentId).toBe('my-agent');
      expect(mockSend).toHaveBeenCalledTimes(2); // UpdateCommand + DeleteCommand
    });

    it('returns 400 when agentId is missing', async () => {
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('rejects deletion of backbone agents', async () => {
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?agentId=coder', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });

    it('returns 500 when ConfigTable name is missing', async () => {
      mockGetConfigTableName.mockReturnValue('');
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?agentId=test', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(500);
    });

    it('returns 500 on error', async () => {
      mockSend.mockRejectedValue(new Error('Delete failed'));
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?agentId=test', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(500);
    });

    it('returns 403 when user lacks AGENT_DELETE permission', async () => {
      mockHasPermission.mockResolvedValue(false);
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?agentId=test', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      expect(res.status).toBe(403);
    });
  });
});
