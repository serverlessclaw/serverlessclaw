import { describe, it, expect } from 'vitest';
import { AttachmentType } from '../types/llm';
import {
  TELEGRAM_UPDATE_SCHEMA,
  TELEGRAM_FILE_SCHEMA,
  TELEGRAM_PHOTO_SIZE_SCHEMA,
  TELEGRAM_DOCUMENT_SCHEMA,
  TELEGRAM_VOICE_SCHEMA,
  TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA,
  PARSED_TELEGRAM_MESSAGE_SCHEMA,
} from './webhook';

describe('TELEGRAM_UPDATE_SCHEMA', () => {
  it('should validate an empty update', () => {
    const result = TELEGRAM_UPDATE_SCHEMA.parse({});
    expect(result.update_id).toBeUndefined();
    expect(result.message).toBeUndefined();
  });

  it('should validate a text message update', () => {
    const result = TELEGRAM_UPDATE_SCHEMA.parse({
      update_id: 12345,
      message: {
        chat: { id: 999 },
        text: 'Hello bot',
      },
    });
    expect(result.update_id).toBe(12345);
    expect(result.message?.userText).toBe('Hello bot');
    expect(result.message?.chatId).toBe('999');
  });

  it('should validate update without message', () => {
    const result = TELEGRAM_UPDATE_SCHEMA.parse({ update_id: 1 });
    expect(result.update_id).toBe(1);
    expect(result.message).toBeUndefined();
  });

  it('should pass through extra fields', () => {
    const result = TELEGRAM_UPDATE_SCHEMA.parse({
      update_id: 1,
      extra_field: 'ignored',
    });
    expect((result as any).extra_field).toBe('ignored');
  });

  describe('text message', () => {
    it('should set userText from text field', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 1 }, text: 'hello' },
      });
      expect(result.message?.userText).toBe('hello');
    });

    it('should set userText from caption when text is absent', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 1 }, caption: 'photo caption' },
      });
      expect(result.message?.userText).toBe('photo caption');
    });

    it('should prefer text over caption for userText', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 1 }, text: 'text wins', caption: 'caption loses' },
      });
      expect(result.message?.userText).toBe('text wins');
    });

    it('should default userText to empty string when neither text nor caption', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 1 } },
      });
      expect(result.message?.userText).toBe('');
    });
  });

  describe('chat ID normalization', () => {
    it('should convert numeric chat ID to string', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 12345 }, text: 'hi' },
      });
      expect(result.message?.chatId).toBe('12345');
    });

    it('should keep string chat ID as string', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: '-100999' }, text: 'hi' },
      });
      expect(result.message?.chatId).toBe('-100999');
    });
  });

  describe('photo message', () => {
    it('should validate message with photo array', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          photo: [{ file_id: 'small-photo-id' }, { file_id: 'large-photo-id' }],
        },
      });
      expect(result.message?.photo).toHaveLength(2);
      expect(result.message?.photo?.[0].file_id).toBe('small-photo-id');
    });

    it('should pass through extra fields in photo objects', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          photo: [{ file_id: 'id', width: 100, height: 100, file_size: 5000 }],
        },
      });
      expect((result.message?.photo?.[0] as any).width).toBe(100);
    });

    it('should reject photo with missing file_id', () => {
      expect(() =>
        TELEGRAM_UPDATE_SCHEMA.parse({
          message: { chat: { id: 1 }, photo: [{ width: 100 }] },
        })
      ).toThrow();
    });

    it('should validate empty photo array', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 1 }, photo: [] },
      });
      expect(result.message?.photo).toEqual([]);
    });
  });

  describe('document message', () => {
    it('should validate message with document', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          document: { file_id: 'doc-id', file_name: 'report.pdf', mime_type: 'application/pdf' },
        },
      });
      expect(result.message?.document?.file_id).toBe('doc-id');
      expect(result.message?.document?.file_name).toBe('report.pdf');
    });

    it('should validate document with only required file_id', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          document: { file_id: 'doc-id' },
        },
      });
      expect(result.message?.document?.file_id).toBe('doc-id');
      expect(result.message?.document?.file_name).toBeUndefined();
      expect(result.message?.document?.mime_type).toBeUndefined();
    });

    it('should reject document with missing file_id', () => {
      expect(() =>
        TELEGRAM_UPDATE_SCHEMA.parse({
          message: { chat: { id: 1 }, document: { file_name: 'test.pdf' } },
        })
      ).toThrow();
    });

    it('should pass through extra fields in document', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          document: { file_id: 'id', thumb: { file_id: 'thumb-id' } },
        },
      });
      expect((result.message?.document as any).thumb.file_id).toBe('thumb-id');
    });
  });

  describe('voice message', () => {
    it('should validate message with voice', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          voice: { file_id: 'voice-id' },
        },
      });
      expect(result.message?.voice?.file_id).toBe('voice-id');
    });

    it('should reject voice with missing file_id', () => {
      expect(() =>
        TELEGRAM_UPDATE_SCHEMA.parse({
          message: { chat: { id: 1 }, voice: {} },
        })
      ).toThrow();
    });

    it('should pass through extra fields in voice', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: {
          chat: { id: 1 },
          voice: { file_id: 'id', duration: 30, mime_type: 'audio/ogg' },
        },
      });
      expect((result.message?.voice as any).duration).toBe(30);
    });
  });

  describe('edge cases', () => {
    it('should reject message with missing chat', () => {
      expect(() =>
        TELEGRAM_UPDATE_SCHEMA.parse({
          message: { text: 'hello' },
        })
      ).toThrow();
    });

    it('should pass through extra fields in message', () => {
      const result = TELEGRAM_UPDATE_SCHEMA.parse({
        message: { chat: { id: 1 }, text: 'hi', message_id: 42 },
      });
      expect((result.message as any).message_id).toBe(42);
    });
  });
});

