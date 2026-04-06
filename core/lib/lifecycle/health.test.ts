import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  checkAgentBus,
  checkToolHealth,
  checkCognitiveHealth,
  checkProviderHealth,
  reportHealthIssue,
  runDeepHealthCheck,
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
    TraceTable: { name: 'test-trace-table' },
    ConfigTable: { name: 'test-config-table' },
    StagingBucket: { name: 'test-bucket' },
    KnowledgeBucket: { name: 'test-knowledge-bucket' },
    WebhookApi: { url: 'https://test-api' },
  },
}));

vi.mock('../providers', () => {
  return {
    ProviderManager: class {
      getCapabilities = vi.fn().mockResolvedValue({ supportsStructuredOutput: true });
      getActiveProviderName = vi.fn().mockResolvedValue('test-provider');
      getActiveModelName = vi.fn().mockResolvedValue('test-model');
    },
  };
});

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../utils/bus', () => ({
  emitEvent: vi.fn().mockResolvedValue(undefined),
  EventPriority: {
    CRITICAL: 'critical',
    HIGH: 'high',
    NORMAL: 'normal',
  },
}));

vi.mock('../types/agent', () => ({
  EventType: {
    SYSTEM_HEALTH_REPORT: 'system_health_report',
  },
}));

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

  describe('checkAgentBus', () => {
    it('should return ok when ListEventBuses succeeds', async () => {
      (mockEB.send as any).mockResolvedValueOnce({});
      const result = await checkAgentBus();
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return fail when ListEventBuses fails', async () => {
      (mockEB.send as any).mockRejectedValueOnce(new Error('EB Connection Failed'));
      const result = await checkAgentBus();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('EB Connection Failed');
    });

    it('should include latency in result', async () => {
      (mockEB.send as any).mockResolvedValueOnce({});
      const result = await checkAgentBus();
      expect(typeof result.latencyMs).toBe('number');
    });
  });

  describe('checkToolHealth', () => {
    it('should verify DynamoDB, S3, and IoT', async () => {
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkToolHealth();
      expect(result.ok).toBe(true);
      const details = result.details as any;
      expect(details?.memorytable.ok).toBe(true);
      expect(details?.tracetable.ok).toBe(true);
      expect(details?.configtable.ok).toBe(true);
      expect(details?.s3.ok).toBe(true);
      expect(details?.iot.ok).toBe(true);
    });

    it('should return ok:false if MemoryTable fails', async () => {
      (mockDB.send as any).mockRejectedValueOnce(new Error('DB Timeout'));
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkToolHealth();
      expect(result.ok).toBe(false);
      const details = result.details as any;
      expect(details?.memorytable.ok).toBe(false);
    });

    it('should not fail overall if TraceTable fails but MemoryTable is ok', async () => {
      (mockDB.send as any).mockResolvedValueOnce({});
      (mockDB.send as any).mockRejectedValueOnce(new Error('TraceTable down'));
      (mockDB.send as any).mockResolvedValueOnce({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkToolHealth();
      expect(result.ok).toBe(true);
      const details = result.details as any;
      expect(details?.tracetable.ok).toBe(false);
    });

    it('should handle S3 failure gracefully', async () => {
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockRejectedValueOnce(new Error('S3 unavailable'));
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkToolHealth();
      const details = result.details as any;
      expect(details?.s3.ok).toBe(false);
      expect(details?.s3.error).toContain('S3 unavailable');
    });

    it('should handle IoT failure gracefully', async () => {
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockRejectedValueOnce(new Error('IoT down'));

      const result = await checkToolHealth();
      const details = result.details as any;
      expect(details?.iot.ok).toBe(false);
      expect(details?.iot.error).toContain('IoT down');
    });

    it('should include staging and knowledge bucket names', async () => {
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkToolHealth();
      const details = result.details as any;
      expect(details?.stagingBucket.name).toBe('test-bucket');
      expect(details?.knowledgeBucket.name).toBe('test-knowledge-bucket');
    });
  });

  describe('checkProviderHealth', () => {
    it('should return ok when provider is available', async () => {
      const result = await checkProviderHealth();
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      const provider = await result.details?.provider;
      const model = await result.details?.model;
      expect(provider).toBe('test-provider');
      expect(model).toBe('test-model');
    });
  });

  describe('checkCognitiveHealth', () => {
    it('should orchestrate all probes', async () => {
      (mockEB.send as any).mockResolvedValueOnce({});
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkCognitiveHealth();
      expect(result.ok).toBe(true);
      expect(result.results.bus.ok).toBe(true);
      expect(result.results.tools.ok).toBe(true);
      expect(result.results.providers.ok).toBe(true);
      expect(result.summary).toContain('optimal');
    });

    it('should report failures in summary', async () => {
      (mockEB.send as any).mockRejectedValueOnce(new Error('EB down'));
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkCognitiveHealth();
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('AgentBus');
    });

    it('should include timestamp', async () => {
      (mockEB.send as any).mockResolvedValueOnce({});
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkCognitiveHealth();
      expect(typeof result.timestamp).toBe('number');
    });

    it('should report multiple failures in summary', async () => {
      (mockEB.send as any).mockRejectedValueOnce(new Error('EB down'));
      (mockDB.send as any).mockRejectedValueOnce(new Error('DB down'));
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await checkCognitiveHealth();
      expect(result.ok).toBe(false);
      expect(result.summary).toContain('AgentBus');
      expect(result.summary).toContain('Core Tools');
    });
  });

  describe('reportHealthIssue', () => {
    it('should emit health issue event', async () => {
      const { emitEvent } = await import('../utils/bus');

      await reportHealthIssue({
        component: 'dynamodb',
        issue: 'Connection timeout',
        severity: 'high',
        userId: 'user-1',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        'system.health',
        'system_health_report',
        expect.objectContaining({
          component: 'dynamodb',
          issue: 'Connection timeout',
          severity: 'high',
        }),
        expect.objectContaining({ priority: 'critical' })
      );
    });

    it('should use CRITICAL priority for critical severity', async () => {
      const { emitEvent } = await import('../utils/bus');

      await reportHealthIssue({
        component: 'bus',
        issue: 'Bus down',
        severity: 'critical',
        userId: 'user-1',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        'system.health',
        'system_health_report',
        expect.any(Object),
        expect.objectContaining({ priority: 'critical' })
      );
    });

    it('should use HIGH priority for medium severity', async () => {
      const { emitEvent } = await import('../utils/bus');

      await reportHealthIssue({
        component: 's3',
        issue: 'Slow response',
        severity: 'medium',
        userId: 'user-1',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        'system.health',
        'system_health_report',
        expect.any(Object),
        expect.objectContaining({ priority: 'high' })
      );
    });

    it('should use NORMAL priority for low severity', async () => {
      const { emitEvent } = await import('../utils/bus');

      await reportHealthIssue({
        component: 'iot',
        issue: 'Minor latency',
        severity: 'low',
        userId: 'user-1',
      });

      expect(emitEvent).toHaveBeenCalledWith(
        'system.health',
        'system_health_report',
        expect.any(Object),
        expect.objectContaining({ priority: 'normal' })
      );
    });

    it('should handle emitEvent failure gracefully', async () => {
      const { emitEvent } = await import('../utils/bus');
      (emitEvent as any).mockRejectedValueOnce(new Error('Bus error'));

      await expect(
        reportHealthIssue({
          component: 'test',
          issue: 'test issue',
          severity: 'low',
          userId: 'user-1',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('runDeepHealthCheck', () => {
    it('should return ok result with summary', async () => {
      (mockEB.send as any).mockResolvedValueOnce({});
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await runDeepHealthCheck();
      expect(result.ok).toBe(true);
      expect(result.details).toContain('optimal');
    });

    it('should return not-ok with details on failure', async () => {
      (mockEB.send as any).mockRejectedValueOnce(new Error('EB down'));
      (mockDB.send as any).mockResolvedValue({});
      (mockS3.send as any).mockResolvedValueOnce({});
      (mockIot.send as any).mockResolvedValueOnce({});

      const result = await runDeepHealthCheck();
      expect(result.ok).toBe(false);
      expect(result.details).toBeDefined();
    });
  });
});
