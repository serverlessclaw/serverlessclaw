import { AgentType, AgentEvent, AgentPayload } from '../lib/types/agent';
import { logger } from '../lib/logger';
import { AGENT_ERRORS } from '../lib/constants';
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

  // Fix: Handle results array from PARALLEL_TASK_COMPLETED dispatch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = (metadata?.results as any[]) ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failedPatches = (metadata?.failedPatches as any[]) ?? [];

  // Extract patches from either metadata.patches or the results array
  const patches = (metadata?.patches as { coderId: string; patch: string }[]) || [];

  if (patches.length === 0 && results.length > 0) {
    logger.info(`Extracting patches from ${results.length} parallel results.`);
    const { extractPatch } = await import('../handlers/events/merger-handler');
    for (const res of results) {
      const patch = res.patch || extractPatch(res.result);
      if (patch) {
        patches.push({
          coderId: res.agentId,
          patch: patch,
        });
      }
    }
  }

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  // 1. Initialize agent
  const { agent } = await initAgent(AgentType.MERGER);

  // 2. Guard: reject oversized patch payloads before sending to LLM context window
  const patchJson = JSON.stringify(patches, null, 2);
  const patchSizeBytes = Buffer.byteLength(patchJson, 'utf8');
  if (patchSizeBytes > MAX_PATCH_SIZE_BYTES) {
    const overSizeMsg = `FAILED: Patch payload too large for LLM reconciliation (${(patchSizeBytes / 1024).toFixed(1)} KB > ${(MAX_PATCH_SIZE_BYTES / 1024).toFixed(0)} KB).`;
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
  try {
    const conflictContext =
      failedPatches.length > 0
        ? `\n\nCONFLICTS DETECTED by procedural merger:\n${JSON.stringify(failedPatches, null, 2)}`
        : '';

    const processResult = await agent.process(
      userId,
      `Reconcile the following code patches and resolve semantic conflicts:\n${patchJson}${conflictContext}\n\nGoal: ${task}\n\nInstructions: Return the final merged code as a Git patch wrapped in PATCH_START and PATCH_END.`,
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

    // 4. Trigger deployment if a patch was generated
    if (processResult.responseText.includes('PATCH_START')) {
      try {
        const { triggerDeployment } = await import('../tools/infra/deployment');
        await triggerDeployment.execute({
          reason: `LLM-based structural reconciliation completed for ${traceId}`,
          userId,
          traceId: traceId ?? '',
          initiatorId: AgentType.MERGER,
          sessionId: sessionId ?? '',
          gapIds: [],
        });
        logger.info(`[Merger] Deployment triggered for LLM-merged result.`);
      } catch (deployError) {
        logger.error(`[Merger] Failed to trigger deployment:`, deployError);
      }
    }

    // Emit Result
    await emitTaskEvent({
      source: AgentType.MERGER,
      agentId: AgentType.MERGER,
      userId,
      task: task || '',
      response: processResult.responseText,
      attachments: processResult.attachments,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });

    return processResult.responseText;
  } catch (error) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    logger.error(`[MergerAgent] Critical failure: ${errorDetail}`, error);

    await emitTaskEvent({
      source: AgentType.MERGER,
      agentId: AgentType.MERGER,
      userId,
      task: task || '',
      response: AGENT_ERRORS.PROCESS_FAILURE,
      error: errorDetail,
      traceId,
      sessionId,
      initiatorId,
      depth,
    });

    return AGENT_ERRORS.PROCESS_FAILURE;
  }
};
