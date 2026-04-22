/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sst', () => ({
  Resource: {
    App: { name: 'serverlessclaw', stage: 'local' },
    RealtimeBus: { endpoint: 'wss://example.com/mqtt', authorizer: 'TestAuth' },
    ConfigTable: { name: 'ConfigTable' },
  },
}));

// Use vi.fn() directly or hoisted
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: () => ({
      send: mockSend,
    }),
  },

  PutCommand: class {
    constructor(public params: any) {
      Object.assign(this, params);
    }
  },
}));

import { GET, POST } from './route';
import { AUTH } from '@/lib/constants';

describe('Config API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockAuthReq = (overrides = {}) =>
    ({
      cookies: {
        get: vi.fn().mockReturnValue({ value: AUTH.COOKIE_VALUE }),
      },
      nextUrl: {
        searchParams: new URLSearchParams(),
      },
      json: async () => ({}),
      ...overrides,
    }) as any;

  it('returns ok for debug_url diagnostic', async () => {
    const req = mockAuthReq({
      nextUrl: {
        searchParams: new URLSearchParams({ __debug_url: 'wss%3A%2F%2Ftest.com' }),
      },
    });
    const res = await GET(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('returns canonical config with wss:// prefix', async () => {
    const res = await GET(mockAuthReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.realtime.url).toBe('wss://example.com/mqtt');
    expect(data.app).toBe('serverlessclaw');
  });

  it('handles Resource access errors gracefully', async () => {
    // Force Resource access to throw
    const { Resource } = await import('sst');
    vi.spyOn(Resource as any, 'App', 'get').mockImplementation(() => {
      throw new Error('SST Linkage Missing');
    });

    const res = await GET(mockAuthReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.app).toBe('serverlessclaw'); // Default fallback
    expect(data.stage).toBe('local'); // Default fallback

    vi.restoreAllMocks();
  });

  describe('POST /api/config', () => {
    it('returns 400 for missing key or value', async () => {
      const req = mockAuthReq({ json: async () => ({ key: 'only-key' }) });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('updates config successfully for active_locale', async () => {
      mockSend.mockResolvedValue({});

      const req = mockAuthReq({ json: async () => ({ key: 'active_locale', value: 'cn' }) });
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockSend).toHaveBeenCalled();
    });

    it('returns 403 for unauthorized configuration key', async () => {
      const req = mockAuthReq({ json: async () => ({ key: 'SECRET_KEY', value: 'stolen' }) });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('returns 500 when database update fails', async () => {
      mockSend.mockRejectedValue(new Error('Dynamo failed'));

      const req = mockAuthReq({ json: async () => ({ key: 'active_locale', value: 'en' }) });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });
});
