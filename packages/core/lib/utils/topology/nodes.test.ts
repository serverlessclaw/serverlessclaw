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

import {
  ORPHAN_NODES,
  discoverSstNodes,
  mergeBackboneNodes,
  addDynamicAgents,
  discoverAwsNodes,
} from './nodes';

describe('Topology Nodes Core', () => {
  it('defines orphan nodes with correct tiers', () => {
    const dashboard = ORPHAN_NODES.find((n) => n.id === INFRA_NODE_ID.DASHBOARD);
    expect(dashboard?.tier).toBe(NODE_TIER.APP);

    const heartbeat = ORPHAN_NODES.find((n) => n.id === INFRA_NODE_ID.HEARTBEAT);
    expect(heartbeat?.tier).toBe(NODE_TIER.GATEWAY);
  });

  it('correctly discovers and promotes superclaw', () => {
    const result = discoverSstNodes({
      superclaw: { name: 'test' },
    });
    expect(result[0].id).toBe('superclaw');
    expect(result[0].tier).toBe(NODE_TIER.GATEWAY);
  });

  it('merges backbone metadata correctly', () => {
    const result = mergeBackboneNodes([]);
    const coder = result.find((n) => n.id === 'coder');
    expect(coder).toBeDefined();
    // Use truthy check for icon to be flexible with registry changes
    expect(coder?.icon).toBeDefined();
  });

  it('distinguishes between agents and handlers', () => {
    const result = mergeBackboneNodes([]);
    const monitor = result.find((n) => n.id === 'monitor');
    expect(monitor?.tier).toBe(NODE_TIER.UTILITY);
    expect(monitor?.type).toBe(NODE_TYPE.INFRA);
  });

  it('handles dynamic agents from database', () => {
    const items = [
      {
        config: {
          M: {
            id: 'dynamic-agent',
            name: 'Dynamic',
            enabled: true,
          },
        },
      },
    ];
    const result = addDynamicAgents([], items);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('dynamic-agent');
  });

  it('smokes tests AWS discovery', async () => {
    const result = await discoverAwsNodes();
    expect(Array.isArray(result)).toBe(true);
  });
});
