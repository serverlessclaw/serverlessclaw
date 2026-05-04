import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

import { MockDynamo } from './__mocks__/MockDynamo';

class MockFunction {
  arn = 'mock-arn';
  constructor(
    public name: string,
    public args: any
  ) {}
}

class MockBus {
  subscribe = vi.fn();
  constructor(public name: string) {}
}

class MockRole {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class MockGeneric {
  arn = 'mock-arn';
  subscribe = vi.fn();
  constructor(
    public name: string,
    public args: any
  ) {}
}

const mockDynamo = vi.fn(function (name: string, args?: any) {
  return new MockDynamo(name, args);
});
const mockFunction = vi.fn(function (name, args) {
  return new MockFunction(name, args);
});
const mockBus = vi.fn(function (name) {
  return new MockBus(name);
});
const mockRole = vi.fn(function (name) {
  return new MockRole(name);
});
const mockGeneric = vi.fn(function (name, args) {
  return new MockGeneric(name, args);
});

vi.stubGlobal('sst', {
  aws: {
    Dynamo: mockDynamo,
    Function: mockFunction,
    Bus: mockBus,
    Bucket: mockGeneric,
    Queue: mockGeneric,
  },
  Secret: mockGeneric,
  Linkable: mockGeneric,
});

vi.stubGlobal('$app', {
  stage: 'prod',
  name: 'serverlessclaw',
});

vi.stubGlobal('$util', {
  jsonStringify: (obj: any) => JSON.stringify(obj),
  interpolate: (strings: any, ...values: any[]) => {
    let res = strings[0];
    for (let i = 0; i < values.length; i++) {
      res += values[i] + strings[i + 1];
    }
    return res;
  },
});

vi.stubGlobal('aws', {
  iam: { Role: mockRole, RolePolicy: mockGeneric },
  codebuild: { Project: mockGeneric },
  getRegionOutput: vi.fn(() => ({ name: 'ap-southeast-2' })),
  getCallerIdentityOutput: vi.fn(() => ({ accountId: '123456789012' })),
  scheduler: { Schedule: mockGeneric },
  cloudwatch: { EventRule: mockGeneric, EventTarget: mockGeneric },
  lambda: { Permission: mockGeneric },
});

// --- Imports after mocks ---
import { createStorage } from './storage';
import { createAgents } from './agents';

describe('Infrastructure Cost Guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DynamoDB Serverless Configuration', () => {
    it('should explicitly set billingMode to PAY_PER_REQUEST for all tables', () => {
      createStorage();

      const dynamoCalls = mockDynamo.mock.calls;
      expect(dynamoCalls.length).toBeGreaterThan(0);

      dynamoCalls.forEach((call) => {
        const tableName = call[0];
        const args = call[1] as any;

        expect(
          args.transform?.table?.billingMode,
          `Table ${tableName} must be On-Demand (PAY_PER_REQUEST)`
        ).toBe('PAY_PER_REQUEST');
      });
    });
  });

  describe('Lambda Cost Efficiency', () => {
    it('should use ARM64 architecture for better price-performance', () => {
      // Mock necessary context for createAgents
      const mockCtx = {
        memoryTable: new MockDynamo('memory', {}),
        traceTable: new MockDynamo('trace', {}),
        configTable: new MockDynamo('config', {}),
        stagingBucket: { arn: 'arn' },
        bus: new MockBus('bus'),
        deployer: { name: { apply: (fn: any) => fn('d') } },
        dlq: new MockGeneric('dlq', {}),
        secrets: {},
      };

      createAgents(mockCtx as any);

      const functionCalls = mockFunction.mock.calls;
      expect(functionCalls.length).toBeGreaterThan(0);

      functionCalls.forEach((call) => {
        const functionName = call[0];
        const args = call[1] as any;

        if (args.architecture) {
          expect(args.architecture, `Function ${functionName} should use arm64 architecture`).toBe(
            'arm64'
          );
        }
      });
    });
  });
});
