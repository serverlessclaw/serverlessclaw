import { AgentType, GapStatus, AgentEvent, AgentPayload } from '../lib/types/agent';
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
import { TRACE_TYPES, SWARM } from '../lib/constants';

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

  // 1. Prepare writable /tmp workspace
  const { createWorkspace, cleanupWorkspace } = await import('../lib/utils/workspace-manager');
  const workspacePath = await createWorkspace(traceId ?? `unknown-${Date.now()}`);
  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  logger.info(`[Coder] Working in workspace: ${workspacePath}`);

  // 2. Initialize agent (config + context loaded in parallel)
  const { config, memory, agent } = await initAgent(AgentType.CODER);

  const isAggregation = task?.includes('[AGGREGATED_RESULTS]');

  // Swarm Self-Organization: Decompose high-level goals into parallel sub-tasks
  if (!isAggregation && (depth ?? 0) < SWARM.MAX_RECURSIVE_DEPTH && task) {
    const { decomposePlan } = await import('../lib/agent/decomposer');
    const decomposed = decomposePlan(task, traceId || `plan-${Date.now()}`, gapIds || [], {
      defaultAgentId: AgentType.CODER,
      maxSubTasks: SWARM.DEFAULT_MAX_SUB_TASKS,
      minLength: 400,
    });

    if (decomposed.wasDecomposed && decomposed.subTasks.length > 1) {
      logger.info(
        `[CODER] Development Goal detected. Decomposing into ${decomposed.subTasks.length} parallel sub-tasks.`
      );

      const { emitTypedEvent } = await import('../lib/utils/typed-emit');
      const { EventType } = await import('../lib/types/agent');

      const subTaskEvents = decomposed.subTasks.map((sub) => ({
        taskId: sub.subTaskId,
        agentId: sub.agentId,
        task: sub.task,
        metadata: {
          ...metadata,
          traceId: traceId ?? sub.planId,
          gapIds: sub.gapIds,
          subTaskId: sub.subTaskId,
          planId: sub.planId,
        },
      }));

      try {
        await emitTypedEvent(AgentType.CODER, EventType.PARALLEL_TASK_DISPATCH, {
          userId: baseUserId,
          tasks: subTaskEvents,
          barrierTimeoutMs: 30 * 60 * 1000, // 30 mins
          aggregationType: 'merge_patches',
          aggregationPrompt: `I have completed the parallel implementation for: "${task.substring(0, 200)}...". 
                             Please merge the resulting patches and synthesize the final outcome.
                             Prepend the response with [AGGREGATED_RESULTS].`,
          traceId,
          initiatorId: AgentType.CODER,
          depth: (depth ?? 0) + 1,
          sessionId,
        });
      } catch (dispatchError) {
        logger.error(`[CODER] Failed to dispatch parallel tasks:`, dispatchError);
        process.chdir(originalCwd);
        await cleanupWorkspace(workspacePath);
        return `[FAILED] Parallel dispatch failed: ${dispatchError instanceof Error ? dispatchError.message : String(dispatchError)}`;
      }

      process.chdir(originalCwd);
      await cleanupWorkspace(workspacePath);
      return `[DELEGATED] Task decomposed into ${decomposed.subTasks.length} parallel sub-tasks for execution.`;
    }
  }

  // 3. Process the task
  let status: string;
  let responseText: string;
  let buildId: string | undefined = undefined;
  let patchContent: string | undefined = undefined;
  const resultAttachments: NonNullable<Message['attachments']> = [];

  // Initialize defaults for safety in catch/finally before heavy lifting
  status = 'FAILED';
  responseText = 'SYSTEM_ERROR: Processing failed before response generation.';
  logger.info(`[Coder] Starting process. Fallback: ${status}, Response: ${responseText}`);

  // Track locked gap IDs for cleanup in finally block
  const lockedGapIds: string[] = [];

  try {
    // 3b. Acquire locks and transition gaps to PROGRESS (inside try so finally can reset on init failure)
    if (gapIds && gapIds.length > 0) {
      logger.info(
        `Picking up task. Acquiring locks and marking ${gapIds.length} gaps as PROGRESS.`
      );

      // Acquire locks for all gaps before transitioning (lock parity fix)
      const lockResults = await Promise.all(
        gapIds.map(async (gapId) => {
          const acquired = await memory.acquireGapLock(gapId, AgentType.CODER);
          return { gapId, acquired };
        })
      );

      // Only transition gaps where lock was acquired
      const acquiredGaps = lockResults.filter((r) => {
        if (!r.acquired) {
          logger.warn(`[Coder] Could not acquire lock for gap ${r.gapId}, skipping.`);
        }
        return r.acquired;
      });
      lockedGapIds.push(...acquiredGaps.map((r) => r.gapId));

      if (acquiredGaps.length > 0) {
        const transitionResults = await Promise.all(
          acquiredGaps.map((r) => memory.updateGapStatus(r.gapId, GapStatus.PROGRESS))
        );
        transitionResults.forEach((res, i) => {
          if (!res.success) {
            logger.warn(
              `[Coder] Failed to transition gap ${acquiredGaps[i].gapId} to PROGRESS: ${res.error}`
            );
          }
        });
      }
    }
    const { responseText: rawResponse, attachments } = await agent.process(
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
                patch: { type: 'string' },
                sessionId: { type: 'string' },
                documentation_updated_path: { type: 'string' },
                tests_added_path: { type: 'string' },
              },
              required: [
                'failing_test_written',
                'test_file_path',
                'test_execution_result',
                'implementation_code',
                'status',
                'response',
                'documentation_updated_path',
                'tests_added_path',
              ],

              additionalProperties: false,
            },
          },
        },
      })
    );

    if (attachments) resultAttachments.push(...attachments);
    logger.info('Coder Agent Raw Response:', rawResponse);
    const rawResponseText = rawResponse;
    status = 'SUCCESS';
    responseText = rawResponseText;

    try {
      const parsed = parseStructuredResponse<{
        status: string;
        response: string;
        buildId?: string;
        patch?: string;
        failing_test_written?: boolean;
        test_file_path?: string;
        test_execution_result?: string;
      }>(rawResponseText);
      status = parsed.status || 'SUCCESS';
      responseText = parsed.response || rawResponseText;
      buildId = parsed.buildId;
      patchContent = parsed.patch;

      // --- PATCH ENFORCEMENT (Risk Fix 2) ---
      const isEvolutionTask = !!(gapIds && gapIds.length > 0);
      if (isEvolutionTask && status === 'SUCCESS' && !patchContent) {
        logger.warn('[PATCH_ENFORCEMENT] Evolution task missing patch. Marking as FAILED.');
        status = 'FAILED';
        responseText =
          'FAILED: Evolution task requires a technical patch for the merger, but none was provided by the model. Please retry with explicit patch generation.';
      }

      // Enrich response with TDD evidence if provided
      if (parsed.failing_test_written && parsed.test_file_path) {
        responseText += `\n\n**TDD Verification:**\n- Test File: \`${parsed.test_file_path}\`\n- Execution Result: \`${parsed.test_execution_result || 'Unknown'}\``;
      }

      logger.info(
        `Parsed Coder Result. Status: ${status}, BuildId: ${buildId}, TDD: ${parsed.failing_test_written}`
      );
    } catch (e) {
      logger.warn('Failed to parse Coder structured response, falling back to raw text.', e);
      // Fallback is already handled by assignments before the try block
    }
  } catch (err) {
    logger.error('Unexpected error in Coder Agent processing:', err);
    status = 'FAILED';
    responseText = `SYSTEM_ERROR: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    process.chdir(originalCwd);
    await cleanupWorkspace(workspacePath);

    // Reset gaps back to OPEN if the task failed or was not successful (A3 Fix)
    const isFailure = status === 'FAILED' || detectFailure(responseText);
    if (isFailure && lockedGapIds.length > 0) {
      const results = await Promise.allSettled(
        lockedGapIds.map((gapId) => memory.updateGapStatus(gapId, GapStatus.OPEN))
      );
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          logger.warn(
            `[Gaps] Failed to reset gap ${lockedGapIds[i]} to OPEN (rejection):`,
            result.reason
          );
        } else if (!result.value.success) {
          logger.warn(
            `[Gaps] Failed to reset gap ${lockedGapIds[i]} to OPEN: ${result.value.error}`
          );
        } else {
          logger.info(`[Gaps] Reset gap ${lockedGapIds[i]} to OPEN due to coder failure.`);
        }
      });
    }

    // Release all acquired gap locks (lock parity fix)
    for (const gapId of lockedGapIds) {
      try {
        await memory.releaseGapLock(gapId, AgentType.CODER);
      } catch (e) {
        logger.warn(`[Coder] Failed to release gap lock for ${gapId}:`, e);
      }
    }
  }

  // 3. Notify user directly if not a silent internal task
  if (!isTaskPaused(responseText)) {
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

    if (!buildId && lockedGapIds.length) {
      logger.info(
        `Task successful without deployment. Marking ${lockedGapIds.length} gaps as DEPLOYED.`
      );
      const results = await Promise.all(
        lockedGapIds.map((gapId) => memory.updateGapStatus(gapId, GapStatus.DEPLOYED))
      );
      results.forEach((res, i) => {
        if (!res.success) {
          logger.warn(`Failed to transition gap ${lockedGapIds[i]} to DEPLOYED: ${res.error}`);
        }
      });
    }
  }

  // 5. Notify Resumption Loop (Universal Coordination)
  if (!isTaskPaused(responseText)) {
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
      metadata: patchContent ? { patch: patchContent, gapIds: lockedGapIds } : undefined,
    });
  }

  return responseText;
};
