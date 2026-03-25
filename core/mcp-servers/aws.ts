import { createMCPServerHandler } from './base-handler';

/**
 * AWS MCP server handler with credentials passed via environment variables.
 * The Lambda execution role's credentials are passed to the MCP server subprocess.
 */

const serverParams = {
  command: 'npx',
  args: ['--offline', 'mcp-aws-devops-server'],
  env: {
    HOME: '/tmp',
    // AWS credentials will be injected at runtime
  },
};

export const handler = createMCPServerHandler(serverParams);
