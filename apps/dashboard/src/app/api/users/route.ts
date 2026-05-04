import { NextRequest, NextResponse } from 'next/server';
import { getIdentityManager } from '@claw/core/lib/session/identity';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { AUTH } from '@/lib/constants';
import { logger } from '@claw/core/lib/logger';

/**
 * User Management API.
 */
export async function GET(req: NextRequest) {
  const callerId = req.cookies.get(AUTH.SESSION_USER_ID)?.value;
  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  try {
    const manager = await getIdentityManager();
    const caller = await manager.getUser(callerId);

    // Only admins can list all users
    if (!caller || (caller.role !== 'admin' && caller.role !== 'owner')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: HTTP_STATUS.FORBIDDEN });
    }

    const users = await manager.getAllUsers();
    // Strip sensitive info
    const safeUsers = users.map((u) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { hashedPassword: _hashedPassword, ...safe } = u;
      return safe;
    });

    return NextResponse.json({ users: safeUsers });
  } catch (error) {
    logger.error('Failed to list users:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

export async function POST(req: NextRequest) {
  const callerId = req.cookies.get(AUTH.SESSION_USER_ID)?.value;
  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  try {
    const { userId, password, displayName, email, role } = await req.json();
    if (!userId || !password) {
      return NextResponse.json(
        { error: 'Missing userId or password' },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    const manager = await getIdentityManager();
    const caller = await manager.getUser(callerId);

    if (!caller || (caller.role !== 'admin' && caller.role !== 'owner')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: HTTP_STATUS.FORBIDDEN });
    }

    const existing = await manager.getUser(userId);
    if (existing) {
      return NextResponse.json({ error: 'User already exists' }, { status: HTTP_STATUS.CONFLICT });
    }

    // We use authenticate with a password to trigger createUser with hashedPassword
    const result = await manager.authenticate(userId, 'dashboard', { password });

    if (result.success && result.user) {
      // Update additional fields
      await manager.updateUser(userId, { displayName, email, role: role || 'member' }, callerId);
      return NextResponse.json({ success: true, user: result.user });
    }

    return NextResponse.json(
      { error: result.error || 'Failed to create user' },
      { status: HTTP_STATUS.BAD_REQUEST }
    );
  } catch (error) {
    logger.error('Failed to create user:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const callerId = req.cookies.get(AUTH.SESSION_USER_ID)?.value;
  if (!callerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: HTTP_STATUS.UNAUTHORIZED });
  }

  try {
    const { userId, ...updates } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const manager = await getIdentityManager();
    const success = await manager.updateUser(userId, updates, callerId);

    if (success) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: HTTP_STATUS.BAD_REQUEST }
    );
  } catch (error) {
    logger.error('Failed to update user:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
