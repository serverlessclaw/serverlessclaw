import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
let clientConstructCount = 0;

vi.mock('@aws-sdk/client-dynamodb', () => {
  const MockDynamoDBClient = function (this: any) {
    clientConstructCount++;
    this.send = mockSend;
  };
  return { DynamoDBClient: MockDynamoDBClient };
});

vi.mock('@aws-sdk/lib-dynamodb', () => {
  const docFrom = vi.fn().mockImplementation(() => ({ send: mockSend }));
  (globalThis as any)['__ddbDocFromMock'] = docFrom;
  return {
    DynamoDBDocumentClient: {
      from: docFrom,
    },
  };
});

import { getDocClient, resetDocClient } from './ddb-client';

function getDocFromMock(): ReturnType<typeof vi.fn> {
  return (globalThis as any).__ddbDocFromMock;
}

describe('ddb-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientConstructCount = 0;
    getDocFromMock().mockClear();
    resetDocClient();
  });

  describe('getDocClient', () => {
    it('should create a DynamoDBClient with default config', () => {
      getDocClient();

      expect(clientConstructCount).toBe(1);
    });

    it('should wrap DynamoDBClient with DynamoDBDocumentClient.from', () => {
      getDocClient();

      expect(getDocFromMock()).toHaveBeenCalledTimes(1);
      expect(getDocFromMock()).toHaveBeenCalledWith(expect.anything(), {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      });
    });

    it('should pass the DynamoDBClient instance to DocumentClient.from', () => {
      getDocClient();

      const firstCallArgs = getDocFromMock().mock.calls[0];
      expect(firstCallArgs[0]).toBeDefined();
    });
  });

  describe('singleton behavior', () => {
    it('should return the same instance on multiple calls', () => {
      const client1 = getDocClient();
      const client2 = getDocClient();
      const client3 = getDocClient();

      expect(client1).toBe(client2);
      expect(client2).toBe(client3);
    });

    it('should only create DynamoDBClient once', () => {
      getDocClient();
      getDocClient();
      getDocClient();

      expect(clientConstructCount).toBe(1);
    });

    it('should only call DynamoDBDocumentClient.from once', () => {
      getDocClient();
      getDocClient();

      expect(getDocFromMock()).toHaveBeenCalledTimes(1);
    });
  });

  describe('marshalling configuration', () => {
    it('should configure removeUndefinedValues as true', () => {
      getDocClient();

      const fromCall = getDocFromMock().mock.calls[0];
      const options = fromCall[1];

      expect(options.marshallOptions.removeUndefinedValues).toBe(true);
    });

    it('should only provide marshallOptions in the config', () => {
      getDocClient();

      const fromCall = getDocFromMock().mock.calls[0];
      const options = fromCall[1];

      expect(options).toHaveProperty('marshallOptions');
      expect(Object.keys(options)).toEqual(['marshallOptions']);
    });
  });

  describe('resetDocClient', () => {
    it('should allow creating a new client after reset', () => {
      const client1 = getDocClient();
      resetDocClient();
      const client2 = getDocClient();

      expect(client1).not.toBe(client2);
      expect(clientConstructCount).toBe(2);
    });

    it('should reset singleton so next getDocClient creates fresh instance', () => {
      getDocClient();
      expect(getDocFromMock()).toHaveBeenCalledTimes(1);

      resetDocClient();
      getDocClient();
      expect(getDocFromMock()).toHaveBeenCalledTimes(2);
    });

    it('should not throw when called multiple times', () => {
      expect(() => {
        resetDocClient();
        resetDocClient();
        resetDocClient();
      }).not.toThrow();
    });

    it('should not throw when called before any getDocClient', () => {
      expect(() => resetDocClient()).not.toThrow();
    });
  });
});
