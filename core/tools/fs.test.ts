import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fileRead } from './fs';

const s3Mock = mockClient(S3Client);

// Mock SST Resource
vi.mock('sst', () => ({
  Resource: {
    StagingBucket: { name: 'test-bucket' },
  },
}));

describe('fileRead tool', () => {
  beforeEach(() => {
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should read a file from chat-attachments if it exists there', async () => {
    const mockBody = 'file content';

    // Mock failure for first key, success for second
    s3Mock
      .on(GetObjectCommand, { Key: 'attachment.txt' })
      .rejects(new Error('NoSuchKey'))
      .on(GetObjectCommand, { Key: 'chat-attachments/attachment.txt' })
      .resolves({
        Body: {
          transformToString: async () => mockBody,
        } as any,
      });

    const result = await fileRead.execute({
      fileName: 'attachment.txt',
    });

    expect(result).toBe(mockBody);
    const calls = s3Mock.commandCalls(GetObjectCommand);
    const requestedKeys = calls.map((c) => c.args[0].input.Key);
    expect(requestedKeys).toContain('chat-attachments/attachment.txt');
  });

  it('should handle missing files gracefully', async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

    const result = await fileRead.execute({
      fileName: 'missing.txt',
    });

    expect(result).toContain('FAILED');
  });
});
