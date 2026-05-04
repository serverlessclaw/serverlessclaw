/**
 * Shared mock for AWS DynamoDB clients.
 * Usage: vi.mock('@aws-sdk/client-dynamodb', () => import('./__mocks__/dynamodb'));
 *        vi.mock('@aws-sdk/lib-dynamodb', () => import('./__mocks__/dynamodb'));
 */
import { vi } from 'vitest';

const mockDdbSend = vi.fn().mockResolvedValue({});

export const DynamoDBClient = vi.fn().mockImplementation(function () {
  return { send: mockDdbSend };
});

export const DynamoDBDocumentClient = {
  from: vi.fn().mockImplementation(function () {
    return { send: mockDdbSend };
  }),
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const PutCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});

export const GetCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});

export const UpdateCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});

export const DeleteCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});

export const QueryCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});

export const ScanCommand = vi.fn().mockImplementation(function (this: any, args: any) {
  this.input = args;
  return this;
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export { mockDdbSend };
