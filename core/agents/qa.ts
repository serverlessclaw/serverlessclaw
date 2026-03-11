import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import { ReasoningProfile, EvolutionMode, GapStatus, SSTResource } from '../lib/types/index';
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

export const handler = async (event: {
  detail: {
    userId: string;
    buildId: string;
    projectName: string;
  };
}) => {
  logger.info('QA Agent triggered for build:', event.detail.buildId);

  const { userId, buildId } = event.detail;

  // 1. Fetch Gaps associated with this build
  const gapsMeta = await db.send(
    new GetCommand({
      TableName: typedResource.MemoryTable.name,
      Key: { userId: `BUILD_GAPS#${buildId}`, timestamp: 0 },
    })
  );

  const gapIds: string[] = gapsMeta.Item ? JSON.parse(gapsMeta.Item.content) : [];
  if (gapIds.length === 0) {
    logger.info('No gaps associated with this build. QA cycle complete.');
    return;
  }

  // 2. Fetch Strategic Plans for these gaps
  const plans = [];
  for (const gapId of gapIds) {
    const plan = await memory.getDistilledMemory(`PLAN#${gapId}`);
    if (plan) plans.push(`GAP: ${gapId}\nPLAN: ${plan}`);
  }

  // 3. Run QA Audit
  const agentTools = await getAgentTools('qa');
  const qaAgent = new Agent(
    memory,
    provider,
    agentTools,
    `You are the specialized QA Auditor. 
    Audit these gaps and plans against the latest system state and conversation.
    
    ASSOCIATED GAPS & PLANS:
    ${plans.join('\n---\n')}
    `
  );

  const auditReport = await qaAgent.process(
    userId,
    `Please verify if the implementation for these gaps is satisfactory. 
    Review the codebase if needed via tools.
    Final response MUST include VERIFICATION_SUCCESSFUL or REOPEN_REQUIRED.`,
    ReasoningProfile.STANDARD
  );

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
        `✅ **Evolution Verified Successful**\n\nI have audited the implementation for ${gapIds.length} gaps and confirmed they are successfully resolved.\n\n${auditReport}`
      );
    } else {
      logger.info('Verification successful. Asking user for final satisfaction sign-off.');
      await sendOutboundMessage(
        'qa.agent',
        userId,
        `🔍 **QA Audit Complete: Success**\n\nI have verified the implementation for ${gapIds.length} gaps. It looks correct to me.\n\n**Does this meet your expectations?**\n(Reply with "COMPLETE [Gap IDs]" to close or "REOPEN [Gap IDs]" to send back to backlog).`
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
      `⚠️ **QA Audit Failed: Implementation Unsatisfactory**\n\nI have reopened ${gapIds.length} gaps for further work.\n\n**REASON:**\n${auditReport}`
    );
  }
};
