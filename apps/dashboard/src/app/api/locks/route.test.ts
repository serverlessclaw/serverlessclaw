import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSend = vi.fn();

vi.mock('sst', () => ({
  Resource: {
    App: { name: 'test-app', stage: 'test-stage' },
    MemoryTable: { name: 'test-memory-table' },
  },
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mockSend }) },
  ScanCommand: class {},
  DeleteCommand: class {},
}));

vi.mock('@claw/core/lib/constants', () => ({
  HTTP_STATUS: { INTERNAL_SERVER_ERROR: 500, BAD_REQUEST: 400 },
}));

describe('Locks API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns locks list on success', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockSend.mockResolvedValue({
        Items: [
          {
            userId: 'LOCK#session-1',
            expiresAt: now + 3600,
            acquiredAt: now - 100,
            timestamp: now,
          },
          { userId: 'LOCK#session-2', expiresAt: now - 100, acquiredAt: now - 200, timestamp: now },
        ],
      });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.locks).toHaveLength(2);
      expect(data.locks[0].lockId).toBe('session-1');
      expect(data.locks[0].isExpired).toBe(false);
      expect(data.locks[1].lockId).toBe('session-2');
      expect(data.locks[1].isExpired).toBe(true);
    });

    it('returns empty array when no locks exist', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.locks).toEqual([]);
    });

    it('returns 500 on error', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      const { GET } = await import('./route');
      const res = await GET();
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to fetch locks');
    });
  });

  describe('DELETE', () => {
    it('force-releases a specific lock', async () => {
      mockSend.mockResolvedValue({});

      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/locks?lockId=LOCK%23session-abc', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.lockId).toBe('LOCK#session-abc');
    });

    it('returns 400 when lockId is missing', async () => {
      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/locks', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Missing lockId');
    });

    it('returns 500 on DynamoDB error', async () => {
      mockSend.mockRejectedValue(new Error('Delete failed'));

      const { DELETE } = await import('./route');
      const req = new NextRequest('http://localhost/api/locks?lockId=LOCK%23session-abc', {
        method: 'DELETE',
      });
      const res = await DELETE(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to release lock');
    });
  });
});
