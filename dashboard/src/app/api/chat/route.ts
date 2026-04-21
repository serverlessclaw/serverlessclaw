import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { UI_STRINGS, AUTH } from '@/lib/constants';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { revalidatePath } from 'next/cache';

// Re-usable instances for optimization
import { DynamoMemory, CachedMemory } from '@claw/core/lib/memory';
import { ProviderManager } from '@claw/core/lib/providers/index';
import { getAgentTools } from '@claw/core/tools/index';
import { Agent } from '@claw/core/lib/agent';
import { SUPERCLAW_SYSTEM_PROMPT } from '@claw/core/agents/superclaw';
import { TraceSource, AgentType, IAgentConfig } from '@claw/core/lib/types/index';
import { AgentRegistry } from '@claw/core/lib/registry';
import { logger } from '@claw/core/lib/logger';

// Singleton memory and provider to leverage in-memory LRU cache
const memory = new CachedMemory(new DynamoMemory());
const provider = new ProviderManager();

function getUserId(req: NextRequest): string {
  if (!req.cookies) {
    return 'dashboard-user';
  }
  const sessionCookie = req.cookies.get(AUTH.SESSION_USER_ID);
  return sessionCookie?.value || 'dashboard-user';
}

/**
 * Handles chat messages from the dashboard UI.
 * Simplification: Uses MQTT (SST Realtime) for token streaming.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const {
      text,
      sessionId,
      attachments,
      approvedToolCalls,
      traceId: clientTraceId,
      pageContext,
      profile,
      agentId = AgentType.SUPERCLAW,
      collaborationId,
      isIsolated = false,
      source: incomingSource,
      overrideConfig,
    } = await req.json();

    const source = incomingSource || TraceSource.DASHBOARD;
    
    const userId = getUserId(req);
    const storageId = sessionId ? `CONV#${userId}#${sessionId}` : userId;

    if (!text && (!attachments || attachments.length === 0)) {
      return NextResponse.json(
        { error: UI_STRINGS.MISSING_MESSAGE },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    logger.info(`[Chat API] POST - userId: ${userId}, sessionId: ${sessionId}, traceId: ${clientTraceId}, agentId: ${agentId}, collabId: ${collaborationId}`);

    // If we're in a collaboration session, we might need special logic in the future.
    // For now, we route to the specific agent requested.
    
    const config = await AgentRegistry.getAgentConfig(agentId);
    const agentTools = await getAgentTools(agentId);
    
    if (!config) {
      return NextResponse.json(
        { error: `Agent ${agentId} not found in registry.` },
        { status: HTTP_STATUS.NOT_FOUND }
      );
    }

    // Principle 14 Check
    if (config.enabled !== true) {
      return NextResponse.json(
        { error: `Agent ${agentId} is currently disabled and cannot process requests.` },
        { status: HTTP_STATUS.FORBIDDEN }
      );
    }

    // Determine communication mode based on collaboration participants
    let communicationMode: 'text' | 'json' = 'text';
    if (collaborationId) {
      const collab = collaborationId ? await memory.getCollaboration(collaborationId as string) : null;
      if (collab) {
        const hasHuman = 
          collab.owner.type === 'human' || 
          collab.participants.some(p => p.type === 'human');
        
        communicationMode = hasHuman ? 'text' : 'json';
        logger.info(`[Chat API] Collaboration detected. hasHuman: ${hasHuman} -> mode: ${communicationMode}`);
      }
    }

    const agent = new Agent(
      memory,
      provider,
      agentTools,
      { 
        ...config, 
        ...(overrideConfig || {}),
        systemPrompt: overrideConfig?.systemPrompt ?? config?.systemPrompt ?? SUPERCLAW_SYSTEM_PROMPT
      } as IAgentConfig
    );

    // We use the streaming generator to trigger real-time MQTT emissions via AgentEmitter
    // while the request remains open. Chunks are automatically sent to the dashboard via IoT Core.
    const stream = agent.stream(storageId, text ?? '', {
      sessionId,
      source,
      isIsolated,
      attachments,
      approvedToolCalls,
      traceId: clientTraceId || undefined,
      pageContext,
      profile,
      communicationMode,
    });

    let finalResponse = '';
    let finalThought = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finalToolCalls: any[] = [];
    let finalMessageId = '';

    for await (const chunk of stream) {
      if (chunk.content) finalResponse += chunk.content;
      if (chunk.thought) finalThought += chunk.thought;
      if (chunk.tool_calls) finalToolCalls = chunk.tool_calls;
      if (chunk.messageId) finalMessageId = chunk.messageId;
    }

    logger.info(`[Chat API] Stream finished - sessionId: ${sessionId}, agent: ${agentId}, response length: ${finalResponse.length}`);

    // Update conversation metadata for the sidebar
    if (sessionId) {
      await memory.saveConversationMeta(userId, sessionId, {
        lastMessage:
          finalResponse.length > 60 ? finalResponse.substring(0, 60) + '...' : finalResponse,
        updatedAt: Date.now(),
        // Store the last agent used in this session if it's not superclaw
        metadata: agentId !== AgentType.SUPERCLAW ? { lastAgentId: agentId } : undefined,
      });
    }

    // Filter out synthetic thought markers ('…') that were only used to trigger the thinking indicator
    const meaningfulThought = (finalThought || '').trim();
    const thoughtToReturn = meaningfulThought.length > 1 ? meaningfulThought : '';

    return NextResponse.json({
      reply: (finalResponse || '').trim(),
      thought: thoughtToReturn,
      agentName: config.name || agentId,
      messageId: finalMessageId,
      tool_calls: finalToolCalls,
      sessionId: sessionId || undefined,
    });
  } catch (error) {
    logger.error(UI_STRINGS.API_CHAT_ERROR, error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}

/**
 * Updates conversation metadata (like title)
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId, title, isPinned } = await req.json();
    const userId = getUserId(req);

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    await memory.saveConversationMeta(userId, sessionId, {
      title,
      isPinned,
      updatedAt: Date.now(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to update session:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}

/**
 * Deletes one or all conversation sessions
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  try {
    const sessionId = req.nextUrl.searchParams.get('sessionId');
    const userId = getUserId(req);

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    }

    if (sessionId === 'all') {
      const sessions = await memory.listConversations(userId);
      await Promise.all(sessions.map((s) => memory.deleteConversation(userId, s.sessionId)));
      revalidatePath('/');
      return NextResponse.json({ success: true, count: sessions.length });
    }

    await memory.deleteConversation(userId, sessionId);
    revalidatePath('/');

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete session:', error);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }
}

/**
 * Retrieves chat sessions or history
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = getUserId(req);
    const sessionId = req.nextUrl.searchParams.get('sessionId');

    if (sessionId) {
      const history = await memory.getHistory(`CONV#${userId}#${sessionId}`);
      return NextResponse.json({ history });
    } else {
      const sessions = await memory.listConversations(userId);
      return NextResponse.json({ sessions });
    }
  } catch {
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}
