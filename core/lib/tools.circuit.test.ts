import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbSend: vi.fn(),
  cbSend: vi.fn(),
  ebSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mocks.dbSend })),
  },
  GetCommand: class {},
  UpdateCommand: class {},
  PutCommand: class {},
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {}),
}));

vi.mock('@aws-sdk/client-codebuild', () => ({
  CodeBuildClient: vi.fn().mockImplementation(function (this: { send: unknown }) {
    this.send = mocks.cbSend;
  }),
  StartBuildCommand: class {},
}));

vi.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: vi.fn().mockImplementation(function (this: { send: unknown }) {
    this.send = mocks.ebSend;
  }),
  PutEventsCommand: class {},
}));

vi.mock('sst', () => ({
  Resource: {
    Deployer: { name: 'MockDeployer' },
    MemoryTable: { name: 'MockTable' },
    AgentBus: { name: 'MockBus' },
  },
}));

import { tools } from '../tools/index';
import { GetCommand, UpdateCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

describe('Deployment Circuit Breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should block deployment if daily limit is reached (5)', async () => {
    mocks.dbSend.mockImplementation((command: unknown) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            id: 'system:deploy-stats',
            count: 5,
            lastReset: new Date().toISOString().split('T')[0],
          },
        });
      }
      return Promise.resolve({});
    });

    const result = await tools.trigger_deployment.execute({
      reason: 'testing circuit breaker',
      userId: 'user123',
    });

    expect(result).toContain('Daily deployment limit reached');
    expect(mocks.cbSend).not.toHaveBeenCalled();
  });

  it('should allow deployment and increment counter if limit not reached', async () => {
    mocks.dbSend.mockImplementation((command: unknown) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            id: 'system:deploy-stats',
            count: 2,
            lastReset: new Date().toISOString().split('T')[0],
          },
        });
      }
      return Promise.resolve({});
    });
    mocks.cbSend.mockResolvedValue({ build: { id: 'test-build-id' } });

    const result = await tools.trigger_deployment.execute({
      reason: 'adding new tool',
      userId: 'user123',
    });

    expect(result).toContain('Deployment started successfully');
    expect(mocks.dbSend).toHaveBeenCalledWith(expect.any(PutCommand)); // Build mapping
    expect(mocks.dbSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
  });

  it('should reset counter if the day has changed', async () => {
    mocks.dbSend.mockImplementation((command: unknown) => {
      if (command instanceof GetCommand) {
        return Promise.resolve({
          Item: {
            id: 'system:deploy-stats',
            count: 5,
            lastReset: '2000-01-01', // Old date
          },
        });
      }
      return Promise.resolve({});
    });
    mocks.cbSend.mockResolvedValue({ build: { id: 'test-build-id' } });

    const result = await tools.trigger_deployment.execute({
      reason: 'first deploy of new day',
      userId: 'user123',
    });

    expect(result).toContain('Deployment started successfully');
    expect(mocks.dbSend).toHaveBeenCalledWith(expect.any(PutCommand));
    expect(mocks.dbSend).toHaveBeenCalledWith(expect.any(UpdateCommand));
  });
});
