import { ReasoningProfile, ResponseFormat } from '../lib/types/llm';
import { AGENT_TYPES, TraceSource } from '../lib/types/agent';
import { BaseMemoryProvider } from '../lib/memory/base';
import { LIMITS } from '../lib/constants';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  detectFailure,
  isTaskPaused,
  loadAgentConfig,
  extractBaseUserId,
  getAgentContext,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { buildReflectionPrompt, getGapContext } from './cognition-reflector/prompts';
import type { ReflectorEvent } from './cognition-reflector/types';
import { ReflectionReportSchema, type ReflectionReport } from './cognition-reflector/schema';
import { runSystemAudit } from './cognition-reflector/audit-protocol';
import { processReflectionReport } from './cognition-reflector/processor';

/**
 * Reflector Agent handler. Analyzes conversations to extract facts, lessons, and capability gaps.
 *
 * @param event - The event containing userId and the conversation history.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the reflection report string, or undefined on error.
 */
export const handler = async (
  event: ReflectorEvent,
  _context: Context
): Promise<string | undefined> => {
  logger.info('Reflector Agent received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<ReflectorEvent>(event);
  const { userId, conversation, traceId, sessionId, task, initiatorId, depth, workspaceId } =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload.detail || (payload as any); // Double safety for direct or wrapped event

  const scope = workspaceId ? { workspaceId } : undefined;

  if (!userId || !conversation) {
    logger.warn('Reflector received incomplete payload, skipping audit.', {
      hasUserId: !!userId,
      hasConversation: !!conversation,
      source: event.source,
    });
    return;
  }

  // 1. Fetch Execution Trace
  let traceContext = '';
  if (traceId) {
    try {
      const { ClawTracer } = await import('../lib/tracer');
      const traceNodes = await ClawTracer.getTrace(traceId);
      const trace = traceNodes[0];

      if (trace && trace.source !== TraceSource.SYSTEM && trace.steps) {
        let fullTrace = trace.steps
          .map((s) => `[${s.type.toUpperCase()}] ${JSON.stringify(s.content)}`)
          .join('\n');

        if (fullTrace.length > LIMITS.TRACE_TRUNCATE_LENGTH) {
          fullTrace =
            fullTrace.substring(0, LIMITS.TRACE_TRUNCATE_LENGTH) + '\n... [TRACE_TRUNCATED]';
        }

        traceContext = `\nEXECUTION TRACE (Mechanical Steps):\n${fullTrace}\n`;
      } else if (trace?.source === TraceSource.SYSTEM) {
        logger.info('Reflector skipping system-initiated trace audit.');
      }
    } catch (e) {
      logger.warn('Failed to fetch trace for Reflector:', e);
    }
  }

  // Reflector Agent is a specialized Agent instance
  const config = await loadAgentConfig(AGENT_TYPES.COGNITION_REFLECTOR);
  const { memory, provider: providerManager } = await getAgentContext();

  // Check if this is a system audit trigger
  const isAuditTrigger = task && task.toLowerCase().includes('system audit');
  if (isAuditTrigger) {
    logger.info('[Reflector] Running system audit per trigger');
    const auditReport = await runSystemAudit(
      memory as unknown as import('./cognition-reflector/audit-protocol').MemoryForAudit,
      'MANUAL_TRIGGER',
      { userId, traceId, sessionId }
    );
    return JSON.stringify(auditReport);
  }

  const agentTools = await (await import('../tools/index')).getAgentTools('cognition-reflector');
  const { Agent } = await import('../lib/agent');
  const reflector = new Agent(memory, providerManager, agentTools, config);

  // 2. Handle simple direct tasks (e.g. greetings)
  if (task) {
    const taskLower = task.toLowerCase();
    if (taskLower.includes('greet') || taskLower.includes('hi') || taskLower.includes('hello')) {
      const startTime = Date.now();
      const { responseText } = await reflector.process(userId, task, {
        profile: ReasoningProfile.FAST,
        isIsolated: true,
        traceId,
        sessionId,
        source: TraceSource.SYSTEM,
      });
      const { updateReputation } = await import('../lib/memory/reputation-operations');
      await updateReputation(
        memory as unknown as BaseMemoryProvider,
        config.id,
        true,
        Date.now() - startTime,
        { scope }
      );
      return responseText;
    }
  }

  const baseUserId = extractBaseUserId(userId);
  const failurePatterns = await memory.getFailurePatterns(5, scope);

  // Get gap context
  const { deployedGaps, activeGaps } = await getGapContext(memory);

  const reflectionPrompt = await buildReflectionPrompt(
    memory,
    userId,
    conversation,
    traceContext,
    deployedGaps,
    activeGaps,
    failurePatterns
  );

  const { responseText: response, attachments: resultAttachments } = await reflector.process(
    userId,
    reflectionPrompt,
    {
      profile: ReasoningProfile.STANDARD,
      isIsolated: true,
      traceId,
      sessionId,
      source: TraceSource.SYSTEM,
      communicationMode: 'json',
      responseFormat: ReflectionReportSchema as ResponseFormat,
    }
  );

  const isFailure = detectFailure(response);

  if (response && !isFailure) {
    try {
      const parsed = parseStructuredResponse<ReflectionReport>(response);
      await processReflectionReport(parsed, memory, userId, baseUserId, sessionId, scope);
    } catch (e) {
      logger.error('Failed to parse Reflector JSON response:', e);
    }
  }

  // Universal Coordination: Notify Initiator (if any)
  if (!isTaskPaused(response)) {
    await emitTaskEvent({
      source: AGENT_TYPES.COGNITION_REFLECTOR,
      agentId: AGENT_TYPES.COGNITION_REFLECTOR,
      userId,
      task: task || 'Session Reflection',
      response: response || 'No insights extracted.',
      attachments: resultAttachments,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });
  }

  return response;
};
