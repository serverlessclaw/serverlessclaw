import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUpdateInsightMetadata = vi.fn().mockResolvedValue(undefined);

vi.mock('@claw/core/lib/memory', () => ({
  DynamoMemory: class {
    updateInsightMetadata = mockUpdateInsightMetadata;
  },
}));

vi.mock('@/lib/constants', () => ({
  HTTP_STATUS: { BAD_REQUEST: 400, INTERNAL_SERVER_ERROR: 500 },
}));

describe('Memory Prioritize API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 if userId is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/prioritize', {
      method: 'POST',
      body: JSON.stringify({ timestamp: 12345 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Validation failed');
  });

  it('returns 400 if timestamp is missing', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/prioritize', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user1' }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Validation failed');
  });

  it('updates metadata and returns success', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/prioritize', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user1', timestamp: 12345, priority: 8, urgency: 5, impact: 7 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockUpdateInsightMetadata).toHaveBeenCalledWith('user1', 12345, {
      priority: 8,
      urgency: 5,
      impact: 7,
    });
  });

  it('returns 400 if priority is not a number', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/prioritize', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user1', timestamp: 12345, priority: 'high' }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain('Validation failed');
  });

  it('returns 500 on memory error', async () => {
    mockUpdateInsightMetadata.mockRejectedValue(new Error('DynamoDB error'));

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/memory/prioritize', {
      method: 'POST',
      body: JSON.stringify({ userId: 'user1', timestamp: 12345 }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBe('Internal Server Error');
  });
});
