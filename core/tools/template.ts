import { ITool } from '../lib/types/index';

export const my_new_tool: ITool = {
  name: 'my_new_tool',
  description: 'Detailed description of what this tool does for the LLM.',
  parameters: {
    type: 'object',
    properties: {
      arg1: { type: 'string', description: 'Description of arg1' },
      arg2: { type: 'number', description: 'Description of arg2' },
    },
    required: ['arg1'],
  },
  execute: async (args: Record<string, unknown>) => {
    const { arg1 } = args as { arg1: string; arg2?: number };
    try {
      // Implementation logic
      return `Successfully executed my_new_tool with ${arg1}`;
    } catch (error) {
      return `Error in my_new_tool: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

// Reminder: To enable this tool, you MUST add it to the 'tools' object in src/tools/index.ts
