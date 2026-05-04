/**
 * Shared mock for AWS Lambda client.
 * Usage: vi.mock('@aws-sdk/client-lambda', () => import('./__mocks__/lambda'));
 */
import { vi } from 'vitest';

const mockLambdaSend = vi.fn().mockResolvedValue({});

export const LambdaClient = vi.fn().mockImplementation(function () {
  return { send: mockLambdaSend };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export const InvokeCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export { mockLambdaSend };
