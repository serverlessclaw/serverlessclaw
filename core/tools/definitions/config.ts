import { IToolDefinition } from '../../lib/types/index';

const TYPE_OBJECT = 'object';
const TYPE_STRING = 'string';

/**
 * Configuration tool definitions.
 */
export const configTools: Record<string, IToolDefinition> = {
  checkConfig: {
    name: 'checkConfig',
    description:
      'Retrieves the current runtime configuration, including active LLM provider and model.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  setSystemConfig: {
    name: 'setSystemConfig',
    description: 'Updates a system-wide configuration value in the ConfigTable.',
    parameters: {
      type: TYPE_OBJECT,
      properties: {
        key: {
          type: TYPE_STRING,
          description: 'The configuration key (e.g. evolution_mode, deploy_limit).',
        },
        value: {
          type: TYPE_STRING,
          description: 'The new value for the configuration (JSON stringified if object).',
        },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
};
