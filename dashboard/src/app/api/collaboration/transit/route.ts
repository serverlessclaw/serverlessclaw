import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { HTTP_STATUS } from '@claw/core/lib/constants';
import { AgentType } from '@claw/core/lib/types/index';
import { DynamoMemory, CachedMemory } from '@claw/core/lib/memory';
import { AgentRegistry } from '@claw/core/lib/registry';
import { logger } from '@claw/core/lib/logger';
import { AUTH } from '@/lib/constants';

const memory = new CachedMemory(new DynamoMemory());

function getUserId(req: NextRequest): string {
  if (!req.cookies) return 'dashboard-user';
  const sessionCookie = req.cookies.get(AUTH.SESSION_USER_ID);
  return sessionCookie?.value || 'dashboard-user';
}

/**
 * POST /api/collaboration/transit
 * 
 * Transits a 1:1 trace session into a formal Multi-Agent Collaboration session.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { sessionId, invitedAgentIds, name } = await req.json();
    const userId = getUserId(req);

    if (!sessionId) {
      return NextResponse.json({ error: 'Missing sessionId' }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    logger.info(`[Collab Transit] Initiating transit for session: ${sessionId}, inviting: ${invitedAgentIds}`);

    // Principle 14: Verify all invited agents are enabled
    const allInvited = [...(invitedAgentIds || []), AgentType.FACILITATOR];
    for (const agentId of allInvited) {
      const cfg = await AgentRegistry.getAgentConfig(agentId);
      if (!cfg || cfg.enabled !== true) {
        return NextResponse.json(
          { error: `Cannot invite agent ${agentId} - node is disabled or missing.` },
          { status: HTTP_STATUS.FORBIDDEN }
        );
      }
    }

    // 1. Create and Seed the collaboration (Atomic in core)
    const collaboration = await memory.transitToCollaboration(
      userId,
      '', // default workspace if none
      sessionId,
      invitedAgentIds || [],
      name
    );

    return NextResponse.json({ 
      success: true, 
      collaborationId: collaboration.collaborationId,
      name: collaboration.name
    });

  } catch (error) {
    logger.error('[Collab Transit] Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
    );
  }
}
