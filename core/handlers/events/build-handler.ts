import { BUILD_EVENT_SCHEMA } from '../../lib/schema/events';
import { Context } from 'aws-lambda';
import { wakeupInitiator } from './shared';
import { UserRole } from '../../lib/types/agent';

/**
 * Handles build failure events - triggers agent to investigate and fix.
 *
 * @param eventDetail - The build event detail.
 * @param _context - The AWS Lambda context.
 */
export async function handleBuildFailure(
  eventDetail: Record<string, unknown>,
  _context: Context
): Promise<void> {
  const {
    userId,
    buildId,
    errorLogs,
    failureManifest,
    traceId,
    gapIds,
    sessionId,
    initiatorId,
    task: originalTask,
    workspaceId,
    teamId,
    staffId,
    userRole,
  } = BUILD_EVENT_SCHEMA.parse(eventDetail);

  const gapsContext =
    gapIds && gapIds.length > 0
      ? `This deployment was addressing the following gaps: ${gapIds.join(', ')}.`
      : '';
  const traceContext = traceId
    ? `Refer to the previous reasoning trace for context: ${traceId}`
    : '';

  const manifestContext = failureManifest
    ? `A structured failure manifest was generated. It contains detailed information about affected files and error types:\n${JSON.stringify(failureManifest, null, 2)}`
    : '';

  const task = `CRITICAL: Deployment ${buildId} failed. 
    ${gapsContext}
    ${traceContext}
    ${manifestContext}

    Here are the last few lines of the logs:
    ---
    ${errorLogs}
    ---
    Please investigate the codebase using your tools, find the root cause, fix the issue, and trigger a new deployment. 
    Explain your plan to the user before proceeding.`;

  const { emitEvent } = await import('../../lib/utils/bus');
  const { EventType } = await import('../../lib/types/agent');

  await emitEvent('build.handler', EventType.CODER_TASK, {
    userId,
    task,
    traceId,
    sessionId,
    initiatorId: 'build-handler',
    workspaceId,
    teamId,
    staffId,
    metadata: {
      failureManifest,
      buildId,
      gapIds,
      applyStagedChanges: true,
    },
  });

  // WAKE UP INITIATOR
  if (initiatorId && originalTask) {
    await wakeupInitiator(
      userId,
      initiatorId,
      `BUILD_FAILURE_NOTIFICATION: The deployment for your task "${originalTask}" failed. 
        Error details:
        ---
        ${errorLogs}
        ---
        Please decide on the next course of action.`,
      traceId,
      sessionId,
      0,
      false,
      undefined,
      undefined,
      undefined,
      workspaceId,
      teamId,
      staffId,
      userRole as UserRole
    );
  }
}

/**
 * Handles build success events - notifies user and wakes up initiator.
 *
 * @param eventDetail - The build event detail.
 * @returns A promise resolving when the success event is processed.
 */
export async function handleBuildSuccess(eventDetail: Record<string, unknown>): Promise<void> {
  const {
    userId,
    buildId,
    sessionId,
    initiatorId,
    task,
    traceId,
    workspaceId,
    teamId,
    staffId,
    userRole,
  } = BUILD_EVENT_SCHEMA.parse(eventDetail);

  const message = `✅ **DEPLOYMENT SUCCESSFUL**
Build ID: ${buildId}

The build completed successfully. Associated gaps have been marked as **DEPLOYED** and are pending QA verification.
The QA Auditor will verify the changes shortly. Gaps are only marked **DONE** after QA passes (auto mode) or you confirm (HITL mode).`;

  const { sendOutboundMessage } = await import('../../lib/outbound');
  await sendOutboundMessage(
    'build-handler',
    userId,
    message,
    undefined,
    sessionId,
    'SuperClaw',
    undefined,
    traceId,
    undefined,
    workspaceId,
    teamId,
    staffId,
    undefined
  );

  // WAKE UP INITIATOR
  if (initiatorId && task) {
    await wakeupInitiator(
      userId,
      initiatorId,
      `BUILD_SUCCESS_NOTIFICATION: The deployment for your task "${task}" was successful (Build: ${buildId}). Please perform any post-deployment configuration or verification steps.`,
      traceId,
      sessionId,
      0,
      false,
      undefined,
      undefined,
      undefined,
      workspaceId,
      teamId,
      staffId,
      userRole as UserRole
    );
  }
}
