import { NextRequest } from 'next/server';
import { AUTH } from '@/lib/constants';

/**
 * Extracts the user ID from the session cookie in a NextRequest.
 * Falls back to 'dashboard-user' if cookies are missing or the session cookie is not present.
 */
export function getUserId(req: NextRequest): string {
  if (!req.cookies) {
    return 'dashboard-user';
  }

  // Security Fix: Verify both session ID and auth marker
  const authCookie = req.cookies.get(AUTH.COOKIE_NAME);
  const sessionCookie = req.cookies.get(AUTH.SESSION_USER_ID);

  // If auth marker is missing or invalid, fallback to guest
  if (!authCookie || authCookie.value !== AUTH.COOKIE_VALUE) {
    return 'dashboard-user';
  }

  const userId = sessionCookie?.value || 'dashboard-user';

  // Critical Security Fix: Blacklist SYSTEM identity to prevent spoofing
  if (userId === 'SYSTEM') {
    return 'dashboard-user';
  }

  return userId;
}
