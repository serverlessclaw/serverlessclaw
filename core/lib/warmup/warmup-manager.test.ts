import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarmupManager, WarmupConfig } from './warmup-manager';
import { mockDdbSend } from '../../__mocks__/dynamodb';
import { mockLambdaSend } from '../../__mocks__/lambda';

// Mock DynamoDB client
vi.mock('@aws-sdk/client-dynamodb', () => import('../../__mocks__/dynamodb'));
vi.mock('@aws-sdk/lib-dynamodb', () => import('../../__mocks__/dynamodb'));

// Mock Lambda client
vi.mock('@aws-sdk/client-lambda', () => import('../../__mocks__/lambda'));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    MemoryTable: { name: 'test-memory-table' },
  },
}));

describe('WarmupManager', () => {
  let warmupManager: WarmupManager;
  const config: WarmupConfig = {
    servers: {
      'mcp-github': 'arn:aws:lambda:us-east-1:123:function:mcp-github',
      'mcp-filesystem': 'arn:aws:lambda:us-east-1:123:function:mcp-filesystem',
    },
    agents: {
      planner: 'arn:aws:lambda:us-east-1:123:function:planner',
      coder: 'arn:aws:lambda:us-east-1:123:function:coder',
    },
    ttlSeconds: 900,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    warmupManager = new WarmupManager(config);
  });

  describe('isServerWarm', () => {
    it('should return false when no warm state exists', async () => {
      mockDdbSend.mockResolvedValue({ Items: [] });

      const result = await warmupManager.isServerWarm('mcp-github');

      expect(result).toBe(false);
    });

    it('should return true when warm state exists and is not expired', async () => {
      const futureTtl = Math.floor(Date.now() / 1000) + 600; // 10 minutes from now
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            pk: 'WARM#mcp-github',
            sk: 'STATE',
            server: 'mcp-github',
            lastWarmed: new Date().toISOString(),
            warmedBy: 'webhook',
            ttl: futureTtl,
          },
        ],
      });

      const result = await warmupManager.isServerWarm('mcp-github');

      expect(result).toBe(true);
    });

    it('should return false when warm state is expired', async () => {
      const pastTtl = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      mockDdbSend.mockResolvedValue({
        Items: [
          {
            pk: 'WARM#mcp-github',
            sk: 'STATE',
            server: 'mcp-github',
            lastWarmed: new Date().toISOString(),
            warmedBy: 'webhook',
            ttl: pastTtl,
          },
        ],
      });

      const result = await warmupManager.isServerWarm('mcp-github');

      expect(result).toBe(false);
    });

    it('should return false on query error', async () => {
      mockDdbSend.mockRejectedValue(new Error('DynamoDB error'));

      const result = await warmupManager.isServerWarm('mcp-github');

      expect(result).toBe(false);
    });
  });

  describe('warmMcpServer', () => {
    it('should warm server and record state', async () => {
      mockLambdaSend.mockResolvedValue({});
      mockDdbSend.mockResolvedValue({});

      const result = await warmupManager.warmMcpServer('mcp-github', 'webhook');

      expect(result.server).toBe('mcp-github');
      expect(result.warmedBy).toBe('webhook');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockLambdaSend).toHaveBeenCalled();
      expect(mockDdbSend).toHaveBeenCalled();
    });

    it('should throw error for unknown server', async () => {
      await expect(warmupManager.warmMcpServer('unknown-server')).rejects.toThrow(
        'MCP server unknown-server not found in config'
      );
    });

    it('should detect cold start when latency > 2000ms', async () => {
      mockLambdaSend.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({}), 2500))
      );
      mockDdbSend.mockResolvedValue({});

      const result = await warmupManager.warmMcpServer('mcp-github');

      expect(result.coldStart).toBe(true);
    });

    it('should throw error when state recording fails', async () => {
      mockLambdaSend.mockResolvedValue({});
      mockDdbSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(warmupManager.warmMcpServer('mcp-github', 'webhook')).rejects.toThrow(
        'DynamoDB error'
      );
    });
  });

  describe('warmAgent', () => {
    it('should warm agent and record state', async () => {
      mockLambdaSend.mockResolvedValue({});
      mockDdbSend.mockResolvedValue({});

      const result = await warmupManager.warmAgent('planner', 'webhook');

      expect(result.server).toBe('planner');
      expect(result.warmedBy).toBe('webhook');
      expect(mockLambdaSend).toHaveBeenCalled();
      expect(mockDdbSend).toHaveBeenCalled();
    });

    it('should throw error for unknown agent', async () => {
      await expect(warmupManager.warmAgent('unknown-agent')).rejects.toThrow(
        'Agent unknown-agent not found in config'
      );
    });
  });

  describe('smartWarmup', () => {
    it('should only warm cold servers/agents', async () => {
      // First server is warm, second is cold
      mockDdbSend
        .mockResolvedValueOnce({
          Items: [
            {
              pk: 'WARM#mcp-github',
              sk: 'STATE',
              server: 'mcp-github',
              ttl: Math.floor(Date.now() / 1000) + 600,
            },
          ],
        })
        .mockResolvedValueOnce({ Items: [] }) // mcp-filesystem is cold
        .mockResolvedValueOnce({}); // For recording warm state

      mockLambdaSend.mockResolvedValue({});

      const result = await warmupManager.smartWarmup({
        servers: ['mcp-github', 'mcp-filesystem'],
      });

      expect(result.servers).toEqual(['mcp-filesystem']);
      // Only one Lambda invocation (for the cold server)
      expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    });

    it('should warm all agents when specified', async () => {
      mockDdbSend
        .mockResolvedValueOnce({ Items: [] }) // planner is cold
        .mockResolvedValueOnce({ Items: [] }) // coder is cold
        .mockResolvedValueOnce({}) // record planner
        .mockResolvedValueOnce({}); // record coder

      mockLambdaSend.mockResolvedValue({});

      const result = await warmupManager.smartWarmup({
        agents: ['planner', 'coder'],
      });

      expect(result.agents).toEqual(['planner', 'coder']);
      expect(mockLambdaSend).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed servers and agents', async () => {
      mockDdbSend
        .mockResolvedValueOnce({ Items: [] }) // mcp-github is cold
        .mockResolvedValueOnce({ Items: [] }) // planner is cold
        .mockResolvedValueOnce({}) // record mcp-github
        .mockResolvedValueOnce({}); // record planner

      mockLambdaSend.mockResolvedValue({});

      const result = await warmupManager.smartWarmup({
        servers: ['mcp-github'],
        agents: ['planner'],
      });

      expect(result.servers).toEqual(['mcp-github']);
      expect(result.agents).toEqual(['planner']);
    });
  });

  describe('getWarmServers', () => {
    it('should return only non-expired warm states', async () => {
      const futureTtl = Math.floor(Date.now() / 1000) + 600;
      const pastTtl = Math.floor(Date.now() / 1000) - 600;

      mockDdbSend.mockResolvedValue({
        Items: [
          {
            pk: 'WARM#mcp-github',
            sk: 'STATE',
            server: 'mcp-github',
            ttl: futureTtl,
          },
          {
            pk: 'WARM#mcp-filesystem',
            sk: 'STATE',
            server: 'mcp-filesystem',
            ttl: pastTtl, // expired
          },
        ],
      });

      const result = await warmupManager.getWarmServers();

      expect(result).toHaveLength(1);
      expect(result[0].server).toBe('mcp-github');
    });

    it('should return empty array on error', async () => {
      mockDdbSend.mockRejectedValue(new Error('DynamoDB error'));

      const result = await warmupManager.getWarmServers();

      expect(result).toEqual([]);
    });
  });

  describe('cleanupExpiredStates', () => {
    it('should delete expired states', async () => {
      const pastTtl = Math.floor(Date.now() / 1000) - 600;

      mockDdbSend
        .mockResolvedValueOnce({
          Items: [
            {
              pk: 'WARM#mcp-github',
              sk: 'STATE',
              server: 'mcp-github',
              ttl: pastTtl,
            },
          ],
        })
        .mockResolvedValueOnce({}); // For deletion

      const result = await warmupManager.cleanupExpiredStates();

      expect(result).toBe(1);
      expect(mockDdbSend).toHaveBeenCalledTimes(2);
    });

    it('should not delete non-expired states', async () => {
      const futureTtl = Math.floor(Date.now() / 1000) + 600;

      mockDdbSend.mockResolvedValue({
        Items: [
          {
            pk: 'WARM#mcp-github',
            sk: 'STATE',
            server: 'mcp-github',
            ttl: futureTtl,
          },
        ],
      });

      const result = await warmupManager.cleanupExpiredStates();

      expect(result).toBe(0);
    });
  });
});
