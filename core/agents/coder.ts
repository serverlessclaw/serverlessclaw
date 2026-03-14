import { AgentType, GapStatus, ReasoningProfile } from '../lib/types/index';
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
} from '../lib/utils/agent-helpers';

interface CoderPayload {
  userId: string;
  task: string;
  metadata?: { gapIds?: string[] };
  traceId?: string;
  sessionId?: string;
  isContinuation?: boolean;
  initiatorId?: string;
  depth?: number;
}

interface CoderEvent {
  detail?: CoderPayload;
  source?: string;
}

/**
 * Coder Agent handler. Processes coding tasks, implements changes,
 * and optionally triggers deployments or notifies QA.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 * @returns A promise that resolves to the agent's response string, or undefined on error.
 */
export const handler = async (event: CoderEvent, context: Context): Promise<string | undefined> => {
  logger.info('Coder Agent received task:', JSON.stringify(event, null, 2));

  // EventBridge wraps the payload in 'detail'
  const payload = extractPayload<CoderPayload>(event);
  const { userId, task, metadata, traceId, sessionId, isContinuation, initiatorId, depth } =
    payload;

  if (!validatePayload({ userId, task }, ['userId', 'task'])) {
    return;
  }

  // 1. Transition gaps to PROGRESS
  const { memory, provider } = await getAgentContext();
  if (metadata?.gapIds && metadata.gapIds.length > 0) {
    logger.info(`Picking up task. Marking ${metadata.gapIds.length} gaps as PROGRESS.`);
    for (const gapId of metadata.gapIds) {
      await memory.updateGapStatus(gapId, GapStatus.PROGRESS);
    }
  }

  // 2. Process the task
  const config = await loadAgentConfig(AgentType.CODER);

  const agent = await createAgent('coder', config, memory, provider);
  const { responseText: rawResponse, attachments: resultAttachments } = await agent.process(
    userId,
    task,
    buildProcessOptions({
      profile: ReasoningProfile.THINKING,
      isIsolated: true,
      context,
      isContinuation,
      initiatorId,
      depth,
      traceId,
      sessionId,
    })
  );

  logger.info('Coder Agent Raw Response:', rawResponse);

  let status = 'SUCCESS';
  let responseText = rawResponse;
  let buildId: string | undefined = undefined;

  try {
    const jsonContent = rawResponse.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonContent);
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
    if (!buildId && metadata?.gapIds?.length) {
      logger.info(
        `Task successful without deployment. Marking ${metadata.gapIds.length} gaps as DEPLOYED.`
      );
      for (const gapId of metadata.gapIds) {
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
      task,
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
