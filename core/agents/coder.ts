import {
  AgentType,
  GapStatus,
  ReasoningProfile,
  AgentEvent,
  AgentPayload,
} from '../lib/types/index';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import {
  extractPayload,
  detectFailure,
  isTaskPaused,
  loadAgentConfig,
  createAgent,
  validatePayload,
  buildProcessOptions,
  emitTaskEvent,
  getAgentContext,
  parseStructuredResponse,
} from '../lib/utils/agent-helpers';

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

  // 1. Transition gaps to PROGRESS
  const { memory, provider } = await getAgentContext();
  if (gapIds && gapIds.length > 0) {
    logger.info(`Picking up task. Marking ${gapIds.length} gaps as PROGRESS.`);
    for (const gapId of gapIds) {
      await memory.updateGapStatus(gapId, GapStatus.PROGRESS);
    }
  }

  // 2. Process the task
  const config = await loadAgentConfig(AgentType.CODER);

  const agent = await createAgent('coder', config, memory, provider);
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
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'coder_result',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['SUCCESS', 'FAILED'] },
              response: { type: 'string' },
              buildId: { type: 'string' },
            },
            required: ['status', 'response'],
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
    }>(rawResponse);
    status = parsed.status || 'SUCCESS';
    responseText = parsed.response || rawResponse;
    buildId = parsed.buildId;
    logger.info(`Parsed Coder Result. Status: ${status}, BuildId: ${buildId}`);
  } catch (e) {
    logger.warn('Failed to parse Coder structured response, falling back to raw text.', e);
  }

  // 3. Notify user directly if not a silent internal task
  if (!isTaskPaused(rawResponse)) {
    await sendOutboundMessage(
      'coder.agent',
      userId,
      responseText,
      [userId],
      sessionId,
      config.name,
      resultAttachments
    );
  }

  const isFailure = status === 'FAILED' || detectFailure(responseText);

  // 4. Trace gap transitions (Build Monitor handles the rest via atomic mapping in tools)
  if (!isFailure && status === 'SUCCESS') {
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
      source: 'coder.agent',
      agentId: AgentType.CODER,
      userId,
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
