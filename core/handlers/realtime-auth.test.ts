import { describe, it, expect, vi } from 'vitest';
import { handler } from './realtime-auth';

vi.mock('sst', () => ({
  Resource: {
    App: { name: 'serverlessclaw', stage: 'local' },
  },
}));

// Mock context for SST's RealtimeAuthHandler which pulls account/region from ARN
const mockContext = {
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-function',
} as any;

// Mock event with minimal protocolData required by SST SDK
const baseEvent = {
  protocolData: {
    mqtt: {
      clientId: 'dashboard-user',
    },
  },
};

describe('Realtime Auth Handler', () => {
  it('handles valid token and returns expected SST authorization structure', async () => {
    const event = { ...baseEvent, token: 'valid-token-12345' };

    const response = (await handler(event, mockContext, () => {})) as any;

    expect(response.isAuthenticated).toBe(true);
    expect(response.principalId).toBeDefined();
    expect(Array.isArray(response.policyDocuments)).toBe(true);
  });

  it('handles token in query string parameters', async () => {
    const event = {
      ...baseEvent,
      queryStringParameters: { token: 'valid-token-in-qs' },
    };

    const response = (await handler(event, mockContext, () => {})) as any;

    expect(response.isAuthenticated).toBe(true);
  });

  it('denies access for short/invalid tokens (returns empty policies)', async () => {
    const event = { ...baseEvent, token: 'short' };

    const response = (await handler(event, mockContext, () => {})) as any;

    expect(response.isAuthenticated).toBe(true);

    const policy =
      typeof response.policyDocuments[0] === 'string'
        ? JSON.parse(response.policyDocuments[0])
        : response.policyDocuments[0];

    console.log(
      '[RealtimeAuthTest] Generated Policy for short token:',
      JSON.stringify(policy, null, 2)
    );

    // Check that NO topics are allowed in the statement (Resource must be non-empty for an actual allow)
    const hasTopicAllow = policy.Statement.some(
      (s: any) =>
        s.Action &&
        (s.Action.includes('iot:Subscribe') || s.Action.includes('iot:Publish')) &&
        (Array.isArray(s.Resource) ? s.Resource.length > 0 : s.Resource && s.Resource !== '')
    );
    expect(hasTopicAllow).toBe(false);
  });
});
