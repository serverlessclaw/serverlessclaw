import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';
const TYPE_ARRAY = 'array';

/**
 * Deployment-related tool definitions.
 */
export const deploymentTools: Record<string, IToolDefinition> = {
  stageChanges: {
    name: 'stageChanges',
    description: 'Stages modified files to S3 for persistent deployment.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        modifiedFiles: {
          type: TYPE_ARRAY,
          items: { type: TYPE_STRING },
          description: 'List of relative file paths that were modified.',
        },
      },
      required: ['modifiedFiles'],
      additionalProperties: false,
    },
  },
  triggerDeployment: {
    name: 'triggerDeployment',
    description: 'Triggers an autonomous self-deployment of the agent infrastructure.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        reason: {
          type: TYPE_STRING,
          description: 'The reason for the deployment (e.g., added a new tool).',
        },
        gapIds: {
          type: TYPE_ARRAY,
          items: { type: TYPE_STRING },
          description: 'Optional list of gap IDs to associate with this build.',
        },
      },
      required: ['reason', 'gapIds'],
      additionalProperties: false,
    },
  },
  validateCode: {
    name: 'validateCode',
    description: 'Runs type checking and linting to ensure no regressions are introduced.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  checkHealth: {
    name: 'checkHealth',
    description: 'Verify the health of the deployed agent API.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        url: { type: TYPE_STRING, description: 'The health check endpoint URL.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  triggerRollback: {
    name: 'triggerRollback',
    description: 'Trigger an emergency rollback by reverting the last commit and redeploying.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        reason: { type: TYPE_STRING, description: 'The reason for the rollback.' },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  runTests: {
    name: 'runTests',
    description: 'Runs the project unit tests to verify changes before staging.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};