describe('TELEGRAM_FILE_SCHEMA', () => {
  it('should validate with required fields', () => {
    const result = TELEGRAM_FILE_SCHEMA.parse({
      file_id: 'file-123',
      file_unique_id: 'unique-456',
    });
    expect(result.file_id).toBe('file-123');
    expect(result.file_unique_id).toBe('unique-456');
  });

  it('should validate with all fields', () => {
    const input = {
      file_id: 'file-123',
      file_unique_id: 'unique-456',
      file_size: 4096,
      file_path: 'documents/report.pdf',
    };
    const result = TELEGRAM_FILE_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing file_id', () => {
    expect(() => TELEGRAM_FILE_SCHEMA.parse({ file_unique_id: 'u' })).toThrow();
  });

  it('should reject missing file_unique_id', () => {
    expect(() => TELEGRAM_FILE_SCHEMA.parse({ file_id: 'f' })).toThrow();
  });

  it('should make file_size optional', () => {
    const result = TELEGRAM_FILE_SCHEMA.parse({
      file_id: 'f',
      file_unique_id: 'u',
    });
    expect(result.file_size).toBeUndefined();
  });

  it('should make file_path optional', () => {
    const result = TELEGRAM_FILE_SCHEMA.parse({
      file_id: 'f',
      file_unique_id: 'u',
    });
    expect(result.file_path).toBeUndefined();
  });
});

describe('TELEGRAM_PHOTO_SIZE_SCHEMA', () => {
  it('should validate with required fields', () => {
    const result = TELEGRAM_PHOTO_SIZE_SCHEMA.parse({
      file_id: 'photo-1',
      file_unique_id: 'unique-1',
      width: 320,
      height: 240,
    });
    expect(result.file_id).toBe('photo-1');
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });

  it('should validate with all fields', () => {
    const input = {
      file_id: 'photo-1',
      file_unique_id: 'unique-1',
      file_size: 10240,
      file_path: 'photos/img.jpg',
      width: 1920,
      height: 1080,
    };
    const result = TELEGRAM_PHOTO_SIZE_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing width', () => {
    expect(() =>
      TELEGRAM_PHOTO_SIZE_SCHEMA.parse({
        file_id: 'p',
        file_unique_id: 'u',
        height: 100,
      })
    ).toThrow();
  });

  it('should reject missing height', () => {
    expect(() =>
      TELEGRAM_PHOTO_SIZE_SCHEMA.parse({
        file_id: 'p',
        file_unique_id: 'u',
        width: 100,
      })
    ).toThrow();
  });

  it('should inherit file schema fields', () => {
    const result = TELEGRAM_PHOTO_SIZE_SCHEMA.parse({
      file_id: 'p',
      file_unique_id: 'u',
      width: 100,
      height: 100,
      file_size: 5000,
      file_path: 'photos/test.jpg',
    });
    expect(result.file_size).toBe(5000);
    expect(result.file_path).toBe('photos/test.jpg');
  });
});

describe('TELEGRAM_DOCUMENT_SCHEMA', () => {
  it('should validate with required fields', () => {
    const result = TELEGRAM_DOCUMENT_SCHEMA.parse({
      file_id: 'doc-1',
      file_unique_id: 'unique-1',
    });
    expect(result.file_id).toBe('doc-1');
  });

  it('should validate with all fields', () => {
    const input = {
      file_id: 'doc-1',
      file_unique_id: 'unique-1',
      file_size: 20480,
      file_path: 'docs/file.pdf',
      thumb: { file_id: 'thumb-1' },
      file_name: 'report.pdf',
      mime_type: 'application/pdf',
    };
    const result = TELEGRAM_DOCUMENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should make thumb optional', () => {
    const result = TELEGRAM_DOCUMENT_SCHEMA.parse({
      file_id: 'd',
      file_unique_id: 'u',
    });
    expect(result.thumb).toBeUndefined();
  });

  it('should make file_name optional', () => {
    const result = TELEGRAM_DOCUMENT_SCHEMA.parse({
      file_id: 'd',
      file_unique_id: 'u',
    });
    expect(result.file_name).toBeUndefined();
  });

  it('should make mime_type optional', () => {
    const result = TELEGRAM_DOCUMENT_SCHEMA.parse({
      file_id: 'd',
      file_unique_id: 'u',
    });
    expect(result.mime_type).toBeUndefined();
  });
});

