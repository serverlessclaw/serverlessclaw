/**
 * @module AuthAPI
 * Simple password-based authentication for the dashboard using secure HTTP-only cookies.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resource } from 'sst';
import { AUTH } from '@/lib/constants';
import { HTTP_STATUS } from '@claw/core/lib/constants';

/**
 * Handles dashboard login and sets the session cookie
 *
 * @param req - The incoming POST request with password in the body.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { password } = await req.json();
    const correctPassword = Resource.DashboardPassword.value;

    if (password && correctPassword && password === correctPassword) {
      const response = NextResponse.json({ success: true });
      
      // Set a secure, HttpOnly cookie for "authentication"
      response.cookies.set(AUTH.COOKIE_NAME, AUTH.COOKIE_VALUE, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: AUTH.COOKIE_MAX_AGE,
        path: '/',
      });
      
      return response;
    }

    return NextResponse.json({ error: AUTH.ERROR_INVALID_CREDENTIALS }, { status: HTTP_STATUS.UNAUTHORIZED });
  } catch (error) {
    console.error('Auth Error:', error);
    return NextResponse.json({ error: AUTH.ERROR_SYSTEM_FAILURE }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
