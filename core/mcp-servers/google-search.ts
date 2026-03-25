import { createMCPServerHandler } from './base-handler';

const serverParams = {
  command: 'npx',
  args: ['--offline', '@mcp-server/google-search-mcp'],
  env: {
    HOME: '/tmp',
    // API key should be set via Lambda environment variable or Secrets Manager
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? '',
    GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID ?? '',
  },
};

export const handler = createMCPServerHandler(serverParams);