describe('TELEGRAM_VOICE_SCHEMA', () => {
  it('should validate with required fields', () => {
    const result = TELEGRAM_VOICE_SCHEMA.parse({
      file_id: 'voice-1',
      file_unique_id: 'unique-1',
      duration: 15,
    });
    expect(result.file_id).toBe('voice-1');
    expect(result.duration).toBe(15);
  });

  it('should validate with all fields', () => {
    const input = {
      file_id: 'voice-1',
      file_unique_id: 'unique-1',
      file_size: 8192,
      file_path: 'voice/ogg',
      duration: 30,
      mime_type: 'audio/ogg',
    };
    const result = TELEGRAM_VOICE_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing duration', () => {
    expect(() =>
      TELEGRAM_VOICE_SCHEMA.parse({
        file_id: 'v',
        file_unique_id: 'u',
      })
    ).toThrow();
  });

  it('should make mime_type optional', () => {
    const result = TELEGRAM_VOICE_SCHEMA.parse({
      file_id: 'v',
      file_unique_id: 'u',
      duration: 5,
    });
    expect(result.mime_type).toBeUndefined();
  });

  it('should inherit file schema fields', () => {
    const result = TELEGRAM_VOICE_SCHEMA.parse({
      file_id: 'v',
      file_unique_id: 'u',
      duration: 10,
      file_size: 4096,
      file_path: 'voice/test.ogg',
    });
    expect(result.file_size).toBe(4096);
    expect(result.file_path).toBe('voice/test.ogg');
  });
});

describe('TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA', () => {
  it('should validate with required fields', () => {
    const result = TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA.parse({
      type: AttachmentType.IMAGE,
      url: 'https://example.com/photo.jpg',
    });
    expect(result.type).toBe(AttachmentType.IMAGE);
    expect(result.url).toBe('https://example.com/photo.jpg');
  });

  it('should validate with all fields', () => {
    const input = {
      type: AttachmentType.FILE,
      url: 'https://example.com/doc.pdf',
      base64: 'data:application/pdf;base64,abc',
      name: 'document.pdf',
      mimeType: 'application/pdf',
    };
    const result = TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA.parse(input);
    expect(result).toEqual(input);
  });

  it('should reject missing url', () => {
    expect(() =>
      TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA.parse({ type: AttachmentType.IMAGE })
    ).toThrow();
  });

  it('should reject missing type', () => {
    expect(() =>
      TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA.parse({ url: 'https://example.com' })
    ).toThrow();
  });

  it('should inherit optional fields from ATTACHMENT_SCHEMA', () => {
    const result = TELEGRAM_MESSAGE_ATTACHMENT_SCHEMA.parse({
      type: AttachmentType.IMAGE,
      url: 'https://img.com/pic.png',
      name: 'pic.png',
      mimeType: 'image/png',
    });
    expect(result.name).toBe('pic.png');
    expect(result.mimeType).toBe('image/png');
  });
});

describe('PARSED_TELEGRAM_MESSAGE_SCHEMA', () => {
  it('should validate with required fields', () => {
    const result = PARSED_TELEGRAM_MESSAGE_SCHEMA.parse({
      chatId: '12345',
      userText: 'Hello',
      attachments: [],
    });
    expect(result.chatId).toBe('12345');
    expect(result.userText).toBe('Hello');
    expect(result.attachments).toEqual([]);
  });

  it('should validate with attachments', () => {
    const input = {
      chatId: '-100999',
      userText: 'Check this out',
      attachments: [
        { type: AttachmentType.IMAGE, url: 'https://img.com/pic.png' },
        { type: AttachmentType.FILE, url: 'https://files.com/doc.pdf', name: 'doc.pdf' },
      ],
    };
    const result = PARSED_TELEGRAM_MESSAGE_SCHEMA.parse(input);
    expect(result.chatId).toBe('-100999');
    expect(result.attachments).toHaveLength(2);
  });

  it('should reject missing chatId', () => {
    expect(() =>
      PARSED_TELEGRAM_MESSAGE_SCHEMA.parse({
        userText: 'hi',
        attachments: [],
      })
    ).toThrow();
  });

  it('should reject missing userText', () => {
    expect(() =>
      PARSED_TELEGRAM_MESSAGE_SCHEMA.parse({
        chatId: '1',
        attachments: [],
      })
    ).toThrow();
  });

  it('should reject missing attachments', () => {
    expect(() =>
      PARSED_TELEGRAM_MESSAGE_SCHEMA.parse({
        chatId: '1',
        userText: 'hi',
      })
    ).toThrow();
  });

  it('should accept empty string userText', () => {
    const result = PARSED_TELEGRAM_MESSAGE_SCHEMA.parse({
      chatId: '1',
      userText: '',
      attachments: [],
    });
    expect(result.userText).toBe('');
  });
});
