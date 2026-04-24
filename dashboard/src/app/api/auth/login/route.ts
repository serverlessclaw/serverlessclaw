/**
 * @module AuthAPI
 * Simple password-based authentication for the dashboard using secure HTTP-only cookies.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AUTH } from '@/lib/constants';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { logger } from '@claw/core/lib/logger';
import { resolveSSTResourceValue } from '@claw/core/lib/utils/resource-helpers';

/**
 * Handles dashboard login and sets the session cookie
 *
 * @param req - The incoming POST request with password in the body.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { password } = await req.json();
    const isDev = process.env.NODE_ENV !== 'production';
    let correctPassword = resolveSSTResourceValue(
      'DashboardPassword',
      'value',
      'DASHBOARD_PASSWORD'
    );

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
      logger.info(`[Auth:Login] ✅ Authorized successful (isDev=${isDev})`);
      const response = NextResponse.json({ success: true });

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      // Register session with IdentityManager
      try {
        const { getIdentityManager, UserRole } = await import('@claw/core/lib/session/identity');
        const identityManager = await getIdentityManager();
        const authResult = await identityManager.authenticate(sessionId, 'dashboard');

        // Grant admin privileges to the dashboard user
        if (
          authResult.success &&
          authResult.user?.role !== UserRole.ADMIN &&
          authResult.user?.role !== UserRole.OWNER
        ) {
          await identityManager.updateUserRole(sessionId, UserRole.ADMIN, 'superadmin');
        }
      } catch (err) {
        logger.error(
          `[Auth:Login] Failed to register dashboard session with IdentityManager:`,
          err
        );
      }

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

    logger.warn(
      `[Auth:Login] ❌ Unauthorized attempt. Correct password found: ${!!correctPassword}, isDev: ${isDev}`
    );
    return NextResponse.json(
      { error: AUTH.ERROR_INVALID_CREDENTIALS },
      { status: HTTP_STATUS.UNAUTHORIZED }
    );
  } catch (error) {
    logger.error('Auth Error:', error);
    return NextResponse.json(
      { error: AUTH.ERROR_SYSTEM_FAILURE },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
