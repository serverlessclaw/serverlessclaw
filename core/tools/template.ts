/**
 * This is a template file for creating new tools.
 * Copy this file and modify it to create new tools.
 */
import { ITool } from '../lib/types/index';
import { formatErrorMessage } from '../lib/utils/error';

export const MY_NEW_TOOL: ITool = {
  name: 'my_new_tool',
  description: 'Detailed description of what this tool does for the LLM.',
  parameters: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: 'First argument' },
    },
    required: ['arg1'],
  },
  execute: async (args: Record<string, unknown>): Promise<string> => {
    const { arg1 } = args as { arg1: string };
    try {
      // Implementation logic
      return `Successfully executed my_new_tool with ${arg1}`;
    } catch (error) {
      return `Error in my_new_tool: ${formatErrorMessage(error)}`;
    }
  },
};

// Reminder: To enable this tool, you MUST add it to the 'tools' object in src/tools/index.ts
