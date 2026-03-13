import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { UI_STRINGS, HTTP_STATUS } from '@/lib/constants';
import { revalidatePath } from 'next/cache';

/**
 * Handles chat messages from the dashboard UI using the Manager agent
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { text, sessionId, attachments } = await req.json();
    const userId = 'dashboard-user'; // Fixed ID for dashboard chat
    
    // Use a unique ID for the specific session history
    const storageId = sessionId ? `CONV#${userId}#${sessionId}` : userId;

    if (!text && (!attachments || attachments.length === 0)) {
      return NextResponse.json({ error: UI_STRINGS.MISSING_MESSAGE }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    console.log(`[Chat API] POST request - text: ${text?.substring(0, 20)}..., sessionId: ${sessionId}, attachments: ${attachments?.length || 0}`);
    console.log(`[Chat API] Using storageId: ${storageId}`);
    
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const { ProviderManager } = await import('@claw/core/lib/providers/index');
    const { getAgentTools } = await import('@claw/core/tools/index');
    const { Agent } = await import('@claw/core/lib/agent');
    const { SUPERCLAW_SYSTEM_PROMPT } = await import('@claw/core/agents/superclaw');
    const { TraceSource } = await import('@claw/core/lib/types/index');

    const memory = new DynamoMemory();
    const provider = new ProviderManager();
    const agentTools = await getAgentTools('main');
    const agent = new Agent(memory, provider, agentTools, SUPERCLAW_SYSTEM_PROMPT);

    const reply = await agent.process(storageId, text || '', { sessionId, source: TraceSource.DASHBOARD, attachments });

    // Update conversation metadata for the sidebar
    if (sessionId) {
      await memory.saveConversationMeta(userId, sessionId, {
        lastMessage: reply.length > 60 ? reply.substring(0, 60) + '...' : reply,
        updatedAt: Date.now()
      });
    }

    return NextResponse.json({ reply, agentName: 'SuperClaw' });
  } catch (error) {
    console.error(UI_STRINGS.API_CHAT_ERROR, error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * Updates conversation metadata (like title)
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId, title } = await req.json();
    const userId = 'dashboard-user';
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();

    if (!sessionId || !title) {
      return NextResponse.json({ error: 'Missing sessionId or title' }, { status: 400 });
    }

    await memory.saveConversationMeta(userId, sessionId, { title, updatedAt: Date.now() });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update session:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}

/**
 * Deletes one or all conversation sessions
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    const userId = 'dashboard-user';
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    if (sessionId === 'all') {
      const sessions = await memory.listConversations(userId);
      await Promise.all(sessions.map(s => memory.deleteConversation(userId, s.sessionId)));
      revalidatePath('/');
      return NextResponse.json({ success: true, count: sessions.length });
    }

    await memory.deleteConversation(userId, sessionId);
    revalidatePath('/');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete session:', error);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}

/**
 * Retrieves chat sessions or history
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = 'dashboard-user';
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    const { DynamoMemory } = await import('@claw/core/lib/memory');
    const memory = new DynamoMemory();

    if (sessionId) {
      // Return history for a specific session
      const history = await memory.getHistory(`CONV#${userId}#${sessionId}`);
      return NextResponse.json({ history });
    } else {
      // Return list of sessions
      const sessions = await memory.listConversations(userId);
      console.log(`[Chat API] Returning ${sessions.length} sessions to frontend`);
      return NextResponse.json({ sessions });
    }
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}
