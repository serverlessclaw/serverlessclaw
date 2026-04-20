import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH } from '@/lib/constants';
import { logger } from '@claw/core/lib/logger';

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/config',
];

const PUBLIC_PATH_PREFIXES = [
  '/_next',
  '/static',
  '/favicon',
  '/icon',
  '/robots.txt',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) {
    return true;
  }
  return PUBLIC_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const timestamp = new Date().toISOString();
  
  // Basic request logging with timestamp
  if (!pathname.startsWith('/_next') && !pathname.startsWith('/static')) {
    logger.info(`[${timestamp}] ${request.method} ${pathname}`);
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get(AUTH.COOKIE_NAME);

  if (!authCookie || authCookie.value !== AUTH.COOKIE_VALUE) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};