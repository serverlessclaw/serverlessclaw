import { describe, it, expect, vi } from 'vitest';
import { NODE_TYPE, NODE_TIER, INFRA_NODE_ID } from './constants';

vi.mock('@aws-sdk/client-dynamodb', () => {
  const mockSend = vi.fn().mockResolvedValue({ TableNames: ['serverlessclaw-local-MemoryTable'] });
  const mockDynamoDBClient = vi.fn().mockImplementation(function () {
    return { send: mockSend };
  });
  return {
    __esModule: true,
    default: { DynamoDBClient: mockDynamoDBClient, ListTablesCommand: vi.fn() },
    DynamoDBClient: mockDynamoDBClient,
    ListTablesCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-s3', () => {
  const mockSend = vi
    .fn()
    .mockResolvedValue({ Buckets: [{ Name: 'serverlessclaw-local-KnowledgeBucket' }] });
  const mockS3Client = vi.fn().mockImplementation(function () {
    return { send: mockS3Client, ListBucketsCommand: vi.fn() };
  });
  // Fix the mock to properly return the client
  (mockS3Client as any).send = mockSend;
  return {
    __esModule: true,
    default: { S3Client: mockS3Client, ListBucketsCommand: vi.fn() },
    S3Client: mockS3Client,
    ListBucketsCommand: vi.fn(),
  };
});

vi.mock('@aws-sdk/client-lambda', () => {
  const mockSend = vi.fn().mockResolvedValue({
    Functions: [{ FunctionName: 'serverlessclaw-local-agent-runner' }],
  });
  const mockLambdaClient = vi.fn().mockImplementation(function () {
    return { send: mockSend };
  });
  return {
    __esModule: true,
    default: { LambdaClient: mockLambdaClient, ListFunctionsCommand: vi.fn() },
    LambdaClient: mockLambdaClient,
    ListFunctionsCommand: vi.fn(),
  };
});

// Remove the backbone mock and use the real one to ensure consistency with production logic
// This avoids the "Microscope vs BRAIN" icon mismatch.

import {
  ORPHAN_NODES,
  discoverSstNodes,
  mergeBackboneNodes,
  addDynamicAgents,
  discoverAwsNodes,
} from './nodes';

describe('ORPHAN_NODES', () => {
  it('contains the expected number of orphan nodes', () => {
    expect(ORPHAN_NODES.length).toBe(8);
  });

  it('includes dashboard node', () => {
    const dashboard = ORPHAN_NODES.find((n) => n.id === INFRA_NODE_ID.DASHBOARD);
    expect(dashboard).toBeDefined();
    expect(dashboard?.type).toBe(NODE_TYPE.DASHBOARD);
    expect(dashboard?.tier).toBe(NODE_TIER.APP);
  });

  it('includes scheduler node', () => {
    const scheduler = ORPHAN_NODES.find((n) => n.id === INFRA_NODE_ID.SCHEDULER);
    expect(scheduler).toBeDefined();
    expect(scheduler?.tier).toBe(NODE_TIER.APP);
  });

  it('includes heartbeat node', () => {
    const heartbeat = ORPHAN_NODES.find((n) => n.id === INFRA_NODE_ID.HEARTBEAT);
    expect(heartbeat).toBeDefined();
    expect(heartbeat?.tier).toBe(NODE_TIER.GATEWAY);
  });
});

describe('discoverSstNodes', () => {
  it('promotes superclaw to GATEWAY tier', () => {
    const result = discoverSstNodes({
      superclaw: { name: 'test' },
    });
    expect(result[0].tier).toBe(NODE_TIER.GATEWAY);
  });
});

describe('mergeBackboneNodes', () => {
  it('enriches superclaw with GATEWAY tier', () => {
    const existing = [
      {
        id: 'superclaw',
        type: NODE_TYPE.AGENT,
        label: 'Old Label',
        tier: NODE_TIER.AGENT,
      },
    ];
    const result = mergeBackboneNodes(existing);
    const superclaw = result.find((n) => n.id === 'superclaw');
    expect(superclaw?.tier).toBe(NODE_TIER.GATEWAY);
  });

  it('sets researcher icon correctly', () => {
    const result = mergeBackboneNodes([]);
    const researcher = result.find((n) => n.id === 'researcher');
    // Using real icon from backbone.ts
    expect(researcher?.icon).toBe('Microscope');
  });

  it('sets coder icon correctly', () => {
    const result = mergeBackboneNodes([]);
    const coder = result.find((n) => n.id === 'coder');
    // Using real icon from backbone.ts
    expect(coder?.icon).toBe('Code');
  });

  it('sets functional handlers to UTILITY tier', () => {
    const result = mergeBackboneNodes([]);
    const monitor = result.find((n) => n.id === 'monitor');
    expect(monitor?.tier).toBe(NODE_TIER.UTILITY);
    expect(monitor?.type).toBe(NODE_TYPE.INFRA);
  });
});

describe('addDynamicAgents', () => {
  it('handles logic agents in database items', () => {
    const items = [
      {
        config: {
          M: {
            id: 'logic-handler',
            name: 'Logic Handler',
            agentType: { S: 'logic' },
            enabled: { BOOL: true },
          },
        },
      },
    ];
    // In addDynamicAgents, we expect the raw DB structure or flattened.
    // The current implementation uses (dbItem as any).config?.M
    // so we need to match that.
    const result = addDynamicAgents([], items);
    expect(result.find((n) => n.id === 'logic-handler')).toBeDefined();
  });
});

describe('discoverAwsNodes', () => {
  it('discovers nodes from AWS services', async () => {
    // Basic smoke test for the async discovery
    const result = await discoverAwsNodes();
    expect(result).toBeDefined();
  });
});
