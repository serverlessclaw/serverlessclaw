import { createMCPServerHandler } from './base-handler';

const serverParams = {
  command: 'npx',
  args: ['--offline', 'mcp-fetch-server'],
  env: {
    HOME: '/tmp',
  },
};

export const handler = createMCPServerHandler(serverParams);
