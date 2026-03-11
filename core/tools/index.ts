import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { ITool, InsightCategory } from '../lib/types/index';
import { toolDefinitions } from './definitions';
import { logger } from '../lib/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

const execAsync = promisify(exec);
const codebuild = new CodeBuildClient({});
const eventbridge = new EventBridgeClient({});
const s3 = new S3Client({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ToolsResource {
  ConfigTable: { name: string };
  StagingBucket: { name: string };
  AgentBus: { name: string };
  Deployer: { name: string };
  MemoryTable: { name: string };
}

export const tools: Record<string, ITool> = {
  stage_changes: {
    ...toolDefinitions.stage_changes,
    execute: async (args: Record<string, unknown>) => {
      const { modifiedFiles } = args as { modifiedFiles: string[] };
      if (!modifiedFiles || modifiedFiles.length === 0) {
        return 'No files to stage.';
      }

      const typedResource = Resource as unknown as ToolsResource;
      const zipPath = '/tmp/staged_changes.zip';
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        output.on('close', async () => {
          try {
            const fileBuffer = await fs.readFile(zipPath);
            await s3.send(
              new PutObjectCommand({
                Bucket: typedResource.StagingBucket.name,
                Key: 'staged_changes.zip',
                Body: fileBuffer,
              })
            );
            resolve(`Successfully staged ${modifiedFiles.length} files to S3.`);
          } catch (error) {
            resolve(
              `Failed to upload staged changes: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        });

        archive.on('error', (err: Error) => {
          resolve(`Failed to create zip: ${err.message}`);
        });

        archive.pipe(output);
        for (const file of modifiedFiles as string[]) {
          const fullPath = path.resolve(process.cwd(), file);
          archive.file(fullPath, { name: file });
        }
        archive.finalize();
      });
    },
  },
  dispatch_task: {
    ...toolDefinitions.dispatch_task,
    execute: async (args: Record<string, unknown>) => {
      const { agentId, userId, task } = args as {
        agentId: string;
        userId: string;
        task: string;
      };

      // Dynamic lookup to validate agent exists and is enabled
      const { AgentRegistry } = await import('../lib/registry');
      const config = await AgentRegistry.getAgentConfig(agentId);

      if (!config) {
        return `FAILED: Agent '${agentId}' is not registered in the system.`;
      }

      if (!config.enabled) {
        return `FAILED: Agent '${agentId}' is currently disabled.`;
      }

      logger.info(`Dispatching ${agentId} task for user ${userId}: ${task}`);
      const typedResource = Resource as unknown as ToolsResource;
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'main.agent',
            DetailType: `${agentId}_task`,
            Detail: JSON.stringify({ userId, task }),
            EventBusName: typedResource.AgentBus.name,
          },
        ],
      });

      try {
        await eventbridge.send(command);
        return `Task successfully dispatched to ${agentId} agent.`;
      } catch (error) {
        return `Failed to dispatch task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  file_write: {
    ...toolDefinitions.file_write,
    execute: async (args: Record<string, unknown>) => {
      const { filePath, content } = args as { filePath: string; content: string };
      const protectedFiles = [
        'sst.config.ts',
        'src/tools/index.ts',
        'src/agents/manager.ts',
        'src/lib/agent.ts',
        'buildspec.yml',
      ];
      const isProtected =
        protectedFiles.some((f) => (filePath as string).endsWith(f)) ||
        (filePath as string).includes('infra/');

      if (isProtected) {
        return `PERMISSION_DENIED: The file '${filePath}' is labeled as [PROTECTED]. Autonomous modification is blocked. Please present the proposed changes to the user and request a 'MANUAL_APPROVAL'.`;
      }

      try {
        const fullPath = path.resolve(process.cwd(), filePath as string);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content as string, 'utf8');
        return `Successfully wrote to ${filePath}`;
      } catch (error) {
        return `Failed to write file: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  trigger_deployment: {
    ...toolDefinitions.trigger_deployment,
    execute: async (args: Record<string, unknown>) => {
      const { reason, userId } = args as { reason: string; userId: string };
      const today = new Date().toISOString().split('T')[0];
      const typedResource = Resource as unknown as ToolsResource;

      try {
        const { Item } = await db.send(
          new GetCommand({
            TableName: typedResource.MemoryTable.name,
            Key: {
              userId: 'SYSTEM#DEPLOY_STATS',
              timestamp: 0,
            },
          })
        );

        const count = Item?.lastReset === today ? Item?.count || 0 : 0;
        const LIMIT = 5;

        if (count >= LIMIT) {
          return `CIRCUIT_BREAKER_ACTIVE: Daily deployment limit reached (${LIMIT}). Autonomous deployment blocked for today (${today}). Reason for attempt: ${reason}`;
        }

        logger.info(`Triggering deployment for reason: ${reason}`);
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
              },
            })
          );
        }

        await db.send(
          new UpdateCommand({
            TableName: typedResource.MemoryTable.name,
            Key: {
              userId: 'SYSTEM#DEPLOY_STATS',
              timestamp: 0,
            },
            UpdateExpression:
              count === 0 ? 'SET #count = :one, lastReset = :today' : 'SET #count = #count + :inc',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':one': 1,
              ':today': today,
              ':inc': 1,
            },
          })
        );

        return `Deployment started successfully. Build ID: ${buildId}. Build counter: ${count + 1}/${LIMIT}. Reason: ${reason}`;
      } catch (error) {
        return `Failed to trigger deployment: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  calculator: {
    ...toolDefinitions.calculator,
    execute: async (args: Record<string, unknown>) => {
      const { expression } = args as { expression: string };
      try {
        const result = Function(`"use strict"; return (${expression})`)();
        return `Result: ${result}`;
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },
  validate_code: {
    ...toolDefinitions.validate_code,
    execute: async () => {
      try {
        logger.info('Running pre-flight validation...');
        const { stdout: tscOut } = await execAsync('npx tsc --noEmit');
        const { stdout: lintOut } = await execAsync('npx eslint . --fix-dry-run');
        return `Validation Successful:\n${tscOut}\n${lintOut}`;
      } catch (error) {
        return `Validation FAILED:\n${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  check_health: {
    ...toolDefinitions.check_health,
    execute: async (args: Record<string, unknown>) => {
      const { url } = args as { url: string };
      const typedResource = Resource as unknown as ToolsResource;
      try {
        logger.info(`Checking health at ${url}`);
        const response = await fetch(url as string);
        if (response.ok) {
          await db.send(
            new UpdateCommand({
              TableName: typedResource.MemoryTable.name,
              Key: {
                userId: 'SYSTEM#DEPLOY_STATS',
                timestamp: 0,
              },
              UpdateExpression: 'SET #count = if_not_exists(#count, :zero) - :one',
              ExpressionAttributeNames: { '#count': 'count' },
              ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
            })
          );
          return `HEALTH_OK: System is responsive. Deployment limit rewarded (-1).`;
        }
        return `HEALTH_FAILED: Received status ${response.status}.`;
      } catch (error) {
        return `HEALTH_ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  trigger_rollback: {
    ...toolDefinitions.trigger_rollback,
    execute: async (args: Record<string, unknown>) => {
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
  },
  get_weather: {
    ...toolDefinitions.get_weather,
    execute: async (args: Record<string, unknown>) => {
      const { location } = args as { location: string };
      return `The weather in ${location} is sunny and 72°F.`;
    },
  },
  run_tests: {
    ...toolDefinitions.run_tests,
    execute: async () => {
      try {
        logger.info('Running autonomous test suite...');
        const { stdout, stderr } = await execAsync('npm test');
        return `Test Results:\n${stdout}\n${stderr}`;
      } catch (error) {
        return `Tests FAILED:\n${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  switch_model: {
    ...toolDefinitions.switch_model,
    execute: async (args: Record<string, unknown>) => {
      const { provider, model } = args as { provider: string; model: string };
      const typedResource = Resource as unknown as ToolsResource;
      try {
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: { key: 'active_provider', value: provider },
          })
        );
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: { key: 'active_model', value: model },
          })
        );
        return `Successfully switched to ${provider} with model ${model}. Hot config applied.`;
      } catch (error) {
        return `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  recall_knowledge: {
    ...toolDefinitions.recall_knowledge,
    execute: async (args: Record<string, unknown>) => {
      const { userId, query, category } = args as {
        userId: string;
        query: string;
        category?: string;
      };
      const { DynamoMemory } = await import('../lib/memory');
      const memory = new DynamoMemory();
      const results = await memory.searchInsights(userId, query, category as InsightCategory);

      if (results.length === 0) return 'No relevant knowledge found.';

      interface InsightResult {
        content: string;
        metadata: {
          category: string;
          impact: number;
          urgency: number;
        };
      }

      return (results as unknown as InsightResult[])
        .map(
          (r) =>
            `[${r.metadata.category.toUpperCase()}] (Impact: ${r.metadata.impact}/10, Urgency: ${r.metadata.urgency}/10) ${r.content}`
        )
        .join('\n');
    },
  },
  manage_agent_tools: {
    ...toolDefinitions.manage_agent_tools,
    execute: async (args: Record<string, unknown>) => {
      const { agentId, toolNames } = args as { agentId: string; toolNames: string[] };
      const typedResource = Resource as unknown as ToolsResource;
      try {
        await db.send(
          new PutCommand({
            TableName: typedResource.ConfigTable.name,
            Item: {
              key: `${agentId}_tools`,
              value: toolNames,
            },
          })
        );
        return `Successfully updated tools for agent ${agentId}: ${toolNames.join(', ')}`;
      } catch (error) {
        return `Failed to update agent tools: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  merge_pr: {
    ...toolDefinitions.merge_pr,
    execute: async (args: Record<string, unknown>) => {
      const { prNumber, strategy = 'merge' } = args as {
        prNumber: number;
        strategy?: 'merge' | 'squash' | 'rebase';
      };
      try {
        logger.info(`Merging PR #${prNumber} with strategy ${strategy}...`);
        const { stdout, stderr } = await execAsync(
          `gh pr merge ${prNumber} --${strategy} --delete-branch`
        );
        return `PR #${prNumber} merged successfully:\n${stdout}\n${stderr}`;
      } catch (error) {
        return `Failed to merge PR #${prNumber}: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
};

/**
 * Dynamically retrieves the tools assigned to a specific agent.
 * Now uses the AgentRegistry to get tools from both Backbone and DDB.
 */
export async function getAgentTools(agentId: string): Promise<ITool[]> {
  const { AgentRegistry } = await import('../lib/registry');
  const config = await AgentRegistry.getAgentConfig(agentId);

  if (!config || !config.tools) {
    logger.warn(`No tools configured for agent ${agentId}, returning empty set.`);
    return [];
  }

  return config.tools
    .map((name: string) => (tools as Record<string, ITool>)[name])
    .filter((t: ITool | undefined): t is ITool => !!t);
}

export function getToolDefinitions() {
  return Object.values(tools).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
