/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockResource = vi.hoisted(() => ({
  DashboardPassword: { value: 'test-password-123' } as any,
}));

vi.mock('sst', () => ({
  Resource: mockResource,
}));

vi.mock('@/lib/constants', () => ({
  AUTH: {
    COOKIE_NAME: 'claw_auth_session',
    COOKIE_VALUE: 'authenticated',
    COOKIE_MAX_AGE: 604800,
    SESSION_USER_ID: 'session_user_id',
    ERROR_INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    ERROR_SYSTEM_FAILURE: 'SYSTEM_FAILURE',
  },
  HTTP_STATUS: { UNAUTHORIZED: 401, INTERNAL_SERVER_ERROR: 500, OK: 200 },
}));

describe('Auth Login API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'development');
    mockResource.DashboardPassword = { value: 'test-password-123' };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 200 and sets cookie on valid password', async () => {
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test-password-123' }),
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(res.cookies.get('claw_auth_session')).toBeDefined();
  });

  it('supports fallback test-password in development', async () => {
    mockResource.DashboardPassword = { value: '{{ DashboardPassword }}' }; // SST placeholder
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test-password' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('fails in production if Resource is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    mockResource.DashboardPassword = undefined as any;

    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'any' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401); // Unauthorized because no password matches
  });

  it('returns 500 on general handler failure', async () => {
    const { POST } = await import('./route');

    const req = {
      json: async () => {
        throw new Error('JSON parse failed');
      },
    } as any;
    const res = await POST(req);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'SYSTEM_FAILURE' });
  });
});
