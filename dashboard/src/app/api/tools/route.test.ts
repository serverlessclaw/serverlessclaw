import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetToolUsage = vi.fn();
const mockGetAllTools = vi.fn();

vi.mock('@/lib/tool-utils', () => ({
  getToolUsage: mockGetToolUsage,
  getAllTools: mockGetAllTools,
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { INTERNAL_SERVER_ERROR: 500 },
}));

describe('Tools API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tools list on success', async () => {
    const tools = [
      { name: 'recallKnowledge', description: 'Recall knowledge', usage: { count: 5, lastUsed: 12345 }, isExternal: false },
      { name: 'mcp_tool', description: 'External tool', usage: { count: 0, lastUsed: 0 }, isExternal: true },
    ];
    mockGetToolUsage.mockResolvedValue({});
    mockGetAllTools.mockResolvedValue(tools);

    const { GET } = await import('./route');
    const req = new Request('http://localhost/api/tools');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.tools).toEqual(tools);
  });

  it('passes refresh=true to getAllTools', async () => {
    mockGetToolUsage.mockResolvedValue({});
    mockGetAllTools.mockResolvedValue([]);

    const { GET } = await import('./route');
    const req = new Request('http://localhost/api/tools?refresh=true');
    await GET(req);

    expect(mockGetAllTools).toHaveBeenCalledWith({}, { forceRefresh: true });
  });

  it('passes refresh=false by default', async () => {
    mockGetToolUsage.mockResolvedValue({});
    mockGetAllTools.mockResolvedValue([]);

    const { GET } = await import('./route');
    const req = new Request('http://localhost/api/tools');
    await GET(req);

    expect(mockGetAllTools).toHaveBeenCalledWith({}, { forceRefresh: false });
  });

  it('returns 500 on error', async () => {
    mockGetToolUsage.mockRejectedValue(new Error('DynamoDB error'));

    const { GET } = await import('./route');
    const req = new Request('http://localhost/api/tools');
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to fetch tools');
  });
});
