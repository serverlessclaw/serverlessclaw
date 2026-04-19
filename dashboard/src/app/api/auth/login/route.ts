/**
 * @module AuthAPI
 * Simple password-based authentication for the dashboard using secure HTTP-only cookies.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resource } from 'sst';
import { AUTH } from '@/lib/constants';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { SSTResource } from '@claw/core/lib/types/index';

/**
 * Handles dashboard login and sets the session cookie
 *
 * @param req - The incoming POST request with password in the body.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { password } = await req.json();
    const isDev = process.env.NODE_ENV !== 'production';
    let correctPassword;
    try {
      const typedResource = Resource as unknown as SSTResource;
      correctPassword = typedResource.DashboardPassword?.value;
    } catch (e) {
      // In local dev without `sst dev`, Resource access might throw
      if (!isDev) throw e;
    }

    // Handle unset SST secrets in dev mode (SST uses placeholders like {{ Name }})
    if (
      isDev &&
      (!correctPassword || (typeof correctPassword === 'string' && correctPassword.includes('{{')))
    ) {
      correctPassword = 'test-password';
    }

    // Allow the correct password, or fallback to 'test-password' in development for E2E tests
    const isAuthorized =
      password &&
      correctPassword &&
      (password === correctPassword || (isDev && password === 'test-password'));

    if (isAuthorized) {
      console.log(`[Auth:Login] ✅ Authorized successful (isDev=${isDev})`);
      const response = NextResponse.json({ success: true });

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      response.cookies.set(AUTH.COOKIE_NAME, AUTH.COOKIE_VALUE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: AUTH.COOKIE_MAX_AGE,
        path: '/',
      });

      response.cookies.set(AUTH.SESSION_USER_ID, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: AUTH.COOKIE_MAX_AGE,
        path: '/',
      });

      return response;
    }

    console.warn(`[Auth:Login] ❌ Unauthorized attempt. Correct password found: ${!!correctPassword}, isDev: ${isDev}`);
    return NextResponse.json(
      { error: AUTH.ERROR_INVALID_CREDENTIALS },
      { status: HTTP_STATUS.UNAUTHORIZED }
    );
  } catch (error) {
    console.error('Auth Error:', error);
    return NextResponse.json(
      { error: AUTH.ERROR_SYSTEM_FAILURE },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
