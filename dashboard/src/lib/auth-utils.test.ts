import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { getUserId } from './auth-utils';
import { AUTH } from './constants';

describe('Auth Utils', () => {
  it('returns default user when no cookies are present', () => {
    const req = new NextRequest('http://localhost');
    expect(getUserId(req)).toBe('dashboard-user');
  });

  it('returns user ID from session cookie when authenticated', () => {
    const req = new NextRequest('http://localhost', {
      headers: {
        cookie: `${AUTH.COOKIE_NAME}=${AUTH.COOKIE_VALUE}; ${AUTH.SESSION_USER_ID}=user-123`,
      },
    });
    expect(getUserId(req)).toBe('user-123');
  });

  it('falls back to guest if auth marker is missing', () => {
    const req = new NextRequest('http://localhost', {
      headers: {
        cookie: `${AUTH.SESSION_USER_ID}=user-123`,
      },
    });
    expect(getUserId(req)).toBe('dashboard-user');
  });

  it('falls back to guest if auth marker is invalid', () => {
    const req = new NextRequest('http://localhost', {
      headers: {
        cookie: `${AUTH.COOKIE_NAME}=invalid; ${AUTH.SESSION_USER_ID}=user-123`,
      },
    });
    expect(getUserId(req)).toBe('dashboard-user');
  });

  it('blacklists SYSTEM identity to prevent spoofing', () => {
    const req = new NextRequest('http://localhost', {
      headers: {
        cookie: `${AUTH.COOKIE_NAME}=${AUTH.COOKIE_VALUE}; ${AUTH.SESSION_USER_ID}=SYSTEM`,
      },
    });
    expect(getUserId(req)).toBe('dashboard-user');
  });
});
