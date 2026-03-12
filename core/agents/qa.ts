import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import {
  ReasoningProfile,
  EventType,
  EvolutionMode,
  GapStatus,
  SSTResource,
  AgentType,
} from '../lib/types/index';
import { Resource } from 'sst';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { sendOutboundMessage } from '../lib/outbound';
import { logger } from '../lib/logger';

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const memory = new DynamoMemory();
const provider = new ProviderManager();
const typedResource = Resource as unknown as SSTResource;

export const QA_SYSTEM_PROMPT = `
You are the QA Auditor for Serverless Claw. Your role is to verify that autonomous deployments actually solve the intended problems and meet project quality standards.

Key Obligations:
1. **Technical Verification**: Use tools like 'runTests', 'fileRead', and 'listFiles' to verify that the implementation matches the proposed 'STRATEGIC_PLAN'.
2. **Behavioral Audit**: Analyze the system's behavior and performance after a deployment to ensure no regressions were introduced.
3. **Satisfaction Gate**: Be critical. Only mark a gap as 'VERIFICATION_SUCCESSFUL' if the solution is robust and verified. Otherwise, request 'REOPEN_REQUIRED' with a detailed explanation of the failures.
4. **Build Analysis**: In the event of build successes or failures, provide a concise summary of the deployment's impact.
`;

async function getEvolutionMode(): Promise<'auto' | 'hitl'> {
  try {
    const response = await db.send(
      new GetCommand({
        TableName: typedResource.ConfigTable.name,
        Key: { key: 'evolution_mode' },
      })
    );
    return response.Item?.value === 'auto' ? 'auto' : 'hitl';
  } catch {
    return 'hitl';
  }
}

/**
 * QA Agent handler. Audits strategic plans and verifies implementation satisfaction.
 *
 * @param event - The event containing buildId, gapIds, and audit details.
 * @returns A promise that resolves when the audit cycle is complete.
 */
export const handler = async (event: {
  'detail-type': string;
  detail: {
    userId: string;
    buildId?: string;
    gapIds?: string[];
    task?: string;
    result?: string;
  };
}): Promise<void> => {
  const detail = event.detail;
  const isBuildSuccess = event['detail-type'] === EventType.SYSTEM_BUILD_SUCCESS;

  logger.info(`QA Agent triggered via ${event['detail-type']}`, detail.buildId || 'no-build');

  const { userId, buildId } = detail;
  let gapIds: string[] = detail.gapIds || [];

  // 1. Fetch Gaps (from mapping if via BuildMonitor)
  if (isBuildSuccess && buildId) {
    const gapsMeta = await db.send(
      new GetCommand({
        TableName: typedResource.MemoryTable.name,
        Key: { userId: `BUILD_GAPS#${buildId}`, timestamp: 0 },
      })
    );
    if (gapsMeta.Item) {
      gapIds = JSON.parse(gapsMeta.Item.content);
    }
  }

  if (gapIds.length === 0) {
    logger.info('No gaps found to verify. QA cycle complete.');
    return;
  }

  // 2. Fetch Strategic Plans for these gaps
  const plans = [];
  for (const gapId of gapIds) {
    const plan = await memory.getDistilledMemory(`PLAN#${gapId}`);
    if (plan) plans.push(`GAP: ${gapId}\nPLAN: ${plan}`);
  }

  // 3. Run QA Audit
  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(AgentType.QA);
  if (!config) {
    logger.error('Failed to load QA configuration');
    return;
  }

  const agentTools = await getAgentTools('qa');
  const qaAgent = new Agent(memory, provider, agentTools, config.systemPrompt, config);

  const auditPrompt = `Please verify if the implementation for these gaps is satisfactory. 
    Review the codebase if needed via tools.
    Final response MUST include VERIFICATION_SUCCESSFUL or REOPEN_REQUIRED.`;

  const auditReport = await qaAgent.process(userId, auditPrompt, {
    profile: ReasoningProfile.STANDARD,
    isIsolated: true,
    initiatorId: (event.detail as any).initiatorId,
    depth: (event.detail as any).depth,
  });

  logger.info('QA Audit Report:', auditReport);

  const isSatisfied = auditReport.includes('VERIFICATION_SUCCESSFUL');
  const evolutionMode = await getEvolutionMode();

  if (isSatisfied) {
    if (evolutionMode === EvolutionMode.AUTO) {
      logger.info('Verification successful. Auto-closing gaps.');
      for (const gapId of gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DONE);
      }
      await sendOutboundMessage(
        'qa.agent',
        userId,
        `✅ **Evolution Verified Successful**\n\nI have audited the implementation for ${gapIds.length} gaps and confirmed they are successfully resolved.\n\n${auditReport}`,
        [userId]
      );
    } else {
      logger.info('Verification successful. Asking user for final satisfaction sign-off.');
      await sendOutboundMessage(
        'qa.agent',
        userId,
        `🔍 **QA Audit Complete: Success**\n\nI have verified the implementation for ${gapIds.length} gaps. It looks correct to me.\n\n**Does this meet your expectations?**\n(Reply with "COMPLETE [Gap IDs]" to close or "REOPEN [Gap IDs]" to send back to backlog).`,
        [userId]
      );
    }
  } else {
    logger.warn('QA Audit Failed. Reopening gaps.');
    for (const gapId of gapIds) {
      await memory.updateGapStatus(gapId, GapStatus.OPEN);
    }
    await sendOutboundMessage(
      'qa.agent',
      userId,
      `⚠️ **QA Audit Failed: Implementation Unsatisfactory**\n\nI have reopened ${gapIds.length} gaps for further work.\n\n**REASON:**\n${auditReport}`,
      [userId]
    );
  }

  // Universal Coordination: Notify Initiator of Audit Completion
  try {
    const { EventBridgeClient, PutEventsCommand } = await import('@aws-sdk/client-eventbridge');
    const eb = new EventBridgeClient({});
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'qa.agent',
            DetailType: EventType.TASK_COMPLETED,
            Detail: JSON.stringify({
              userId,
              agentId: AgentType.QA,
              task: `QA Audit for Gaps: ${gapIds.join(', ')}`,
              response: auditReport,
              traceId: (event.detail as any).traceId,
              initiatorId: (event.detail as any).initiatorId,
              depth: (event.detail as any).depth,
            }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      })
    );
  } catch (e) {
    logger.error('Failed to emit TASK_COMPLETED from QA:', e);
  }
};
