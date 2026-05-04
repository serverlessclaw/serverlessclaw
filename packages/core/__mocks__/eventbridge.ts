/**
 * Shared mock for AWS EventBridge client.
 * Usage: vi.mock('@aws-sdk/client-eventbridge', () => import('./__mocks__/eventbridge'));
 */
import { vi } from 'vitest';

const mockEbSend = vi.fn().mockResolvedValue({});

export const EventBridgeClient = vi.fn().mockImplementation(function () {
  return { send: mockEbSend };
});

/* eslint-disable @typescript-eslint/no-explicit-any */
export const PutEventsCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export { mockEbSend };
