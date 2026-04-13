import { describe, it, expect } from 'vitest';
import { handler } from './realtime-auth';

describe('Realtime Auth Handler', () => {
  it('returns unauthenticated when no token provided', async () => {
    const event = {};

    const response = await handler(event);

    expect(response.isAuthenticated).toBe(false);
    expect(response.principalId).toBe('unauthorized');
    expect(response.policyDocuments).toEqual([]);
  });

  it('returns unauthenticated when token is too short', async () => {
    const event = { queryString: { token: 'short' } };

    const response = await handler(event);

    expect(response.isAuthenticated).toBe(false);
    expect(response.principalId).toBe('unauthorized');
  });

  it('returns authenticated with scoped policy when valid token provided', async () => {
    const event = { queryString: { token: 'valid-token-12345' } };

    const response = await handler(event);

    expect(response.isAuthenticated).toBe(true);
    expect(response.principalId).toMatch(/^user-/);
    expect(response.disconnectAfterInSeconds).toBe(3600);
    expect(response.refreshAfterInSeconds).toBe(300);

    expect(Array.isArray(response.policyDocuments)).toBe(true);
    expect(typeof response.policyDocuments[0]).toBe('string');

    const policy = JSON.parse(response.policyDocuments[0]);

    expect(policy.Version).toBe('2012-10-17');
    expect(Array.isArray(policy.Statement)).toBe(true);

    const connectStatement = policy.Statement.find((s: any) => s.Action === 'iot:Connect');
    expect(connectStatement.Effect).toBe('Allow');
    const connectResource = connectStatement.Resource;
    if (typeof connectResource === 'string') {
      expect(connectResource).toContain(response.principalId);
    } else {
      expect(
        connectResource.some((r: string) => r.includes(response.principalId))
      ).toBe(true);
      expect(connectResource).toContain('arn:aws:iot:*:*:client/dashboard-*');
    }

    const pubRecvStatement = policy.Statement.find(
      (s: any) =>
        Array.isArray(s.Action) &&
        s.Action.includes('iot:Publish') &&
        (typeof s.Resource === 'string'
          ? s.Resource.includes(response.principalId)
          : Array.isArray(s.Resource) &&
            s.Resource.some((r: string) => r.includes(response.principalId)))
    );
    expect(pubRecvStatement).toBeDefined();

    const subStatement = policy.Statement.find(
      (s: any) =>
        s.Action === 'iot:Subscribe' &&
        (typeof s.Resource === 'string'
          ? s.Resource.includes(response.principalId)
          : Array.isArray(s.Resource) &&
            s.Resource.some((r: string) => r.includes(response.principalId)))
    );
    expect(subStatement).toBeDefined();
  });

  it('supports Enhanced Authorizer structure with protocolData', async () => {
    const event = {
      protocolData: {
        http: {
          queryString: 'token=enhanced-token-12345&other=param',
          headers: {},
          method: 'GET',
          path: '/mqtt'
        }
      },
      protocols: ['mqtt', 'http'],
      signatureVerified: false,
      connectionMetadata: {}
    };

    const response = await handler(event);

    expect(response.isAuthenticated).toBe(true);
    expect(response.principalId).toBe('user-enhancedtoken1');
  });

  it('supports token in MQTT password (base64) over username', async () => {
    const token = 'mqtt-pass-token-long';
    const event = {
      protocolData: {
        mqtt: {
          clientId: 'test-client',
          username: 'test-user',
          password: Buffer.from(token).toString('base64')
        }
      }
    };

    const response = await handler(event);

    expect(response.isAuthenticated).toBe(true);
    expect(response.principalId).toBe('user-mqttpasstoken');
  });
});
