/**
 * Shared mock for AWS Bedrock Runtime client.
 * Usage: vi.mock('@aws-sdk/client-bedrock-runtime', () => import('./__mocks__/bedrock'));
 */
import { vi } from 'vitest';

const mockBedrockSend = vi.fn().mockResolvedValue({
  body: new TextEncoder().encode(
    JSON.stringify({
      content: [{ type: 'text', text: 'Mock response' }],
      usage: { input_tokens: 10, output_tokens: 20 },
    })
  ),
});

export const BedrockRuntimeClient = vi.fn().mockImplementation(function () {
  return { send: mockBedrockSend };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export const ConverseCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});

export const ConverseStreamCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export { mockBedrockSend };
