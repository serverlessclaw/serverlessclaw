import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { UI_STRINGS, AUTH } from '@/lib/constants';
import { HTTP_STATUS, AGENT_ERRORS } from '@claw/core/lib/constants';
import { revalidatePath } from 'next/cache';

function getUserId(req: NextRequest): string {
  if (!req.cookies) {
    return 'dashboard-user';
  }
  const sessionCookie = req.cookies.get(AUTH.SESSION_USER_ID);
  return sessionCookie?.value || 'dashboard-user';
}

/**
 * Handles chat messages from the dashboard UI using the Manager agent
 *
 * @param req - The incoming POST request with chat message body.
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
    } = await req.json();
    const isStream = req.nextUrl.searchParams.get('stream') === 'true';
    const userId = getUserId(req);

    // Use a unique ID for the specific session history
    const storageId = sessionId ? `CONV#${userId}#${sessionId}` : userId;

    if (!text && (!attachments || attachments.length === 0)) {
      return NextResponse.json(
        { error: UI_STRINGS.MISSING_MESSAGE },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }

    console.log(
      `[Chat API] POST request - text: ${text?.substring(0, 20)}..., sessionId: ${sessionId}, attachments: ${attachments?.length ?? 0}, stream: ${isStream}`
    );

    const { DynamoMemory, CachedMemory } = await import('@claw/core/lib/memory');
    const { ProviderManager } = await import('@claw/core/lib/providers/index');
    const { getAgentTools } = await import('@claw/core/tools/index');
    const { Agent } = await import('@claw/core/lib/agent');
    const { SUPERCLAW_SYSTEM_PROMPT } = await import('@claw/core/agents/superclaw');
    const { TraceSource, AgentType } = await import('@claw/core/lib/types/index');
    const { AgentRegistry } = await import('@claw/core/lib/registry');

    const memory = new CachedMemory(new DynamoMemory());
    const provider = new ProviderManager();
    const config = await AgentRegistry.getAgentConfig(AgentType.SUPERCLAW);
    const agentTools = await getAgentTools(AgentType.SUPERCLAW);
    const agent = new Agent(
      memory,
      provider,
      agentTools,
      config?.systemPrompt ?? SUPERCLAW_SYSTEM_PROMPT,
      config ?? undefined
    );

    if (isStream) {
      // In a serverless environment like AWS Lambda, we can't easily "background" a task
      // without keeping the response open or using a separate trigger.
      // However, SST/Next.js on Lambda often supports Response Streaming.
      // For this implementation, we consume the stream and the chunks are emitted
      // directly to IoT Core in the background via the realtime utility.

      // We start the stream but don't await its full completion before returning to the UI
      // IF the platform supports it. On standard Lambda, we MUST await or the process dies.
      // But we can return the initial "accepted" response and let chunks flow via IoT.

      const streamResult = await (async () => {
        const stream = agent.stream(storageId, text ?? '', {
          sessionId,
          source: TraceSource.DASHBOARD,
          attachments,
          approvedToolCalls,
          traceId: clientTraceId || undefined,
          pageContext,
        });
        let finalResponse = '';
        let finalThought = '';
        let streamToolCalls: unknown[] | undefined;
        let fallbackTraceId: string | undefined;
        for await (const chunk of stream) {
          if (chunk.content) finalResponse += chunk.content;
          if (chunk.thought) finalThought += chunk.thought;
          if (chunk.tool_calls) streamToolCalls = chunk.tool_calls;
        }

        // Some providers may complete with no visible content. Recover by running
        // the non-stream path once so UI always receives an assistant payload.
        if (!finalResponse.trim() && (!streamToolCalls || streamToolCalls.length === 0)) {
          const fallback = await agent.process(storageId, text ?? '', {
            sessionId,
            source: TraceSource.DASHBOARD,
            attachments,
            approvedToolCalls,
            pageContext,
          });
          finalResponse = fallback.responseText ?? '';
          if (!finalThought && fallback.thought) {
            finalThought = fallback.thought;
          }
          if ((!streamToolCalls || streamToolCalls.length === 0) && fallback.tool_calls) {
            streamToolCalls = fallback.tool_calls;
          }
          fallbackTraceId = fallback.traceId;
        }

        if (sessionId) {
          await memory.saveConversationMeta(userId, sessionId, {
            lastMessage:
              finalResponse.length > 60 ? finalResponse.substring(0, 60) + '...' : finalResponse,
            updatedAt: Date.now(),
          });
        }

        return {
          reply: finalResponse,
          thought: finalThought,
          agentName: 'SuperClaw',
          tool_calls: streamToolCalls,
          messageId: clientTraceId || fallbackTraceId,
        };
      })();

      return NextResponse.json(streamResult);
    }

    const {
      responseText,
      thought: resultThought,
      attachments: resultAttachments,
      tool_calls: resultToolCalls,
      traceId,
    } = await agent.process(storageId, text ?? '', {
      sessionId,
      source: TraceSource.DASHBOARD,
      attachments,
      approvedToolCalls,
      pageContext,
    });

    // Update conversation metadata for the sidebar
    if (sessionId) {
      await memory.saveConversationMeta(userId, sessionId, {
        lastMessage:
          responseText.length > 60 ? responseText.substring(0, 60) + '...' : responseText,
        updatedAt: Date.now(),
      });
    }

    return NextResponse.json({
      reply: responseText,
      thought: resultThought,
      agentName: 'SuperClaw',
      attachments: resultAttachments,
      tool_calls: resultToolCalls,
      messageId: traceId,
    });
  } catch (error) {
    console.error(UI_STRINGS.API_CHAT_ERROR, error);

    // Persist error to history if we have sessionId
    try {
        const { sessionId, traceId: clientTraceId } = await req.clone().json();
        if (sessionId) {
          const { DynamoMemory, CachedMemory } = await import('@claw/core/lib/memory');
          const { MessageRole } = await import('@claw/core/lib/types');
          const memory = new CachedMemory(new DynamoMemory());
          const userId = getUserId(req);
          const storageId = `CONV#${userId}#${sessionId}`;
          await memory.addMessage(storageId, {
            role: MessageRole.ASSISTANT,
            content: AGENT_ERRORS.PROCESS_FAILURE,
            traceId: clientTraceId || `error-${Date.now()}`,
            messageId: `err-${Math.random().toString(36).substring(2, 9)}`,
          });
        }
    } catch (e) {
      console.error('Failed to persist error message:', e);
    }

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
    const { DynamoMemory, CachedMemory } = await import('@claw/core/lib/memory');
    const memory = new CachedMemory(new DynamoMemory());

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
    const userId = getUserId(req);
    const { DynamoMemory, CachedMemory } = await import('@claw/core/lib/memory');
    const memory = new CachedMemory(new DynamoMemory());

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
    console.error('Failed to delete session:', error);
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
    const { DynamoMemory, CachedMemory } = await import('@claw/core/lib/memory');
    const memory = new CachedMemory(new DynamoMemory());

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
  } catch {
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}
