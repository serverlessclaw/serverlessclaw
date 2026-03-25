import { IToolDefinition } from '../../lib/types/index';

/**
 * Definitions for Git-related tools.
 */
export const gitTools: Record<string, IToolDefinition> = {
  gitSync: {
    name: 'gitSync',
    description:
      'Syncs the current state of the repository with the remote main branch. This tool performs a pull (rebase), commits any local changes, and pushes to the origin main. Only use this after successful QA verification or human approval.',
    parameters: {
      type: 'object',
      properties: {
        commitMessage: {
          type: 'string',
          description: 'The commit message to use for the sync.',
        },
        skipPull: {
          type: 'boolean',
          description: 'Whether to skip the pull step (dangerous, only for emergency).',
        },
      },
      required: ['commitMessage', 'skipPull'],
      additionalProperties: false,
    },
  },
};
