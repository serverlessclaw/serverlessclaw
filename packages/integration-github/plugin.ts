import { ClawPlugin } from '../core/lib/plugin-manager';
import { EvolutionMode } from '../core/lib/types';
import { ToolType } from '../core/lib/types/tool';

export const githubPlugin: ClawPlugin = {
  id: 'github',
  agents: {
    'github-release-manager': {
      id: 'github-release-manager',
      name: 'GitHub Release Manager',
      systemPrompt: 'You specialize in managing GitHub releases, tags, and changelogs.',
      tools: ['create_release', 'get_repo_stats'],
      evolutionMode: EvolutionMode.HITL,
      enabled: true,
    },
  },
  tools: {
    create_release: {
      name: 'create_release',
      description: 'Creates a new GitHub release.',
      type: ToolType.FUNCTION,
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['tag'],
      },
      requiresApproval: true,
      connectionProfile: ['github'],
      requiredPermissions: ['repo:write'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        // Implementation would go here
        return `GitHub release ${args.tag} created.`;
      },
    },
  },
};
