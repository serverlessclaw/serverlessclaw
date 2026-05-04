import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

class MockFunction {
  arn: string;
  url: string;
  subscribe = vi.fn();
  route = vi.fn();
  nodes = { function: { name: '' } };
  constructor(
    public name: string,
    public args: any
  ) {
    this.arn = `arn:aws:lambda:us-east-1:123456789012:function:${name}`;
    this.url = `https://${name}.lambda-url.us-east-1.on.aws/`;
    this.nodes.function.name = name;
  }
}

class MockBus {
  arn: string;
  subscribe = vi.fn();
  constructor(public name: string) {
    this.arn = `arn:aws:events:us-east-1:123456789012:event-bus/${name}`;
  }
}

class MockRealtime {
  endpoint: string;
  constructor(
    public name: string,
    public args: any
  ) {
    this.endpoint = `https://${name}.iot.us-east-1.amazonaws.com`;
  }
}

class MockQueue {
  arn: string;
  subscribe = vi.fn();
  constructor(
    public name: string,
    public args: any
  ) {
    this.arn = `arn:aws:sqs:us-east-1:123456789012:${name}`;
  }
}

class MockApi {
  url: string;
  route = vi.fn();
  constructor(
    public name: string,
    public args: any
  ) {
    this.url = `https://${name}.execute-api.us-east-1.amazonaws.com`;
  }
}

import { MockDynamo } from './__mocks__/MockDynamo';

class MockBucket {
  arn: string;
  constructor(public name: string) {
    this.arn = `arn:aws:s3:::${name}`;
  }
}

class MockSecret {
  constructor(public name: string) {}
  get value() {
    return `secret-value-for-${this.name}`;
  }
}

class MockLinkable {
  constructor(
    public name: string,
    public args: any
  ) {}
}

class MockNextjs {
  constructor(
    public name: string,
    public args: any
  ) {}
}

const mockFunction = vi.fn(MockFunction as any);
const mockBus = vi.fn(MockBus as any);
const mockRealtime = vi.fn(MockRealtime as any);
const mockQueue = vi.fn(MockQueue as any);
const mockApi = vi.fn(MockApi as any);
const mockDynamo = vi.fn(function (name: string, args?: any) {
  return new MockDynamo(name, args);
});
const mockBucket = vi.fn(MockBucket as any);
const mockSecret = vi.fn(MockSecret as any);
const mockLinkable = vi.fn(MockLinkable as any);
const mockNextjs = vi.fn(MockNextjs as any);

vi.stubGlobal('sst', {
  aws: {
    Function: mockFunction,
    Bus: mockBus,
    Realtime: mockRealtime,
    Queue: mockQueue,
    ApiGatewayV2: mockApi,
    Dynamo: mockDynamo,
    Bucket: mockBucket,
    Nextjs: mockNextjs,
  },
  cloudflare: {
    dns: vi.fn(),
  },
  Secret: mockSecret,
  Linkable: mockLinkable,
});

vi.stubGlobal('$app', {
  stage: 'dev',
  name: 'serverlessclaw',
});

vi.stubGlobal('$util', {
  jsonStringify: (obj: any) => JSON.stringify(obj),
  interpolate: (strings: TemplateStringsArray, ...values: any[]) => {
    let result = strings[0];
    for (let i = 0; i < values.length; i++) {
      result += values[i] + strings[i + 1];
    }
    return result;
  },
});

// Mock aws-sdk or other globals if needed
class MockRole {
  constructor(
    public name: string,
    public args: any
  ) {}
  get arn() {
    return `arn:aws:iam::123456789012:role/${this.name}`;
  }
}

class MockEventRule {
  arn: string;
  constructor(
    public name: string,
    public args: any
  ) {
    this.arn = `arn:aws:events:us-east-1:123456789012:rule/${name}`;
  }
}

class MockProject {
  arn: string;
  constructor(
    public name: any,
    public args: any
  ) {
    this.arn = `arn:aws:codebuild:us-east-1:123456789012:project/${name}`;
  }
}

vi.stubGlobal('aws', {
  iam: {
    Role: vi.fn(MockRole as any),
    RolePolicy: vi.fn(),
  },
  scheduler: {
    Schedule: vi.fn(),
  },
  lambda: {
    Permission: vi.fn(),
  },
  codebuild: {
    Project: vi.fn(MockProject as any),
  },
  cloudwatch: {
    EventRule: vi.fn(MockEventRule as any),
    EventTarget: vi.fn(),
  },
  getRegionOutput: vi.fn().mockReturnValue({ name: { apply: (fn: any) => fn('us-east-1') } }),
  getCallerIdentityOutput: vi
    .fn()
    .mockReturnValue({ accountId: { apply: (fn: any) => fn('123456789012') } }),
});

