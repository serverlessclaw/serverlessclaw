import { AgentType, AgentEvent, AgentPayload } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { Context } from 'aws-lambda';
import { extractPayload, validatePayload, initAgent } from '../lib/utils/agent-helpers';
import { emitTaskEvent } from '../lib/utils/agent-helpers/event-emitter';

/** Maximum total patch payload size (100 KB) to prevent context window overflow. */
const MAX_PATCH_SIZE_BYTES = 100 * 1024;

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

  // 2. Guard: reject oversized patch payloads before sending to LLM context window
  const patchJson = JSON.stringify(patches, null, 2);
  const patchSizeBytes = Buffer.byteLength(patchJson, 'utf8');
  if (patchSizeBytes > MAX_PATCH_SIZE_BYTES) {
    const overSizeMsg = `FAILED: Patch payload too large for inline merge (${(patchSizeBytes / 1024).toFixed(1)} KB > ${(MAX_PATCH_SIZE_BYTES / 1024).toFixed(0)} KB). Retry with smaller sub-task batches or store patches in S3.`;
    logger.error(`[Merger] ${overSizeMsg}`);
    await emitTaskEvent({
      source: AgentType.MERGER,
      agentId: AgentType.MERGER,
      userId,
      task: task || '',
      response: overSizeMsg,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });
    return overSizeMsg;
  }

  // 3. Process the merging task
  // The prompt should instruct the agent to use 'code-index-mcp' or 'rg_search'
  // to investigate the trunk and ensure the patches are compatible.
  const { responseText: rawResponse, attachments: resultAttachments } = await agent.process(
    userId,
    `Merge the following patches and check for semantic conflicts:\n${patchJson}\n\nGoal: ${task}`,
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
