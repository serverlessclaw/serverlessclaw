import { describe, it, expect } from 'vitest';
import { MCP_SERVER_REGISTRY } from './registry';

describe('MCP Server Registry', () => {
  it('should have all required external MCP servers registered', () => {
    expect(MCP_SERVER_REGISTRY).toHaveProperty('git');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('filesystem');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('google-search');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('puppeteer');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('fetch');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('aws');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('aws-s3');
    expect(MCP_SERVER_REGISTRY).toHaveProperty('ast');
  });

  describe('Security Boundaries', () => {
    it('filesystem MCP must be restricted to /tmp directory only', () => {
      const fsServer = MCP_SERVER_REGISTRY.filesystem;
      expect(fsServer).toBeDefined();

      // Ensure the arguments enforce the directory boundary
      const args = fsServer.args ?? [];
      expect(args).toContain('/tmp');

      // Ensure it does not allow access to root or sensitive directories
      expect(args).not.toContain('/');
      expect(args).not.toContain('/etc');
      expect(args).not.toContain('.env');

      // The last argument for @modelcontextprotocol/server-filesystem is the allowed directory list
      const lastArg = args[args.length - 1];
      expect(lastArg).toBe('/tmp');
    });

    it('all servers should run offline where possible', () => {
      Object.entries(MCP_SERVER_REGISTRY).forEach(([_name, config]) => {
        // fetch and google-search need internet, but the npx command itself should use --offline
        // to prevent downloading new packages at runtime
        expect(config.args).toContain('--offline');
      });
    });

    it('HOME directory should be overridden to /tmp for safety', () => {
      Object.entries(MCP_SERVER_REGISTRY).forEach(([_name, config]) => {
        expect(config.env?.HOME).toBe('/tmp');
      });
    });
  });
});
