import { createMCPServerHandler } from './base-handler';

const serverParams = {
  command: 'npx',
  args: ['--offline', '@modelcontextprotocol/server-filesystem', '/tmp'],
  env: {
    HOME: '/tmp',
  },
};

export const handler = createMCPServerHandler(serverParams);
