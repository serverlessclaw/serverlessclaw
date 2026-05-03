import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { triggerDeployment, triggerInfraRebuild, stageChanges, generatePatch } from './deployment';
import { AgentType } from '../../lib/types/agent';

const codebuildMock = mockClient(CodeBuildClient);
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const mockExecSync = vi.fn();
vi.mock('child_process', () => {
  const mock = vi.fn((...args: any[]) => mockExecSync(...args));
  return {
    __esModule: true,
    default: { execSync: mock },
    execSync: mock,
  };
});

const mockArchiveOn = vi.fn();
const mockArchivePipe = vi.fn();
const mockArchiveFile = vi.fn();
const mockArchiveFinalize = vi.fn();
const mockCreateWriteStream = vi.fn();

vi.mock('archiver', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    on: mockArchiveOn,
    pipe: mockArchivePipe,
    file: mockArchiveFile,
    finalize: mockArchiveFinalize,
  })),
}));

vi.mock('fs', () => {
  const mock = vi.fn((...args: any[]) => mockCreateWriteStream(...args));
  return {
    __esModule: true,
    default: { createWriteStream: mock },
    createWriteStream: mock,
  };
});

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('test')),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sst', () => ({
  Resource: {
    ConfigTable: { name: 'test-config-table' },
    Deployer: { name: 'test-deployer' },
    MemoryTable: { name: 'test-memory-table' },
    StagingBucket: { name: 'test-staging-bucket' },
  },
}));

vi.mock('../../lib/metrics/deploy-stats', () => ({
  getDeployCountToday: vi.fn(),
  incrementDeployCount: vi.fn(),
}));

vi.mock('../../lib/safety/circuit-breaker', () => ({
  getCircuitBreaker: vi.fn(() => ({
    canProceed: vi.fn(),
    recordFailure: vi.fn(),
  })),
}));

const { mockGetAgentContext } = vi.hoisted(() => ({
  mockGetAgentContext: vi.fn(),
}));

vi.mock('../../lib/utils/agent-helpers', () => ({
  getAgentContext: mockGetAgentContext,
}));

vi.mock('../../lib/tracer', () => ({
  ClawTracer: {
    getTrace: vi.fn(),
  },
}));

import { getDeployCountToday, incrementDeployCount } from '../../lib/metrics/deploy-stats';
import { getCircuitBreaker } from '../../lib/safety/circuit-breaker';
import { getAgentContext } from '../../lib/utils/agent-helpers';

