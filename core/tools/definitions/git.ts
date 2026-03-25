import { IToolDefinition } from '../../lib/types/index';

/**
 * Definitions for Git-related tools.
 */
export const gitTools: Record<string, IToolDefinition> = {
  triggerTrunkSync: {
    name: 'triggerTrunkSync',
    description:
      'Triggers a CI/CD job to sync the current verified state back to the origin main branch. This is the official "Trunk Sync" mechanism for the evolution lifecycle. Use ONLY after successful QA verification.',
    parameters: {
      type: 'object',
      properties: {
        commitMessage: {
          type: 'string',
          description:
            'The commit message to use for the sync (e.g., "chore: evolve capability X").',
        },
      },
      required: ['commitMessage'],
      additionalProperties: false,
    },
  },
};
