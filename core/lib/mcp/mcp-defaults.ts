import { MCPServerConfig } from '../types/mcp';

/**
 * Default MCP servers provided by Serverless Claw.
 */
export const DEFAULT_MCP_SERVERS: Record<string, MCPServerConfig> = {
  ast: { type: 'local', command: 'npx -y @aiready/ast-mcp-server@0.4.8' },
  filesystem: {
    type: 'local',
    command: 'npx --no-install -y @modelcontextprotocol/server-filesystem@0.6.2',
  },
  git: { type: 'local', command: 'npx --no-install -y @cyanheads/git-mcp-server@0.1.1' },
  'google-search': {
    type: 'local',
    command: 'npx --no-install -y @mcp-server/google-search-mcp@0.1.0',
  },
  puppeteer: {
    type: 'local',
    command: 'npx --no-install -y @kirkdeam/puppeteer-mcp-server@0.2.1',
  },
  fetch: { type: 'local', command: 'npx --no-install -y mcp-fetch-server@0.1.0' },
  aws: { type: 'local', command: 'npx --no-install -y mcp-aws-devops-server@0.1.0' },
  'aws-s3': { type: 'local', command: 'npx --no-install -y @geunoh/s3-mcp-server@0.1.0' },
};

/**
 * Common transport settings.
 */
export const TRANSPORT_DEFAULTS = {
  STDIO: {
    XDG_CACHE_HOME: '/tmp/mcp-cache',
    NPM_CONFIG_CACHE: '/tmp/npm-cache',
    HOME: '/tmp',
  },
  ALLOWED_LOCAL_IN_LAMBDA: ['filesystem', 'ast'],
};
