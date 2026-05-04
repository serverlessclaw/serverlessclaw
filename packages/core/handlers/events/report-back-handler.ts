import { logger } from '../../lib/logger';
import { sendOutboundMessage } from '../../lib/outbound';

interface ReportBackPayload {
  userId: string;
  action: string;
  reason: string;
  result: string;
  traceId?: string;
  sessionId?: string;
  agentId?: string;
  workspaceId?: string;
  orgId?: string;
  teamId?: string;
  staffId?: string;
}

/**
 * Handles retroactive report-back events.
 * Notifies the human user of an autonomous action taken due to a timeout or strategic tie-break.
 */
export async function handleReportBack(eventDetail: Record<string, unknown>): Promise<void> {
  const {
    userId,
    action,
    reason,
    result,
    traceId,
    sessionId,
    agentId,
    workspaceId,
    orgId,
    teamId,
    staffId,
  } = eventDetail as unknown as ReportBackPayload;

  logger.info(`[REPORT_BACK] Action: ${action} | Reason: ${reason} | User: ${userId}`);

  const message =
    `📢 **Autonomous Action Report**\n\n` +
    `The system performed an autonomous action due to an inactivity timeout.\n\n` +
    `**Action:** ${action}\n` +
    `**Reason:** ${reason}\n` +
    `**Result:** ${result}\n\n` +
    `*This action was taken to maintain system momentum. Please review and acknowledge.*`;

  await sendOutboundMessage(
    'report-back-handler',
    userId,
    message,
    undefined,
    sessionId,
    agentId || 'SuperClaw',
    undefined,
    traceId,
    undefined,
    workspaceId,
    orgId,
    teamId,
    staffId
  );
}
