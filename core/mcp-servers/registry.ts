import { type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Central registry of all MCP server configurations.
 * These parameters are used by the Unified MCP Multiplexer to spawn
 * the appropriate child processes on-demand.
 */
export const MCP_SERVER_REGISTRY: Record<string, StdioServerParameters> = {
  git: {
    command: 'npx',
    args: ['--offline', '@cyanheads/git-mcp-server'],
    env: {
      HOME: '/tmp',
    },
  },
  filesystem: {
    command: 'npx',
    args: ['--offline', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: {
      HOME: '/tmp',
    },
  },
  'google-search': {
    command: 'npx',
    args: ['--offline', '@mcp-server/google-search-mcp'],
    env: {
      HOME: '/tmp',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? '',
      GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID ?? '',
    },
  },
  puppeteer: {
    command: 'npx',
    args: ['--offline', '@kirkdeam/puppeteer-mcp-server'],
    env: {
      HOME: '/tmp',
      PUPPETEER_EXECUTABLE_PATH: '/opt/chromium',
    },
  },
  playwright: {
    command: 'npx',
    args: ['--offline', '@mcp-server/playwright'],
    env: {
      HOME: '/tmp',
      PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers',
    },
  },
  fetch: {
    command: 'npx',
    args: ['--offline', 'mcp-fetch-server'],
    env: {
      HOME: '/tmp',
    },
  },
  aws: {
    command: 'npx',
    args: ['--offline', 'mcp-aws-devops-server'],
    env: {
      HOME: '/tmp',
    },
  },
  'aws-s3': {
    command: 'npx',
    args: ['--offline', '@geunoh/s3-mcp-server'],
    env: {
      HOME: '/tmp',
    },
  },
  ast: {
    command: 'npx',
    args: ['--offline', '@aiready/ast-mcp-server@0.1.6'],
    env: {
      HOME: '/tmp',
      NPM_CONFIG_CACHE: '/tmp/npm-cache',
      XDG_CACHE_HOME: '/tmp/mcp-cache',
    },
  },
};

export type MCPServerName = keyof typeof MCP_SERVER_REGISTRY;
