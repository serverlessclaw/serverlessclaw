import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetAllConfigs = vi.fn();
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
  PutCommand: class {},
  UpdateCommand: class {},
  DeleteCommand: class {},
}));

vi.mock('@claw/core/lib/registry/index', () => ({
  AgentRegistry: {
    getAllConfigs: mockGetAllConfigs,
  },
}));

vi.mock('@claw/core/lib/backbone', () => ({
  BACKBONE_REGISTRY: {
    superclaw: { id: 'superclaw', name: 'SuperClaw', isBackbone: true },
    coder: { id: 'coder', name: 'Coder', isBackbone: true },
  },
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { INTERNAL_SERVER_ERROR: 500, BAD_REQUEST: 400 },
  DYNAMO_KEYS: { AGENTS_CONFIG: 'agents_config' },
}));

describe('Agents API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns agent configs on success', async () => {
      const configs = [{ id: 'superclaw', name: 'SuperClaw' }];
      mockGetAllConfigs.mockResolvedValue(configs);

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data).toEqual(configs);
    });

    it('returns 500 on error', async () => {
      mockGetAllConfigs.mockRejectedValue(new Error('DynamoDB error'));

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to fetch agents');
    });
  });

  describe('POST', () => {
    it('saves agent config and returns success', async () => {
      mockSend.mockResolvedValue({});

      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({ agents: [{ id: 'test' }] }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockSend).toHaveBeenCalled();
    });

    it('returns 500 on DynamoDB error', async () => {
      mockSend.mockRejectedValue(new Error('Write failed'));

      const { POST } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'POST',
        body: JSON.stringify({ agents: [] }),
      });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to update agents');
    });
  });

  describe('PATCH', () => {
    it('creates a new non-backbone agent', async () => {
      mockSend.mockResolvedValue({});

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

    it('returns 400 when agentId or config is missing', async () => {
      const { PATCH } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'PATCH',
        body: JSON.stringify({ agentId: 'test' }),
      });
      const res = await PATCH(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('agentId and config are required');
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

    it('rejects deletion of backbone agents', async () => {
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents?agentId=coder', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Cannot delete backbone agent');
    });

    it('returns 400 when agentId is missing', async () => {
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/agents', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('agentId query parameter is required');
    });
  });
});