// --- Imports after mocks ---
import { createBus } from './bus';
import { createApi, configureApiRoutes } from './api';
import { createMCPServers } from './mcp-servers';
import { createAgents } from './agents';
import { createStorage } from './storage';
import { createDeployer } from './deployer';
import { createDashboard } from './dashboard';
import { SharedContext } from './shared';

describe('Infrastructure Resource Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDashboard', () => {
    it('should create Nextjs app with links', () => {
      const mockCtx = {
        memoryTable: new MockDynamo('memory'),
        traceTable: new MockDynamo('trace'),
        configTable: new MockDynamo('config'),
        stagingBucket: { name: 'staging', arn: 'arn:s3:staging' },
        knowledgeBucket: { name: 'knowledge', arn: 'arn:s3:knowledge' },
        bus: { name: 'bus', arn: 'arn:bus' },
        deployer: { name: 'deployer' },
        deployerLink: { name: 'deployerLink' },
        schedulerRole: { arn: 'arn:role' },
        heartbeatHandler: { arn: 'arn:heartbeat' },
        secrets: {
          DashboardPassword: new MockSecret('DashboardPassword'),
        },
      };

      const result = createDashboard(mockCtx as any);

      expect(mockNextjs).toHaveBeenCalledWith('ClawCenter', expect.any(Object));
      expect(result.dashboard).toBeDefined();
    });
  });

  describe('createDeployer', () => {
    it('should create CodeBuild project and Linkable', () => {
      const mockCtx = {
        stagingBucket: { name: 'staging', arn: 'arn:s3:staging' },
        githubToken: new MockSecret('github'),
      };

      const result = createDeployer(mockCtx as any);

      expect(aws.iam.Role).toHaveBeenCalledWith('DeployerRole', expect.any(Object));
      expect(aws.codebuild.Project).toHaveBeenCalledWith('Deployer', expect.any(Object));
      expect(mockLinkable).toHaveBeenCalledWith('Deployer', expect.any(Object));

      expect(result.deployer).toBeDefined();
      expect(result.linkable).toBeDefined();
    });
  });

  describe('createStorage', () => {
    it('should create Dynamo tables, buckets, and secrets', () => {
      const result = createStorage();

      expect(mockDynamo).toHaveBeenCalledWith('MemoryTable', expect.any(Object));
      expect(mockDynamo).toHaveBeenCalledWith('TraceTable', expect.any(Object));
      expect(mockDynamo).toHaveBeenCalledWith('ConfigTable', expect.any(Object));
      expect(mockBucket).toHaveBeenCalledWith('StagingBucket', expect.any(Object));
      expect(mockBucket).toHaveBeenCalledWith('KnowledgeBucket', expect.any(Object));
      expect(mockSecret).toHaveBeenCalledWith('TelegramBotToken');

      expect(result.memoryTable).toBeDefined();
      expect(result.secrets).toBeDefined();
    });
  });

  describe('createAgents', () => {
    it('should create all agent functions and subscriptions', () => {
      const mockCtx = {
        memoryTable: new MockDynamo('memory'),
        traceTable: new MockDynamo('trace'),
        configTable: new MockDynamo('config'),
        stagingBucket: { name: 'staging', arn: 'arn:s3:staging' },
        knowledgeBucket: { name: 'knowledge' },
        secrets: {},
        bus: new MockBus('bus'),
        deployer: {
          name: { apply: (fn: any) => fn('deployer') },
          arn: 'arn:codebuild:deployer',
        },
        deployerLink: { name: 'deployerLink' },
        dlq: new MockQueue('dlq', {}),
      } as unknown as SharedContext;

      const mcpServers = {
        multiplexer: { arn: 'arn:mcp:general' },
        browserMultiplexer: { arn: 'arn:mcp:browser' },
        devOpsMultiplexer: { arn: 'arn:mcp:devops' },
      };

      const result = createAgents(mockCtx, mcpServers as any);

      expect(mockFunction).toHaveBeenCalledWith('HeartbeatHandler', expect.any(Object));
      expect(mockFunction).toHaveBeenCalledWith('HighPowerMultiplexer', expect.any(Object));
      expect(mockFunction).toHaveBeenCalledWith('StandardMultiplexer', expect.any(Object));
      expect(mockFunction).toHaveBeenCalledWith('LightMultiplexer', expect.any(Object));

      // Check subscriptions
      expect(mockCtx.bus.subscribe).toHaveBeenCalledWith(
        'HighPowerSubscriber',
        expect.any(String),
        expect.any(Object)
      );
      expect(mockCtx.bus.subscribe).toHaveBeenCalledWith(
        'StandardSubscriber',
        expect.any(String),
        expect.any(Object)
      );
      expect(mockCtx.bus.subscribe).toHaveBeenCalledWith(
        'LightSubscriber',
        expect.any(String),
        expect.any(Object)
      );

      expect(result.coderAgent).toBeDefined();
      expect(result.qaAgent).toBeDefined();
    });

    it('should create agents without mcpServers', () => {
      const mockCtx = {
        memoryTable: new MockDynamo('memory'),
        traceTable: new MockDynamo('trace'),
        configTable: new MockDynamo('config'),
        stagingBucket: { name: 'staging', arn: 'arn:s3:staging' },
        knowledgeBucket: { name: 'knowledge' },
        secrets: {},
        bus: new MockBus('bus'),
        deployer: {
          name: { apply: (fn: any) => fn('deployer') },
          arn: 'arn:codebuild:deployer',
        },
        deployerLink: { name: 'deployerLink' },
        dlq: new MockQueue('dlq', {}),
      } as unknown as SharedContext;

      const result = createAgents(mockCtx);

      expect(mockFunction).toHaveBeenCalledWith('HeartbeatHandler', expect.any(Object));
      expect(result.coderAgent).toBeDefined();
    });
  });

  describe('createBus', () => {
    it('should create Bus, Realtime, and Queue', () => {
      const result = createBus();

      expect(mockBus).toHaveBeenCalledWith('AgentBus');
      expect(mockRealtime).toHaveBeenCalledWith('RealtimeBus', expect.any(Object));
      expect(mockQueue).toHaveBeenCalledWith('EventDLQ', expect.any(Object));

      expect(result.bus).toBeDefined();
      expect(result.realtime).toBeDefined();
      expect(result.dlq).toBeDefined();
    });
  });

  describe('createMCPServers', () => {
    it('should create three multiplexer functions', () => {
      const mockCtx = {
        memoryTable: { name: 'memory' },
        configTable: { name: 'config' },
        secrets: {},
        stagingBucket: { arn: 'arn:s3:staging' },
        knowledgeBucket: { arn: 'arn:s3:knowledge' },
      } as unknown as SharedContext;

      const result = createMCPServers(mockCtx);

      expect(mockFunction).toHaveBeenCalledWith('GeneralMCPMultiplexer', expect.any(Object));
      expect(mockFunction).toHaveBeenCalledWith('BrowserMCPMultiplexer', expect.any(Object));
      expect(mockFunction).toHaveBeenCalledWith('DevOpsMCPMultiplexer', expect.any(Object));

      expect(result.multiplexer).toBeDefined();
      expect(result.browserMultiplexer).toBeDefined();
      expect(result.devOpsMultiplexer).toBeDefined();
    });

    it('should configure DevOpsMultiplexer with correct permissions', () => {
      const mockCtx = {
        memoryTable: { name: 'memory' },
        configTable: { name: 'config' },
        secrets: {},
        stagingBucket: { arn: 'arn:s3:staging' },
        knowledgeBucket: { arn: 'arn:s3:knowledge' },
      } as unknown as SharedContext;

      createMCPServers(mockCtx);

      const devOpsArgs = mockFunction.mock.calls.find(
        (call) => call[0] === 'DevOpsMCPMultiplexer'
      )![1] as any;
      expect(devOpsArgs.permissions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actions: expect.arrayContaining(['s3:GetObject']),
          }),
          expect.objectContaining({
            actions: expect.arrayContaining(['codebuild:StartBuild']),
          }),
        ])
      );
    });
  });

  describe('createApi', () => {
    it('should create an ApiGatewayV2', () => {
      const mockCtx = {} as SharedContext;
      const result = createApi(mockCtx);
      expect(mockApi).toHaveBeenCalledWith('WebhookApi', expect.any(Object));
      expect(result.api).toBeDefined();
    });
  });

  describe('configureApiRoutes', () => {
    it('should configure /webhook and /health routes', () => {
      const mockApiInstance = {
        route: vi.fn(),
      } as unknown as sst.aws.ApiGatewayV2;

      const mockCtx = {
        memoryTable: { name: 'memory' },
        traceTable: { name: 'trace' },
        configTable: { name: 'config' },
        stagingBucket: { name: 'staging' },
        knowledgeBucket: { name: 'knowledge' },
        secrets: {},
        bus: { name: 'bus' },
        deployerLink: { name: 'deployer' },
        agents: {
          plannerAgent: { arn: 'arn:planner' },
          coderAgent: { arn: 'arn:coder' },
          reflectorAgent: { arn: 'arn:reflector' },
          qaAgent: { arn: 'arn:qa' },
          mergerAgent: { arn: 'arn:merger' },
          criticAgent: { arn: 'arn:critic' },
          agentRunner: { arn: 'arn:runner' },
        },
      } as unknown as SharedContext;

      configureApiRoutes(mockApiInstance, mockCtx);

      expect(mockApiInstance.route).toHaveBeenCalledWith('ANY /webhook', expect.any(Object));
      expect(mockApiInstance.route).toHaveBeenCalledWith('GET /health', expect.any(Object));
    });
  });
});
