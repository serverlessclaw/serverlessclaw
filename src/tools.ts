import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { Resource } from 'sst';
import { ITool } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const codebuild = new CodeBuildClient({});
const eventbridge = new EventBridgeClient({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const tools: Record<string, ITool> = {
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
    execute: async ({ agentType, userId, task }) => {
      console.log(`Dispatching ${agentType} task for user ${userId}: ${task}`);
      const command = new PutEventsCommand({
        Entries: [
          {
            Source: 'main.agent',
            DetailType: `${agentType}.task`,
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
    execute: async ({ filePath, content }) => {
      // Point 3: Protected Resource Labeling
      const protectedFiles = ['sst.config.ts', 'src/tools.ts', 'src/agent.ts', 'buildspec.yml'];
      const isProtected =
        protectedFiles.some((f) => filePath.endsWith(f)) || filePath.includes('infra/bootstrap');

      if (isProtected) {
        return `PERMISSION_DENIED: The file '${filePath}' is labeled as [PROTECTED]. Autonomous modification is blocked. Please present the proposed changes to the user and request a 'MANUAL_APPROVAL'.`;
      }

      try {
        const fullPath = path.resolve(process.cwd(), filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf8');
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
    execute: async ({ reason, userId }) => {
      // Point 2: Circuit Breaker
      const today = new Date().toISOString().split('T')[0];
      const statsKey = 'system:deploy-stats';

      try {
        const { Item } = await db.send(
          new GetCommand({
            TableName: Resource.MemoryTable.name,
            Key: { id: statsKey },
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
                initiatorUserId: userId, // Assuming userId is available in the context or passed
              },
            })
          );
        }

        // Update stats
        await db.send(
          new UpdateCommand({
            TableName: Resource.MemoryTable.name,
            Key: { id: statsKey },
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
    execute: async ({ expression }) => {
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
        // In a real Lambda, this might be restricted, but for our 'local-first' dev agent it's key.
        // We trigger 'tsc' and 'eslint'.
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
    execute: async ({ url }) => {
      try {
        console.log(`Checking health at ${url}`);
        const response = await fetch(url);
        if (response.ok) {
          // Reward: Decrement daily limit by 1 on a healthy response
          const statsKey = 'system:deploy-stats';
          await db.send(
            new UpdateCommand({
              TableName: Resource.MemoryTable.name,
              Key: { id: statsKey },
              // Reward a successful health check by decrementing the daily counter
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
    execute: async ({ reason }) => {
      try {
        console.log(`ROLLBACK INITIATED: ${reason}`);
        // 1. Revert last commit
        await execAsync('git revert HEAD --no-edit');
        // 2. Trigger deployment
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
    execute: async ({ location }) => {
      return `The weather in ${location} is sunny and 72°F.`;
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
