import { TraceSource } from '../types/index';
import { normalizeBaseUserId } from '../utils/normalize';

/**
 * Initializes the ClawTracer for an agent process.
 */
export async function initializeTracer(
  userId: string,
  source: TraceSource | string,
  incomingTraceId?: string,
  incomingNodeId?: string,
  incomingParentId?: string,
  agentId?: string,
  isContinuation: boolean = false,
  userText?: string,
  sessionId?: string,
  hasAttachments: boolean = false
) {
  const { ClawTracer } = await import('../tracer');
  const baseUserId = normalizeBaseUserId(userId);

  const tracer = new ClawTracer(
    baseUserId,
    source,
    incomingTraceId,
    incomingNodeId,
    incomingParentId,
    agentId
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
