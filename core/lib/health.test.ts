import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkAgentBus,
  checkToolHealth,
  checkCognitiveHealth,
  setEventBridgeClient,
  setDynamoDbClient,
  setS3Client,
  setIotClient,
} from './health';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { IoTClient } from '@aws-sdk/client-iot';

vi.mock('sst', () => ({
  Resource: {
    AgentBus: { name: 'test-bus' },
    MemoryTable: { name: 'test-table' },
    StagingBucket: { name: 'test-bucket' },
    WebhookApi: { url: 'https://test-api' },
  },
}));

vi.mock('./providers', () => {
  return {
    ProviderManager: class {
      getCapabilities = vi.fn().mockResolvedValue({ supportsStructuredOutput: true });
      getActiveProviderName = vi.fn().mockResolvedValue('test-provider');
      getActiveModelName = vi.fn().mockResolvedValue('test-model');
    },
  };
});

describe('Cognitive Health Probes', () => {
  const mockEB = {
    send: vi.fn(),
  } as unknown as EventBridgeClient;

  const mockDB = {
    send: vi.fn(),
  } as unknown as DynamoDBClient;

  const mockS3 = {
    send: vi.fn(),
  } as unknown as S3Client;

  const mockIot = {
    send: vi.fn(),
  } as unknown as IoTClient;

  beforeEach(() => {
    vi.clearAllMocks();
    setEventBridgeClient(mockEB);
    setDynamoDbClient(mockDB);
    setS3Client(mockS3);
    setIotClient(mockIot);
  });

  it('checkAgentBus should return ok when ListEventBuses succeeds', async () => {
    (mockEB.send as any).mockResolvedValueOnce({});
    const result = await checkAgentBus();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('checkAgentBus should return fail when ListEventBuses fails', async () => {
    (mockEB.send as any).mockRejectedValueOnce(new Error('EB Connection Failed'));
    const result = await checkAgentBus();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('EB Connection Failed');
  });

  it('checkToolHealth should verify DynamoDB, S3, and IoT', async () => {
    (mockDB.send as any).mockResolvedValueOnce({});
    (mockS3.send as any).mockResolvedValueOnce({});
    (mockIot.send as any).mockResolvedValueOnce({});

    const result = await checkToolHealth();
    expect(result.ok).toBe(true);
    const details = result.details as any;
    expect(details?.dynamodb.ok).toBe(true);
    expect(details?.s3.ok).toBe(true);
    expect(details?.iot.ok).toBe(true);
  });

  it('checkToolHealth should return ok:false if DynamoDB fails', async () => {
    (mockDB.send as any).mockRejectedValueOnce(new Error('DB Timeout'));
    (mockS3.send as any).mockResolvedValueOnce({});
    (mockIot.send as any).mockResolvedValueOnce({});

    const result = await checkToolHealth();
    expect(result.ok).toBe(false);
    const details = result.details as any;
    expect(details?.dynamodb.ok).toBe(false);
  });

  it('checkCognitiveHealth orchestrates all probes', async () => {
    (mockEB.send as any).mockResolvedValueOnce({});
    (mockDB.send as any).mockResolvedValueOnce({});
    (mockS3.send as any).mockResolvedValueOnce({});
    (mockIot.send as any).mockResolvedValueOnce({});

    const result = await checkCognitiveHealth();
    expect(result.ok).toBe(true);
    expect(result.results.bus.ok).toBe(true);
    expect(result.results.tools.ok).toBe(true);
    expect(result.results.providers.ok).toBe(true);
  });
});
