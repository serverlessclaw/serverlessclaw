import { NextResponse } from 'next/server';
import { AUTH } from '@/lib/constants';

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH.COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  response.cookies.set(AUTH.SESSION_USER_ID, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  return response;
}