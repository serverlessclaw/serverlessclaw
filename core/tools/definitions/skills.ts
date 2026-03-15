import { IToolDefinition } from '../../lib/types/index';

/**
 * Skills marketplace tool definitions.
 */
export const skillsTools: Record<string, IToolDefinition> = {
  discoverSkills: {
    name: 'discoverSkills',
    description: 'Searches the global Skills Marketplace for new capabilities based on a query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Functional search query.' },
        category: {
          type: 'string',
          description: 'Optional category filter like infra, build, knowledge.',
        },
      },
      required: ['query', 'category'],
      additionalProperties: false,
    },
  },
  installSkill: {
    name: 'installSkill',
    description: "Installs a new skill into the agent's current toolset.",
    parameters: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'The name of the skill to install.' },
      },
      required: ['skillName'],
      additionalProperties: false,
    },
  },
};
