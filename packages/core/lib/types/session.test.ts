import { describe, it, expect } from 'vitest';
import { PendingMessage } from './session';

describe('PendingMessage', () => {
  it('should accept a valid minimal message', () => {
    const msg: PendingMessage = {
      id: 'msg-1',
      content: 'Hello',
      timestamp: Date.now(),
    };
    expect(msg.id).toBe('msg-1');
    expect(msg.content).toBe('Hello');
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('should accept message with attachments', () => {
    const msg: PendingMessage = {
      id: 'msg-2',
      content: 'Check this image',
      timestamp: Date.now(),
      attachments: [
        {
          type: 'image' as any,
          url: 'https://example.com/img.png',
          name: 'img.png',
          mimeType: 'image/png',
        },
      ],
    };
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments![0].url).toBe('https://example.com/img.png');
  });

  it('should accept message with base64 attachment', () => {
    const msg: PendingMessage = {
      id: 'msg-3',
      content: 'Embedded file',
      timestamp: Date.now(),
      attachments: [
        {
          type: 'file' as any,
          base64: 'data:application/pdf;base64,JVBERi0=',
          name: 'doc.pdf',
          mimeType: 'application/pdf',
        },
      ],
    };
    expect(msg.attachments![0].base64).toContain('base64');
  });

  it('should allow empty attachments array', () => {
    const msg: PendingMessage = {
      id: 'msg-4',
      content: 'No attachments',
      timestamp: Date.now(),
      attachments: [],
    };
    expect(msg.attachments).toEqual([]);
  });
});
