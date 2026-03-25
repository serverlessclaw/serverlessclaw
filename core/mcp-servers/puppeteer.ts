import { createMCPServerHandler } from './base-handler';

const serverParams = {
  command: 'npx',
  args: ['--offline', '@kirkdeam/puppeteer-mcp-server'],
  env: {
    HOME: '/tmp',
    // Puppeteer needs chromium path in Lambda
    PUPPETEER_EXECUTABLE_PATH: '/opt/chromium',
  },
};

export const handler = createMCPServerHandler(serverParams);
