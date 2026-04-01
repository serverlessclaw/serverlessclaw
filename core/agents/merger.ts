import { AgentType, AgentEvent, AgentPayload } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { extractPayload, validatePayload, initAgent } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

/**
 * Structural Merger Agent.
 * Specializes in AST-aware code reconciliation for parallel evolution tasks.
 * Verifies that concurrent patches from multiple Coders don't conflict semantically.
 *
 * @param event - The EventBridge event.
 * @param context - The AWS Lambda context.
 */
export const handler = async (event: AgentEvent, context: Context): Promise<string | undefined> => {
  logger.info('Merger Agent received task:', JSON.stringify(event, null, 2));

  const payload = extractPayload<AgentPayload>(event);
  const { userId, task, metadata, traceId, sessionId, initiatorId, depth } = payload;
  const patches = metadata?.patches as { coderId: string; patch: string }[];

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  // 1. Initialize agent
  const { agent } = await initAgent(AgentType.MERGER);

  // 2. Process the merging task
  // The prompt should instruct the agent to use 'code-index-mcp' or 'rg_search'
  // to investigate the trunk and ensure the patches are compatible.
  const { responseText: rawResponse, attachments: resultAttachments } = await agent.process(
    userId,
    `Merge the following patches and check for semantic conflicts:\n${JSON.stringify(patches, null, 2)}\n\nGoal: ${task}`,
    {
      context,
      traceId,
      sessionId,
      initiatorId,
      depth,
      communicationMode: 'json',
    }
  );

  logger.info('Merger Agent Process Complete.');

  // 3. Emit Result
  await emitTaskEvent({
    source: AgentType.MERGER,
    agentId: AgentType.MERGER,
    userId,
    task: task || '',
    response: rawResponse,
    attachments: resultAttachments,
    traceId,
    sessionId,
    initiatorId,
    depth,
  });

  return rawResponse;
};
