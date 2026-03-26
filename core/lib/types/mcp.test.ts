import { describe, it, expect } from 'vitest';
import {
  MCPServerConfig,
  LocalMCPServerConfig,
  RemoteMCPServerConfig,
  ManagedMCPServerConfig,
} from './mcp';

describe('MCPServerConfig types', () => {
  describe('LocalMCPServerConfig', () => {
    it('should accept a valid local config', () => {
      const config: LocalMCPServerConfig = {
        type: 'local',
        command: 'npx some-mcp-server',
      };
      expect(config.type).toBe('local');
      expect(config.command).toBe('npx some-mcp-server');
    });

    it('should accept local config with env vars', () => {
      const config: LocalMCPServerConfig = {
        type: 'local',
        command: 'npx some-mcp-server',
        env: { API_KEY: 'test-key', DEBUG: 'true' },
      };
      expect(config.env).toEqual({ API_KEY: 'test-key', DEBUG: 'true' });
    });

    it('should allow type to be omitted (defaults to local)', () => {
      const config: LocalMCPServerConfig = {
        command: 'npx some-mcp-server',
      };
      expect(config.type).toBeUndefined();
    });
  });

  describe('RemoteMCPServerConfig', () => {
    it('should accept a valid remote config', () => {
      const config: RemoteMCPServerConfig = {
        type: 'remote',
        url: 'https://mcp.example.com/sse',
      };
      expect(config.type).toBe('remote');
      expect(config.url).toBe('https://mcp.example.com/sse');
    });
  });

  describe('ManagedMCPServerConfig', () => {
    it('should accept a valid managed config', () => {
      const config: ManagedMCPServerConfig = {
        type: 'managed',
        connector_id: 'connector_googledrive',
      };
      expect(config.type).toBe('managed');
      expect(config.connector_id).toBe('connector_googledrive');
    });

    it('should accept managed config with optional fields', () => {
      const config: ManagedMCPServerConfig = {
        type: 'managed',
        connector_id: 'connector_slack',
        name: 'Slack Connector',
        description: 'Send messages to Slack',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string' },
          },
        },
      };
      expect(config.name).toBe('Slack Connector');
      expect(config.parameters?.type).toBe('object');
    });
  });

  describe('MCPServerConfig union', () => {
    it('should accept local config as union type', () => {
      const config: MCPServerConfig = {
        type: 'local',
        command: 'npx server',
      };
      expect(config.type).toBe('local');
    });

    it('should accept remote config as union type', () => {
      const config: MCPServerConfig = {
        type: 'remote',
        url: 'https://example.com',
      };
      expect(config.type).toBe('remote');
    });

    it('should accept managed config as union type', () => {
      const config: MCPServerConfig = {
        type: 'managed',
        connector_id: 'connector_test',
      };
      expect(config.type).toBe('managed');
    });
  });
});
