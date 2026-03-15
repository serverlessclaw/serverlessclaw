import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';

/**
 * Skills marketplace tool definitions.
 */
export const skillsTools: Record<string, IToolDefinition> = {
  discoverSkills: {
    name: 'discoverSkills',
    description: 'Searches the global Skills Marketplace for new capabilities based on a query.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        query: { type: TYPE_STRING, description: 'Functional search query.' },
        category: {
          type: TYPE_STRING,
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
      type: TYPE_OBJECT,
      properties: {
        skillName: { type: TYPE_STRING, description: 'The name of the skill to install.' },
      },
      required: ['skillName'],
      additionalProperties: false,
    },
  },
};
