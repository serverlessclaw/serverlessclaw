import { IToolDefinition } from '../../lib/types/index';

/**
 * Deployment-related tool definitions.
 */
export const deploymentTools: Record<string, IToolDefinition> = {
  stageChanges: {
    name: 'stageChanges',
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
      additionalProperties: false,
    },
    connectionProfile: ['storage'],
  },
  triggerDeployment: {
    name: 'triggerDeployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'The reason for the deployment (e.g., added a new tool).',
        },
        gapIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of gap IDs to associate with this build.',
        },
      },
      required: ['reason', 'gapIds'],
      additionalProperties: false,
    },
    connectionProfile: ['codebuild'],
  },
  validateCode: {
    name: 'validateCode',
    description: 'Runs type checking and linting to ensure no regressions are introduced.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  checkHealth: {
    name: 'checkHealth',
    description: 'Verify the health of the deployed agent API.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The health check endpoint URL.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  triggerRollback: {
    name: 'triggerRollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'The reason for the rollback.' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    connectionProfile: ['codebuild'],
  },
  runTests: {
    name: 'runTests',
    description: 'Runs the project unit tests to verify changes before staging.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};
