import { AgentType, GapStatus, AgentEvent, AgentPayload, Attachment } from '../lib/types/agent';
import { ReasoningProfile, Message } from '../lib/types/llm';
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
  const { userId, task, metadata, traceId, sessionId, isContinuation, initiatorId, depth, taskId } =
    payload;
  const gapIds = metadata?.gapIds as string[] | undefined;
  const applyStagedChanges = metadata?.applyStagedChanges as boolean | undefined;

  if (!validatePayload({ userId, task: task || '' }, ['userId', 'task'])) {
    return;
  }

  const baseUserId = extractBaseUserId(userId);

  // 1. Prepare writable /tmp workspace
  const { createWorkspace, cleanupWorkspace } = await import('../lib/utils/workspace-manager');
  const workspacePath = await createWorkspace(
    traceId ?? `unknown-${Date.now()}`,
    applyStagedChanges
  );
  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  logger.info(`[Coder] Working in workspace: ${workspacePath}`);

  // 2. Initialize agent (config + context loaded in parallel)
  const { config, memory, agent } = await initAgent(AgentType.CODER);

  const isAggregation = task?.includes('[AGGREGATED_RESULTS]');

  // Swarm Self-Organization: Decompose high-level goals into parallel sub-tasks
  const { handleSwarmDecomposition } = await import('../lib/agent/swarm-orchestrator');
  const { wasDecomposed, response: swarmResponse } = await handleSwarmDecomposition(
    task || '',
    payload,
    {
      traceId,
      sessionId,
      depth,
      isAggregation,
      sourceAgentId: AgentType.CODER,
      lockedGapIds: gapIds || [],
      barrierTimeoutMs: 30 * 60 * 1000, // 30 mins for complex coding tasks
      aggregationType: 'merge_patches',
      aggregationPrompt: `I have completed the parallel implementation for: "${task?.substring(0, 200)}...". 
                         Please merge the resulting patches and synthesize the final outcome.
                         Prepend the response with [AGGREGATED_RESULTS].`,
      minLength: 400,
    }
  );

  if (wasDecomposed) {
    logger.info(`[CODER] Development Goal successfully decomposed into swarm tasks.`);
    process.chdir(originalCwd);
    await cleanupWorkspace(workspacePath);
    return swarmResponse || `[DELEGATED] Task decomposed into parallel sub-tasks for execution.`;
  }

  // 3. Process the task via unified lifecycle (Session Locking + Heartbeat)
  const { processEventWithAgent } = await import('../handlers/events/shared');
  
  let result: { responseText: string; attachments: Message['attachments'] };
  try {
    result = await processEventWithAgent(userId, AgentType.CODER, task || '', {
      context,
      traceId,
      taskId: taskId ?? traceId,
      sessionId,
      depth,
      initiatorId,
      isContinuation,
      attachments: metadata?.attachments as Attachment[],
      handlerTitle: 'Coder Agent',
      outboundHandlerName: AgentType.CODER,
      formatResponse: (text) => text, // Coder handles its own formatting in the prompt
    });
  } catch (err) {
    logger.error('Unexpected error in Coder Agent processing:', err);
    result = { 
      responseText: `SYSTEM_ERROR: ${err instanceof Error ? err.message : String(err)}`,
      attachments: []
    };
  } finally {
    process.chdir(originalCwd);
    await cleanupWorkspace(workspacePath);

    // Release any specific gap locks if they were acquired during tool execution
    // Note: processEventWithAgent handles the session lock, but not individual gap locks
    // that might have been acquired by tools.
  }

  const responseText = result.responseText;
  const isFailure = detectFailure(responseText);

  // 4. Trace gap transitions if successful
  if (!isFailure && !isTaskPaused(responseText)) {
    const { addTraceStep } = await import('../lib/utils/trace-helper');
    await addTraceStep(traceId || 'unknown', 'root', {
      type: TRACE_TYPES.CODE_WRITTEN,
      content: {
        status: 'SUCCESS',
        responseSnippet: responseText.substring(0, 500),
      },
      metadata: { event: 'code_written' },
    });
  }

  return responseText;
};
