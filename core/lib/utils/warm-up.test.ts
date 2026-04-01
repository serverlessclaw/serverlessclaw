import { describe, it, expect, vi, beforeEach } from 'vitest';
import { warmUpAgents } from './warm-up';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';

const lambdaMock = mockClient(LambdaClient);

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('warm-up Utility', () => {
  beforeEach(() => {
    lambdaMock.reset();
    vi.clearAllMocks();
  });

  it('should send InvokeCommand (Event) for each function ARN provided', async () => {
    lambdaMock.on(InvokeCommand).resolves({});

    const arns = ['arn:1', 'arn:2'];
    await warmUpAgents(arns);

    // Wait for the fire-and-forget promises to resolve (if possible in test?)
    // Actually our utility uses Promise.allSettled and returns void, but we can check the calls.
    expect(lambdaMock.calls()).toHaveLength(2);

    const calls = lambdaMock.calls();
    expect(calls[0].args[0].input).toMatchObject({
      FunctionName: 'arn:1',
      InvocationType: 'Event',
    });
    expect(calls[1].args[0].input).toMatchObject({
      FunctionName: 'arn:2',
      InvocationType: 'Event',
    });
  });

  it('should handle zero ARNs gracefully', async () => {
    await warmUpAgents([]);
    expect(lambdaMock.calls()).toHaveLength(0);
  });

  it('should handle invocation errors without crashing the main flow', async () => {
    lambdaMock.on(InvokeCommand).rejects(new Error('Lambda Error'));

    // This should not throw because the utility catches errors internally
    await expect(warmUpAgents(['arn:fail'])).resolves.not.toThrow();
  });
});
