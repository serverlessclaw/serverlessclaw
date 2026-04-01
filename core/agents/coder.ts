import { AgentType, GapStatus, AgentEvent, AgentPayload } from '../lib/types/agent';
import { ReasoningProfile } from '../lib/types/llm';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  detectFailure,
  isTaskPaused,
  extractBaseUserId,
  validatePayload,
  buildProcessOptions,
  initAgent,
} from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';
import { parseStructuredResponse } from '../lib/utils/agent-helpers/llm-utils';
import { TRACE_TYPES } from '../lib/constants';

/**
 * Coder Agent handler. Processes coding tasks, implements changes,
 * and optionally triggers deployments or notifies QA.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the agent's response string, or undefined on error.
 */
export const handler = async (event: AgentEvent, context: Context): Promise<string | undefined> => {
  logger.info('Coder Agent received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<AgentPayload>(event);
  const { userId, task, metadata, traceId, sessionId, isContinuation, initiatorId, depth } =
    payload;
  const gapIds = metadata?.gapIds as string[] | undefined;

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // 1. Initialize agent (config + context loaded in parallel)
  const { config, memory, agent } = await initAgent(AgentType.CODER);

  // 2. Transition gaps to PROGRESS
  if (gapIds && gapIds.length > 0) {
    logger.info(`Picking up task. Marking ${gapIds.length} gaps as PROGRESS.`);
    for (const gapId of gapIds) {
      await memory.updateGapStatus(gapId, GapStatus.PROGRESS);
    }
  }

  // 3. Process the task
  const { responseText: rawResponse, attachments: resultAttachments } = await agent.process(
    userId,
    task || '',
    buildProcessOptions({
      profile: ReasoningProfile.THINKING,
      isIsolated: true,
      context,
      isContinuation,
      initiatorId,
      depth,
      traceId,
      sessionId,
      communicationMode: 'json',
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'coder_result',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              failing_test_written: { type: 'boolean' },
              test_file_path: { type: 'string' },
              test_execution_result: { type: 'string' },
              implementation_code: { type: 'string' },
              status: { type: 'string', enum: ['SUCCESS', 'FAILED'] },
              response: { type: 'string' },
              buildId: { type: 'string' },
              sessionId: { type: 'string' },
            },
            required: [
              'failing_test_written',
              'test_file_path',
              'test_execution_result',
              'implementation_code',
              'status',
              'response',
            ],
            additionalProperties: false,
          },
        },
      },
    })
  );

  logger.info('Coder Agent Raw Response:', rawResponse);

  let status = 'SUCCESS';
  let responseText = rawResponse;
  let buildId: string | undefined = undefined;

  try {
    const parsed = parseStructuredResponse<{
      status: string;
      response: string;
      buildId?: string;
      failing_test_written?: boolean;
      test_file_path?: string;
      test_execution_result?: string;
    }>(rawResponse);
    status = parsed.status || 'SUCCESS';
    responseText = parsed.response || rawResponse;
    buildId = parsed.buildId;

    // Enrich response with TDD evidence if provided
    if (parsed.failing_test_written && parsed.test_file_path) {
      responseText += `\n\n**TDD Verification:**\n- Test File: \`${parsed.test_file_path}\`\n- Execution Result: \`${parsed.test_execution_result || 'Unknown'}\``;
    }

    logger.info(
      `Parsed Coder Result. Status: ${status}, BuildId: ${buildId}, TDD: ${parsed.failing_test_written}`
    );
  } catch (e) {
    logger.warn('Failed to parse Coder structured response, falling back to raw text.', e);
  }

  // 3. Notify user directly if not a silent internal task
  if (!isTaskPaused(rawResponse)) {
    await sendOutboundMessage(
      AgentType.CODER,
      userId,
      responseText,
      [baseUserId],
      sessionId,
      config.name,
      resultAttachments
    );
  }

  const isFailure = status === 'FAILED' || detectFailure(responseText);

  // 4. Trace gap transitions (Build Monitor handles the rest via atomic mapping in tools)
  if (!isFailure && status === 'SUCCESS') {
    const { addTraceStep } = await import('../lib/utils/trace-helper');
    await addTraceStep(traceId, 'root', {
      type: TRACE_TYPES.CODE_WRITTEN,
      content: {
        status,
        buildId,
        responseSnippet: responseText.substring(0, 500),
      },
      metadata: { event: 'code_written', buildId },
    });

    if (!buildId && gapIds?.length) {
      logger.info(`Task successful without deployment. Marking ${gapIds.length} gaps as DEPLOYED.`);
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DEPLOYED);
      }
    }
  }

  // 5. Notify Resumption Loop (Universal Coordination)
  if (!isTaskPaused(rawResponse)) {
    await emitTaskEvent({
      source: AgentType.CODER,
      agentId: AgentType.CODER,
      userId: baseUserId,
      task: task || '',
      response: responseText,
      attachments: resultAttachments,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });
  }

  return responseText;
};
