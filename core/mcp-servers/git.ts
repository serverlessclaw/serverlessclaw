import { createMCPServerHandler } from './base-handler';

const serverParams = {
  command: 'npx',
  args: ['--offline', '@cyanheads/git-mcp-server'],
  env: {
    // Git MCP server will use the Lambda's /tmp directory for git operations
    HOME: '/tmp',
  },
};

export const handler = createMCPServerHandler(serverParams);