describe('Deployment Tools', () => {
  beforeEach(() => {
    codebuildMock.reset();
    ddbMock.reset();
    s3Mock.reset();
    vi.clearAllMocks();
    mockExecSync.mockReset();
    mockArchiveOn.mockReset();
    mockArchivePipe.mockReset();
    mockArchiveFile.mockReset();
    mockArchiveFinalize.mockReset();
    mockCreateWriteStream.mockReset();
    process.env.AGENT_ID = AgentType.CODER;
    vi.mocked(getAgentContext).mockResolvedValue({
      memory: {
        getAllGaps: vi.fn().mockResolvedValue([]),
        getSessionMetadata: vi.fn().mockResolvedValue({ workspaceId: 'ws-123' }),
      },
    } as any);
  });

  describe('triggerDeployment', () => {
    it('has correct tool definition', () => {
      expect(triggerDeployment.name).toBe('triggerDeployment');
      expect(triggerDeployment.description).toBeDefined();
      expect(triggerDeployment.parameters).toBeDefined();
    });

    it('triggers deployment successfully when all checks pass', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      vi.mocked(incrementDeployCount).mockResolvedValue(true);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-123' } });
      ddbMock.on(PutCommand).resolves({});

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('SUCCESS: Deployment triggered');
      expect(result).toContain('build-123');
    });

    it('blocks deployment when circuit breaker is active', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({
          allowed: false,
          reason: 'Too many failures',
        }),
        recordFailure: vi.fn(),
      } as any);

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('CIRCUIT_BREAKER_ACTIVE');
      expect(result).toContain('Too many failures');
    });

    it('blocks deployment when daily limit is reached', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(10);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('CIRCUIT_BREAKER_ACTIVE');
      expect(result).toContain('Daily deployment limit reached');
    });

    it('handles errors during deployment', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      ddbMock.on(GetCommand).rejects(new Error('DynamoDB error'));

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('FAILED_TO_DEPLOY');
    });

    it('passes metadata as environment variables to CodeBuild', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      vi.mocked(incrementDeployCount).mockResolvedValue(true);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getAllGaps: vi.fn().mockResolvedValue([]),
        },
      } as any);
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-env-123' } });
      ddbMock.on(PutCommand).resolves({});

      await triggerDeployment.execute({
        reason: 'test env vars',
        userId: 'user-456',
        traceId: 'trace-789',
        gapIds: ['GAP#1', 'GAP#2'],
      });

      expect(codebuildMock.calls()).toHaveLength(1);
      const startCall = codebuildMock.call(0);
      const envVars = (startCall.args[0] as any).input.environmentVariablesOverride;

      expect(envVars).toContainEqual({
        name: 'GAP_IDS',
        value: JSON.stringify(['GAP#1', 'GAP#2']),
      });
      expect(envVars).toContainEqual({ name: 'INITIATOR_USER_ID', value: 'user-456' });
      expect(envVars).toContainEqual({ name: 'TRACE_ID', value: 'trace-789' });
    });

    it('blocks deployment when a target gap is still in exponential backoff', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getAllGaps: vi.fn().mockResolvedValue([
            {
              id: 'GAP#123',
              timestamp: Date.now() - 1000,
              content: 'backoff gap',
              metadata: {
                category: 'strategic_gap',
                confidence: 5,
                impact: 5,
                complexity: 5,
                risk: 5,
                urgency: 5,
                priority: 5,
                retryCount: 3,
                lastAttemptTime: Date.now() - 60_000,
              },
            },
          ]),
        },
      } as any);

      const result = await triggerDeployment.execute({
        reason: 'retry deployment',
        userId: 'test-user',
        gapIds: ['GAP#123'],
      });

      expect(result).toContain('BACKOFF_ACTIVE');
      expect(codebuildMock.calls()).toHaveLength(0);
    });

    it('blocks deployment when infrastructure resources are not fully linked', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      codebuildMock.on(StartBuildCommand).resolves(undefined as any);

      const result = await triggerDeployment.execute({
        reason: 'test deployment',
        userId: 'test-user',
      });

      expect(result).toContain('FAILED_TO_DEPLOY');
    });

    it('infers gapIds from trace context when not provided', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      vi.mocked(incrementDeployCount).mockResolvedValue(true);
      ddbMock.on(GetCommand).resolves({ Item: { value: '10' } });
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-inferred-1' } });
      ddbMock.on(PutCommand).resolves({});

      const { ClawTracer } = await import('../../lib/tracer');
      vi.mocked(ClawTracer.getTrace).mockResolvedValueOnce([
        {
          traceId: 'trace-inferred',
          nodeId: 'root',
          initialContext: {
            metadata: { gapIds: ['GAP#INFERRED'] },
          },
        } as any,
      ]);

      await triggerDeployment.execute({
        reason: 'test inference',
        userId: 'user-inf',
        traceId: 'trace-inferred',
      });

      const startCall = codebuildMock.call(0);
      const envVars = (startCall.args[0] as any).input.environmentVariablesOverride;
      expect(envVars).toContainEqual({
        name: 'GAP_IDS',
        value: JSON.stringify(['GAP#INFERRED']),
      });
    });

    it('uses STAGING_ZIP_KEY fallback if traceId is missing', async () => {
      vi.mocked(getCircuitBreaker).mockReturnValue({
        canProceed: vi.fn().mockResolvedValue({ allowed: true }),
        recordFailure: vi.fn(),
      } as any);
      vi.mocked(getDeployCountToday).mockResolvedValue(0);
      vi.mocked(incrementDeployCount).mockResolvedValue(true);
      ddbMock.on(GetCommand, { Key: { key: 'deploy_limit' } }).resolves({ Item: { value: '10' } });
      ddbMock.on(GetCommand, { Key: { key: 'staging_zip_key' } }).resolves({});
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'build-fallback-2' } });

      await triggerDeployment.execute({
        reason: 'test fallback zip',
        userId: 'user-zip',
      });

      const startCall = codebuildMock.call(0);
      const envVars = (startCall.args[0] as any).input.environmentVariablesOverride;
      expect(envVars).toContainEqual({
        name: 'STAGING_ZIP_KEY',
        value: 'latest/staging.zip',
      });
    });
  });

  describe('triggerInfraRebuild', () => {
    it('has correct tool definition', () => {
      expect(triggerInfraRebuild.name).toBe('triggerInfraRebuild');
      expect(triggerInfraRebuild.description).toBeDefined();
      expect(triggerInfraRebuild.requiresApproval).toBe(true);
    });

    it('triggers infra rebuild successfully', async () => {
      codebuildMock.on(StartBuildCommand).resolves({ build: { id: 'rebuild-456' } });

      const result = await triggerInfraRebuild.execute({
        reason: 'sst.config.ts changed',
      });

      expect(result).toContain('SUCCESS: Infra rebuild triggered');
      expect(result).toContain('rebuild-456');
      expect(result).toContain('sst.config.ts changed');
    });

    it('handles errors during infra rebuild', async () => {
      codebuildMock.on(StartBuildCommand).rejects(new Error('CodeBuild error'));

      const result = await triggerInfraRebuild.execute({
        reason: 'test rebuild',
      });

      expect(result).toContain('FAILED_TO_REBUILD');
    });
  });

  describe('generatePatch', () => {
    it('has correct tool definition', () => {
      expect(generatePatch.name).toBe('generatePatch');
      expect(generatePatch.description).toBeDefined();
      expect(generatePatch.parameters).toBeDefined();
    });

    it('returns FAILED_DOD when recallKnowledge was not called', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([{ content: 'VERIFICATION_SUCCESSFUL' }]),
        },
      } as any);

      const result = await generatePatch.execute({
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_DOD');
      expect(result).toContain('Call recallKnowledge first');
    });

    it('returns FAILED_DOD when validation was not performed', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([{ content: 'some other content' }]),
        },
      } as any);

      const result = await generatePatch.execute({
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_DOD');
      expect(result).toContain('fully verified (verifyChanges) before generating patch');
    });

    it('skips validation when skipValidation is true', async () => {
      mockExecSync.mockReturnValue('diff --git a/file.ts\n+++ b/file.ts\n+new line');

      const result = await generatePatch.execute({
        sessionId: 'test-session',
        skipValidation: true,
      });

      expect(result).toContain('PATCH_START');
      expect(result).toContain('PATCH_END');
    });

    it('returns NO_CHANGES when there are no differences', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockReturnValue('');

      const result = await generatePatch.execute({
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('NO_CHANGES');
    });

    it('handles errors during patch generation', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockImplementation(() => {
        throw new Error('git error');
      });

      const result = await generatePatch.execute({
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_TO_GENERATE_PATCH');
    });
  });

  describe('stageChanges', () => {
    it('has correct tool definition', () => {
      expect(stageChanges.name).toBe('stageChanges');
      expect(stageChanges.description).toBeDefined();
      expect(stageChanges.parameters).toBeDefined();
    });

    it('returns FAILED_DOD when validation was not performed', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([{ content: 'some content' }]),
        },
      } as any);

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_DOD');
      expect(result).toContain('fully verified (verifyChanges) before staging');
    });

    it('returns FAILED_DOD when testing was not performed', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([{ content: 'VERIFICATION_SUCCESSFUL: partial' }]),
        },
      } as any);

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      // Should fail on recallKnowledge if VERIFICATION_SUCCESSFUL is present
      expect(result).toContain('recallKnowledge');
    });

    it('returns FAILED_DOD when recallKnowledge was not called', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([{ content: 'VERIFICATION_SUCCESSFUL' }]),
        },
      } as any);

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_DOD');
      expect(result).toContain('Call recallKnowledge first');
    });

    it('returns message when no files to stage', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockReturnValue('');

      const result = await stageChanges.execute({
        modifiedFiles: [],
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('No files to stage');
    });

    it('includes git modified files in staging', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockReturnValue('git-file.ts\nanother-file.ts\n');

      let archiveCloseCb: (() => void) | null = null;
      mockArchiveOn.mockImplementation(function (
        this: any,
        event: string,
        cb: (...args: any[]) => void
      ) {
        if (event === 'close') {
          archiveCloseCb = cb as () => void;
        }
        return this;
      });
      mockCreateWriteStream.mockReturnValue({
        on: function (event: string, cb: (...args: any[]) => void) {
          if (event === 'close') {
            setImmediate(() => cb());
          }
          return this;
        },
      });
      mockArchiveFinalize.mockImplementation(() => {
        if (archiveCloseCb) archiveCloseCb();
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result).toContain('SUCCESS');
      expect(result).toContain('files staged for deployment');
    });

    it('falls back to provided files when git status fails', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockImplementation(() => {
        throw new Error('git error');
      });

      let archiveCloseCb: (() => void) | null = null;
      mockArchiveOn.mockImplementation(function (
        this: any,
        event: string,
        cb: (...args: any[]) => void
      ) {
        if (event === 'close') {
          archiveCloseCb = cb as () => void;
        }
        return this;
      });
      mockCreateWriteStream.mockReturnValue({
        on: function (event: string, cb: (...args: any[]) => void) {
          if (event === 'close') {
            setImmediate(() => cb());
          }
          return this;
        },
      });
      mockArchiveFinalize.mockImplementation(() => {
        if (archiveCloseCb) archiveCloseCb();
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result).toContain('SUCCESS');
    });

    it('returns FAILED_TO_UPLOAD when S3 upload fails', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockReturnValue('file.ts\n');

      let archiveCloseCb: (() => void) | null = null;
      mockArchiveOn.mockImplementation(function (
        this: any,
        event: string,
        cb: (...args: any[]) => void
      ) {
        if (event === 'close') {
          archiveCloseCb = cb as () => void;
        }
        return this;
      });
      mockCreateWriteStream.mockReturnValue({
        on: function (event: string, cb: (...args: any[]) => void) {
          if (event === 'close') {
            setImmediate(() => cb());
          }
          return this;
        },
      });
      mockArchiveFinalize.mockImplementation(() => {
        if (archiveCloseCb) archiveCloseCb();
      });

      s3Mock.on(PutObjectCommand).rejects(new Error('S3 upload failed'));

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result).toContain('FAILED_TO_UPLOAD');
    });

    it('returns FAILED_TO_ZIP when archiver encounters an error', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockResolvedValue([
            { content: 'VERIFICATION_SUCCESSFUL' },
            {
              tool_calls: [{ function: { name: 'recallKnowledge' } }],
            },
          ]),
        },
      } as any);

      mockExecSync.mockReturnValue('file.ts\n');

      let archiveErrorCb: ((err: Error) => void) | null = null;
      mockArchiveOn.mockImplementation(function (
        this: any,
        event: string,
        cb: (...args: any[]) => void
      ) {
        if (event === 'error') {
          archiveErrorCb = cb as (err: Error) => void;
        }
        return this;
      });
      mockCreateWriteStream.mockReturnValue({
        on: function () {
          return this;
        },
      });

      mockArchiveFinalize.mockImplementation(() => {
        if (archiveErrorCb) {
          archiveErrorCb(new Error('Archive error'));
        }
      });

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_TO_ZIP');
    });

    it('returns FAILED_TO_STAGE when an unexpected error occurs', async () => {
      vi.mocked(getAgentContext).mockResolvedValue({
        memory: {
          getHistory: vi.fn().mockRejectedValue(new Error('Memory error')),
        },
      } as any);

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: false,
      });

      expect(result).toContain('FAILED_TO_STAGE');
    });

    it('skips validation when skipValidation is true for stageChanges', async () => {
      mockExecSync.mockReturnValue('file.ts\n');

      let archiveCloseCb: (() => void) | null = null;
      mockArchiveOn.mockImplementation(function (
        this: any,
        event: string,
        cb: (...args: any[]) => void
      ) {
        if (event === 'close') {
          archiveCloseCb = cb as () => void;
        }
        return this;
      });
      mockCreateWriteStream.mockReturnValue({
        on: function (event: string, cb: (...args: any[]) => void) {
          if (event === 'close') {
            setImmediate(() => cb());
          }
          return this;
        },
      });
      mockArchiveFinalize.mockImplementation(() => {
        if (archiveCloseCb) archiveCloseCb();
      });

      s3Mock.on(PutObjectCommand).resolves({});

      const result = await stageChanges.execute({
        modifiedFiles: ['file.ts'],
        sessionId: 'test-session',
        skipValidation: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result).toContain('SUCCESS');
    });
  });
});
