import { TraceSource } from '../types/index';
import { normalizeBaseUserId } from '../utils/normalize';

/**
 * Initializes the ClawTracer for an agent process.
 */
export async function initializeTracer(
  userId: string,
  source: TraceSource | string,
  options: {
    incomingTraceId?: string;
    incomingNodeId?: string;
    incomingParentId?: string;
    agentId?: string;
    isContinuation?: boolean;
    userText?: string;
    sessionId?: string;
    hasAttachments?: boolean;
    scope?: {
      workspaceId?: string;
      orgId?: string;
      teamId?: string;
      staffId?: string;
    };
  } = {}
) {
  const {
    incomingTraceId,
    incomingNodeId,
    incomingParentId,
    agentId,
    isContinuation = false,
    userText,
    sessionId,
    hasAttachments = false,
    scope,
  } = options;
  const { ClawTracer } = await import('../tracer');
  const baseUserId = normalizeBaseUserId(userId);

  const tracer = new ClawTracer(
    baseUserId,
    source,
    incomingTraceId,
    incomingNodeId,
    incomingParentId,
    agentId,
    scope
  );

  const traceId = tracer.getTraceId();

  if (!isContinuation) {
    await tracer.startTrace({
      userText: userText ?? '',
      sessionId,
      agentId,
      hasAttachments,
    });
  }

  return { tracer, traceId, baseUserId };
}
