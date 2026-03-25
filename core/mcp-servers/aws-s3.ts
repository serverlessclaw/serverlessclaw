import { createMCPServerHandler } from './base-handler';

const serverParams = {
  command: 'npx',
  args: ['--offline', '@geunoh/s3-mcp-server'],
  env: {
    HOME: '/tmp',
    // AWS credentials will be injected at runtime
  },
};

export const handler = createMCPServerHandler(serverParams);
