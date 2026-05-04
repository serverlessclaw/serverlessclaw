import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSetGap = vi.fn().mockResolvedValue(undefined);

vi.mock('@claw/core/lib/memory', () => ({
  DynamoMemory: class {
    setGap = mockSetGap;
  },
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 },
}));

describe('Memory Gap API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if details is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/gap', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Validation failed');
  });

  it('creates gap and returns success with gapId', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/gap', {
      method: 'POST',
      body: JSON.stringify({ details: 'Need database access', metadata: { priority: 5 } }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.gapId).toBeDefined();
    expect(mockSetGap).toHaveBeenCalled();
  });

  it('returns 500 on memory error', async () => {
    mockSetGap.mockRejectedValue(new Error('DynamoDB error'));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/gap', {
      method: 'POST',
      body: JSON.stringify({ details: 'Test gap' }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Internal Server Error');
  });
});
