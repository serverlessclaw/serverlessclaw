import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { Resource } from 'sst';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import { sendOutboundMessage } from '../lib/outbound';
import { SYSTEM, DYNAMO_KEYS } from '../lib/constants';
import { getDeployCountToday, incrementDeployCount, rewardDeployLimit } from '../lib/deploy-stats';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const codebuild = new CodeBuildClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ToolsResource {
  ConfigTable: { name: string };
  Deployer: { name: string };
  MemoryTable: { name: string };
}

/**
 * Triggers a new CodeBuild deployment, with daily limits and circuit breaking.
 */
export const triggerDeployment = {
  ...toolDefinitions.triggerDeployment,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { reason, userId, traceId } = args as {
      reason: string;
      userId: string;
      traceId?: string;
    };
    const today = new Date().toISOString().split('T')[0];
    const typedResource = Resource as unknown as ToolsResource;

    try {
      const { reason, userId, traceId, initiatorId, sessionId, task } = args as {
        reason: string;
        userId: string;
        traceId?: string;
        initiatorId?: string;
        sessionId?: string;
        task?: string;
      };
      const count = await getDeployCountToday();

      const { Item: configItem } = await db.send(
        new GetCommand({
          TableName: typedResource.ConfigTable.name,
          Key: { key: DYNAMO_KEYS.DEPLOY_LIMIT },
        })
      );

      let LIMIT: number = SYSTEM.DEFAULT_DEPLOY_LIMIT;
      if (configItem?.value) {
        const customLimit = parseInt(configItem.value, 10);
        if (!isNaN(customLimit)) {
          LIMIT = Math.min(SYSTEM.MAX_DEPLOY_LIMIT, Math.max(1, customLimit));
        }
      }

      if (count >= LIMIT) {
        return `CIRCUIT_BREAKER_ACTIVE: Daily deployment limit reached (${LIMIT}). Autonomous deployment blocked for today (${today}). Reason for attempt: ${reason}`;
      }

      const warning =
        LIMIT > 20
          ? `\n⚠️ WARNING: High deployment limit (${LIMIT}) may result in significant LLM token consumption and AWS costs.`
          : '';

      logger.info(`Triggering deployment for reason: ${reason}${warning}`);
      const command = new StartBuildCommand({
        projectName: typedResource.Deployer.name,
      });

      const response = await codebuild.send(command);
      const buildId = response.build?.id;

      if (buildId) {
        await db.send(
          new PutCommand({
            TableName: typedResource.MemoryTable.name,
            Item: {
              userId: `BUILD#${buildId}`,
              timestamp: Date.now(),
              initiatorUserId: userId,
              traceId: traceId,
              initiatorId: initiatorId,
              sessionId: sessionId,
              task: task,
            },
          })
        );
      }

      await incrementDeployCount(today, count);

      return `Deployment started successfully. Build ID: ${buildId}. Build counter: ${count + 1}/${LIMIT}. Reason: ${reason}${warning}`;
    } catch (error) {
      return `Failed to trigger deployment: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Checks system health at a given URL and rewards deployment limits on success.
 */
export const checkHealth = {
  ...toolDefinitions.checkHealth,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { url } = args as { url: string };
    try {
      logger.info(`Checking health at ${url}`);
      const response = await fetch(url as string);
      if (response.ok) {
        await rewardDeployLimit();
        return `HEALTH_OK: System is responsive. Deployment limit rewarded (-1).`;
      }
      return `HEALTH_FAILED: Received status ${response.status}.`;
    } catch (error) {
      return `HEALTH_ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Reverts the last commit and re-triggers a deployment.
 */
export const triggerRollback = {
  ...toolDefinitions.triggerRollback,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { reason } = args as { reason: string };
    const typedResource = Resource as unknown as ToolsResource;
    try {
      logger.info(`ROLLBACK INITIATED: ${reason}`);
      await execAsync('git revert HEAD --no-edit');
      const command = new StartBuildCommand({
        projectName: typedResource.Deployer.name,
      });
      await codebuild.send(command);
      return `ROLLBACK_SUCCESSFUL: Last commit reverted and deployment re-triggered. Reason: ${reason}`;
    } catch (error) {
      return `ROLLBACK_FAILED: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Validates the current codebase using type checking and linting.
 */
export const validateCode = {
  ...toolDefinitions.validateCode,
  execute: async (): Promise<string> => {
    try {
      logger.info('Running pre-flight validation...');
      const { stdout: tscOut } = await execAsync('npx tsc --noEmit');
      const { stdout: lintOut } = await execAsync('npx eslint . --fix-dry-run');
      return `Validation Successful:\n${tscOut}\n${lintOut}`;
    } catch (error) {
      return `Validation FAILED:\n${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

/**
 * Sends a direct message to the user chat session.
 * Used by agents to communicate findings, status, or greetings directly.
 */
export const sendMessage = {
  ...toolDefinitions.sendMessage,
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { message, userId, sessionId, agentName } = args as {
      message: string;
      userId: string;
      sessionId?: string;
      agentName?: string;
    };

    try {
      // source is hardcoded to 'tool.sendMessage' but we could propagate agentId if needed
      await sendOutboundMessage(
        'tool.sendMessage',
        userId,
        message,
        [userId],
        sessionId,
        agentName
      );
      return 'Message sent successfully to user.';
    } catch (error) {
      return `Failed to send message: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
