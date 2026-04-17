import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/constants', () => ({
  AUTH: {
    COOKIE_NAME: 'claw_auth_session',
    SESSION_USER_ID: 'claw_session_id',
  },
}));

describe('Auth Logout API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 and clears auth cookies', async () => {
    const { POST } = await import('./route');
    const res = await POST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(res.cookies.get('claw_auth_session')?.value).toBe('');
    expect(res.cookies.get('claw_auth_session')?.maxAge).toBe(0);
    expect(res.cookies.get('claw_session_id')?.value).toBe('');
    expect(res.cookies.get('claw_session_id')?.maxAge).toBe(0);
  });
});