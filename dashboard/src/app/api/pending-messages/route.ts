import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

/**
 * Handles pending message operations for queued messages during agent processing.
 * GET: Fetch pending messages for a session
 * DELETE: Remove a specific pending message
 * PATCH: Update a specific pending message content
 *
 * @param req - The incoming GET request with sessionId query parameter.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    const { SessionStateManager } = await import('@claw/core/lib/session/session-state');
    const sessionStateManager = new SessionStateManager();

    const pendingMessages = await sessionStateManager.getPendingMessages(sessionId);

    return NextResponse.json({ pendingMessages });
  } catch (error) {
    console.error('Failed to get pending messages:', error);
    return NextResponse.json(
      {
        error: 'Failed to get pending messages',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId, messageId } = await req.json();

    if (!sessionId || !messageId) {
      return NextResponse.json({ error: 'Missing sessionId or messageId' }, { status: 400 });
    }

    const { SessionStateManager } = await import('@claw/core/lib/session/session-state');
    const sessionStateManager = new SessionStateManager();

    const success = await sessionStateManager.removePendingMessage(sessionId, messageId);

    if (!success) {
      return NextResponse.json(
        { error: 'Message not found or already processed' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to remove pending message:', error);
    return NextResponse.json(
      {
        error: 'Failed to remove pending message',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId, messageId, content } = await req.json();

    if (!sessionId || !messageId || content === undefined) {
      return NextResponse.json(
        { error: 'Missing sessionId, messageId, or content' },
        { status: 400 }
      );
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Content must be a non-empty string' }, { status: 400 });
    }

    const { SessionStateManager } = await import('@claw/core/lib/session/session-state');
    const sessionStateManager = new SessionStateManager();

    const success = await sessionStateManager.updatePendingMessage(
      sessionId,
      messageId,
      content.trim()
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Message not found or already processed' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update pending message:', error);
    return NextResponse.json(
      {
        error: 'Failed to update pending message',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
