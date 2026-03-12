import { DynamoMemory } from '../lib/memory';
import { Agent } from '../lib/agent';
import { ProviderManager } from '../lib/providers/index';
import { getAgentTools } from '../tools/index';
import {
  ReasoningProfile,
  GapStatus,
  EventType,
  SSTResource,
  MessageRole,
  AgentType,
} from '../lib/types/index';
import { logger } from '../lib/logger';
import { Resource } from 'sst';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const memory = new DynamoMemory();
const provider = new ProviderManager();
const eventbridge = new EventBridgeClient({});
const typedResource = Resource as unknown as SSTResource;

export const CODER_SYSTEM_PROMPT = `
You are the Coder Agent for Serverless Claw. Your role is to implement requested technical changes, write high-quality TypeScript code, and manage AWS infrastructure via SST.

Key Obligations:
1. **Pre-flight Checks**: You MUST call 'validateCode' after every 'fileWrite' or 'multi_replace_file_content' to ensure type safety and linting compliance.
2. **Atomicity**: Ensure the codebase remains in a functional state. Never leave the project in a broken state.
3. **Documentation**: Update relevant 'docs/*.md' and 'INDEX.md' files in the same step as code changes to maintain technical accuracy.
4. **Protected Files**: You are restricted from direct writes to core system files (e.g., sst.config.ts, core/lib/agent.ts). If a change is required, you must describe it and return 'MANUAL_APPROVAL_REQUIRED'.
5. **Deployment**: Trigger a deployment via 'triggerDeployment' only after verifying the build locally with 'validateCode' and 'runTests'.
6. **Clarity**: Explain your technical decisions and follow the project's architecture as defined in 'ARCHITECTURE.md'.
`;

/**
 * Coder Agent handler. Processes coding tasks, implements changes,
 * and optionally triggers deployments or notifies QA.
 *
 * @param event - The event containing userId, task, and optional metadata.
 * @returns A promise that resolves to the agent's response string, or undefined on error.
 */
export const handler = async (event: {
  userId: string;
  task: string;
  metadata?: { gapIds?: string[] };
  traceId?: string;
}): Promise<string | undefined> => {
  logger.info('Coder Agent received task:', JSON.stringify(event, null, 2));

  const { userId, task, metadata, traceId } = event;

  if (!userId || !task) {
    logger.error('Invalid event payload');
    return;
  }

  // 1. Transition gaps to PROGRESS
  if (metadata?.gapIds && metadata.gapIds.length > 0) {
    logger.info(`Picking up task. Marking ${metadata.gapIds.length} gaps as PROGRESS.`);
    for (const gapId of metadata.gapIds) {
      await memory.updateGapStatus(gapId, GapStatus.PROGRESS);
    }
  }

  // 2. Process the task
  // 2026 Optimization: Use 'thinking' profile for coding tasks
  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(AgentType.CODER);
  if (!config) {
    logger.error('Failed to load Coder configuration');
    return;
  }

  const agentTools = await getAgentTools('coder');
  const agent = new Agent(memory, provider, agentTools, config.systemPrompt, config);
  const response = await agent.process(userId, `CODER TASK: ${task}`, {
    profile: ReasoningProfile.THINKING,
    isIsolated: true,
  });

  logger.info('Coder Agent completed task:', response);

  // 2. Mark gaps as DONE if successful or map them to a build
  const isSuccess =
    response.includes('Successfully staged') && !response.includes('MANUAL_APPROVAL_REQUIRED');

  if (isSuccess && metadata?.gapIds && metadata.gapIds.length > 0) {
    // Check if a deployment was triggered
    const buildMatch = response.match(/Build ID: ([a-zA-Z0-9:-]+)/);
    const buildId = buildMatch ? buildMatch[1] : null;

    if (buildId) {
      logger.info(`Deployment triggered (${buildId}). Mapping gaps to build for monitor.`);
      // 2026 Fix: Use timestamp 0 for fixed lookup compatibility with QA Auditor
      const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      await db.send(
        new PutCommand({
          TableName: typedResource.MemoryTable.name,
          Item: {
            userId: `BUILD_GAPS#${buildId}`,
            timestamp: 0,
            role: MessageRole.SYSTEM,
            content: JSON.stringify(metadata.gapIds),
          },
        })
      );
    } else {
      logger.info(
        `Task successful without deployment. Marking ${metadata.gapIds.length} gaps as DEPLOYED.`
      );
      for (const gapId of metadata.gapIds) {
        await memory.updateGapStatus(gapId, GapStatus.DEPLOYED);
      }

      // Notify QA Agent directly since BuildMonitor won't be triggered
      try {
        await eventbridge.send(
          new PutEventsCommand({
            Entries: [
              {
                Source: 'coder.agent',
                DetailType: EventType.CODER_TASK_COMPLETED,
                Detail: JSON.stringify({
                  userId,
                  gapIds: metadata.gapIds,
                  task,
                  result: response,
                }),
                EventBusName: typedResource.AgentBus.name,
              },
            ],
          })
        );
      } catch (e) {
        logger.error('Failed to emit CODER_TASK_COMPLETED:', e);
      }
    }
  }

  return response;
};
