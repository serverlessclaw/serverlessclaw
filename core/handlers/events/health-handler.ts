import { HealthReportEvent } from '../../lib/types/index';
import { Context } from 'aws-lambda';
import { processEventWithAgent } from './shared';

/**
 * Handles system health report events - triggers agent to investigate issues.
 *
 * @param eventDetail - The health report event detail.
 * @param context - The AWS Lambda context.
 * @returns A promise resolving when the health report is processed.
 */
export async function handleHealthReport(
  eventDetail: Record<string, unknown>,
  context: Context
): Promise<void> {
  const {
    component,
    issue,
    severity,
    context: issueContext,
    userId,
    traceId,
    sessionId,
  } = eventDetail as unknown as HealthReportEvent;

  const triageTask = `SYSTEM HEALTH ALERT: A component has reported an internal issue.
    
    Component: ${component}
    Issue: ${issue}
    Severity: ${severity.toUpperCase()}
    
    Context:
    ${JSON.stringify(issueContext ?? {}, null, 2)}
    
    Please investigate this health issue. Determine if it requires a code modification (Coder Agent), configuration change, or if it can be resolved via an autonomous recovery action.
    Start by diagnosing the root cause using your tools.`;

  await processEventWithAgent(userId, 'main', triageTask, {
    context,
    traceId,
    sessionId,
    handlerTitle: 'HEALTH_TRIAGE',
    outboundHandlerName: 'health-handler',
    formatResponse: (responseText) =>
      `🚨 **SYSTEM HEALTH ALERT** (CRITICAL)\nComponent: ${component}\nIssue: ${issue}\n\nSuperClaw response: ${responseText}`,
  });
}
