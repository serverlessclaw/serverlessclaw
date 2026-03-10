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
import { ITool } from '../lib/types';
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

export const tools: Record<string, ITool> = {
  stage_changes: {
    name: 'stage_changes',
    description: 'Stages modified files to S3 for persistent deployment.',
    parameters: {
      type: 'object',
      properties: {
        modifiedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of relative file paths that were modified.',
        },
      },
      required: ['modifiedFiles'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { modifiedFiles } = args as { modifiedFiles: string[] };
      if (!modifiedFiles || modifiedFiles.length === 0) {
        return 'No files to stage.';
      }

      const zipPath = '/tmp/staged_changes.zip';
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      return new Promise((resolve) => {
        output.on('close', async () => {
          try {
            const fileBuffer = await fs.readFile(zipPath);
            await s3.send(
              new PutObjectCommand({
                Bucket: Resource.StagingBucket.name,
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
    name: 'dispatch_task',
    description: 'Dispatches a specialized task to a sub-agent (e.g., coder).',
    parameters: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          enum: ['coder'],
          description: 'The type of sub-agent to invoke.',
        },
        userId: { type: 'string', description: 'The user ID context for the task.' },
        task: { type: 'string', description: 'The specific task for the sub-agent.' },
      },
      required: ['agentType', 'userId', 'task'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { agentType, userId, task } = args as {
        agentType: 'coder' | 'planner';
        userId: string;
        task: string;
      };
      console.log(`Dispatching ${agentType} task for user ${userId}: ${task}`);
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'main.agent',
            DetailType: `${agentType}_task`,
            Detail: JSON.stringify({ userId, task }),
            EventBusName: Resource.AgentBus.name,
          },
        ],
      });

      try {
        await eventbridge.send(command);
        return `Task successfully dispatched to ${agentType} agent.`;
      } catch (error) {
        return `Failed to dispatch task: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  file_write: {
    name: 'file_write',
    description: 'Writes content to a file. Used by the Coder Agent to implement changes.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The relative path to the file.' },
        content: { type: 'string', description: 'The content to write.' },
      },
      required: ['filePath', 'content'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { filePath, content } = args as { filePath: string; content: string };
      // Point 3: Protected Resource Labeling
      const protectedFiles = [
        'sst.config.ts',
        'src/tools/index.ts',
        'src/lib/agent.ts',
        'buildspec.yml',
        'src/infra',
      ];
      const isProtected =
        protectedFiles.some((f) => (filePath as string).endsWith(f)) ||
        (filePath as string).includes('infra/bootstrap');

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
    name: 'trigger_deployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for the deployment (e.g., added a new tool).',
        },
        userId: {
          type: 'string',
          description: 'The user ID context for the deployment.',
        },
      },
      required: ['reason', 'userId'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { reason, userId } = args as { reason: string; userId: string };
      // Point 2: Circuit Breaker
      const today = new Date().toISOString().split('T')[0];

      try {
        const { Item } = await db.send(
          new GetCommand({
            TableName: Resource.MemoryTable.name,
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

        // Proceed with deployment
        console.log(`Triggering deployment for reason: ${reason}`);
        const command = new StartBuildCommand({
          projectName: Resource.Deployer.name,
        });

        const response = await codebuild.send(command);
        const buildId = response.build?.id;

        if (buildId) {
          // Store Build ID -> UserID mapping for the BuildMonitor
          await db.send(
            new PutCommand({
              TableName: Resource.MemoryTable.name,
              Item: {
                userId: `BUILD#${buildId}`,
                timestamp: Date.now(),
                initiatorUserId: userId,
              },
            })
          );
        }

        // Update stats
        await db.send(
          new UpdateCommand({
            TableName: Resource.MemoryTable.name,
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
    name: 'calculator',
    description: 'Evaluates mathematical expressions.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The expression to evaluate.' },
      },
      required: ['expression'],
    },
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
    name: 'validate_code',
    description: 'Runs type checking and linting to ensure no regressions are introduced.',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      try {
        console.log('Running pre-flight validation...');
        const { stdout: tscOut } = await execAsync('npx tsc --noEmit');
        const { stdout: lintOut } = await execAsync('npx eslint . --fix-dry-run');
        return `Validation Successful:\n${tscOut}\n${lintOut}`;
      } catch (error) {
        return `Validation FAILED:\n${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  check_health: {
    name: 'check_health',
    description: 'Verify the health of the deployed agent API.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The health check endpoint URL.' },
      },
      required: ['url'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { url } = args as { url: string };
      try {
        console.log(`Checking health at ${url}`);
        const response = await fetch(url as string);
        if (response.ok) {
          // Reward: Decrement daily limit by 1 on a healthy response
          await db.send(
            new UpdateCommand({
              TableName: Resource.MemoryTable.name,
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
    name: 'trigger_rollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'The reason for the rollback.' },
      },
      required: ['reason'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { reason } = args as { reason: string };
      try {
        console.log(`ROLLBACK INITIATED: ${reason}`);
        await execAsync('git revert HEAD --no-edit');
        const command = new StartBuildCommand({
          projectName: Resource.Deployer.name,
        });
        await codebuild.send(command);
        return `ROLLBACK_SUCCESSFUL: Last commit reverted and deployment re-triggered. Reason: ${reason}`;
      } catch (error) {
        return `ROLLBACK_FAILED: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
  get_weather: {
    name: 'get_weather',
    description: 'Get the current weather in a given location.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'The city and state, e.g. San Francisco, CA' },
      },
      required: ['location'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { location } = args as { location: string };
      return `The weather in ${location} is sunny and 72°F.`;
    },
  },
  switch_model: {
    name: 'switch_model',
    description: 'Switch the active LLM provider and model at runtime.',
    parameters: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['openai', 'bedrock', 'openrouter'],
          description: 'The LLM provider to switch to.',
        },
        model: {
          type: 'string',
          description:
            'The specific model ID to use (e.g. gpt-5-mini, google/gemini-3-flash-preview).',
        },
      },
      required: ['provider', 'model'],
    },
    execute: async (args: Record<string, unknown>) => {
      const { provider, model } = args as { provider: string; model: string };
      try {
        await db.send(
          new PutCommand({
            TableName: (Resource as any).ConfigTable.name,
            Item: { key: 'active_provider', value: provider },
          })
        );
        await db.send(
          new PutCommand({
            TableName: (Resource as any).ConfigTable.name,
            Item: { key: 'active_model', value: model },
          })
        );
        return `Successfully switched to ${provider} with model ${model}. Hot config applied.`;
      } catch (error) {
        return `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  },
};

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
