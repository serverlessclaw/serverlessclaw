import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { Resource } from 'sst';
import { EventType, SSTResource } from './types/index';
import { logger } from './logger';

const eventbridge = new EventBridgeClient({});
// Resource access moved inside function to support late-binding mocks in tests

export interface HealthIssue {
  component: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  userId: string;
  traceId?: string;
}

/**
 * Reports a system health issue to the AgentBus for autonomous triage.
 */
export async function reportHealthIssue(report: HealthIssue): Promise<void> {
  logger.warn(`Reporting system health issue in ${report.component}: ${report.issue}`, {
    severity: report.severity,
    traceId: report.traceId,
  });

  try {
    await eventbridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'system.health',
            DetailType: EventType.SYSTEM_HEALTH_REPORT,
            Detail: JSON.stringify(report),
            EventBusName: (Resource as unknown as SSTResource).AgentBus.name,
          },
        ],
      })
    );
    logger.info(`Health issue reported successfully for component: ${report.component}`);
  } catch (error) {
    logger.error('Failed to report system health issue:', error);
  }
}
