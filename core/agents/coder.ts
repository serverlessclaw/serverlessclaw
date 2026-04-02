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

  // 1. Prepare writable /tmp workspace
  const { createWorkspace, cleanupWorkspace } = await import('../lib/utils/workspace-manager');
  const workspacePath = await createWorkspace(traceId ?? `unknown-${Date.now()}`);
  const originalCwd = process.cwd();
  process.chdir(workspacePath);
  logger.info(`[Coder] Working in workspace: ${workspacePath}`);

  // 2. Initialize agent (config + context loaded in parallel)
  const { config, memory, agent } = await initAgent(AgentType.CODER);

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

  try {
    // 3b. Transition gaps to PROGRESS (inside try so finally can reset on init failure)
    if (gapIds && gapIds.length > 0) {
      logger.info(`Picking up task. Marking ${gapIds.length} gaps as PROGRESS.`);
      await Promise.all(gapIds.map((gapId) => memory.updateGapStatus(gapId, GapStatus.PROGRESS)));
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
    if (isFailure && gapIds && gapIds.length > 0) {
      const results = await Promise.allSettled(
        gapIds.map((gapId) => memory.updateGapStatus(gapId, GapStatus.OPEN))
      );
      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          logger.warn(`[Gaps] Failed to reset gap ${gapIds[i]} to OPEN:`, result.reason);
        } else {
          logger.info(`[Gaps] Reset gap ${gapIds[i]} to OPEN due to coder failure.`);
        }
      });
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

    if (!buildId && gapIds?.length) {
      logger.info(`Task successful without deployment. Marking ${gapIds.length} gaps as DEPLOYED.`);
      await Promise.all(gapIds.map((gapId) => memory.updateGapStatus(gapId, GapStatus.DEPLOYED)));
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
      metadata: patchContent ? { patch: patchContent, gapIds } : undefined,
    });
  }

  return responseText;
};
